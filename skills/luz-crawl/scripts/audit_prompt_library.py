#!/usr/bin/env python3
"""Audit the prompt library produced by luz-crawl Prompt Library Mode."""

from __future__ import annotations

import argparse
import os
import json
import re
from pathlib import Path

from luz_crawl_protocol import detect_image_type


DEFAULT_ROOT = Path(os.environ.get("LUZ_PROMPT_LIBRARY_ROOT", str(Path.home() / "Documents" / "prompt-collect-skills"))).expanduser()
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}


def load_registry(root: Path) -> dict:
    registry_path = root / "00记录" / "prompt_collection_registry.json"
    if not registry_path.is_file():
        raise FileNotFoundError(f"missing registry: {registry_path}")
    data = json.loads(registry_path.read_text(encoding="utf-8-sig"))
    if not isinstance(data, dict):
        raise ValueError("registry must be a JSON object")
    data.setdefault("sources", {})
    data.setdefault("prompt_hash_index", {})
    data.setdefault("image_url_index", {})
    return data


def md_has_chinese_prompt_with_ratio(text: str, source: str) -> bool:
    source_pos = text.find(source)
    if source_pos < 0:
        return False
    tail = text[source_pos : source_pos + 8000]
    return bool(re.search(r"```text\n[\s\S]*?[\u4e00-\u9fff][\s\S]*?画幅比例[\s\S]*?\n```", tail))


def doc_paths_for_record(record: dict) -> list[Path]:
    paths: list[Path] = []
    if record.get("doc_path"):
        paths.append(Path(str(record["doc_path"])))
    for value in record.get("doc_paths") or []:
        if value:
            paths.append(Path(str(value)))
    for item in record.get("items") or []:
        if isinstance(item, dict) and item.get("doc_path"):
            paths.append(Path(str(item["doc_path"])))
    seen: set[str] = set()
    unique: list[Path] = []
    for path in paths:
        key = str(path)
        if key not in seen:
            unique.append(path)
            seen.add(key)
    return unique


def values_from_record_and_items(record: dict, key: str) -> list[str]:
    values: list[str] = []
    top_value = record.get(key)
    if isinstance(top_value, list):
        values.extend(str(value) for value in top_value if value)
    elif top_value:
        values.append(str(top_value))
    for item in record.get("items") or []:
        if not isinstance(item, dict):
            continue
        item_value = item.get(key)
        if isinstance(item_value, list):
            values.extend(str(value) for value in item_value if value)
        elif item_value:
            values.append(str(item_value))
    seen: set[str] = set()
    unique: list[str] = []
    for value in values:
        if value not in seen:
            unique.append(value)
            seen.add(value)
    return unique


