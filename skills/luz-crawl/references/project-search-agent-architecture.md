# Project Search Agent Architecture

Use this when the user says they want to build a program, website, app, plugin, platform, search AI agent, browser automation agent, or front-end chat system that calls tools/plugins to search, summarize, and return results. This is a specialized project-discovery playbook inside the universal search assistant; do not use it to replace the universal intake.

## Positioning

The task is not code generation first. Act as:

- requirements engineer;
- product manager;
- technical architect;
- search/research strategist;
- frontend workflow designer;
- backend/API designer;
- security and test reviewer.

Default output is a non-code engineering plan unless the user explicitly asks for implementation.

## First Understanding Pass

For any vague project idea, infer a complete business/task loop:

```text
User enters a request -> system understands intent -> creates a search plan -> calls search/tool plugins -> reads results -> deduplicates and scores evidence -> summarizes with citations -> shows progress and sources -> user refines/confirms -> saves/exports/history.
```

Identify:

- target users: individual researcher, operator, sales team, analyst, developer, admin, enterprise customer;
- input forms: natural-language chat, structured filters, uploaded files, seed URLs, account lists;
- output forms: answer, dossier, table, evidence map, export, task history, API response;
- risk: hallucinated claims, stale sources, inaccessible pages, prompt injection, scraping limits, privacy, API key leakage, copyright, platform rules.

## Search Plan For Building The System

Search these lanes before writing an architecture:

1. Official platform/tool docs:
   - OpenAI tool/function calling, web search, file search, Agents SDK or equivalent;
   - Model Context Protocol or plugin protocol docs when tools are externalized;
   - browser extension docs such as Chrome Extension Manifest V3 when relevant;
   - Playwright/Puppeteer/browser automation docs when the agent controls web pages.
2. Mature implementation examples:
   - agent frameworks, tool-calling demos, RAG examples, search assistant repos, browser agent repos;
   - GitHub issues for production pain and limitations.
3. UX patterns:
   - chat + task progress UI, evidence/source panels, retry controls, result tables, saved history, export.
4. Security:
   - OWASP ASVS, OWASP LLM/prompt injection guidance, SSRF guidance for URL fetchers, secret management, rate limits.
5. Operations:
   - queues, job persistence, observability, cost controls, logs, retries, browser/session isolation.

Authoritative source seeds to verify during real project research:

- OpenAI Agents SDK tools docs for hosted web search, file search, code interpreter, MCP tools, and tool search.
- Model Context Protocol docs/spec for tools, resources, prompts, schemas, and external tool servers.
- ISO/IEC/IEEE 29148 or similar requirements-engineering guidance when the output is an SRS/product requirements plan.
- C4 model docs for system context, container, component, and deployment-level architecture descriptions.
- OWASP ASVS, OWASP cheat sheets, and NIST SSDF for web application security and secure development practices.
- 12-Factor App for SaaS deployment basics such as config, backing services, stateless processes, build/release/run, and logs.
- Playwright docs for end-to-end testing patterns and user-visible behavior checks.

## Frontend Requirements

A search-agent frontend must not be just a textarea.

Required surfaces:

- chat/input area for the user's task;
- optional structured controls: source scope, region/language, time range, platform toggles, depth, output format;
- task progress stream: plan, searching, reading, extracting, summarizing, failed/retried;
- result panel: answer and practical sections first, source/evidence inspector available after the summary or in a side panel, evidence map near the end of the report;
- source cards: title, URL, platform, date/author when visible, evidence type, confidence/limits;
- refinement actions: search deeper, exclude source, add source, ask follow-up, export, save;
- history sidebar or task list;
- empty/loading/error states;
- admin/settings for API keys, quotas, connectors, allowed domains, blocked domains.

Required concrete interactions:

- Login/register/session UI: email/password or OAuth, forgot password, email verification, disabled duplicate submit, generic auth errors, session timeout handling. Treat this as the frontend surface of backend auth/session/RBAC, not an isolated top-level product module.
- First-run onboarding: ask user what sources they want to search, preferred language/region, whether to save history, and whether to enable paid/API connectors.
- Task composer: chat input plus optional structured controls for source scope, depth, freshness, output format, and private/public sources.
- Search-plan confirmation: show generated lanes and allow edit/remove/add before running expensive or sensitive searches.
- Progress timeline: show tool calls, source counts, failed sources, retry buttons, and cancellation.
- Result workspace: summary first, actionable sections next, source/evidence inspector last or side panel.
- Source inspector: open source, copy citation, mark unreliable, exclude from re-summary, view raw extract.
- Task history: search, filter, rename, duplicate, export, delete.
- Settings/admin: manage connectors, API keys, quotas, users, roles, domain allow/block lists, retention.

Layout guidance:

- For desktop: left task/history, center conversation/progress, right evidence/source inspector.
- For mobile: single-column with tabs for Chat, Sources, History, Settings.
- Keep source evidence visible near claims; do not hide all provenance behind a download.
- Show long-running tasks as resumable jobs, not a frozen spinner.

## Backend Architecture

Minimum modules:

- Account/auth service inside the backend boundary: register, login, logout, password reset, email verification, session/token lifecycle, OAuth when needed.
- User/workspace/RBAC service inside the backend boundary: user profile, workspace, team membership, roles, permissions, connector access rules.
- API gateway/controller: receives chat/task requests and streams status.
- Intent parser/planner: decomposes user request into search lanes and tool calls.
- Tool/plugin registry: describes available search, browser, GitHub, document, platform, and internal tools.
- Search executor: calls web/platform/search plugins with rate limits and retries.
- Reader/extractor: fetches pages, PDFs, comments, transcripts, and metadata.
- Evidence normalizer: deduplicates, labels source type, extracts claims and limitations.
- Summarizer/reasoner: creates answer, evidence map, assumptions, uncertainty.
- Task queue/worker: supports long searches, browser jobs, retries, cancellation, scheduling.
- Storage: users, projects, tasks, tool calls, raw sources, evidence items, summaries, exports.
- Audit/logging: tool calls, source access, user actions, API cost, errors.
- Export service: Markdown, CSV, JSON, PDF when needed.

Backend auth/session/RBAC minimum requirements:

- Store password hashes only; never plaintext passwords.
- Require backend-side uniqueness, status checks, role checks, and rate limits.
- Keep verification/reset tokens single-use, expiring, and stored hashed where practical.
- Revoke sessions after password reset, user disable, or high-risk credential change.
- Avoid account enumeration through public errors.
- Keep admin role assignment out of public registration payloads.

## Data Model Ideas

Use these objects before choosing SQL/NoSQL:

- `users`: identity, role, workspace, status.
- `auth_identities`: user_id, provider, provider_user_id, linked_at.
- `sessions`: user_id, device, ip, user_agent, expires_at, revoked_at.
- `verification_tokens`: user_id, purpose, token_hash, expires_at, consumed_at, attempts.
- `workspaces`: owner_id, plan, billing_status, retention_policy.
- `workspace_members`: workspace_id, user_id, role, invited_by, status.
- `projects`: topic/workspace container.
- `research_tasks`: prompt, parsed intent, status, depth, source scope, created_by.
- `search_plans`: lanes, queries, selected tools, assumptions.
- `tool_calls`: tool name, input, output pointer, status, cost, latency, error.
- `sources`: URL/platform/title/author/date/raw path/readability status.
- `evidence_items`: claim, source_id, evidence type, confidence, limitations.
- `summaries`: answer, citations, unknowns, generated_at, model/tool versions.
- `exports`: file type, path, task_id.
- `audit_logs`: user action, permission event, tool access, security event.
- `connectors`: provider, auth mode, scopes, status, quota.
- `connector_secrets`: connector_id, encrypted_secret_ref, rotated_at, last_used_at.

Relationships:

