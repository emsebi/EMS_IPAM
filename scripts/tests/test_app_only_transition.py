import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app_only_transition import AppBaseline, TransitionFailure, canonical_environment, execute_app_transition


OLD = AppBaseline('sha256:' + '1' * 64, '2' * 64)
NEW = AppBaseline('sha256:' + '3' * 64, '4' * 64)


class Adapter:
    def __init__(self):
        self.app = OLD
        self.rows = ['existing']
        self.events, self.failures, self.hooks = [], {}, {}
        self.protected = {'inert': {'id': 'container-id', 'image': 'image-id',
                         'started_at': '2026-11-28T00:00:00Z', 'restarts': 0, 'running': True}}

    def event(self, name):
        self.events.append(name)
        if name in self.hooks:
            self.hooks[name]()
        value = self.failures.get(name, True)
        if isinstance(value, BaseException):
            raise value
        return value

    def capture_baseline(self):
        return self.app

    def protected_identity(self):
        self.event('protected')
        return self.protected

    def verify_preconditions(self, baseline):
        return self.event('preconditions')

    def verify_baseline_identity(self, baseline):
        return self.event('identity') is True and self.app == baseline

    def baseline_healthy(self):
        return self.event('health')

    def verify_preserved_data(self):
        return self.event('data')

    def install_candidate(self):
        self.app = NEW
        self.rows.append('acknowledged-new-write')
        return self.event('install')

    def verify_candidate(self):
        return self.event('candidate')

    def restore_baseline(self, baseline):
        self.app = baseline
        return self.event('restore')


