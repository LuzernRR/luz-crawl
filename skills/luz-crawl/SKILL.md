---
name: luz-crawl
description: >-
  Universal search and research assistant for finding, verifying, and organizing information across official sources, the web, social platforms, GitHub, video, forums, standards, patents, papers, PDFs, docs, screenshots, and user-provided links. Invoke automatically whenever the user asks to search, research, look up, find, compare, investigate, verify, collect sources, inspect current or latest information, learn from links, or find examples, tools, repos, posts, comments, or reviews, even without naming Luz Crawl. Chinese triggers include 搜索、搜一下、查一下、帮我查、帮我找、调研、核实、验证、对比、最新消息、找资料、找案例、找教程、找项目、看看网上怎么说. Use across technical, scientific, industrial, business, design, policy, and consumer topics. Before meaningful search, identify the real goal, domain, audience, task context, risks, assumptions, and output goal, then create a search plan. Inventory search tools and reuse persistent experience before searching. Save formal research under %USERPROFILE%\Documents\luz-crawl unless chat-only is requested.
---

# Luz Crawl

## Purpose

Use this skill as the user's personal universal search assistant. The user can ask for any content or information: a topic, question, person, company, product, repo, tool, platform account, market signal, paper, tutorial, design reference, image/prompt inspiration, error message, public opinion, buying decision, competitor, document, engineering practice, industrial process, material, supplier, standard, patent, or a batch of links.

The job is not to rush into keywords. First understand what the user is really trying to decide, build, buy, learn, verify, collect, or compare; then find the best places where the information lives, search across multiple appropriate channels, extract durable evidence, and produce a useful synthesis. For research/search tasks, default to saving a reusable dossier under:

```text
%USERPROFILE%\Documents\luz-crawl
```

Do not behave like a single search-engine summary. Build a source map, compare claims, preserve links/raw evidence, mark uncertainty, and remember which queries and channels worked for future searches. The final user-facing summary should surface the most useful conclusions first: what matters, what to do, what to avoid, and which sources prove it.

## Boundary With XHS Skills

`.luz-crawl` is the evidence and search layer. It crawls, reads, archives, verifies, compares, and deposits search experience. It does **not** decide Xiaohongshu packaging, generate covers, write Xiaohongshu titles/tags, or create sellable PDF/Excel resource packs. When `xhs-skills` needs market proof, product-resource inspiration, comments, screenshots, notes, or multilingual user pain, `xhs-skills` should call `.luz-crawl` first and consume an evidence packet.

When `.luz-crawl` is called as part of an `xhs-skills` run, the final owner directory is:

```text
<xhs-output-root>\NNN_主题\
```

In that mode, `.luz-crawl` should save raw search outputs, evidence packets, source maps, downloaded reference media, and manifest entries under the caller's `raw\crawl\` or `raw\` paths instead of creating a separate final dossier under `%USERPROFILE%\Documents\luz-crawl`. Standalone `.luz-crawl` research still uses its normal `luz-crawl` output root.

For Xiaohongshu virtual-resource commerce, `.luz-crawl` must collect proof from any reliable channel where the real demand or resource shape appears, not only Xiaohongshu:

- demand/comments: Xiaohongshu, Douban groups, Reddit, X/Twitter, V2EX, Zhihu, forums, YouTube/Bilibili comments, app reviews, product reviews;
- product/resource signals: Etsy, Gumroad, Payhip, Ko-fi, Notion marketplaces, Canva template listings, Google Drive/share pages, GitHub repos, blogs, newsletters, official handbooks, public worksheets;
- multilingual sources: English, Japanese, Korean, Spanish, French, German, Portuguese, and other languages are allowed when they reveal real pain, resource formats, or underserved templates. Preserve the original source and note translation/localization needs; final Xiaohongshu work happens in Chinese downstream.

The output to `xhs-skills` should separate:

- `user_pain`: what real users complain about, ask for, fear, or repeatedly request;
- `comment_demand`: comment evidence such as "求模板", "where can I find this", "need spreadsheet", "does anyone have a tracker";
- `resource_shape`: what downloadable products/resources actually include, file formats, page count, sections, price, usage instructions, platform;
- `market_gap`: broad paid category + specific underserved person/problem + existing generic/poor products;
- `localization_notes`: what must be translated, adapted to Chinese context, or checked against local rules;
- `risk_notes`: copyright, medical/legal/financial claims, credential needs, platform rules, and evidence limits.

When the user asks for broad market discovery, `.luz-crawl` may scan multiple verticals to build a candidate queue, but it must not turn that scan into multiple downstream products. Save broad findings as a queue and evidence map only. When `xhs-skills` starts productization, crawl one candidate at a time and keep each account, note, comment thread, product page, or external resource as a separate evidence item with its own source URL, timestamp, route, and limitation. Do not merge unverified snippets into a single "market says" claim.

## Boundary With WeChat Skills

`.luz-crawl` is the upstream crawler for `wechat-skills`. Keep the two skills independent:

- `.luz-crawl` crawls X/Twitter, Reddit, media, official sources, papers, GitHub, Bilibili, Xiaohongshu, WeChat mirrors, forums, comments, and visual references.
- `.luz-crawl` archives raw evidence and produces evidence packets, source maps, comment/语气 samples, freshness notes, risk notes, source-graph seeds, and visual-reference boards.
- `.luz-crawl` does **not** write final公众号文章, call Hermes, generate images, create `article.html`, decide final typography, or package publish-ready WeChat output.
- `wechat-skills` consumes `.luz-crawl` evidence packets, then performs narrative analysis, title polishing, human-feeling writing, Hermes prompt/design work, final image generation, quality checks, and HTML output under its own directory.

