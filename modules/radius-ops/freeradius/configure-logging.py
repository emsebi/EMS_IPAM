#!/usr/bin/env python3
"""Apply the small EMS-IPAM logging overlay to stock FreeRADIUS 3.x config."""
import pathlib
import re
import sys

META = (
    " EMSMETA src=%{Packet-Src-IP-Address};nasip=%{NAS-IP-Address};"
    "nasid=%{NAS-Identifier};calling=%{Calling-Station-Id};"
    "called=%{Called-Station-Id};framed=%{Framed-IP-Address};"
    "method=%{control:Auth-Type}"
)

def configure_text(text: str) -> str:
    def sub_once(pattern, replacement, label):
        nonlocal text
        text, count = re.subn(pattern, replacement, text, count=1, flags=re.MULTILINE)
        if count != 1:
            raise RuntimeError(f"FreeRADIUS logging setting not found: {label}")

    sub_once(r"^(\s*)auth\s*=\s*no\s*$",
             lambda m: f"{m.group(1)}auth = yes", "auth")
    sub_once(r"^(\s*)auth_badpass\s*=\s*no\s*$",
             lambda m: f"{m.group(1)}auth_badpass = yes", "auth_badpass")
    sub_once(r"^(\s*)auth_goodpass\s*=\s*no\s*$",
             lambda m: f"{m.group(1)}auth_goodpass = yes", "auth_goodpass")
    sub_once(r'^(\s*)#?\s*msg_badpass\s*=\s*""\s*$',
             lambda m: f'{m.group(1)}msg_badpass = "{META}"', "msg_badpass")
    sub_once(r'^(\s*)#?\s*msg_goodpass\s*=\s*""\s*$',
             lambda m: f'{m.group(1)}msg_goodpass = "{META}"', "msg_goodpass")

    required = (
        r"^\s*auth\s*=\s*yes\s*$",
        r"^\s*auth_badpass\s*=\s*yes\s*$",
        r"^\s*auth_goodpass\s*=\s*yes\s*$",
        r'^\s*msg_badpass\s*=\s*" EMSMETA src=%\{Packet-Src-IP-Address\}',
        r'^\s*msg_goodpass\s*=\s*" EMSMETA src=%\{Packet-Src-IP-Address\}',
    )
    for pattern in required:
        if not re.search(pattern, text, flags=re.MULTILINE):
            raise RuntimeError(f"FreeRADIUS logging verification failed: {pattern}")
    return text

def main():
    path = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "/etc/freeradius/3.0/radiusd.conf")
    original = path.read_text(encoding="utf-8")
    configured = configure_text(original)
    path.write_text(configured, encoding="utf-8")

if __name__ == "__main__":
    main()