def list_value(value: object) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value if item]
    if value:
        return [str(value)]
    return []


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--strict", action="store_true")
    parser.add_argument("--check-ready-limit", type=int, default=0, help="0 means all ready records")
    args = parser.parse_args()

    root = args.root
    errors: list[str] = []
    warnings: list[str] = []
    if not root.is_dir():
        print(f"ERROR: missing root: {root}")
        return 1

    for child in root.iterdir():
        if child.is_file():
            errors.append(f"loose file at library root: {child.name}")

    forbidden = root / "00二创"
    if forbidden.exists() and not forbidden.is_dir():
        errors.append("00二创 exists but is not a directory")

    try:
        registry = load_registry(root)
    except Exception as exc:
        print(f"ERROR: {exc}")
        return 1

    sources = registry.get("sources") or {}
    ready_records = [
        (source, record)
        for source, record in sources.items()
        if isinstance(record, dict) and record.get("status") == "ready"
    ]
    if args.check_ready_limit and args.check_ready_limit > 0:
        ready_records = ready_records[: args.check_ready_limit]

    checked_images = 0
    checked_records = 0
    for source, record in ready_records:
        checked_records += 1
        doc_paths = doc_paths_for_record(record)
        if not doc_paths:
            warnings.append(f"{source}: ready record has no doc_path/doc_paths; legacy registry entry not fully auditable")
            continue
        doc_path = next((path for path in doc_paths if path.is_file()), doc_paths[0])
        if not doc_path.is_file():
            errors.append(f"{source}: missing doc_path {doc_path}")
            continue
        try:
            doc_path.resolve().relative_to(root.resolve())
        except ValueError:
            errors.append(f"{source}: doc_path outside library root {doc_path}")
        if str(doc_path.resolve()).lower().startswith(str(forbidden.resolve()).lower()):
            errors.append(f"{source}: doc_path under 00二创")
        text = doc_path.read_text(encoding="utf-8")
        if source not in text:
            errors.append(f"{source}: source URL not found in doc")
        if not md_has_chinese_prompt_with_ratio(text, source):
            warnings.append(f"{source}: missing Chinese text prompt with aspect ratio near source block")
        current_shape = bool(record.get("doc_path") and record.get("local_images") and record.get("image_urls"))
        local_images = values_from_record_and_items(record, "local_images")
        top_image_urls = list_value(record.get("image_urls"))
        image_urls = top_image_urls or values_from_record_and_items(record, "image_urls")
        if not local_images:
            warnings.append(f"{source}: no local_images in registry; legacy entry cannot be image-byte audited from registry")
        if not image_urls:
            if local_images:
                errors.append(f"{source}: no image_urls in registry")
            else:
                warnings.append(f"{source}: no image_urls in registry; legacy entry cannot be source-media audited")
        if len(local_images) != len(image_urls):
            warnings.append(f"{source}: local_images count differs from image_urls count")
        for image_url in image_urls:
            if "pbs.twimg.com/media/" not in str(image_url) or "name=orig" not in str(image_url):
                if current_shape:
                    errors.append(f"{source}: non-original X image URL {image_url}")
                else:
                    warnings.append(f"{source}: legacy/non-X image reference not source-media audited: {image_url}")
        for rel in local_images:
            image_path = root / str(rel)
            if image_path.suffix.lower() not in IMAGE_SUFFIXES:
                errors.append(f"{source}: non-image suffix {rel}")
                continue
            if not image_path.is_file():
                errors.append(f"{source}: missing image {rel}")
                continue
            checked_images += 1
            if image_path.stat().st_size <= 0:
                errors.append(f"{source}: empty image {rel}")
            elif detect_image_type(image_path) is None:
                errors.append(f"{source}: unrecognized image bytes {rel}")
            if image_path.name not in text:
                errors.append(f"{source}: image not embedded in doc {rel}")

    # Check for orphan category images only in category folders, excluding 00二创 and archive dirs.
    for category_dir in root.iterdir():
        if not category_dir.is_dir() or category_dir.name in {"00二创", "00记录", "99历史临时文件"}:
            continue
        doc_path = category_dir / f"{category_dir.name}.md"
        images_dir = category_dir / "images"
        if not doc_path.is_file():
            warnings.append(f"{category_dir.name}: missing category md")
            continue
        text = doc_path.read_text(encoding="utf-8")
        if images_dir.is_dir():
            for image_path in images_dir.iterdir():
                if image_path.is_file() and image_path.suffix.lower() in IMAGE_SUFFIXES:
                    if image_path.name not in text:
                        warnings.append(f"{category_dir.name}: image not referenced by category md: {image_path.name}")

    for warning in warnings:
        print(f"WARNING: {warning}")
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        print(f"checked_ready_records={checked_records}")
        print(f"checked_images={checked_images}")
        return 1
    if args.strict and warnings:
        print(f"checked_ready_records={checked_records}")
        print(f"checked_images={checked_images}")
        return 1
    print(f"checked_ready_records={checked_records}")
    print(f"checked_images={checked_images}")
    print(f"warnings={len(warnings)}")
    print("OK: prompt library audit passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
