# Xiaohongshu Backends

Use this reference when a task requires concrete Xiaohongshu note details, especially when the user asks whether posts can be crawled without logging in.

## Readiness Rule

Concrete note crawling requires evidence from a backend that can provide both note identity and access token context:

- Search/feed result contains `note_id` or `feed_id`.
- Search/feed result contains `xsec_token` or a full note URL carrying `xsec_token`.
- Detail command returns title/body/author/media or a clear platform limitation.

If the backend cannot provide the token-bearing route, save a backend-readiness or public-search record instead of claiming a concrete note crawl.

## Explore URL Lesson

Concrete Xiaohongshu notes use this route shape:

```text
https://www.xiaohongshu.com/explore/<note_id>?xsec_token=<token>&xsec_source=
```

`opencli xiaohongshu feed -f yaml` can return these full token-bearing URLs, and `opencli xiaohongshu note "<full explore URL>" -f yaml` can read title, author, content, likes, collects, comments, and tags when the browser session is valid.

Do not use bare `https://www.xiaohongshu.com/explore` as proof that note crawling works. It can be a browser frontend navigation route, but anonymous HTTP/Jina/curl may return 404 or a JavaScript shell. Treat bare `explore` as a navigation route only, not a stable crawl source.

If `opencli xiaohongshu search "query"` returns `[]` while `feed` works, record this as a search-backend limitation, not demand absence. Pivot to:

- `opencli xiaohongshu feed -f yaml` for accessible explore URLs;
- `opencli xiaohongshu user <profile_id> -f yaml` for account note lists;
- known full note URLs with `xsec_token`;
- public `goods-detail/<id>` pages through Jina when readable;
- external search snippets only as secondary seeds.

## Backend Matrix

| Backend | Concrete Detail Route | Login / Browser State | Media | Write-Risk Commands | Stop Condition |
| --- | --- | --- | --- | --- | --- |
| Agent Reach + OpenCLI | `opencli xiaohongshu search "关键词" -f yaml` then `opencli xiaohongshu note "<full URL with xsec_token>" -f yaml` | Requires OpenCLI daemon plus Browser Bridge extension; may require user session depending on platform state | Use `download` only after read success | OpenCLI has write commands; use only `[read]` commands | `Browser Bridge extension not connected`, CAPTCHA, QR login, security verification |
| redbook-mcp | `search_feeds` or equivalent search, then `get_feed_detail(feed_id, xsec_token, ...)` | Usually needs browser/session setup | Can expose note media depending on implementation | May include comment/like/favorite tools; never call them | Missing `xsec_token`, login wall, risk-control page |
| xiaohongshu-mcp | Search first, then detail with `feed_id` + `xsec_token` | README-style tools usually require first login | Can expose note images/comments | Often includes publish/comment/like/favorite | First-step login is required and user has not approved it |
| xhs-k-search | `uv run python main.py --keyword "关键词" --headless`, then detail with `--note-id` and `--xsec-token` | Login saves `auth.json`; detail is normally headed | Playwright can download or expose media URLs | Review repo before use; keep to search/detail/comments | Detail window asks for login/CAPTCHA or token is missing |
| Public search / Firecrawl | Search indexed pages and scrape readable public URLs | No login | Usually unreliable for original images | Read-only | 404 shell, JavaScript shell, token/session mismatch |

## Local State Pattern

When OpenCLI is installed but not connected, this is not enough:

```powershell
opencli doctor
opencli xiaohongshu search "搞笑 爆梗" -f yaml --window background --site-session persistent
```

If the result says `Browser Bridge extension not connected`, record that exact limitation and stop. Do not escalate to QR login or CAPTCHA solving unless the user explicitly chooses that path.

## Output Decision

- Successful detail read with media: create a numbered folder, create `images`, download real media, insert images above the matching content.
- Successful detail read without media: create a numbered folder with only one Markdown file; do not create `images`.
- Search snippets only: use the Xiaohongshu public-crawl minimal format and mark the result as public-search snippets, not concrete note detail.
- Backend setup failure: save a backend-readiness record only when useful for future runs.
