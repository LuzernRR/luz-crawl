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
from urllib.parse import urlparse

from source_registry import safe_source_url

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
PREFERENCE_PROFILE_FILE = "user-preferences.json"
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
    profile_path = state_root / PREFERENCE_PROFILE_FILE
    if not profile_path.exists():
        legacy_events: list[dict] = []
        try:
            for line in events_path.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    parsed = json.loads(line)
                    if isinstance(parsed, dict):
                        legacy_events.append(parsed)
            profile = preference_profile(legacy_events)
        except (OSError, json.JSONDecodeError, ValueError):
            profile = {
                "schema_version": 1,
                "active_preferences": [],
                "pending_inferred_preferences": [],
            }
        atomic_write_text(profile_path, json.dumps(profile, ensure_ascii=False, indent=2) + "\n")
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


def normalize_preference_observation(value: object) -> dict:
    """Validate a small, non-sensitive search/output preference observation."""
    if not isinstance(value, dict):
        raise ValueError("preference observation must be a JSON object")
    key = str(value.get("key", "")).strip().lower().replace(" ", "_")
    preference = str(value.get("value", "")).strip()
    source = str(value.get("source", "inferred")).strip().lower()
    if not key or not re.fullmatch(r"[a-z0-9_.-]{2,64}", key):
        raise ValueError("preference key must be 2-64 lowercase letters, digits, '.', '_' or '-'")
    if not preference or len(preference) > 240:
        raise ValueError("preference value must contain 1-240 characters")
    if source not in {"explicit", "inferred"}:
        raise ValueError("preference source must be 'explicit' or 'inferred'")
    try:
        confidence = float(value.get("confidence", 1.0 if source == "explicit" else 0.6))
    except (TypeError, ValueError) as exc:
        raise ValueError("preference confidence must be a number from 0 to 1") from exc
    if not 0 <= confidence <= 1:
        raise ValueError("preference confidence must be a number from 0 to 1")
    evidence = str(value.get("evidence", "")).strip()
    if len(evidence) > 280:
        raise ValueError("preference evidence must be at most 280 characters")
    return {
        "key": key,
        "value": preference,
        "source": source,
        "confidence": confidence,
        "evidence": evidence,
    }


def normalize_result_feedback(value: object) -> dict:
    """Store a compact user feedback signal, never a copied source body."""
    if not isinstance(value, dict):
        raise ValueError("result feedback must be a JSON object")
    action = str(value.get("action", "")).strip().lower()
    allowed_actions = {"preferred", "rejected", "opened", "saved", "corrected"}
    if action not in allowed_actions:
        raise ValueError(f"feedback action must be one of {', '.join(sorted(allowed_actions))}")
    item = str(value.get("item", "")).strip()
    reason = str(value.get("reason", "")).strip()
    platform = str(value.get("platform", "")).strip().lower()
    safe_url = safe_source_url(item)
    if not safe_url:
        raise ValueError("feedback item must be a source HTTP(S) URL; do not pass copied source text")
    if len(item) > 2048 or len(reason) > 240 or len(platform) > 48:
        raise ValueError("feedback item/platform/reason exceeds the supported length")
    return {"action": action, "item": safe_url,
            "platform": platform, "reason": reason}


def preference_profile(events: list[dict]) -> dict:
    """Build explicit and repeat-confirmed inferred preferences from the ledger."""
    explicit: dict[str, tuple[int, dict, str]] = {}
    inferred: dict[str, dict[str, dict[str, tuple[dict, str]]]] = {}
    for position, event in enumerate(events):
        event_id = str(event.get("event_id", f"event-{position}"))
        recorded_at = str(event.get("recorded_at", ""))
        for raw in event.get("preference_observations", []) or []:
            observation = normalize_preference_observation(raw)
            key = observation["key"]
            if observation["source"] == "explicit":
                prior = explicit.get(key)
                if prior is None or (recorded_at, position) >= (prior[2], prior[0]):
                    explicit[key] = (position, observation, recorded_at)
            else:
                inferred.setdefault(key, {}).setdefault(observation["value"], {})[event_id] = (
                    observation, recorded_at
                )

    active: list[dict] = []
    pending: list[dict] = []
    all_keys = set(explicit) | set(inferred)
    for key in sorted(all_keys):
        if key in explicit:
            _, observation, recorded_at = explicit[key]
            active.append({
                **observation,
                "status": "active",
                "observation_count": 1,
                "last_seen": recorded_at,
                "basis": "latest_explicit_instruction",
            })
            continue

        candidates = []
        for value, run_observations in inferred[key].items():
            items = list(run_observations.values())
            avg_confidence = sum(item[0]["confidence"] for item in items) / len(items)
            candidates.append({
                "key": key,
                "value": value,
                "source": "inferred",
                "confidence": round(avg_confidence, 3),
                "observation_count": len(items),
                "last_seen": max((item[1] for item in items), default=""),
                "evidence": next((item[0]["evidence"] for item in reversed(items)
                                  if item[0]["evidence"]), ""),
            })
        candidates.sort(key=lambda item: (-item["observation_count"],
                                          -item["confidence"], item["value"]))
        winner = candidates[0]
        runner_up_count = candidates[1]["observation_count"] if len(candidates) > 1 else 0
        if winner["observation_count"] >= 2 and winner["confidence"] >= 0.6 \
                and winner["observation_count"] > runner_up_count:
            active.append({
                **winner,
                "status": "active",
                "basis": "repeated_independent_runs",
            })
        else:
            pending.extend({**item, "status": "pending_confirmation"} for item in candidates)
    return {
        "schema_version": 1,
        "active_preferences": active,
        "pending_inferred_preferences": pending,
    }


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
    observations = event.get("preference_observations", []) or []
    if observations:
        rendered = [f"{item.get('key')}={item.get('value')} ({item.get('source')})"
                    for item in observations if isinstance(item, dict)]
        if rendered:
            lines.append(f"- 搜索偏好信号：{'；'.join(rendered)}")
    feedback = event.get("result_feedback", []) or []
    if feedback:
        rendered = [f"{item.get('action')}:{item.get('platform') or urlparse(item.get('item', '')).netloc}"
                    for item in feedback if isinstance(item, dict)]
        if rendered:
            lines.append(f"- 结果反馈：{'；'.join(rendered)}")
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
    atomic_write_text(
        state_root / PREFERENCE_PROFILE_FILE,
        json.dumps(preference_profile(event_list), ensure_ascii=False, indent=2) + "\n",
    )


