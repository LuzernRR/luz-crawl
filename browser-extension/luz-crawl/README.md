# Luz Crawl Browser Extension

This Manifest V3 package connects to a local Luz Crawl backend and performs browser searches/captures inside the installed browser extension.

## One-time setup

1. Open Codex **Settings → Browser → Extensions**.
2. Turn on developer mode if needed, then choose **Load unpacked extension**.
3. Select this folder: `browser-extension/luz-crawl`.
4. Install the local bridge dependency once with `npm install --prefix browser-extension/bridge`.
5. Reload the extension. Its background service worker connects to `127.0.0.1:8765` automatically and retries after disconnects.
6. In the extension popup, click **Authorize all registered sources** once. The browser presents the optional-origin request from this user gesture; you can also grant only the selected source when starting an individual search. Chromium does not allow a background service or the local bridge to grant permissions without a user gesture.
7. The local bridge watches extension package files and asks the extension to reload after changes, once active searches finish. The first time this auto-reload support is added, reload the extension once so its background can receive the reload signal. Changes to the bridge server itself still require restarting that local Node service.

## Run searches through the backend

The Codex skill invokes the backend automatically after presenting the search plan. To run the bridge manually:

```powershell
python skills/luz-crawl/scripts/extension_bridge.py health
python skills/luz-crawl/scripts/extension_bridge.py sources
python skills/luz-crawl/scripts/extension_bridge.py search --source 1688 --query "深圳家具工厂"
```

`extension_bridge.py` starts the local Node service in the background, submits a job, waits for the extension, and returns its status and captured links as JSON. `sources` reads the same source registry used by the popup and bridge, including each source's category. The initial catalog spans code repositories, social content, Q&A, article indexes, B2B factory/product searches, company information, and government registries. It includes `github`, `xiaohongshu`, `x`, `zhihu`, `weixin`, `1688`, `1688_products`, `qichacha`, and `gsxt`; Qichacha and GSXT currently open their official homepages for manual in-site search. If a site requires login or a security check, the job returns `waiting_user` and keeps the current tab. Once the user finishes on that site, the extension retries the same query in the same tab; if the CLI already returned, use its job ID to read the updated status.

Searches reuse one extension-managed tab. When a new search starts, the extension navigates that tab to the next source and closes older extension-created search tabs that still point to supported source domains. It does not close unrelated user tabs. A live login or security-verification handoff blocks a new search so its page stays available. Concurrent search starts are serialized; if a new search replaces an in-progress one, the earlier job ends with status `superseded`.

The bridge defaults to the current Luz Crawl extension ID used by this development install. If your unpacked extension has a different ID, configure it once with `python skills/luz-crawl/scripts/extension_bridge.py configure --extension-id <32-character-id>`; later searches do not need this step.

The bridge binds only to `127.0.0.1:8765`, validates the extension origin, accepts only IDs from the shared source registry, rejects cross-origin browser requests, and keeps a small job ledger under `%LOCALAPPDATA%\LuzCrawl\bridge-jobs.json`. It watches only packaged extension files (`.js`, `.html`, `.css`, `.json`); pending reloads wait until the current search finishes, then queued searches resume after the extension reconnects. To add a source, register its route, category, domain, and optional origins in `search-routes.js`, declare those exact origins in `manifest.json`, and add route/permission tests. The popup groups sources by category and derives the one-click authorization request from this registry. The extension host access for its own loopback service is narrow; site access remains optional.

1688 submits through a GBK form to preserve Chinese query text. Other search URLs use percent-encoding. Search tabs are monitored by the extension service worker; the backend does not type into or scrape those pages.

## Permissions and data

- `activeTab`: grants temporary access only after the user opens the extension on the current page; used by the manual capture action.
- `alarms`: retries the backend connection after a service worker restart.
- `scripting`: runs the packaged form-submit and visible-result capture functions.
- `storage`: saves up to 100 captures locally in the extension profile.
- `host_permissions`: one loopback host (`127.0.0.1:8765`) for the local backend WebSocket; this does not grant access to other local services.
- `optional_host_permissions`: requested by a user click for registered sources in one request, or separately for the selected source when starting a search. The list is limited to registered source origins; no broad all-site permission is requested.
- No remote scripts, cookies, local/session storage access, automatic pagination, CAPTCHA handling, or phone-number collection.
- Phone-like numbers and email addresses are omitted from captured labels. 1688 capture drops global navigation, chat links, ad-click redirects, and unstable tracking parameters while retaining visible item and shop pages.

The extension returns captures to the local backend and also saves them in the extension profile. The Codex skill remains responsible for cross-run keyword learning, source verification, and evidence synthesis. Automatic capture is limited to visible links on the first loaded results page; it does not read full post bodies or paginate. A captured product or shop page is a discovery candidate, not a verified company record.
