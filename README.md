<p align="center"><img src="assets/logo.png" width="180" alt="LuzCrawl"></p>
<h1 align="center">LuzCrawl</h1>
<p align="center">给一个链接或主题，得到一份含图文与视频的 HTML<br><sub>v2.7.0 · 多站后台并发，登录与验证停放后接续 · Skill + 扩展 + 本地记忆</sub></p>
<p align="center"><a href="https://github.com/LuzernRR/luz-crawl/releases/latest">下载</a> · <a href="#安装">安装</a> · <a href="#使用">使用</a> · <a href="#保存目录">保存目录</a> · <a href="#可用网站">可用网站</a></p>
<p align="center"><img src="assets/readme-workflow.svg" width="720" alt="浏览器搜索 → 原文采集 → 归档与记忆"></p>

## 安装

**1. 下载完整 Skill，放入 Agent 的技能目录。** [下载 ZIP](https://github.com/LuzernRR/luz-crawl/releases/latest/download/luz-crawl-skill.zip)，或在 Windows PowerShell 运行：

```powershell
Invoke-WebRequest "https://github.com/LuzernRR/luz-crawl/releases/latest/download/luz-crawl-skill.zip" -OutFile luz-crawl-skill.zip
Expand-Archive luz-crawl-skill.zip -DestinationPath "$env:USERPROFILE\.codex\skills"
cd "$env:USERPROFILE\.codex\skills\luz-crawl"
npm install -g @jackwener/opencli@1.8.8
node scripts/luz-crawl.mjs install
opencli daemon restart
```

**2. 安装浏览器扩展。** 打开 `edge://extensions` / `chrome://extensions` → 开发者模式 → 加载解压缩的扩展 → 选择 **browser-extension/**（直接包含 `manifest.json`）。停用旧桥接扩展，运行：

```powershell
node scripts/luz-crawl.mjs doctor
```

`ready: true`、`extension_install.bundled_loaded: true` 即连接成功。更新扩展后点击“重新加载”。

**3. 新对话中使用 `$luz-crawl`。** 需要 Node.js 24.5+。完整目录同时包含 Skill、采集插件、浏览器扩展与记忆模块；[其他安装包与源码安装](references/install.md)。更新时保留原有 `opencli/memory/`。

**音视频分轨合并：** 仅需要安装 [FFmpeg](https://ffmpeg.org/download.html) 并核对：

```powershell
ffmpeg -version
```

## 使用

采集、搜索、批量、collect、download、continue 和浏览器动作优先复用所选 Edge 配置的登录信息，通过现有窗口中的非激活标签执行任务；只关闭任务标签。可用 `--profile ID` 选择连接，已保存的 browser_profile 自动生效。未选择配置时静默启动 Edge；显式 `--headless` 使用独立配置，它不继承已有登录。扩展读取真实 DOM 并下载媒体，不重放平台 API，不调用外部视频下载器。无法跳过登录或验证时显示对应任务页，用户完成后接续。详见[静默浏览器](references/install.md#静默-chromium)。

从 Skill 目录运行：

```powershell
# 给主题：自动选择平台，搜索、读取、下载，汇总一份 HTML
node scripts/luz-crawl.mjs collect "浏览器自动化工具"

# 给链接：打开原文，采集图文、视频与已加载评论
node scripts/luz-crawl.mjs collect "https://example.com/article"

# 全部可用平台，或只指定几个平台；--read 为每站读取数
node scripts/luz-crawl.mjs collect "人工智能" --platform all --read 1
node scripts/luz-crawl.mjs collect "Python" --platform github,csdn,bing --read 2

# 从已保存的来源补下载媒体；使用采集结果里的 folder
node scripts/luz-crawl.mjs download "E:\Research\LuzCrawl\raw\001_原标题"
```

**复制给 Agent：**

> 使用 $luz-crawl 调研“浏览器自动化工具”。先规划平台和关键词，再逐站打开浏览器搜索、读取原文、下载可访问图片和视频。raw 保存原始数据，整理一份含文字、图片、视频、账号、赞评藏和已加载评论的 HTML 到 E:\Research\LuzCrawl。遇验证让我手动完成，用完关闭工具页。

> 使用 $luz-crawl 下载这条链接：粘贴 URL。保存图文、可访问视频和已加载评论，整理 HTML 到 E:\Research\LuzCrawl。

| 操作 | 命令（接在 `node scripts/luz-crawl.mjs` 后） |
| :--- | :--- |
| 只搜索小红书 | `search xhs "关键词" --read 1 --comments --download` |
| 链接合集 | `collect "链接合集" --file "链接清单.md"` |
| 多页并发 | `batch --file jobs.json --concurrency 3 --out TASK_FOLDER` |
| Agent 的平台 / 关键词计划 | `collect "主题" --file plan.json` |
| 待登录任务 / 继续 | `pending` / `continue TASK_ID` |
| 登录续接后更新合集 | `report COLLECTION_DIRECTORY` |
| 取消指定待办 | `cancel TASK_ID` |
| 校验来源文件 | `verify DIRECTORY` |

`collect` 默认下载媒体并读取评论；`plan.json` 使用 `[{"platform":"github","query":"browser automation"}]`。每次执行都重新打开浏览器搜索，经验只优化路线与关键词。登录 / 验证由用户手动完成，用完关闭工具页。

`batch` 接收 URL 数组、含 URL 的文本，或 `[{"id":"查询","url":"https://example.com","steps":[{"action":"read"}]}]`。默认同时执行 3 个站点，范围 1–4；已登记平台按平台 ID 排队，其他站按完整 hostname 排队。每页用独立任务标签，共用一个 `--out`；遇登录、验证或限流只停该站后续任务，其他站继续。批量任务停放后用 `continue TASK_ID` 手动接续。包含输入或点击时须加 `--allow-write`；[计划、返回值与验收](references/browser-api.md#多站并发)。`collect` 仍按原流程执行，需要并发时显式用 `batch`。

## 保存目录

按成果选择分类，五类工作流、关键词扩展及验收见 [分类工作流](references/workflows.md)。一次会话只用一个编号主题目录；`raw/` 保存证据，最终整理 HTML 放在 `raw/` 同级且只有一个。


**在扩展中：** 打开 LuzCrawl 弹窗 → 默认保存目录 → 输入绝对路径 → 保存。后续命令和 Agent 采集自动使用该目录。

**用命令记住目录：**

```powershell
node scripts/luz-crawl.mjs remember --out "E:\Research\LuzCrawl" --format html
```

**只改变本次：** 在 `collect / search / capture` 后加 `--out "E:\Research\本次"`。

优先级：本次 `--out` → 浏览器 / 命令最新保存的目录 → `outputs/luz-crawl/`。输出固定为：

```text
luz-crawl/
├── 001_任务名称/
│   ├── 001_任务名称.html   # 唯一最终整理 HTML
│   ├── luz-task.json
│   └── raw/                 # 评论、截图、媒体、快照、搜索 JSON 与校验清单
└── 002_另一主题/
    ├── 002_另一主题.html
    └── raw/
```

采集结束自动更新本任务唯一成品 `TASK_FOLDER/TASK_FOLDER_NAME.html`，按 luz-design 文件规范使用浅色画布、居中最大宽度、清楚层级、可读正文和窄屏重排；不再生成 `参考链接.md`。从证据重建：`node scripts/luz-crawl.mjs summary TASK_FOLDER`。

每个会话使用一个 `NNN_主题/`，根目录仅有一份同名 HTML 和 `raw/` 源数据目录。首次 begin 后把返回的 folder 传给所有搜索、采集、批量、下载与续接；重复关键词不新建目录，不同会话不误用其他活动任务。其他技能调用时遵循[调用方项目目录契约](references/caller-output-contract.md)，每个项目独立绑定输出根和 folder，跨会话继续使用已保存路径。检索与批量 JSON、采集总结 JSON、来源 DOM 快照、媒体和校验清单都在 raw 内；来源 HTML 只是证据，不是额外成品。summary 从现存证据重建同一份 HTML，report 更新已有合集，均不产生第二份成品。最终排版遵循 [luz-design 文件规范](../luz-design/references/standards/文件设计规范.html)。HTML 内嵌已下载图片，视频使用 raw 中的相对路径；移动时保留完整任务目录。用户编辑、额外 HTML 或校验不通过时停止覆盖。历史散落输出可用 `python scripts/migrate_output_layout.py "输出根" --apply` 归档，保留 SHA-256 清单。

目录、格式、平台和关键词偏好用 `remember` 保存；新网站可登记。记忆位于 `opencli/memory/`，不进入发布包。

## 可用网站

以下只展示 **已取得目标正文的 29 个网站**（公开样本验证：2026-10-24）。

| 类别 | 网站 | 可采集内容 |
| :--- | :--- | :--- |
| 图文 / 视频 | 小红书 · X · 知乎 · 豆瓣 · Reddit · 抖音 · 哔哩哔哩 · TikTok · YouTube | 目标正文 / 简介、账号与可访问媒体；逐站范围见下表 |
| 公开页面 | 微信公众号 · 微博 · Instagram | 公开文章 / 帖子文字 |
| 技术 | GitHub · Gitee · CSDN · 博客园 · 掘金 · Stack Overflow · DEV Community · Hacker News · V2EX | 公开仓库、文章、问题与可见讨论 |
| 搜索 | Google · Bing | 浏览器检索与来源发现 |
| 招投标 | 中国政府采购网 · 全国公共资源交易平台 · 中国国际招标网 · 千里马招标网 · 采招网 | 公开公告正文 |
| 采购 | 中国制造网 | 公开商品列表 |

网站地址、命令 ID 与实际范围见 [可用网站列表](references/platforms.md)。未读到正文的站点不列为可用；新网站可登记后再验证。

另有 [214 个公开入口的网站库](references/site-library.json)，覆盖采购、企业、工程、电商数据、官方创作者、趋势、设计与素材。它包含候选及失败记录；`probe.completed` 仅表示历史操作结束，页面、搜索、详情、统计、媒体由 `verification` 分别验收。先准备网站池，再补充本轮发现的新站，按[网站调研流程](references/site-research.md)逐项核验。

## 数据与下载

- **图文 / 社交：** 当前账号、正文、可见互动数、已加载评论与页面提供的媒体；隐藏字段为 `null`，缩写数保留近似标记。
- **技术 / 公告：** 浏览器可见正文、链接及已加载讨论；GitHub 保存页面内容，不克隆整个仓库。
- **下载：** 图片与可访问视频经浏览器扩展保存到 `raw/`；单图 25 MiB、单视频 250 MiB。页面提供的音视频分轨下载后，用本地 FFmpeg 合并。浏览器未提供的流保留为缺项。

抖音、小红书、B 站、TikTok、YouTube 已验证视频文件与 HTML 播放；小红书图文和 Reddit 图片已验证。评论仅本次实际加载；封面与视频、简介与字幕分别记录。失败和缺项保留为 `partial`。[字段](references/evidence.md) · [实测记录](references/validation.md)

## 浏览器接口

支持定位、阅读、滚动、表单、点击、提交、条件等待、提取和截图。将动作保存为 `actions.json`，运行：

```powershell
node scripts/luz-crawl.mjs browser "https://example.com" --file actions.json
node scripts/luz-crawl.mjs schema
node scripts/luz-crawl.mjs policy
```

最多 20 步。`click / type / form / submit` 需明确用户授权与 `--allow-write`，用 expect 核验效果；结果未知时不自动重放。读取有限退避重试，平台节流与冷却跨调用保存，429 后停止访问。真实点赞 / 发送尚未验收。[动作、JSON Schema 与策略配置](references/browser-api.md)

## 开发与许可

```powershell
node --test tests/*.test.mjs
python scripts/package.py --out outputs/packages
```

原创代码与 Skill 使用 [PolyForm Noncommercial](LICENSE)，商业用途需 [另行授权](https://github.com/LuzernRR)。上游扩展保留 [Apache-2.0](browser-extension/LICENSE)；来源内容权利由原作者保留。[第三方说明](THIRD_PARTY_NOTICES.md) · [贡献](CONTRIBUTING.md) · [安全](SECURITY.md) · [更新记录](CHANGELOG.md)
