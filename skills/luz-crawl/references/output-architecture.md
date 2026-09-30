# Output Architecture

Use this before creating, moving, or auditing luz-crawl outputs.

## Root

```text
%USERPROFILE%\Documents\luz-crawl
```

All user-facing dossiers live directly under this root. Do not create module, domain, category, or section folders.

Root priority rule: when `.luz-crawl` is the active research/output skill, this root is the default destination for formal deliverables unless the user explicitly names another path. If another specialized skill has its own default output root, use it only for its internal guidance; the final dossier, raw evidence, and generated preview artifacts still belong under this luz-crawl root.

## Folder Shape

```text
%USERPROFILE%\Documents\luz-crawl\
  001_期货小白从0开始学习指南\
    001_期货小白从0开始学习指南.md
    raw\
      manifest.json
      search_web_001.txt
  002_金融自动化预测分析平台开发基础\
    002_金融自动化预测分析平台开发基础.md
    raw\
      manifest.json
      github_repo_001.json
      reddit_discussion_001.yaml
```

Rules:

- Root-level folder names must use three-digit prefixes: `NNN_清晰主题`. Use `001`, not `01`.
- The title must be specific and searchable. Avoid vague names such as `001_主题`, `002_资料整理`, or `003_平台内容`.
- One result folder contains exactly one primary Markdown file named exactly like the folder.
- One result folder must contain one `raw\` subfolder.
- Put all crawled/search/detail/comment/source files under `raw\`.
- Keep `raw\manifest.json` as provenance and limits; it is not a second user-facing report.
- Do not create extra top-level subfolders inside a dossier. If media is needed, store it under `raw\images\` or `raw\media\`.
- Use descriptive Markdown links in the main document. Long signed URLs can stay in `raw\manifest.json` or raw files.

## Creation Command

Use `scripts\prepare_output.py`:

```powershell
python scripts\prepare_output.py "期货小白从0开始学习指南" --with-raw --platform web --tool "agent-reach"
python scripts\prepare_output.py "金融自动化预测分析平台开发基础" --with-raw --platform "official/GitHub/Reddit" --tool "agent-reach"
python scripts\prepare_output.py "系统设计账号登录注册工程方案" --with-raw --platform "web/GitHub/security-docs" --tool "agent-reach"
python scripts\prepare_output.py "材料碳纤维预浸料工艺资料" --with-raw --platform "web/papers/patents" --tool "agent-reach"
```

`--module`, `--domain`, and `--section` are deprecated compatibility flags. They must not create folders.

## Manifest

`raw\manifest.json` should include:

- folder;
- created_at;
- platform/source;
- title;
- tools;
- source URLs;
- notes or limitations.

## Skill Index And Finalization

Maintain the knowledge index inside the skill, not in the output folder:

```text
<experience-root>\knowledge-index.md
```

After finishing a saved dossier, update it manually or run:

```powershell
python scripts\finalize_run.py "<dossier-folder>" --summary "一句话总结" --worked-query "..." --lesson "..." --next-query "..."
```

The output root and dossier folders must not contain `INDEX.md`. The final Markdown should not include internal deposition sections such as `## 沉淀总结` or "下一轮可以继续深入的主题" unless the user asks for them. Put those lessons into skill memory instead.

## Validation

Run:

```powershell
python scripts\validate_output.py "<folder>" --check-manifest
```

Add `--require-images` only when images are expected or captured under `raw\images\`.

## Handoff

If a run is interrupted, add a short `待继续` section to the Markdown or update `references\handoff.md` when the issue affects the whole skill. Include:

- what was already searched;
- raw files created;
- what remains;
- exact next query or command.
