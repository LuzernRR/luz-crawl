#!/usr/bin/env python3
"""Silent Edge transport for pages a plain HTTP GET cannot read.

Division of labour
------------------
This module's only job is to *obtain* HTML. Every parser lives in
:mod:`tc_extract`, so the browser transport and the static transport can never
disagree about what a page said, and a selector fix lands for both at once.

Only Zhihu genuinely needs this path: it answers a bare GET with 403 and a
``zse-ck`` JavaScript challenge that must be executed. Xiaohongshu note pages
and WeChat articles are server-rendered and belong to :mod:`tc_static`; they are
still supported here as a fallback for when a token is missing or a static fetch
is refused.

Browser policy
--------------
The browser comes from :mod:`edge_session`, which adopts an already-running
CDP-enabled Edge when one exists and otherwise launches the Edge named by
``C:\\Users\\Public\\Desktop\\Microsoft Edge.lnk`` -- windowless, no popups, and
reaped on the way out. A browser this process launched is always closed; a
browser it merely adopted is never touched.

Efficiency
----------
* Images, media and fonts are aborted at the network layer. Scripts and
  stylesheets are kept, because Zhihu's challenge and Xiaohongshu's SSR
  hydration both need JS to run.
* Waits are on the signal each platform actually provides (the
  ``js-initialData`` script tag, ``window.__INITIAL_STATE__``, ``#js_content``)
  instead of a fixed sleep, so a fast page finishes fast.
* Requests run concurrently across hosts but are paced per host, which is where
  the rate limits live.
* Zhihu answer-expansion scrolling is skipped when a login wall is present,
  because the wall caps the page at three answers however far you scroll.
"""

from __future__ import annotations

import asyncio
import json
import time
import urllib.parse

import edge_session
import tc_extract
import tc_static

DEFAULT_PROFILE = edge_session.DEFAULT_PROFILE
# Kept for callers that still pass an explicit endpoint; no longer a default.
DEFAULT_CDP = "http://127.0.0.1:9223"

BLOCKED_RESOURCES = {"image", "media", "font"}

# navigator.webdriver is already false because we launch a plain Edge with no
# --enable-automation, but assert it anyway: adopting someone else's Edge, or a
# future Playwright change, could reintroduce the tell.
_STEALTH = """
Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
"""

_NAV_TIMEOUT = 45_000


async def probe_cdp(endpoint: str | None) -> bool:
    """True when ``endpoint`` is a live CDP endpoint *and* it is Edge.

    The identity half is the point. A stray headless Chrome on 9222 answers
    ``/json/version`` perfectly well, and silently crawling through it yields a
    browser with none of the state this skill depends on.
    """
    if not endpoint:
        return False
    version = await asyncio.to_thread(edge_session.probe_endpoint, endpoint)
    return edge_session.is_edge(version)


