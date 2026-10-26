# 安装与使用

## 安装

1. Node.js 24.5+，安装 `npm install -g @jackwener/opencli@1.8.8`。
2. 克隆 [LuzCrawl 仓库](https://github.com/LuzernRR/luz-crawl)，将其中唯一的 `skills/luz-crawl/` 完整复制到 `~/.codex/skills/luz-crawl/`。从最终 Skill 目录运行 `node scripts/luz-crawl.mjs install`，再运行 `opencli daemon restart`。详细命令见[仓库首页](https://github.com/LuzernRR/luz-crawl#安装)。
3. Edge / Chrome 扩展页 → 开发者模式 → 加载解压缩的扩展 → Skill 内 **browser-extension/**。文件夹中直接有 manifest.json；不能选上一级。停用旧桥接副本。
4. `node scripts/luz-crawl.mjs doctor`：ready 与 bundled_loaded 均为 true。更新扩展后“重新加载”；多个资料用 `--profile ID`。
5. Codex 在新对话使用 `$luz-crawl`。移动 Skill 后重新运行 install，并加载最终路径中的扩展。

仓库只保留这一套分发文件。`scripts/luz-crawl.mjs`、`opencli/commands.js` 和 `browser-extension/dist/` 已完成构建，不需要编译。升级时保留个人 `opencli/memory/`；替换旧 Skill 后恢复该目录，再重新 install 并重载扩展。分发内容不包含个人记忆或 node_modules。高版本运行时可用 `LUZ_OPENCLI_ROOT` 指向独立 1.8.8 安装。

## 使用与下载

### 静默 Chromium

默认实际启动的浏览器为 `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`，通过 Playwright 的 `executablePath` 指定。Edge 基于 Chromium；不会因找不到该文件而改用其它浏览器。

```powershell
node scripts/luz-crawl.mjs doctor --headless
node scripts/luz-crawl.mjs capture "https://example.com/article" --headless --out "E:\Research\LuzCrawl"
node scripts/luz-crawl.mjs headless-login
node scripts/luz-crawl.mjs search x "关键词" --headless --read 1
```

采集、搜索、批量、collect、download、continue 和浏览器动作优先使用 `--profile ID` 或已保存的 browser_profile；后台任务在现有窗口创建非激活标签，关闭时保留用户其他标签。未选配置时静默启动上述 Edge；`--headless` 显式使用独立配置。一个 batch/collect 命令内复用同一浏览器。首次静默启动按当前 Edge 取得桌面 User-Agent 并缓存；可执行文件更新后重新取得。继承 HTTPS_PROXY / HTTP_PROXY / ALL_PROXY 中的代理，不输出凭据。

需要本地 Playwright 和上述已安装的 Edge；可使用 Codex 随附运行时，或用 `LUZ_PLAYWRIGHT_MODULE` 指向现有 Playwright 入口。保留此 Skill 的 browser-extension/。不自动安装、不上传浏览器配置。

已有登录的 Edge 可用 `--profile ID` 连接；经用户明确要求后用 `remember --profile ID` 保存选择。登录信息属于用户配置，同一 exe 配不同资料不代表复用登录。独立静默资料位于 `opencli/memory/browser-profile-edge/`，不复制、不提交、不打包，也不与用户 Default 混用。无法公开读取时，已连接配置会选中任务页并恢复窗口供手动登录；独立静默配置使用 `headless-login TASK_ID`，用户完成并关闭后再 `continue TASK_ID`。配置被占用时先结束对应任务，不删除活动锁。更新后重载扩展；静默启动也会主动重载，避免运行旧缓存脚本。

默认即为上述 Edge。只有显式选择 Playwright 自带 Chromium 时才设置：

```powershell
$env:LUZ_HEADLESS_BROWSER = 'chromium'
node scripts/luz-crawl.mjs capture "https://example.com/article" --headless
```

显式 Chromium 路线另需 Playwright 对应的 Chromium，资料在 `opencli/memory/browser-profile/`。两类配置均不迁移现有浏览器 Cookie。该环境变量也适用于原生 OpenCLI 的 `--headless` 命令；后续登录、续接与采集须选同一浏览器。移除环境变量可恢复默认 Edge。

```powershell
node scripts/luz-crawl.mjs search xhs "关键词" --read 1 --comments --download
node scripts/luz-crawl.mjs capture "https://example.com/article" --comments --download
node scripts/luz-crawl.mjs download "E:\Research\LuzCrawl\raw\001_原标题"
```

补下载目录使用返回的 folder。复制给 Agent：

> 使用 $luz-crawl 抓取这条链接：粘贴 URL。保存 HTML 到 E:\Research\LuzCrawl，下载帖子图片与可访问视频，记录作者、互动数与已加载评论。遇登录让我手动完成，结束后关闭工具页。

## 保存目录

扩展弹窗 → 默认保存目录 → 绝对路径 → 保存；下一次命令 / Agent 采集生效。也可：

```powershell
node scripts/luz-crawl.mjs remember --out "E:\Research\LuzCrawl" --format html
```

本次 `--out` 优先，其次浏览器 / 命令最新保存的目录，未设置为 outputs/luz-crawl。可设置的输出根目录为 `<OUTPUT_ROOT>`；每个会话任务或用户需求只新建一个 `raw/NNN_任务名称/`，该任务的多次搜索、页面、索引、报告和来源证据都归档在同一目录。主线程开始新需求时只运行一次 `begin "主题" --new` 并把 folder 传给每条命令和委派 Agent；活动任务登记供其他线程复用，Agent 不自行运行 `begin`。只有主线程开始另一项新需求时才用 `--new`。raw 根目录只放子文件夹，新目录带序号和名称，历史目录可保留原名。`--out` 指向普通目录时在其下使用 `raw/`，指向名为 `raw` 的目录时直接在其下归档。单页 capture 的来源证据保存在任务目录的子目录，新任务的交付 HTML 保留在分类输出根，与 raw 同级；`--out` 指向任务 folder 或 raw 根也遵循此约定。历史任务仍按原路径读取。分类规则见 [分类工作流](workflows.md)。单次 `--out` 不改变偏好；原有来源用 `--resume` 校验后续接。清理已归档文件前先核验来源、交付件和文件哈希，并审查清理计划。

## 登录与关闭

`pending` 查看待办，手动完成后 `continue TASK_ID`；明确取消用 `cancel TASK_ID`。最多保留一页供手动操作，其余任务停放关闭。正常完成关闭工具页，保留用户原有标签。

## 浏览器动作

保存 actions.json：

```json
[
  { "action": "read" },
  { "action": "scroll", "direction": "down", "amount": 600 },
  { "action": "screenshot" }
]
```

```powershell
node scripts/luz-crawl.mjs browser "https://example.com" --file actions.json
```

最多 20 步；也支持 --steps JSON 或 --file - 从标准输入读取。click / type / form / submit 要有明确授权并加 --allow-write；用 expect 核验，结果未知时不重放。schema 输出全部动作；policy 查看平台节流，policy --file policy.json 保存覆盖配置。[完整 API 与降级规则](browser-api.md)。密码手动输入，真实点赞与发送尚未验收。未列出的合法网站可以按 hostname 搜索或直接 capture；登录与验证交用户手工完成。平台来源页明确展示冷却时会保留并展示同一来源页及提示证据，然后停止站内请求，不切换搜索入口；纯 HTTP 429 则保存响应原因并立即停止。

## 排错

- 断连：扩展路径、旧副本、daemon、--profile；更新后重载扩展。
- 目录未同步：重载 LuzCrawl，再运行采集；本次 --out 优先。
- partial：查看 limitations。404、限流、下载失败不等于未登录。
- 删除旧扩展：扩展管理页 → 旧 OpenCLI / Browser Bridge → 移除；保留 LuzCrawl 与停放任务。

LuzCrawl 项目与扩展版本为 2.7.0，底层桥接协议保持 1.0.24；上游标识与 Apache-2.0 法律文件保留。2.7.0 修改了扩展命令日志，更新文件后需用户在扩展管理页手动重新加载 `browser-extension/`，再运行 doctor 确认实际连接版本为 2.7.0。仅替换 Skill 文件不会更新已运行的扩展。
