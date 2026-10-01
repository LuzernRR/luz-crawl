# Codex In-App Browser Workflow

Use this reference only when the user explicitly asks to search, inspect, or sign in through Codex's in-app browser.

## Capability boundary

- Reuse the current in-app browser and its matching open tab when possible. If a separate page is needed, create a new tab and leave unrelated user tabs untouched.
- Use the Browser skill's documented page navigation, visible DOM, and interaction APIs. Do not inspect cookies, local storage, passwords, or browser profile/session stores.
- Codex Settings → Browser → Extensions exposes a “Load unpacked extension” action. The Browser automation API itself does not expose extension installation, so use the app's extension settings UI for that step rather than pretending a page-navigation call installed it.
- The `luz-crawl` package in this repository is a Codex plugin (`.codex-plugin/plugin.json`); the separately packaged browser extension lives under `browser-extension/luz-crawl`. Install that directory, not the repository root.
- The Chrome for Developers article's Chrome DevTools MCP setup describes installing/debugging extensions in a running desktop Chrome instance. Codex's extension settings page is a separate supported route for this app; do not assume `--autoConnect` targets the Codex in-app browser.

## Extension-owned search and capture

- When the user asks Luz Crawl's extension to search/crawl, show the source/query/tool plan, then invoke `scripts\extension_bridge.py search --source <source-id> --query "<exact query>"`. This command starts the local backend bridge if needed and queues work for the extension. The service worker connects on startup, reconnects after disconnection, reuses one extension-managed search tab across sources, and sends run state plus up to 40 visible result links back to the backend. Close older extension-created search tabs when safe, but preserve unrelated user tabs. A live login or verification handoff blocks a new search so that page is not overwritten. Concurrent starts are serialized and a replaced in-progress run ends as `superseded`. Do not make the user click the popup or re-enter each query.
- Initial setup still requires the extension to be loaded/reloaded, the user to grant each selected site's optional page permission once, and the user to complete login or security checks when required. The CLI returns a typed waiting/offline status instead of pretending the search succeeded. 1688 defaults to its factory search route using a GBK form; use source `1688_products` for product cards. Qichacha and the National Enterprise Credit Information Publicity System currently require a separate manual site-search route.
- Login, security verification, access-denied and empty-result states are not success. Keep the tab open; after the user completes a login/verification step, the extension rechecks the page and resumes when the result route is available. Never inspect credentials or session storage, solve a CAPTCHA, or bypass a gate.
- A live extension acceptance run must be triggered through a backend bridge job and confirmed from its terminal job state and returned capture. Unit tests or an Agent-controlled page search do not prove the bridge is connected to the installed extension.
- The in-app Browser control API exposes tabs and page DOM but not extension toolbar popups. The backend bridge is the supported no-popup invocation route. Do not substitute Computer Use, internal `chrome://`/`chrome-extension://` navigation, raw CDP, or another browser surface to get around that boundary.

## Search and login

1. Before each meaningful search, show the user the selected browser, exact target site(s), exact query text, result limit, ordered steps, and fallback. Keep searches on the user-requested browser surface.
2. Prefer the site's visible search form. Enter the exact query and read the input back before submitting it. For Chinese queries, let the site's form encode the value according to its declared charset; do not hand-build UTF-8 query URLs for a form that declares a different encoding. If a direct search URL is used, decode and verify the visible query before treating it as a successful search.
3. Keep one browser-backed search at a time. Capture only visible result fields needed for the user's task, preserve source URLs and access limitations, and distinguish search cards from verified source details.
4. If login blocks the requested route, keep the selected page open and ask the user to sign in there; do not switch to Edge/OpenCLI or mark the query weak. Never request or inspect credentials, cookies, or stored session data.
5. If a CAPTCHA, unusual-traffic page, or access-denied screen appears, stop that route and leave the page open for the user. Do not solve or bypass it. Resume only after the user completes any required verification and says the page is ready.

## Completion evidence

Record the exact query as displayed by the site, the final URL/title, result count where visible, visible fields captured, and any login/verification/access limitation. A successful browser connection or a logged-in header alone does not prove the search returned results.
