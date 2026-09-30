#!/usr/bin/env python3
"""Inventory available search routes and produce an evidence-oriented tool plan."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import shutil
import subprocess


COMMANDS = ("agent-reach", "opencli", "gh", "yt-dlp", "mcporter", "curl")


def detected_commands() -> dict[str, str | None]:
    return {name: shutil.which(name) for name in COMMANDS}


def probe_agent_reach(commands: dict[str, str | None], timeout: int = 30) -> tuple[dict, str | None]:
    executable = commands.get("agent-reach")
    if not executable:
        return {}, "agent-reach command not found"
    try:
        result = subprocess.run(
            [executable, "doctor", "--json"],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {}, str(exc)
    if result.returncode != 0:
        return {}, (result.stderr or result.stdout or f"exit {result.returncode}").strip()
    try:
        return json.loads(result.stdout), None
    except json.JSONDecodeError as exc:
        return {}, f"invalid agent-reach doctor JSON: {exc}"


OPENCLI_SITE_BY_PLATFORM = {
    "xiaohongshu": "xiaohongshu",
    "小红书": "xiaohongshu",
    "zhihu": "zhihu",
    "知乎": "zhihu",
    "wechat": "weixin",
    "公众号": "weixin",
    "微信公众号": "weixin",
}


def _run_opencli(executable: str, args: list[str], timeout: int) -> tuple[int | None, str, str | None]:
    """Run the installed OpenCLI command, including Windows .cmd shims."""
    try:
        if os.name == "nt" and executable.lower().endswith((".cmd", ".bat")):
            command = subprocess.list2cmdline([executable, *args])
            result = subprocess.run(command, capture_output=True, text=True,
                                    timeout=timeout, check=False, shell=True)
        else:
            result = subprocess.run([executable, *args], capture_output=True,
                                    text=True, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return None, "", f"{type(exc).__name__}: {exc}"
    return result.returncode, (result.stdout or "") + (result.stderr or ""), None


def probe_opencli(commands: dict[str, str | None], platforms: list[str],
                  timeout: int = 20) -> dict:
    """Check Bridge connectivity and whether each requested site exposes search."""
    executable = commands.get("opencli")
    if not executable:
        return {"status": "off", "bridge_connected": False,
                "error": "opencli command not found", "site_search": {}}

    exit_code, doctor_text, doctor_error = _run_opencli(executable, ["doctor"], timeout)
    connected = bool(
        re.search(r"\[OK\]\s+Extension\b", doctor_text, re.IGNORECASE)
        and re.search(r"\[OK\]\s+Connectivity\b", doctor_text, re.IGNORECASE)
    )
    missing_bridge = bool(re.search(
        r"extension\s*:\s*not connected|extension has not connected|browser bridge extension not connected",
        doctor_text, re.IGNORECASE))
    if connected:
        status = "available"
    elif doctor_error:
        status = "error"
    elif missing_bridge or "[FAIL] Connectivity" in doctor_text:
        status = "warn"
    else:
        status = "unverified"

    detail_lines = [line.strip() for line in doctor_text.splitlines()
                    if re.search(r"\[(?:OK|MISSING|FAIL)\]\s+(?:Daemon|Extension|Connectivity)",
                                 line, re.IGNORECASE)]
    site_search: dict[str, dict] = {}
    for platform in platforms:
        normalized = platform.strip().lower()
        site = OPENCLI_SITE_BY_PLATFORM.get(normalized)
        if not site or site in site_search:
            continue
        site_exit, help_text, site_error = _run_opencli(
            executable, [site, "--help", "-f", "yaml"], timeout)
        has_search = bool(re.search(r"(?m)^\s*-\s+name:\s*search\s*$", help_text))
        site_search[site] = {
            "command_available": site_exit == 0,
            "search_available": has_search,
            "error": site_error,
        }
        if site == "weixin" and has_search:
            site_search[site]["route_note"] = (
                "Uses Sogou WeChat article search; this is an external index, "
                "not the WeChat app's native search UI."
            )

    return {
        "status": status,
        "bridge_connected": connected,
        "doctor_exit_code": exit_code,
        "doctor_error": doctor_error,
        "doctor_summary": detail_lines,
        "site_search": site_search,
    }


def _add_route(routes: list[dict], route: str, purpose: str, status: str = "available", limitation: str = "") -> None:
    if any(item["route"] == route for item in routes):
        return
    routes.append({"route": route, "purpose": purpose, "status": status, "limitation": limitation})


def build_plan(
    intent: str,
    platforms: list[str],
    runtime_tools: list[str],
    commands: dict[str, str | None] | None = None,
    doctor_report: dict | None = None,
    doctor_error: str | None = None,
    opencli_report: dict | None = None,
) -> dict:
    commands = commands or detected_commands()
    doctor_report = doctor_report or {}
    opencli_report = opencli_report or {}
    normalized_tools = [tool.lower() for tool in runtime_tools]
    normalized_platforms = [platform.lower() for platform in platforms]
    routes: list[dict] = []

    if commands.get("agent-reach"):
        _add_route(routes, "agent-reach", "Discover active platform backends and route platform-native searches")
    if doctor_report.get("exa_search", {}).get("status") == "ok":
        _add_route(routes, "agent-reach/exa_search", "Broad semantic web discovery")
    if doctor_report.get("web", {}).get("status") == "ok":
        _add_route(routes, "agent-reach/jina", "Read known public web pages cleanly")
    if any("firecrawl" in tool for tool in normalized_tools):
        _add_route(routes, "firecrawl", "Search, scrape, extract, or crawl public web sources")
    if any("browser" in tool or "chrome" in tool for tool in normalized_tools):
        _add_route(routes, "browser", "Inspect dynamic or interaction-dependent pages")
    if commands.get("curl"):
        _add_route(routes, "direct-http", "Read public endpoints and verify exact URLs")

    platform_map = {
        "github": ("gh", "Repository, code, release, issue, and implementation evidence", None),
        "x": ("twitter", "X/Twitter posts, accounts, and discussions", None),
        "twitter": ("twitter", "X/Twitter posts, accounts, and discussions", None),
        "reddit": ("reddit", "User discussions, complaints, and comparisons", None),
        "xiaohongshu": ("xiaohongshu", "Xiaohongshu notes, products, and comments", "xiaohongshu"),
        "小红书": ("xiaohongshu", "Xiaohongshu notes, products, and comments", "xiaohongshu"),
        "zhihu": ("zhihu", "Zhihu answers, articles, and questions", "zhihu"),
        "知乎": ("zhihu", "Zhihu answers, articles, and questions", "zhihu"),
        "wechat": ("wechat", "WeChat public-account articles", "weixin"),
        "公众号": ("wechat", "WeChat public-account articles", "weixin"),
        "微信公众号": ("wechat", "WeChat public-account articles", "weixin"),
        "youtube": ("youtube", "Video details, subtitles, and comments", None),
        "bilibili": ("bilibili", "Bilibili search, video details, and subtitles", None),
        "v2ex": ("v2ex", "V2EX topics and replies", None),
        "rss": ("rss", "Fresh updates from RSS/Atom feeds", None),
    }
    for platform in normalized_platforms:
        route_key, purpose, opencli_site = platform_map.get(
            platform, (platform, f"Platform-native evidence from {platform}", None))
        report = doctor_report.get(route_key, {})
        if route_key == "gh" and commands.get("gh"):
            _add_route(routes, "gh", purpose)
        elif report:
            status = str(report.get("status", "unknown"))
            active = report.get("active_backend") or "no active backend"
            limitation = str(report.get("message", "")) if status != "ok" else ""
            if (route_key == "xiaohongshu" and commands.get("opencli")
                    and not opencli_report.get("bridge_connected")):
                limitation = (
                    "OpenCLI Browser Bridge is not connected to the current browser. "
                    "The extension's installation state in Edge is not established by this check."
                )
            _add_route(routes, f"agent-reach/{route_key}:{active}", purpose, status, limitation)
        elif commands.get("opencli") and not opencli_site:
            _add_route(routes, f"opencli/{route_key}", purpose, "unverified",
                       "No platform-specific search adapter was probed for this route.")

        if commands.get("opencli") and opencli_site:
            site = opencli_report.get("site_search", {}).get(opencli_site, {})
            if site.get("search_available"):
                connected = bool(opencli_report.get("bridge_connected"))
                status = "available" if connected else "warn"
                limitation = "" if connected else (
                    "The OpenCLI search adapter exists, but Browser Bridge is not connected; "
                    "the current browser session cannot be searched yet."
                )
                if site.get("route_note"):
                    limitation = (limitation + " " + site["route_note"]).strip()
                _add_route(routes, f"opencli/{opencli_site}:search", purpose,
                           status, limitation)
            else:
                _add_route(routes, f"opencli/{opencli_site}:search", purpose,
                           "off", site.get("error") or "No search command found in this site adapter.")

    if any(tool in {"web__run", "web"} for tool in normalized_tools):
        _add_route(routes, "web__run/external-index",
                   "External web-index fallback; results are not proof of platform-native search",
                   "fallback", "Use only when the platform-native route is blocked or unavailable.")

    lowered_intent = intent.lower()
    if commands.get("gh") and any(word in lowered_intent for word in ("code", "repo", "github", "software", "tool")):
        _add_route(routes, "gh", "Implementation reality, issues, releases, and repository health")

    fallbacks = [
        "platform-native route -> exact URL/title/author search",
        "Agent Reach/OpenCLI -> Firecrawl/Jina/direct public page",
        "dynamic page -> browser-backed read",
        "blocked source -> official source, mirror/index, or adjacent independent discussion",
    ]
    return {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "intent": intent,
        "platforms": platforms,
        "declared_runtime_tools": runtime_tools,
        "commands": commands,
        "agent_reach_doctor": doctor_report,
        "agent_reach_doctor_error": doctor_error,
        "opencli_probe": opencli_report,
        "recommended_routes": routes,
        "fallback_chain": fallbacks,
        "requirements": [
            "Use the most source-specific available route",
            "Cover source-of-truth, examples, discussion, negative/risk, and implementation lanes as applicable",
            "Record route failures and successful fallbacks",
        ],
    }


def atomic_write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--intent", required=True)
    parser.add_argument("--platform", action="append", default=[])
    parser.add_argument("--available-tool", action="append", default=[])
    parser.add_argument("--probe-agent-reach", action="store_true")
    parser.add_argument("--output", help="Write the JSON preflight record to this path")
    args = parser.parse_args()

    commands = detected_commands()
    doctor_report: dict = {}
    doctor_error: str | None = None
    if args.probe_agent_reach:
        doctor_report, doctor_error = probe_agent_reach(commands)
    opencli_report = probe_opencli(commands, args.platform) if commands.get("opencli") else {}
    plan = build_plan(
        args.intent,
        args.platform,
        args.available_tool,
        commands,
        doctor_report,
        doctor_error,
        opencli_report,
    )
    if args.output:
        atomic_write_json(Path(args.output).resolve(), plan)
    print(json.dumps(plan, ensure_ascii=False, indent=2))
    return 0 if plan["recommended_routes"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
