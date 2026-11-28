"""App-only transition control flow; no CLI, Docker access or VM adapter.

The adapter may mutate only the app. Checks must return literal True or raise;
missing/indeterminate evidence never counts as success. An aborted transition
always raises, even after a verified rollback. This is not a deployment tool:
durable configuration, locking and crash recovery still need a reviewed adapter.
"""
from copy import deepcopy
from dataclasses import dataclass
import re


@dataclass(frozen=True)
class AppBaseline:
    image_id: str
    configuration_sha256: str


class TransitionFailure(RuntimeError):
    def __init__(self, report):
        self.report = deepcopy(report)
        # Never echo adapter exceptions, inspect output, credentials or row data.
        super().__init__('App transition ' + report['status'])


class CheckFailed(Exception):
    pass


def canonical_environment(entries):
    """Compare named values, not Docker's incidental environment-array order.

    Duplicate keys are ambiguous and rejected rather than choosing first/last.
    No value is exposed by errors, including malformed credential entries.
    """
    if not isinstance(entries, list):
        raise ValueError('Invalid environment inventory')
    result = {}
    for entry in entries:
        if not isinstance(entry, str) or '=' not in entry:
            raise ValueError('Invalid environment entry')
        name, value = entry.split('=', 1)
        if not name or name in result:
            raise ValueError('Invalid or duplicate environment key')
        result[name] = value
    return dict(sorted(result.items()))


def protected_snapshot(adapter):
    snapshot = deepcopy(adapter.protected_identity())
    fields = {'id', 'image', 'started_at', 'restarts', 'running'}
    if not isinstance(snapshot, dict) or not snapshot:
        raise CheckFailed()
    for name, item in snapshot.items():
        if (not isinstance(name, str) or not name or not isinstance(item, dict)
                or set(item) != fields or item['running'] is not True
                or type(item['restarts']) is not int or item['restarts'] < 0
                or any(not isinstance(item[k], str) or not item[k] for k in ('id', 'image', 'started_at'))):
            raise CheckFailed()
    return snapshot


def execute_app_transition(adapter):
    """Require backup/preconditions, then apply or verify an app-only rollback.

    Adapter contract:
      capture_baseline() -> AppBaseline from the currently installed app;
      protected_identity() -> nonempty container identity mapping;
      verify_preconditions(baseline) -> backup/compatibility/ownership evidence;
      verify_baseline_identity(baseline), baseline_healthy(),
      verify_candidate(), verify_preserved_data() -> True only on evidence;
      install_candidate(), restore_baseline(baseline) -> True or raise.

    The caller must hold its deployment lock. The adapter must bound waits and
    preserve data; this controller has no database restore or protected-repair
    operation. A process kill/power loss is outside this in-process contract.
    """
    report = {'status': 'blocked', 'checks': [], 'failure': None,
              'rollback': {'attempted': False, 'errors': []}}
    phase = 'capture-baseline'
    attempted = False

    def check(name, operation):
        nonlocal phase
        phase = name
        if operation() is not True:
            raise CheckFailed()
        report['checks'].append(name)

    def failure(error):
        return {'phase': phase, 'kind': 'interrupted' if isinstance(error, KeyboardInterrupt)
                else 'check-failed' if isinstance(error, CheckFailed) else 'operation-failed'}

    try:
        baseline = adapter.capture_baseline()
        if (not isinstance(baseline, AppBaseline)
                or not re.fullmatch(r'sha256:[0-9a-f]{64}', baseline.image_id)
                or not re.fullmatch(r'[0-9a-f]{64}', baseline.configuration_sha256)):
            raise CheckFailed()
        phase = 'capture-protected'
        protected = protected_snapshot(adapter)
        unchanged = lambda: protected_snapshot(adapter) == protected
        check('preconditions', lambda: adapter.verify_preconditions(baseline))
        check('baseline-identity', lambda: adapter.verify_baseline_identity(baseline))
        check('baseline-health', adapter.baseline_healthy)
        check('baseline-data', adapter.verify_preserved_data)
        check('protected-before', unchanged)
        # Set BEFORE invoking the mutation: a failed command may already have
        # removed/replaced the app, so its exception must still enter recovery.
        attempted = True
        check('install-candidate', adapter.install_candidate)
        check('protected-after-install', unchanged)
        check('candidate', adapter.verify_candidate)
        check('candidate-data', adapter.verify_preserved_data)
        check('protected-after-candidate', unchanged)
        report['status'] = 'applied'
        return report
    except (Exception, KeyboardInterrupt) as error:
        report['failure'] = failure(error)
        if not attempted:
            raise TransitionFailure(report) from None

    report['rollback']['attempted'] = True
    # Collect every recovery failure, including protected-state checks even if
    # recreation failed. A failed command cannot be hidden by later health.
    for name, operation in (
        ('restore-baseline', lambda: adapter.restore_baseline(baseline)),
        ('rollback-identity', lambda: adapter.verify_baseline_identity(baseline)),
        ('rollback-health', adapter.baseline_healthy),
        ('rollback-data', adapter.verify_preserved_data),
        ('protected-after-rollback', unchanged),
    ):
        try:
            check(name, operation)
        except (Exception, KeyboardInterrupt) as error:
            report['rollback']['errors'].append(failure(error))
    report['status'] = 'rollback_failed' if report['rollback']['errors'] else 'rolled_back'
    raise TransitionFailure(report) from None
