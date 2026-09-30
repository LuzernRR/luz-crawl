#!/usr/bin/env python3
"""Topic -> multi-platform article crawl -> deduplicated evidence packet.

Pipeline
    1. expand   a topic into synonym-varied queries (tc_query)
    2. discover candidate URLs across platforms (Exa; Zhihu search when logged in)
    3. extract  each candidate -- real browser for Zhihu/WeChat, Jina elsewhere
    4. dedupe   by URL, title and author+body fingerprint; cap per author so one
                prolific writer cannot crowd out the rest
    5. report   manifest.json + digest.md, with full text archived under raw/

Usage
    python topic_crawl.py "你有哪些特殊的识人技巧？" \
        --synonym 识人术 --synonym 看透一个人 \
        --out "$env:USERPROFILE\Documents\luz-crawl\crawl" --cdp
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import hashlib
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)

import tc_browser  # noqa: E402
import tc_static  # noqa: E402
import tc_query  # noqa: E402
import tc_web  # noqa: E402

PLATFORMS = {key: spec["label"] for key, spec in tc_web.ALLOWED_PLATFORMS.items()}

# Discovery targets. Exa is queried per-platform: a combined includeDomains call
# skews to whichever domain ranks best, so each platform gets its own budget.
# Xiaohongshu is absent on purpose -- Exa returns profiles and recruiting pages
# for it, so its notes come from in-site search instead.
EXA_TARGETS = (
    ("wechat", ["mp.weixin.qq.com"]),
    ("zhihu", ["zhihu.com", "zhuanlan.zhihu.com"]),
)


def platform_of(url: str) -> str:
    hit = tc_web.normalize_candidate(url)
    if hit:
        return PLATFORMS[hit[1]]
    host = (urlparse(url).hostname or "").lower()
    return host.replace("www.", "") or "unknown"


def norm_title(title: str | None) -> str:
    """Collapse a title to a comparison key (strips punctuation and site suffix)."""
    text = re.sub(r"[\s\-_|—－｜]+", "", (title or ""))
    text = re.sub(r"[^\w\u4e00-\u9fff]", "", text)
    return text[:40].lower()


def fingerprint(text: str) -> str:
    """Stable hash of the first substantive run of characters."""
    body = re.sub(r"\s+", "", text or "")[:400]
    return hashlib.sha1(body.encode("utf-8")).hexdigest()[:16]


def topic_terms(topic: str, synonyms: list[str], extra: list[str]) -> list[str]:
    """Build the supporting vocabulary used to score an on-topic page.

    Chinese compounds are split into overlapping bigrams so that a synonym like
    "看透一个人" still matches prose that says "看透". Bigram splitting also
    produces connective junk ("的人", "解一"), which is why these terms only ever
    *add* to a score -- admission is decided by the core terms instead.
    """
    terms: set[str] = set()
    for phrase in [tc_query.topic_core(topic), *synonyms, *extra]:
        phrase = re.sub(r"[^\w一-鿿]", "", phrase or "")
        if len(phrase) >= 2:
            terms.add(phrase)
        cjk = re.findall(r"[一-鿿]{2,}", phrase)
        for run in cjk:
            for i in range(len(run) - 1):
                terms.add(run[i:i + 2])
    # Single-char and ultra-generic fragments match everything; drop them.
    return sorted(t for t in terms if len(t) >= 2 and t not in _GENERIC)


# Fragments that carry no topical signal. Bigram splitting of a natural-language
# synonym inevitably produces these, and they match almost any Chinese prose.
_GENERIC = {
    "一个", "个人", "什么", "技巧", "方法", "的人", "人的", "了解", "通过",
    "经验", "心得", "细节", "观察", "判断", "如何", "怎么", "可以", "自己",
    "他们", "我们", "这个", "那个", "就是", "没有", "很多", "一些",
}


def relevance(text: str, core: list[str], support: list[str]) -> tuple[int, int, int]:
    """Score a page against the topic.

    Returns ``(score, core_hits, core_distinct)``. Core terms carry the topic's
    discriminative vocabulary and are weighted heavily; support terms are the
    bigram spray, worth one point each. Admission is judged on the core counts,
    so an article that merely repeats a generic word many times cannot buy its
    way in.

    Core terms are matched longest-first and each match is then blanked out, so
    one idiom cannot masquerade as several independent signals: 阅人无数 would
    otherwise satisfy 阅人, 人无 and 无数 at once and single-handedly clear a
    two-anchor threshold.
    """
    sample = text[:8000]
    masked = sample
    core_hits = core_distinct = support_hits = 0
    for term in sorted(core, key=len, reverse=True):
        count = masked.count(term)
        if count:
            core_hits += count
            core_distinct += 1
            masked = masked.replace(term, "\x00" * len(term))
    for term in support:
        support_hits += sample.count(term)
    return core_hits * 3 + support_hits, core_hits, core_distinct


def select_terms(records: list[dict], candidates: list[str], *,
                 trusted: list[str] | None = None,
                 generic_df: float = 0.5, min_df: float = 0.04,
                 min_precision: float = 0.8
                 ) -> tuple[list[str], list[str], list[str], list[str]]:
    """Split candidate vocabulary into topic anchors and support terms.

    Frequency alone cannot do this job. Bigram splitting of "特殊的识人技巧"
    produces fragments like 的识 and 人技, and those fragments are *common* in
    exactly the pages that are off-topic -- "有效的**的识**别方法" style adjacency.
    Measured on a real corpus, 的方 appeared in 45% of pages and 人无 in 13%,
    while genuine anchors like 识人 and 看透 sat at 24% and 7%.

    What separates them is reliability, not rarity: every page containing 识人,
    看人, 看透 or 人品 also contained another topic term, whereas a third to a
    half of the pages containing a junk fragment contained none. So a derived
    term is only promoted to anchor when it reliably co-occurs with the topic
    vocabulary the caller supplied via --term (`min_precision`).

    Note the trusted terms satisfy this by construction, so they need no special
    case. If the caller supplies no --term there is nothing to measure precision
    against, and the filter degrades to the frequency band alone.

    Returns ``(anchors, support, dropped_generic, dropped_rare)``.
    """
    trusted = [t for t in (trusted or []) if t]
    bodies = []
    for record in records:
        if not record.get("ok"):
            continue
        bodies.append((record.get("title") or "") + "\n"
                      + "\n".join(a.get("text") or "" for a in record.get("answers", [])))
    if not bodies:
        return [], list(candidates), [], []

    anchors: list[str] = []
    support: list[str] = []
    dropped_generic: list[str] = []
    dropped_rare: list[str] = []
    for term in candidates:
        present = [body for body in bodies if term in body]
        if not present:
            support.append(term)
            continue
        df = len(present) / len(bodies)
        if df > generic_df:
            dropped_generic.append(term)
            continue
        if trusted:
            on_topic = sum(1 for body in present
                           if any(t in body for t in trusted))
            if on_topic / len(present) < min_precision:
                dropped_rare.append(term)
                support.append(term)
                continue
        if term in trusted or df >= min_df:
            anchors.append(term)
        else:
            # Too rare to carry topical signal on its own; keep it as weak
            # supporting evidence rather than throwing the match away.
            dropped_rare.append(term)
            support.append(term)
    return anchors, support, dropped_generic, dropped_rare


# --- phase 1+2: discovery -----------------------------------------------------

def discover(topic: str, synonyms: list[str], *, per_query: int, query_limit: int,
             verbose: bool = True) -> tuple[list[dict], list[str]]:
    """Find candidate article URLs, restricted to the allowed platforms.

    Every result passes through ``tc_web.normalize_candidate``, which both folds
    Zhihu's alternate URL shapes onto canonical pages and drops any host that is
    not Zhihu / WeChat / Xiaohongshu.
    """
    queries = tc_query.expand(topic, synonyms, limit=query_limit, include_site=False)
    candidates: dict[str, dict] = {}
    errors: list[str] = []
    rejected = 0
    for i, query in enumerate(queries, 1):
        added: dict[str, int] = {}
        for key, domains in EXA_TARGETS:
            for result in tc_web.exa_search(query, num_results=per_query,
                                            include_domains=domains):
                if result.get("error"):
                    errors.append(f"{query} [{key}]: {result['error']}")
                    continue
                hit = tc_web.normalize_candidate(result.get("url") or "")
                if not hit:
                    rejected += 1
                    continue
                url, platform_key = hit
                if url in candidates:
                    continue
                result["url"] = url
                result["platform"] = PLATFORMS[platform_key]
                result["platform_key"] = platform_key
                candidates[url] = result
                added[platform_key] = added.get(platform_key, 0) + 1
        if verbose:
            detail = " ".join(f"{k}+{v}" for k, v in sorted(added.items())) or "+0"
            print(f"  [{i:>2}/{len(queries)}] {detail:<18} (total {len(candidates)})  {query}")
    if verbose:
        print(f"  -> dropped {rejected} off-platform / non-article urls")
    return list(candidates.values()), errors


# --- phase 3: extraction ------------------------------------------------------

def _wrap(url: str, record: dict, discovery: dict) -> dict:
    """Put a tc_extract record into the orchestrator's record shape."""
    answers = record.get("answers") or []
    return {
        "source_url": url,
        "mode": record.get("mode", "?"),
        "ok": bool(answers),
        "error": record.get("error") or ("" if answers else "no body extracted"),
        "kind": record.get("kind"),
        "title": record.get("title", ""),
        "answers": answers,
        "http_status": record.get("http_status"),
        "elapsed_ms": record.get("elapsed_ms"),
        "discovery": discovery,
    }


