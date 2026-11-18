#!/usr/bin/env python3
"""Check or refresh the explicit file list in the repository SHA256SUMS.

This checks listed files, not completeness of a release archive. Add new paths
explicitly; never discover local files, credentials or node_modules implicitly.
"""
import argparse
import hashlib
import os
from pathlib import Path, PurePosixPath
import re
import sys
import tempfile


def refresh(manifest, write=False):
    manifest = manifest.resolve()
    root = manifest.parent
    records = {}
    for line in manifest.read_text(encoding="utf-8").splitlines():
        match = re.fullmatch(r"([0-9a-f]{64})  (.+)", line)
        if not match:
            raise ValueError("Invalid SHA256SUMS entry")
        expected, name = match.groups()
        path = PurePosixPath(name)
        if (path.is_absolute() or ".." in path.parts or "\\" in name
                or path.as_posix() != name or name in records):
            raise ValueError(f"Invalid or duplicate path: {name}")
        target = (root / name).resolve()
        if not target.is_relative_to(root) or target == manifest:
            raise ValueError(f"Path outside root or self-reference: {name}")
        with target.open("rb") as source:
            actual = hashlib.file_digest(source, "sha256").hexdigest()
        records[name] = (expected, actual)
    if not records:
        raise ValueError("Empty SHA256SUMS")
    changed = [name for name, (expected, actual) in records.items() if expected != actual]
    if write:
        # Validate/read every file before replacing the manifest, so a missing
        # input cannot leave a partially refreshed checksum list.
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=root,
                                             delete=False) as output:
                temporary = Path(output.name)
                for name in sorted(records):
                    output.write(f"{records[name][1]}  {name}\n")
            temporary.chmod(manifest.stat().st_mode & 0o777)
            os.replace(temporary, manifest)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    return changed, len(records)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--write", action="store_true")
    parser.add_argument("--manifest", type=Path,
                        default=Path(__file__).resolve().parents[1] / "SHA256SUMS")
    args = parser.parse_args()
    try:
        changed, count = refresh(args.manifest, args.write)
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1
    if changed and not args.write:
        print("Checksum mismatch:\n" + "\n".join(changed), file=sys.stderr)
        print("Review changes, then run python3 scripts/checksums.py --write", file=sys.stderr)
        return 1
    print(f"{'Refreshed' if args.write else 'Verified'} {count} listed files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
