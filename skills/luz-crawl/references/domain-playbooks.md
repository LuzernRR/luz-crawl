# Domain Playbooks

Use this reference before domain-specific research. Pick only the relevant playbook(s), then combine with `source-routing.md` and `search-toolkit.md`.

## Universal Domain Pattern

For any domain, build evidence from:

- Primary sources: official docs, standards, datasheets, regulations, original papers, source code, patents, product pages.
- Working examples: repos, demos, case studies, production writeups, real screenshots, templates, factory/process examples.
- Community reality: issues, reviews, Reddit/X/V2EX/Zhihu/HN, comments, complaints, failure reports.
- Selection criteria: cost, complexity, maturity, performance, reliability, safety, maintainability, legal/compliance, supply availability.
- Actionable output: best options, when to use/avoid them, exact next steps, pitfalls, and source-backed reasoning.

## Software System Development

Use for backend, frontend, database, distributed systems, SaaS, internal tools, APIs, platforms, and full-stack architecture.

For production system topics, also read `engineering-grade.md`.

Search lanes:

- Official docs: framework/runtime/cloud/database/API docs, architecture guides, migration guides.
- Code evidence: GitHub repos, examples, starters, issue threads, release notes, benchmark repos.
- Production practice: engineering blogs, postmortems, scaling stories, observability notes, security advisories.
- Community feedback: HN, Reddit, V2EX, Stack Overflow, GitHub discussions/issues, X technical threads.
- Negative/risk: `pitfalls`, `limitations`, `migration`, `performance issue`, `memory leak`, `breaking change`, `踩坑`, `事故`, `瓶颈`.

Extract:

- Architecture choices, data flow, module boundaries, tech stack, deployment shape.
- Performance/scale assumptions, consistency model, latency, throughput, storage, cost.
- Failure modes, operational burden, security/compliance risks, migration path.
- Minimal viable implementation plan and verification checks.

## Frontend Engineering

Use for React/Vue/Svelte/Next.js, component systems, frontend architecture, performance, state, tables/forms/editors/canvas, build tooling.

Search lanes:

- Official docs and RFCs.
- GitHub components/examples and issues.
- npm/package registry health, bundle size, release cadence, dependencies.
- Real product implementations, demos, Storybook examples, benchmark articles.
- Community complaints: performance, accessibility, mobile, SSR/hydration, browser compatibility.

Extract:

- Component/API shape, integration steps, styling model, accessibility support.
- Bundle/performance cost, SSR compatibility, browser support, customization limits.
- Maintenance signals: stars, releases, issue response, license, ecosystem fit.
- Recommendation table: use when, avoid when, alternatives.

## UI/UX And Frontend Design

Use for UI design, frontend visual design, design systems, interaction patterns, dashboards, mobile apps, SaaS tools, editors, games, landing pages.

Search lanes:

- Design systems: Apple HIG, Material, Fluent, Carbon, Ant Design, Radix/Shadcn, Tailwind UI, product-specific systems.
- Real products: screenshots, app stores, product pages, onboarding flows, dashboards, pricing pages.
- Design communities: Figma Community, Dribbble/Behance, Mobbin-like galleries when accessible, X/Xiaohongshu design posts.
- Accessibility/usability: WCAG, Nielsen Norman Group, inclusive design docs, keyboard/mobile patterns.
- Implementation: component libraries, CSS patterns, animation/performance constraints.

Extract:

- Layout patterns, information hierarchy, interaction states, responsive behavior.
- Component inventory, spacing/type/color rules, iconography, empty/loading/error states.
- Accessibility requirements and implementation constraints.
- What to copy, what to avoid, and a concise design direction.

## Backend And APIs

Use for Java/Spring, Node, Python, Go, Rust, API design, auth, queues, caching, file processing, payments, notifications.

For auth/account/security-sensitive flows, also read `engineering-grade.md`.

Search lanes:

- Official framework/library/cloud docs.
- Reference architectures and sample repos.
- GitHub issues for edge cases and version problems.
- Engineering blogs for production reliability.
- Security advisories and auth/payment provider docs when relevant.

Extract:

- API contracts, auth model, data model, idempotency, retries, rate limits.
- Queue/cache/storage choices and operational tradeoffs.
- Error handling, observability, deployment, rollback, migration, tests.

## Databases And Data Systems

Use for SQL/NoSQL/vector/search/time-series/OLAP/ETL/BI/warehouse/lakehouse/schema/indexing.

Search lanes:

- Official docs, query planners, indexing docs, consistency/transaction docs.
- Benchmarks with reproducible setup, not isolated vendor charts.
- GitHub examples/connectors/migrations.
- Incident reports, scaling stories, issue trackers.
- Community comparison posts with real workload details.

Extract:

- Workload shape, schema, indexes, query examples, write/read volume, retention.
- Consistency, backup/restore, migrations, replication, sharding, cost.
- Failure modes, vendor lock-in, operational difficulty, monitoring.

## DevOps, Cloud, And Engineering Productivity

Use for CI/CD, Docker, Kubernetes, Terraform, observability, logging, testing, monorepos, build systems, developer experience.

