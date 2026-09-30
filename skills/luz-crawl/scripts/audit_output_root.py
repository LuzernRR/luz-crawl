#!/usr/bin/env python3
"""Audit the flat luz-crawl output root for structural drift."""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

from luz_crawl_protocol import DEFAULT_ROOT


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=str(DEFAULT_ROOT))
    parser.add_argument("--strict", action="store_true", help="Fail on warnings as well as errors")
    args = parser.parse_args()

    root = Path(args.root)
    if not root.is_dir():
        print(f"ERROR: not a directory: {root}")
        return 1

    warnings: list[str] = []
    errors: list[str] = []
    dossiers: list[Path] = []

    for child in sorted(root.iterdir(), key=lambda p: p.name):
        if child.is_dir() and re.match(r"^\d{3}_.+", child.name):
            dossiers.append(child)
        elif child.is_file() and child.name.upper() == "INDEX.MD":
            errors.append("output root must not contain INDEX.md; use skill experience/knowledge-index.md")
        else:
            kind = "folder" if child.is_dir() else "file"
            warnings.append(f"[ROOT] unexpected {kind}: {child.name}")

    validate_script = Path(__file__).with_name("validate_output.py")
    for folder in dossiers:
        cmd = [sys.executable, str(validate_script), str(folder), "--check-manifest"]
        result = subprocess.run(cmd, text=True, capture_output=True)
        if result.returncode != 0:
            errors.append(f"invalid dossier: {folder.name}\n{result.stdout}{result.stderr}".rstrip())

    for warning in warnings:
        print(f"WARNING: {warning}")
    for error in errors:
        print(f"ERROR: {error}")

    print(f"total_dossiers={len(dossiers)}")
    print(f"total_warnings={len(warnings)}")
    print(f"total_errors={len(errors)}")

    if errors:
        return 1
    if args.strict and warnings:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
