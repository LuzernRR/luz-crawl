#!/usr/bin/env python3
"""Browser-free transport for the pages that do not need one.

Two of the three platforms serve their full body in the initial HTTP response,
so routing them through a browser costs seconds per page and buys nothing:

* **mp.weixin.qq.com** -- fully server-rendered, no cookies required.
* **xiaohongshu.com/explore/<id>** -- server-rendered into
  ``window.__INITIAL_STATE__`` and readable anonymously, *provided* the
  ``xsec_token`` query parameter is intact and the request carries Chinese
  ``Accept-Language``.

**zhihu.com is deliberately absent.** It answers a plain GET with 403 plus a
``zse-ck`` JavaScript challenge that derives ``__zse_ck`` from a per-request
server token and a fingerprinting routine. That has to be executed, so Zhihu
always goes through the browser transport.

Request identity is load-bearing, not cosmetic. Measured on WeChat: a desktop UA
with no Referer (or a WeChat one) returns the article, while a third-party
Referer, a mobile ``MicroMessenger`` UA, or no UA at all each return a 302 to an
error page. On Xiaohongshu, dropping ``Accept-Language: zh-CN`` is by itself
enough to turn a public page into a login redirect.

Parsing lives in :mod:`tc_extract` so this transport and the browser transport
can never disagree about what a page said.
"""

from __future__ import annotations

import asyncio
import time
import urllib.parse

import tc_extract

# A desktop Edge identity, matching the browser transport so both look alike.
DESKTOP_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0")

HEADERS = {
    "User-Agent": DESKTOP_UA,
    "Accept": ("text/html,application/xhtml+xml,application/xml;q=0.9,"
               "image/avif,image/webp,*/*;q=0.8"),
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Sec-Ch-Ua": '"Microsoft Edge";v="150", "Chromium";v="150", "Not?A_Brand";v="99"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
}

TIMEOUT = 25

# --- rate-limit policy, shared with the browser transport ---------------------
#
# Lives here rather than in each transport so the two cannot drift apart: both
# the plain-HTTP path and the Edge path hit the same hosts and the same limits.
# Xiaohongshu is the strictest of the three (reported ceiling ~10-20 req/min/IP).

HOST_PACING = {
    "xiaohongshu.com": 4.0,
    "zhihu.com": 2.5,
    "mp.weixin.qq.com": 1.5,
}
DEFAULT_PACING = 1.0


def host_of(url: str) -> str:
    netloc = urllib.parse.urlparse(url).netloc.lower()
    return netloc[4:] if netloc.startswith("www.") else netloc


def pacing_for(host: str) -> float:
    for suffix, delay in HOST_PACING.items():
        if host == suffix or host.endswith("." + suffix):
            return delay
    return DEFAULT_PACING


class HostPacer:
    """Keeps same-host requests serialized and spaced out.

    Requests to *different* hosts still run concurrently, which is where the
    real wall-clock savings are: the per-host limits are what matter, not a
    global cap.
    """

    def __init__(self):
        self._locks: dict[str, asyncio.Lock] = {}
        self._last: dict[str, float] = {}

    async def wait(self, url: str) -> None:
        host = host_of(url)
        lock = self._locks.setdefault(host, asyncio.Lock())
        async with lock:
            delay = pacing_for(host)
            elapsed = time.monotonic() - self._last.get(host, 0.0)
            if elapsed < delay:
                await asyncio.sleep(delay - elapsed)
            self._last[host] = time.monotonic()



def session():
    """A requests session with the desktop browser identity preloaded."""
    import requests

    sess = requests.Session()
    sess.headers.update(HEADERS)
    sess.trust_env = False  # ignore ambient proxy env vars
    return sess


def http_get(url: str, *, referer: str | None = None, timeout: int = TIMEOUT,
             sess=None, allow_redirects: bool = True):
    """GET with a desktop browser identity. Returns the ``requests`` response."""
    own = sess is None
    sess = sess or session()
    headers = {}
    if referer:
        headers["Referer"] = referer
        headers["Sec-Fetch-Site"] = "same-origin"
    try:
        return sess.get(url, headers=headers, timeout=timeout,
                        allow_redirects=allow_redirects)
    finally:
        if own:
            sess.close()


