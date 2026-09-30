# Tooling Notes

## Safety

- Prefer official APIs, user-authorized browser sessions, Agent Reach/OpenCLI, Firecrawl, and read-only extraction.
- Do not run random crawler repositories directly against user accounts without reviewing code, dependencies, login handling, and data exfiltration risk.
- Do not bypass login, CAPTCHA, paywalls, platform rate limits, or private content access controls.
- For login-backed platforms, use only the user's explicit session and read-only actions unless the user separately authorizes a write action.

## X / Twitter

- Public posts: Firecrawl can often extract post, thread replies, and top comments.
- Images: use the in-app browser DOM to collect `pbs.twimg.com/media/` URLs, then download `name=orig`. Prefer `?format=jpg&name=orig` or the same `format` discovered in the DOM. Verify downloaded file sizes; a successful command with no files is not success.
- Bookmarks: require an active X login. Navigate to `https://x.com/i/bookmarks`; if redirected to onboarding/login, ask the user to log in and resume.
- When bookmarks are visible, collect post URLs from article status links, then open each post to get full prompts and original media. Timeline thumbnails may use `name=small`; post pages usually expose better `pbs.twimg.com/media/...` URLs.
- If the in-app browser viewport is small, coordinate scrolling can fail with "No element found at point". Read `innerWidth`/`innerHeight`, scroll from an in-viewport point, or use DOM scroll.
- For prompt-sharing posts, read article text before opening details. Main post phrases such as "提示词在评论区" require opening the reply permalink once to capture the full prompt.
- Main post, quote post, and comment reply may all expose images. Keep only the images that belong to the prompt item being saved; do not mix quoted examples into the main item unless the prompt explicitly belongs to the quote.
- Useful GitHub references to inspect before building local automation:
  - `TommyD04/twitter-bookmarks-scraper`
  - `nagata-ichiko/twitter-bookmarks-scraper`
  - `sobrinojulian/twitter-bookmarks-scraper` (archived)

## Reddit

- Reddit search/read usually needs login-backed Agent Reach/OpenCLI or rdt-cli.
- If the in-app browser shows Reddit "network security" blocking, stop and do not bypass. Ask for a logged-in usable browser session or use configured CLI backends.
- Use read-only collection for posts/comments. Preserve subreddit, author, URL, score, date, and comment tree when useful.
- For prompt-sharing or trend tasks, summarize per post with title, link, media, body/comment extracts.

## Xiaohongshu

- Concrete note crawling is possible, but normally requires `note_id` plus `xsec_token`. The token comes from search/feed/user page state and is session-bound.
- Do not force Xiaohongshu login by default; risk control is strict. Prefer public search, Firecrawl indexed results, or already configured Agent Reach/OpenCLI/xiaohongshu-mcp/redbook-mcp style backends.
- Firecrawl may return a 404/sec shell even for URLs that already contain `xsec_token`, because token validity can depend on session, device, geography, or risk-control state. Treat this as inaccessible, not as an empty note.
- If `agent-reach doctor --json` reports Xiaohongshu `status: off`, the next real step is installing/configuring a backend, not retrying public scrape loops.
- OpenCLI route: `agent-reach install --channels opencli`, then `opencli xiaohongshu search "搞笑 爆梗" -f yaml`, then `opencli xiaohongshu note "<full URL with xsec_token>" -f yaml`.
- redbook-mcp route: `npx redbook-mcp search "搞笑 爆梗"`, then `npx redbook-mcp detail <feed_id> --token <xsec_token>`.
- Never read by bare note id when the backend requires full URL or `xsec_token`.
- Correct flow: search keyword or feed first -> capture `id` and `xsec_token` -> call detail endpoint/tool with both -> optionally load comments with low limits.
- Full signed note URLs with `xsec_token` are preferable to bare note ids.
- Stop on CAPTCHA, QR login, "操作太快", "稍后再试", or security verification unless the user explicitly chooses to continue manually.
- Useful GitHub references to inspect before custom automation:
  - `DeliciousBuding/xiaohongshu-skill`: Python + Playwright; extracts `window.__INITIAL_STATE__`; FAQ confirms `xsec_token` is session-bound and should be taken fresh from search/user results. It has frequency control and login checks.
  - `yangsijie666/xiaohongshu-crawler`
  - `KunCheng-He/xhs-k-search`: Playwright skill; install with `cd scripts && uv sync && uv run playwright install chromium`; login with `uv run python main.py --login`; search with `uv run python main.py --keyword "搞笑 爆梗" --headless`; detail with `uv run python main.py --note-id <帖子ID> --xsec-token <token>`. Detail mode is forced headed because of anti-crawl limits.
  - `adjfks/redbook-mcp`: MCP/CLI; read-only tools include `search_feeds(keyword, filters)`, `get_specified_post(keyword, post_count, filters)`, `get_feed_detail(feed_id, xsec_token, load_all_comments, comment_config)`, and `user_profile(user_id, xsec_token)`. Destructive tools such as comment, like, and favorite exist but must not be used by this skill.
  - `Tangerineeew/Selenium-basedXiaohongshuCrawler`
  - `upJiang/jiang-xiaohongshu-crawler`
  - `mcxiaoxiao/xiaohongshuCrawler`

