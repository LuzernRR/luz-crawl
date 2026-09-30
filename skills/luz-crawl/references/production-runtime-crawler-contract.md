# Production Runtime Crawler Contract

Read this contract when research evidence or `.luz-crawl` techniques are being turned into a production application's search, monitoring, catalog, recommendation, or ingestion connector.

## Boundary

`.luz-crawl` is an agent-side research and evidence workflow. It is not automatically a licensed runtime data provider. Reuse its pattern—plan, discover, read, verify, preserve evidence—but implement a narrow project-owned gateway with explicit source policy, tests, operations, and legal ownership.

No API key means only that the chosen public read route does not require a source credential. It does not waive terms, robots, copyright, privacy, rate, commercial-use, or regional restrictions. Keep authenticated official APIs as separate connectors and never label a public-page reader as an official API.

## Required Runtime Pipeline

```text
current user intent and source policy
-> exact approved host/path routes
-> discovery provider or fixed public entry pages
-> live robots decision for the actual target
-> bounded page read
-> deterministic field parsing
-> semantic relevance filter
-> normalization and canonical identity
-> field-level provenance
-> business hard gates
-> persistence, visible state, audit and recovery
```

Discovery results are leads, not business evidence. Read each adopted URL and retain its fetch outcome. A model may classify relevance, explain evidence, or propose a conservative canonical key; it must not invent title, image, price, sales, market, supplier, MOQ, logistics, risk, or missing-page content.

## Access And Abuse Controls

- Use an exact HTTPS host and path allowlist. Do not accept arbitrary user URLs into a server-side reader.
- Validate the original URL and every redirect target. Reject credentials in URLs, nonstandard schemes, private/link-local/loopback destinations, and DNS rebinding risks.
- Fetch the origin's current `robots.txt`; apply the matching user-agent and longest-path rule. Fail closed when the policy cannot be obtained or interpreted safely.
- Set bounded connect/read deadlines, maximum response bytes, page/result limits, concurrency, request rate, retry budget, and total run budget.
- Reject login, CAPTCHA, verification, unusual-traffic, access-denied, paywall, empty-shell, or consent-blocked pages. Never inject cookies, browser storage, account sessions, or anti-bot bypass code to make the public route pass.
- Treat a proxy as transport configuration only. It must not expand the source allowlist or be reported as source authorization.
- Log source host, route, status, latency, bytes, parser version and safe failure code; never log secrets, cookies or private page contents.

## Field Truth And Recommendation Safety

- Preserve title, image, source URL, visible metric, currency, market, observation time and parser route independently.
- Keep retail price, supplier price, landed cost, target sell price and non-product cost as different typed fields. Never substitute one for another.
- Missing means `null`/unknown. Do not use positive defaults, fixed multipliers, fixed fees, inferred zero demand, or cross-candidate field splicing.
- Do not interpret absent market evidence as “not popular.” It is missing coverage.
- A demand-only public record is a discovery candidate, not listing-ready. Require the Product baseline's authoritative supply price, currency, MOQ, margin inputs, supplier reliability, logistics, risk/compliance and requested-market coverage before a listing recommendation can pass.
- Store a field-level provenance object for every material value. Include URL, provider, observed time, route/parser, raw visible metric or line, and confidence/limitation.

## Failure, Billing And State

- Use typed failures for policy rejection, robots denial, unreadable page, blocked page, parser mismatch, semantic-filter failure, timeout and source outage.
- Fail the source closed; never replace it with fixtures, remembered products, generated candidates, copied examples, or another undisclosed provider.
- If an externally caused total failure produces no usable result, settle quota/credits according to the accepted Product rule, normally with an idempotent refund. Partial results must display exact coverage gaps.
- Persist run identity, requested markets/count, source operations, accepted/rejected candidates, evidence and terminal state so refresh/reconnect does not change the claim.

## Acceptance Gates

Require all applicable evidence before delivery:

1. allowlist, redirect/SSRF, robots and blocked-page tests;
2. parser tests from current real page shapes, including malformed/changed pages;
3. zero-result and total-source-failure tests proving no generated fallback;
4. field-role tests proving retail price cannot become supply price and missing values remain unknown;
5. semantic mismatch and canonical deduplication tests;
6. real runtime crawl with real URLs, images, timestamps, robots evidence and source-safe logs;
7. billing/refund, tenant isolation, restart/reconnect and cleanup/readback tests;
8. real browser journey from user intent to evidence detail and honest empty/partial/error states;
9. production source, bundle, package and runtime scans for prohibited fixtures, bypasses, arbitrary URL readers and undisclosed providers.

If licensing, authenticated source access, browser capability, deployment, recovery, or independent verification is missing, preserve it as a blocker or conditional limitation. A successful public crawl does not prove commercial source authorization or production readiness.
