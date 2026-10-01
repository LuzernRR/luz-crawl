#!/usr/bin/env python3
"""Search supported platform adapters and normalize enterprise lead candidates.

This tool never launches a browser. It runs read-only OpenCLI search commands
only after the existing Browser Bridge reports a connected browser profile.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import shutil
import sys
import time
from typing import Any
from uuid import uuid4

from tool_preflight import _run_opencli, probe_opencli
from experience_store import record_event
from lead_records import parse_1688_candidates, parse_qcc_candidates
from qcc_client import (
    QCCClientError,
    QCCConfirmationRequired,
    QCC_FUZZY_COST_RMB,
    credentials_from_environment,
    fuzzy_search,
)
from lead_queries import build_query_plan


PLATFORMS = {
    "xiaohongshu": {
        "label": "小红书",
        "site": "xiaohongshu",
        "description": "平台笔记搜索；正文详情仍需带有效 xsec_token 的链接。",
    },
    "zhihu": {
        "label": "知乎",
        "site": "zhihu",
        "description": "知乎站内搜索；登录状态会影响结果数量和详情可读性。",
    },
    "weixin": {
        "label": "微信公众号",
        "site": "weixin",
        "description": "OpenCLI 此路由使用搜狗微信文章索引，不等同于微信客户端站内搜索。",
    },
    "x": {
        "label": "X",
        "site": "twitter",
        "description": "通过现有 OpenCLI 浏览器会话读取 X 搜索结果；覆盖与排序取决于当前账号和 X 搜索入口。",
    },
    "1688": {
        "label": "1688 / 阿里巴巴",
        "site": "1688",
        "description": "通过现有 OpenCLI 浏览器会话搜索商品/供应商候选；结果需回到商品页核验，不代表企业资质或联系方式。",
    },
    "qichacha": {
        "label": "企查查开放平台",
        "site": "qichacha",
        "description": "企查查官方 ApiCode 886 模糊搜索；每次请求可能计费，最多返回 5 条企业记录。",
    },
}

# Broad positive controls used only when every topic query returns an empty list.
# They diagnose whether the adapter is returning any content; they are never
# mixed into the topic-result count or used as evidence about the topic itself.
CONTROL_QUERIES = {
    "xiaohongshu": "穿搭",
    "zhihu": "如何评价",
    "weixin": "人工智能",
    "x": "open source",
    "1688": "沙发",
}


def extract_result_count(value: Any) -> int | None:
    """Count records in common OpenCLI JSON result envelopes."""
    if isinstance(value, list):
        return len(value)
    if isinstance(value, dict):
        for key in ("results", "items", "offers", "products", "records", "Result", "Data", "data", "feeds", "notes", "answers", "tweets", "posts"):
            nested = value.get(key)
            if isinstance(nested, (list, dict)):
                count = extract_result_count(nested)
                if count is not None:
                    return count
    return None


def parse_json_payload(output: str) -> tuple[Any, str | None]:
    """Extract the first JSON document even when the CLI adds log lines."""
    text = output.strip()
    if not text:
        return None, None
    try:
        return json.loads(text), None
    except json.JSONDecodeError as full_error:
        decoder = json.JSONDecoder()
        for index, char in enumerate(text):
            if char not in "[{":
                continue
            try:
                value, _ = decoder.raw_decode(text, index)
            except json.JSONDecodeError:
                continue
            return value, None
        return None, str(full_error)


def parse_adapter_error(output: str) -> dict | None:
    """Extract a compact structured error from OpenCLI's YAML-like failures."""
    code = re.search(r"(?im)^\s*code:\s*([A-Z][A-Z0-9_-]*)\s*$", output)
    message = re.search(r"(?im)^\s*message:\s*(.+?)\s*$", output)
    help_text = re.search(r"(?im)^\s*help:\s*(.+?)\s*$", output)
    exit_code = re.search(r"(?im)^\s*exitCode:\s*(\d+)\s*$", output)
    if not any((code, message, help_text, exit_code)):
        return None
    return {
        **({"code": code.group(1)} if code else {}),
        **({"message": message.group(1)} if message else {}),
        **({"help": help_text.group(1)} if help_text else {}),
        **({"exit_code": int(exit_code.group(1))} if exit_code else {}),
    }