async def extract_all(candidates: list[dict], *, session, seeds: list[str],
                      verbose: bool = True) -> list[dict]:
    """Fetch every candidate, cheapest transport first.

    WeChat articles and token-bearing Xiaohongshu notes are server-rendered and
    carry their whole body in the first HTTP response, so they are read with no
    browser at all -- and they are usually most of a candidate set. Only Zhihu
    (whose ``zse-ck`` challenge has to be executed) and pages the cheap path
    could not read are handed to Edge.
    """
    by_url = {c["url"]: c for c in candidates}
    urls = list(dict.fromkeys([c["url"] for c in candidates]
                              + [u for u in seeds if u not in by_url]))
    if not urls:
        return []

    results: dict[str, dict] = {}

    static_urls = [u for u in urls if tc_static.eligible(u)]
    if static_urls:
        if verbose:
            print(f"  static : {len(static_urls)} urls over plain HTTP "
                  f"(no browser launched for these)")
        got = await tc_static.fetch_many(static_urls, concurrency=4)
        for url in static_urls:
            record = got.get(url) or {"answers": [],
                                      "error": "static transport returned nothing"}
            entry = _wrap(url, record, by_url.get(url, {}))
            results[url] = entry
            if verbose:
                chars = sum(a["chars"] for a in entry["answers"])
                print(f"    {'OK ' if entry['ok'] else 'X  '}"
                      f"{len(entry['answers']):>2}篇 {chars:>6}字  {url[:62]}")

    # Whatever the cheap path could not read earns one browser attempt.
    todo = [u for u in urls if not results.get(u, {}).get("ok")]
    if not todo:
        return [results[url] for url in urls if url in results]

    if session is None:
        reason = ("no browser session available; Zhihu and untokenized "
                  "Xiaohongshu URLs cannot be read without one")
        if verbose:
            print(f"  browser: skipped {len(todo)} reads ({reason})")
        for url in todo:
            entry = results.get(url) or _wrap(url, {"answers": []},
                                              by_url.get(url, {}))
            entry["mode"] = "no-browser"
            entry["error"] = reason
            entry["ok"] = False
            results[url] = entry
    else:
        if verbose:
            print(f"  browser: {len(todo)} urls through silent Edge")
        fetched = await session.fetch_many(todo)
        for url, record in zip(todo, fetched):
            entry = _wrap(url, record, by_url.get(url, {}))
            # Only displace a static result when the browser did better.
            if entry["ok"] or url not in results:
                results[url] = entry
            else:
                entry = results[url]
            if verbose:
                chars = sum(a["chars"] for a in entry["answers"])
                print(f"    {'OK ' if entry['ok'] else 'X  '}"
                      f"{len(entry['answers']):>2}篇 {chars:>6}字  {url[:62]}")

    return [results[url] for url in urls if url in results]


