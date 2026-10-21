#!/usr/bin/env python3
"""Integration tests on isolated official MikroTik CHR images. No production router access."""
from __future__ import annotations
import argparse
import contextlib
import datetime as dt
import functools
import http.server
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import socket
import ssl
import struct
import subprocess
import tempfile
import threading
import time
import urllib.request
import zipfile

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("generate", HERE / "generate.py")
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)


class ApiError(RuntimeError):
    pass


class API:
    def __init__(self, port):
        self.sock = socket.create_connection(("127.0.0.1", port), timeout=3)
        self.sock.settimeout(3)
        self.call("/login", name="admin", password="")
        self.sock.settimeout(600)

    def read(self, count):
        result = b""
        while len(result) < count:
            part = self.sock.recv(count - len(result))
            if not part:
                raise EOFError("API connection closed")
            result += part
        return result

    def length(self):
        first = self.read(1)[0]
        if first < 0x80:
            return first
        if first < 0xC0:
            return ((first & 0x3F) << 8) + self.read(1)[0]
        if first < 0xE0:
            return ((first & 0x1F) << 16) + int.from_bytes(self.read(2), "big")
        if first < 0xF0:
            return ((first & 0x0F) << 24) + int.from_bytes(self.read(3), "big")
        return int.from_bytes(self.read(4), "big")

    @staticmethod
    def encode_length(n):
        if n < 0x80:
            return bytes([n])
        if n < 0x4000:
            return (n | 0x8000).to_bytes(2, "big")
        if n < 0x200000:
            return (n | 0xC00000).to_bytes(3, "big")
        if n < 0x10000000:
            return (n | 0xE0000000).to_bytes(4, "big")
        return b"\xf0" + n.to_bytes(4, "big")

    def call(self, command, **kwargs):
        words = [command] + [f"={key.replace('_', '-')}={value}" for key, value in kwargs.items()]
        payload = b"".join(self.encode_length(len(b)) + b for b in (w.encode() for w in words)) + b"\0"
        self.sock.sendall(payload)
        rows, errors = [], []
        while True:
            sentence = []
            while (size := self.length()) != 0:
                sentence.append(self.read(size).decode())
            if not sentence:
                continue
            values = dict(word[1:].split("=", 1) for word in sentence[1:] if word.startswith("=") and "=" in word[1:])
            if sentence[0] == "!re":
                rows.append(values)
            elif sentence[0] in ("!trap", "!fatal"):
                errors.append(values.get("message", str(values)))
                if sentence[0] == "!fatal":
                    raise ApiError("; ".join(errors))
            elif sentence[0] == "!done":
                if errors:
                    raise ApiError("; ".join(errors))
                if values:
                    rows.append(values)
                return rows

    def run(self, source, allow_error=False):
        existing = self.call("/system/script/print")
        for row in existing:
            if row["name"] == "EMS-IR-test-command":
                self.call("/system/script/remove", **{".id": row[".id"]})
        added = self.call("/system/script/add", name="EMS-IR-test-command", policy="read,write,policy,test,ftp", source=source)
        try:
            self.call("/system/script/run", **{".id": added[0]["ret"]})
        except ApiError:
            if not allow_error:
                raise

    def close(self):
        self.sock.close()


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass


