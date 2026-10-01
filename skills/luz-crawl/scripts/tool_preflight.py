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
from urllib.error import URLError
from urllib.request import Request, urlopen

from source_registry import (
    OPENCLI_SITE_BY_PLATFORM,
    PLATFORM_CATALOG,
    normalize_platform,
    planned_sites,
)


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


def probe_github_cli(commands: dict[str, str | None], timeout: int = 12) -> dict:
    executable = commands.get("gh")
    if not executable:
        return {"installed": False, "checked": False, "authenticated": False}
    exit_code, output, error = _run_opencli(
        executable, ["auth", "status", "--hostname", "github.com"], timeout)
    return {
        "installed": True,
        "checked": error is None and exit_code is not None,
        "authenticated": exit_code == 0 and error is None,
        "exit_code": exit_code,
        "error_type": type(error).__name__ if error else None,
        # Deliberately omit auth status output, which can disclose account details.
    }


def _run_opencli(executable: str, args: list[str], timeout: int) -> tuple[int | None, str, str | None]:
    """Run installed OpenCLI .ps1/.cmd shims correctly on Windows."""
    try:
        if os.name == "nt" and executable.lower().endswith(".ps1"):
            shell = shutil.which("pwsh") or shutil.which("powershell") or "powershell.exe"
            command = [shell, "-NoProfile", "-ExecutionPolicy", "Bypass",
                       "-File", executable, *args]
            result = subprocess.run(command, capture_output=True, text=True,
                                    timeout=timeout, check=False)
        elif os.name == "nt" and executable.lower().endswith((".cmd", ".bat")):
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
        normalized = normalize_platform(platform)
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


