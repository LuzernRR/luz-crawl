#!/usr/bin/env python3
"""Pure HTML/JSON parsers for the three target platforms.

No network, no browser, no I/O -- every function here takes markup and returns a
record. That matters because the crawl has **two transports** (a plain HTTP GET
for server-rendered pages, and a silent Edge for pages behind a JS challenge)
and they must never disagree about what a page said. Keeping extraction in one
importable module means a selector fix lands for both at once, and the whole
correctness surface is unit-testable without launching anything.

Record shape, uniform across platforms::

    {"kind": str, "title": str, "answers": [
        {"author", "author_bio", "voteup", "published", "url", "text", "chars"}
     ], "error": str | absent}

Platform notes that shaped this code
------------------------------------
* **WeChat** ships ``#js_content`` as ``style="visibility:hidden;opacity:0"``
  and clears it from JS after load. The text is already in the response, so the
  fix is to never consult computed visibility and never use ``innerText`` --
  both silently return an empty article. This was the single worst bug in the
  previous extractor: good pages were recorded as login walls.
* **Zhihu** embeds the authoritative content in a ``js-initialData`` JSON blob;
  the rendered DOM is a lossy view of it. Read the blob first, fall back to CSS.
* **Xiaohongshu** embeds ``window.__INITIAL_STATE__`` as *serialized JS*, not
  JSON: bare ``undefined`` and ``new Set([...])`` appear in it, so it needs a
  string-aware rewrite before ``json.loads``.
"""

from __future__ import annotations

import json
import re
import time
import urllib.parse

# WeChat interstitials, matched against <title>.
WECHAT_ERRORS = ("参数错误", "环境异常", "未知错误", "访问过于频繁")
WECHAT_GONE = ("该内容已被发布者删除", "此内容因违规无法查看", "已被删除",
               "无法查看", "已迁移", "内容违规")

# Anti-bot / gate markers worth reporting rather than working around.
BLOCK_MARKERS = ("安全验证", "安全限制", "系统监测到异常", "您当前请求存在异常",
                 "操作太快", "请稍后再试", "验证码", "扫码登录", "环境异常")

_BLOCK_TAGS = ("p", "section", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6",
               "blockquote", "tr", "figure", "figcaption", "pre", "br")
_IDENT = re.compile(r"[A-Za-z0-9_$]")


def _soup(markup: str):
    from bs4 import BeautifulSoup

    return BeautifulSoup(markup, "lxml")


def _clean(value) -> str:
    return re.sub(r"\s+", " ", str(value or "")).replace("​", "").strip()


def node_text(node) -> str:
    """Approximate ``innerText`` for a BeautifulSoup node.

    Block elements become line breaks while inline elements stay glued
    together. A plain ``get_text("\\n")`` would put every ``<span>`` on its own
    line, which shreds WeChat articles (they split single sentences across many
    spans) and Zhihu answers alike.
    """
    for junk in node.find_all(["script", "style", "noscript", "svg"]):
        junk.decompose()
    for br in node.find_all("br"):
        br.replace_with("\n")
    for tag in node.find_all(_BLOCK_TAGS):
        tag.append("\n")
    text = node.get_text("")
    text = text.replace("​", "").replace("\xa0", " ")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return "\n".join(line.strip() for line in text.split("\n")).strip()


def html_to_text(markup: str) -> str:
    """Flatten an HTML fragment (e.g. a Zhihu answer body) to readable text."""
    if not markup:
        return ""
    return node_text(_soup(markup))


def blocked_by(html: str, title: str = "") -> str | None:
    """Return the gate marker a page is showing, if any.

    Only the first stretch of body text is considered: these words appear in
    boilerplate scripts on perfectly good pages, so scanning the whole document
    produces constant false positives.
    """
    head = f"{title}\n{html[:6000]}"
    return next((m for m in BLOCK_MARKERS if m in head), None)


def _record(kind: str, title: str = "", answers=None, error: str | None = None) -> dict:
    out = {"kind": kind, "title": title or "", "answers": list(answers or [])}
    if error:
        out["error"] = error
    return out


def _answer(*, author=None, bio=None, voteup=None, published=None, url="",
            text="", **extra) -> dict:
    entry = {
        "author": _clean(author) or None,
        "author_bio": _clean(bio) or None,
        "voteup": voteup,
        "published": published,
        "url": (url or "").split("#")[0],
        "text": text,
        "chars": len(text),
    }
    entry.update({k: v for k, v in extra.items() if v is not None})
    return entry


def _fingerprint(text: str) -> str:
    """Stable key for deciding whether two extractions are the same answer."""
    return re.sub(r"\s+", "", (text or ""))[:120]


