#!/usr/bin/env python3
"""Create a numbered luz-crawl output folder and Markdown file directly under root."""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

from luz_crawl_protocol import DEFAULT_ROOT


def safe_title(title: str) -> str:
    title = title.strip().replace(" ", "_")
    title = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "_", title)
    title = re.sub(r"_+", "_", title).strip("._")
    if not title:
        raise ValueError("title becomes empty after sanitization")
    return title


def next_index(root: Path) -> int:
    max_index = 0
    if root.exists():
        for child in root.iterdir():
            if not child.is_dir():
                continue
            match = re.match(r"^(\d{3})_", child.name)
            if match:
                max_index = max(max_index, int(match.group(1)))
    return max_index + 1

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Create a NNN_清晰主题 dossier directly under the luz-crawl root.",
    )
    parser.add_argument("title", help="Dossier title without numeric prefix, e.g. 公众号_垂直选题库")
    parser.add_argument(
        "--module",
        default="",
        help="Deprecated compatibility field. Output is always created directly under root.",
    )
    parser.add_argument(
        "--section",
        help=(
            "Deprecated compatibility field. Ignored; output is always created directly under root."
        ),
    )
    parser.add_argument(
        "--domain",
        help=(
            "Deprecated compatibility field. Prefer including the domain in the clear title."
        ),
    )
    parser.add_argument("--root", default=str(DEFAULT_ROOT))
    parser.add_argument("--with-images", action="store_true", help="Create raw/images under raw.")
    parser.add_argument("--with-raw", action="store_true", help="Deprecated compatibility flag; raw is always created.")
    parser.add_argument("--platform", default="")
    parser.add_argument("--source", action="append", default=[], help="Source URL; can repeat")
    parser.add_argument("--tool", action="append", default=[], help="Tool name; can repeat")
    parser.add_argument("--index", type=int, help="Override numeric index inside the module")
    args = parser.parse_args()

    output_root = Path(args.root)
    output_root.mkdir(parents=True, exist_ok=True)

    index = args.index if args.index is not None else next_index(output_root)
    folder_name = f"{index:03d}_{safe_title(args.title)}"
    folder = output_root / folder_name
    folder.mkdir(parents=False, exist_ok=False)

    md_path = folder / f"{folder_name}.md"
    md_path.write_text(f"# {folder_name}\n", encoding="utf-8")

    raw_dir = folder / "raw"
    raw_dir.mkdir()
    images_dir = None
    if args.with_images:
        images_dir = raw_dir / "images"
        images_dir.mkdir()

    manifest_path = raw_dir / "manifest.json"
    manifest = {
        "folder": folder_name,
        "module": args.module or "",
        "section": args.section or "",
        "domain": args.domain or "",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "platform": args.platform,
        "title": args.title,
        "tools": args.tool,
        "sources": args.source,
        "notes": [],
    }
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"root={output_root}")
    print(f"folder={folder}")
    print(f"md={md_path}")
    print(f"raw={raw_dir}")
    if images_dir:
        print(f"images={images_dir}")
    print(f"manifest={manifest_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
