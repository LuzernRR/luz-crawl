#!/usr/bin/env python3
"""Plan or hardlink byte-identical images while preserving every path."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import uuid
from collections import defaultdict
from datetime import datetime
from pathlib import Path

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
BACKUP_MARKERS = ("对比", "备份", "旧版", "copy", "backup", "duplicate")


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def within(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def canonical_key(path: Path, root: Path) -> tuple:
    parts = path.relative_to(root).parts
    backup = any(marker in part.casefold() for part in parts for marker in BACKUP_MARKERS)
    return backup, len(parts), str(path).casefold()


def build_plan(raw_root: Path) -> dict:
    raw_root = raw_root.resolve()
    if raw_root.name.lower() != "raw" or not raw_root.is_dir():
        raise ValueError("Pass an existing raw directory, not an output folder.")
    groups: dict[tuple[int, str], list[Path]] = defaultdict(list)
    for path in raw_root.rglob("*"):
        if path.is_file() and not path.is_symlink() and path.suffix.lower() in IMAGE_SUFFIXES and within(path, raw_root):
            groups[(path.stat().st_size, digest(path))].append(path)
    duplicates = []
    for (size, sha256), paths in groups.items():
        if len(paths) < 2:
            continue
        paths.sort(key=lambda path: canonical_key(path, raw_root))
        canonical = paths[0]
        duplicates.extend({"canonical": str(canonical), "alias": str(alias), "bytes": size, "sha256": sha256} for alias in paths[1:])
    return {
        "schema_version": 1,
        "raw_root": str(raw_root),
        "created_at": datetime.now().astimezone().isoformat(),
        "duplicate_files": len(duplicates),
        "reclaimable_bytes": sum(item["bytes"] for item in duplicates),
        "links": duplicates,
    }


def apply_plan(plan: dict) -> dict:
    raw_root = Path(plan["raw_root"]).resolve()
    if raw_root.name.lower() != "raw" or not raw_root.is_dir():
        raise ValueError("The planned raw directory no longer exists.")
    result = {"schema_version": 1, "raw_root": str(raw_root), "applied_at": datetime.now().astimezone().isoformat(), "links": [], "errors": [], "reclaimed_bytes_estimate": 0}
    for item in plan["links"]:
        canonical = Path(item["canonical"]).resolve()
        alias = Path(item["alias"]).resolve()
        if not within(canonical, raw_root) or not within(alias, raw_root) or canonical == alias:
            raise ValueError(f"Plan path escapes raw directory: {item}")
        if not canonical.is_file() or not alias.is_file() or canonical.is_symlink() or alias.is_symlink():
            raise ValueError(f"Image missing or is a symlink: {alias}")
        if any(path.stat().st_size != item["bytes"] or digest(path) != item["sha256"] for path in (canonical, alias)):
            raise ValueError(f"Image changed since planning: {alias}")
        if os.path.samefile(canonical, alias):
            result["links"].append({**item, "already_linked": True})
            continue
        temporary = alias.parent / f".luz-hardlink-{uuid.uuid4().hex}.tmp"
        try:
            os.link(canonical, temporary)
            if digest(temporary) != item["sha256"]:
                raise ValueError(f"Hardlink verification failed: {temporary}")
            os.replace(temporary, alias)
            if not os.path.samefile(canonical, alias):
                raise OSError(f"Filesystem did not preserve the hardlink: {alias}")
            result["links"].append(item)
            result["reclaimed_bytes_estimate"] += item["bytes"]
        except Exception as error:
            temporary.unlink(missing_ok=True)
            result["errors"].append({"alias": str(alias), "error": str(error)})
    return result


def write_json(path: Path, value: dict) -> None:
    temporary = path.with_name(f"{path.name}.{uuid.uuid4().hex}.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("raw_root", type=Path)
    parser.add_argument("--plan-file", type=Path, help="Defaults beside raw/.")
    parser.add_argument("--apply", action="store_true", help="Apply the saved plan after reviewing it.")
    args = parser.parse_args()
    raw_root = args.raw_root.resolve()
    plan_file = (args.plan_file or raw_root.parent / "raw-image-dedupe-plan.json").resolve()
    if args.apply:
        plan = json.loads(plan_file.read_text(encoding="utf-8-sig"))
        if Path(plan.get("raw_root", "")).resolve() != raw_root:
            raise ValueError("Plan raw root does not match the requested raw root.")
        result = apply_plan(plan)
        record_file = raw_root.parent / f"raw-image-dedupe-record-{datetime.now():%Y%m%d-%H%M%S}.json"
        write_json(record_file, result)
        result["record_file"] = str(record_file)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        if result["errors"]:
            raise SystemExit(1)
    else:
        plan = build_plan(raw_root)
        write_json(plan_file, plan)
        plan["plan_file"] = str(plan_file)
        print(json.dumps(plan, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
