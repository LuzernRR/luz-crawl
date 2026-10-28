#!/usr/bin/env python3
"""Plan or safely remove re-creatable raw files after a verified delivery."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def within(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def listed_files(archive: Path, manifest: dict) -> dict[str, Path]:
    result = {}
    for item in manifest.get("files", []):
        relative = PurePosixPath(item.get("path", ""))
        if relative.is_absolute() or ".." in relative.parts or not relative.parts:
            raise ValueError(f"Unsafe manifest path in {archive}: {relative}")
        target = archive.joinpath(*relative.parts)
        if not within(target, archive) or not target.is_file() or sha256(target) != item.get("sha256"):
            raise ValueError(f"Manifest file missing or changed: {target}")
        result[relative.as_posix()] = target
    return result


def delivery_for(archive: Path, manifest: dict) -> Path | None:
    name = manifest.get("primary_file")
    expected = manifest.get("delivery", {}).get("sha256")
    if not name or Path(name).name != name or not expected:
        return None
    for parent in archive.parents:
        candidate = parent / name
        if within(candidate, archive / "raw"):
            continue
        if candidate.is_file() and sha256(candidate) == expected:
            return candidate
    return None


def nested_archive(manifest_path: Path) -> bool:
    return any((parent / "raw" / "manifest.json").is_file() for parent in manifest_path.parents[2:])


def build_plan(raw_root: Path, minimum_bytes: int = 256 * 1024, prune_content: bool = False) -> dict:
    raw_root = raw_root.resolve()
    if raw_root.name.lower() != "raw" or not raw_root.is_dir():
        raise ValueError("Pass an existing raw directory, not an output folder.")
    archives = []
    for manifest_path in raw_root.rglob("manifest.json"):
        if not within(manifest_path, raw_root):
            continue
        if nested_archive(manifest_path):
            continue
        archive = manifest_path.parent.parent
        try:
            manifest_bytes = manifest_path.read_bytes()
            manifest = json.loads(manifest_bytes)
            if manifest.get("output_layout") != "html_and_raw_v1" or manifest.get("status") != "captured":
                continue
            if not manifest.get("completeness", {}).get("target_present"):
                continue
            if not any(manifest.get(key) for key in ("resolved_url", "canonical_url", "requested_url")):
                continue
            files = listed_files(archive, manifest)
            if "raw/content.json" not in files:
                continue
            delivery = delivery_for(archive, manifest)
            if not delivery:
                continue
            candidates = []
            for name, target in files.items():
                normalized = name.lower()
                if not (normalized.startswith("raw/snapshots/") and target.suffix.lower() in {".json", ".html"} or normalized == "raw/page.png"):
                    continue
                size = target.stat().st_size
                if size >= minimum_bytes:
                    candidates.append({"path": name, "bytes": size, "sha256": sha256(target)})
            if prune_content and files["raw/content.json"].stat().st_size >= minimum_bytes:
                content = files["raw/content.json"]
                candidates.append({"path": "raw/content.json", "bytes": content.stat().st_size, "sha256": sha256(content)})
            if not candidates:
                continue
            archives.append({
                "archive": str(archive),
                "manifest": str(manifest_path),
                "manifest_sha256": hashlib.sha256(manifest_bytes).hexdigest(),
                "source": {
                    "requested_url": manifest.get("requested_url"),
                    "canonical_url": manifest.get("canonical_url"),
                    "resolved_url": manifest.get("resolved_url"),
                    "status": manifest.get("status"),
                    "captured_at": manifest.get("captured_at"),
                    "primary_file": manifest.get("primary_file"),
                    "delivery_sha256": manifest.get("delivery", {}).get("sha256"),
                },
                "delivery": str(delivery),
                "source_content": {"path": "raw/content.json", "sha256": sha256(files["raw/content.json"])},
                "files": sorted(candidates, key=lambda item: item["path"]),
            })
        except (OSError, ValueError, json.JSONDecodeError):
            continue
    return {
        "schema_version": 1,
        "raw_root": str(raw_root),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "minimum_bytes": minimum_bytes,
        "prune_content": prune_content,
        "archives": archives,
        "candidate_files": sum(len(item["files"]) for item in archives),
        "reclaimable_bytes": sum(file["bytes"] for item in archives for file in item["files"]),
    }


def write_json(path: Path, value: dict) -> None:
    temporary = path.with_name(f"{path.name}.{uuid.uuid4().hex}.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def apply_plan(plan: dict) -> dict:
    raw_root = Path(plan["raw_root"]).resolve()
    if raw_root.name.lower() != "raw" or not raw_root.is_dir():
        raise ValueError("The planned raw directory no longer exists.")
    record = {"schema_version": 1, "raw_root": str(raw_root), "applied_at": datetime.now(timezone.utc).isoformat(), "archives": [], "reclaimed_bytes": 0}
    for item in plan["archives"]:
        archive = Path(item["archive"]).resolve()
        manifest_path = Path(item["manifest"]).resolve()
        if not within(archive, raw_root) or not within(manifest_path, raw_root):
            raise ValueError(f"Plan path escapes raw directory: {archive}")
        manifest_bytes = manifest_path.read_bytes()
        if hashlib.sha256(manifest_bytes).hexdigest() != item["manifest_sha256"]:
            raise ValueError(f"Manifest changed since plan creation: {manifest_path}")
        manifest = json.loads(manifest_bytes)
        files = listed_files(archive, manifest)
        source_content = files.get("raw/content.json")
        if not source_content or sha256(source_content) != item["source_content"]["sha256"]:
            raise ValueError(f"Source content changed since plan creation: {archive}")
        if delivery_for(archive, manifest) != Path(item["delivery"]):
            raise ValueError(f"Verified delivery changed since plan creation: {archive}")
        candidates = item["files"]
        for candidate in candidates:
            target = files.get(candidate["path"])
            if not target or target.stat().st_size != candidate["bytes"] or sha256(target) != candidate["sha256"]:
                raise ValueError(f"Cleanup candidate changed since plan creation: {archive / candidate['path']}")

        transaction = raw_root.parent / f".raw-prune-{uuid.uuid4().hex}"
        staged = []
        manifest_temp = manifest_path.with_name(f"{manifest_path.name}.{uuid.uuid4().hex}.tmp")
        removed = {candidate["path"] for candidate in candidates}
        try:
            transaction.mkdir()
            for candidate in candidates:
                source = archive.joinpath(*PurePosixPath(candidate["path"]).parts)
                staged_path = transaction / f"{len(staged):06d}"
                os.replace(source, staged_path)
                staged.append((staged_path, source))
            manifest["files"] = [entry for entry in manifest["files"] if entry.get("path") not in removed]
            manifest.setdefault("pruned_files", []).extend({**candidate, "pruned_at": datetime.now(timezone.utc).isoformat()} for candidate in candidates)
            manifest["retention"] = {
                "level": "source_link_and_delivery" if "raw/content.json" in removed else "source_link_and_extracted_content",
                "revisit_url": item["source"].get("resolved_url") or item["source"].get("canonical_url") or item["source"].get("requested_url"),
                "delivery_verified": True,
                "content_retained": "raw/content.json" not in removed,
                "content_sha256": item["source_content"]["sha256"],
            }
            manifest_temp.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            os.replace(manifest_temp, manifest_path)
        except Exception:
            manifest_temp.unlink(missing_ok=True)
            for staged_path, source in reversed(staged):
                if staged_path.exists():
                    source.parent.mkdir(parents=True, exist_ok=True)
                    os.replace(staged_path, source)
            shutil.rmtree(transaction, ignore_errors=True)
            raise
        shutil.rmtree(transaction)
        reclaimed = sum(candidate["bytes"] for candidate in candidates)
        record["reclaimed_bytes"] += reclaimed
        record["archives"].append({"archive": str(archive), "source": item["source"], "files": candidates, "reclaimed_bytes": reclaimed})
    return record


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("raw_root", type=Path)
    parser.add_argument("--apply", action="store_true", help="Apply a previously written plan.")
    parser.add_argument("--plan-file", type=Path, help="Plan JSON path; defaults beside raw/.")
    parser.add_argument("--minimum-bytes", type=int, default=256 * 1024)
    parser.add_argument("--prune-content", action="store_true", help="Also remove raw/content.json when its captured delivery is verified; keep its hash and source URL in the manifest.")
    args = parser.parse_args()
    raw_root = args.raw_root.resolve()
    plan_file = (args.plan_file or raw_root.parent / "raw-cleanup-plan.json").resolve()
    if args.apply:
        plan = json.loads(plan_file.read_text(encoding="utf-8-sig"))
        if Path(plan.get("raw_root", "")).resolve() != raw_root:
            raise ValueError("Plan raw root does not match the requested raw root.")
        result = apply_plan(plan)
        record_file = raw_root.parent / f"raw-cleanup-record-{datetime.now():%Y%m%d-%H%M%S}.json"
        write_json(record_file, result)
        result["record_file"] = str(record_file)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        plan = build_plan(raw_root, args.minimum_bytes, args.prune_content)
        write_json(plan_file, plan)
        plan["plan_file"] = str(plan_file)
        print(json.dumps(plan, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
