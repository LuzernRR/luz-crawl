# Search Toolkit

Use this reference for unfamiliar, broad, or high-coverage searches.

## Tool Selection

Pick the smallest tool set that can answer the question with evidence:

| Need | Preferred routes |
| --- | --- |
| Broad discovery | Agent Reach search, web search, Exa/Jina/Firecrawl if available |
| Clean article/doc reading | Jina, Firecrawl, browser reader, direct HTTP text |
| Platform posts/comments | Agent Reach/OpenCLI platform commands, logged-in browser when needed |
| GitHub/code | `gh search`, `gh repo view`, `gh issue list`, `gh search code` |
| Websites at scale | Firecrawl crawl/map/scrape, sitemap/RSS, site search |
| Screenshots/visual proof | browser screenshot, Firecrawl screenshot, platform media download |
| PDFs/papers | direct PDF text extraction, arXiv/Semantic Scholar, official PDF |
| Standards/patents/industrial docs | web search, official standards bodies, patent search pages, supplier datasheets, PDFs |
| Videos | subtitles/transcripts, platform detail pages, comments, timestamps |
| Fresh updates | RSS, official changelog, social search, recent date filters |

## Agent Reach + Firecrawl Pairing

- Use Agent Reach first for platform-native or authenticated channels: X/Twitter, Xiaohongshu, Reddit, Bilibili, V2EX, LinkedIn/jobs, GitHub, video/RSS routes.
- Use Firecrawl for public web search, clean markdown scraping, structured JSON extraction, page interaction, screenshots, and small controlled crawls.
- Pair them when useful: Agent Reach finds platform/native leads; Firecrawl reads official/public pages deeply; GitHub CLI checks implementation reality.
- Record the route and failure/fallback in `<experience-root>\search-skill-library.md` through `finalize_run.py`.

## Search Directions

Choose directions by the user's intent:

- `查清楚`: prioritize official sources, source maps, conflicting claims, and limitations.
- `看看大家怎么评价`: prioritize Reddit/X/V2EX/Zhihu/Hacker News/comments/reviews and negative terms.
- `找工具`: prioritize GitHub, package registries, Product Hunt, app stores, official pricing/docs, recent issues.
- `找案例`: prioritize platform accounts, repos, product pages, screenshots, interviews, case studies.
- `找教程`: prioritize official docs, reproducible tutorials, videos with timestamps, GitHub examples, common failure issues.
- `找素材/灵感`: prioritize X, Xiaohongshu, design galleries, video platforms, prompt/image posts, reusable templates.
- `验证真假/风险`: prioritize primary source, negative searches, scam/complaint terms, fact-checking sources, timestamps.
- `竞品/市场`: prioritize official sites, pricing, reviews, social discussion, app stores, GitHub, news, public records.
- `学一个东西`: build a route from official basics to real examples, then common mistakes and a practice plan.
- `做系统/开发方案`: prioritize official docs, architecture references, GitHub examples, production case studies, failure modes, and integration constraints.
- `做工程级知识库`: save a normal root-level dossier with a clear title, then update search memory and durable lessons with fields, flows, risks, anti-bypass checks, and test criteria.
- `做设计/UI/前端设计`: prioritize design systems, real product screenshots, component libraries, UX case studies, accessibility docs, and implementation repos.
- `材料/工业/制造`: prioritize standards, datasheets, patents, papers, supplier/process pages, safety constraints, equipment requirements, and real factory cases.

## Coverage Checklist

For serious research, try to answer:

- What is the primary source?
- Who has used it or built with it?
- What do supporters say?
- What do critics/users complain about?
- What concrete steps, commands, or examples exist?
- What domain-specific constraints matter: performance, cost, safety, standards, compliance, manufacturability, accessibility, maintainability?
- What is outdated, blocked, paid, region-limited, or uncertain?
- What should be searched next?

## Evidence Quality

Label evidence strength:

- High: official docs, primary data, source code, directly observed platform content, reproducible command output.
- Medium: reputable articles, multiple independent examples, active GitHub issues, detailed user reports.
- Low: reposts, unsourced screenshots, marketing claims, engagement-bait threads, stale tutorials, single anecdotes.

## Raw Evidence Naming

Use clear raw filenames:

- `search_web_001.yaml`
- `search_x_001.yaml`
- `reddit_thread_001.md`
- `github_repo_001.json`
- `xiaohongshu_note_001.yaml`
- `wechat_article_001.md`
- `video_transcript_001.txt`
- `paper_001.md`

## Failure Handling

When a route is blocked:

- Record the exact route and error/limitation.
- Try one alternate route: platform search, web cache/mirror, official page, browser, or adjacent query.
- Do not invent inaccessible metrics or comments.
- Say what would be needed to verify it later.