# --- phase 4: flatten + dedupe ------------------------------------------------

def flatten(records: list[dict], *, min_chars: int, per_author: int,
            anchors: list[str], support: list[str], strong: list[str] | None = None,
            min_distinct: int = 2, min_hits: int = 2) -> tuple[list[dict], dict]:
    """Keep only pages that are genuinely about the topic.

    `strong` is the subset of anchors the caller asserted as discriminative
    (the --term words). A page must match at least one of them: derived bigram
    fragments like 人很 or 无数 are too weak to admit a page on their own, and
    without this requirement articles about 星座 or 姻缘 slip in on a stray 看透.
    """
    strong = [t for t in (strong or anchors) if t]
    articles: list[dict] = []
    seen_fp: set[str] = set()
    seen_title: set[str] = set()
    author_count: dict[str, int] = {}
    rejects: list[dict] = []
    stats = {"raw": 0, "dropped_quality": 0, "dropped_offtopic": 0,
             "dropped_dup": 0, "dropped_author_cap": 0}

    for record in records:
        if not record.get("ok"):
            continue
        discovery = record.get("discovery") or {}
        page_title = record.get("title") or discovery.get("title")
        for answer in record.get("answers", []):
            stats["raw"] += 1
            text = answer.get("text") or ""
            url = answer.get("url") or record.get("source_url")
            # Gate 1: is this prose at all, or an interstitial / HTML / nav dump?
            ok, reason = tc_web.body_quality(text, min_chars=min_chars)
            if not ok:
                stats["dropped_quality"] += 1
                rejects.append({"url": url, "reason": reason})
                continue
            # Gate 2: is it actually about the topic? Requires several distinct
            # discriminative terms, so a page that merely repeats one generic
            # word ("细节") is not admitted.
            score, core_hits, core_distinct = relevance(
                f"{page_title or ''}\n{text}", anchors, support)
            strong_hits = sum(1 for term in strong
                              if term in f"{page_title or ''}\n{text}")
            if (core_distinct < min_distinct or core_hits < min_hits
                    or strong_hits < 1):
                stats["dropped_offtopic"] += 1
                rejects.append({
                    "url": url,
                    "reason": f"off-topic ({core_distinct} distinct / {core_hits} hits"
                              f" / {strong_hits} strong)"})
                continue
            fp = fingerprint(text)
            if fp in seen_fp:
                stats["dropped_dup"] += 1
                continue
            author = ((answer.get("author") or "").strip()
                      or (discovery.get("author") or "").strip() or "未署名")
            if author != "未署名" and author_count.get(author, 0) >= per_author:
                stats["dropped_author_cap"] += 1
                continue
            title_key = norm_title(page_title)
            # Multi-answer pages legitimately share a title; only dedupe single-body pages.
            if record.get("kind") not in ("zhihu_question",) and title_key and title_key in seen_title:
                stats["dropped_dup"] += 1
                continue

            seen_fp.add(fp)
            if title_key:
                seen_title.add(title_key)
            author_count[author] = author_count.get(author, 0) + 1
            articles.append({
                "title": page_title,
                "platform": platform_of(record.get("source_url", "")),
                "author": author,
                "author_bio": answer.get("author_bio"),
                "voteup": answer.get("voteup"),
                "published": answer.get("published") or discovery.get("published"),
                "url": url,
                "source_url": record.get("source_url"),
                "kind": record.get("kind"),
                "chars": len(text),
                "relevance": score,
                "core_hits": core_hits,
                "core_distinct": core_distinct,
                "fingerprint": fp,
                "found_via": discovery.get("found_via"),
                "text": text,
            })
    # A term-frequency score is biased toward long articles; rank on how densely
    # the page discusses the topic per 1000 characters instead, with the
    # distinct-anchor count breaking ties.
    articles.sort(key=lambda a: (a["core_distinct"], a["relevance"] / max(a["chars"], 1),
                                 a["chars"]), reverse=True)
    stats["kept"] = len(articles)
    stats["authors"] = len({a["author"] for a in articles})
    stats["rejects"] = rejects[:40]
    return articles, stats