def record_event(event: dict, root: Path | str | None = None) -> bool:
    state_root = initialize_store(root)
    normalized = dict(event)
    normalized["preference_observations"] = [
        normalize_preference_observation(item)
        for item in normalized.get("preference_observations", []) or []
    ]
    normalized["result_feedback"] = [
        normalize_result_feedback(item)
        for item in normalized.get("result_feedback", []) or []
    ]
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


def _query_tokens(query: str) -> list[str]:
    normalized = query.strip().lower()
    raw = re.findall(r"[a-z0-9][a-z0-9._/-]*|[\u4e00-\u9fff]+", normalized)
    tokens: list[str] = []
    for item in raw:
        if re.fullmatch(r"[\u4e00-\u9fff]+", item):
            if len(item) > 1:
                tokens.extend(item[index:index + 2] for index in range(len(item) - 1))
            tokens.append(item)
        elif len(item) > 1:
            tokens.append(item)
    return list(dict.fromkeys(tokens))


def query_hints(query: str, events: list[dict], limit: int = 5) -> dict:
    tokens = set(_query_tokens(query))
    if not tokens:
        return {"worked_queries": [], "weak_queries": [], "next_queries": []}
    ranked: list[tuple[int, int, dict]] = []
    for position, event in enumerate(events):
        haystack = " ".join([
            str(event.get("label", "")), str(event.get("summary", "")),
            str(event.get("domain", "")), *_values(event, "channels"),
            *_values(event, "tools"), *_values(event, "lessons"),
            *_values(event, "worked_queries"), *_values(event, "weak_queries"),
            *_values(event, "next_queries"),
        ])
        score = len(tokens.intersection(_query_tokens(haystack)))
        if score:
            ranked.append((score, position, event))
    ranked.sort(key=lambda item: (-item[0], -item[1]))
    selected = [item[2] for item in ranked[:max(1, limit)]]
    def collect(field: str) -> list[str]:
        values: list[str] = []
        for event in selected:
            values.extend(_values(event, field))
        return list(dict.fromkeys(values))[:12]
    return {
        "worked_queries": collect("worked_queries"),
        "weak_queries": collect("weak_queries"),
        "next_queries": collect("next_queries"),
        "matched_runs": [str(event.get("label", "research run")) for event in selected],
    }


def query_store(query: str, root: Path | str | None = None, limit: int = 8) -> dict:
    state_root = initialize_store(root)
    tokens = _query_tokens(query)
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
    events = load_events(state_root)
    return {
        "matches": matches[: max(1, limit)],
        "preferences": preference_profile(events)["active_preferences"],
        "keyword_hints": query_hints(query, events),
    }


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
    profile_path = state_root / PREFERENCE_PROFILE_FILE
    if not profile_path.is_file():
        errors.append(f"missing experience file: {PREFERENCE_PROFILE_FILE}")
    else:
        try:
            actual_profile = json.loads(profile_path.read_text(encoding="utf-8"))
            expected_profile = preference_profile(events)
            if actual_profile != expected_profile:
                errors.append(f"projection drift: {PREFERENCE_PROFILE_FILE}; run experience_store.py rebuild")
        except (OSError, json.JSONDecodeError, ValueError) as exc:
            errors.append(f"invalid preference profile: {exc}")
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
    print(json.dumps({"root": str(root), "query": args.query, **results}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
