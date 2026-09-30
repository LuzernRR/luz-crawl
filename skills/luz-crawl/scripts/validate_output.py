#!/usr/bin/env python3
"""Validate a flat luz-crawl output dossier."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from luz_crawl_protocol import detect_image_type


def visible_top_level_items(folder: Path) -> list[Path]:
    return [item for item in folder.iterdir() if not item.name.startswith(".")]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("folder")
    parser.add_argument(
        "--module",
        help="Deprecated compatibility flag. Ignored because outputs are flat.",
    )
    parser.add_argument("--require-images", action="store_true")
    parser.add_argument("--allow-empty-images-dir", action="store_true")
    parser.add_argument("--check-manifest", action="store_true")
    args = parser.parse_args()

    folder = Path(args.folder)
    if not folder.is_dir():
        print(f"ERROR: not a folder: {folder}")
        return 1

    errors: list[str] = []
    if not re.match(r"^\d{3}_.+", folder.name):
        errors.append("folder name must be NNN_清晰主题")

    md_files = sorted(folder.glob("*.md"))
    raw_dir = folder / "raw"
    images_dir = raw_dir / "images"
    if len(md_files) != 1:
        errors.append(f"expected exactly one md file, found {len(md_files)}")
    elif md_files[0].stem != folder.name:
        errors.append("md file name must exactly match folder name")

    if not raw_dir.is_dir():
        errors.append("missing raw folder")

    allowed_items = {raw_dir}
    if md_files:
        allowed_items.add(md_files[0])
    for item in visible_top_level_items(folder):
        if item not in allowed_items:
            kind = "folder" if item.is_dir() else "file"
            errors.append(f"unexpected top-level {kind}: {item.name}")

    image_files: list[Path] = []
    if images_dir.is_dir():
        image_files = [
            p
            for p in images_dir.iterdir()
            if p.is_file() and p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}
        ]
        if not image_files and not args.allow_empty_images_dir:
            errors.append("empty raw/images folder; omit it for text-only crawls")
        if args.require_images and not image_files:
            errors.append("expected at least one image file")
        for image_file in image_files:
            if image_file.stat().st_size <= 0:
                errors.append(f"empty image file: {image_file.name}")
            elif detect_image_type(image_file) is None:
                errors.append(f"unrecognized image bytes: {image_file.name}")
    elif args.require_images:
        errors.append("missing raw/images folder")

    if md_files:
        md_text = md_files[0].read_text(encoding="utf-8")
        if args.require_images and 'src="./raw/images/' not in md_text:
            errors.append("md does not embed local images from raw/images")
        image_refs = re.findall(r'<img\s+[^>]*src=["\']\./raw/images/([^"\']+)["\']', md_text)
        missing_refs = []
        for ref in image_refs:
            if not (images_dir / ref).is_file():
                missing_refs.append(ref)
        if missing_refs:
            errors.append(f"md references missing image files: {', '.join(missing_refs)}")
        if image_files and not image_refs:
            errors.append("raw/images folder has files but md does not embed local images")

    if args.check_manifest:
        manifest_path = raw_dir / "manifest.json"
        if not manifest_path.is_file():
            errors.append("missing raw/manifest.json")
        else:
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
            except json.JSONDecodeError as exc:
                errors.append(f"invalid raw/manifest.json: {exc}")
            else:
                for key in ["folder", "created_at", "platform", "title", "tools", "sources"]:
                    if key not in manifest:
                        errors.append(f"manifest missing key: {key}")
                if manifest.get("folder") != folder.name:
                    errors.append("manifest folder does not match output folder name")
                for media_item in manifest.get("media", []):
                    media_file = media_item.get("file") if isinstance(media_item, dict) else None
                    if media_file and not (images_dir / media_file).is_file():
                        errors.append(f"manifest references missing media file: {media_file}")
                    elif media_file and detect_image_type(images_dir / media_file) is None:
                        errors.append(f"manifest references non-image media file: {media_file}")

    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1

    print(f"OK: {folder}")
    print(f"md: {md_files[0].name if md_files else 'none'}")
    print(f"images: {len(image_files)}")
    if args.check_manifest:
        print("manifest: checked")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