When crawling for WeChat public-account content, read `references\wechat-content-feed.md`. The goal is to find fresh, fun, evidence-backed topics about technology, AI, aviation, life, biology, science, internet culture, creator ideas, and viral public-interest stories. Do not invent facts, comments, examples, metrics, or source claims. If a source has images/video, record their style and source URL as visual references. For concrete products, hardware, robots, phones, vehicles, aircraft, lab devices, software interfaces, or any subject with a specific factual appearance, also record official/media images that can be used as truthful product references or Hermes reference inputs. Do not tell downstream to replace a real product with an AI-generated lookalike.

For WeChat content, freshness is a default gate. Prefer topics with an original source, paper, product/company announcement, media report, or social resurgence in the last 60 days. Older material can be used as background, but it cannot be packaged as "latest", "recently popular", or "everyone is talking about it" unless the crawl captures recent reposts, translations, quote tweets, forum threads, public-account discussions, media coverage, or comments proving renewed attention. Record exact dates and crawl dates in the evidence packet.

WeChat discovery must not stay inside AI/product naming and must not default to product launches. Search widely for recent viral thought essays, influential long posts, newly discussed papers, psychology/cognition/life findings, science and biology stories, aviation/space items, internet culture, creator methods, and public-interest tech news. Product/company announcements are only leads; mark them article-ready only when the crawl finds a broader ordinary-life question, social emotion, story scene, thought conflict, or surprising user behavior. The topic should come from real cross-platform discovery, not from Codex brainstorming first and evidence-hunting later.

For WeChat discovery, do not begin from a "what products launched today" mindset. Begin from "what fresh idea, finding, behavior, story, or public question is making people stop scrolling." Product launches, demos, model updates, feature releases, and company announcements should be downgraded unless the evidence packet can survive a product-launch stripping test: after removing company name, product name, feature name, parameters, price, and funding, there is still a general-reader question, scene, behavior change, thought, or discovery worth narrating.

For WeChat discovery, apply a mass-accessibility gate before handing a topic downstream. A topic can be scientifically important and still weak for a general WeChat article. Professional science, synthetic biology, astronomy, materials, engineering, and niche research must have a normal-reader hook: body, food, sleep, work, money, family, phone, travel, fear, curiosity, a visible demo, or real comments asking plain-language questions. Do not mark raw paper-language topics such as "synthetic cells from nonliving chemical components that feed, grow, copy, and divide" as article-ready unless the crawl finds a public hook like "does this count as alive?" and records evidence for that hook.

For WeChat evidence packets, collect not only "what happened" but also "what can be narrated". Each packet should extract:

- `story scene`: the concrete person/action/object/experiment moment a reader can picture;
- `sharp line`: the original sentence, post, comment, or source detail that carries the hook;
- `reader friction`: what ordinary readers are likely to misunderstand, laugh at, doubt, or want to forward;
- `tone samples`: short social-platform phrasing with rhythm and judgment, separated from verified facts;
- `visual scene`: source images/video/demo/thumbnail style and a section-matched image idea.
- `truthful product visuals`: for concrete products/devices/interfaces, official product images, media photos, screenshots, video frames, source URLs, usage limits, and whether they are suitable as final images or Hermes reference inputs.

If the crawled material only supports abstract concepts, definitions, or trend commentary, mark it weak for WeChat publication until a concrete scene, action, or source quote is found.

When called for a downstream `wechat-skills` complete article, crawl one WeChat article topic at a time. Produce one single-topic evidence packet; do not simultaneously build evidence for multiple publishable articles, generate batch article seeds for production, or move to the next topic before downstream `wechat-skills` has a publish-ready `article.html`. If the user asks for many directions, save them as a research-only candidate queue and mark that only one can enter the article pipeline next. Before selecting that one topic, check recent downstream article themes; if the last article was robot/AI/product/company-launch, prefer a non-product fresh idea, study, discovery, life-science/cognition/aviation/internet-culture story, or viral thought piece.

When handing a topic to `wechat-skills`, include a `theme rotation` note: the candidate's category, the last 3 downstream article categories when visible, and why this one feels new. If the only difference is "different company/different product/different model", mark it weak and continue searching.

For WeChat content-feed runs, do not turn the crawl into tool tutorials, open-source project audits, or GitHub risk research. Avoid spending crawl budget on setup steps, CLI/API usage, dependency pitfalls, issue triage, vulnerabilities, or repo hardening unless the user explicitly asks for a tool tutorial or security research task. Tool-related topics are valid only when they are public-interest stories with social discussion, fresh news, strange user behavior, or a vivid work/life change that general readers can enjoy.

When platform access is blocked by login walls, safety checks, anti-bot pages, missing cookies, empty OpenCLI results, or rate limits, do not silently drop the lane and do not fill the gap with invented comments. Try reasonable fallbacks: alternate platform-native queries, exact title/URL search, author/user-post routes, Jina/Exa/Firecrawl, browser-backed reading, mirrored pages, media articles, newsletters, or adjacent forum discussions. Deposit the limitation and successful workaround into `<experience-root>` through `finalize_run.py`.

For Xiaohongshu runs where the user explicitly says no login is needed or asks to crawl directly, do not ask the user to scan a QR code, log in, provide cookies, or switch accounts. First test public/no-login routes and preserve the result: `https://www.xiaohongshu.com/search_result?keyword=<urlencoded>` for route validation, known `https://www.xiaohongshu.com/explore/<note_id>?xsec_token=...` note URLs, public `user/profile/<id>` URLs, and especially `https://www.xiaohongshu.com/goods-detail/<id>` product URLs through Jina Reader. If direct search opens a `安全验证` page, QR prompt, `IP存在风险`, or error code `300012`, record it as a crawler limitation and pivot to goods-detail pages, external indexes, Exa, previously discovered structured product tables, image CDN URLs, and cross-platform demand evidence. Never infer "no market" from a blocked search route.