def eligible(url: str) -> str | None:
    """Return the platform key when a URL can be fetched without a browser."""
    host = urllib.parse.urlparse(url).netloc.lower()
    if host.endswith("mp.weixin.qq.com"):
        return "wechat"
    if host.endswith("xiaohongshu.com") and "/explore/" in url:
        # Without a token the note page redirects to /404, and only a browser
        # session can mint one.
        return "xhs" if "xsec_token=" in url else None
    return None


def fetch(url: str, *, sess=None, timeout: int = TIMEOUT) -> dict | None:
    """Extract a page without a browser, or None when the URL is not eligible."""
    platform = eligible(url)
    if platform is None:
        return None

    # Never send a third-party Referer: WeChat 302s to an error page on one, and
    # its image CDN swaps real images for a placeholder.
    referer = "https://mp.weixin.qq.com/" if platform == "wechat" else None
    try:
        response = http_get(url, referer=referer, timeout=timeout, sess=sess)
    except Exception as exc:
        return {"kind": f"{platform}_static", "title": "", "answers": [],
                "mode": f"static-{platform}",
                "error": f"static fetch failed ({type(exc).__name__}: {exc})"}

    if response.status_code != 200:
        return {"kind": f"{platform}_static", "title": "", "answers": [],
                "mode": f"static-{platform}",
                "error": f"static fetch http {response.status_code}"}

    response.encoding = response.apparent_encoding or "utf-8"
    record = tc_extract.parse(url, response.text)
    record["mode"] = f"static-{platform}"
    return record


async def fetch_many(urls, *, concurrency: int = 4, pacer: HostPacer | None = None,
                     timeout: int = TIMEOUT) -> dict[str, dict]:
    """Fetch many eligible URLs concurrently, paced per host.

    ``requests`` is synchronous, so each fetch runs in a worker thread; the
    concurrency cap and the per-host pacing together keep this polite while
    still overlapping work across the three platforms.
    """
    urls = [u for u in dict.fromkeys(urls) if eligible(u)]
    if not urls:
        return {}
    pacer = pacer or HostPacer()
    semaphore = asyncio.Semaphore(max(1, concurrency))
    sess = session()

    async def one(url: str):
        async with semaphore:
            await pacer.wait(url)
            return await asyncio.to_thread(fetch, url, sess=sess, timeout=timeout)

    try:
        records = await asyncio.gather(*(one(url) for url in urls))
    finally:
        sess.close()
    return {url: record for url, record in zip(urls, records) if record}


def fetch_explore_tokens(*, sess=None, timeout: int = TIMEOUT) -> list[dict]:
    """Harvest ``note_id`` + ``xsec_token`` pairs from the anonymous XHS feed."""
    try:
        response = http_get("https://www.xiaohongshu.com/explore",
                            timeout=timeout, sess=sess)
    except Exception:
        return []
    if response.status_code != 200:
        return []
    response.encoding = response.apparent_encoding or "utf-8"
    return tc_extract.harvest_explore_tokens(response.text)


def main() -> int:
    import argparse
    import json

    parser = argparse.ArgumentParser(
        description="Fetch a WeChat or Xiaohongshu page without a browser.")
    parser.add_argument("url", nargs="*")
    parser.add_argument("--explore-tokens", action="store_true",
                        help="harvest note_id+xsec_token pairs from the XHS feed")
    parser.add_argument("--excerpt", type=int, default=240)
    args = parser.parse_args()

    if args.explore_tokens:
        pairs = fetch_explore_tokens()
        print(f"harvested {len(pairs)} pairs")
        for pair in pairs:
            print(f"  {pair['note_id']}  {pair['url']}")

    for url in args.url:
        print(f"\n=== {url}")
        if eligible(url) is None:
            print("  not eligible for the static transport (browser required)")
            continue
        record = fetch(url) or {}
        print(f"  mode  : {record.get('mode')}")
        print(f"  title : {json.dumps(record.get('title', ''), ensure_ascii=True)}")
        if record.get("error"):
            print(f"  error : {record['error']}")
        for answer in record.get("answers", []):
            print(f"  author: {json.dumps(answer.get('author'), ensure_ascii=True)}"
                  f"  published: {answer.get('published')}")
            print(f"  chars : {answer.get('chars')}")
            print("  text  : " + json.dumps(
                (answer.get("text") or "")[:args.excerpt], ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
