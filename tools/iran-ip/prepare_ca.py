#!/usr/bin/env python3
"""Capture GitHub Raw's public root only AFTER a successful system-trust TLS handshake."""
from pathlib import Path
import socket
import ssl
import subprocess

with socket.create_connection(("raw.githubusercontent.com", 443), timeout=30) as transport:
    with ssl.create_default_context().wrap_socket(transport, server_hostname="raw.githubusercontent.com") as tls:
        chain = tls._sslobj.get_verified_chain()
        root = chain[-1].public_bytes()
        if isinstance(root, bytes):
            root = root.decode()
        info = chain[-1].get_info()
        if info["subject"] != info["issuer"]:
            raise RuntimeError("Verified chain did not end in a root")
        # This runs on a clean GitHub-hosted VM. Never capture a local TLS inspection CA.
        subject = str(info["subject"])
        if not any(name in subject.lower() for name in ("sectigo", "digicert", "usertrust", "isrg", "globalsign", "google trust")):
            raise RuntimeError("Unexpected GitHub CA requires review: " + subject)
        Path(__file__).with_name("github-root.pem").write_text(root)
        print(subprocess.check_output(["openssl", "x509", "-noout", "-subject", "-fingerprint", "-sha256"], input=root, text=True))