def start_server(root, port, certificate=None, key=None):
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(QuietHandler, directory=str(root)))
    if certificate:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(certificate, key)
        server.socket = ctx.wrap_socket(server.socket, server_side=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def make_tls(root):
    def run(*args):
        subprocess.run(["openssl", *args], cwd=root, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    run("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.pem", "-days", "2", "-subj", "/CN=EMS Isolated Test CA")
    run("req", "-newkey", "rsa:2048", "-nodes", "-keyout", "server.key", "-out", "server.csr", "-subj", "/CN=10.0.2.2")
    (root / "server.ext").write_text("subjectAltName=IP:10.0.2.2\n")
    run("x509", "-req", "-in", "server.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-out", "server.pem", "-days", "2", "-extfile", "server.ext")


def wait_api(port, proc):
    deadline = time.monotonic() + 180
    last = None
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise RuntimeError("QEMU exited")
        try:
            return API(port)
        except (OSError, EOFError, ApiError) as exc:
            last = exc
            time.sleep(2)
    raise RuntimeError(f"RouterOS API did not start: {last}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", required=True)
    parser.add_argument("--feed-dir", type=Path, default=HERE.parents[1] / "feeds/iran")
    args = parser.parse_args()
    major = int(args.version.split(".")[0])
    http_port, https_port, api_port = 18080 + major, 18443 + major, 18728 + major
    cases = []
    def passed(name):
        cases.append(name)
        print(f"PASS RouterOS {args.version}: {name}", flush=True)
    with tempfile.TemporaryDirectory(prefix="ems-chr-") as directory:
        root = Path(directory)
        url = f"https://download.mikrotik.com/routeros/{args.version}/chr-{args.version}.img.zip"
        print(f"Downloading official CHR {args.version}", flush=True)
        cache = HERE.parents[1] / ".cache/chr"
        cache.mkdir(parents=True, exist_ok=True)
        archive = cache / f"chr-{args.version}.img.zip"
        if not archive.exists():
            temporary = archive.with_suffix(".part")
            urllib.request.urlretrieve(url, temporary)
            temporary.replace(archive)
        with zipfile.ZipFile(archive) as z:
            image_name = next(n for n in z.namelist() if n.endswith(".img"))
            image = root / "chr.img"
            image.write_bytes(z.read(image_name))
        subprocess.run(["qemu-img", "resize", "-f", "raw", str(image), "256M"], check=True, stdout=subprocess.DEVNULL)
        make_tls(root)
        http = start_server(root, http_port)
        https = start_server(root, https_port, root / "server.pem", root / "server.key")
        qemu_log = (root / "qemu.log").open("w")
        accel = ["-enable-kvm", "-cpu", "host"] if os.access("/dev/kvm", os.R_OK | os.W_OK) else ["-accel", "tcg", "-cpu", "qemu64"]
        command = ["qemu-system-x86_64", "-m", "1024", "-smp", "1", *accel,
                   "-drive", f"file={image},format=raw,if=ide", "-netdev", f"user,id=n0,hostfwd=tcp:127.0.0.1:{api_port}-:8728",
                   "-device", "virtio-net-pci,netdev=n0", "-display", "none", "-monitor", f"unix:{root / 'monitor.sock'},server,nowait",
                   "-serial", f"file:{root / 'serial.log'}", "-rtc", "base=utc"]
        proc = subprocess.Popen(command, stdout=qemu_log, stderr=qemu_log)
        api = None
        try:
            api = wait_api(api_port, proc)
            resource = api.call("/system/resource/print")[0]
            assert resource["version"].startswith(str(major) + "."), resource
            now = dt.datetime.now(g.UTC).replace(microsecond=0)
            date = now.strftime("%b/%d/%Y").lower() if major == 6 else now.strftime("%Y-%m-%d")
            api.call("/system/clock/set", date=date, time=now.strftime("%H:%M:%S"), time_zone_name="Etc/UTC")
            api.call("/ip/dns/set", servers="10.0.2.3")
            passed("official CHR boot and API")

            def rows():
                return api.call("/ip/firewall/address-list/print")
            def active():
                return {r["address"]: (r[".id"], r.get("disabled", "false"), r.get("comment", ""))
                        for r in rows() if r.get("list") == "IR-IP_EMS"}
            def import_text(text, name="candidate.rsc", allow_error=False):
                (root / name).write_text(text)
                api.call("/tool/fetch", url=f"http://10.0.2.2:{http_port}/{name}", dst_path=name)
                api.run(f'/import file-name="{name}";', allow_error)
            def verify_count(expected):
                r = rows()
                data = [x for x in r if x.get("list") == "IR-IP_EMS" and x.get("comment") == "EMS:IR:DATA"]
                assert len(data) == expected, ("count", len(data), expected)
                assert all(x.get("dynamic") == "false" and x.get("disabled") == "false" for x in data)
                marker = [x for x in r if x.get("list") == "IR-IP_EMS" and x["address"] == "1.1.2.7"]
                assert len(marker) == 1 and marker[0]["disabled"] == "true", marker
                assert "Updated=" + g.jalali(now) in marker[0]["comment"]
                assert not any(x.get("list") == "IR-IP_EMS__stage" for x in r)
                assert any(x.get("list") == "EMS-UNRELATED" and x["address"] == "192.0.2.55" for x in r)

            api.call("/ip/firewall/address-list/add", list="EMS-UNRELATED", address="192.0.2.55", comment="must survive")
            text = (args.feed_dir / f"IR-IP_EMS-v{major}.rsc").read_text()
            manifest = json.loads((args.feed_dir / "manifest.json").read_text())
            count = manifest["prefix_count"]
            try:
                import_text(text)
            except ApiError:
                # In this disposable VM only, replay without the catch to expose
                # RouterOS 6's original error (v6 cannot bind an on-error value).
                start = text.index("    } on-error={\n")
                end = text.index("    :do { /ip firewall address-list remove [find where list=$stageName]; }")
                diagnostic = (text[:start] + "    }\n" + text[end:]).replace("    :do {\n", "    {\n", 1)
                print("Initial import failed; replaying uncaught in isolated test VM", flush=True)
                import_text(diagnostic, name="diagnostic.rsc")
                raise
            verify_count(count)
            passed(f"full RIPE import ({count} prefixes), static data and disabled Jalali marker")
            before = active()
            import_text(text)
            assert active() == before
            passed("repeat import is idempotent; active row IDs preserved")

            networks = [ipaddress.ip_network(line) for line in (args.feed_dir / "IR-IP_EMS.txt").read_text().splitlines()]
            modified = networks[2:] + [ipaddress.ip_network("11.11.11.0/24"), ipaddress.ip_network("11.11.12.0/24")]
            published = g.iso_time(manifest["published_at_utc"]) + dt.timedelta(seconds=10)
            candidate, _, _, _ = g.render_feed(modified, g.iso_time(manifest["source_snapshot_utc"]), published, major)
            injections = {
                "truncated file leaves active list intact": candidate[:len(candidate)//2],
                "staging failure leaves active list intact": candidate.replace("# The complete candidate", ':error "injected staging failure";\n        # The complete candidate', 1),
                "addition failure rolls back new rows": candidate.replace(":set addedIds ($addedIds, $newId);", ':set addedIds ($addedIds, $newId); :error "injected add failure";', 1),
                "withdrawal failure restores removed rows": candidate.replace("/ip firewall address-list remove $item;\n        }", '/ip firewall address-list remove $item; :error "injected withdrawal failure";\n        }', 1),
            }
            for name, payload in injections.items():
                import_text(payload, allow_error=True)
                # Rollback may recreate an obsolete row with a different internal ID.
                after = active()
                assert {k:v[1:] for k,v in after.items()} == {k:v[1:] for k,v in before.items()}, name
                passed(name)
            import_text(candidate)
            verify_count(count)
            assert "11.11.11.0/24" in active() and str(networks[0]) not in active()
            passed("additions and withdrawals converge without emptying the list")
            before = active()
            import_text(text, allow_error=True)
            assert active() == before
            passed("older generation rejected")
            other = (args.feed_dir / f"IR-IP_EMS-v{7 if major == 6 else 6}.rsc").read_text()
            import_text(other, allow_error=True)
            assert active() == before
            passed("wrong RouterOS major rejected")

            # Test the real installer and its actual public GitHub CA, then HTTPS on Raw.
            import_text((args.feed_dir / "install-update.rsc").read_text(), name="installer.rsc")
            api.call("/tool/fetch", url="https://raw.githubusercontent.com/emsebi/EMS_IPAM/main/README.md", check_certificate="yes", dst_path="github-probe.txt")
            passed("installer imports public CA; verified HTTPS download from GitHub Raw")

            (root / f"IR-IP_EMS-v{major}.rsc").write_text(candidate)
            (root / f"IR-IP_EMS-v{major}.bytes").write_text(str(len(candidate.encode())))
            updater = (args.feed_dir / "update.rsc").read_text().replace(
                "https://raw.githubusercontent.com/emsebi/EMS_IPAM/main/feeds/iran/IR-IP_EMS-v", f"https://10.0.2.2:{https_port}/IR-IP_EMS-v")
            api.run(updater, allow_error=True)
            assert active() == before
            passed("untrusted HTTPS endpoint rejected with old list preserved")
            # Import a test-only CA into the isolated VM; never include it in deliverables.
            api.call("/tool/fetch", url=f"http://10.0.2.2:{http_port}/ca.pem", dst_path="test-ca.pem")
            api.call("/certificate/import", file_name="test-ca.pem", passphrase="")
            certs = api.call("/certificate/print")
            testca = next(c for c in certs if c.get("common-name") == "EMS Isolated Test CA")
            api.call("/certificate/set", **{".id": testca[".id"]}, trusted="yes")
            api.run(updater)
            verify_count(count)
            passed("complete updater fetches size and RSC, verifies TLS, imports and cleans temporary files")
            before = active()
            (root / f"IR-IP_EMS-v{major}.rsc").write_text(candidate[:100])
            api.run(updater, allow_error=True)
            assert active() == before
            passed("truncated download rejected without advancing metadata")
            assert not any(f["name"] == "IR-IP_EMS-download.rsc" for f in api.call("/file/print"))
            passed("temporary download cleaned after failure")

            time.sleep(3)
            try:
                api.call("/system/reboot")
            except (EOFError, OSError):
                pass
            api.close()
            time.sleep(5)
            api = wait_api(api_port, proc)
            verify_count(count)
            passed("data and metadata survive reboot")
            report = {"version": args.version, "cases": cases, "passed": len(cases), "tested_at": dt.datetime.now(g.UTC).isoformat()}
            (args.feed_dir / f"test-routeros-{major}.json").write_text(json.dumps(report, indent=2) + "\n")
            print(json.dumps(report), flush=True)
        except Exception:
            with contextlib.suppress(Exception):
                with socket.socket(socket.AF_UNIX) as monitor:
                    monitor.connect(str(root / "monitor.sock"))
                    monitor.sendall(f"screendump {args.feed_dir.resolve() / ('failure-v' + str(major) + '.ppm')}\n".encode())
                    time.sleep(1)
            if api:
                with contextlib.suppress(Exception):
                    logs = api.call("/log/print")[-20:]
                    print("RouterOS logs:", json.dumps(logs), flush=True)
            for name in ("qemu.log", "serial.log"):
                if (root / name).exists():
                    print(name + ":\n" + (root / name).read_text(errors="replace")[-4000:], flush=True)
            raise
        finally:
            if api:
                with contextlib.suppress(Exception):
                    api.close()
            proc.terminate()
            with contextlib.suppress(subprocess.TimeoutExpired):
                proc.wait(timeout=10)
            if proc.poll() is None:
                proc.kill()
            http.shutdown()
            https.shutdown()
            qemu_log.close()


if __name__ == "__main__":
    main()