class BrowserSession:
    """An async context manager over a silent Edge, parsing via tc_extract."""

    def __init__(self, cdp: str | None = None, profile: str = DEFAULT_PROFILE,
                 *, headless: bool = True, adopt: bool = True,
                 block_assets: bool = True, concurrency: int = 3,
                 expand: bool = True, verbose: bool = False):
        self.cdp = cdp
        self.profile = profile
        self.headless = headless
        self.adopt = adopt
        self.block_assets = block_assets
        self.concurrency = max(1, concurrency)
        self.expand = expand
        self.verbose = verbose

        self.handle: edge_session.EdgeHandle | None = None
        self._pw = None
        self._browser = None
        self._ctx = None
        self._own_pages: list = []
        self._pacer = tc_static.HostPacer()
        self._gate_hits = 0

    # --- lifecycle ---

    async def __aenter__(self) -> "BrowserSession":
        from playwright.async_api import async_playwright

        self.handle = await asyncio.to_thread(
            edge_session.acquire, profile=self.profile, headless=self.headless,
            adopt=self.adopt, endpoint=self.cdp)
        self._pw = await async_playwright().start()
        try:
            await self._attach()
        except Exception:
            await self.__aexit__(None, None, None)
            raise
        return self

    async def _attach(self) -> None:
        self._browser = await self._pw.chromium.connect_over_cdp(
            self.handle.endpoint, timeout=30_000)
        self._ctx = (self._browser.contexts[0] if self._browser.contexts
                     else await self._browser.new_context())
        try:
            await self._ctx.add_init_script(_STEALTH)
        except Exception:
            pass
        if self.block_assets:
            await self._ctx.route("**/*", self._router)

    async def _router(self, route, request):
        try:
            if request.resource_type in BLOCKED_RESOURCES:
                await route.abort()
            else:
                await route.continue_()
        except Exception:
            # A route handler raising would hang the navigation; never let it.
            try:
                await route.continue_()
            except Exception:
                pass

    async def __aexit__(self, *_exc) -> None:
        for page in self._own_pages:
            try:
                await page.close()
            except Exception:
                pass
        self._own_pages.clear()
        # Only ever call close() on a browser we launched. Playwright's
        # behaviour for CDP-attached browsers has varied across versions, and on
        # an adopted browser a close() that does propagate would take down the
        # user's own Edge session. Dropping the Playwright connection is enough.
        if self._browser is not None:
            if self.handle is not None and self.handle.owned:
                try:
                    await self._browser.close()
                except Exception:
                    pass
            self._browser = None
        if self._pw is not None:
            try:
                await self._pw.stop()
            except Exception:
                pass
            self._pw = None
        if self.handle is not None:
            await asyncio.to_thread(self.handle.close)
            self.handle = None

    async def _new_page(self):
        page = await self._ctx.new_page()
        self._own_pages.append(page)
        page.set_default_timeout(_NAV_TIMEOUT)
        return page

    async def _close_page(self, page) -> None:
        try:
            await page.close()
        except Exception:
            pass
        if page in self._own_pages:
            self._own_pages.remove(page)

    # --- page readiness ---

    async def _settle(self, page, url: str) -> None:
        """Wait for the signal the platform actually provides.

        Each of the three embeds its payload in the document, so there is no
        reason to wait for a network-idle event or a fixed sleep.
        """
        platform = tc_extract.platform_of(url)
        try:
            if platform == "zhihu":
                # The zse-ck challenge sets a cookie then reloads; waiting on the
                # blob rather than a timer rides that reload out.
                await page.wait_for_selector("script#js-initialData",
                                             state="attached", timeout=25_000)
            elif platform == "xhs":
                await page.wait_for_function(
                    "() => !!window.__INITIAL_STATE__", timeout=25_000)
            elif platform == "wechat":
                await page.wait_for_selector("#js_content", state="attached",
                                             timeout=20_000)
            else:
                await page.wait_for_load_state("domcontentloaded", timeout=20_000)
        except Exception:
            # Fall through and let the extractor report what it actually found;
            # a timeout here is not proof the payload is missing.
            pass

    async def _expand_zhihu(self, page) -> int:
        """Scroll a question page to pull in lazily loaded answers.

        Skipped when a login wall is on the page: anonymous sessions are capped
        at three answers no matter how far you scroll, so the rounds would be
        pure latency.
        """
        try:
            walled = await page.evaluate(
                "() => !!document.querySelector('.signFlowModal, .Modal-wrapper,"
                " .Modal-enter-done')")
        except Exception:
            walled = True
        if walled:
            return 0

        rounds = 0
        seen = 0
        for _ in range(6):
            try:
                count = await page.evaluate(
                    "() => document.querySelectorAll('.List-item, .AnswerItem').length")
            except Exception:
                break
            if count == seen and rounds:
                break
            seen = count
            rounds += 1
            try:
                await page.evaluate("() => window.scrollBy(0, document.body.scrollHeight)")
                await page.wait_for_timeout(900)
            except Exception:
                break
        return rounds

    # --- fetching ---

    async def fetch(self, url: str) -> dict:
        """Load one URL through Edge and extract it. Never raises."""
        await self._pacer.wait(url)
        page = await self._new_page()
        started = time.monotonic()
        try:
            response = await page.goto(url, wait_until="domcontentloaded",
                                       timeout=_NAV_TIMEOUT)
            status = response.status if response else None
            await self._settle(page, url)
            if self.expand and tc_extract.platform_of(url) == "zhihu" \
                    and "/question/" in url:
                await self._expand_zhihu(page)
            html = await page.content()
            final_url = page.url or url
        except Exception as exc:
            await self._close_page(page)
            return {"kind": "error", "title": "", "answers": [],
                    "mode": "browser",
                    "error": f"navigation failed ({type(exc).__name__}: "
                             f"{str(exc)[:200]})"}
        await self._close_page(page)

        record = tc_extract.parse(url, html)
        record["mode"] = "browser-headless" if self.headless else "browser-headed"
        record["http_status"] = status
        record["elapsed_ms"] = int((time.monotonic() - started) * 1000)
        if final_url.split("#")[0] != url.split("#")[0]:
            record["final_url"] = final_url
        if record.get("error"):
            self._gate_hits += 1
        if self.verbose:
            print(f"  [{record['mode']}] {status} {record['elapsed_ms']}ms "
                  f"{len(record.get('answers') or [])} answers  {url[:80]}")
        return record

    async def fetch_many(self, urls, *, escalate: bool = True) -> list[dict]:
        """Fetch many URLs concurrently, paced per host.

        When a headless run trips a platform gate and we own the browser, the
        gated URLs are retried once through a silent *headed* Edge: some
        platforms refuse the headless renderer specifically, and a headed
        browser parked off-screen is still invisible to the user.
        """
        urls = list(dict.fromkeys(urls))
        semaphore = asyncio.Semaphore(self.concurrency)

        async def one(url):
            async with semaphore:
                return await self.fetch(url)

        records = await asyncio.gather(*(one(url) for url in urls))
        results = dict(zip(urls, records))

        if escalate and self.headless and self.handle and self.handle.owned:
            gated = [url for url, rec in results.items()
                     if _looks_gated(rec)]
            if gated:
                if await self._escalate_headed():
                    retried = await asyncio.gather(*(one(url) for url in gated))
                    for url, rec in zip(gated, retried):
                        # Keep the retry only when it actually did better.
                        if rec.get("answers") or not results[url].get("answers"):
                            results[url] = rec
        return [results[url] for url in urls]

    async def _escalate_headed(self) -> bool:
        """Swap the owned headless Edge for a silent headed one."""
        if not (self.handle and self.handle.owned):
            return False
        try:
            await self.__aexit__(None, None, None)
        except Exception:
            pass
        from playwright.async_api import async_playwright

        self.headless = False
        self.handle = await asyncio.to_thread(
            edge_session.launch, profile=self.profile, headless=False)
        self._pw = await async_playwright().start()
        try:
            await self._attach()
        except Exception:
            return False
        if self.verbose:
            print("  escalated to headed-offscreen Edge after a platform gate")
        return True

    # --- in-site search (login-gated; reports rather than works around) ---

    async def zhihu_search(self, term: str, limit: int = 10) -> list[dict]:
        """Zhihu in-site search. Requires a logged-in profile."""
        url = ("https://www.zhihu.com/search?type=content&q="
               + urllib.parse.quote(term))
        page = await self._new_page()
        try:
            await self._pacer.wait(url)
            await page.goto(url, wait_until="domcontentloaded", timeout=_NAV_TIMEOUT)
            await page.wait_for_timeout(2000)
            items = await page.evaluate(
                """(limit) => Array.from(
                     document.querySelectorAll('.SearchResult-Card a[href*="/answer/"],'
                     + ' .SearchResult-Card a[href*="zhuanlan.zhihu.com/p/"]'))
                   .map(a => ({url: a.href, title: (a.innerText || '').trim()}))
                   .filter(x => x.url).slice(0, limit)""", limit)
            gate = await page.evaluate(
                "() => /登录|验证|安全/.test(document.body.innerText.slice(0, 1500))")
        except Exception as exc:
            await self._close_page(page)
            return [{"error": f"zhihu search failed ({type(exc).__name__}: {exc})"}]
        await self._close_page(page)
        if not items and gate:
            return [{"error": "zhihu search is login-gated for this profile"}]
        return items

    async def xhs_search(self, term: str, limit: int = 10) -> list[dict]:
        """Xiaohongshu keyword search. Login-gated; the feed is the fallback."""
        url = ("https://www.xiaohongshu.com/search_result?keyword="
               + urllib.parse.quote(term))
        page = await self._new_page()
        try:
            await self._pacer.wait(url)
            await page.goto(url, wait_until="domcontentloaded", timeout=_NAV_TIMEOUT)
            await page.wait_for_timeout(2500)
            html = await page.content()
        except Exception as exc:
            await self._close_page(page)
            return [{"error": f"xhs search failed ({type(exc).__name__}: {exc})"}]
        await self._close_page(page)

        state = tc_extract.parse_initial_state(html) or {}
        feeds = ((state.get("search") or {}).get("feeds")) or []
        out = []
        for item in feeds[:limit]:
            card = (item or {}).get("noteCard") or {}
            note_id = item.get("id") or card.get("noteId")
            token = item.get("xsecToken") or card.get("xsecToken")
            if not (note_id and token):
                continue
            out.append({
                "url": (f"https://www.xiaohongshu.com/explore/{note_id}"
                        f"?xsec_token={token}&xsec_source=pc_search"),
                "title": (card.get("displayTitle") or "").strip(),
            })
        if not out:
            return [{"error": "xhs keyword search returned no feed "
                              "(anonymous sessions only get the explore feed)"}]
        return out

    async def explore_tokens(self, limit: int = 30) -> list[dict]:
        """Harvest note id + xsec_token pairs from the anonymous explore feed.

        Note detail pages 404 without a token bound to that note, so this is how
        the static transport gets usable Xiaohongshu URLs.
        """
        url = "https://www.xiaohongshu.com/explore"
        page = await self._new_page()
        try:
            await self._pacer.wait(url)
            await page.goto(url, wait_until="domcontentloaded", timeout=_NAV_TIMEOUT)
            await page.wait_for_function("() => !!window.__INITIAL_STATE__",
                                         timeout=25_000)
            html = await page.content()
        except Exception:
            await self._close_page(page)
            return []
        await self._close_page(page)
        return tc_extract.harvest_explore_tokens(html)[:limit]


