#!/usr/bin/env python3
"""Self-check stable protocol constants and strict Markdown round trips."""

from __future__ import annotations

import argparse
import os
import re
from pathlib import Path
from tempfile import TemporaryDirectory

from experience_store import doctor as experience_doctor
from experience_store import initialize_store, load_events, query_store, rebuild_projections, record_event
from tool_preflight import build_plan

from luz_crawl_protocol import (
    DEFAULT_EXPERIENCE_ROOT,
    DEFAULT_ROOT,
    MONEY_SECTION_FOLDERS,
    MODULES,
    PLATFORM_SECTION_FOLDERS,
    SECTION_FOLDERS,
    SECTIONED_MODULE_IDS,
    STRICT_PROMPT_IMAGES_LABEL,
    STRICT_PROMPT_LINK_LABEL,
    STRICT_PROMPT_NO_IMAGES,
    STRICT_PROMPT_PROMPT_LABEL,
    parse_strict_prompt_document,
    render_strict_prompt_document,
    resolve_module,
)


EXPECTED_MODULES: dict[str, str] = {}
EXPECTED_PROMPT_LABELS = {
    "link": "链接",
    "images": "图片",
    "prompt": "提示词",
    "none": "无",
}
EXPECTED_SECTIONED_MODULE_IDS: set[str] = set()
EXPECTED_MONEY_SECTION_FOLDERS: dict[str, str] = {}
EXPECTED_PLATFORM_SECTION_FOLDERS: dict[str, str] = {}
EXPECTED_SECTION_FOLDERS: dict[str, str] = {}
MOJIBAKE_RE = re.compile(r"[�锛杈璧灏鍏鍥鎻閾鏍椋绗甯鍟]")