Direct crawl nuance: `https://www.xiaohongshu.com/` and `https://www.xiaohongshu.com/search_result?keyword=<urlencoded>` may return a large PC front-end HTML shell without usable note data; Jina Reader may reduce `search_result` to only the page title and regulatory footer. Save those files as route evidence, but label them `route shell only` unless they contain concrete note/profile/goods fields. Do not treat a readable front-end shell as evidence of titles, comments, demand, or account positioning. For actual evidence, prefer known `goods-detail/<id>` pages, complete signed `explore` note URLs, public profile URLs, image CDN URLs found in readable pages, external indexes, structured product tables, and independent cross-platform sources.

When `agent-reach doctor` reports Xiaohongshu OpenCLI is available, still honor the user's no-login instruction first. OpenCLI may depend on browser session state; in a no-login run it is not a required path and must not be used as a reason to request QR login, cookies, or account switching. Record the available backend, then prefer public HTTP/Jina/goods-detail/CDN/external-index routes. If a public route only yields a shell, mark `route shell only` and keep collecting independent evidence rather than escalating to login.

## Hard Rules

- Treat the folder containing this `SKILL.md` as `<skill-root>`. Resolve bundled scripts and references relative to it, but treat bundled `experience\` as read-only seed data.
- Treat `<experience-root>` as persistent runtime state. It defaults to `%CODEX_HOME%\state\luz-crawl` (or `~\.codex\state\luz-crawl`) and can be overridden with `LUZ_CRAWL_STATE_ROOT`. Never write learned experience into the plugin source or versioned install cache.
- Before every meaningful search, read `references\runtime-learning-loop.md`, run `scripts\experience_store.py init`, and query prior experience with `scripts\experience_store.py query "<intent domain platforms>" --limit 8`. Use the returned matches as search-plan input, not as current evidence.
- Before every meaningful search, run the universal intake from `references\universal-research-intake.md`: restate the user's real goal, classify the domain, identify audience/users, business/task context, risks, missing assumptions, and output artifact, then build a search matrix. This applies to every field, not only software.
- Before issuing any actual search, discovery, page-read, or crawl request, show the user a concise plan in chat. First run only local/read-only capability checks and retrieve local experience; then list the concrete tools/routes that passed those checks, target website domains, first-round query variants, execution steps, and fallbacks. `scripts\tool_preflight.py --format text` can render the checked route/site plan; combine it with the query variants derived from the user's wording and local keyword hints. Do not hide the plan in tool output or a dossier. Once the plan is shown, proceed without asking for another confirmation unless the task itself needs a missing constraint or a separately authorized action.
- Do not start detailed searching from the user's first vague words. Search only after the intent, domain vocabulary, likely source types, and evidence lanes are clear enough to avoid random queries.
- Route each request by the needed information and decision, not by a fixed source list. Starting points: code/repositories -> GitHub and project docs; enterprise facts -> Qichacha/Tianyancha when available and authorized, checked against official registries as needed; general/latest web -> Google/Bing for discovery, then primary sources; specified platform content -> that platform's native search; creator/live/product analytics -> the platform's official tools/APIs plus matching specialist providers. These are flexible starting points, not an allowlist or one-route rule: search user-named platforms directly and add multiple relevant sources when each improves coverage. Before searching, name every planned site/tool and its purpose. Do not sweep the whole source catalog by default.
- Ask fewer questions; make explicit reasonable assumptions when safe. Ask only when a missing constraint changes the search direction, risk profile, or deliverable.
- For any internet/platform search request, inventory current authorized skills/MCP tools and local CLIs with `scripts\tool_preflight.py`. Pass only tool names actually available for this task; when the installed Luz Crawl extension bridge is selected, add `--available-tool luz-crawl-extension` so the plan lists its local backend route and live connection state. Run `--probe-agent-reach` when Agent Reach is installed. Use the resulting route plan, prefer Agent Reach for platform routing unless the user selected the extension, and save the JSON under the dossier's `raw\` folder for non-trivial saved runs.
- At the start of each search, query both durable search experience and the local evidence index: `scripts\experience_store.py query "<intent domain platforms>" --limit 8` and `scripts\content_index.py search "<intent and key terms>" --limit 8`. Reuse relevant successful query shapes and active preferences; avoid relevant weak queries. Historical index hits are leads only and must be refreshed before supporting current claims.
- Search keywords must adapt during the run without the user having to prompt each expansion: preserve the user's exact wording as a seed, add platform-native variants, inspect each useful result batch for named projects, maintainers, jargon, workflows, and failure terms, then run at least one follow-up search from those new terms for meaningful research. Record worked, weak, and next queries in `finalize_run.py`.
- Persist user search/output preferences in `<experience-root>\user-preferences.json`, rebuilt from the append-only event ledger. Capture direct user instructions/corrections as `--preference` JSON with `source=explicit`; use `source=inferred` only for a repeated, clearly demonstrated pattern. The profile activates an explicit instruction immediately and an inferred preference only after it appears in at least two independent research runs. Current instructions always take precedence. Record observed result feedback with `--feedback` only when it is actually available; explicit preferred/saved/rejected/corrected source signals adjust local-index ranking. Do not invent clicks, ratings, or user intent. Do not store sensitive personal traits.
- Saved dossiers with a supported `manifest.json` are automatically added to `<experience-root>\content-index.sqlite` by `finalize_run.py`. The index stores metadata and at most 500 characters of excerpt per source, never full bodies; X records are URL/platform only until current developer terms are checked. Use the index to find old sources and vocabulary, not as fresh evidence.
- For direct Xiaohongshu, Zhihu, WeChat, X, or 1688 search through OpenCLI, read `references\opencli-edge-workflow.md` and use `scripts\platform_search.py` after preflight. It refuses to search until the existing Browser Bridge is connected, runs platform commands sequentially, uses ephemeral sessions with `--keep-tab false` so each temporary page lease is released, and never starts or terminates Edge. `opencli weixin search` uses Sogou's article index and must be labeled accordingly. 1688 results are product/supplier discovery candidates; do not infer legal entity identity or contacts from a listing card.
- If the user explicitly selects Codex's in-app browser, read `references\codex-in-app-browser-workflow.md` and use that browser for page interaction. That explicit choice takes precedence over Edge/OpenCLI; do not switch surfaces unless the user authorizes it. Luz Crawl's existing package is a Codex plugin; to load it from Codex's Browser > Extensions page, use the separate `browser-extension\luz-crawl` package. Do not treat the Codex plugin manifest as a browser-extension manifest.
- If the user asks Luz Crawl's browser extension to search/crawl, route the task through `scripts\extension_bridge.py search --source <source-id> --query "<exact query>"`. That command auto-starts the loopback bridge, queues the job, and waits for the extension's run status plus its visible-result capture. The extension connects on startup and reconnects automatically; do not require a popup click or per-search text entry. Reuse one extension-managed search tab across sources, close older extension-created search tabs when safe, and leave unrelated user tabs untouched. Do not replace a tab waiting for login or security verification; let that handoff finish first. Serialize concurrent starts and mark a replaced in-progress search as `superseded`. The extension must own navigation and capture; do not substitute Agent Browser/Playwright/Computer Use extraction. First-use site permissions, an unloaded extension, login, and verification remain explicit handoff conditions; never bypass them. A live acceptance check requires a completed bridge job with returned capture evidence, not merely a visible search page. If the extension is offline, use `extension_bridge.py health`, report its connection status, and preserve the queued job or return the exact setup action needed.
- For enterprise prospecting, first run `scripts\lead_queries.py "家居企业" --location "深圳" --term "沙发"` and show its source-specific query plan to the user before any search. When the requested surface is the Luz Crawl extension, call `scripts\extension_bridge.py search --source 1688 --query "深圳家具工厂"`; `1688` means factory/company discovery, while `1688_products` means product listings. Otherwise use `scripts\platform_search.py "家居企业" --lead-search --location "深圳" --term "沙发" --platform 1688` for its OpenCLI route. Save the emitted plan and actual queries with the run. Select `--platform qichacha` only for an authorized Open Platform account; ApiCode 886 can return up to five records and may cost RMB 0.10 per request. The adapter does not call it without `QCC_APP_KEY`, `QCC_SECRET_KEY`, and the explicit `--confirm-qcc-cost` flag; it makes one request with no retries or synonym expansion.
- `platform_search.py` automatically records a compact local keyword outcome after verified results: returned topic records become worked-query examples; zero-result topic queries become weak only when the same adapter's health control returned content. Bridge/session errors are not learned as weak terms. The event stores query text, platform, counts and tool name, not crawled result bodies. Explicit user result feedback continues to drive personalized ranking; search volume alone does not infer a preference.
- Lead records retain source URL, query and observation time per field, and only normalize allowlisted company/product fields. Do not bulk collect private personal phone numbers or infer a business purpose from a number's presence. Prefer official company switchboards, business mailboxes, inquiry forms and platform messaging; keep any contact together with its source and explicit business context.
- When the user explicitly chooses Codex's in-app browser, follow `references\codex-in-app-browser-workflow.md`; never replace that browser with Edge, Chrome, or OpenCLI. For other explicit browser choices, use that browser's available interaction skill for visible-page reading and login UI. If a route returns `AUTH_REQUIRED`, a login wall, QR login, CAPTCHA, slider, or other human-verification checkpoint, stop that source route and mark it `waiting_user` (or the equivalent user-action-pending state), never `failed`, `no_results`, `query_weak`, or `source_absent`. Tell the user which page needs attention, leave the selected page/session in place, and wait for the user to complete login or verification manually and signal readiness; then recheck the same route and run one small probe before resuming. Do not silently switch to another route for that blocked source while it is waiting. Continue independent accessible sources only when the user has not constrained the browser surface. Never request passwords, one-time codes, or cookies; inspect stored session data; solve a CAPTCHA; or bypass a login/verification barrier. If the user explicitly says no login, do not ask them to sign in.
- After an official company website is independently verified, show the user its exact host and planned homepage/contact paths before reading it. Use `scripts\company_site_reader.py "https://<approved-host>/" --approved-host "<approved-host>"`. The reader pins a public DNS address, checks robots.txt for each target path, requests HTTPS only, never follows redirects, caps the run at three HTML pages, stops on verification/block pages, and returns only role-mailbox emails plus contact-page/form links. It does not extract phone numbers, submit forms, or use cookies. A search-result URL alone is not proof that a domain belongs to the named company. Use `lead_records.attach_company_site_evidence(candidate, result)` to attach same-host role-email evidence to a candidate without dropping provenance.
- An empty result list is only an empty response for that query. If every topic variant returns empty, try one broad control query; when that is empty too, check session/access or adapter health and mark content absence unconfirmed.
- On Windows, use a dedicated crawl browser profile. Never kill browser processes by image name or navigate existing user tabs. Reuse an already-connected browser bridge when available; if a separate browser is required, launch and reap only the process tree started by this tool. Login remains a deliberate, user-run step through scripts\edge_login.py.
- When `.luz-crawl` evidence or techniques are copied into a production application's runtime connector, read `references\production-runtime-crawler-contract.md`. Reuse the evidence pipeline, not unrestricted URL access, login/CAPTCHA bypass, source credentials, agent-only tools, or unlicensed provider claims.
- Match tools to the requested data type and the source. Use platform-native routes for named-platform searches; use Google/Bing to discover sources and verify current entry points; use GitHub for code, Qichacha/official registries for enterprise fields, and relevant platform analytics/providers for creator/live/product signals. Treat examples as starting points and add other suitable sources when they answer a distinct evidence need.
- Respect explicit no-login crawling constraints. If the user says not to log in, do not request login or cookies. For platforms with public fragments plus protected search, separate `route blocked` from `source absent`, save the blocked route evidence, and keep going through public URLs, readers, indexes, mirrors, CDN media, and adjacent platform evidence.
- Cover more than one evidence lane for non-trivial research: source-of-truth, examples/cases, discussion/reviews, negative/risk, and implementation/how-to.
- Do not run multiple OpenCLI/browser-backed commands in parallel. Browser/session-based platform reads must be sequential.
- Output-root priority is fixed for standalone `.luz-crawl` runs: unless the user explicitly names another destination, every formal user-facing result created while using `.luz-crawl` must be saved under `%USERPROFILE%\Documents\luz-crawl`. Exception: when `.luz-crawl` is invoked by a downstream owner skill such as `xhs-skills`, save crawl evidence into that skill's owned output folder, e.g. `<xhs-output-root>\NNN_主题\raw\crawl\`, and do not create a second user-facing dossier unless requested.
- Save ordinary dossiers directly under `%USERPROFILE%\Documents\luz-crawl` as a single numbered folder. Do not create module/domain subfolders.
- For any non-trivial search/research task, create a saved dossier unless the user explicitly asks for chat-only output.
- Create result folders with `scripts\prepare_output.py`; do not hand-create numbered folders unless the script is blocked. Folder and Markdown names must use three-digit prefixes such as `001_期货小白入门学习指南`, not `01` and not vague names like `001_主题`.
- Make the title clear and specific. Include the domain in the title when helpful, for example `003_系统设计账号登录注册工程方案` or `004_材料碳纤维预浸料工艺资料`.
- Treat each run as knowledge-base improvement: save the dossier when required, deposit an idempotent event into `<experience-root>`, and update durable engineering lessons when the task reveals reusable patterns, fields, risks, checklists, or anti-bypass rules.
- Treat search technique itself as a reusable skill: record useful keywords, second-layer keywords discovered inside sources, platforms, Agent Reach/Firecrawl routes, source graph seeds, image handling, tool failures, fallbacks, and channel-specific lessons in the search skill library.
- For virtual-resource or digital-product opportunity research, do not restrict demand discovery to Xiaohongshu. Search comments, communities, marketplaces, resource-sharing posts, independent product pages, and multilingual sources. A valid product idea needs real-source evidence; never invent pains, sections, quantities, prices, or user quotes.
- For downstream digital-resource packs, crawl real usage scenarios deeply enough to support the actual PDF fields: checklist items, table columns, workflow steps, timelines, quantities, frequencies, role assignments, and examples. If evidence is missing, say so and request/perform more search; do not let downstream skills fill gaps with model common sense.
- When handing evidence to `xhs-skills`, include a field-level evidence map whenever the downstream artifact contains concrete operational content. Mark each field/item as `strong evidence`, `multi-source structure`, `single-source example`, `template blank only`, or `not supported`.
- When handing visual evidence to `xhs-skills`, include a cover-reference map, not just image files. For each Xiaohongshu note/goods image or template/method fallback, record source URL, platform, crawl route, cover type, title position, title size/line count, resource-subject/card area, tag count, whitespace/density note, reusable structure, and limitation. This helps downstream avoid ugly covers that are too empty, too crowded, or not tied to real references.
- `.luz-crawl` must not generate, render, repair, crop, resize, redraw, screenshot, template-compose, or locally compose Xiaohongshu covers or post images. Its role is evidence only: crawl/download/reference-map. Python scripts inside `.luz-crawl` may download original source media and verify bytes, but may not create, alter, crop, upscale, screenshot, or re-layout images for downstream publishing. When downstream `xhs-skills` needs final images, the only allowed path is Hermes `gpt-image-2`; if Hermes is blocked or cannot produce a compliant image, downstream must mark the image task failed rather than asking `.luz-crawl`, Python/PIL/OpenCV/Canvas/SVG/PDF or HTML screenshot/Figma scripts, templates, old local images, or any local tool to make a substitute.
- For virtual-resource opportunity research, follow the user's required cadence: one item at a time, not batch production. Broad scans can produce `candidate_queue.md`; complete evidence packets and downstream deliverables must advance one selected niche at a time. Do not create multiple finished topic dossiers/PDFs/posts in one sweep unless the user explicitly asks for batch output.
- Treat shared resources and marketplace listings as inspiration/evidence, not material to copy. Preserve source URLs and then require downstream originality: rewrite structure, localize scenarios, rebuild tables/checklists, and avoid reselling copyrighted templates, paid files, books, courses, tests, or proprietary worksheets.
- For medical, legal, financial, parenting, education, immigration, or other high-risk resource packs, collect official or credentialed sources in addition to user comments. Mark advice limits clearly and do not let downstream skills present personal trackers/checklists as professional diagnosis or legal advice.
- When the user asks to improve this skill's own search ability, store accumulated search skills and knowledge seeds under `<experience-root>` first. Include practitioner accounts, public whistleblowers, organizations, communities, forums, newsletters, repos, high-signal articles, and unfamiliar industry lanes. Do not create user-facing output dossiers unless the user asks for a deliverable or a real topic dossier.
- When the user asks for公众号/WeChat topic feed, fun knowledge, viral thought/article discovery, fresh story-based science/tech/aviation/life material, or upstream content for `wechat-skills`, use `references\wechat-content-feed.md` and produce a `.luz-crawl` evidence packet only. Leave final article writing, Hermes images, and HTML to `wechat-skills`.
- When the user gives one topic and asks to crawl related articles ("爬取文章：<主题>"), read `references\topic-crawl.md` and run `scripts\topic_crawl.py`. That mode is restricted to 小红书 / 知乎 / 微信公众号 unless the user widens it; drop every other host rather than crawling it. Keywords must stay variable: pass synonyms with `--synonym` per run instead of freezing one keyword into code or config, and use `--term` for the discriminative vocabulary. Maximize both article count and distinct authors (`--per-author` exists to stop one prolific writer crowding out the rest). Report route limitations honestly — e.g. 小红书 discovery needs a logged-in session, so zero notes means the route was blocked, not that no content exists.
- For downstream complete WeChat articles, keep the evidence packet single-topic and single-article. Do not run batch production research for multiple公众号成品 in the same pass; additional ideas belong in a queued candidate note until the current article is publish-ready downstream.
- Broad opportunity or information-gap research must not stay in a comfort zone. Mine each useful post/comment/article for new jargon, people, organizations, communities, screenshots, tool names, and adjacent industries; run or record follow-up searches from those extracted terms instead of repeatedly using the same generic terms.
- Engineering/system answers must be production-grade: include security, abuse prevention, validation, data model, frontend/backend boundaries, operational risks, commercial constraints, and what must not go wrong. Do not stop at toy/demo advice.
- Keep feature hierarchy clear. Do not promote small cross-cutting functions such as login, permissions, sessions, quotas, or audit into isolated top-level product chapters unless they are the actual product. Describe them at the right layer: product roles/boundaries, frontend interactions, backend services, data objects, testing, and operations.
- When the user's topic is "I want to build a program/site/app/plugin/platform/AI agent/search agent/automation tool", treat it as a project-discovery research task. Read `references\project-search-agent-architecture.md` when relevant, especially for front-end chat windows that call search plugins/tools and return summarized evidence.
- Every meaningful research run, including chat-only research, must end with `scripts\finalize_run.py`: record what was learned, which search routes worked/failed, what durable knowledge should be reused next time, and where it was saved. Reusing the same `--run-id` must be a no-op rather than a duplicate. Do not put `沉淀总结`, "下一轮可以继续深入的主题", or similar internal iteration notes in the user-facing result document unless the user explicitly asks.
- Every dossier folder must contain exactly one primary Markdown file named like the folder and one `raw\` subfolder. Put crawled/search/detail/comment outputs in `raw\`; keep `raw\manifest.json` as provenance, not a second report.
- Do not create extra top-level subfolders inside a dossier. If images/screenshots/media are captured, put them under `raw\images\` or another clear `raw\...` path and embed them with relative paths.
- Preserve source URLs, crawl time, platform/tool route, account/author/time/metrics when visible, and crawler limitations in raw files, manifest, and skill memory. Do not show internal tool routes, crawl status, or tool failure notes in ordinary user-facing result documents unless the user asks.
- Distinguish `official/source-of-truth`, `source says`, `multiple sources agree`, `user discussion`, `comment demand`, `implementation evidence`, `negative signal`, `unverified claim`, and `crawler limitation`.
- In user-facing reports, put conclusion, concrete recommendation, and implementation/development order before evidence maps. Evidence maps, raw-source explanations, and provenance tables belong near the end unless the user explicitly asks for a source-first report.
- Treat user-provided links as seeds, not boundaries, unless the user explicitly asks only to archive or summarize those links.
- If `%USERPROFILE%\Documents\luz-crawl\链接.txt` exists or is mentioned, process the `## 未读` section first, preserve original lines, and mark each as `已读`, `已输出`, `弱线索`, or `排除` with the output path/reason.
- After meaningful searches, use `finalize_run.py` to update `<experience-root>\search-keywords.md` with worked queries, weak queries, useful platform wording, command variants, false positives, keyword chains, source graph seeds, unfamiliar industry lanes, and next search seeds.
- When another model may need to continue, read/update `references\handoff.md` or leave a short continuation note in the dossier.

