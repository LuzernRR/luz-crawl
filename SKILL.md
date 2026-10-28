---
name: luz-crawl
description: Search and capture real browser pages with the bundled LuzCrawl extension. Save HTML, source accounts, observed media, interaction counts and loaded comments; download accessible media, reuse local search memory, and resume manual login. Use for social content, technical sites, procurement and analytics dashboards.
---

# LuzCrawl

## 输出目录绑定

独立任务产物默认保存到 `E:\Codex\00_TechDev\Skills输出\luz-crawl`。用户指定的现有项目、续做目录或调用方传入的绝对路径优先；子目录和编号沿用本技能约定，无专用约定时遵循[统一输出规范](../OUTPUT_STANDARD.md)。Skill 源码、安装位置、配置与凭据不随产物目录迁移。

### 单会话输出契约

一次 Codex 会话对应一个 `NNN_主题` 目录；同一会话的搜索、来源、批量任务、登录续接和下载都复用这个目录，不按平台、关键词或来源另建顶层目录：

```text
输出根/
└── 001_主题/
    ├── 001_主题.html       # 唯一最终整理 HTML，raw 的同级文件
    ├── luz-task.json
    └── raw/                 # 只放本次源数据、JSON、快照、媒体和校验清单
```

会话目录根只能有一个 `.html`，文件名必须与目录同名；搜索记录写入 `raw/search-*.json`，批量记录写入 `raw/batch-*.json`，来源 HTML 快照属于 raw 证据。不得把成品 HTML、搜索 JSON 或媒体直接写到输出根。每次搜索结束都刷新同一个成品 HTML；没有读到正文时也生成该文件，并明确记录失败、候选或人工处理状态。

本 Skill → 本目录 opencli/ 采集插件 → browser-extension/ → 真实 Edge / Chrome 页面 → HTML 与 raw 证据 → opencli/memory/。保留完整目录；核心链路不转交其他私人 Skill，不用 HTTP 摘要代替浏览器阅读。

## 开始与搜索

相对路径从本 SKILL.md 解析，命令从本目录运行：

```powershell
node scripts/luz-crawl.mjs doctor
node scripts/luz-crawl.mjs begin "本次需求主题" --new
node scripts/luz-crawl.mjs capture "https://example.com/article"
node scripts/luz-crawl.mjs experience --query "关键词" --platform xhs
node scripts/luz-crawl.mjs collect "主题或 URL" --read 1
node scripts/luz-crawl.mjs search xhs "关键词" --read 1 --comments --download
```

`doctor.ready` 证明连接；`extension_install.bundled_loaded` 核对本目录 LuzCrawl 扩展。登录和正文需要实际页面验收，断连按 [安装文档](references/install.md) 排查具体缺项。

一次会话在同一输出根只创建一个目录。首次 `begin "任务主题" --new` 后保存返回的绝对 `folder`，后续所有命令显式传该路径；重复 begin 不在同一会话和输出根下另建目录。不同会话自动隔离，不从另一会话的活动任务猜测归属；没有会话 ID 的独立终端应先 begin --new，再一直显式使用返回路径。

其他技能调用、跨会话续做或同一会话处理多个项目时，先执行[调用方项目目录契约](references/caller-output-contract.md)：每个项目使用独立采集输出根并保存项目绑定，后续阶段复用原 folder。若使用其他执行者，必须传同一个 folder；缺少路径时先向发起方索取。

```powershell
$taskFolder = (node scripts/luz-crawl.mjs begin "小红书与微信检索" --new | ConvertFrom-Json).folder
node scripts/luz-crawl.mjs search xhs "关键词一" --out $taskFolder
node scripts/luz-crawl.mjs search wechat "关键词二" --out $taskFolder
```

