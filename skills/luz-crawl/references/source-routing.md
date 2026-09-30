# Source Routing

Use this reference before broad research or when choosing where to crawl.

## Executable Tool Discovery

Before choosing routes, run the persistent retrieval and tool preflight defined in `runtime-learning-loop.md`:

```powershell
python scripts\experience_store.py query "<intent domain platforms source types>" --limit 8
python scripts\tool_preflight.py --intent "<intent>" --platform "<platform>" --available-tool "<actually visible tool>" --probe-agent-reach
```

Pass only tools actually present in the current runtime. Use prior experience as a routing hint, then let current preflight evidence determine available backends, warnings, and fallbacks. For a non-trivial saved run, write the preflight result to `raw\tool-preflight.json`.

For domain-specific work such as software development, UI/UX, databases, engineering, materials, manufacturing, industrial technology, business, policy, or science, also read `domain-playbooks.md`.

## Default Search Lanes

For any non-trivial topic, cover the useful lanes below:

- Source of truth: official docs, help pages, standards, original announcements, policies, primary articles, filings, release notes.
- Real examples: accounts, posts, repos, case studies, tutorials, demos, templates, screenshots, public datasets.
- Discussion: Reddit, X, V2EX, Zhihu, Hacker News, GitHub issues/discussions, comments, reviews, forums.
- Negative/risk: `scam`, `not worth it`, `banned`, `broken`, `outdated`, `complaint`, `refund`, `踩坑`, `骗局`, `封号`, `失效`, `避雷`.
- Implementation: `how to`, `workflow`, `setup`, `template`, `example`, `tutorial`, `教程`, `步骤`, `配置`, `命令`.
- Freshness: current news, changelog, latest discussions, recent commits, last-updated filters.
- Domain constraints: standards, patents, datasheets, benchmarks, safety/compliance, manufacturability, accessibility, scalability, cost, supply availability.

## Platform Routes

### Agent Reach / OpenCLI

- Run `agent-reach doctor --json` before platform-backed crawling.
- Use the platform command reported as available by doctor. Also verify `opencli doctor` and `opencli profile list`; adapter installation alone does not mean the active browser is connected.
- Follow `references\opencli-edge-workflow.md` for Edge selection, Browser Bridge checks, ephemeral-page cleanup, and the user's browser constraints.
- Use `scripts\platform_search.py` for Xiaohongshu, Zhihu, and WeChat article search when OpenCLI is connected. It runs one platform command at a time through the existing Browser Bridge profile, uses `--site-session ephemeral --keep-tab false`, and never starts or terminates Edge. If all topic queries return empty, it runs one platform-specific broad control query and reports that separately from topic evidence.
- Label `opencli weixin search` as Sogou's WeChat article index, not as a search performed inside the WeChat client.
- Treat a successful command with an empty list as an empty response for that query, not proof that the platform has no matching content. If all topic variants return empty, use the separate health-control query; if it is empty too, record results as unconfirmed and inspect session/access or adapter health. A control hit establishes only that the adapter returned content, not that the topic is absent.
- Keep browser/session-backed commands sequential.
- Save raw YAML/JSON/text outputs for search results, detail pages, and comments when they affect conclusions.

### Web Search / Web Pages

- Use web search for discovery, then read primary pages through Jina, Firecrawl, browser, or other available clean-reading tools.
- Use `site:` queries for official docs, GitHub, Reddit, app stores, package registries, and platform-specific pages.
- Use Firecrawl when available for cleaner Markdown, screenshots, crawling a small site, or structured extraction.
- For unknown public sources, try Firecrawl search; for known URLs, Firecrawl scrape; for site sections, Firecrawl crawl with tight limits; for fields, Firecrawl extract with a JSON schema; for dynamic pages, Firecrawl interact.
- Use Jina/readability routes for articles and docs when Firecrawl is unnecessary or blocked.
- Record paywalls, login walls, anti-bot pages, expired pages, and inaccessible fields.

### Xiaohongshu

- Use `opencli xiaohongshu search/note/comments/download` when available.
- Use daily-language queries, not only formal topic names.
- If both topic queries and a broad control query return empty lists, do not claim no matching notes exist. Record the empty response, check the current account/session, and mark topic coverage unconfirmed. A creator-profile login check can indicate an expired session but is not itself a note-search result.
- Read details with the full signed URL from search results, including `xsec_token`.
- Read comments/download media with the full signed URL when the backend requires it.
- Preserve note URL, author, publish/update time when visible, likes/collects/comments when visible, and comment evidence.