## Core Workflow

0. Initialize and retrieve persistent experience:
   - run `scripts\experience_store.py init`;
   - query prior lessons with the current intent, domain, likely platforms, and source types;
   - reuse only applicable routes/keywords and preserve current evidence authority.
1. Run universal intake before search:
   - understand the user's real goal, not just the literal keywords;
   - classify the domain and likely subdomains;
   - identify the target audience/user, decision, business/task flow, constraints, risk level, and final output shape;
   - list assumptions and unknowns;
   - build a search matrix with official/source-of-truth, examples/cases, discussion/reviews, negative/risk, implementation/how-to, and domain-specific lanes.
2. Clarify the target from the user's wording: quick answer, source map, comparison, account/repo/case study, public-opinion scan, tutorial, tool list, inspiration collection, queue processing, project discovery, or long-form dossier.
3. Choose a clear root-level dossier title before creating files. If one task spans different purposes, split into separate root-level dossiers rather than mixing.
4. Read the relevant references:
   - `references\runtime-learning-loop.md` before every meaningful search.
   - `references\modules.md` before creating a dossier title or choosing a document type.
   - `references\source-routing.md` before choosing platforms or tools.
   - `references\search-toolkit.md` before broad, unfamiliar, or multi-channel search.
   - `references\search-skill-library.md` before choosing search keywords/channels/tools and before recording tool/channel experience.
   - `references\domain-playbooks.md` when the topic belongs to software, design, engineering, materials, manufacturing, industrial, scientific, business, policy, or another domain with specialized evidence.
   - references/product-selection-research.md for product discovery, e-commerce trend validation, cross-market supplier matching, scoring, and unit-profit estimates.
   - `references\universal-research-intake.md` before all non-trivial searches and whenever the user's request is vague.
   - `references\knowledge-base.md` before saving or updating durable knowledge/experience.
   - `references\engineering-grade.md` before software/system/security/commercialization topics.
   - `references\project-search-agent-architecture.md` before turning a vague app/program/AI-agent/search-agent idea into an engineering research plan or project architecture.
   - `references\output-architecture.md` before creating/moving/auditing output folders.
   - `references\keyword-learning.md` before broad research, repeated searches, or skill improvement.
   - `references\digital-product-demand-research.md` before researching virtual resources, printable PDFs, planners, trackers, templates, digital downloads, Xiaohongshu resource-pack ideas, or multilingual product inspiration.
   - `references\wechat-content-feed.md` before crawling material for `wechat-skills`, 公众号趣味知识, viral thought posts, fresh tech/science/aviation/life stories, or source-backed story ideas.
   - `references\handoff.md` before resuming interrupted work.
