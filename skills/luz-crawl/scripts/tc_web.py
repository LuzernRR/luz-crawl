#!/usr/bin/env python3
"""Discovery + lightweight extraction over plain HTTP.

* Exa REST for semantic discovery across the open web (Zhihu's own search is
  login-gated, so Zhihu/WeChat URLs are discovered from outside).
* Jina Reader for clean article text on hosts that do not block it.

This module is discovery plus host classification only. Fetching lives in the
two transports: :mod:`tc_static` for the server-rendered pages and
:mod:`tc_browser` for the ones that need a real Edge; the orchestrator routes
each URL between them.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request

EXA_ENDPOINT = "https://api.exa.ai/search"
JINA_ENDPOINT = "https://r.jina.ai/"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")

# Hosts that mirror content behind a paywall -- discovered but not extractable.
PAYWALLED = ("jintiankansha.me", "jintiankansha.com")

# --- platform allowlist -------------------------------------------------------
# Only these three platforms are crawled. Everything else is dropped at
# discovery, before a single page is fetched.
ALLOWED_PLATFORMS = {
    "zhihu": {"label": "知乎", "domains": ["zhihu.com", "zhuanlan.zhihu.com"]},
    "wechat": {"label": "微信公众号", "domains": ["mp.weixin.qq.com"]},
    "xhs": {"label": "小红书", "domains": ["xiaohongshu.com"]},
}

# Zhihu paths that are never an article: profiles, topics, paid columns, pins.
_ZHIHU_DROP = ("/pin/", "/market/", "/xen/", "/people/", "/org/", "/topic/",
               "/column/", "/special/", "/roundtable/", "/collection/",
               "/lives/", "/club/", "/search", "/signin", "/education/")
# Xiaohongshu subdomains that serve recruiting / advertising / design docs.
_XHS_DROP_HOST = ("rpdc.", "job.", "pgy.", "ark.", "open.", "business.",
                  "ad.", "school.", "spider.")


def _normalize_zhihu(host: str, path: str, query: str) -> str | None:
    """Fold Zhihu's many URL shapes onto a canonical crawlable page.

    Zhihu serves the same answer under `/tardis/...` mobile-landing paths and
    `/en/...` machine-translated paths; both render poorly or not at all, but the
    numeric id in them maps onto a real page.
    """
    # /tardis/zm/art/667078331, /tardis/sogou/art/123 -> a column post
    match = re.search(r"/tardis/[^/]+(?:/[^/]+)*?/art/(\d+)", path)
    if match:
        return f"https://zhuanlan.zhihu.com/p/{match.group(1)}"
    # /tardis/landing/m/360/ans/974486500 -> a standalone answer
    match = re.search(r"/tardis/.*?/ans/(\d+)", path)
    if match:
        return f"https://www.zhihu.com/answer/{match.group(1)}"
    path = re.sub(r"^/(?:en|zh|zh-cn)(?=/)", "", path)   # drop locale prefix
    if any(token in path for token in _ZHIHU_DROP):
        return None
    # A question page carries every answer, so prefer it over a single answer.
    match = re.search(r"/question/(\d+)", path)
    if match:
        return f"https://www.zhihu.com/question/{match.group(1)}"
    match = re.search(r"/p/(\d+)", path)
    if match:
        return f"https://zhuanlan.zhihu.com/p/{match.group(1)}"
    match = re.search(r"^/answer/(\d+)", path)
    if match:
        return f"https://www.zhihu.com/answer/{match.group(1)}"
    return None


def normalize_candidate(url: str) -> tuple[str, str] | None:
    """Return ``(canonical_url, platform_key)`` or None if not an allowed article.

    This is the single gate that enforces the Zhihu / WeChat / Xiaohongshu
    restriction; the orchestrator drops everything for which it returns None.
    """
    if not url:
        return None
    parts = urllib.parse.urlsplit(url.strip())
    host = (parts.hostname or "").lower()
    path, query = parts.path, parts.query

    if "zhihu.com" in host:
        canonical = _normalize_zhihu(host, path, query)
        return (canonical, "zhihu") if canonical else None

    if "weixin.qq.com" in host:
        # Only the permanent article form /s/<id> or /s?__biz=...  is readable.
        if re.match(r"^/s/[\w\-]+", path):
            return f"https://mp.weixin.qq.com{path}", "wechat"
        if path.startswith("/s") and "__biz=" in query:
            return f"https://mp.weixin.qq.com/s?{query}", "wechat"
        return None

    if "xiaohongshu.com" in host or "xhslink.com" in host:
        if any(host.startswith(prefix) for prefix in _XHS_DROP_HOST):
            return None
        match = re.search(r"/(?:explore|discovery/item)/([0-9a-f]{12,32})", path)
        if match:
            # xsec_token is session-bound but required; keep the query intact.
            suffix = f"?{query}" if query else ""
            return f"https://www.xiaohongshu.com/explore/{match.group(1)}{suffix}", "xhs"
        return None

    return None

# Anti-bot / interstitial / login-wall markers. A body containing any of these is
# not article text, however long it is.
_INTERSTITIAL = (
    "just a moment", "enable javascript and cookies", "checking your browser",
    "cf-browser-verification", "cf_chl_opt", "challenges.cloudflare.com",
    "attention required", "ddos protection", "access denied",
    "安全验证", "环境异常", "请开启javascript", "验证码", "滑动验证",
    "您的请求存在异常", "请稍后再试", "操作太快", "人机验证",
    "登录后查看", "请先登录", "注册登录", "打开app查看",
    "你似乎来到了没有知识存在的荒原",
)

# Markup that means we captured HTML source rather than rendered text.
_MARKUP = ("<!doctype", "<html", "<head", "<script", "<style", "<div", "<meta ")


def body_quality(text: str, *, min_chars: int = 300) -> tuple[bool, str]:
    """Decide whether extracted text is real article prose.

    Returns ``(ok, reason)``. Guards against the three ways this pipeline
    silently produced garbage: anti-bot interstitials, raw HTML, and pages that
    are mostly navigation chrome.
    """
    if not text or len(text) < min_chars:
        return False, f"too short ({len(text or '')} chars)"

    head = text[:4000].lower()
    for marker in _INTERSTITIAL:
        if marker in head:
            return False, f"interstitial/login wall ({marker!r})"

    markup_hits = sum(head.count(tag) for tag in _MARKUP)
    if markup_hits >= 3:
        return False, f"raw HTML rather than text ({markup_hits} markup tags)"
    if text.count("<") > len(text) / 100:
        return False, "markup-dense body"

    # Prose has sentence punctuation; navigation dumps do not.
    sentences = sum(text.count(mark) for mark in "。！？.!?；;")
    if sentences < 3:
        return False, f"no sentence structure ({sentences} terminators)"

    # Link/menu dumps show up as many very short newline-separated fragments.
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if lines:
        short = sum(1 for line in lines if len(line) < 12)
        if len(lines) >= 12 and short / len(lines) > 0.72:
            return False, "mostly short nav fragments"
    return True, "ok"


def _post_json(url: str, payload: dict, headers: dict, timeout: int = 60) -> dict:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(url, data=body, method="POST",
                                     headers={"Content-Type": "application/json", **headers})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def exa_search(query: str, *, num_results: int = 10, api_key: str | None = None,
               include_domains: list[str] | None = None,
               snippet_chars: int = 600, timeout: int = 30,
               retries: int = 1) -> list[dict]:
    """Semantic search with explicit configuration errors and one transient retry."""
    api_key = api_key or os.environ.get("EXA_API_KEY", "")
    if not api_key:
        return [{"error": "EXA_API_KEY is not configured", "query": query,
                 "attempts": 0}]
    payload: dict = {
        "query": query,
        "numResults": num_results,
        "type": "auto",
        "contents": {"text": {"maxCharacters": snippet_chars}},
    }
    if include_domains:
        payload["includeDomains"] = include_domains
    data = None
    max_attempts = max(1, retries + 1)
    for attempt in range(1, max_attempts + 1):
        try:
            data = _post_json(EXA_ENDPOINT, payload, {"x-api-key": api_key},
                              timeout=timeout)
            break
        except Exception as exc:
            if isinstance(exc, urllib.error.HTTPError):
                retryable = exc.code == 429 or 500 <= exc.code < 600
            else:
                retryable = isinstance(
                    exc, (urllib.error.URLError, TimeoutError, ConnectionError,
                          ConnectionResetError))
            if retryable and attempt < max_attempts:
                time.sleep(min(0.5 * attempt, 1.0))
                continue
            return [{"error": f"{type(exc).__name__}: {exc}"[:200],
                     "query": query, "attempts": attempt}]
    if data is None:
        return [{"error": "Exa search returned no response", "query": query,
                 "attempts": max_attempts}]
    out = []
    for item in data.get("results", []):
        out.append({
            "title": (item.get("title") or "").strip(),
            "url": item.get("url"),
            "author": item.get("author"),
            "published": (item.get("publishedDate") or "")[:10] or None,
            "snippet": (item.get("text") or "").strip()[:snippet_chars],
            "found_via": query,
        })
    return out


def jina_fetch(url: str, *, timeout: int = 60, api_key: str | None = None) -> dict:
    """Read an article as markdown through Jina Reader.

    Uses curl rather than urllib: Jina rejects Python's TLS fingerprint with a
    403 regardless of request headers, while curl is accepted.
    """
    command = ["curl", "-sS", "--compressed", "--max-time", str(timeout),
               "-A", UA, JINA_ENDPOINT + url]
    api_key = api_key or os.environ.get("JINA_API_KEY")
    if api_key:
        command[-1:-1] = ["-H", f"Authorization: Bearer {api_key}"]
    try:
        result = subprocess.run(command, capture_output=True, timeout=timeout + 15, check=False)
        raw = result.stdout.decode("utf-8", errors="replace")
        if result.returncode != 0 or not raw.strip():
            detail = result.stderr.decode("utf-8", errors="replace").strip()
            return {"source_url": url, "ok": False,
                    "error": f"curl exit {result.returncode}: {detail}"[:200]}
    except Exception as exc:
        return {"source_url": url, "ok": False, "error": f"{type(exc).__name__}: {exc}"[:200]}

    if "Warning: Target URL returned error 4" in raw or "Warning: Target URL returned error 5" in raw:
        status = re.search(r"returned error (\d+)", raw)
        return {"source_url": url, "ok": False,
                "error": f"upstream HTTP {status.group(1) if status else '4xx'}"}

    title = re.search(r"^Title:\s*(.+)$", raw, re.MULTILINE)
    body = raw.split("Markdown Content:", 1)[-1].strip()
    body = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", body)          # strip images
    body = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", body)      # unwrap links
    body = re.sub(r"\n{3,}", "\n\n", body).strip()
    ok, reason = body_quality(body)
    return {
        "source_url": url,
        "ok": ok,
        "kind": "web_article",
        "title": (title.group(1).strip() if title else None),
        "answers": ([{
            "author": None, "author_bio": None, "voteup": None, "published": None,
            "url": url, "text": body, "chars": len(body),
        }] if ok else []),
        "error": None if ok else reason,
    }


def is_paywalled(url: str) -> bool:
    host = (urllib.parse.urlparse(url).hostname or "").lower()
    return any(domain in host for domain in PAYWALLED)


if __name__ == "__main__":
    import argparse
    import sys

    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("query")
    parser.add_argument("-n", type=int, default=8)
    parser.add_argument("--fetch", metavar="URL")
    args = parser.parse_args()

    if args.fetch:
        record = jina_fetch(args.fetch)
        print(json.dumps({k: v for k, v in record.items() if k != "answers"}, ensure_ascii=False))
        for answer in record.get("answers", []):
            print(f"  {answer['chars']} chars")
    else:
        for i, result in enumerate(exa_search(args.query, num_results=args.n), 1):
            print(f"{i:>2}. {result.get('title', '')[:64]}")
            print(f"    {result.get('url')}  ({result.get('published')})")
