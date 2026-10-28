# 调用方的项目目录

所有调用 LuzCrawl 的技能都遵循本契约。先读当前 `luz-crawl/SKILL.md`；实现入口为该技能目录下的 `scripts/luz-crawl.mjs`，不使用旧插件目录、已移除的 Python 入口或缓存中的过期规范。

## 绑定一次，持续复用

- 独立搜索会话在 LuzCrawl 输出根创建 `NNN_主题/`。被其他技能调用时，先确定调用方的项目绝对路径，以 `<项目目录>/research/luz-crawl/` 作为该项目独立的采集输出根；用户指定位置优先。
- 首次运行一次 `begin "项目主题" --out "项目采集输出根" --new`，保存返回的绝对 `folder`。在调用方 `<项目目录>/raw/luz-crawl-binding.json` 保存 `project_root`、`folder` 和 `html_file`；源数据不能放进技能源码目录。
- 后续会话、阶段、关键词、平台、下载和人工续接均显式传同一个 `folder`。续做先读取项目绑定，不能再次 `begin --new`、改用另一个默认根或从全局活动任务猜目录。
- 不同项目的绑定与采集输出根必须不同。一个会话同时处理多个项目时分别绑定；项目共用的话题或来源也不构成混放理由。若使用其他执行者，只传当前项目已经绑定的 folder。

```text
项目目录/research/luz-crawl/
└── 001_项目主题/
    ├── 001_项目主题.html     唯一最终采集整理 HTML
    ├── luz-task.json
    └── raw/                 检索 JSON、原文、DOM 快照、图片、媒体、状态与哈希
```

`raw/` 与唯一成品 HTML 同级。来源 DOM 的 HTML 快照保留在 raw 内；不再生成单独的总结 HTML、平台报告、关键词报告或版本副本。调用方需要进一步整理时更新这一份成品，遵循 [luz-design 文件设计规范](../../luz-design/references/standards/文件设计规范.html) 全文；更新后同步最终 HTML 的 SHA-256。调用方业务代码、原生办公文档和经授权制作的平台成品按其各自契约保存，本契约约束 LuzCrawl 采集整理包。

```powershell
$LuzRoot = "C:\Users\12860\.codex\skills\luz-crawl"
$ProjectRoot = "<当前项目的绝对路径>"
# 仅首次创建；续做从本项目记录读取 $CrawlFolder。
$CrawlFolder = (node "$LuzRoot\scripts\luz-crawl.mjs" begin "项目主题" --out "$ProjectRoot\research\luz-crawl" --new | ConvertFrom-Json).folder
New-Item -ItemType Directory -Path "$ProjectRoot\raw" -Force | Out-Null
@{ project_root = $ProjectRoot; folder = $CrawlFolder; html_file = (Join-Path $CrawlFolder ((Split-Path $CrawlFolder -Leaf) + '.html')) } | ConvertTo-Json | Set-Content -LiteralPath "$ProjectRoot\raw\luz-crawl-binding.json" -Encoding utf8
node "$LuzRoot\scripts\luz-crawl.mjs" search xhs "关键词" --read 0 --out $CrawlFolder
node "$LuzRoot\scripts\luz-crawl.mjs" capture "https://example.com/article" --out $CrawlFolder
node "$LuzRoot\scripts\luz-crawl.mjs" summary $CrawlFolder
node "$LuzRoot\scripts\luz-crawl.mjs" verify $CrawlFolder
```

收尾核对：绑定属于当前项目；folder 位于本项目指定输出根；根目录只有一份与目录同名的 HTML；`raw/` 存在；候选与实际已读正文分清；最终文件与 manifest 校验一致。失败或待登录也保留同一采集包。写作审核只控制写作成品，不能把内部采集 HTML 当成已批准的文章或发布授权。