class TransitionTests(unittest.TestCase):
    def test_environment_order_is_irrelevant_but_names_and_values_must_match(self):
        before = canonical_environment(['PORT=8080', 'TOKEN=synthetic=a=b', 'EMPTY='])
        after = canonical_environment(['EMPTY=', 'TOKEN=synthetic=a=b', 'PORT=8080'])
        self.assertEqual(before, after)
        self.assertEqual(before['TOKEN'], 'synthetic=a=b')
        self.assertNotEqual(before, canonical_environment(['EMPTY=', 'TOKEN=changed', 'PORT=8080']))
        self.assertNotEqual(before, canonical_environment(['TOKEN=synthetic=a=b', 'PORT=8080']))
        self.assertNotEqual(before, canonical_environment(['EMPTY=', 'OTHER=synthetic=a=b', 'PORT=8080']))

    def test_ambiguous_environment_is_rejected_without_leaking_values(self):
        for entries in (None, ['A=secret-value', 'A=other'], ['A=secret-value', 'A=secret-value'],
                        ['secret-value'], ['=secret-value'], [None]):
            with self.assertRaises(ValueError) as raised:
                canonical_environment(entries)
            self.assertNotIn('secret-value', str(raised.exception))

    def failed(self, adapter, status):
        with self.assertRaises(TransitionFailure) as raised:
            execute_app_transition(adapter)
        report = raised.exception.report
        self.assertEqual(report['status'], status)
        self.assertNotIn('secret-value', json.dumps(report) + str(raised.exception))
        return report

    def test_success_never_rolls_back(self):
        adapter = Adapter()
        report = execute_app_transition(adapter)
        self.assertEqual(report['status'], 'applied')
        self.assertEqual(adapter.app, NEW)
        self.assertNotIn('restore', adapter.events)
        self.assertIn('protected-after-candidate', report['checks'])

    def test_each_precondition_failure_blocks_all_mutations(self):
        for phase in ('preconditions', 'identity', 'health', 'data', 'protected'):
            for error in (False, None, RuntimeError('secret-value')):
                # protected_identity is a read operation; simulate unreadability
                # rather than a boolean-returning verification for that method.
                if phase == 'protected' and not isinstance(error, Exception):
                    continue
                with self.subTest(phase=phase, error=type(error).__name__):
                    adapter = Adapter(); adapter.failures[phase] = error
                    report = self.failed(adapter, 'blocked')
                    self.assertFalse(report['rollback']['attempted'])
                    self.assertNotIn('install', adapter.events)
                    self.assertNotIn('restore', adapter.events)

    def test_missing_or_invalid_baseline_and_protected_evidence_is_blocked(self):
        for baseline in (None, AppBaseline('moving-tag:latest', '2' * 64), AppBaseline(OLD.image_id, '')):
            adapter = Adapter(); adapter.app = baseline
            self.failed(adapter, 'blocked'); self.assertNotIn('install', adapter.events)
        for snapshot in ({}, None, {'inert': {}}, {'inert': {'running': False}}):
            adapter = Adapter(); adapter.protected = snapshot
            self.failed(adapter, 'blocked'); self.assertNotIn('install', adapter.events)

    def test_candidate_failure_preserves_new_writes_and_requires_all_recovery_checks(self):
        adapter = Adapter(); adapter.failures['candidate'] = False
        report = self.failed(adapter, 'rolled_back')
        self.assertEqual(adapter.app, OLD)
        self.assertEqual(adapter.rows, ['existing', 'acknowledged-new-write'])
        self.assertEqual(report['rollback']['errors'], [])
        for check in ('restore-baseline', 'rollback-identity', 'rollback-health', 'rollback-data', 'protected-after-rollback'):
            self.assertIn(check, report['checks'])

    def test_exception_or_interrupt_after_partial_install_always_attempts_recovery(self):
        for error in (RuntimeError('secret-value'), KeyboardInterrupt(), False, None):
            adapter = Adapter(); adapter.failures['install'] = error
            report = self.failed(adapter, 'rolled_back')
            self.assertEqual(report['failure']['phase'], 'install-candidate')
            self.assertEqual(adapter.app, OLD)

    def test_restore_command_failure_is_not_hidden_by_healthy_old_app(self):
        adapter = Adapter(); adapter.failures.update(candidate=False, restore=RuntimeError('secret-value'))
        report = self.failed(adapter, 'rollback_failed')
        self.assertEqual(adapter.app, OLD)
        self.assertEqual([e['phase'] for e in report['rollback']['errors']], ['restore-baseline'])
        self.assertIn('protected-after-rollback', report['checks'])

    def test_all_failed_recovery_checks_are_recorded_without_skipping_protection(self):
        adapter = Adapter(); adapter.failures['candidate'] = False
        def break_recovery():
            adapter.failures.update(identity=False, health=False, data=False, protected=RuntimeError('secret-value'))
        adapter.hooks['restore'] = break_recovery
        report = self.failed(adapter, 'rollback_failed')
        self.assertEqual([e['phase'] for e in report['rollback']['errors']],
                         ['rollback-identity', 'rollback-health', 'rollback-data', 'protected-after-rollback'])

    def test_wrong_restored_image_or_configuration_is_not_success(self):
        for wrong in (NEW, AppBaseline(OLD.image_id, NEW.configuration_sha256)):
            adapter = Adapter(); adapter.failures['candidate'] = False
            adapter.hooks['restore'] = lambda: setattr(adapter, 'app', wrong)
            report = self.failed(adapter, 'rollback_failed')
            self.assertEqual(report['rollback']['errors'][0]['phase'], 'rollback-identity')

    def test_changed_or_missing_protected_identity_is_never_repaired_or_accepted(self):
        for field, value in [('id', 'replacement'), ('image', 'replacement'), ('restarts', 1),
                             ('started_at', 'new-start'), ('running', False)]:
            adapter = Adapter()
            adapter.hooks['candidate'] = lambda: adapter.protected['inert'].__setitem__(field, value)
            report = self.failed(adapter, 'rollback_failed')
            self.assertEqual(report['failure']['phase'], 'protected-after-candidate')
            self.assertEqual(adapter.protected['inert'][field], value)
            self.assertEqual(adapter.app, OLD)

    def test_protected_drift_during_preflight_stops_before_install(self):
        adapter = Adapter()
        adapter.hooks['preconditions'] = lambda: adapter.protected['inert'].__setitem__('id', 'replacement')
        report = self.failed(adapter, 'blocked')
        self.assertEqual(report['failure']['phase'], 'protected-before')
        self.assertNotIn('install', adapter.events)

    def test_missing_protected_evidence_after_mutation_cannot_be_accepted(self):
        adapter = Adapter(); adapter.hooks['candidate'] = adapter.protected.clear
        report = self.failed(adapter, 'rollback_failed')
        self.assertEqual(report['failure']['phase'], 'protected-after-candidate')
        self.assertEqual(report['rollback']['errors'][-1]['phase'], 'protected-after-rollback')
        self.assertEqual(adapter.app, OLD)

    def test_data_verification_failure_cannot_be_hidden_by_healthy_rollback(self):
        adapter = Adapter()
        adapter.hooks['candidate'] = lambda: adapter.failures.__setitem__('data', False)
        report = self.failed(adapter, 'rollback_failed')
        self.assertEqual(report['failure']['phase'], 'candidate-data')
        self.assertEqual(report['rollback']['errors'][0]['phase'], 'rollback-data')
        self.assertEqual(adapter.app, OLD)
        self.assertEqual(adapter.rows, ['existing', 'acknowledged-new-write'])

    def test_repeat_transition_restores_current_baseline_not_original_image(self):
        adapter = Adapter(); execute_app_transition(adapter)
        adapter.failures['candidate'] = False
        self.failed(adapter, 'rolled_back')
        self.assertEqual(adapter.app, NEW)


if __name__ == '__main__':
    unittest.main()
