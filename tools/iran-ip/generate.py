#!/usr/bin/env python3
"""Publish validated RIPE IPv4 data. Python 3.11+ and Node.js (Intl Persian calendar)."""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import urllib.request

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SOURCE = "https://stat.ripe.net/data/country-resource-list/data.json?resource=IR&v4_format=prefix"
UTC = dt.timezone.utc
MAX_SOURCE_AGE = dt.timedelta(days=7)
DENIED = tuple(ipaddress.ip_network(s) for s in (
    "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8",
    "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24",
    "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/3",
))


class InvalidFeed(ValueError):
    pass


def iso_time(value: str) -> dt.datetime:
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


def jalali(value: dt.datetime, with_time: bool = False) -> str:
    """Use ICU's Persian calendar, including its leap-year rules, not a 33-year approximation."""
    js = """const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB-u-ca-persian-nu-latn',
      {timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit',
       hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(process.argv[1]))
       .map(x=>[x.type,x.value])); console.log(JSON.stringify(p));"""
    parts = json.loads(subprocess.check_output(["node", "-e", js, value.isoformat()], text=True))
    date = f"{parts['year']}/{parts['month']}/{parts['day']}"
    return date + (f" {parts['hour']}:{parts['minute']}" if with_time else "")


def normalize(values: list[str]) -> list[ipaddress.IPv4Network]:
    if not isinstance(values, list) or not values:
        raise InvalidFeed("RIPE IPv4 list is missing or empty")
    networks = []
    for value in values:
        if not isinstance(value, str) or not re.fullmatch(r"[0-9.]+/[0-9]{1,2}", value):
            raise InvalidFeed(f"Non-CIDR input: {value!r}")
        try:
            network = ipaddress.IPv4Network(value, strict=True)
        except ValueError as exc:
            raise InvalidFeed(str(exc)) from exc
        if network.prefixlen < 8 or any(network.overlaps(bad) for bad in DENIED):
            raise InvalidFeed(f"Non-public or overbroad prefix: {value}")
        if ipaddress.ip_address("1.1.2.7") in network:
            raise InvalidFeed("Metadata address is now in source data; choose a different marker")
        networks.append(network)
    return list(ipaddress.collapse_addresses(networks))


def coverage(networks) -> int:
    return sum(n.num_addresses for n in networks)


def overlap_size(left, right) -> int:
    i = j = total = 0
    while i < len(left) and j < len(right):
        a, b = left[i], right[j]
        lo = max(int(a.network_address), int(b.network_address))
        hi = min(int(a.broadcast_address), int(b.broadcast_address))
        total += max(0, hi - lo + 1)
        if a.broadcast_address <= b.broadcast_address:
            i += 1
        else:
            j += 1
    return total


def validate(response: dict, now: dt.datetime, previous: dict | None = None,
             previous_networks=None, accept_large_change=False):
    if response.get("status") != "ok" or response.get("status_code") != 200:
        raise InvalidFeed("RIPE did not return an OK response")
    if response.get("data_call_name") != "country-resource-list":
        raise InvalidFeed("Unexpected RIPE endpoint")
    data = response.get("data", {})
    source_time = iso_time(data["query_time"])
    if now - source_time > MAX_SOURCE_AGE or source_time - now > dt.timedelta(hours=24):
        raise InvalidFeed("RIPE snapshot is too old or in the future")
    networks = normalize(data.get("resources", {}).get("ipv4"))
    size = coverage(networks)
    if not (500 <= len(networks) <= 10000 and 5_000_000 <= size <= 30_000_000):
        raise InvalidFeed(f"Unexpected Iran dataset size: {len(networks)} prefixes / {size} addresses")
    if previous:
        if source_time < iso_time(previous["source_snapshot_utc"]):
            raise InvalidFeed("RIPE snapshot regressed")
        if now < iso_time(previous["published_at_utc"]):
            raise InvalidFeed("Publication clock regressed")
    if previous_networks and not accept_large_change:
        shared = overlap_size(networks, previous_networks)
        old_size = coverage(previous_networks)
        removed = (old_size - shared) / old_size
        added = (size - shared) / old_size
        count_change = abs(len(networks) - len(previous_networks)) / len(previous_networks)
        if max(removed, added) > .10 or count_change > .25:
            raise InvalidFeed(f"Large change requires review: removed={removed:.1%}, added={added:.1%}, count={count_change:.1%}")
    return networks, source_time


def download() -> dict:
    for attempt in range(3):
        try:
            request = urllib.request.Request(SOURCE, headers={"User-Agent": "EMS-IR-IP/1.0 (github.com/emsebi/EMS_IPAM)"})
            with urllib.request.urlopen(request, timeout=45) as response:
                if response.status != 200:
                    raise InvalidFeed(f"HTTP status {response.status}")
                payload = response.read(4_000_001)
            if len(payload) > 4_000_000:
                raise InvalidFeed("RIPE response too large")
            return json.loads(payload)
        except Exception:
            if attempt == 2:
                raise
            time.sleep(3 * (attempt + 1))
    raise AssertionError("unreachable")


