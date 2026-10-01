# OpenCLI Search Through the User's Edge

Use this workflow for Xiaohongshu, Zhihu, and WeChat public-account article searches when the user has asked to use the existing Edge session.

This Edge-specific workflow does not apply when the user explicitly selects Codex's in-app browser. In that case, follow `codex-in-app-browser-workflow.md` and do not route through OpenCLI's Edge Bridge.

## Browser selection and connection

1. On Windows, the default system-wide Edge launcher is `C:\Users\Public\Desktop\Microsoft Edge.lnk`.
2. Check whether `msedge.exe` is already running. If it is, reuse that running Edge through its Browser Bridge profile. Do not invoke the shortcut, `Start-Process`, another browser executable, Playwright's bundled browser, or an anonymous browser.
3. Only if no `msedge.exe` process exists may the exact shortcut above be used to start Edge. Do not create a second Edge instance to recover a disconnected Bridge.
4. Run `opencli doctor` and `opencli profile list`. Continue only when doctor reports the Extension and Connectivity as connected and the intended profile appears connected. If multiple profiles exist, select the one verified as the current Edge profile with `OPENCLI_PROFILE`; do not guess.
5. If Edge is already running but the Bridge is disconnected, record that the native platform search is blocked and stop that route. Do not start another browser or close/restart Edge to repair the connection.

## Page lifecycle

- Run one browser-backed command at a time.
- Use `--site-session ephemeral --keep-tab false --window background` for each read-only search command. In the locally verified OpenCLI 1.8.5 runtime, this combination maps to a one-command session and calls `closeWindow()` on both success and failure. This releases/closes the command's temporary tab lease while retaining the Edge process. Recheck adapter help and cleanup behavior if the installed version changes. Requires OpenCLI >= 1.8.7 **and** Browser Bridge extension >= 1.0.23 (currently 1.8.8 / 1.0.24, unpacked at `%CODEX_HOME%\skills\agent-reach\opencli-browser-bridge\opencli-extension-v1.0.21` — the folder name is kept so the extension ID does not change). Extension <= 1.0.21 loses its lease registry whenever the MV3 service worker restarts on Windows, so `closeWindow()` cannot find the window and every search leaves an orphan `about:blank` Edge window (upstream PR jackwener/opencli#2098). If `opencli doctor` reports an extension update, reload the extension in `edge://extensions` before searching. Even when fixed, upstream keeps one automation container window parked on `about:blank` for reuse; this install is patched by `scripts\patch_opencli_bridge.py` to close that window when its last lease is released. After any extension update, run `python scripts\patch_opencli_bridge.py` and reload the extension; `--check` reports whether the patch is present.
- Do not use `--site-session persistent` or `--keep-tab true` for routine searches; persistent sessions force the tab lease to remain open.
- Do not run `opencli browser <session> close` as a substitute for closing Edge. Do not close the browser process or any tab that predates the current crawl. If a tab's ownership cannot be established, leave it untouched.
- If a known earlier run of this crawl used persistent site sessions, release only its matching `site:<adapter>` leases with `opencli browser <session> close`; never apply this to a session that may belong to the user or another task.
- The search script itself never launches, terminates, or restarts Edge.

## Preflight and search

Run `agent-reach doctor --json` and inspect its route report. Then verify `opencli doctor`, `opencli profile list`, and the relevant adapter's `--help`; an installed adapter is not proof of a connected session or supported search command.

For a topic search across all three adapters:

```powershell
python scripts\platform_search.py "你有哪些独到的识人技巧" `
  --synonym "识人技巧" `
  --synonym "识人术" `
  --synonym "看透一个人" `
  --platform xiaohongshu `
  --platform zhihu `
  --platform weixin `
  --window background `
  --out "%USERPROFILE%\Documents\luz-crawl\001_识人技巧三平台搜索可靠性验证\raw"
```

The script runs each command sequentially, parses JSON even when OpenCLI writes surrounding diagnostic lines, and retries a recognizable transient network error once. When every topic query returns an empty list, it runs one separate broad health control (`穿搭` for Xiaohongshu, `如何评价` for Zhihu, `人工智能` for WeChat). The control is labeled `health_control` and never counted as a topic hit. If the control also returns empty, inspect account/session and adapter status; mark topic coverage unconfirmed rather than claiming no content exists.

For an explicit high-volume request, use several meaningfully different query phrasings and a moderate per-query limit. The WeChat adapter caps each page at 10 rows; `--weixin-pages N` walks N pages sequentially for every topic query (1–10). Keep page numbers in raw evidence. Deduplicate Xiaohongshu by note ID and Zhihu by normalized URL. For WeChat, resolve a Sogou redirect to the official article URL when possible; otherwise use title+date only as a tentative index signature and label it as such, not as a verified unique-article count. Report raw rows and deduplicated candidates separately. Do not parallelize browser-backed searches.

```powershell
python scripts\platform_search.py "你有哪些独到的识人技巧" `
  --synonym 识人技巧 --synonym 识人术 --synonym 看透一个人 `
  --synonym "如何判断一个人的人品" --synonym "通过小事看清一个人" `
  --platform xiaohongshu --platform zhihu --platform weixin `
  --limit 30 --weixin-pages 3 --window background `
  --out "%USERPROFILE%\Documents\luz-crawl\NNN_主题\raw\platform-search"
```

For an empty Xiaohongshu search, verify the current account/session using the login-status command exposed by the installed adapter (currently `opencli xiaohongshu whoami`, when available). Login status is diagnostic only: `logged_in: true` does not prove the search adapter returned content, and an empty search list does not prove the platform lacks matching notes. Preserve the login check and search response separately.

## Route and output labels

- `opencli xiaohongshu search` searches notes; keep the original note URL, author, visible publication date, and engagement fields where available.
- `opencli zhihu search` searches Zhihu questions/answers; open representative entries before treating their content as factual evidence.
- `opencli weixin search` currently uses Sogou's WeChat article index, not the WeChat client-native search UI. Label this clearly and verify redirected article pages before citing their account, date, or full text.
- Save raw adapter output, health-control output, Bridge/profile preflight, and any login-status response in the dossier's `raw\` folder.
- Name the saved dossier and its Markdown file with the same three-digit-plus-topic form, such as `001_识人技巧三平台搜索可靠性验证`, under `%USERPROFILE%\Documents\luz-crawl` unless the caller explicitly owns another output root.