def is_transient_failure(exit_code: int | None, output: str, error: str | None) -> bool:
    """Retry a single read-only search only for recognizable transient network faults."""
    if error:
        signal = error
    elif exit_code not in (0, None):
        signal = output
    else:
        return False
    return any(token in signal.lower() for token in (
        "etimedout", "econnreset", "econnrefused", "eai_again",
        "socket hang up", "temporarily unavailable", "upstream timeout",
        "timed out", "timeoutexpired", "http 429", "http 500", "http 502",
        "http 503", "http 504",
    ))


def search_command(site: str, query: str, limit: int, window: str,
                   page: int = 1) -> list[str]:
    args = [site, "search", query]
    if site in {"xiaohongshu", "zhihu", "twitter"}:
        args += ["--limit", str(min(limit, 100))]
    elif site == "1688":
        args += ["--limit", str(min(limit, 100))]
    elif site == "weixin":
        args += ["--page", str(page), "--limit", str(min(limit, 10))]
    if site == "zhihu":
        args += ["--type", "all"]
    # ephemeral + keep-tab=false is deliberate: OpenCLI releases this command's
    # browser tab lease on both success and failure, without closing Edge.
    args += ["-f", "json", "--window", window,
             "--site-session", "ephemeral", "--keep-tab", "false"]
    return args


def run_one_search(executable: str, site: str, query: str,
                   limit: int, window: str, timeout: int,
                   query_role: str = "topic", page: int = 1) -> dict:
    command = search_command(site, query, limit, window, page=page)
    attempts = 0
    while True:
        attempts += 1
        exit_code, output, error = _run_opencli(executable, command, timeout)
        if attempts == 1 and is_transient_failure(exit_code, output, error):
            time.sleep(0.5)
            continue
        break

    parsed, parse_error = parse_json_payload(output)
    adapter_error = parse_adapter_error(output)
    count = extract_result_count(parsed)
    if error or exit_code not in (0, None):
        status = "error"
    elif count == 0 or output.strip() in {"[]", "{}", "null"}:
        status = "zero_results"
    elif count is not None and count > 0:
        status = "results_returned"
    elif parse_error:
        status = "unparsed_output"
    elif parsed is not None:
        status = "structured_output"
    else:
        status = "empty_output"
    return {
        "query": query,
        "query_role": query_role,
        **({"page": page} if site == "weixin" else {}),
        "status": status,
        "exit_code": exit_code,
        "result_count": count,
        "attempts": attempts,
        "parse_error": parse_error,
        "error": error,
        "adapter_error": adapter_error,
        "raw_output": output,
        **({
            "interpretation_note": (
                "The adapter returned an empty list. This alone does not prove "
                "that no matching content exists; verify session/access or run "
                "a known-good control query before concluding absence."
            )
        } if status == "zero_results" else {}),
    }


def _relevant_lead_candidate(candidate: dict, terms: list[str], location: str) -> bool:
    fields = candidate.get("fields", {})
    product_terms = [term.strip() for term in terms
                     if term.strip() and term.strip().lower() not in {
                         "家居", "家居企业", "企业", "工厂", "厂家", "供应商",
                     }]
    if not product_terms:
        return False
    identity = " ".join(str(fields.get(key, "")) for key in (
        "title", "supplier_name", "company_name",
    )).lower()
    if not any(term.lower() in identity for term in product_terms):
        return False
    if location:
        city_evidence = " ".join(str(fields.get(key, "")) for key in (
            "location", "supplier_name", "company_name",
        )).lower()
        if location.lower() not in city_evidence:
            return False
    return True


def learning_signals(records: list[dict], *, lead_terms: list[str] | None = None,
                     location: str = "") -> tuple[list[str], list[str], list[str]]:
    """Learn relevance outcomes, not just whether an adapter returned rows."""
    worked: list[str] = []
    weak: list[str] = []
    channels: list[str] = []
    for record in records:
        if not record.get("search_executed"):
            continue
        platform = str(record.get("site_adapter", ""))
        if platform and platform not in channels:
            channels.append(platform)
        topic_results = [item for item in record.get("query_results", [])
                         if item.get("query_role") == "topic"]
        for item in topic_results:
            query = str(item.get("query", "")).strip()
            if not query:
                continue
            if item.get("status") == "results_returned" and item.get("result_count", 0) > 0:
                candidates = item.get("lead_candidates", [])
                if platform == "1688" and lead_terms and candidates:
                    is_relevant = any(_relevant_lead_candidate(
                        candidate, lead_terms, location,
                    ) for candidate in candidates if isinstance(candidate, dict))
                    destination = worked if is_relevant else weak
                    if query not in destination:
                        destination.append(query)
                elif query not in worked:
                    worked.append(query)
            elif (platform == "qichacha" and record.get("status") == "zero_results"
                  and item.get("status") == "zero_results"):
                if query not in weak:
                    weak.append(query)
            elif record.get("status") == "control_ok_topic_zero" \
                    and item.get("status") == "zero_results":
                if query not in weak:
                    weak.append(query)
    return worked[:24], weak[:24], channels[:12]


