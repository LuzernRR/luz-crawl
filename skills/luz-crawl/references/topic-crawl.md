# Topic Crawl (小红书 / 知乎 / 微信公众号)

Use this reference when the user gives **one topic** and wants articles about it
collected from Xiaohongshu, Zhihu, and WeChat public accounts, with as many
articles and as many distinct authors as possible.

Entry point:

```text
scripts\platform_search.py  # current OpenCLI browser, search results only
scripts\topic_crawl.py
```

For a direct platform search, start with `platform_search.py`. It checks that
OpenCLI is connected to the existing browser, then searches the requested
platforms sequentially and saves raw results. It never starts another browser.
Pass `--synonym` for alternate wording. The WeChat adapter searches Sogou's
article index, so label that route as an external index.

When the user explicitly asks for many examples or a large copy bank, widen
recall with about 6–10 distinct query phrasings and (for WeChat) 2–4 pages per
query, then deduplicate by Xiaohongshu note ID and normalized Zhihu URL. Resolve
WeChat Sogou redirects to `mp.weixin.qq.com` when possible; if they cannot be
resolved, title+date is only a tentative index signature, not a verified unique
article count. Show raw hits and deduplicated candidates separately.
`platform_search.py --weixin-pages N` requests pages sequentially (maximum 10
rows per page; N is 1–10). Keep browser calls sequential so each ephemeral tab
lease is released before the next call. Curate the collection:
summarize source ideas, preserve only short attributed excerpts, and write any
requested copy bank as original drafts rather than reproducing full posts.

## Scope

The crawl is hard-restricted to three platforms. `tc_web.normalize_candidate`
is the single gate; it returns `None` for every other host, and discovery drops
those before anything is fetched. Do not widen this without the user asking.

| Platform | Accepted URL shape | Extractor |
| --- | --- | --- |
| 知乎 | `/question/<id>`, `zhuanlan.zhihu.com/p/<id>`, `/answer/<id>` | `_JS_ZHIHU_QUESTION` / `_JS_ZHIHU_POST` |
| 微信公众号 | `mp.weixin.qq.com/s/<id>` or `/s?__biz=…` | `_JS_WECHAT` |
| 小红书 | `xiaohongshu.com/explore/<note_id>?xsec_token=…` | `_JS_XHS` |

Zhihu URLs arrive in many shapes. `/tardis/zm/art/<id>`, `/tardis/landing/m/…/ans/<id>`
and `/en/answer/<id>` are folded onto their canonical page; `/pin/`, `/market/`,
`/people/`, `/topic/`, `/column/` are dropped as non-articles. Exa returns mostly
the drop-shapes for Zhihu, so expect a high rejection rate at discovery.

## Two transports, routed per URL

Full-text extraction is split by what a page actually needs, because routing
everything through a browser costs seconds per page and buys nothing on the two
platforms that are server-rendered:

| 平台 | Transport | Why |
| ---- | --------- | --- |
| 微信公众号 | `tc_static` (plain HTTP) | Fully server-rendered; no cookies, no JS |
| 小红书 | `tc_static` when the URL carries `xsec_token=`, else Edge | Body is in `window.__INITIAL_STATE__` in the first response |
| 知乎 | `tc_browser` (Edge) | Answers a plain GET with 403 plus a `zse-ck` JS challenge that has to be executed |

`tc_extract.parse(url, html)` is the single parser both transports call, so the
two can never disagree about what a page said. The rate-limit policy lives in
`tc_static.HOST_PACING` and is reused by the browser transport, so the two paths
cannot drift apart either.

The measured saving is not marginal: WeChat and tokenized Xiaohongshu notes come
back over HTTP with no browser at all, and they are usually most of a candidate
set. Only Zhihu and the pages the cheap path could not read reach Edge.

### Request identity is load-bearing

Both transports send a desktop Chromium/Edge UA with `Accept-Language: zh-CN`.
That is not cosmetic:

- **WeChat** returns the article for a desktop UA with no Referer (or a
  `mp.weixin.qq.com` one), and a 302 to an error page for a third-party Referer,
  a mobile `MicroMessenger` UA, or no UA at all.