5. Inventory and plan tools:
   - inspect the current runtime's authorized skills, MCP tools, browser tools, and available CLIs;
   - run `scripts\tool_preflight.py` with the real intent/platforms and visible tool names;
   - probe Agent Reach when available, verify OpenCLI Bridge and site search support, select the most source-specific routes, and define fallbacks;
   - display the checked tools, target sites/domains, planned query variants, ordered execution steps, and fallbacks in chat before starting search;
   - when the user selects the Luz Crawl browser extension, show the query/tool/site plan, then invoke `scripts\extension_bridge.py`; use the connected Browser/Chrome plugin only for visible-page inspection or user-operated login, not as the search executor; use OpenCLI only when the selected surface allows it and the extension route is unavailable;
   - use `scripts\platform_search.py` when direct search on Xiaohongshu, Zhihu, WeChat, X, or 1688 is required; use `--lead-search` for source-specific prospecting queries informed by the experience store;
   - save `raw\tool-preflight.json` for a non-trivial saved run.
6. Build a search matrix:
   - official/source-of-truth query;
   - real examples/cases query;
   - discussion/review/comment query;
   - negative/risk/limitation query;
   - implementation/how-to query when the user needs steps;
   - platform-native query variants for each target platform.
   - expected evidence coverage or count and follow-up triggers. If the user gives no numeric target, define sufficiency as enough distinct, relevant, source-verified evidence to answer the user's decision; job completion or raw link count alone is not sufficient.