### X / Twitter

- Prefer platform commands through Agent Reach or `opencli twitter` where available.
- Use search for discovery, tweet/article/user commands for detail, and preserve status URLs.
- For images/prompts/design references, download real media URLs when available; do not replace original media with screenshots unless labeled.
- Use concise creator wording and advanced filters when useful: `from:`, `min_faves:`, exact phrases, `filter:links`, dates.

### Reddit

- Use `opencli reddit search/read` or `rdt-cli` according to `agent-reach doctor --json`.
- Favor problem language, buyer/user complaints, tool comparisons, alternatives, and negative experiences.
- Avoid affiliate spam, SEO reposts, and single-comment claims.

### GitHub

- Use `gh search repos`, `gh repo view`, `gh issue list`, `gh search code`, releases, discussions, and README/docs as appropriate.
- Stars, forks, recent commits, open/closed issues, examples, docs, licenses, and maintainer activity are useful evidence.
- For workflows, pair official README/docs with issues for failure modes.

### WeChat Public Accounts

- Search by exact title, account name, topic + `公众号`, and mirrored pages when direct pages are inaccessible.
- Note when a page is inaccessible, mirrored, expired, risk-controlled, or missing comments/read counts.
- Extract article structure, claims, source links, author/account, date, and any visible engagement.

### Zhihu / V2EX / Hacker News

- Use these for debate, lived experience, technical opinions, product feedback, and Chinese/English community sentiment.
- Search with words like `如何评价`, `有没有`, `替代`, `踩坑`, `experience`, `alternatives`, `Show HN`, `Ask HN`.
- Separate representative comments from outlier claims.

### Video: YouTube / Bilibili / TikTok / Douyin

- Use video-native search when the content itself is video-native.
- Prefer transcripts/subtitles, descriptions, pinned comments, chapter timestamps, and visible comments.
- Extract steps, tools, timestamps, claims, and demonstrations. Avoid summarizing mood without concrete evidence.
- For short video platforms, preserve author, video link, title/caption, visible metrics, and comment signals.

### Package / App / Product Registries

- For software/tool questions, search npm, PyPI, crates.io, Go packages, Docker Hub, VS Code marketplace, Chrome Web Store, app stores, Product Hunt, and official pricing/docs when relevant.
- Extract version, last release, installs/downloads, license, maintainer, dependencies, issues, pricing, and permissions.

### Standards / Patents / Datasheets

- Use for materials, industrial processes, hardware, safety, compliance, manufacturing, medical/energy/infrastructure, and any field where specifications matter.
- Search standards bodies, vendor datasheets, SDS/MSDS, patent databases/pages, equipment manuals, government/institution pages, and PDF technical notes.
- Extract standard number/version, jurisdiction/scope, property/spec table, process conditions, safety limits, claims, expiration/status when visible, and source date.

### Academic / Papers / Data

- Search arXiv, Semantic Scholar, Google Scholar/web results, institution pages, datasets, and paper PDFs.
- Extract title, authors, date, venue, method, claims, limitations, citations if visible, and linked code/data.
- Prefer recent surveys and primary papers over unsourced blog summaries.

### News / Companies / Public Records

- Use official announcements, reputable media, filings, company blogs, press releases, LinkedIn/company pages, app pages, and domain records when available.
- Record timestamp and jurisdiction. For fast-moving topics, mark staleness clearly.

## Query Construction

Build query types as needed:

- broad: `<topic> overview / guide / 资料 / 总结`;
- source: `<topic> official / docs / policy / 官网 / 文档`;
- example: `<topic> case study / examples / 账号 / repo / 模板`;
- discussion: `<topic> reddit / twitter / v2ex / zhihu / hn / comments / review`;
- negative: `<topic> scam / not worth it / broken / outdated / 踩坑 / 失效 / 避雷`;
- implementation: `<topic> workflow / setup / step by step / 教程 / 怎么做`;
- freshness: `<topic> 2026 / latest / changelog / release / 最近 / 最新`.
- standards/patents: `<topic> standard / specification / datasheet / SDS / MSDS / patent / ISO / ASTM / IEC / GB / 标准 / 专利 / 数据表`.
- production/industrial: `<topic> process / manufacturing / equipment / yield / defect / tolerance / supplier / 工艺 / 设备 / 良率 / 缺陷 / 公差 / 供应商`.

Use platform-native language. A normal user's phrase often works better than an academic phrase.
