# Search Skill Library

Use this before planning searches and before recording retrieval/tool experience. This is separate from the knowledge base:

- Search skill library = how to search better next time.
- Knowledge base = what was learned about the user's topic.

## Persistent Files

Record durable search-skill lessons in:

```text
<experience-root>\search-skill-library.md
```

When a search skill becomes broadly useful, also create a normal root-level saved dossier with a clear title.

Use:

```powershell
python scripts\prepare_output.py "搜索经验小红书评论检索方法" --with-raw
python scripts\prepare_output.py "搜索经验Firecrawl站点抓取方法" --with-raw
```

## Before Searching

Check existing search skills first:

1. Run `python scripts\experience_store.py query "<intent domain platforms source types>" --limit 8`.
2. Use matched entries from `<experience-root>\search-skill-library.md` and `knowledge-index.md`; do not load the entire memory files by default.
3. Reuse previous channel routes, keywords, tool fallbacks, and image/media handling notes.
4. Expand from the old pattern with at least one new query/channel when the user wants broad research.
5. If recent searches stayed in the same topic cluster, deliberately open at least two unfamiliar industry lanes before concluding.
6. Treat every strong source as a source graph seed: extract its people, organizations, communities, jargon, outbound links, quoted accounts, commenters, screenshots, and tool names.

## Search Skill Entry Shape

Record entries like:

```markdown
## YYYY-MM-DD Topic / Channel / Tool

- Intent:
- Domain:
- Channel/platform:
- Tool route:
- Worked keywords:
- Weak/noisy keywords:
- Useful filters/operators:
- Raw evidence saved:
- Image/media handling:
- Tool problems:
- Fix/fallback:
- Reusable next pattern:
- Source graph seeds:
- New second-layer keywords:
- Industry lanes opened:
```

## Source Graph And Keyword Compounding

For opportunity, market, industry, and "information gap" research, the search skill must compound. Do not stop at the first keyword that worked.

When a result is high-signal, build a small source graph:

- `accounts`: handles, authors, founders, maintainers, operators, public whistleblowers, niche analysts, trade writers, and commenters who reveal operational details;
- `organizations`: companies, agencies, associations, open-source orgs, newsletters, podcasts, vendors, communities, and marketplaces mentioned by the source;
- `communities`: subreddits, forums, Discord/Slack communities when public, V2EX nodes, GitHub discussions/issues, app-store review pages, YouTube channels/comments, Bilibili creators, Xiaohongshu accounts, WeChat accounts, trade boards;
- `jargon`: domain terms, acronyms, workflow names, failure names, metrics, roles, tools, and pricing language;
- `adjacent lanes`: industries where the same problem appears under different words.

At least one follow-up query should come from this graph before finalizing a serious search. If time or tooling prevents it, record the skipped follow-up as a next query.

High-quality source graph seeds usually look like:

- first-person operator reports: `what X months looked like`, `postmortem`, `I stopped doing X`, `before you buy`, `real results`;
- comments where buyers/operators ask detailed questions or complain about a workflow;
- trade forums where people discuss costs, refunds, compliance, downtime, vendors, and workarounds;
- repos/issues where users request features or report repeated workflow pain;
- niche newsletters/podcasts where practitioners name tools, roles, budgets, and bottlenecks.

Low-quality seeds include:

- generic viral posts with no buyer, no workflow, and no comments;
- income screenshots and course funnels;
- official rule pages by themselves;
- AI-generated listicles that do not name real operators, communities, tools, or examples.

## Tool Roles

### Agent Reach

Use Agent Reach for platform and internet routing:

- Run `agent-reach doctor --json` before multi-backend platform crawling when feasible.
- Use Agent Reach/OpenCLI for authenticated or platform-native content: Xiaohongshu, X/Twitter, Reddit, Bilibili, V2EX, LinkedIn/jobs, GitHub, RSS/video routes.
- Save raw YAML/JSON/text outputs under `raw\`.
- Record active backend, command shape, login/session limits, signed URL requirements, and retry chain.
- After broad multi-platform research, run `agent-reach check-update`.

Common issues to record:

- doctor timeout or unavailable backend;
- login/session missing;
- platform anti-bot or risk-control;
- signed URL required, such as Xiaohongshu `xsec_token`;
- browser-backed commands cannot run in parallel;
- comments/media endpoints differ from search endpoints.

Fallbacks:

- platform-native OpenCLI -> web search -> Firecrawl/Jina -> browser screenshot -> related query;
- exact URL read -> platform search by title/author -> web mirrors -> adjacent keywords.

### Firecrawl

Use Firecrawl for web search, clean markdown, structured extraction, screenshots/page interaction, and controlled crawling:

- `firecrawl_search`: unknown source discovery or site-specific web search.
- `firecrawl_scrape`: known URL to markdown or JSON.
- `firecrawl_crawl`: small site/section crawl with tight limits and API key when needed.
- `firecrawl_extract`: structured JSON extraction with a schema.
- `firecrawl_interact`: dynamic pages that need visible interaction.

Record:

- query/URL, Firecrawl mode, formats, schema/prompt if used;
- onlyMainContent setting, screenshot or markdown availability;
- blocked login walls, anti-bot, JS rendering issues, empty extraction, rate limits;
- fallback to Agent Reach/OpenCLI for cookie-backed social platforms.

### GitHub / Code Search

Use `gh search repos`, `gh repo view`, `gh issue list`, `gh search code`.

Record:

- query, sort mode, filters, repo health signals, issue patterns;
- stars/forks are not enough; note release cadence, open issues, examples, license, maintainer activity.

### Jina / Direct Web / RSS

Use Jina/direct HTTP for simple readable pages and RSS for update streams.

Record:

- URL readability, missing images, paywall/login wall, stale content, RSS feed quality.

## Channel Coverage

Use the right channel mix:

- X/Twitter: creator workflows, breaking tools, AI/design prompts, public debates, status links, media.
- Reddit: user pain, alternatives, negative experiences, buyer/user reality.
- GitHub: implementation, code, issues, examples, libraries, project maturity.
- Xiaohongshu: Chinese consumer use cases, visual notes, comments, lifestyle/product/design inspiration.
- WeChat public accounts: long-form Chinese industry articles, tutorials, product/industry commentary.
- Zhihu/V2EX/Hacker News: technical debate, product judgment, community sentiment.
- YouTube/Bilibili/TikTok/Douyin: demonstrations, tutorials, timestamps, comments, visual proof.
- LinkedIn/jobs: hiring demand, company activity, role requirements.
- App stores/Product Hunt/Chrome/VS Code marketplaces: product reviews, pricing, adoption, permissions.
- npm/PyPI/Crates/Go/Docker registries: package maturity, versions, dependencies, downloads.
- Standards/patents/papers/datasheets: engineering, materials, industrial, scientific, compliance-heavy topics.
- RSS/news/company blogs: freshness, release tracking, market changes.

## Image And Media Skill

When images matter:

- Put captured images/screenshots/media under the dossier's `raw\images\` or `raw\media\`.
- Prefer original platform media URLs/downloads where available; label screenshots separately.
- Verify image bytes with `validate_output.py --require-images` when images are expected.
- Use local visual inspection when necessary.
- Record source URL, author, capture/download route, filename, and limitation.
- If image recognition is needed, summarize visible content, text, UI structure, object/material details, and uncertainty.

Common problems:

- platform strips media URLs;
- thumbnails are low resolution;
- signed URLs expire;
- screenshot includes UI chrome;
- image OCR/visual inference is uncertain;
- downloaded file is not an image despite extension.

Fallbacks:

- read detail page -> download media endpoint -> browser screenshot -> Firecrawl screenshot -> manual visual inspection.

## Closing Update

At the end of a saved run, update search skills with:

```powershell
python scripts\finalize_run.py "<dossier-folder>" `
  --summary "..." `
  --channel "X/Twitter" `
  --tool "agent-reach/twitter" `
  --worked-query "..." `
  --weak-query "..." `
  --tool-problem "..." `
  --tool-fix "..." `
  --image-note "..." `
  --lesson "..."
```

If the tool lesson is important enough to reuse many times, also create a normal root-level dossier with a clear title such as `搜索经验Reddit评论检索方法`.