## Boss Zhipin

- Boss Zhipin is login and anti-bot sensitive. Prefer user-authorized browser reading, low frequency, and no automated messaging.
- Public pages may expose partial job descriptions while prompting login for full content. Save only visible fields and mark "登录查看完整内容" when present.
- Firecrawl search can return useful public job snippets while direct scrape of list/detail pages may return `安全验证`. If detail pages hit verification, preserve only search-visible fields and mark the scrape limit.
- Individual `job_detail` pages may be more readable than `zhaopin` aggregation pages. If a detail page is readable, aggressively remove login/register dialogs, SMS/QR code blocks, "立即沟通", "感兴趣", resume/profile prompts, popular city links, recommended company footers, and unrelated similar-job walls.
- If the visible job description stops mid-sentence or mid-list because of page truncation, record the exact truncation point instead of guessing the missing requirements.
- Never click "沟通", submit resumes, send greetings, or complete SMS/QR login unless the user explicitly instructs and performs/authorizes the login step.
- For AI agent recruiting reports, capture title, company, city, salary, experience, skills, job description, and URL.
- Useful GitHub references to inspect before custom automation:
  - `AlexRedfield/BossZhipinCrawler`
  - `azhuquq/BOSS_Analysis`
  - `AndyChenIT/skills-boss-zhipin-crawler`
  - `can4hou6joeng4/boss-agent-cli` (AI-agent-first CLI with structured JSON output, throttling, browser fallback, and Boss/Zhilian adapter design; inspect before any adoption and keep this skill read-only by default).

## WeChat Public Accounts

- Public account article access can vary by source. Prefer official/open web pages, Sogou/WeChat search when available, or Firecrawl for accessible article URLs.
- If `mp.weixin.qq.com` search returns expired `wxawap` links or unreadable pages, use public mirrors, media reports, article-analysis pages, or author-owned repost pages and label the source type clearly instead of implying it is the official WeChat page.
- Public mirrors/blogs can contain long unrelated sidebars, ads, comments, recommendations, subscription forms, share widgets, author cards, table-of-contents anchors, and QR-code blocks. Clean these aggressively; keep title, source, date, core claims, article structure, reusable writing mechanics, and crawl limitations.
- For viral article research, capture title, account, publish date, URL, cover image, opening hook, structure, key claims, comments if available, and why it spread.
- Useful GitHub references to inspect before custom automation (verified 2026-06):
  - `qiye45/wechatDownload` — 8.3k★, actively maintained. Sniffs the article key from the WeChat client, batch downloads full accounts, 合集, comments, read/like/share counts, original-only filter, image/video/audio media. Exports html/mhtml/md/pdf/docx/csv. Ships an MCP server (since v4.4) and bundles a `skills/wechat-article-downloader` directory; MCP can bind `0.0.0.0` so it is callable from WSL. Best fit for this skill when the user owns a Windows/macOS WeChat client.
  - `wechat-article/wechat-article-exporter` — 11.9k★, online/Docker/Cloudflare deploy. Uses the public account composer's article search to enumerate any account; requires the user to QR-scan into their own 公众号 backend. Read counts/comments need separately captured credentials. Outputs HTML/JSON/Excel/TXT/Markdown/DOCX.
  - `systemmin/wxdown` — Go cross-platform CLI, lighter weight, no MCP.
  - Legacy references (kept only for format ideas, not for adoption): `hzhu212/wechat-mp-crawler` (last commit 2019, Fiddler-based, brittle), `zhanglin233/wechat-mp-crawler` (scaffold only).

## Market Information

- Use read-only public sources. Prefer official exchange/company/regulator pages for primary facts, then reputable market/news sources for context.
- Futures sources to prioritize: CME/ICE/SHFE/DCE/ZCE notices, product calendars, margin rule changes, warehouse/inventory reports, CFTC Commitments of Traders, USDA/EIA/API reports where relevant, central-bank and macro calendars.
- HTX/Huobi sources to prioritize: HTX official announcements, status/maintenance pages, trading pair pages, reserve/security announcements, major exchange/regulatory announcements, and reputable crypto market news.
- Stock sources to prioritize: company IR pages, SEC EDGAR, exchange notices, Nasdaq/NYSE earnings calendars, Federal Reserve/BLS/BEA calendars, and reputable financial news.
- Always distinguish fact from inference. Phrase directional relevance as "may affect" or "watch item", not "buy/sell".
- Do not create an `images` directory for text-only market crawls.
