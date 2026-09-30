# Universal Research Intake

Use this before every non-trivial search. The goal is to prevent random searching from vague user wording. Every field needs the same first move: understand the user's real job, then search.

## Principle

Do not treat the user's first sentence as the final search query. Treat it as a rough signal.

Before searching, answer internally:

- What is the user trying to decide, build, buy, learn, verify, collect, compare, or prove?
- Who is the audience or affected user?
- What domain and subdomain does this belong to?
- What does "good answer" mean for this request: quick answer, source map, dossier, tutorial, list, risk review, business plan, engineering plan, buying advice, evidence archive, or creative inspiration?
- What would be dangerous, misleading, stale, non-compliant, or too shallow?
- Which assumptions can be made safely, and which need a short question?

If the user is vague, make a concise assumption instead of asking many questions:

```text
我先按“需要可落地、可验证、有来源的调研结果”来处理；如果你只想要快速答案，可以再裁剪。
```

Ask only when the missing detail changes the search lane, risk level, or output artifact.

## Intake Template

Use this as an internal scratchpad. Do not dump it all to the user unless useful.

```text
User goal:
Domain/subdomain:
Audience/user:
Business/task context:
Decision or output needed:
Risk level:
Known constraints:
Assumptions:
Must verify:
Search lanes:
Useful domain vocabulary:
What not to do:
```

## Universal Search Matrix

Build at least five lanes for serious research:

| Lane | Purpose | Typical sources |
| --- | --- | --- |
| Source of truth | Establish facts, definitions, official constraints | Official docs, standards, regulations, datasheets, original papers, product docs, filings |
| Real examples | See what exists or works | Repos, demos, case studies, product pages, screenshots, factory/process examples, tutorials |
| Community reality | Understand pain, demand, complaints, lived experience | Reddit, X, V2EX, Zhihu, HN, comments, reviews, forums, GitHub issues |
| Negative/risk | Find failure modes and what to avoid | `pitfall`, `limitations`, `complaint`, `outdated`, `scam`, `bypass`, `事故`, `踩坑`, `避雷` |
| Implementation/process | Turn facts into action | How-to docs, API guides, workflow examples, setup guides, methods, checklists |
| Freshness | Avoid stale conclusions | Release notes, changelogs, recent posts, current docs, effective dates |
| Domain-specific proof | Meet the field's proof standard | Benchmarks, lab papers, standards, patents, clinical guidelines, financial rules, safety docs |

Do not use every lane equally. Pick enough lanes to answer the user's real goal.

## Domain Reframing

Translate vague requests into domain-specific questions before searching:

- Software/product: What user workflow, system boundary, data model, security risk, test plan, deployment shape?
- UI/design: What user task, layout pattern, information hierarchy, states, accessibility, responsive constraints?
- Business/market: What buyer, job-to-be-done, competitor set, pricing, demand signal, complaints, channel?
- Finance/investing: What jurisdiction, product type, risk, regulation, historical data, suitability, evidence quality?
- Materials/manufacturing: What material/process, specs, tolerances, equipment, safety, standards, defects, suppliers?
- Hardware/electronics: What chip/board, interface, power, thermal, firmware, certifications, availability?
- Policy/legal/health: What jurisdiction/scope, effective date, authority level, guideline vs law, uncertainty?
- Academic/science: What claim, method, dataset, recency, citations, limitations, reproducibility?
- Creative/content: What format, audience, platform style, reference quality, reusable patterns, rights/attribution?

## Search Plan Before Search

Before running tools, write a compact plan:

```text
先搜：
1. 官方/标准/源头：
2. 成熟案例/开源/产品：
3. 讨论/评价/痛点：
4. 风险/反例/失败：
5. 实操/实现/流程：
```

For platform-native research, add the platform and wording:

```text
X/Twitter:
Reddit/V2EX/Zhihu:
GitHub:
小红书/公众号/B站:
官方网页/标准/PDF:
```

## Evidence Judgment

Classify evidence in the final synthesis:

- `official/source-of-truth`: authoritative but may omit real problems.
- `implementation evidence`: code, demos, issue threads, reproducible examples.
- `user discussion`: useful for pain and demand, not final truth.
- `negative signal`: complaints, failures, scams, bypasses, unsafe patterns.
- `multiple sources agree`: stronger when sources are independent.
- `unverified claim`: plausible but not proven.
- `crawler limitation`: inaccessible comments, login wall, stale index, missing date.

## Output Discipline

Every answer should make clear:

- What the user's real question became after analysis.
- What was searched or should be searched.
- What the strongest conclusion is.
- What evidence supports it.
- What remains uncertain.
- What the user can do next.

For saved dossiers, include the search directions and evidence map. For chat-only answers, keep this concise but still source-backed.

## Anti-Low-Quality Rules

Avoid generic output:

- "Search online and summarize."
- "Use official sources and blogs."
- "This is a popular tool."
- "Pay attention to safety."
- "Build frontend, backend, database."

Replace with specifics:

- Which official sources matter and why?
- Which examples prove adoption or feasibility?
- Which user complaints affect the decision?
- Which data fields, process steps, or constraints are required?
- Which failure modes would invalidate the conclusion?
- Which tests or verification steps prove the answer is usable?
