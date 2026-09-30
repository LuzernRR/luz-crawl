# Digital Product Demand Research

Use this reference when researching printable PDFs, trackers, planners, templates, resource packs, electronic worksheets, Notion/Canva/GoodNotes products, Xiaohongshu virtual-resource ideas, or benchmark accounts selling/引流 similar resources.

## Role Boundary

`.luz-crawl` only crawls and verifies evidence. It may summarize demand signals and resource shapes, but it does not create the final Xiaohongshu post, cover, title, tags, PDF, Excel, or sales copy. Hand the evidence to `xhs-skills` for productization.

When this research is initiated by `xhs-skills`, save the crawl evidence under:

```text
<xhs-output-root>\NNN_主题\raw\crawl\
```

Do not create a separate final user-facing `.luz-crawl` dossier unless the user explicitly asks for one. Standalone digital-product research still follows normal `.luz-crawl` output rules.

## Core Principle

Every product idea must come from real searched sources. Do not invent:

- user pain or comments;
- product sections, page counts, prices, or formats;
- specific usage scenarios, timelines, checklist items, table fields, quantities, frequencies, roles, task steps, or examples;
- platform demand metrics;
- "people are asking for this" claims;
- examples of templates or resources.

If a source is inaccessible, label it as a limitation and do not infer the missing content.

For downstream PDF/Excel packs, evidence must go below topic level. It is not enough to prove "people need a wedding planner" or "there is a product". `.luz-crawl` should collect real usage evidence for the actual content that will appear in the pack:

- table columns and sections;
- checklist items;
- workflow steps and dependencies;
- timeline fields and example times;
- quantities/frequencies/cycle lengths;
- roles and handoff points;
- local constraints, disclaimers, and exceptions.

If the exact content is not supported, mark it as `template blank only` or `needs more search`. Do not allow downstream skills to invent operational details to make a resource look complete.

## Cadence: One Item At A Time

For market exploration, it is acceptable to scan many verticals first, but only as a candidate queue. Do not batch-produce multiple finished resources, posts, titles, covers, or PDFs from one scan.

Use this cadence:

1. Broad scan: collect many possible niches into `candidate_queue.md`.
2. Select one candidate: choose the highest-scoring candidate with enough evidence.
3. Single-topic crawl: gather pain, comments, resources, account benchmarks, visuals, risks, and official checks for that one candidate.
4. Hand off one evidence packet to `xhs-skills`.
5. Only after the downstream resource/post is complete should the next candidate enter the pipeline.

When crawling Xiaohongshu accounts or notes, analyze one account/note at a time. Save the raw page, comments, images, and extracted fields before moving to the next. This prevents mixed evidence and accidental invented synthesis.

## Evidence Lanes

Cover at least four lanes before a downstream product decision:

| Lane | Purpose | Examples |
| --- | --- | --- |
| User pain | Find what people repeatedly struggle with | Reddit, Douban groups, Xiaohongshu comments, X threads, forums, app reviews |
| Comment demand | Find direct requests for files/templates | "求表格", "求清单", "need spreadsheet", "template request", "where can I find" |
| Account benchmark | Understand real account positioning and conversion | Xiaohongshu accounts, pinned notes, series, comments, homepage, showcase |
| Visual style | Learn what formats actually get attention | cartoon comics, fun图文, memo style, table screenshots, real-photo flat lays |
| Existing resources | Learn product shape and buyer language | Etsy, Gumroad, Payhip, Ko-fi, Notion templates, Canva templates, blogs, GitHub |
| Negative/risk | Avoid fake or unsafe products | "scam", "not worth it", "too generic", "doesn't work", "版权", "侵权", "退款" |
| Official/credentialed | Anchor high-risk topics | official health/legal/finance/education pages, standards, licensed-org guides |

## Platform Query Patterns

### Xiaohongshu

Use Chinese buyer language and concrete item names.

Worked patterns:

- `<品类> 清单 可打印`
- `<品类> 表格 模板`
- `<人群/场景> 记录表`
- `求 <品类> 清单`
- `<品类> 避坑 清单`

Avoid starting with broad seller language such as `虚拟资料` or `电子资料`; it often returns course-selling accounts rather than buyer demand.

Known route lesson: `https://www.xiaohongshu.com/explore/<note_id>?xsec_token=...` is the concrete note URL shape and OpenCLI can read full note details when the URL includes `xsec_token`. The bare `https://www.xiaohongshu.com/explore` page is not a reliable anonymous crawl endpoint; `curl` may return 404, while browser/feed routes can still work. Prefer `opencli xiaohongshu feed -f yaml`, `opencli xiaohongshu search "具体词" -f yaml`, profile routes, or externally discovered full note URLs. If `search` returns `[]`, do not treat it as no market; record the tool limitation and pivot to feed, account pages, goods pages, external indexes, Jina-readable `goods-detail` pages, and cross-platform demand sources.

If a direct translation returns empty, pivot to local wording. Example: `ADHD计划表 模板` may fail; try `拖延症计划表`, `时间管理表`, `自律打卡表`, `专注力训练表`, `执行力清单`, `脑袋乱 计划表`.

For account benchmarking, collect:

- search results for concrete niche keywords;
- note details for high-signal notes;
- comments for demand and objections;
- downloaded images for cover/style/inner-page analysis;
- public user homepage notes when available;
- showcase/橱窗/product-card information when visible.