def run(args: argparse.Namespace) -> int:
    requested = list(dict.fromkeys(args.platform))
    queries = list(dict.fromkeys([args.query, *args.synonym]))
    lead_plan = None
    if args.lead_search:
        lead_plan = build_query_plan(
            args.query, location=args.location, terms=args.term,
            max_queries_per_source=args.max_queries_per_source,
        )

    route_key = {
        "1688": "1688", "qichacha": "qichacha", "weixin": "wechat",
        "xiaohongshu": "xiaohongshu", "zhihu": "zhihu", "x": "x",
    }

    def route_queries(platform: str) -> list[str]:
        if lead_plan:
            planned = lead_plan["queries_by_source"].get(route_key.get(platform, platform), [])
            if planned:
                return planned
        return queries

    opencli_platforms = [platform for platform in requested if platform != "qichacha"]
    executable = shutil.which("opencli") if opencli_platforms else None
    if opencli_platforms and not executable:
        probe = {"status": "off", "bridge_connected": False,
                 "error": "opencli command not found", "site_search": {}}
    elif opencli_platforms:
        probe_names = {
            "xiaohongshu": "小红书", "zhihu": "知乎", "weixin": "微信公众号",
            "1688": "1688", "x": "X",
        }
        probe = probe_opencli(
            {"opencli": executable}, [probe_names[p] for p in opencli_platforms],
            timeout=args.timeout,
        )
    else:
        probe = {"status": "not_requested", "bridge_connected": False,
                 "site_search": {}, "note": "This run uses the official Qichacha API route only."}
    stamp = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
    records: list[dict] = []
    bridge_lost = False
    for platform in requested:
        spec = PLATFORMS[platform]
        platform_queries = route_queries(platform)
        if platform == "qichacha":
            if not credentials_from_environment():
                records.append({
                    "platform": spec["label"], "site_adapter": spec["site"],
                    "status": "needs_credentials", "search_executed": False,
                    "reason": "Set QCC_APP_KEY and QCC_SECRET_KEY from an authorized Qichacha Open Platform account.",
                    "route_note": spec["description"], "queries_not_run": platform_queries,
                    "estimated_cost_per_request_rmb": QCC_FUZZY_COST_RMB,
                })
                continue
            if not args.confirm_qcc_cost:
                records.append({
                    "platform": spec["label"], "site_adapter": spec["site"],
                    "status": "confirmation_required", "search_executed": False,
                    "reason": "This API call may be billable; rerun with --confirm-qcc-cost after reviewing the displayed per-request cost.",
                    "route_note": spec["description"], "queries_not_run": platform_queries,
                    "estimated_cost_per_request_rmb": QCC_FUZZY_COST_RMB,
                })
                continue
            # One API call only: no synonym expansion, health query, or retry.
            try:
                payload = fuzzy_search(
                    platform_queries[0], confirmed_billable=True, timeout=args.timeout,
                )
                candidates = parse_qcc_candidates(payload.get("records", []), query=platform_queries[0])
                query_result = {
                    "query": platform_queries[0], "query_role": "topic",
                    "status": "results_returned" if candidates else "zero_results",
                    "result_count": len(candidates), "attempts": 1,
                    "estimated_cost_rmb": payload.get("estimated_cost_rmb", QCC_FUZZY_COST_RMB),
                    "lead_candidates": candidates,
                }
                records.append({
                    "platform": spec["label"], "site_adapter": spec["site"],
                    "status": query_result["status"], "search_executed": True,
                    "route_note": spec["description"],
                    "estimated_cost_rmb": query_result["estimated_cost_rmb"],
                    "query_results": [query_result],
                })
            except QCCConfirmationRequired as exc:
                records.append({
                    "platform": spec["label"], "site_adapter": spec["site"],
                    "status": "confirmation_required", "search_executed": False,
                    "reason": str(exc), "route_note": spec["description"],
                })
            except QCCClientError as exc:
                records.append({
                    "platform": spec["label"], "site_adapter": spec["site"],
                    "status": "error", "search_executed": True,
                    "reason": str(exc), "route_note": spec["description"],
                    "request_may_be_billable": True,
                })
            continue

        if bridge_lost or not probe.get("bridge_connected"):
            records.append({
                "platform": spec["label"],
                "site_adapter": spec["site"],
                "status": "blocked",
                "search_executed": False,
                "reason": ("OpenCLI Browser Bridge disconnected during this run."
                           if bridge_lost else
                           "OpenCLI Browser Bridge is not connected to the existing browser."),
                "route_note": spec["description"],
                "queries_not_run": platform_queries,
            })
            continue

        site_probe = probe.get("site_search", {}).get(spec["site"], {})
        if not site_probe.get("search_available"):
            records.append({
                "platform": spec["label"], "site_adapter": spec["site"],
                "status": "unsupported", "search_executed": False,
                "reason": site_probe.get("error") or "Site adapter has no search command.",
                "route_note": spec["description"], "queries_not_run": platform_queries,
            })
            continue

        query_results: list[dict] = []
        for query in platform_queries:
            pages = range(1, args.weixin_pages + 1) if spec["site"] == "weixin" else (1,)
            for page in pages:
                query_result = run_one_search(
                    executable, spec["site"], query, args.limit,
                    args.window, args.timeout, page=page,
                )
                if spec["site"] == "1688" and query_result.get("raw_output"):
                    parsed, _ = parse_json_payload(query_result["raw_output"])
                    query_result["lead_candidates"] = parse_1688_candidates(
                        parsed, query=query,
                    ) if query_result["query_role"] == "topic" else []
                query_results.append(query_result)
                # Do not keep issuing browser commands after the Bridge drops.
                if "browser bridge extension not connected" in query_result["raw_output"].lower():
                    bridge_lost = True
                    break
            if bridge_lost:
                break

        topic_results = [item for item in query_results if item["query_role"] == "topic"]
        if (spec["site"] in CONTROL_QUERIES and topic_results
                and all(item["status"] == "zero_results" for item in topic_results)
                and not any("browser bridge extension not connected" in item["raw_output"].lower()
                            for item in topic_results)):
            control_query = CONTROL_QUERIES[spec["site"]]
            if control_query not in platform_queries:
                query_results.append(run_one_search(
                    executable, spec["site"], control_query, args.limit,
                    args.window, args.timeout, query_role="health_control",
                    page=1,
                ))

        topic_statuses = [item["status"] for item in topic_results]
        control_results = [item for item in query_results if item["query_role"] == "health_control"]
        if "results_returned" in topic_statuses:
            platform_status = "results_returned"
        elif any(status in {"error", "unparsed_output", "empty_output"}
                 for status in topic_statuses):
            platform_status = "error"
        elif topic_statuses and all(status == "zero_results" for status in topic_statuses):
            if any(item["status"] in {"results_returned", "structured_output"}
                   for item in control_results):
                platform_status = "control_ok_topic_zero"
            elif any(item["status"] == "zero_results" for item in control_results):
                platform_status = "zero_results"
            elif control_results:
                platform_status = "error"
            else:
                platform_status = "unverified"
        else:
            platform_status = "unverified"
        records.append({
            "platform": spec["label"],
            "site_adapter": spec["site"],
            "status": platform_status,
            "search_executed": True,
            "route_note": spec["description"],
            **({
                "zero_result_note": (
                    "Topic queries and the broad health control returned empty lists. "
                    "Search coverage is unconfirmed; inspect session/access or adapter "
                    "health before drawing a content-absence conclusion."
                )
            } if platform_status == "zero_results" else {}),
            **({
                "control_note": (
                    "The broad health control returned content while all topic queries "
                    "were empty. This supports adapter responsiveness, not topic absence."
                )
            } if platform_status == "control_ok_topic_zero" else {}),
            "query_results": query_results,
        })

    result = {
        "schema_version": 1,
        "created_at": stamp,
        "query": args.query,
        "queries": queries,
        "lead_search_plan": lead_plan,
        "weixin_pages_per_query": args.weixin_pages,
        "requested_platforms": requested,
        "browser_policy": (
            "Reuse the connected OpenCLI profile in the currently running Edge; this search "
            "script never starts or terminates Edge. Each command uses an ephemeral site "
            "session with keep-tab=false so OpenCLI releases its temporary tab lease afterward."
        ) if opencli_platforms else "No browser was used; this run requested the official Qichacha API only.",
        "browser_lifecycle": {
            "site_session": "ephemeral",
            "keep_tab": False,
            "window_mode": args.window,
            "cleanup": "OpenCLI closeWindow cleanup on success and failure; Edge process is retained.",
        } if opencli_platforms else None,
        "opencli_probe": probe,
        "results": records,
    }
    worked_queries, weak_queries, learned_channels = learning_signals(
        records,
        lead_terms=args.term if args.lead_search else None,
        location=args.location if args.lead_search else "",
    )
    if worked_queries or weak_queries:
        event_id = f"platform-search-{uuid4().hex}"
        try:
            record_event({
                "event_id": event_id,
                "label": f"Platform search: {args.query[:100]}",
                "summary": f"Search query outcomes for {args.query[:180]}",
                "domain": "enterprise_prospecting" if args.lead_search else "platform_research",
                "channels": learned_channels,
                "tools": ["platform_search.py"],
                "worked_queries": worked_queries,
                "weak_queries": weak_queries,
                "preference_observations": [],
                "result_feedback": [],
            })
            result["experience_learning"] = {
                "recorded": True,
                "worked_query_count": len(worked_queries),
                "weak_query_count": len(weak_queries),
                "event_id": event_id,
                "basis": "result returned or healthy adapter control confirmed topic zero",
            }
        except (OSError, TimeoutError, ValueError) as exc:
            result["experience_learning"] = {
                "recorded": False, "reason": type(exc).__name__,
            }
    else:
        result["experience_learning"] = {
            "recorded": False,
            "reason": "No verified query outcome; adapter/session failures are not learned as weak keywords.",
        }
    rendered = json.dumps(result, ensure_ascii=False, indent=2)
    if args.out:
        out_dir = Path(args.out).resolve()
        out_dir.mkdir(parents=True, exist_ok=True)
        path = out_dir / "platform_search.json"
        path.write_text(rendered + "\n", encoding="utf-8")
        print(f"saved={path}")
    print(rendered)
    completed = {
        "results_returned", "zero_results", "structured_output",
    }
    return 0 if any(
        item.get("status") in completed
        for record in records
        for item in record.get("query_results", [])
    ) else 2


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("query", help="One topic phrase, e.g. 识人技巧")
    parser.add_argument(
        "--platform", action="append", choices=tuple(PLATFORMS),
        default=None, help="Search a platform; repeat to search several sequentially",
    )
    parser.add_argument("--synonym", action="append", default=[],
                        help="Alternative wording; searched sequentially after the main query")
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument(
        "--weixin-pages", type=int, default=1,
        help="Search this many sequential result pages per WeChat query (max 10 results/page).",
    )
    parser.add_argument("--window", choices=("foreground", "background"),
                        default="background")
    parser.add_argument("--timeout", type=int, default=45)
    parser.add_argument(
        "--lead-search", action="store_true",
        help="Generate source-specific lead queries and reuse local query experience.",
    )
    parser.add_argument("--location", default="", help="Optional location for --lead-search")
    parser.add_argument("--term", action="append", default=[],
                        help="Additional product/industry term for --lead-search; repeatable")
    parser.add_argument("--max-queries-per-source", type=int, default=4)
    parser.add_argument(
        "--confirm-qcc-cost", action="store_true",
        help="Confirm one potentially billable Qichacha ApiCode 886 request (currently RMB 0.10/request).",
    )
    parser.add_argument("--out", help="Optional directory for platform_search.json")
    args = parser.parse_args()
    if args.limit < 1:
        parser.error("--limit must be at least 1")
    if args.weixin_pages < 1 or args.weixin_pages > 10:
        parser.error("--weixin-pages must be between 1 and 10")
    if args.timeout < 1:
        parser.error("--timeout must be at least 1")
    if not 1 <= args.max_queries_per_source <= 12:
        parser.error("--max-queries-per-source must be between 1 and 12")
    if args.limit > 100:
        parser.error("--limit must be at most 100 (1688 OpenCLI limit)")
    if args.platform is None:
        # Preserve the established content-research default. Marketplace and
        # registry lead routes must be selected explicitly by the user.
        args.platform = ["xiaohongshu", "zhihu", "weixin"]
    if "qichacha" in args.platform and not args.lead_search \
            and len(" ".join(args.query.split())) > 100:
        parser.error("Qichacha ApiCode 886 searchKey must be at most 100 characters")
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())
