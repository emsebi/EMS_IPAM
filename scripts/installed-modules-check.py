#!/usr/bin/env python3
"""Read-only local readiness check. Never authenticate, scan or change state."""
import http.client
import json

REQUIRED_MODULES = frozenset({
    "ipam", "network-map", "reports", "radio", "radius", "radius-ops", "network-access"
})


def validate_health(payload):
    if not isinstance(payload, dict) or payload.get("ok") is not True:
        raise ValueError("application is not healthy")
    if payload.get("database") != "ready":
        raise ValueError("database is not ready")
    modules = payload.get("modules")
    if not isinstance(modules, list) or any(not isinstance(m, str) for m in modules):
        raise ValueError("module inventory is invalid")
    missing = REQUIRED_MODULES - set(modules)
    if missing:
        raise ValueError("required modules not loaded: " + ", ".join(sorted(missing)))


def check_installed():
    # Fixed loopback destination, GET only, no redirects and no credentials.
    connection = http.client.HTTPConnection("127.0.0.1", 8888, timeout=5)
    try:
        connection.request("GET", "/health")
        response = connection.getresponse()
        if response.status != 200:
            raise ValueError("local health endpoint did not return HTTP 200")
        body = response.read(65537)
        if len(body) > 65536:
            raise ValueError("health response exceeded limit")
        validate_health(json.loads(body))
    finally:
        connection.close()


if __name__ == "__main__":
    try:
        check_installed()
    except Exception:
        # Do not echo arbitrary response bodies or configuration into Actions logs.
        raise SystemExit("FAIL installed modules: local health, database or required module check failed")
    print("PASS installed modules: database ready; " + ", ".join(sorted(REQUIRED_MODULES)))
    print("Read-only GET /health on loopback: no login, discovery, device probe or mutation.")
