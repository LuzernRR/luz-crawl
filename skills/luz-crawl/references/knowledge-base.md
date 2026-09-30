# Knowledge Base

Use this before saving durable knowledge or updating accumulated experience.

## Goal

Build a growing private knowledge base under persistent runtime state:

```text
<experience-root>
```

Each run should make future runs better. Save the useful result under `%USERPROFILE%\Documents\luz-crawl`, preserve raw evidence in that dossier's `raw\`, and record both search experience and reusable domain lessons in persistent `<experience-root>`. Think of every run as five layers:

- Raw evidence: raw search/detail/comment files and manifest.
- Task dossier: the user's current answer, source map, and conclusions.
- Durable knowledge: reusable fields, flows, checklists, risks, patterns, anti-patterns.
- Retrieval experience: which queries, routes, and source types worked or failed.
- Search skills: reusable channel/tool tactics, Agent Reach/Firecrawl routes, image/media handling, and failure recovery.

## Storage Model

Use this hierarchy:

```text
%USERPROFILE%\Documents\luz-crawl\
  001_期货小白从0开始学习指南\
    001_期货小白从0开始学习指南.md
    raw\
      manifest.json
  002_金融自动化预测分析平台开发基础\
    002_金融自动化预测分析平台开发基础.md
    raw\
      manifest.json

<experience-root>\
  knowledge-index.md
  search-keywords.md
  search-skill-library.md
  knowledge-base-seeds.md
```

Use `scripts\prepare_output.py "<清晰主题>" --with-raw`.

Use `scripts\finalize_run.py` after every meaningful run. Saved runs pass the dossier folder; chat-only runs pass `--run-label`. The script writes an idempotent event to the persistent ledger and atomically rebuilds the Markdown projections. Do not create `INDEX.md` under the output root or inside output folders.

Useful title prefixes:

- `系统设计...`
- `前端...`
- `后端...`
- `数据库...`
- `UI设计...`
- `工程化...`
- `安全...`
- `AI数据...`
- `材料...`
- `工业制造...`
- `供应链...`
- `商业产品...`
- `政策合规...`

## When To Save

Save a dossier when:

- the user asks to search/research/collect/compare;
- the topic is reusable later;
- the answer involves system design, implementation choices, security, standards, or process knowledge;
- multiple sources were searched;
- new search keywords, risks, fields, architecture choices, or anti-patterns were discovered.

For trivial one-line questions, answer in chat unless the user asks to save.

## Durable Lesson Update

After each meaningful run:

1. Save the full dossier directly under the root as `NNN_清晰主题`.
2. Keep the user-facing dossier focused on useful conclusions, evidence, steps, risks, and references; do not append `## 沉淀总结` or "下一轮可以继续深入的主题" unless the user explicitly asks.
3. Deposit a stable event into `<experience-root>\events.jsonl` through `finalize_run.py`.
4. Let the event store rebuild `<experience-root>\knowledge-index.md`, `search-keywords.md`, and `search-skill-library.md` atomically.
5. Verify important tool/channel/image/failure/fallback lessons are present and queryable.
6. If the lesson is broadly reusable, create or update another root-level dossier with a clear knowledge title, or keep it under `<experience-root>` when it is internal search/tool memory.
7. Put raw evidence in the original dossier's `raw\` folder.

## Closing Deposition Protocol

At the end of each saved run, answer these questions:

- What knowledge can be reused across future tasks?
- What fields, architecture, process, checklist, or decision rule was learned?
- What search queries worked best?
- What search routes produced noise or weak evidence?
- Which Agent Reach/Firecrawl/platform tool path worked, failed, or needs a fallback?
- Were images/screenshots/media saved, recognized, or blocked?
- Which sources were authoritative, practical, or risky?
- What should be searched first next time?
- Should anything be promoted into `<experience-root>\knowledge-base-seeds.md`, `<experience-root>\knowledge-index.md`, or a future root-level knowledge dossier?

Use this internal note shape when depositing into persistent experience or a root-level knowledge dossier. Do not append it to ordinary user-facing dossiers:

```markdown
## 沉淀总结

- 本次可复用知识：
- 本次有效检索：
- 本次无效/噪声检索：
- 工具/渠道经验：
- 图片/媒体经验：
- 新增风险/反例：
- 可沉淀到知识库：
- 下次优先检索：
```

Then run or manually apply:

```powershell
python scripts\finalize_run.py "<dossier-folder>" --summary "一句话总结" --worked-query "..." --weak-query "..." --tool "agent-reach/opencli" --channel "小红书" --tool-problem "..." --tool-fix "..." --lesson "..."
```

For chat-only research:

```powershell
python scripts\finalize_run.py --run-label "<topic>" --run-id "<stable-id>" --summary "一句话总结" --worked-query "..." --tool "..." --lesson "..."
```

## Engineering Knowledge Shape

For engineering-grade knowledge, include:

```markdown
## 可复用结论

## 生产级要求
- 安全：
- 数据：
- 前端：
- 后端：
- 运营/风控：
- 商业化：

## 字段/模型清单

## 核心流程

## 防绕过与反滥用

## 必须避免的问题

## 验证与测试

## 来源与证据

## 下次检索关键词
```

## Quality Bar

Do not save shallow notes as durable knowledge. Durable knowledge must have:

- at least one primary/official/source-of-truth reference when available;
- at least one real-world implementation, issue, incident, or community discussion when useful;
- explicit constraints and failure modes;
- concrete fields, flow, checklist, or decision criteria;
- clear limits and next searches.

## Knowledge Evolution

When new evidence contradicts old knowledge:

- do not overwrite silently;
- add a dated `更新记录`;
- explain what changed and why;
- link to the new dossier/source;
- keep old caveats if they may still apply to older versions, regions, or contexts.

## Source Lessons From Research

The useful external patterns are:

- Long-term agent memory should distinguish short task context from durable memory; durable memory can be semantic facts, episodic lessons, and procedural instructions.
- RAG-style knowledge bases need metadata, source provenance, update time, and retrieval-oriented titles/tags, not just dumped documents.
- Engineering postmortems are useful even without incidents: record what happened, what was learned, action items, and owners/next checks.
- Local-first knowledge graphs/agent memory projects emphasize durable, searchable notes with backlinks/tags and source evidence.
