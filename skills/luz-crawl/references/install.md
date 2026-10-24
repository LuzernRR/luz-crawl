# 安装与使用

## 安装

1. Node.js 24.5+，安装 `npm install -g @jackwener/opencli@1.8.8`。
2. 保留完整 Skill：复制 `luz-crawl-skill.zip` 解压后的 luz-crawl 到 `~/.codex/skills/luz-crawl/`，或使用完整仓库 / Codex 插件包。从最终 Skill 目录运行 `node scripts/luz-crawl.mjs install`，再运行 `opencli daemon restart`。
3. Edge / Chrome 扩展页 → 开发者模式 → 加载解压缩的扩展 → Skill 内 **browser-extension/**。文件夹中直接有 manifest.json；不能选上一级或 ZIP。停用旧桥接副本。
4. `node scripts/luz-crawl.mjs doctor`：ready 与 bundled_loaded 均为 true。更新扩展后“重新加载”；多个资料用 `--profile ID`。
5. Codex 在新对话使用 `$luz-crawl`。移动 Skill 后重新运行 install，并加载最终路径中的扩展。

| 安装包 | 用法 |
| :--- | :--- |
| luz-crawl-skill.zip | 完整 Skill，推荐；复制整个 luz-crawl 文件夹 |
| luz-crawl-codex-plugin.zip | 根目录有 .codex-plugin/plugin.json 与完整 Skill；按客户端插件流程安装 |
| luz-crawl-opencli-plugin.zip | `opencli plugin install "解压目录"`，再导入其中 browser-extension/ |
| LuzCrawl-browser-extension.zip | 独立浏览器扩展；解压后选择直接有 manifest.json 的文件夹 |

升级保留个人 `opencli/memory/`，不要覆盖 preferences / events / pending。发布包不包含个人记忆或 node_modules。高版本运行时可用 `LUZ_OPENCLI_ROOT` 指向独立 1.8.8 安装。

## 使用与下载

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

本次 `--out` 优先，其次浏览器 / 命令最新保存的目录，未设置为 outputs/luz-crawl。结果仅编号 HTML、参考链接.md、raw/。单次 --out 不改变偏好；原有来源用 --resume 校验后续接。

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

最多 20 步。click / type 需唯一可见 selector，type 还需 text；调用前取得对目标与内容的明确授权，并加 --allow-write。点击仅触发一次事件，后续 read 核验；密码手动输入，不接受任意 JavaScript / Cookie 导出 / shell。真实点赞与发送尚未验收。

## 排错

- 断连：扩展路径、旧副本、daemon、--profile；更新后重载扩展。
- 目录未同步：重载 LuzCrawl，再运行采集；本次 --out 优先。
- partial：查看 limitations。404、限流、下载失败不等于未登录。
- 删除旧扩展：扩展管理页 → 旧 OpenCLI / Browser Bridge → 移除；保留 LuzCrawl 与停放任务。

浏览器桥接协议保持 1.0.24；上游标识与 Apache-2.0 法律文件保留。下载包使用 checksums.json / PACKAGE-CHECKSUMS.json 校验；`Get-FileHash -Algorithm SHA256` 核对文件。