def probe_extension_bridge(timeout: float = 0.6) -> dict:
    """Read the local bridge health without starting it or creating a search job."""
    default_port = os.environ.get("LUZ_CRAWL_BRIDGE_PORT", "8765")
    base_url = os.environ.get("LUZ_CRAWL_BRIDGE_URL", f"http://127.0.0.1:{default_port}").rstrip("/")
    request = Request(f"{base_url}/health", headers={"Accept": "application/json"})
    try:
        with urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read(16 * 1024).decode("utf-8"))
        connected = bool(payload.get("extensionConnected"))
        return {
            "status": "available" if connected else "warn",
            "service_running": True,
            "extension_connected": connected,
            "message": "扩展已连接。" if connected else "桥接服务在线，但扩展尚未连接；运行时会保留排队任务并自动等待。",
        }
    except (URLError, TimeoutError, OSError, json.JSONDecodeError) as error:
        return {
            "status": "unverified",
            "service_running": False,
            "extension_connected": False,
            "message": f"本机桥接尚未运行（{type(error).__name__}）；搜索命令会自动启动服务并等待扩展连接。",
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
    queries: list[str] | None = None,
    github_report: dict | None = None,
    extension_bridge_report: dict | None = None,
) -> dict:
    commands = commands or detected_commands()
    doctor_report = doctor_report or {}
    opencli_report = opencli_report or {}
    github_report = github_report or {}
    extension_bridge_report = extension_bridge_report or {}
    normalized_tools = [tool.lower() for tool in runtime_tools]
    normalized_platforms = [normalize_platform(platform) for platform in platforms]
    routes: list[dict] = []

    if commands.get("agent-reach"):
        agent_status = "available" if doctor_report else "unverified"
        agent_limitation = "" if doctor_report else "CLI is installed; run --probe-agent-reach to verify configured providers."
        _add_route(routes, "agent-reach", "Discover active platform backends and route platform-native searches",
                   agent_status, agent_limitation)
    if doctor_report.get("exa_search", {}).get("status") == "ok":
        _add_route(routes, "agent-reach/exa_search", "Broad semantic web discovery")
    if doctor_report.get("web", {}).get("status") == "ok":
        _add_route(routes, "agent-reach/jina", "Read known public web pages cleanly")
    if any("firecrawl" in tool for tool in normalized_tools):
        _add_route(routes, "firecrawl", "Search, scrape, extract, or crawl public web sources")
    if any("browser" in tool or "chrome" in tool for tool in normalized_tools):
        _add_route(routes, "browser", "Inspect dynamic or interaction-dependent pages")
    if any(tool in {"luz-crawl-extension", "extension-bridge", "extension_bridge"} for tool in normalized_tools):
        extension_dir = Path(__file__).resolve().parents[3] / "browser-extension" / "luz-crawl"
        bridge_dir = Path(__file__).resolve().parents[3] / "browser-extension" / "bridge"
        if (extension_dir / "manifest.json").is_file() and (bridge_dir / "server.mjs").is_file():
            status = extension_bridge_report.get("status", "unverified")
            limitation = extension_bridge_report.get("message", "桥接和扩展连接将在实际任务调用时检查。")
            if not (bridge_dir / "node_modules" / "ws").exists():
                status = "needs_setup"
                limitation = "需先安装一次本机依赖：npm install --prefix browser-extension/bridge。"
            _add_route(
                routes,
                "luz-crawl-extension/extension_bridge.py",
                "让浏览器扩展自动执行站内搜索并回传可见结果；无需逐次点击弹窗或输入关键词。",
                status,
                limitation,
            )
    if commands.get("curl"):
        _add_route(routes, "direct-http", "Read public endpoints and verify exact URLs")

    fallback_platform_map = {
        "twitter": ("twitter", "X/Twitter posts, accounts, and discussions", None),
        "rss": ("rss", "Fresh updates from RSS/Atom feeds", None),
    }
    for platform in normalized_platforms:
        registry_entry = PLATFORM_CATALOG.get(platform)
        route_key, purpose, opencli_site = (
            (registry_entry["route_key"], registry_entry["purpose"],
             registry_entry.get("opencli_site"))
            if registry_entry else fallback_platform_map.get(
                platform, (platform, f"Platform-native evidence from {platform}", None))
        )
        if platform == "qichacha":
            qcc_credentials_present = bool(
                os.environ.get("QCC_APP_KEY") and os.environ.get("QCC_SECRET_KEY")
            )
            qcc_status = "configured_unverified" if qcc_credentials_present else "needs_credentials"
            qcc_limitation = (
                "QCC_APP_KEY and QCC_SECRET_KEY are present; this read-only preflight does not verify "
                "API entitlement or application-scenario approval and does not make a billable call."
                if qcc_credentials_present else
                "Requires an authorized Qichacha Open Platform account, enabled API and approved use case; "
                "configure QCC_APP_KEY and QCC_SECRET_KEY locally. No API call was made."
            )
            _add_route(routes, "qichacha/openapi:886", purpose, qcc_status, qcc_limitation)
        report = doctor_report.get(route_key, {})
        if route_key == "gh" and commands.get("gh"):
            if github_report.get("authenticated"):
                gh_status, gh_limitation = "available", ""
            elif github_report.get("checked"):
                gh_status = "warn"
                gh_limitation = "GitHub CLI is installed but authenticated access was not confirmed; verify public access or use web search."
            else:
                gh_status = "unverified"
                gh_limitation = "GitHub CLI is installed; authentication status was not checked."
            _add_route(routes, "gh", purpose, gh_status, gh_limitation)
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
        elif commands.get("opencli") and not opencli_site and not registry_entry:
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
                registry_limitation = (registry_entry or {}).get("limitation", "")
                if registry_limitation:
                    limitation = (limitation + " " + registry_limitation).strip()
                _add_route(routes, f"opencli/{opencli_site}:search", purpose,
                           status, limitation)
            else:
                _add_route(routes, f"opencli/{opencli_site}:search", purpose,
                           "off", " ".join(filter(None, [
                               site.get("error") or "No search command found in this site adapter.",
                               (registry_entry or {}).get("limitation", ""),
                           ])))

    if any(tool in {"web__run", "web"} for tool in normalized_tools):
        _add_route(routes, "web__run/external-index",
                   "External web-index fallback; results are not proof of platform-native search",
                   "fallback", "Use only when the platform-native route is blocked or unavailable.")

    lowered_intent = intent.lower()
    if commands.get("gh") and any(word in lowered_intent for word in ("code", "repo", "github", "software", "tool")):
        _add_route(routes, "gh", "Implementation reality, issues, releases, and repository health")

    extension_selected = any(tool in {"luz-crawl-extension", "extension-bridge", "extension_bridge"}
                            for tool in normalized_tools)
    fallbacks = ([
        "extension disconnected -> keep/report the queued job and request only the one-time extension reload or permission needed",
        "login or verification required -> pause and leave that source for the user's browser session",
        "do not silently replace the selected extension execution with Agent Browser, Computer Use, or OpenCLI",
    ] if extension_selected else [
        "platform-native route -> exact URL/title/author search",
        "Agent Reach/OpenCLI -> Firecrawl/Jina/direct public page",
        "dynamic page -> browser-backed read",
        "blocked source -> official source, mirror/index, or adjacent independent discussion",
    ])
    route_tools = [
        {"route": item["route"], "status": item["status"],
         "purpose": item["purpose"], "limitation": item["limitation"]}
        for item in routes
    ]
    sites = planned_sites(platforms)
    if extension_selected:
        for site in sites:
            if site.get("platform") == "1688":
                site["label"] = "1688 找工厂"
                site["domains"] = ["www.1688.com", "s.1688.com"]
                site["limitation"] = (
                    "扩展复用搜索标签打开 1688 工厂搜索并采集当前页最多 40 条可见链接；首次站点权限、登录和验证需用户处理。"
                    "工厂列表不等于工商身份核验，也不证明任何未显示的联系方式。"
                )
                site["retention"] = "本机桥接保留最多 100 个任务；扩展本地保留最多 100 份可见结果采集。手机号和邮箱会省略。"
    plan_queries = list(dict.fromkeys(query.strip() for query in (queries or []) if query.strip()))
    execution_steps = [
        "读取本地相关偏好、成功/弱检索词和旧来源；仅作为线索。",
        "先查官方/一手来源与 GitHub 项目，再查平台内容、讨论和风险；每批结果后调整关键词。",
        "打开高相关候选核验正文、作者、时间与来源；不可读页面保留为待核实线索。",
        "联系方式优先记录企业总机、商务邮箱、平台内联系入口，以及企业明确标为业务合作的联系人渠道；保留用途、来源和核验时间。",
        "从高信号结果抽取新术语/项目名/平台原生说法，自动执行至少一轮追搜。",
        "去重、记录来源与路线限制，保存结果并沉淀本轮有效/无效检索词。",
    ]
    if extension_selected:
        execution_steps = [
            "展示已检查的扩展桥接状态、目标网站和精确检索词。",
            "调用本机 extension_bridge.py；后端自动启动服务、派发任务并等待扩展返回状态。",
            "扩展在目标站点执行搜索并采集最多 40 条可见结果；登录、权限或验证问题会暂停。",
            "按来源链接核验结果、记录缺口；扩展未连接时保留任务状态，不用其他浏览器工具代搜。",
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
        "github_cli_probe": github_report,
        "opencli_probe": opencli_report,
        "extension_bridge_probe": extension_bridge_report,
        "recommended_routes": routes,
        "planned_sites": sites,
        "planned_queries": plan_queries,
        "user_visible_plan": {
            "tools": route_tools,
            "sites": sites,
            "queries": plan_queries,
            "steps": execution_steps,
        },
        "fallback_chain": fallbacks,
        "requirements": [
            "Use the most source-specific available route",
            "Cover source-of-truth, examples, discussion, negative/risk, and implementation lanes as applicable",
            "Record route failures and successful fallbacks",
        ],
    }