# --- phase 5: report ----------------------------------------------------------

def write_report(out_dir: Path, topic: str, synonyms: list[str], articles: list[dict],
                 records: list[dict], stats: dict, errors: list[str],
                 excerpt_chars: int) -> Path:
    raw_dir = out_dir / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)

    for i, article in enumerate(articles, 1):
        slug = re.sub(r"[^\w\u4e00-\u9fff]", "", (article["title"] or "untitled"))[:24]
        path = raw_dir / f"{i:03d}_{article['platform']}_{slug or 'untitled'}.md"
        path.write_text(
            f"# {article['title']}\n\n"
            f"- 平台: {article['platform']}\n- 作者: {article['author']}\n"
            f"- 赞同: {article['voteup'] or '-'}\n- 时间: {article['published'] or '-'}\n"
            f"- 链接: {article['url']}\n- 字数: {article['chars']}\n"
            f"- 检索词: {article['found_via'] or '-'}\n\n---\n\n{article['text']}\n",
            encoding="utf-8")
        article["raw_file"] = path.name

    manifest = {
        "topic": topic,
        "synonyms": synonyms,
        "crawled_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "stats": stats,
        "errors": errors[:20],
        "fetch_failures": [
            {"url": r.get("source_url"), "error": r.get("error")}
            for r in records if not r.get("ok")
        ],
        "articles": [{k: v for k, v in a.items() if k != "text"} for a in articles],
    }
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    by_platform: dict[str, list[dict]] = {}
    for article in articles:
        by_platform.setdefault(article["platform"], []).append(article)

    lines = [
        f"# 爬取结果：{topic}", "",
        f"- 爬取时间：{manifest['crawled_at']}",
        f"- 同义检索词：{'、'.join(synonyms) or '（无）'}",
        f"- 命中文章：**{stats['kept']} 篇**，独立作者 **{stats['authors']} 位**，"
        f"总计约 {sum(a['chars'] for a in articles):,} 字",
        f"- 覆盖平台：{'、'.join(f'{k}({len(v)})' for k, v in sorted(by_platform.items(), key=lambda x: -len(x[1])))}",
        f"- 去重：低质/拦截 {stats['dropped_quality']} / 重复 {stats['dropped_dup']} / 同作者超限 {stats['dropped_author_cap']}",
        "", "## 文章清单", "",
        "| # | 平台 | 作者 | 标题 | 赞同 | 字数 | 链接 |",
        "| - | ---- | ---- | ---- | ---- | ---- | ---- |",
    ]
    for i, article in enumerate(articles, 1):
        title = (article["title"] or "")[:36].replace("|", "｜")
        author = (article["author"] or "")[:16].replace("|", "｜")
        lines.append(f"| {i} | {article['platform']} | {author} | {title} | "
                     f"{article['voteup'] or '-'} | {article['chars']} | {article['url']} |")

    lines += ["", "## 逐篇摘录", "",
              f"> 每篇保留前 {excerpt_chars} 字作为定位用摘录；全文见 `raw/` 目录对应文件。", ""]
    for i, article in enumerate(articles, 1):
        excerpt = re.sub(r"\s+", " ", article["text"])[:excerpt_chars]
        lines += [
            f"### {i}. {article['title']}",
            f"- **平台/作者**：{article['platform']} · {article['author']}"
            + (f"（{article['author_bio']}）" if article.get("author_bio") else ""),
            f"- **赞同/时间**：{article['voteup'] or '-'} · {article['published'] or '-'}",
            f"- **链接**：{article['url']}",
            f"- **全文**：`raw/{article['raw_file']}`（{article['chars']} 字）",
            "", f"{excerpt}……", "",
        ]

    if manifest["fetch_failures"]:
        lines += ["## 抓取失败", "", "| 链接 | 原因 |", "| ---- | ---- |"]
        for failure in manifest["fetch_failures"][:30]:
            lines.append(f"| {failure['url']} | {failure['error']} |")

    digest = out_dir / "digest.md"
    digest.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return digest