- **Xiaohongshu** turns a public note page into a login redirect if
  `Accept-Language: zh-CN` is missing, even when the token is valid.

### The WeChat body is invisible to `innerText`

`#js_content` ships with `style="visibility: hidden; opacity: 0;"`, and page JS
clears it. Read `innerText` too early and you get 0 chars on a perfectly good
article. `tc_extract` reads the subtree with `textContent` and ignores the inline
visibility style, which is why the static path returns a real body where a naive
extractor records "no extractable body".

Jina Reader was tried and removed from the pipeline: unauthenticated it gets
rate-limited into serving Cloudflare "Just a moment…" pages, which the quality
gate then (correctly) rejects. See `tooling-notes.md`.

## Keywords are never hard-coded

Two layers, neither topic-specific:

1. `tc_query.expand` applies **structural** variation only — it strips
   interrogative scaffolding (`你有哪些`, `如何`, `是什么`…) from whatever topic
   it is given, then wraps the core in shape templates (技巧/方法/经验/心得…).
2. The caller supplies **semantic** synonyms per run via `--synonym`, so the
   same topic can be approached with different wording each time.

Nothing about any particular topic lives in the code.

## The two gates that keep garbage out

Crawling is not the hard part; not reporting junk is. Two gates run in `flatten`:

**Gate 1 — `tc_web.body_quality`.** Is this prose at all? Catches anti-bot
interstitials, raw HTML, and navigation dumps, by length, interstitial markers,
markup density, sentence terminators, and short-fragment ratio. This exists
because an early run saved eight Cloudflare challenge pages as "articles", all
suspiciously uniform at ~5,700 chars.

**Gate 2 — topical relevance, via `select_terms` + `relevance`.** Is it about
the topic? A pure term-frequency check fails here in a specific way: a
middle-school composition lesson about 抓住细节 repeats 细节 dozens of times and
outscores a real article about reading people. The fix is to measure rather than
hard-code. `select_terms` computes each candidate term's document frequency
across the crawled corpus and keeps only terms inside a **band**:

- above `generic_df` (50% of pages) → demoted to *support*. A word in most pages
  is not describing the topic, it is describing Chinese prose.
- below `min_df` (4%) → also demoted. Bigram splitting of "特殊的识人技巧"
  produces fragments like `的识` and `人技`; a single stray hit would otherwise
  promote a fragment to anchor and hand an off-topic page a free pass.
- in between → an **anchor**, and anchors alone decide admission (default: ≥2
  distinct anchors and ≥2 anchor hits).

Words the caller passes with `--term` bypass the lower bound, since the caller
has already asserted they are discriminative.

Ranking is by distinct-anchor count, then anchor density per 1000 characters —
not raw score, which is biased toward long articles.

## Running it

Search the current platform indexes first:

```powershell
python scripts\platform_search.py "你有哪些独到的识人技巧" `
  --synonym 识人技巧 --synonym 识人术 --synonym 看透一个人 `
  --platform xiaohongshu --platform zhihu --platform weixin `
  --limit 30 --weixin-pages 3 `
  --out "%USERPROFILE%\Documents\luz-crawl\NNN_主题\raw\platform-search"
```

Only then run the full-text article crawl when the current browser exposes CDP:

```powershell
python scripts\topic_crawl.py "爬取文章：你有哪些特殊的识人技巧？" `
  --synonym 识人术 --synonym 看透一个人 --synonym 判断一个人的人品 `
  --term 识人 --term 看人 --term 看透 --term 人品 `
  --per-author 3 --min-chars 300 `
  --out "%USERPROFILE%\Documents\luz-crawl\NNN_主题"
```

- `--term` supplies the discriminative vocabulary Gate 2 scores against. Give
  it the words that only an on-topic article would use.
- `--per-author` caps how many articles one writer contributes, so a prolific
  author cannot crowd out the rest. This is what produces author diversity.