def _epoch_day(value, *, unit: str = "s") -> str | None:
    try:
        seconds = float(value) / (1000.0 if unit == "ms" else 1.0)
        if seconds <= 0:
            return None
        return time.strftime("%Y-%m-%d", time.localtime(seconds))
    except Exception:
        return None


# --- WeChat -------------------------------------------------------------------

def extract_wechat(html: str, url: str) -> dict:
    """Parse an mp.weixin.qq.com article from its server-rendered HTML."""
    soup = _soup(html)
    page_title = _clean(soup.title.get_text() if soup.title else "")

    if any(marker in page_title for marker in WECHAT_ERRORS):
        return _record("wechat_article", page_title,
                       error=f"wechat interstitial: {page_title}")

    body = soup.select_one("#js_content, .rich_media_content")
    if body is None:
        gone = next((m for m in WECHAT_GONE if m in html), None)
        return _record("wechat_article", page_title,
                       error=f"article unavailable: {gone}" if gone
                             else "no #js_content in response")

    # Deliberately ignores the inline visibility:hidden style.
    text = node_text(body)

    title_node = soup.select_one("#activity-name")
    title = _clean(title_node.get_text() if title_node else "") or page_title

    author = ""
    for selector in ("#js_name", ".rich_media_meta_nickname", ".profile_nickname",
                     "#profileBt a", "#meta_content .rich_media_meta_nickname"):
        node = soup.select_one(selector)
        if node and _clean(node.get_text()):
            author = _clean(node.get_text())
            break
    if not author:
        match = re.search(r"var\s+nickname\s*=\s*['\"]([^'\"]{1,60})['\"]", html)
        author = _clean(match.group(1)) if match else ""

    # #publish_time is populated by JS; the inline `var ct` is in the static
    # response and is authoritative.
    published = None
    match = re.search(r"var\s+(?:ct|createTime)\s*=\s*['\"]?(\d{9,11})", html)
    if match:
        published = _epoch_day(match.group(1))
    if not published:
        node = soup.select_one("#publish_time, .rich_media_meta_text")
        published = _clean(node.get_text()) if node else None

    if not text:
        return _record("wechat_article", title,
                       error="#js_content present but empty")

    return _record("wechat_article", title, [_answer(
        author=author, published=published, url=url, text=text)])


# --- Xiaohongshu --------------------------------------------------------------

def sanitize_js_object(text: str) -> str:
    """Rewrite a serialized-JS object literal into parseable JSON.

    Handles bare ``undefined`` / ``void 0`` / ``NaN`` / ``Infinity`` and elides
    ``new Set(...)`` / ``new Map(...)`` wrappers, keeping their array argument.
    The scan is string-aware and identifier-aware so that a note body containing
    the word "undefined", or a key named ``undefinedKey``, survives intact.
    """
    out: list[str] = []
    i, n = 0, len(text)
    quote: str | None = None
    escaped = False
    depth = 0
    elided: list[int] = []

    while i < n:
        ch = text[i]

        if quote is not None:
            out.append(ch)
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == quote:
                quote = None
            i += 1
            continue

        if ch in "\"'":
            quote = ch
            out.append(ch)
            i += 1
            continue

        for ctor in ("new Set(", "new Map(", "new Set (", "new Map ("):
            if text.startswith(ctor, i):
                elided.append(depth)
                depth += 1
                i += len(ctor)
                break
        else:
            if ch == "(":
                depth += 1
                out.append(ch)
                i += 1
                continue
            if ch == ")":
                depth -= 1
                if elided and elided[-1] == depth:
                    elided.pop()
                    i += 1  # drop the constructor's own closing paren
                    continue
                out.append(ch)
                i += 1
                continue

            for literal, replacement in (("undefined", "null"), ("void 0", "null"),
                                         ("NaN", "null"), ("Infinity", "null")):
                if text.startswith(literal, i):
                    before = text[i - 1] if i else " "
                    after = text[i + len(literal):i + len(literal) + 1] or " "
                    if not _IDENT.match(before) and not _IDENT.match(after):
                        out.append(replacement)
                        i += len(literal)
                        break
            else:
                out.append(ch)
                i += 1
                continue
            continue

    return "".join(out)


def _balanced_object(html: str, start: int) -> str | None:
    """Slice the brace-balanced object literal beginning at ``start``."""
    i, n = start, len(html)
    depth = 0
    quote = None
    escaped = False
    while i < n:
        ch = html[i]
        if quote is not None:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == quote:
                quote = None
        elif ch in "\"'":
            quote = ch
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return html[start:i + 1]
        i += 1
    return None