采集、搜索、批量、collect、download、continue 和浏览器动作优先使用显式 `--profile` 或已保存的 browser_profile；保留该 Edge 配置原有登录。后台任务在现有窗口创建非激活标签，结束后只关闭任务标签。未选择配置时，Playwright 静默启动 `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`；浏览器路径、浏览器类型、资料 ID 和是否复用资料分开记录，不能仅凭 exe 路径认定网站已登录。`--headless` 用独立静默资料，不继承原登录。无头启动或页面读取未验证目标正文时，同一来源最多在已保存资料中前台重试一次；遇到登录/验证就保留页面让用户手动处理，续接后核验正文。若来源页明确显示冷却/限流，保存同一页面的原址与提示文字，在已保存浏览器中展示该来源供用户核验后停止该站访问；不再搜索、换入口或重试。只有 HTTP 限流信号而没有可展示来源页时，立即停下并如实说明。操作预算耗尽和取消也不触发重试。正常成功时不新增可见窗口。匿名正文与登录后检索分别验收，不能用 HTTP 200 或搜索外壳代替正文。

默认无头 Edge 配置为 `opencli/memory/browser-profile-edge/`；只有显式设置 `LUZ_HEADLESS_BROWSER=chromium` 才使用已安装的 Playwright Chromium 和 `opencli/memory/browser-profile/`。两类配置均不迁移 Cookie、不打包，登录、续接与采集须使用同一浏览器。具体命令见[静默浏览器安装说明](references/install.md#静默-chromium)。

每次搜索都打开真实浏览器执行新的检索。历史经验只影响路线顺序、关键词建议，不能替代本次访问。优先用户原词，结合已保存偏好和专业词扩展查询，不悄悄改换主题。支持任意合法 HTTP(S) 网站，不把平台目录当作白名单：适配站优先站内搜索；未知域名可直接 `capture URL`、`search example.com "关键词"` 或使用 browser 定位真实站内表单，无需事先登记。`search web "关键词" --site example.com` 是搜索引擎的域名限定查询，不是原站搜索；用户要求原站时不使用该命令替代。只有需要复用时才用 `remember --site` 保存已验证站内模板。候选、页面外壳与已核实详情分开记录。多站并发用 `batch --file jobs.json --concurrency 3 --out TASK_FOLDER`，URL 或 `{id,url,steps}` 数组均可；已登记平台按 ID 排队，其余按完整 hostname 排队，1–4 个站点同时执行。动作含输入/点击时加 `--allow-write`。登录、验证与限流只停对应站点，任务停放后由 `continue` 接续；不另开多个批次扩大同站并发。详见 [批量接口](references/browser-api.md#多站并发)。

主题先按分类工作流规划平台和关键词，以 search --read 0 建候选池；Agent 检查标题和已取得正文是否回答用户问题，剔除广告、培训招生等不符合本次需求的结果后再逐条采集。已明确站点与查询时可用 collect --file plan.json；--platform all 按已验证可用路线逐站执行，不能保证每站或首条结果都相关。链接直接读取来源。collect 默认下载可访问媒体，raw 保存来源与任务，输出一份包含已取得文字、图片、视频和评论的 HTML。手动登录续接后用 report COLLECTION_DIRECTORY 更新合集；不把未取得的内容标为完整。

多站调研必须先思考、建网站池再逐站实测，执行 [网站调研流程](references/site-research.md)。从 [可扩展网站库](references/site-library.json) 选取与成果相关的部分，并主动发现、补充本轮的新站；它不是白名单。任务内 `platform-plan.json` 保存候选与验证进度。招投标、企业、电商统计、创作者后台、设计与素材均优先原站搜索与详情；低信息页面先检查加载、真实控件、分类和分页，不转搜索引擎冒充站内结果。未经验证的候选不进入运行 catalog；page / search / detail / statistics / media 分别验收，并将有证据的路线和失败经验回写网站库。

[平台目录](references/platforms.md)列出适配器与最近验证边界，不限制可访问域名。新域名按通用 DOM 与真实浏览器站内表单逐步扩展，搜索引擎仅在用户允许时用于发现入口；搜索候选不能证明详情正文可读，实测边界见 [验证结果](references/validation.md)。

```powershell
node scripts/luz-crawl.mjs search github "browser automation" --read 1
node scripts/luz-crawl.mjs search csdn "Python 异步" --read 1
node scripts/luz-crawl.mjs search ccgp "计算机" --read 1
node scripts/luz-crawl.mjs search web "关键词" --site "example.com" --read 1
node scripts/luz-crawl.mjs capture "https://example.com/article" --comments --download
node scripts/luz-crawl.mjs batch --file "链接清单.md" --resume
```

搜索结果只算候选；打开原始详情并确认目标正文后才算来源阅读。小红书优先点击真实搜索卡片，保留页面生成的入口；1688 中文检索用浏览器 GBK 表单。GitHub 仓库检索排除 stars/forks/导航，文件、Issue、PR 直接按 URL capture。

## URL 与人工接续

拒绝、空白、无效链接或 404 时核对原地址、落地地址、域名、内容 ID 和错误提示，优先从真实站内入口重进，再尝试已登记的同一内容公开入口。记录错误 URL、修正与实际结果，只有当前浏览器读到目标才记为成功经验。网址可能过期，每次仍复核。

先尝试可关闭的登录提示、公开原文、已登记的旧版公开入口与公开索引。索引只能证明候选存在，不能替代受限原文或后台数据。需要登录、验证码或安全验证时让用户手动完成；不破解验证、不复制凭据、不越过付费与权限控制。

正常完成立即关闭本任务工具页，不能关闭用户原有标签。awaiting_user 保存任务 ID，最多保留一个页面让用户操作，其他任务保存为 parked 并关闭。测试结束也停放人工任务，不能擅自取消。向用户说明具体网站与操作，可用异步问题请求手动完成，同时处理其他独立工作。

```powershell
node scripts/luz-crawl.mjs pending
node scripts/luz-crawl.mjs continue TASK_ID
node scripts/luz-crawl.mjs cancel TASK_ID
```

续接使用已保存的资料和任务，停放任务会重开，其他人工页先保存关闭。成功后核验工具页关闭。显式 --profile 优先于保存的 browser_profile；限流、故障和 URL 错误不误称未登录。

## 保存、下载与记忆

每次采集、搜索、浏览器动作、批量或合集结束后，自动更新本任务唯一成品 `TASK_FOLDER/TASK_FOLDER_NAME.html`；最后检查文件已生成，失败时保留原始结果并运行 `node scripts/luz-crawl.mjs summary TASK_FOLDER` 重建，无需重新访问网站。成品生成前必须读取 [luz-design 文件设计规范全文](../luz-design/references/standards/文件设计规范.html)，并按该规范生成：浅色画布、居中最大宽度、清楚标题层级、16–17px 正文、15–16px 表格、克制卡片和窄屏重排；不加入日期、审计栏、无关建议或重复来源页。来源 URL 作为每条来源的可点击证据链接，裸网址不单独堆成链接清单。`raw/crawl-summary.json` 保存内部采集记录，不另生成总结 HTML；不再生成或依赖 `参考链接.md`，也不自动删除其他任务的历史文件。

按[检索与交付工作流](references/workflows.md)规划 AI赚钱实操、爆款视频、获客系统、爆款文案或宣传设计等内容；这些是成果类型，不再创建额外的分类根目录。检索范围、关键词扩展和逐条原文核验均在当前会话或项目的同一采集目录中完成。

用户可在扩展弹窗保存绝对目录，或用 remember 指定目录；采集前同步最新偏好，本次 `--out` 优先。用户当前默认输出根目录为 `E:\Codex\00_TechDev\Skills输出\luz-crawl`；未配置偏好时回退到当前工作目录 `outputs/luz-crawl`。首次运行一次 `begin "主题" --new`，后续所有阶段复用同一个绝对 folder。目录内的来源分档、搜索结果 JSON、快照和媒体属于该任务 `raw/`，不算新增任务目录；唯一成品固定在 task folder 根。会话和项目输出根共同绑定目录；跨会话续做读取项目已保存的 folder。没有会话 ID 时只在显式 begin 后复用活动记录。其他执行者缺少发起方 folder 时先停止。`manifest.delivery` 保存成品文件名、大小和 SHA-256。已有来源拒绝无提示覆盖；显式 `--resume` 先校验再续接。历史输出迁移使用 `python scripts/migrate_output_layout.py "输出根" --apply`：旧散落文件会进入 `000_历史输出/raw/` 并保留 SHA-256 清单，不删除旧数据。目录偏好未同步时重载 LuzCrawl 扩展。用户要求精简已整理 raw 时，核验来源 URL 和交付 HTML 哈希后再生成、审查清理计划；可移除可复采的页面快照，也可按[源文件精简规范](references/raw-retention.md)用 `--prune-content` 删除已被交付件替代的 `raw/content.json`，保留来源、交付和移除文件哈希。不得把唯一设计图片当作重复快照删除。

post 保存当前目标账号、正文、图片/视频与互动；comments 保存本次加载的条目。隐藏数据为 null，缩写数保留 raw 与 approximate。不要把视频简介称为完整视频、把可见评论称为全量评论。图片、字体和视频通过浏览器扩展下载，下载完成后关闭来源页；不重放平台 API、不用 HTTP 或外部视频下载器替代浏览器。仅对已经下载的音视频分轨使用本地 FFmpeg 合并。失败另报，不导出 Cookie。字段、接口和目录见 [README](README.md) 与 [证据规范](references/evidence.md)。

```powershell
node scripts/luz-crawl.mjs download DIRECTORY
node scripts/luz-crawl.mjs verify DIRECTORY
node scripts/luz-crawl.mjs remember --out "D:\Research\LuzCrawl" --format html
node scripts/luz-crawl.mjs remember --profile "浏览器配置 ID"
node scripts/luz-crawl.mjs remember --platform "xhs,wechat" --keywords "采购,家具"
node scripts/luz-crawl.mjs remember --site "https://example.com" --name example --template "https://example.com/search?q={query}"
```

DIRECTORY 用采集返回的 folder。只有用户明确“记住”才更新长期偏好，单次 --out 不改变默认。新域名可直接搜索；重复使用才登记已验证站内模板，模板必须属于登记域名。记忆保存在 opencli/memory/，不写全局 Codex memories，不保存密码、Cookie 或浏览器资料。分发排除个人 events、pending、legacy、preferences 与归档，仅带便携默认值。

输出根若有散落文件或旧的顶层 `raw/`，新会话须在访问浏览器前停止并列出文件名；运行迁移脚本或人工核对后再重试。任务 `raw/` 可以包含 JSON、媒体、快照和校验清单，但不能放最终整理 HTML；同一用户需求的搜索、来源与失败状态共用一个任务目录，不同需求由主线程显式创建新目录。浏览器未连接、登录等待等失败也在任务目录内留存结果。

## 浏览器接口与验收

[浏览器接口与策略](references/browser-api.md) 使用 JSON 的 read / locate / scroll / type / form / click / submit / wait_for / wait / extract / screenshot，最多 20 步；schema 输出机器可读定义。先 read / locate 取得真实控件，再使用唯一可见 selector 或 role/name。写操作要有用户对目标和内容的授权并显式 --allow-write，用 expect 核验结果；outcome_unknown 只读核验，不重新派发。真实点赞、发送尚无已验收的平台适配器。任意 JavaScript、Cookie 和 shell 不属于该接口。

浏览器、正文资源与下载共用平台节流；读取只对短暂故障作有界退避，写动作一次派发，wait_for 自适应轮询。policy 可查看或保存每站等待与预算。429 / 频繁访问立即保存冷却并停止后续访问，不能换入口规避；登录和安全验证保存人工任务。冷却状态位于 opencli/memory/execution/，不进入安装包。节流降低访问频率，不能保证账号不受限制。

X 长文与状态 ID 对齐、没有展开/加载控件、配图解析完、连续两次正文与资源一致时可走 article_dom_complete，不必滚到回复区；请求评论时继续加载。只从浏览器实际收到的目标响应补齐媒体，不重放私人 API。回复输入框不是长文。

其他页面默认最多 20 次滚动，连续三次到底且无增量才判稳定，预算耗尽为 partial。虚拟列表按 ID 合并；音视频只采页面提供的简介、字幕和可见评论，未提供字幕不自行宣称转录完整。原始快照不能改写。

报告实际 captured / partial / awaiting_user / blocked / failed，分别说明搜索、目标正文、账号/互动字段、评论、下载、文件完整性与关闭状态。verify 只证明 SHA-256；平台介绍页不是后台数据。测试、构建、打包通过不能替代真实平台验收。
