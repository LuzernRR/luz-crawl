#!/usr/bin/env python3
"""Render prompt-image collection items into the strict Markdown layout."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from luz_crawl_protocol import render_strict_prompt_document


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--items", required=True, help="JSON file with title/link/images/prompt items")
    parser.add_argument("--out", required=True, help="Markdown output path")
    parser.add_argument("--heading", help="Optional document H1")
    parser.add_argument("--image-height", type=int, default=220)
    args = parser.parse_args()

    items_path = Path(args.items)
    out_path = Path(args.out)
    data = json.loads(items_path.read_text(encoding="utf-8-sig"))
    items = data["items"] if isinstance(data, dict) else data

    heading = args.heading
    if not heading and isinstance(data, dict):
        heading = data.get("heading")
    markdown = render_strict_prompt_document(items, heading=heading, image_height=args.image_height)
    out_path.write_text(markdown, encoding="utf-8")
    print(f"md={out_path}")
    print(f"items={len(items)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