Search lanes:

- Official cloud/tool docs, reference architectures, pricing calculators.
- GitHub Actions/GitLab/Circle examples, Terraform modules, Helm charts.
- Production postmortems, SRE blogs, security advisories.
- Community failure reports and upgrade notes.

Extract:

- Pipeline shape, environments, secrets, rollback, observability, cost controls.
- Reliability risks, security posture, maintenance load, team skill requirements.
- Step-by-step implementation and verification commands.

## AI, Data, And Automation

Use for LLM apps, agents, RAG, computer vision, datasets, prompts, evaluation, data pipelines, automation tools.

Search lanes:

- Official model/API docs, cookbook examples, pricing/rate limits.
- Papers, benchmarks, eval repos, leaderboards, datasets.
- GitHub implementations and issue threads.
- Real product demos, user feedback, failure cases.

Extract:

- Model/tool choice, input/output contract, eval method, cost/latency, privacy.
- Dataset/source quality, retrieval/evaluation strategy, failure cases.
- Practical architecture and monitoring plan.

## Security And Privacy

Use for security design, vulnerabilities, phishing, auth, signing, supply-chain risk, privacy compliance.

For application auth/account flows, also read `engineering-grade.md`.

Search lanes:

- CVE/NVD/GitHub advisories, vendor security bulletins.
- Official auth/crypto/protocol docs.
- Exploit writeups, incident reports, audit reports.
- Compliance/privacy docs and regulator guidance.

Extract:

- Threat model, affected versions/scope, exploitability, mitigation, detection.
- Secrets/data exposure, dependency risk, operational controls, residual risk.

## Hardware, Electronics, And Embedded

Use for boards, chips, sensors, firmware, IoT, robotics, power, RF, mechanical-electrical integration.

Search lanes:

- Datasheets, reference designs, application notes, evaluation board docs.
- Supplier pages, forums, GitHub firmware, driver issues.
- Standards, certifications, safety/regulatory docs.
- Teardowns, field failure reports, manufacturing notes.

Extract:

- Key specs, tolerances, interfaces, power/thermal constraints, BOM risk.
- Firmware/toolchain requirements, test equipment, certification constraints.
- Alternatives, availability, lifecycle status, failure modes.

## Materials And Chemistry

Use for metals, polymers, composites, ceramics, coatings, adhesives, batteries, chemicals, material selection and processing.

Search lanes:

- Material datasheets, SDS/MSDS, standards, handbooks.
- Papers, patents, process guides, supplier technical notes.
- Industry forums, failure analyses, case studies.
- Regulations, safety and environmental constraints.

Extract:

- Composition, properties, processing window, compatibility, durability, failure modes.
- Equipment/process requirements, quality control, safety, storage/handling.
- Supplier availability, cost signals, substitutes, standards to verify.

## Manufacturing And Industrial Technology

Use for machining, injection molding, additive manufacturing, casting, welding, automation, QA, factory processes, industrial software.

Search lanes:

- Standards, process manuals, equipment vendor docs, datasheets.
- Patents, papers, case studies, factory videos, supplier/process pages.
- Quality methods: SPC, FMEA, ISO, inspection, metrology.
- Community/factory reality: forums, videos, failure cases, maintenance notes.

Extract:

- Process flow, equipment, tolerances, cycle time, yield, defect modes.
- Materials, tooling, safety, maintenance, cost drivers, supplier constraints.
- QA/inspection plan and practical next experiments.

## Energy, Environment, And Infrastructure

Use for solar, batteries, grid, HVAC, water, carbon, recycling, construction, logistics infrastructure.

Search lanes:

- Standards/regulations, government/agency docs, grid or utility docs.
- Technical reports, LCA studies, papers, vendor specs.
- Project case studies, cost databases, maintenance/failure reports.

Extract:

- Performance assumptions, lifecycle cost, safety, regulation, permitting.
- Site constraints, operations/maintenance, failure risks, environmental tradeoffs.

## Business, Market, And Product Research

Use for market sizing, competitor research, pricing, positioning, business models, growth channels.

Search lanes:

- Official sites, pricing pages, app stores, Product Hunt, reviews.
- Public filings, press releases, interviews, job postings.
- Social/community sentiment, complaints, alternatives, churn signals.
- Case studies, benchmarks, industry reports where accessible.

Extract:

- Target users, use cases, pricing, distribution, moat, weaknesses.
- Evidence of demand, adoption, complaints, switching barriers.
- Actionable opportunity or positioning summary.

## Policy, Legal, Education, Health, And Other Specialized Fields

Use domain caution. Prefer primary and authoritative sources.

Search lanes:

- Laws/regulations/guidance, government or institution pages, standards bodies.
- Peer-reviewed papers, clinical/technical guidelines, official curricula.
- Professional associations, reputable explainers, case law or policy analysis.
- Community experience only as anecdotal evidence.

Extract:

- Jurisdiction/scope, effective date, authority level, uncertainty.
- What is allowed/required/recommended, exceptions, risks.
- Do not present legal/medical/financial advice as certainty; provide source-backed information and caveats.