def parse_initial_state(html: str) -> dict | None:
    """Pull and parse ``window.__INITIAL_STATE__`` out of an XHS page."""
    anchor = html.find("__INITIAL_STATE__")
    if anchor == -1:
        return None
    start = html.find("{", anchor)
    if start == -1:
        return None
    blob = _balanced_object(html, start)
    if not blob:
        return None
    try:
        return json.loads(sanitize_js_object(blob))
    except Exception:
        return None


def extract_xhs(html: str, url: str) -> dict:
    """Parse a xiaohongshu.com/explore/<id> note from its SSR state."""
    state = parse_initial_state(html)
    if not state:
        title = ""
        try:
            title = _clean(_soup(html).title.get_text())
        except Exception:
            pass
        gate = blocked_by(html, title)
        if gate:
            return _record("xhs_note", title, error=f"xhs gate: {gate}")
        return _record("xhs_note", title, error="no parseable __INITIAL_STATE__")

    note_map = ((state.get("note") or {}).get("noteDetailMap")) or {}
    note, note_id = None, None
    for key, value in note_map.items():
        candidate = (value or {}).get("note") or {}
        if candidate.get("title") or candidate.get("desc"):
            note, note_id = candidate, key
            break

    if note is None:
        if "error_code=300031" in html or "暂时无法浏览" in html:
            return _record("xhs_note",
                           error="note needs a valid xsec_token (300031)")
        return _record("xhs_note", error="__INITIAL_STATE__ carried no note detail")

    title = _clean(note.get("title"))
    desc = (note.get("desc") or "").replace("​", "").strip()
    tags = [t.get("name") for t in (note.get("tagList") or []) if t.get("name")]
    user = note.get("user") or {}
    interact = note.get("interactInfo") or {}

    parts = [p for p in (title, desc) if p]
    if tags:
        parts.append("标签：" + " ".join(f"#{t}" for t in tags))
    text = "\n\n".join(parts)
    if not text:
        return _record("xhs_note", title,
                       error="note found but title and desc were both empty")

    return _record("xhs_note", title or desc[:60], [_answer(
        author=user.get("nickname"),
        bio=note.get("ipLocation"),
        # A display string such as "10万+"; the platform's own rendering.
        voteup=_clean(interact.get("likedCount")) or None,
        published=_epoch_day(note.get("time"), unit="ms"),
        url=url, text=text, note_id=note_id,
        note_type=note.get("type"),
    )])


def harvest_explore_tokens(html: str) -> list[dict]:
    """Collect ``note_id`` + ``xsec_token`` pairs from an XHS feed page.

    Note detail pages 404 without a token bound to that specific note, and the
    explore feed hands them out anonymously, so this is the bootstrap step.
    """
    state = parse_initial_state(html)
    if not state:
        return []
    out = []
    for item in ((state.get("feed") or {}).get("feeds")) or []:
        card = (item or {}).get("noteCard") or {}
        note_id = item.get("id") or card.get("noteId")
        token = item.get("xsecToken") or card.get("xsecToken")
        if note_id and token:
            out.append({
                "note_id": note_id,
                "xsec_token": token,
                "title": _clean(card.get("displayTitle")),
                "url": (f"https://www.xiaohongshu.com/explore/{note_id}"
                        f"?xsec_token={token}&xsec_source=pc_feed"),
            })
    return out


# --- Zhihu --------------------------------------------------------------------

def _initial_data(html: str) -> dict | None:
    """Parse Zhihu's ``js-initialData`` blob, the authoritative content source."""
    match = re.search(r'<script[^>]+id="js-initialData"[^>]*>', html)
    if not match:
        return None
    start = html.find("{", match.end())
    if start == -1:
        return None
    blob = _balanced_object(html, start)
    if not blob:
        return None
    try:
        return json.loads(blob)
    except Exception:
        try:
            return json.loads(sanitize_js_object(blob))
        except Exception:
            return None


def _zhihu_entities(html: str) -> dict:
    data = _initial_data(html) or {}
    return ((data.get("initialState") or {}).get("entities")) or {}