7. Run the first-round searches with the most specific available tool, save raw evidence, and assess each batch for unique relevant items, coverage, currentness, and how much source content was actually verified. If results are insufficient, automatically derive 1-3 focused follow-up queries from relevant result titles, snippets, or bodies already read, using newly surfaced entities, synonyms, adjacent terms, or platform-native phrasing. Before each follow-up search, show the user the exact tool, target site/domain, query, why it follows from the prior results, and execution/fallback steps, then execute serially. Do not use navigation labels, unrelated recommendations, or unverified snippets as factual evidence. Preserve the query chain, per-round counts, and stop reason in raw evidence and finalization. Stop when evidence is sufficient, new relevant terms are exhausted, the route is blocked/rate-limited, or after three follow-up rounds; explain any remaining gap.
8. Extract durable fields: source, author, date, link, platform, metrics if visible, exact claims, steps, tools, constraints, counterexamples, open questions, and confidence.
9. Write the Markdown as a decision artifact, not a transcript dump. Put the highest-value summary and concrete action plan at the top. For engineering/product topics, sort by development sequence: product scope and roles -> product feature modules -> frontend interaction -> backend/API, including auth/session/RBAC where appropriate -> data model -> AI/tool workflow -> testing -> deployment/operations -> risks -> evidence/source map.
10. Validate with `scripts\validate_output.py "<folder>" --check-manifest`; add `--require-images` when images are included under `raw\images\`.
11. Run `finalize_run.py` for the saved dossier or with `--run-label` for chat-only research. Deposit tool routes, worked/weak queries, failures, fallbacks, reusable lessons, source seeds, and next queries into the persistent event ledger and rebuilt projections.

## Default Channel Coverage

Choose channels by the user's explicit platform scope and question type; do not blindly search every available channel. Named platforms take priority and should be searched directly. Add search engines and adjacent sources only when they serve a clear discovery, verification, or gap-filling purpose; GitHub is not a default substitute for platform search.

- Official facts: official docs/help centers, standards, API docs, policy pages, original announcements, release notes, public filings, app/package pages.
- Real examples: GitHub repos, demos, templates, case studies, product pages, platform accounts, public datasets, benchmark articles.
- Discussion and sentiment: Reddit, X/Twitter, V2EX, Hacker News, Zhihu, GitHub issues/discussions, app-store reviews, YouTube/Bilibili comments when accessible.
- Chinese platform texture: Xiaohongshu notes/comments, WeChat public accounts, Zhihu, Bilibili, Douyin/TikTok, V2EX.
- Technical implementation: GitHub, official docs, Stack Overflow/searchable Q&A, package registries, Docker Hub, npm/PyPI/Crates/Go packages, issues and changelogs.
- Creative/material collection: X, Xiaohongshu, Pinterest-like pages, Dribbble/Behance when accessible, design galleries, GitHub examples, image/video platforms.
- Academic/deep background: arXiv, Semantic Scholar, Google Scholar/web mirrors, papers with citations, institution pages.
- News/current events: official announcements, reputable media, RSS, social discussion, primary documents; include timestamps and note staleness.
- Software/product/design domains: official docs, design systems, real apps, GitHub repos/issues, package registries, architecture posts, benchmarks, failure reports, community debates.
- Engineering/materials/industrial domains: standards, datasheets, patents, papers, supplier pages, process notes, safety manuals, manufacturing case studies, industry forums, regulations.

## Output Naming

Read `references\modules.md` before creating a dossier title or choosing a document type. Output folders are flat:

```text
%USERPROFILE%\Documents\luz-crawl\
  001_期货小白入门学习指南\
    001_期货小白入门学习指南.md
    raw\
      manifest.json
  002_金融自动化预测分析平台开发基础\
    002_金融自动化预测分析平台开发基础.md