def _looks_gated(record: dict) -> bool:
    """True when a record failed in a way a different renderer might fix."""
    if record.get("answers"):
        return False
    error = (record.get("error") or "").lower()
    return any(token in error for token in
               ("gate", "安全", "navigation failed", "no parseable",
                "no answer body", "timeout"))


async def _main() -> int:
    import argparse

    parser = argparse.ArgumentParser(
        description="Fetch pages through a silent, self-closing Microsoft Edge.")
    parser.add_argument("url", nargs="*")
    parser.add_argument("--cdp", default=None,
                        help="attach to this CDP endpoint instead of launching")
    parser.add_argument("--profile", default=DEFAULT_PROFILE)
    parser.add_argument("--headed", action="store_true",
                        help="start headed-offscreen instead of headless")
    parser.add_argument("--no-adopt", action="store_true",
                        help="always launch a fresh Edge")
    parser.add_argument("--no-block-assets", action="store_true")
    parser.add_argument("--no-expand", action="store_true")
    parser.add_argument("--concurrency", type=int, default=3)
    parser.add_argument("--excerpt", type=int, default=200)
    parser.add_argument("--zhihu-search")
    parser.add_argument("--xhs-search")
    parser.add_argument("--explore-tokens", action="store_true")
    args = parser.parse_args()

    async with BrowserSession(cdp=args.cdp, profile=args.profile,
                              headless=not args.headed, adopt=not args.no_adopt,
                              block_assets=not args.no_block_assets,
                              concurrency=args.concurrency,
                              expand=not args.no_expand,
                              verbose=True) as session:
        print(f"endpoint {session.handle.endpoint} owned={session.handle.owned}")

        if args.explore_tokens:
            pairs = await session.explore_tokens()
            print(f"\nharvested {len(pairs)} note id+token pairs")
            for pair in pairs[:8]:
                print(f"  {pair['note_id']}  {pair['url'][:110]}")

        for label, term in (("zhihu", args.zhihu_search), ("xhs", args.xhs_search)):
            if not term:
                continue
            search = session.zhihu_search if label == "zhihu" else session.xhs_search
            print(f"\n{label} search {term!r}")
            for hit in await search(term):
                print("  " + json.dumps(hit, ensure_ascii=True)[:200])

        if args.url:
            print()
            records = await session.fetch_many(args.url)
            for record in records:
                print(f"\n=== {record.get('kind')}  {record.get('mode')}  "
                      f"http={record.get('http_status')}  "
                      f"{record.get('elapsed_ms')}ms")
                print("  title : " + json.dumps(record.get("title", ""),
                                                ensure_ascii=True)[:140])
                if record.get("error"):
                    print(f"  error : {record['error']}")
                for answer in record.get("answers", [])[:3]:
                    print(f"  - author={json.dumps(answer.get('author'), ensure_ascii=True)}"
                          f" voteup={answer.get('voteup')} chars={answer.get('chars')}")
                    print("    " + json.dumps(
                        (answer.get("text") or "")[:args.excerpt], ensure_ascii=True))
    for line in edge_session.launch_notes():
        print(f"  note: {line}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