async def run(args: argparse.Namespace) -> int:
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Rescoring path: reuse a previous crawl so term tuning does not re-hit the
    # platforms (and does not re-trip their rate limits).
    if args.from_records:
        records = json.loads(Path(args.from_records).read_text(encoding="utf-8"))
        print(f"[rescoring] {len(records)} cached records from {args.from_records}")
        errors: list[str] = []
        return _score_and_report(args, out_dir, records, errors)

    # One browser for the whole run. The previous shape opened a session for
    # in-site search and a second one inside extraction -- a needless reconnect,
    # and two lifecycles to guarantee reaped instead of one.
    async with contextlib.AsyncExitStack() as stack:
        session = None
        if not args.no_browser:
            try:
                session = await stack.enter_async_context(
                    tc_browser.BrowserSession(
                        cdp=args.cdp, profile=args.profile,
                        headless=not args.headed,
                        adopt=not args.no_adopt,
                        concurrency=args.concurrency))
                handle = session.handle
                how = "adopted running" if not handle.owned else "launched silent"
                where = "headed-offscreen" if not session.headless else "headless"
                print(f"[browser] {how} Edge at {handle.endpoint} ({where})")
                if handle.owned:
                    print("[browser] owned by this run -- closed on exit")
            except Exception as exc:
                print(f"[browser] unavailable "
                      f"({type(exc).__name__}: {str(exc)[:160]})")
                print("          falling back to the plain-HTTP transport; "
                      "Zhihu will be skipped")

        print(f"\n[1/4] discovery — topic={args.topic!r} synonyms={args.synonym}")
        print(f"       platforms: {'、'.join(PLATFORMS.values())} (all others dropped)")
        candidates, errors = discover(args.topic, args.synonym,
                                      per_query=args.per_query,
                                      query_limit=args.query_limit)
        print(f"  -> {len(candidates)} unique candidate urls")

        seeds: list[str] = []
        for raw in args.seed or []:
            hit = tc_web.normalize_candidate(raw)
            if hit:
                seeds.append(hit[0])
            else:
                print(f"  [seed] ignored (not an allowed platform article): {raw}")

        if session is not None and not args.no_site_search:
            print("\n[2/4] in-site search")
            queries = tc_query.expand(args.topic, args.synonym,
                                      limit=args.site_queries, include_site=False)
            for label, search in (("zhihu", session.zhihu_search),
                                  ("xhs", session.xhs_search)):
                for query in queries:
                    found = await search(query, limit=args.per_query)
                    gated = next((f["error"] for f in found if f.get("error")), None)
                    if gated:
                        print(f"    {label:<6} -- {gated}")
                        break
                    added = 0
                    for item in found:
                        hit = tc_web.normalize_candidate(item.get("url", ""))
                        if hit and hit[0] not in seeds:
                            seeds.append(hit[0])
                            added += 1
                    print(f"    {label:<6} +{added:<2} (total {len(seeds)})  {query}")
            # A note page needs an xsec_token bound to that note, and the
            # anonymous explore feed is the only place to obtain one.
            for pair in await session.explore_tokens(limit=args.per_query * 3):
                if pair["url"] not in seeds:
                    seeds.append(pair["url"])
            print(f"    xhs feed  tokens -> pool of {len(seeds)} seed urls")
        else:
            why = ("--no-site-search" if args.no_site_search
                   else "no browser session")
            print(f"\n[2/4] in-site search — skipped ({why})")

        print("\n[3/4] extraction")
        records = await extract_all(candidates, session=session, seeds=seeds)

        # Cache the raw records before scoring: crawling is the slow,
        # rate-limit-sensitive half, so it stays separable from term tuning.
        cache = out_dir / "records.json"
        cache.write_text(json.dumps(records, ensure_ascii=False), encoding="utf-8")
        print(f"  cached raw records: {cache}")

        print("\n[4/4] dedupe + report")
        return _score_and_report(args, out_dir, records, errors)


