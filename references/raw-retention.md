# Raw source retention

Use this only after the collected material is organized and the delivered HTML or other retained result is complete. Keep `raw/` roots folder-only; write plans and cleanup records beside the raw root.

Create a dry-run plan first:

```powershell
python scripts/prune_raw.py "E:\Codex\00_TechDev\Skills输出\luz-crawl\AI赚钱实操\raw"
```

Review `raw-cleanup-plan.json` outside `raw/`. It includes each source URL, verified delivery, candidate paths, SHA-256 values and reclaimable bytes. By default, the tool proposes large snapshot JSON/HTML and `raw/page.png` files only when the source archive is captured, `raw/content.json` and every manifest-listed file still match, and the delivered HTML matches its recorded SHA-256. It never proposes unique design images, partial/blocked captures, or files without a matching delivery.

When the user asks to minimize completed raw archives and keep source links for later recapture, add `--prune-content` to the dry run. It also proposes `raw/content.json` above the size threshold, but only for a captured archive whose delivery hash matches. Review the plan first: this removes the local extracted copy, so future recovery depends on the saved source URL and the source page still being accessible. The manifest keeps requested/canonical/resolved URLs, capture status/time, delivery hash, and the removed file's size/hash in `pruned_files`.

Apply the exact plan only after reviewing it:

```powershell
python scripts/prune_raw.py "E:\Codex\00_TechDev\Skills输出\luz-crawl\AI赚钱实操\raw" --apply
```

Before removal, the tool rechecks the plan's manifest, source content, delivery and candidate hashes. It stages files outside `raw/`, updates each manifest with revisit links and hashes of pruned files, then removes the staged copies. The completion record also stays outside `raw/`. If any checked file changed after planning, the tool stops without deleting that archive's files. Keep the source URL, canonical URL, captured status/time, delivered-file hash and removed-file hashes so a future run can revisit and collect the page again.

Do not manually delete files based only on size. Do not prune raw media that is the only copy used by a design deliverable, or source files whose original URL and matching delivered output are unknown. `verify` validates remaining hashes and the delivered HTML; after compaction it does not claim removed files still exist or prove the source page will remain accessible. With link-only retention, `manifest.files` may be empty when `pruned_files` records the removed evidence and the delivery still verifies.
