#!/usr/bin/env python3
"""Validate prompt library entries written by luz-crawl Prompt Library Mode."""

from __future__ import annotations

import argparse
import os
import json
import re
from pathlib import Path

from luz_crawl_protocol import detect_image_type


LIBRARY_ROOT = Path(os.environ.get("LUZ_PROMPT_LIBRARY_ROOT", str(Path.home() / "Documents" / "prompt-collect-skills"))).expanduser()
FORBIDDEN_DIR = LIBRARY_ROOT / "00二创"
REGISTRY_PATH = LIBRARY_ROOT / "00记录" / "prompt_collection_registry.json"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sources", nargs="+", required=True, help="Normalized X status URLs to validate")
    parser.add_argument("--registry", default=str(REGISTRY_PATH))
    args = parser.parse_args()

    errors: list[str] = []
    registry_path = Path(args.registry)
    registry = json.loads(registry_path.read_text(encoding="utf-8-sig"))
    sources = registry.get("sources") or {}
    before_forbidden = list(FORBIDDEN_DIR.rglob("*")) if FORBIDDEN_DIR.exists() else []

    for source in args.sources:
        record = sources.get(source)
        if not isinstance(record, dict):
            errors.append(f"missing registry source: {source}")
            continue
        if record.get("status") != "ready":
            errors.append(f"source not ready: {source}")
        doc_path = Path(str(record.get("doc_path") or ""))
        if not doc_path.is_file():
            errors.append(f"missing doc path: {doc_path}")
            continue
        if str(doc_path.resolve()).lower().startswith(str(FORBIDDEN_DIR.resolve()).lower()):
            errors.append(f"doc path under 00二创: {doc_path}")
        text = doc_path.read_text(encoding="utf-8")
        if source not in text:
            errors.append(f"source URL not present in doc: {source}")
        if not re.search(r"```text\n[\s\S]*?[\u4e00-\u9fff][\s\S]*?画幅比例[\s\S]*?\n```", text):
            errors.append(f"no Chinese prompt with aspect ratio in doc: {doc_path}")
        for rel in record.get("local_images") or []:
            image_path = LIBRARY_ROOT / rel
            if not image_path.is_file():
                errors.append(f"missing local image: {rel}")
            elif image_path.stat().st_size <= 0:
                errors.append(f"empty local image: {rel}")
            elif detect_image_type(image_path) is None:
                errors.append(f"unrecognized local image bytes: {rel}")
            if image_path.name not in text:
                errors.append(f"image not embedded in doc: {rel}")
        for image_url in record.get("image_urls") or []:
            if "pbs.twimg.com/media/" not in image_url or "name=orig" not in image_url:
                errors.append(f"image URL is not original X media: {image_url}")

    after_forbidden = list(FORBIDDEN_DIR.rglob("*")) if FORBIDDEN_DIR.exists() else []
    if len(after_forbidden) != len(before_forbidden):
        errors.append("00二创 file count changed during validation")

    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1
    print("OK: prompt library sources validated")
    for source in args.sources:
        print(source)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