Record account positioning, note series, visual style, conversion path, and shop items. Save benchmark evidence under `raw\benchmark\` when called by `xhs-skills`.

For digital-resource cover research, `.luz-crawl` should only collect and describe visual evidence; final design decisions belong to `xhs-skills`. Save at least 3 same-niche or adjacent-niche cover/product/template references when available, and record:

- source URL/path, author/account/product, crawl route, visible interaction or product signal if available;
- cover type: big-character poster, checklist card, comparison, flat lay, cartoon/story, chat screenshot, memo, table preview, product-detail card;
- title placement and approximate title length;
- subject/card/table area and whether the resource deliverable is visually obvious;
- whitespace/density observation: too empty, balanced, or crowded;
- color and typography cues;
- what can be reused structurally and what must not be copied;
- crawler limitation when only snippets/templates are available.

Do not claim a cover is "爆款" unless the source exposes credible interaction/product evidence. Public template/method pages are useful for design-method evidence only; they do not prove same-niche demand or product performance.

Do not overvalue broad resource accounts. Prefer accounts serving a specific group with repeated painful scenarios. Downgrade generic PPT, wallpaper, avatar, resource-pack, and素材合集 accounts unless they have a concrete vertical use case and visible demand.

### Reddit

Use problem and request language:

- `need spreadsheet template`
- `printable tracker`
- `planner for <specific person/problem>`
- `<condition/problem> tracker`
- `<problem> workbook`
- `template request`
- `what are you using`
- `worth it`

High-signal communities for printable/digital products include `r/DigitalPlanner`, `r/Notiontemplates`, `r/PlannerAddicts`, `r/adhdwomen`, condition-specific subreddits, parenting/special-needs subreddits, and hobby subreddits. Treat promotional posts as product-shape evidence, not proof of demand unless comments or independent reviews support it.

### X / Twitter

Use concise creator and buyer phrases:

- `<niche> printable`
- `<niche> planner`
- `<niche> Gumroad`
- `<niche> Etsy`
- `<niche> Payhip`
- `free starter kit`
- `built for <specific audience>`

X is useful for finding live creator products, landing pages, media cards, and wording such as "scaffolding, not willpower" or "brain dump". It is weak as standalone demand proof when engagement is low.

### Marketplaces and Web

Use Exa/Jina/web search with product-format words:

- `Etsy <niche> printable tracker PDF`
- `Gumroad <niche> workbook`
- `Payhip <niche> planner`
- `<niche> digital planner GoodNotes Xodo`
- `<niche> symptom tracker printable`
- `<niche> template instant download`

Extract concrete fields: price if visible, file format, page count, sections, supported apps, download flow, usage instructions, update policy, refund/copyright terms, and buyer claims.

### Douban / Chinese Communities

When direct platform tooling is unavailable, use web discovery and platform-specific keywords:

- `site:douban.com/group <问题> 模板`
- `site:douban.com/group <人群> 记录表`
- `豆瓣 小组 <问题> 求资料`
- `<问题> 清单 豆瓣`

Preserve access limitations. Do not invent comment counts or group reactions if the page is not readable.

## Product-Idea Validation

A good virtual-resource idea should satisfy this triangle:

1. Broad category already has paid demand.
2. A specific person/community has a repeated, concrete problem.
3. Existing resources are generic, ugly, poorly localized, too clinical, too scattered, or not downloadable.

Specificity must be real, not artificial. "Budget tracker for left-handed Geminis" is specific but likely fake demand. "Budget tracker for couples doing IVF" may be valid if communities and searches show real repeated pain.

Reject or heavily downgrade:

- broad PPT templates with no industry/person/use case;
- wallpaper/avatar packs with no painful job-to-be-done;
- generic "资料合集" and "万能模板";
- copied/translated paid worksheets;
- content that is only pretty but not useful;
- viral notes where comments are entertainment-only and not resource demand.

Potentially valid narrow versions:

- `租房退租证据PPT/清单`;
- `幼儿园成长档案卡通封面+内页`;
- `婚礼备婚预算表+供应商对比表`;
- `宠物慢病用药记录表`;
- `新手运营小红书选题复盘表`.

These still need real account/comment/resource evidence.

## Evidence Packet Shape

When handing results to `xhs-skills`, organize them like this:

```markdown
## Evidence Packet: <topic>

### User Pain
| Source | Link | Original wording | What it proves | Confidence |

### Comment Demand
| Source | Link | Request/comment | Reusable demand phrase | Confidence |

### Existing Resources
| Product/source | Link | Format | Sections/features | Price/metrics if visible | What to learn |

### Field-Level Evidence Map
| Downstream field/item | Source | Original wording or visible evidence | Evidence strength | Allowed downstream use |

### Account Benchmark
| Account | Link | Positioning | Note style | Comment demand | Showcase/shop | What to learn |

### Visual References
| Source | Link/path | Style | Why it works | Reusable structure | Risk |

### Market Gap
- Broad paid category:
- Specific underserved audience:
- Specific recurring problem:
- Existing product weakness:
- Why this can be localized to Chinese:

### Localization Notes
- Terms to translate:
- China-specific context to adapt:
- What must be removed or rewritten:

### Risk Notes
- Copyright/IP:
- Medical/legal/financial/education risk:
- Claims that need official verification:
- Crawler limitations:

### Search Memory
- Worked queries:
- Weak queries:
- Next queries:
```

## Safety and Originality

- Do not download or reuse paid templates, books, courses, exam materials, copyrighted worksheets, or proprietary PDFs.
- Do not turn medical/legal/financial product examples into advice without official or credentialed references.
- Do not translate a foreign product directly and resell it. Use it only to understand demand, sections, file formats, and buyer language, then rebuild an original Chinese resource.
- For resource-sharing links, distinguish public/free/shareable resources from piracy. When unclear, treat as non-reusable evidence only.