def check(condition: bool, message: str, errors: list[str]) -> None:
    if not condition:
        errors.append(message)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check-files",
        action="store_true",
        help="Also scan core docs/scripts for common mojibake characters.",
    )
    args = parser.parse_args()

    errors: list[str] = []
    check(MODULES == EXPECTED_MODULES, f"MODULES drifted: {MODULES!r}", errors)
    check(
        SECTIONED_MODULE_IDS == EXPECTED_SECTIONED_MODULE_IDS,
        f"SECTIONED_MODULE_IDS drifted: {SECTIONED_MODULE_IDS!r}",
        errors,
    )
    check(
        MONEY_SECTION_FOLDERS == EXPECTED_MONEY_SECTION_FOLDERS,
        f"MONEY_SECTION_FOLDERS drifted: {MONEY_SECTION_FOLDERS!r}",
        errors,
    )
    check(
        PLATFORM_SECTION_FOLDERS == EXPECTED_PLATFORM_SECTION_FOLDERS,
        f"PLATFORM_SECTION_FOLDERS drifted: {PLATFORM_SECTION_FOLDERS!r}",
        errors,
    )
    check(
        SECTION_FOLDERS == EXPECTED_SECTION_FOLDERS,
        f"SECTION_FOLDERS drifted: {SECTION_FOLDERS!r}",
        errors,
    )
    expected_root = Path(os.environ.get("LUZ_CRAWL_OUTPUT_ROOT", str(Path.home() / "Documents" / "luz-crawl"))).expanduser()
    check(DEFAULT_ROOT == expected_root, f"DEFAULT_ROOT drifted: {DEFAULT_ROOT}", errors)
    check(
        "plugins\\cache" not in str(DEFAULT_EXPERIENCE_ROOT).lower().replace("/", "\\"),
        f"default experience root points into plugin cache: {DEFAULT_EXPERIENCE_ROOT}",
        errors,
    )
    check(STRICT_PROMPT_LINK_LABEL == EXPECTED_PROMPT_LABELS["link"], "link label drifted", errors)
    check(STRICT_PROMPT_IMAGES_LABEL == EXPECTED_PROMPT_LABELS["images"], "images label drifted", errors)
    check(STRICT_PROMPT_PROMPT_LABEL == EXPECTED_PROMPT_LABELS["prompt"], "prompt label drifted", errors)
    check(STRICT_PROMPT_NO_IMAGES == EXPECTED_PROMPT_LABELS["none"], "no-images label drifted", errors)

    try:
        resolve_module("001")
    except ValueError:
        pass
    else:
        errors.append("resolve_module should reject deprecated module IDs")

    rendered = render_strict_prompt_document(
        [
            {
                "title": "中文提示词样例",
                "link": "https://x.com/example/status/1234567890",
                "images": ["001_01.jpg", "001_02.webp"],
                "prompt": "画幅比例 1:1，生成一张测试图。",
            },
            {
                "title": "无图样例",
                "link": "https://x.com/example/status/2234567890",
                "images": [],
                "prompt": "画幅比例 4:5，生成一张无图测试。",
            },
        ],
        heading="协议自检",
    )
    parsed = parse_strict_prompt_document(rendered)
    check(parsed.heading == "协议自检", "strict prompt heading round trip failed", errors)
    check(len(parsed.items) == 2, "strict prompt item count round trip failed", errors)
    if len(parsed.items) == 2:
        check(parsed.items[0].images == ["001_01.jpg", "001_02.webp"], "image list round trip failed", errors)
        check(parsed.items[0].image_heights == [220, 220], "image height round trip failed", errors)
        check(parsed.items[1].images == [], "no-image round trip failed", errors)

    with TemporaryDirectory(prefix="luz-crawl-self-check-") as temporary:
        state_root = Path(temporary) / "state"
        initialize_store(state_root, Path(__file__).resolve().parents[1] / "experience")
        event = {
            "event_id": "self-check-event",
            "label": "协议自检经验",
            "summary": "selfcheckuniquetoken 验证工具路由和经验沉淀",
            "domain": "tooling",
            "tools": ["agent-reach", "gh"],
            "channels": ["GitHub"],
            "worked_queries": ["search tool routing"],
            "lessons": ["先做工具预检"],
            "next_queries": ["fallback route"],
        }
        check(record_event(event, state_root), "experience event should record", errors)
        check(not record_event(event, state_root), "duplicate experience event should be idempotent", errors)
        conflicting_event = {**event, "summary": "different content"}
        try:
            record_event(conflicting_event, state_root)
        except ValueError:
            pass
        else:
            errors.append("same event id with different content should fail")
        check(len(load_events(state_root)) == 1, "experience event ledger should contain one event", errors)
        query_matches = query_store("selfcheckuniquetoken", state_root)
        check(
            any("self-check-event" in item["excerpt"] for item in query_matches["matches"]),
            "experience query should return the recorded event",
            errors,
        )
        report = experience_doctor(state_root)
        check(report["ok"], f"experience doctor failed: {report}", errors)
        projection_path = state_root / "search-keywords.md"
        projection_path.write_text(
            projection_path.read_text(encoding="utf-8") + "\nmanual drift\n",
            encoding="utf-8",
        )
        drift_report = experience_doctor(state_root)
        check(not drift_report["ok"], "experience doctor should detect projection drift", errors)
        rebuild_projections(state_root)
        check(experience_doctor(state_root)["ok"], "projection rebuild should restore consistency", errors)

        route_plan = build_plan(
            "compare search tools",
            ["github"],
            ["firecrawl", "browser"],
            commands={"agent-reach": "agent-reach", "opencli": None, "gh": "gh", "yt-dlp": None, "mcporter": None, "curl": "curl"},
            doctor_report={"github": {"status": "ok", "active_backend": "gh CLI"}},
        )
        route_names = {item["route"] for item in route_plan["recommended_routes"]}
        check("agent-reach" in route_names, "tool preflight should prefer agent-reach", errors)
        check("gh" in route_names, "tool preflight should select gh for GitHub", errors)
        check("firecrawl" in route_names, "tool preflight should include declared firecrawl", errors)

    if args.check_files:
        root = Path(__file__).resolve().parents[1]
        for relative in [
            "SKILL.md",
            "references/modules.md",
            "scripts/luz_crawl_protocol.py",
            "scripts/experience_store.py",
            "scripts/tool_preflight.py",
            "scripts/finalize_run.py",
            "scripts/prepare_output.py",
            "scripts/validate_output.py",
            "scripts/render_prompt_md.py",
            "scripts/validate_prompt_md.py",
        ]:
            path = root / relative
            text = path.read_text(encoding="utf-8")
            match = MOJIBAKE_RE.search(text)
            if match:
                errors.append(f"possible mojibake in {relative}: {match.group(0)!r}")

    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1

    print("OK: luz-crawl protocol self-check passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
