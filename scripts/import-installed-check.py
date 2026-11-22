#!/usr/bin/env python3
"""Observe the installed Import bundle; never deploy, authenticate or import data.

Only fixed loopback GETs, selected app identity fields and sha256sum are used.
Matching files cannot attest already-loaded Node code or a complete deployed SHA.
"""

import argparse
import hashlib
import http.client
import json
from pathlib import Path
import re
import subprocess


APP = "ems-ipam-app-1"
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
FILES = (
    "public/index.html", "public/app.js", "public/ipam-import-format.mjs",
    "server/main.mjs", "server/portable.mjs", "server/ipam-bulk.mjs",
    "server/ip.mjs", "package.json", "package-lock.json",
)
HTTP_PATHS = {"public/index.html": "/", "public/app.js": "/app.js",
              "public/ipam-import-format.mjs": "/ipam-import-format.mjs"}
IDENTITY_FORMAT = ('{"id":{{json .Id}},"image":{{json .Image}},'
                   '"running":{{json .State.Running}},'
                   '"started_at":{{json .State.StartedAt}},'
                   '"restart_count":{{json .RestartCount}}}')


def command(args):
    # No shell, environment/credential inspection, compose, DB or RADIUS access.
    result = subprocess.run(args, check=True, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=8)
    if len(result.stdout) > 4096:
        raise ValueError("oversized command output")
    return result.stdout.decode("ascii").strip()


def app_identity():
    try:
        value = json.loads(command(["docker", "container", "inspect", "--format",
                                    IDENTITY_FORMAT, APP]))
        if (not isinstance(value, dict)
                or set(value) != {"id", "image", "running", "started_at", "restart_count"}
                or not re.fullmatch(r"[0-9a-f]{64}", str(value["id"]))
                or not re.fullmatch(r"sha256:[0-9a-f]{64}", str(value["image"]))
                or type(value["running"]) is not bool
                or type(value["restart_count"]) is not int or value["restart_count"] < 0
                or not re.fullmatch(r"\d{4}-\d\d-\d\dT[0-9:.]+Z", str(value["started_at"]))):
            raise ValueError("invalid app identity")
        return value
    except (OSError, subprocess.SubprocessError, ValueError):
        return None


def installed_hash(relative):
    if relative not in FILES:
        raise ValueError("file outside Import allowlist")
    path = "/app/" + relative
    try:
        output = command(["docker", "exec", APP, "sha256sum", "--", path])
        match = re.fullmatch(r"([0-9a-f]{64})  " + re.escape(path), output)
        return match[1] if match else None
    except (OSError, subprocess.SubprocessError, ValueError):
        return None


def get_local(path):
    if path not in {"/health", *HTTP_PATHS.values()}:
        raise ValueError("HTTP path outside Import allowlist")
    connection = http.client.HTTPConnection("127.0.0.1", 8888, timeout=5)
    try:
        connection.request("GET", path)
        response = connection.getresponse()
        if response.status != 200:
            return response.status, None
        body = response.read(MAX_RESPONSE_BYTES + 1)
        return response.status, body if len(body) <= MAX_RESPONSE_BYTES else None
    except (OSError, http.client.HTTPException):
        return None, None
    finally:
        connection.close()


def health_ready(body):
    try:
        value = json.loads(body)
        return (isinstance(value, dict) and value.get("ok") is True
                and value.get("database") == "ready"
                and isinstance(value.get("modules"), list) and "ipam" in value["modules"])
    except (TypeError, ValueError):
        return False


def comparison(expected, observed):
    return {"expected_sha256": expected, "observed_sha256": observed,
            "status": "unavailable" if observed is None else
                      "match" if observed == expected else "mismatch"}


def inspect_installed(source_root, source_sha):
    if not re.fullmatch(r"[0-9a-f]{40}", source_sha):
        raise ValueError("expected source SHA must be a full commit SHA")
    # Load the complete reference before accessing the VM; missing source fails closed.
    expected = {relative: hashlib.sha256(
        (Path(source_root) / "docker-app" / relative).read_bytes()).hexdigest()
        for relative in FILES}
    before = app_identity()
    status, body = get_local("/health")
    health = {"http_status": status, "ready": status == 200 and health_ready(body)}
    files = {relative: comparison(digest, installed_hash(relative))
             for relative, digest in expected.items()}
    served = {}
    for relative, path in HTTP_PATHS.items():
        status, body = get_local(path)
        digest = hashlib.sha256(body).hexdigest() if status == 200 and body is not None else None
        served[path] = {"http_status": status, **comparison(expected[relative], digest)}
    after = app_identity()
    stable = before is not None and before == after and before["running"]
    matches = all(row["status"] == "match" for row in [*files.values(), *served.values()])
    compatible_files = bool(stable and health["ready"] and matches)
    report = {
        "expected_source_sha": source_sha, "deployed_sha": None,
        "app_identity_before": before, "app_identity_after": after,
        "app_identity_stable": bool(stable), "health": health,
        "container_files": files, "served_assets": served,
        "status": "files_match_runtime_unverified" if compatible_files else "blocked",
        "runtime_backend_verified": False, "acceptance": "pending",
        "limitations": ["File hashes do not attest already-loaded backend code.",
                        "Selected files do not identify the complete deployed tree.",
                        "No login, preview/commit, backup, restore or deployment was performed."],
    }
    return report, 0 if compatible_files else 2


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", required=True)
    parser.add_argument("--source-sha", required=True)
    args = parser.parse_args()
    try:
        report, code = inspect_installed(args.source_root, args.source_sha)
    except (OSError, ValueError):
        print(json.dumps({"status": "invalid_reference", "acceptance": "pending",
                          "deployed_sha": None}))
        return 2
    print(json.dumps(report, indent=2, sort_keys=True))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