- `--from-records path\to\records.json` rescoring path: `run()` always caches
  the raw crawl to `records.json`, so term/gate tuning can be re-run without
  re-hitting the platforms. Use it while tuning; it is much faster and avoids
  tripping rate limits.
- Chinese arguments containing spaces must be quoted, or argparse splits them.

Run with `python -u` (or rely on the built-in `line_buffering=True`) when
redirecting to a log; otherwise buffering hides all progress until exit.

## The browser lifecycle

The crawl launches and reaps its own Edge. It is silent by contract:

- **Launch is silent.** Headless by default. If a platform refuses the headless
  renderer, it retries through a headed Edge parked at `-32000,-32000` — still
  invisible to you. Nothing in a normal run puts a window on screen.
- **Only `C:\Users\Public\Desktop\Microsoft Edge.lnk`** (or the Edge it
  points at) is ever launched. No bundled Chromium, no Chrome.
- **Ownership decides teardown.** The run closes the Edge it started, via a
  graceful `Browser.close`, then `taskkill /PID <pid> /T /F`, then a sweep for
  its unique `--luz-crawl-marker`. An `atexit` hook does the same on an
  unhandled exception. A browser it merely attached to is disconnected, never
  closed.
- **Never kill by image name.** `taskkill /IM msedge.exe` would take out your
  unrelated Edge sessions. Only the PID tree and marker created by this crawl
  are ever touched.

Adopting the Edge you already have open is not possible in practice, and the
launcher does not pretend otherwise. Two things block it: a second `msedge.exe`
started against the default profile forwards to the running instance and exits,
so `--remote-debugging-port` never opens; and Edge 136+ refuses remote debugging
on a default `user-data-dir` outright. The launcher will use a CDP endpoint you
supply explicitly (`--cdp`), and will refuse one that answers but is not Edge —
crawling through a stray Chrome would be a silent identity change.

### Logging in

The crawl path never opens a visible window, so logging in cannot happen there —
a QR code needs a human. It gets its own command:

```powershell
python scripts\edge_login.py --status    # report profile state, open nothing
python scripts\edge_login.py             # visible Edge; log in; close it yourself
```

The login lives in the dedicated crawl profile
(`%USERPROFILE%\.luz-crawl-browser`), so later silent crawls reuse the
session. It is a **separate** profile from your everyday Edge on purpose:
touching that one would mean competing with the Edge you already have open, and
Edge refuses remote debugging on a default profile directory anyway.

A logged-in profile raises what the crawl can see:

- 知乎 caps a question at ~3 answers when anonymous, and **知乎搜索 is entirely
  login-gated** (`BrowserSession.zhihu_search` returns `[]` without it).
- 小红书 keyword search is login-gated; the anonymous explore feed is the
  fallback, and it is what supplies `xsec_token` values for note reads.

Neither is required for a basic run: the anonymous path reads Zhihu questions and
the XHS explore feed from your own IP (a datacenter IP gets 403/`code:40362`).

Do not attempt to lift cookies out of the user's profile to fake a session:
Edge 127+ uses App-Bound Encryption, and the cookie stores are exclusively
locked while the browser runs. `edge_login.py` is the supported route.

## Known limits

- **小红书 full-text reads require a signed `xsec_token` URL.** Use the
  connected OpenCLI search adapter to discover note URLs. An external index hit
  without a token is a search snippet only, not a detail-ready note. If the
  Bridge is disconnected or the search returns no token-bearing links, report a
  route limitation rather than absence of content.
- 知乎 discovery through Exa is weak (mostly non-article URL shapes). Native
  search is the better route but needs the login.
- 微信公众号 discovery through Exa is excellent, and extraction is the most
  reliable of the three.
- WeChat search results can surface expired `wxawap` links; the URL gate accepts
  only the permanent `/s/<id>` and `/s?__biz=` forms.

## Stop conditions

Per `tooling-notes.md`, do not work around any of these — stop and report:
CAPTCHA, QR login, `操作太快`, `请稍后再试`, security verification, or a login
wall on a read that should be public. The gates above are for judging content
that was legitimately returned; they are not a licence to bypass access control.
