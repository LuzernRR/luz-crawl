# Dossier Type Guide

The luz-crawl output root is:

```text
%USERPROFILE%\Documents\luz-crawl
```

All dossiers are saved directly under this root as `NNN_清晰主题`. This file is only a guide for choosing a clear title and document shape. It does not define output subfolders.

If a task also matches another specialized skill, keep the final `.luz-crawl` deliverable here by default. Only move the final output to another root when the user explicitly requests that destination.

## Title Rules

- Use `NNN_清晰主题`, for example `001_期货小白从0开始学习指南`.
- Put the domain in the title when it helps retrieval, for example `003_系统设计账号登录注册工程方案`.
- Avoid vague titles: `资料库`, `主题`, `方案`, `工具`, `内容整理`.
- Do not create category folders such as `001_主题资料库`, `金融期货`, `系统开发`, or `007_知识沉淀库`.

## Document Types

| Type | Use For | Title Examples |
| --- | --- | --- |
| Topic explainer | Factual answers, background, source maps, comparisons | `001_期货小白从0开始学习指南` |
| Platform content research | Posts, notes, comments, threads, videos, recurring content formats | `003_小红书AI记账产品用户评论整理` |
| Case/repo/product research | Accounts, creators, repos, projects, companies, competitors | `004_GitHub开源量化交易工具对比` |
| Tool/workflow | Exact operations, tools, commands, prompts, reproducible processes | `005_Firecrawl网页抓取流程与问题处理` |
| Full plan/tutorial | End-to-end plans, architecture, implementation recipes, decision frameworks | `006_系统设计账号登录注册工程方案` |
| Inspiration/materials | Images, prompts, templates, visual/content inspiration | `007_社交媒体头像提示词素材整理` |
| Knowledge/search memory | Reusable search experience, keyword maps, routing rules, long-term knowledge | `008_搜索经验Reddit量化交易讨论检索方法` |

## Required Content By Type

### Topic Explainer

- Topic/question.
- Useful conclusions first.
- Source map with links near the end.
- Constraints, conflicts, uncertainty, outdated claims, or limits.

### Platform Content Research

- Platform and query intent.
- Post/article/thread samples with author, link, time, engagement/comments when available.
- Content structure, repeated format, audience reaction, and reusable elements.
- Raw evidence under `raw\`.

### Case/Repo/Product Research

- Identity, homepage/profile/repo URL, and visible metrics.
- Multiple samples when available.
- Positioning, structure, strengths, weaknesses.
- What can be copied and what should not be copied.

### Tool/Workflow

- Tool name, official URL, setup/access path.
- Inputs, outputs, exact steps, costs, permissions.
- Failure modes, limitations, verification, and alternatives.

### Full Plan/Tutorial

- Goal, target user, prerequisites, materials/tools.
- Concrete end-to-end steps.
- Architecture/process design, options compared, selection criteria.
- Decision points, validation checks, risks, and stop/continue criteria.

### Inspiration/Materials

- Source links, creator/source, file provenance.
- Local media under `raw\images\` or `raw\media\` when captured.
- Prompt/template/example text in fenced code blocks when reusable.
- Usage notes, rights/copyright cautions, and adaptation ideas.

### Knowledge/Search Memory

- Search topic or crawler lesson.
- Worked queries and weak queries.
- Platform-native wording and command route.
- False positives, limitations, and next-query seeds.

## Seed Queue

When `%USERPROFILE%\Documents\luz-crawl\链接.txt` exists:

1. Read only `## 未读` as the active queue.
2. Preserve every original line.
3. After processing, move or annotate the line under a dated read section with one of: `已读`, `已输出`, `弱线索`, `排除`.
4. Include the output path or reason.
5. Treat the link as a seed; expand with related searches when the user wants learning or research.