```

Use a clear `NNN_主题` name at the root. Inside each folder keep it simple: only the Markdown file plus `raw\`. Do not create folders such as `001_主题资料库\金融期货\...`, and do not add extra top-level folders like `images\`.

## Dossier Writing Standard

Use this shape unless a reference says otherwise:

```markdown
# NNN 平台/来源 主题

## 基本信息
- 平台/来源：
- 主题：
- 来源链接：

## 核心结论

## 具体步骤/结构

## 可复用要点

## 风险、反例与不确定项

## 原始内容整理

## 证据地图
| 类型 | 来源 | 链接 | 证明什么 | 局限 |
```

For a quick Q&A answer, the dossier can be shorter, but it still needs source links and limitations when saved.

For a tool/workflow dossier, include exact entry points, inputs, outputs, costs, setup, commands/buttons, failure modes, and verification steps.

For a development/project dossier, write in build order and be concrete. Include named features, screens, user actions, backend services, API responsibilities, data objects, permission checks, error states, tests, deployment/operations, and reference projects as Markdown hyperlinks rather than bare URLs. Keep evidence/source maps near the end, after the practical plan and implementation details.

For platform content research, include platform-native samples, author/account, link, time, engagement/comment signals if available, content structure, audience reaction, and what is reusable.

For user-provided links, include the original link, whether it was directly readable, expansion searches, and queue status.

## Learning Memory

This skill must get smarter after each meaningful run. Record short durable lessons in `<experience-root>\search-keywords.md` through `finalize_run.py`:

- worked queries;
- weak or misleading queries;
- platform-native wording;
- crawler limitations;
- useful command variants;
- source types that proved reliable;
- false positives and exclusion rules;
- next queries.

When a lesson is bigger than a keyword note, create a normal root-level dossier with a clear title such as `003_搜索经验小红书评论检索方法`.

Also record search-method lessons in `<experience-root>\search-skill-library.md`:

- tool route used, such as Agent Reach/OpenCLI, Firecrawl search/scrape/crawl/extract/interact, gh, Jina, browser, platform CLI;
- channel/platform where it worked or failed;
- images/screenshots/media handling and recognition notes;
- common errors, limits, login walls, anti-bot blocks, malformed URLs, timeouts, and fallbacks;
- query patterns that can be reused for similar future tasks.

## Internal Closing Deposition

Every saved run must finish with internal deposition, but this belongs in the skill memory rather than the user-facing Markdown. Do not append this template to ordinary result dossiers:

```markdown
## 沉淀总结

