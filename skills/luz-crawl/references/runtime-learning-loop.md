# Runtime Tool And Learning Loop

Use this reference before every meaningful Luz Crawl search. It defines the executable loop that makes tool routing observable and experience durable across plugin upgrades.

## Storage Boundary

- `<skill-root>\experience` is bundled read-only seed data.
- `<experience-root>` is persistent runtime state.
- Default `<experience-root>`: `%CODEX_HOME%\state\luz-crawl`, falling back to `~\.codex\state\luz-crawl`.
- `LUZ_CRAWL_STATE_ROOT` may override the state location.
- Never write learned experience into `plugins\cache`, a versioned plugin directory, or the compatibility wrapper.

The persistent store contains:

```text
<experience-root>\
  state.json
  events.jsonl
  knowledge-index.md
  search-keywords.md
  search-skill-library.md
  knowledge-base-seeds.md
  seed\
```

`events.jsonl` is the append-only authority. Markdown files are atomically rebuilt projections. A stable `event_id` prevents duplicate deposition.

## Before Search

1. Initialize the persistent store:

```powershell
python scripts\experience_store.py init
```

2. Retrieve only relevant prior experience:

```powershell
python scripts\experience_store.py query "<intent domain platforms source types>" --limit 8
```

Treat matches as route/query hints. They do not replace fresh evidence, current official sources, or the user's current constraints.

3. Inventory current search capabilities:

```powershell
python scripts\tool_preflight.py `
  --intent "<real user intent>" `
  --platform "<platform>" `
  --available-tool "<tool actually visible in the current runtime>" `
  --probe-agent-reach `
  --output "<dossier>\raw\tool-preflight.json"
```

Pass only actually available skills, MCP tools, browser tools, or CLI routes. Do not claim Firecrawl, browser, an authenticated platform, or any connector is available without runtime evidence. For chat-only research, the output file is optional, but the route decision still applies.

When OpenCLI is installed, preflight also checks the requested site's `search` adapter and the Browser Bridge connection. An installed adapter with a disconnected Bridge is `warn`, not a usable search route. For direct platform checks, use `scripts\platform_search.py`; it only sends commands through an already-connected OpenCLI browser profile and never launches a browser. On Windows, when the user specifies Edge, resolve `C:\Users\Public\Desktop\Microsoft Edge.lnk` and check for an existing `msedge.exe` first. Reuse the current Edge through its connected Bridge; do not start another Edge instance. If the Bridge is disconnected, record the block and stop the platform-native attempt.

4. Build the search matrix from current intent, retrieved experience, and the tool preflight. Prefer the most source-specific route and define at least one fallback for every required lane that may be blocked.

## During Search

- Preserve query, route, timestamp, source URL, and limitations in raw evidence for non-trivial saved runs.
- When a route fails, execute the recorded fallback instead of silently dropping the lane.
- Extract new jargon, people, organizations, communities, tools, and adjacent lanes from high-signal sources and run at least one follow-up query when the research is serious.
- Keep current evidence separate from prior experience. Prior experience may propose where to look; only current evidence supports current claims.

## After Search

For a saved dossier:

```powershell
python scripts\finalize_run.py "<dossier-folder>" `
  --run-id "<stable run id>" `
  --summary "..." `
  --domain "..." `
  --tool "..." `
  --channel "..." `
  --worked-query "..." `
  --weak-query "..." `
  --tool-problem "..." `
  --tool-fix "..." `
  --lesson "..." `
  --next-query "..."
```

For chat-only research:

```powershell
python scripts\finalize_run.py `
  --run-label "<clear topic>" `
  --run-id "<stable run id>" `
  --summary "..." `
  --tool "..." `
  --worked-query "..." `
  --lesson "..."
```

Reusing the same `--run-id` must report `recorded=false` and rebuild projections without adding a duplicate event.

## Verification And Recovery

Run:

```powershell
python scripts\experience_store.py doctor
python scripts\experience_store.py rebuild
```

The doctor must fail if persistent state is inside a versioned plugin cache, an event is malformed, or required projections are missing. `rebuild` reconstructs Markdown projections from the seed snapshot plus the append-only ledger. Never repair history by deleting events or hand-editing generated projections.
