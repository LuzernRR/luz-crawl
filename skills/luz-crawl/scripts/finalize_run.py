#!/usr/bin/env python3
"""Deposit a Luz Crawl run into persistent, idempotent experience state."""

from __future__ import annotations

import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path

from experience_store import record_event
from luz_crawl_protocol import resolve_experience_root


def stable_event_id(identity: dict) -> str:
    payload = json.dumps(identity, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return "run-" + hashlib.sha256(payload.encode("utf-8")).hexdigest()[:20]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("folder", nargs="?", help="Saved dossier folder; omit for chat-only research")
    parser.add_argument("--run-label", help="Required when no dossier folder is present")
    parser.add_argument("--run-id", help="Stable caller-provided idempotency key")
    parser.add_argument("--experience-root", help="Override persistent experience root")
    parser.add_argument("--summary", required=True, help="One-line useful summary")
    parser.add_argument("--domain", default="not recorded")
    parser.add_argument("--worked-query", action="append", default=[])
    parser.add_argument("--weak-query", action="append", default=[])
    parser.add_argument("--lesson", action="append", default=[])
    parser.add_argument("--source", action="append", default=[])
    parser.add_argument("--next-query", action="append", default=[])
    parser.add_argument("--channel", action="append", default=[])
    parser.add_argument("--tool", action="append", default=[])
    parser.add_argument("--tool-problem", action="append", default=[])
    parser.add_argument("--tool-fix", action="append", default=[])
    parser.add_argument("--image-note", action="append", default=[])
    args = parser.parse_args()

    folder: Path | None = None
    if args.folder:
        folder = Path(args.folder).resolve()
        if not folder.is_dir():
            print(f"ERROR: not a folder: {folder}")
            return 1
        md_files = sorted(folder.glob("*.md"))
        if len(md_files) != 1:
            print(f"ERROR: expected exactly one md file, found {len(md_files)}")
            return 1
    elif not args.run_label:
        print("ERROR: --run-label is required for chat-only research")
        return 1

    label = args.run_label or (folder.name if folder else "research run")
    event = {
        "label": label,
        "dossier": str(folder) if folder else "",
        "raw_evidence": str(folder / "raw") if folder else "",
        "summary": args.summary,
        "domain": args.domain,
        "worked_queries": args.worked_query,
        "weak_queries": args.weak_query,
        "lessons": args.lesson,
        "sources": args.source,
        "next_queries": args.next_query,
        "channels": args.channel,
        "tools": args.tool,
        "tool_problems": args.tool_problem,
        "tool_fixes": args.tool_fix,
        "image_notes": args.image_note,
    }
    identity = {"date": datetime.now().strftime("%Y-%m-%d"), **event}
    event_id = args.run_id or stable_event_id(identity)
    event["event_id"] = event_id
    experience_root = resolve_experience_root(args.experience_root)
    try:
        recorded = record_event(event, experience_root)
    except (OSError, TimeoutError, ValueError) as exc:
        print(f"ERROR: {exc}")
        return 1
    print(f"event_id={event_id}")
    print(f"recorded={'true' if recorded else 'false'}")
    print(f"experience_root={experience_root}")
    print(f"events={experience_root / 'events.jsonl'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
