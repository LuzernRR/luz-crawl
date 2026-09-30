#!/usr/bin/env python3
"""Validate strict title/link/images/prompt Markdown collections."""

from __future__ import annotations

import argparse
import re
from pathlib import Path

from luz_crawl_protocol import detect_image_type, parse_strict_prompt_document


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("folder", help="Luz-crawl result folder")
    parser.add_argument("--require-images", action="store_true")
    parser.add_argument("--expected-height", type=int, default=220)
    args = parser.parse_args()

    folder = Path(args.folder)
    errors: list[str] = []
    if not folder.is_dir():
        print(f"ERROR: not a folder: {folder}")
        return 1

    md_files = sorted(folder.glob("*.md"))
    if len(md_files) != 1:
        print(f"ERROR: expected exactly one md file, found {len(md_files)}")
        return 1

    md_path = md_files[0]
    text = md_path.read_text(encoding="utf-8")
    images_dir = folder / "images"

    try:
        parsed = parse_strict_prompt_document(text)
    except ValueError as exc:
        errors.append(str(exc))
        parsed = None

    if parsed is None or not parsed.items:
        errors.append("no strict prompt items found")

    referenced_images: set[str] = set()
    for expected_index, item in enumerate(parsed.items if parsed else [], start=1):
        index = item.index
        title = item.title
        link = item.link
        prompt = item.prompt

        if index != expected_index:
            errors.append(f"item index {index} should be {expected_index}")
        if not title:
            errors.append(f"item {index}: empty title")
        if not re.match(r"https://(x|twitter)\.com/[^/]+/status/\d+", link):
            errors.append(f"item {index}: link is not an X status URL: {link}")
        if not prompt:
            errors.append(f"item {index}: empty prompt")

        if args.require_images and not item.images:
            errors.append(f"item {index}: missing images")
        heights = set(item.image_heights)
        if heights and heights != {args.expected_height}:
            errors.append(
                f"item {index}: image heights {sorted(heights)} should all be {args.expected_height}"
            )
        for image in item.images:
            referenced_images.add(image)
            image_path = images_dir / image
            if not image_path.is_file():
                errors.append(f"item {index}: missing image file {image}")
            elif image_path.stat().st_size <= 0:
                errors.append(f"item {index}: empty image file {image}")
            elif detect_image_type(image_path) is None:
                errors.append(f"item {index}: file is not a recognized image {image}")

    if images_dir.is_dir():
        image_files = {
            p.name
            for p in images_dir.iterdir()
            if p.is_file() and p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}
        }
        orphan_images = sorted(image_files - referenced_images)
        if orphan_images:
            errors.append(f"images folder contains files not embedded in md: {', '.join(orphan_images)}")

    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1

    print(f"OK: {folder}")
    print(f"md: {md_path.name}")
    print(f"items: {len(parsed.items) if parsed else 0}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