def render_feed(networks, source_time, published, major: int):
    values = [str(n) for n in networks]
    plain = "\n".join(values) + "\n"
    digest = hashlib.sha256(plain.encode()).hexdigest()
    generation = int(published.timestamp())
    source_jalali = jalali(source_time)
    build_jalali = jalali(published, True)
    metadata = (f"EMS:IR:META|{generation}|RIPE={source_jalali}|"
                f"Updated={build_jalali} Tehran|IPv4={len(values)}|SHA={digest[:16]}")
    replacements = {
        "MAJOR": str(major), "SOURCE_ISO": source_time.isoformat(),
        "SOURCE_JALALI": source_jalali, "BUILD_JALALI": build_jalali,
        "HASH": digest, "METADATA": metadata, "GENERATION": str(generation),
        "COUNT": str(len(values)),
        "NOT_BEFORE": (published - dt.timedelta(days=1)).strftime("%Y%m%d"),
        "NOT_AFTER": min(published + dt.timedelta(days=7), source_time + MAX_SOURCE_AGE).strftime("%Y%m%d"),
        "PREFIXES": ";\n".join(f'"{value}"' for value in values),
    }
    output = (HERE / "templates/feed.rsc").read_text()
    for key, value in replacements.items():
        output = output.replace("@" + key + "@", value)
    if re.search(r"@[A-Z_]+@", output):
        raise InvalidFeed("Unexpanded template token")
    output.encode("ascii")  # RouterOS 6 does not need Persian font/encoding support.
    return output, plain, digest, metadata


def ros_string(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"').replace("$", "\\$").replace("\r", "").replace("\n", "\\n") + '"'


def render_installer(pem: str) -> str:
    subject = subprocess.check_output(["openssl", "x509", "-noout", "-subject", "-nameopt", "RFC2253"], input=pem, text=True).strip()
    cn = re.search(r"(?:^subject=|,)CN=([^,]+)", subject)
    if not cn:
        raise InvalidFeed("CA certificate has no common name")
    common_name = cn.group(1)
    if len(pem.encode()) > 3900:
        raise InvalidFeed("CA is too large for RouterOS 6 file contents")
    updater = (HERE / "templates/updater.rsc").read_text()
    return """# Import once. Installs a public CA and an updater, but no firewall/scheduler rules.
{
    :local caName @CA_NAME@;
    :local pem @PEM@;
    :if ([:len [/certificate find where common-name=$caName]] = 0) do={
        /file print file="EMS-IR-GitHub-CA";
        :delay 1s;
        /file set [find where name="EMS-IR-GitHub-CA.txt"] contents=$pem;
        /certificate import file-name="EMS-IR-GitHub-CA.txt" passphrase="";
        /file remove [find where name="EMS-IR-GitHub-CA.txt"];
    }
    :local certificates [/certificate find where common-name=$caName];
    :if ([:len $certificates] = 0) do={ :error "EMS IR: CA import failed"; }
    /certificate set $certificates trusted=yes;
    :local scriptId [/system script find where name="IR-IP_EMS-update"];
    :if ([:len $scriptId] = 0) do={
        /system script add name="IR-IP_EMS-update" policy=read,write,test,ftp source=@UPDATER@;
    } else={
        /system script set $scriptId policy=read,write,test,ftp source=@UPDATER@;
    }
    :put "EMS IR updater installed. Run: /system script run IR-IP_EMS-update";
}
""".replace("@CA_NAME@", ros_string(common_name)).replace("@PEM@", ros_string(pem)).replace("@UPDATER@", ros_string(updater))


def atomic_write(path: Path, content: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as f:
        f.write(content)
        temp = f.name
    os.replace(temp, path)


def build(response, now, output: Path, accept_large_change=False, require_ca=False):
    manifest_path = output / "manifest.json"
    previous = json.loads(manifest_path.read_text()) if manifest_path.exists() else None
    previous_networks = normalize((output / "IR-IP_EMS.txt").read_text().splitlines()) if previous else None
    networks, source_time = validate(response, now, previous, previous_networks, accept_large_change)
    files = {}
    details = {}
    for major in (6, 7):
        rsc, plain, digest, metadata = render_feed(networks, source_time, now, major)
        name = f"IR-IP_EMS-v{major}.rsc"
        payload = rsc.encode()
        files[name] = payload
        files[f"IR-IP_EMS-v{major}.bytes"] = str(len(payload)).encode()
        details[name] = {"bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest()}
    files["IR-IP_EMS.txt"] = plain.encode()
    files["update.rsc"] = (HERE / "templates/updater.rsc").read_bytes()
    ca = HERE / "github-root.pem"
    if ca.exists():
        files["install-update.rsc"] = render_installer(ca.read_text()).encode()
    elif require_ca:
        raise InvalidFeed("Missing GitHub public CA certificate")
    manifest = {
        "schema": 1, "list": "IR-IP_EMS", "family": "IPv4", "source": SOURCE,
        "source_snapshot_utc": source_time.isoformat(), "source_snapshot_jalali": jalali(source_time),
        "published_at_utc": now.isoformat(), "published_at_jalali_tehran": jalali(now, True),
        "generation": int(now.timestamp()), "prefix_count": len(networks),
        "address_count": coverage(networks), "content_sha256": digest,
        "metadata_comment": metadata, "files": details,
    }
    files["manifest.json"] = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode()
    # All validation/rendering completes before any output is replaced. Git commit publishes all together.
    for name, payload in files.items():
        atomic_write(output / name, payload)
    return manifest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output", type=Path, default=ROOT / "feeds/iran")
    parser.add_argument("--accept-large-change", action="store_true")
    parser.add_argument("--require-ca", action="store_true")
    args = parser.parse_args()
    response = json.loads(args.input.read_text()) if args.input else download()
    result = build(response, dt.datetime.now(UTC).replace(microsecond=0), args.output,
                   args.accept_large_change, args.require_ca)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
