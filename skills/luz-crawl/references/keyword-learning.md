# Keyword Learning

Use this reference for broad research, repeated searches, platform crawling, or any task that should make the skill smarter.

## Memory File

Write durable lessons to:

```text
<experience-root>\search-keywords.md
```

Create entries through `finalize_run.py`. The append-only event ledger is authoritative; this Markdown file is a rebuilt projection for retrieval and inspection.

Before searching, run `experience_store.py query "<intent domain platforms>"`. Its `keyword_hints` object automatically surfaces applicable worked queries, weak queries, and next-query seeds. Also search `content_index.py` for old source URLs and terms. Use those as seeds and always refresh sources before relying on them.

## What To Record

- Platform and backend used.
- Worked queries.
- Weak or misleading queries.
- Platform-native wording.
- Useful source types.
- Crawler limitations and command changes.
- False positives.
- Next queries.
- Secondary keywords discovered inside high-signal sources.
- Practitioner accounts, public whistleblowers, analysts, niche communities, forums, newsletters, podcasts, repos, and channels worth revisiting.
- Adjacent industries opened from the source material, especially when the first query keeps returning the same familiar topics.

## Entry Shape

```markdown
## YYYY-MM-DD Topic

- Platform:
- Backend/tool:
- Worked queries:
- Weak queries:
- Useful wording:
- Reliable source types:
- Crawler limitation:
- False positives:
- Next queries:
- Keyword chain:
- People/orgs/communities to revisit:
- New industry lanes opened:
```

## Progressive Keyword Chain

Do not search from a fixed vocabulary only. A good search should evolve while reading.

When a result is useful, inspect it for new search material:

- terms of art, acronyms, product names, internal workflow names, metrics, pricing words, compliance words, and failure-mode words;
- bios, handles, organizations, public whistleblowers, trade writers, niche consultants, founders, maintainers, and analysts;
- communities, subreddits, forums, comment sections, marketplaces, app stores, GitHub orgs, review sites, newsletters, podcasts, and conference talks;
- hidden buyer language such as `manual process`, `missed revenue`, `refund`, `churn`, `chargeback`, `denial`, `dispatch`, `intake`, `quote`, `inspection`, `spreadsheet`, `before you buy`, `real results`, `what nobody tells you`, `postmortem`, `not worth it`;
- adjacent domains where the same job-to-be-done may exist.

## Sufficiency-Guided Follow-Up Search

At the start, define the evidence coverage or count needed to answer the user's decision and include follow-up criteria in the search plan. When the user gives no numeric target, a round is sufficient only when it yields enough distinct, relevant, source-verified evidence for the requested answer; `completed`, a large link count, or page navigation links do not establish sufficiency.

After each batch, automatically assess relevant unique results, coverage across requested source types, freshness, and whether source details were opened and verified. If evidence is still thin, extract useful vocabulary from relevant titles, snippets, and any body text actually read. Generate focused alternatives such as a narrower entity/product term, synonym, adjacent phrase, proper name, or platform-native wording. Treat search snippets as leads, not verified claims; ignore navigation labels, recommendations, and unrelated trending content.

Before every follow-up search, show the user the exact tool, target website/domain, query, derivation from the preceding results, execution steps, and fallback. Then execute the planned query serially. Preserve each query, its source/derivation, result counts, and the reason for continuing or stopping in the run evidence and finalization. Continue without waiting for the user to remind you, but stop once coverage is sufficient, no new relevant terms emerge, access is blocked/rate-limited, or three follow-up rounds have run; report unresolved gaps rather than broadening indefinitely.

## Comfort-Zone Breaker

When the user asks for global opportunities, hidden information gaps, practitioner insight, or new markets, do not repeatedly search only familiar lanes such as generic `AI agent`, `AI客服`, `GEO`, `Shopify`, or `AI赚钱`.

If the last one or two research batches are concentrated in the same cluster, add at least two unfamiliar operator-heavy lanes. Examples:

- construction/trades: estimating, permits, warranty callbacks, dispatch, inspections;
- healthcare admin: intake, prior authorization, scheduling, billing, denial management;
- legal ops: intake, paralegal workflow, discovery, referrals, document review;
- logistics/freight: load boards, detention, customs, carrier onboarding, route exceptions;
- property/facilities: maintenance tickets, HOA, leasing, inspections, tenant screening;
- manufacturing/procurement: RFQ, supplier audit, BOM, QA defects, CAD/CAM, CNC quoting;
- agriculture/food supply: cold-chain, farm records, restaurant procurement, local sourcing;
- creator business ops: sponsorship sales, rights management, clipping, newsletter ads;
- education, elder care, pets, travel, restaurants, beauty/medspa, gaming/modding, cybersecurity, compliance, energy, and local government services.

Start those lanes with practitioner language, not opportunity language. Search how insiders describe the work, pain, mistakes, and money flow before searching "how to make money".

## Query Matrix

For a serious topic, use at least four lanes:

- Source-of-truth: official docs, original article, policy, standard, repo README.
- Real examples: accounts, posts, repos, case studies, demos, templates.
- Discussion/review: comments, Reddit, X, issues, V2EX, reviews.
- Negative/risk: scam, not worth it, outdated, broken, banned, 踩坑, 失效.
- Implementation: setup, workflow, step by step, command, template, 教程, 怎么做.

## Platform Wording

- Xiaohongshu: use daily-language phrases, `怎么做`, `求推荐`, `避雷`, `教程`, `工具`, `模板`, `笔记`, `评论区`.
- WeChat: search exact titles, account names, `公众号`, `原文`, `合集`, `系列`, `入口`, `教程`, `案例`.
- X/Twitter: use concise creator language, `case study`, `thread`, `workflow`, `template`, `open source`, `what I learned`.
- Reddit: search pain language, `recommendations`, `alternatives`, `worth it`, `how do I`, `what are you using`.
- GitHub: search `awesome`, `template`, `starter`, `dataset`, `examples`, `open source`, `issues`, `changelog`.
- YouTube/Bilibili: combine topic with `tutorial`, `review`, `setup`, `walkthrough`, `测评`, `教程`, `踩坑`.
- Zhihu/V2EX/Hacker News: search debate words, `为什么`, `如何评价`, `有没有`, `替代`, `坑`, `experience`, `launch`, `Show HN`.
- Web: combine topic with `official`, `docs`, `guide`, `examples`, `FAQ`, `pricing`, `limitations`, `site:`.
- Software/system development: combine topic with `architecture`, `benchmark`, `production`, `postmortem`, `issue`, `starter`, `reference implementation`, `迁移`, `踩坑`.
- UI/design: combine topic with `design system`, `component`, `pattern`, `accessibility`, `case study`, `Figma`, `screenshot`, `交互`, `设计规范`.
- Materials/industrial/manufacturing: combine topic with `datasheet`, `standard`, `ASTM`, `ISO`, `IEC`, `patent`, `process`, `yield`, `defect`, `supplier`, `SDS`, `工艺`, `标准`, `专利`, `良率`, `缺陷`.

## Scoring

Prefer information that has:

- primary-source links;
- multiple independent examples;
- comments/issues/reviews showing real usage;
- exact steps or reproducible commands;
- current timestamps;
- clear limitations.

Downgrade information that is:

- only a repost with no source;
- an income/course/ad claim without proof;
- an outdated tutorial;
- a single anecdote;
- a platform page blocked behind login with no readable evidence.
