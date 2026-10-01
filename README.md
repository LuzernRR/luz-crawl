# Luz Crawl

A Codex plugin for planning and conducting evidence-backed, multi-source research. It maps relevant sources, collects and verifies evidence, records limitations, and saves reusable research notes.

Each meaningful search begins with a user-visible plan of checked tools, target sites, query variants, steps, and fallbacks. The local experience store reuses successful and weak query patterns, applies explicit preferences immediately, and activates inferred preferences only after repeated evidence across separate runs. Saved manifests feed a small SQLite FTS index; observed source feedback can adjust future local result ordering.

Runtime state is stored per Codex user under `%CODEX_HOME%\state\luz-crawl` (or `~\.codex\state\luz-crawl`), outside the plugin checkout. The content index stores source metadata and short excerpts rather than full article bodies. X sources are kept as URL/platform metadata only until current developer terms are checked.

## Contents

- .codex-plugin/: plugin manifest and interface assets
- skills/luz-crawl/: the skill instructions, references, and helper scripts

The public package omits personal search history and local research dossiers. Runtime experience is initialized separately for each user. Local output paths and the OpenCLI bridge directory can be configured through LUZ_CRAWL_OUTPUT_ROOT, LUZ_PROMPT_LIBRARY_ROOT, CODEX_HOME, and OPENCLI_BROWSER_BRIDGE_DIR.

## Use

Install this repository as a Codex plugin using the Codex plugin manager, or copy skills/luz-crawl/ into your Codex skills directory. Follow the skill's setup and source-access instructions before using platform-specific search routes.

This repository includes both a Codex plugin and a separate browser extension under `browser-extension/luz-crawl`. In Codex, load the unpacked extension from Settings → Browser → Extensions → Load unpacked extension. After the first setup, the local bridge watches extension package files and asks the extension to reload when searches are idle. Install the local bridge dependency once with `npm install --prefix browser-extension/bridge`; the extension connects to the loopback backend automatically. In the extension popup, one user click can authorize the currently registered site origins; source permissions are derived from a categorized shared registry and remain optional. The skill can then run `python skills/luz-crawl/scripts/extension_bridge.py search --source 1688 --query "深圳家具工厂"` after presenting its search plan, without a popup click or per-search manual entry. The extension reuses one managed search tab across searches, closes older extension-created search tabs when safe, and leaves unrelated user tabs and login/security-verification handoffs alone. Concurrent starts are serialized. If a search is replaced before completion, its job is marked `superseded`. `1688` opens factory search; `1688_products` opens product listings. Captures omit common page chrome and, on 1688, chat links, ad-click redirects, and unstable tracking values. Captured shop/item links are discovery candidates, not verified company records. Login and verification may still require the user. The Codex plugin remains responsible for research planning, evidence verification, synthesis, and durable query learning.

## Enterprise lead discovery

The source catalog includes 1688, Qichacha Open Platform, the National Enterprise Credit Information Publicity System, and Shenzhen furniture/industry directories. Preflight distinguishes an available OpenCLI adapter from a site session that still needs login or verification. Qichacha's official API route is marked as requiring an authorized account, enabled API, approved use case, and local `QCC_APP_KEY` / `QCC_SECRET_KEY`; preflight never prints secrets or makes a billable request.

For a source-specific, experience-aware 1688 query plan, preview it first with `python skills/luz-crawl/scripts/lead_queries.py "家居企业" --location "深圳" --term "沙发"`, then run `python skills/luz-crawl/scripts/platform_search.py "家居企业" --lead-search --location "深圳" --term "沙发" --platform 1688`. The plan reuses relevant successful queries and suppresses exact queries recorded as weak. Read-only X searches are available through `--platform x` when the OpenCLI adapter and browser session are available. Verified query outcomes are written locally for future keyword planning; result bodies are not saved in the experience event, and session failures do not become weak-keyword feedback. Qichacha ApiCode 886 is a separate, one-request route: it needs an authorized API account and `--confirm-qcc-cost` after review of the estimated RMB 0.10/request cost. It is never retried automatically.

After independently verifying a company's exact website host, read at most three robots-allowed HTTPS pages with `python skills/luz-crawl/scripts/company_site_reader.py "https://example.com/" --approved-host "example.com"`. This reader pins a public DNS address, rejects redirects and blocked pages, and extracts only role-mailbox emails and contact-page/form links. It does not collect phone numbers or submit forms.

## Upstream crawler review

The implementation review covered [MediaCrawler](https://github.com/NanmiCoder/MediaCrawler), [ECommerceCrawlers](https://github.com/DropsDevopsOrg/ECommerceCrawlers), and [lead-scraper](https://github.com/sanketagarwal/lead-scraper). This project adopts the two-stage discovery/enrichment workflow and source-aware deduplication as design patterns, but does not vendor their code. MediaCrawler's custom non-commercial license also prohibits large-scale crawling; authenticated scraping, anti-detection, and signature-bypass paths from the reviewed examples were not adopted. The new readers use the current OpenCLI session or the approved official-site fetch contract instead.

Lead contacts should retain their source and observed purpose. Prefer company switchboards, business email, official inquiry forms, platform messaging, and people explicitly listed for business cooperation. A phone number being reachable in an unrelated page is not, by itself, a signal to add it to a bulk marketing list.

## License

No open-source license is included. All rights remain with the author unless a license is added.