- 本次可复用知识：
- 本次有效检索：
- 本次无效/噪声检索：
- 工具/渠道经验：
- 图片/媒体经验：
- 新增风险/反例：
- 可沉淀到知识库：
- 下次优先检索：
```

Instead, update `<experience-root>\knowledge-index.md`, `<experience-root>\search-keywords.md`, and `<experience-root>\search-skill-library.md` through the event store. If the result contains broadly reusable engineering knowledge, create or update a normal root-level dossier with a clear knowledge title rather than leaving it buried inside one task report.

## References

Read `references\modules.md` before creating any new dossier title.
Read `references\runtime-learning-loop.md` before every meaningful search or research run.
Read `references\source-routing.md` before choosing platforms or tools for a broad topic.
Read `references\opencli-edge-workflow.md` before any OpenCLI search that uses the user's Edge session.
Read `references\codex-in-app-browser-workflow.md` when the user explicitly requests Codex's in-app browser for search, page inspection, or user-operated login.
Read `references\search-toolkit.md` before unfamiliar, cross-platform, or high-coverage searches.
Read `references\search-skill-library.md` before building platform/channel query strategies or recording Agent Reach/Firecrawl/tool experience.
Read `references\domain-playbooks.md` before domain-specific research such as frontend/backend/database/UI/design/system development/engineering/materials/industrial/manufacturing.
Read references/product-selection-research.md before cross-market product selection, trend/profit analysis, or matching trend candidates to suppliers.
Read `references\universal-research-intake.md` before all non-trivial searches and before any search where the user's real goal is not yet fully understood.
Read `references\knowledge-base.md` before updating accumulated domain knowledge and reusable experience.
Read `references\engineering-grade.md` before software/system/security/commercial production topics.
Read `references\production-runtime-crawler-contract.md` before implementing or auditing any production application's public/no-key crawler, search connector, catalog ingester, monitoring collector, or recommendation source.
Read `references\project-search-agent-architecture.md` before project-discovery searches, especially search AI agents, chat-based tools, plugin/tool-calling systems, SaaS/internal tools, or user-facing automation platforms.
Read `references\output-architecture.md` before creating, moving, or auditing output folders.
Read `references\keyword-learning.md` before broad research, repeated searches, or skill improvement.
Read `references\digital-product-demand-research.md` before virtual-resource/digital-download opportunity crawling or when `xhs-skills` asks for evidence.
Read `references\wechat-content-feed.md` before crawling upstream material for WeChat public-account articles.
Read `references\topic-crawl.md` when the user gives one topic and wants articles about it collected from 小红书/知乎/微信公众号, especially "爬取文章：<主题>" requests, multi-author coverage, or when a crawl must avoid hard-coded keywords.
Read `references\handoff.md` before resuming interrupted work or handing work to another model.
