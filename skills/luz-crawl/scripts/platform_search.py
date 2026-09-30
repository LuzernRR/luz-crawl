#!/usr/bin/env python3
"""Search Xiaohongshu, Zhihu, and WeChat articles through the current OpenCLI browser.

This tool never launches a browser. It runs read-only OpenCLI search commands
only after the existing Browser Bridge reports a connected browser profile.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import sys
import time
from typing import Any

from tool_preflight import _run_opencli, probe_opencli


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
}

# Broad positive controls used only when every topic query returns an empty list.
# They diagnose whether the adapter is returning any content; they are never
# mixed into the topic-result count or used as evidence about the topic itself.
CONTROL_QUERIES = {
    "xiaohongshu": "穿搭",
    "zhihu": "如何评价",
    "weixin": "人工智能",
}


def extract_result_count(value: Any) -> int | None:
    """Count records in common OpenCLI JSON result envelopes."""
    if isinstance(value, list):
        return len(value)
    if isinstance(value, dict):
        for key in ("results", "items", "data", "feeds", "notes", "answers"):
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
    if site in {"xiaohongshu", "zhihu"}:
        args += ["--limit", str(limit)]
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
        "raw_output": output,
        **({
            "interpretation_note": (
                "The adapter returned an empty list. This alone does not prove "
                "that no matching content exists; verify session/access or run "
                "a known-good control query before concluding absence."
            )
        } if status == "zero_results" else {}),
    }


def run(args: argparse.Namespace) -> int:
    executable = shutil.which("opencli")
    if not executable:
        print("opencli is not installed", file=sys.stderr)
        return 2

    requested = list(dict.fromkeys(args.platform))
    queries = list(dict.fromkeys([args.query, *args.synonym]))
    probe = probe_opencli(
        {"opencli": executable},
        ["小红书" if p == "xiaohongshu" else
         "知乎" if p == "zhihu" else "微信公众号" for p in requested],
        timeout=args.timeout,
    )
    stamp = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
    records: list[dict] = []
    if not probe.get("bridge_connected"):
        for platform in requested:
            spec = PLATFORMS[platform]
            records.append({
                "platform": spec["label"],
                "site_adapter": spec["site"],
                "status": "blocked",
                "search_executed": False,
                "reason": "OpenCLI Browser Bridge is not connected to the existing browser.",
                "route_note": spec["description"],
                "queries_not_run": queries,
            })
    else:
        for platform in requested:
            spec = PLATFORMS[platform]
            site_probe = probe.get("site_search", {}).get(spec["site"], {})
            if not site_probe.get("search_available"):
                records.append({
                    "platform": spec["label"],
                    "site_adapter": spec["site"],
                    "status": "unsupported",
                    "search_executed": False,
                    "reason": site_probe.get("error") or "Site adapter has no search command.",
                    "route_note": spec["description"],
                    "queries_not_run": queries,
                })
                continue

            query_results: list[dict] = []
            for query in queries:
                pages = range(1, args.weixin_pages + 1) if spec["site"] == "weixin" else (1,)
                for page in pages:
                    query_results.append(run_one_search(
                        executable, spec["site"], query, args.limit,
                        args.window, args.timeout, page=page,
                    ))
                    # Do not keep issuing browser commands after the Bridge drops.
                    if "browser bridge extension not connected" in query_results[-1]["raw_output"].lower():
                        break
                if query_results and "browser bridge extension not connected" in query_results[-1]["raw_output"].lower():
                    break

            topic_results = [item for item in query_results if item["query_role"] == "topic"]
            if (topic_results and all(item["status"] == "zero_results" for item in topic_results)
                    and not any("browser bridge extension not connected" in item["raw_output"].lower()
                                for item in topic_results)):
                control_query = CONTROL_QUERIES[spec["site"]]
                if control_query not in queries:
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
                    platform_status = "zero_results"
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
            # Do not continue to another platform after the Bridge drops.
            if any("browser bridge extension not connected" in item.get("raw_output", "").lower()
                   for item in query_results):
                break

    result = {
        "schema_version": 1,
        "created_at": stamp,
        "query": args.query,
        "queries": queries,
        "weixin_pages_per_query": args.weixin_pages,
        "requested_platforms": requested,
        "browser_policy": (
            "Reuse the connected OpenCLI profile in the currently running Edge; this search "
            "script never starts or terminates Edge. Each command uses an ephemeral site "
            "session with keep-tab=false so OpenCLI releases its temporary tab lease afterward."
        ),
        "browser_lifecycle": {
            "site_session": "ephemeral",
            "keep_tab": False,
            "window_mode": args.window,
            "cleanup": "OpenCLI closeWindow cleanup on success and failure; Edge process is retained.",
        },
        "opencli_probe": probe,
        "results": records,
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
    parser.add_argument("--out", help="Optional directory for platform_search.json")
    args = parser.parse_args()
    if args.limit < 1:
        parser.error("--limit must be at least 1")
    if args.weixin_pages < 1 or args.weixin_pages > 10:
        parser.error("--weixin-pages must be between 1 and 10")
    if args.timeout < 1:
        parser.error("--timeout must be at least 1")
    if args.platform is None:
        args.platform = list(PLATFORMS)
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())