def render_user_plan(plan: dict) -> str:
    """Render the read-only preflight as a plan that can be shown before search."""
    lines = [f"检索计划：{plan.get('intent', '').strip()}", "", "工具/路线："]
    routes = plan.get("user_visible_plan", {}).get("tools", [])
    if routes:
        for item in routes:
            status = item.get("status", "unknown")
            detail = item.get("limitation") or item.get("purpose", "")
            lines.append(f"- {item.get('route')} [{status}]：{detail}")
    else:
        lines.append("- 暂无已验证可用的搜索路线；先说明限制并使用可用的公开网页来源。")
    lines += ["", "访问的网站："]
    sites = plan.get("planned_sites", [])
    if sites:
        for site in sites:
            domains = ", ".join(site.get("domains", []))
            limitation = f"；限制：{site['limitation']}" if site.get("limitation") else ""
            retention = f"；留存：{site['retention']}" if site.get("retention") else ""
            lines.append(f"- {site['label']}（{domains}）{limitation}{retention}")
    else:
        lines.append("- 按检索结果逐项列出实际来源站点。")
    queries = plan.get("planned_queries", [])
    if queries:
        lines += ["", "首轮检索词：", *[f"- {query}" for query in queries]]
    lines += ["", "执行步骤："]
    lines.extend(f"{index}. {step}" for index, step in enumerate(
        plan.get("user_visible_plan", {}).get("steps", []), start=1))
    lines += ["", "失败回退：", *[f"- {item}" for item in plan.get("fallback_chain", [])]]
    return "\n".join(lines)


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
    parser.add_argument("--query", action="append", default=[],
                        help="Search query/variant that will be run (repeatable)")
    parser.add_argument("--probe-agent-reach", action="store_true")
    parser.add_argument("--output", help="Write the JSON preflight record to this path")
    parser.add_argument("--format", choices=("json", "text"), default="json",
                        help="Print machine-readable JSON or a user-visible plan")
    args = parser.parse_args()

    commands = detected_commands()
    doctor_report: dict = {}
    doctor_error: str | None = None
    if args.probe_agent_reach:
        doctor_report, doctor_error = probe_agent_reach(commands)
    lowered_intent = args.intent.lower()
    needs_github = (
        any(normalize_platform(platform) == "github" for platform in args.platform)
        or any(term in lowered_intent for term in ("github", "repo", "repository", "代码仓库"))
    )
    github_report = probe_github_cli(commands) if commands.get("gh") and needs_github else {}
    opencli_report = probe_opencli(commands, args.platform) if commands.get("opencli") else {}
    extension_requested = any(tool.lower() in {"luz-crawl-extension", "extension-bridge", "extension_bridge"}
                             for tool in args.available_tool)
    extension_bridge_report = probe_extension_bridge() if extension_requested else {}
    plan = build_plan(
        args.intent,
        args.platform,
        args.available_tool,
        commands,
        doctor_report,
        doctor_error,
        opencli_report,
        args.query,
        github_report,
        extension_bridge_report,
    )
    if args.output:
        atomic_write_json(Path(args.output).resolve(), plan)
    print(render_user_plan(plan) if args.format == "text"
          else json.dumps(plan, ensure_ascii=False, indent=2))
    return 0 if plan["recommended_routes"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