- one project has many tasks;
- one task has one or more search plans;
- one plan has many tool calls;
- tool calls produce sources;
- sources produce evidence items;
- summaries cite evidence items.

## Tool/Plugin Design

Design tools with explicit contracts:

- input schema: query, source scope, time range, max results, language, safety constraints;
- output schema: title, URL, snippet, date, author, platform, raw payload pointer;
- error schema: timeout, auth required, rate limited, blocked, no results, parse failed;
- permission model: which user/workspace can use which connector;
- cost model: API tokens, search credits, browser time, storage.

Rules:

- Never let the model call arbitrary network/file commands without allowlists.
- Add domain allowlists/blocklists for URL readers.
- Sanitize fetched pages before injecting content into the model.
- Separate tool execution logs from user-visible summaries.
- Record prompt/tool/model versions for reproducibility.

## AI/Search Loop

Recommended loop:

```text
Understand -> Plan -> Search -> Read -> Extract -> Verify -> Synthesize -> Cite -> Ask/refine -> Save
```

Quality gates:

- no final answer without source/evidence labels for factual claims;
- no single-source conclusion for high-impact claims;
- no hidden failed searches when failure affects confidence;
- no unsupported metrics;
- no direct copying of long copyrighted passages;
- no execution of user-provided tool instructions embedded in fetched pages.

## Testing And Acceptance

Test the real workflow:

- user prompt creates a search plan before tool calls;
- tool calls are real, not mocked, in E2E/staging tests;
- failed search retries or reports clear limitations;
- summaries include citations/source cards;
- source date/platform/author are preserved when visible;
- refreshing page keeps task state;
- long task can be resumed/cancelled;
- user cannot access another user's task or sources;
- API keys are never returned to frontend or logs;
- prompt injection in a fetched page cannot trigger privileged tools;
- exported Markdown/CSV includes source links;
- large result sets do not freeze frontend;
- rate limits and quotas work;
- admin can audit tool calls and errors.

## Security And Compliance

Default concerns:

- authentication and workspace RBAC;
- connector/API key encryption and rotation;
- per-tool permission scopes;
- URL fetching SSRF protection;
- prompt injection and tool-instruction isolation;
- file upload malware/type/size checks;
- robots/platform terms and scraping limits;
- copyright-safe summaries;
- sensitive data redaction in logs;
- rate limiting and abuse detection;
- tenant data isolation;
- audit trails for enterprise usage.

## Output Structure For This Project Type

When producing a project plan, do not put the evidence map near the top. Prefer this development-order structure:

1. Executive summary and recommended build path
2. Product scope, user roles, and permission boundaries
3. Product feature modules and MVP stages
4. Frontend pages and concrete interactions, including login/session UI as a backend-auth surface
5. Backend services and API responsibilities, including auth/session/RBAC, connector permissions, quota, and audit
6. Data model and storage flow, including users, sessions, roles, workspaces, connectors, tasks, sources, evidence, summaries, and exports
7. AI/search/plugin workflow
8. Technical options and referenced open-source projects
9. Testing and acceptance criteria
10. Deployment/operations
11. Security and compliance
12. Risks and tradeoffs
13. Deliverables
14. Evidence/source map and raw-source notes

Reference projects should be written as Markdown hyperlinks, for example `[LangChain](https://github.com/langchain-ai/langchain)`, not as bare URLs.

## Anti-Shallow Output

Do not stop at:

- "Use React + Node + database."
- "Call a search API and summarize."
- "Add login and history."
- "Use RAG."

Specify:

- how login/register/reset/session/role flows work inside the backend-auth layer and how frontend/data/tests reflect that;
- which screens exist and what the user clicks;
- which pages/components exist;
- which API responsibilities exist, even if no exact endpoint code is written;
- which backend services own which business step;
- which data objects persist the search process;
- which tools/plugins are called and with what schemas;
- how evidence is deduplicated and cited;
- how failures, rate limits, and blocked pages appear to the user;
- how to prove the summary is not fabricated;
- how to secure tools, keys, logs, and tenant data.