def _score_and_report(args: argparse.Namespace, out_dir: Path, records: list[dict],
                      errors: list[str]) -> int:
    candidates_vocab = topic_terms(args.topic, args.synonym, args.term or [])
    anchors, support, generic, rare = select_terms(records, candidates_vocab,
                                                   trusted=args.term or [])
    print(f"  topic anchors ({len(anchors)}): {'、'.join(anchors[:20])}"
          + (" …" if len(anchors) > 20 else ""))
    if generic:
        print(f"  too common to discriminate, demoted ({len(generic)}): "
              f"{'、'.join(generic[:12])}" + (" …" if len(generic) > 12 else ""))
    if rare:
        print(f"  unreliable as anchors, kept as weak support ({len(rare)}): "
              f"{'、'.join(rare[:12])}" + (" …" if len(rare) > 12 else ""))
    articles, stats = flatten(records, min_chars=args.min_chars,
                              per_author=args.per_author,
                              anchors=anchors, support=support,
                              strong=[t for t in (args.term or []) if t in anchors],
                              min_distinct=args.min_distinct, min_hits=args.min_hits)
    digest = write_report(out_dir, args.topic, args.synonym, articles, records,
                          stats, errors, args.excerpt)
    print(f"  raw bodies {stats['raw']} -> kept {stats['kept']} "
          f"(低质 {stats['dropped_quality']} / 跑题 {stats['dropped_offtopic']} / "
          f"重复 {stats['dropped_dup']} / 同作者超限 {stats['dropped_author_cap']})")
    print(f"  kept {stats['kept']} articles from {stats['authors']} authors")
    print(f"  digest : {digest}")
    print(f"  raw    : {out_dir / 'raw'}")
    return 0 if articles else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("topic")
    parser.add_argument("--synonym", action="append", default=[],
                        help="alternative phrasing of the same intent (repeatable)")
    parser.add_argument("--seed", action="append", default=[],
                        help="known article/question URL to include (repeatable)")
    parser.add_argument("--term", action="append", default=[],
                        help="extra vocabulary for the on-topic test (repeatable)")
    parser.add_argument("--out", required=True)
    parser.add_argument("--from-records", metavar="PATH",
                        help="rescore a cached records.json instead of crawling")
    parser.add_argument("--cdp", default=None,
                        help="attach to this CDP endpoint instead of launching Edge")
    parser.add_argument("--profile", default=tc_browser.DEFAULT_PROFILE,
                        help="user-data-dir for the crawl browser")
    parser.add_argument("--headed", action="store_true",
                        help="run Edge headed but parked off-screen (still silent); "
                             "use when a platform refuses the headless renderer")
    parser.add_argument("--no-adopt", action="store_true",
                        help="always launch a fresh Edge rather than adopting a "
                             "running one")
    parser.add_argument("--no-browser", action="store_true",
                        help="plain-HTTP transport only; skips Zhihu entirely")
    parser.add_argument("--concurrency", type=int, default=3,
                        help="parallel browser reads (each host stays paced)")
    parser.add_argument("--query-limit", type=int, default=16)
    parser.add_argument("--site-queries", type=int, default=6)
    parser.add_argument("--per-query", type=int, default=10)
    parser.add_argument("--per-author", type=int, default=3)
    parser.add_argument("--min-chars", type=int, default=350)
    parser.add_argument("--min-distinct", type=int, default=3,
                        help="distinct topic anchors a page must match to count as on-topic")
    parser.add_argument("--min-hits", type=int, default=2,
                        help="total anchor occurrences a page must have")
    parser.add_argument("--excerpt", type=int, default=400)
    parser.add_argument("--no-site-search", action="store_true")
    return asyncio.run(run(parser.parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
