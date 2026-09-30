#!/usr/bin/env python3
"""Persistent, queryable, and idempotent experience store for Luz Crawl."""

from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import time
from typing import Iterator

from luz_crawl_protocol import (
    BUNDLED_EXPERIENCE_ROOT,
    DEFAULT_EXPERIENCE_ROOT,
    EXPERIENCE_FILES,
    resolve_experience_root,
)


SCHEMA_VERSION = 1
EVENTS_FILE = "events.jsonl"
STATE_FILE = "state.json"
PROJECTION_FILES = (
    "knowledge-index.md",
    "search-keywords.md",
    "search-skill-library.md",
)
DEFAULT_TITLES = {
    "knowledge-index.md": "# Luz Crawl Knowledge Index\n",
    "search-keywords.md": "# Luz Crawl Search Keywords\n",
    "search-skill-library.md": "# Luz Crawl Search Skill Library\n",
    "knowledge-base-seeds.md": "# Luz Crawl Knowledge Base Seeds\n",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def atomic_write_bytes(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    with temporary.open("wb") as handle:
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def _inside(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def initialize_store(
    root: Path | str | None = None,
    seed_root: Path | str = BUNDLED_EXPERIENCE_ROOT,
) -> Path:
    state_root = resolve_experience_root(root)
    bundled_root = Path(seed_root).resolve()
    if _inside(state_root, bundled_root):
        raise ValueError("persistent experience root must not be inside the bundled plugin experience directory")

    state_root.mkdir(parents=True, exist_ok=True)
    seed_dir = state_root / "seed"
    seed_dir.mkdir(exist_ok=True)

    events_path = state_root / EVENTS_FILE
    if not events_path.exists():
        atomic_write_text(events_path, "")
    has_events = bool(events_path.read_text(encoding="utf-8").strip())

    for name in EXPERIENCE_FILES:
        seed_path = seed_dir / name
        bundled_path = bundled_root / name
        content = (
            bundled_path.read_bytes()
            if bundled_path.exists()
            else DEFAULT_TITLES[name].encode("utf-8")
        )
        if not seed_path.exists() or (
            not has_events and seed_path.read_bytes() != content
        ):
            atomic_write_bytes(seed_path, content)
        projection = state_root / name
        if not projection.exists() or not has_events:
            atomic_write_bytes(projection, seed_path.read_bytes())

    metadata_path = state_root / STATE_FILE
    if not metadata_path.exists():
        metadata = {
            "schema_version": SCHEMA_VERSION,
            "created_at": utc_now(),
            "storage": "persistent-user-state",
            "bundled_experience_is_seed_only": True,
        }
        atomic_write_text(metadata_path, json.dumps(metadata, ensure_ascii=False, indent=2) + "\n")
    return state_root


@contextmanager
def write_lock(root: Path, timeout_seconds: float = 10.0) -> Iterator[None]:
    lock_path = root / ".write.lock"
    deadline = time.monotonic() + timeout_seconds
    while True:
        try:
            descriptor = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                json.dump({"pid": os.getpid(), "created_at": utc_now()}, handle)
                handle.flush()
                os.fsync(handle.fileno())
            break
        except FileExistsError:
            try:
                stale = time.time() - lock_path.stat().st_mtime > 300
            except FileNotFoundError:
                continue
            if stale:
                stale_dir = root / "stale-locks"
                stale_dir.mkdir(exist_ok=True)
                archived = stale_dir / f"write-lock-{int(time.time())}-{os.getpid()}.json"
                try:
                    os.replace(lock_path, archived)
                except FileNotFoundError:
                    pass
                continue
            if time.monotonic() >= deadline:
                raise TimeoutError(f"experience store is locked: {lock_path}")
            time.sleep(0.1)
    try:
        yield
    finally:
        lock_path.unlink(missing_ok=True)


def load_events(root: Path | str | None = None) -> list[dict]:
    state_root = initialize_store(root)
    events: list[dict] = []
    seen_ids: set[str] = set()
    for line_number, line in enumerate(
        (state_root / EVENTS_FILE).read_text(encoding="utf-8").splitlines(), start=1
    ):
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"invalid event JSON at line {line_number}: {exc}") from exc
        if not isinstance(event, dict) or not event.get("event_id"):
            raise ValueError(f"invalid event at line {line_number}: missing event_id")
        event_id = str(event["event_id"])
        if event_id in seen_ids:
            raise ValueError(f"duplicate event_id at line {line_number}: {event_id}")
        seen_ids.add(event_id)
        events.append(event)
    return events


def _values(event: dict, key: str) -> list[str]:
    value = event.get(key, [])
    if isinstance(value, list):
        return [str(item) for item in value if str(item).strip()]
    return [str(value)] if str(value).strip() else []


def _joined(event: dict, key: str, empty: str = "not recorded") -> str:
    values = _values(event, key)
    return "; ".join(values) if values else empty


def _render_knowledge_event(event: dict) -> str:
    date = str(event.get("recorded_at", ""))[:10]
    label = str(event.get("label", "research run"))
    dossier = str(event.get("dossier", "")) or "chat-only"
    lines = [
        f"## {date} {label}",
        "",
        f"- Event ID: `{event['event_id']}`",
        f"- 输出路径：`{dossier}`",
        f"- 摘要：{event.get('summary', '')}",
    ]
    if _values(event, "lessons"):
        lines.append(f"- 可复用经验：{_joined(event, 'lessons')}")
    if _values(event, "next_queries"):
        lines.append(f"- 下次检索：{_joined(event, 'next_queries')}")
    if _values(event, "sources"):
        lines.append(f"- 关键来源：{_joined(event, 'sources')}")
    return "\n".join(lines) + "\n"


def _render_keyword_event(event: dict) -> str:
    date = str(event.get("recorded_at", ""))[:10]
    label = str(event.get("label", "research run"))
    dossier = str(event.get("dossier", "")) or "chat-only"
    return (
        f"## {date} {label}\n\n"
        f"- Event ID: `{event['event_id']}`\n"
        f"- Dossier: {dossier}\n"
        f"- Summary: {event.get('summary', '')}\n"
        f"- Channels: {_joined(event, 'channels')}\n"
        f"- Tools: {_joined(event, 'tools')}\n"
        f"- Worked queries: {_joined(event, 'worked_queries')}\n"
        f"- Weak queries: {_joined(event, 'weak_queries')}\n"
        f"- Useful lessons: {_joined(event, 'lessons')}\n"
        f"- Reliable sources: {_joined(event, 'sources')}\n"
        f"- Next queries: {_joined(event, 'next_queries')}\n"
    )


def _render_search_skill_event(event: dict) -> str:
    date = str(event.get("recorded_at", ""))[:10]
    label = str(event.get("label", "research run"))
    raw_evidence = str(event.get("raw_evidence", "")) or "chat-only"
    reusable = _values(event, "lessons") + _values(event, "next_queries")
    return (
        f"## {date} {label}\n\n"
        f"- Event ID: `{event['event_id']}`\n"
        f"- Intent: {event.get('summary', '')}\n"
        f"- Domain: {event.get('domain', 'not recorded')}\n"
        f"- Channel/platform: {_joined(event, 'channels')}\n"
        f"- Tool route: {_joined(event, 'tools')}\n"
        f"- Worked keywords: {_joined(event, 'worked_queries')}\n"
        f"- Weak/noisy keywords: {_joined(event, 'weak_queries')}\n"
        f"- Raw evidence saved: {raw_evidence}\n"
        f"- Image/media handling: {_joined(event, 'image_notes')}\n"
        f"- Tool problems: {_joined(event, 'tool_problems')}\n"
        f"- Fix/fallback: {_joined(event, 'tool_fixes')}\n"
        f"- Reusable next pattern: {'; '.join(reusable) if reusable else 'not recorded'}\n"
    )


def projection_content(state_root: Path, name: str, events: list[dict]) -> str:
    renderers = {
        "knowledge-index.md": _render_knowledge_event,
        "search-keywords.md": _render_keyword_event,
        "search-skill-library.md": _render_search_skill_event,
    }
    renderer = renderers[name]
    seed = (state_root / "seed" / name).read_text(encoding="utf-8").rstrip()
    additions = "\n\n".join(renderer(event).rstrip() for event in events)
    return seed + ("\n\n" + additions if additions else "") + "\n"


def rebuild_projections(root: Path | str | None = None, events: list[dict] | None = None) -> None:
    state_root = initialize_store(root)
    event_list = load_events(state_root) if events is None else events
    for name in PROJECTION_FILES:
        atomic_write_text(state_root / name, projection_content(state_root, name, event_list))


def record_event(event: dict, root: Path | str | None = None) -> bool:
    state_root = initialize_store(root)
    normalized = dict(event)
    normalized.setdefault("recorded_at", utc_now())
    if not normalized.get("event_id"):
        raise ValueError("event_id is required")
    with write_lock(state_root):
        events = load_events(state_root)
        existing = next(
            (item for item in events if str(item["event_id"]) == str(normalized["event_id"])),
            None,
        )
        if existing is None:
            events_path = state_root / EVENTS_FILE
            current = events_path.read_text(encoding="utf-8")
            if current and not current.endswith("\n"):
                current += "\n"
            line = json.dumps(normalized, ensure_ascii=False, sort_keys=True) + "\n"
            atomic_write_text(events_path, current + line)
            events.append(normalized)
            recorded = True
        else:
            comparable_existing = {key: value for key, value in existing.items() if key != "recorded_at"}
            comparable_new = {key: value for key, value in normalized.items() if key != "recorded_at"}
            if comparable_existing != comparable_new:
                raise ValueError(
                    f"event_id conflict: {normalized['event_id']} already exists with different content"
                )
            recorded = False
        rebuild_projections(state_root, events)
    return recorded


def query_store(query: str, root: Path | str | None = None, limit: int = 8) -> list[dict]:
    state_root = initialize_store(root)
    normalized_query = query.strip().lower()
    tokens = [normalized_query] if normalized_query else []
    tokens.extend(token for token in re.findall(r"[\w\-]+", normalized_query) if len(token) > 1)
    tokens = list(dict.fromkeys(tokens))
    matches: list[dict] = []
    for name in PROJECTION_FILES:
        text = (state_root / name).read_text(encoding="utf-8")
        blocks = re.split(r"(?=^##\s+)", text, flags=re.MULTILINE)
        for block in blocks:
            lowered = block.lower()
            score = sum(lowered.count(token) for token in tokens)
            if not score:
                continue
            heading = block.splitlines()[0].lstrip("# ").strip() if block.splitlines() else name
            excerpt = " ".join(line.strip() for line in block.splitlines()[1:8] if line.strip())
            matches.append(
                {"file": name, "heading": heading, "score": score, "excerpt": excerpt[:600]}
            )
    matches.sort(key=lambda item: (-item["score"], item["file"], item["heading"]))
    return matches[: max(1, limit)]


def doctor(root: Path | str | None = None) -> dict:
    state_root = initialize_store(root)
    errors: list[str] = []
    if "plugins\\cache" in str(state_root).lower().replace("/", "\\"):
        errors.append("experience root is inside a versioned plugin cache")
    try:
        events = load_events(state_root)
    except ValueError as exc:
        events = []
        errors.append(str(exc))
    for name in EXPERIENCE_FILES:
        if not (state_root / name).is_file():
            errors.append(f"missing experience file: {name}")
    metadata_path = state_root / STATE_FILE
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        if metadata.get("schema_version") != SCHEMA_VERSION:
            errors.append(
                f"state schema mismatch: {metadata.get('schema_version')} != {SCHEMA_VERSION}"
            )
    except (OSError, json.JSONDecodeError) as exc:
        errors.append(f"invalid state metadata: {exc}")
    if events or not errors:
        for name in PROJECTION_FILES:
            path = state_root / name
            if not path.is_file():
                continue
            expected = projection_content(state_root, name, events)
            if path.read_text(encoding="utf-8") != expected:
                errors.append(f"projection drift: {name}; run experience_store.py rebuild")
    return {
        "ok": not errors,
        "schema_version": SCHEMA_VERSION,
        "root": str(state_root),
        "event_count": len(events),
        "errors": errors,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", help="Override persistent experience root")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("init")
    subparsers.add_parser("doctor")
    subparsers.add_parser("rebuild")
    query_parser = subparsers.add_parser("query")
    query_parser.add_argument("query")
    query_parser.add_argument("--limit", type=int, default=8)
    args = parser.parse_args()

    root = resolve_experience_root(args.root)
    if args.command == "init":
        print(json.dumps({"root": str(initialize_store(root))}, ensure_ascii=False, indent=2))
        return 0
    if args.command == "doctor":
        report = doctor(root)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0 if report["ok"] else 1
    if args.command == "rebuild":
        rebuild_projections(root)
        print(json.dumps({"root": str(root), "rebuilt": True}, ensure_ascii=False, indent=2))
        return 0
    results = query_store(args.query, root, args.limit)
    print(json.dumps({"root": str(root), "query": args.query, "matches": results}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