def extract_zhihu(html: str, url: str) -> dict:
    """Parse a Zhihu question, answer or column article.

    Prefers the ``js-initialData`` JSON blob over the DOM: it carries the full
    answer body even when the rendered page is collapsed behind a login prompt,
    and it survives the CSS-class churn that breaks selector-only extractors.
    """
    entities = _zhihu_entities(html)
    parsed = urllib.parse.urlparse(url)
    is_article = "zhuanlan.zhihu.com" in parsed.netloc or "/p/" in parsed.path

    answers_map = entities.get("answers") or {}
    articles_map = entities.get("articles") or {}
    questions_map = entities.get("questions") or {}

    title = ""
    for question in questions_map.values():
        title = _clean((question or {}).get("title"))
        if title:
            break

    rows: list[dict] = []

    if is_article and articles_map:
        for article_id, article in articles_map.items():
            body = html_to_text((article or {}).get("content") or "")
            if not body:
                continue
            author = (article.get("author") or {})
            title = title or _clean(article.get("title"))
            rows.append(_answer(
                author=author.get("name"), bio=author.get("headline"),
                voteup=article.get("voteupCount"),
                published=_epoch_day(article.get("created")
                                     or article.get("updated")),
                url=f"https://zhuanlan.zhihu.com/p/{article_id}",
                text=body,
                truncated=article.get("contentNeedTruncated") or None))
        kind = "zhihu_article"
    elif answers_map:
        for answer_id, answer in answers_map.items():
            body = html_to_text((answer or {}).get("content") or "")
            if not body:
                continue
            author = (answer.get("author") or {})
            question = (answer.get("question") or {})
            title = title or _clean(question.get("title"))
            qid = question.get("id") or parsed.path.strip("/").split("/")[-1]
            rows.append(_answer(
                author=author.get("name"), bio=author.get("headline"),
                voteup=answer.get("voteupCount"),
                published=_epoch_day(answer.get("createdTime")),
                url=f"https://www.zhihu.com/question/{qid}/answer/{answer_id}",
                text=body,
                truncated=answer.get("contentNeedTruncated") or None))
        rows.sort(key=lambda r: r.get("voteup") or 0, reverse=True)
        kind = "zhihu_question"
    else:
        rows, kind = _zhihu_from_dom(html, url, is_article)

    if not title:
        soup = _soup(html)
        node = soup.select_one("h1.QuestionHeader-title, h1.Post-Title, h1")
        title = _clean(node.get_text()) if node else ""

    # Answers loaded lazily by scrolling land in the DOM but never in the
    # js-initialData blob, so fold in anything the DOM has that the blob lacks.
    if rows:
        seen = {_fingerprint(row["text"]) for row in rows}
        extra, _ = _zhihu_from_dom(html, url, is_article)
        for row in extra:
            key = _fingerprint(row["text"])
            if key not in seen:
                seen.add(key)
                rows.append(row)

    if not rows:
        gate = blocked_by(html, title)
        if gate:
            return _record(kind, title, error=f"zhihu gate: {gate}")
        return _record(kind, title,
                       error="no answer body in js-initialData or DOM")

    return _record(kind, title, rows)


def _zhihu_from_dom(html: str, url: str, is_article: bool):
    """CSS fallback for when the JSON blob is absent or unparseable."""
    soup = _soup(html)
    rows = []

    if is_article:
        for selector in (".Post-RichTextContainer", ".Post-RichText", ".RichText"):
            node = soup.select_one(selector)
            if node:
                text = node_text(node)
                if text:
                    author = soup.select_one("a.UserLink-link, .AuthorInfo-name a")
                    rows.append(_answer(
                        author=author.get_text() if author else None,
                        url=url, text=text))
                    break
        return rows, "zhihu_article"

    items = soup.select(".List-item, .AnswerItem") or [soup]
    for item in items:
        node = None
        for selector in (".RichContent-inner", ".CopyrightRichText-richText",
                         ".RichText"):
            node = item.select_one(selector)
            if node:
                break
        if node is None:
            continue
        text = node_text(node)
        if not text:
            continue
        author = item.select_one("a.UserLink-link, .AuthorInfo-name a, "
                                ".AuthorInfo-name")
        vote = item.select_one(".VoteButton--up, button[aria-label*='赞同']")
        rows.append(_answer(
            author=author.get_text() if author else None,
            voteup=re.sub(r"[^0-9万\.]", "", _clean(vote.get_text())) or None
            if vote else None,
            url=url, text=text))
    return rows, "zhihu_question"


# --- dispatch -----------------------------------------------------------------

def platform_of(url: str) -> str | None:
    """Classify a URL into one of the three supported platforms."""
    host = urllib.parse.urlparse(url).netloc.lower()
    if host.endswith("mp.weixin.qq.com"):
        return "wechat"
    if host.endswith("xiaohongshu.com") or host.endswith("xhslink.com"):
        return "xhs"
    if host.endswith("zhihu.com"):
        return "zhihu"
    return None


def parse(url: str, html: str) -> dict:
    """Extract a record from any supported platform's HTML."""
    platform = platform_of(url)
    if platform == "wechat":
        return extract_wechat(html, url)
    if platform == "xhs":
        return extract_xhs(html, url)
    if platform == "zhihu":
        return extract_zhihu(html, url)
    return _record("unknown", error=f"unsupported platform for {url}")
