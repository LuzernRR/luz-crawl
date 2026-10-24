# 安装 LuzCrawl

本目录包含完整 skill、原生采集插件、本地记忆与可直接导入的 browser-extension/。扩展名称、弹窗和标签组均显示 LuzCrawl；兼容的目录和命令 ID 保持 luz-crawl。

1. 保留完整 Skill 目录，例如自己的 ~/.codex/skills/luz-crawl。Node.js 24.5+；当前采集引擎基线 1.8.8、浏览器协议 1.0.24。
2. 运行 `node scripts/luz-crawl.mjs install` 注册本地 opencli/。已有高版本运行时不要静默覆盖，可用 LUZ_OPENCLI_ROOT 指向独立的 1.8.8 安装。
3. 在 Edge 的扩展页开启开发者模式，选择“加载解压缩的扩展”，导入本目录 browser-extension/。Chrome 同理。文件夹内直接有 manifest.json，不能选择上一级 skill 文件夹，也不能直接选择 ZIP。
4. 停用旧桥接扩展副本以免同一资料出现两个连接。旧标签任务先迁移/关闭，个人经验仍保存在本 skill。扩展的安装和浏览器授权按当前工具权限进行，必要时由用户完成一次操作。修改名称或图标后点击 LuzCrawl 的“重新加载”；浏览器调试提示读取已加载扩展的 manifest.name，文件修改不会即时改变旧进程。
5. 运行 doctor，核对 state=ready、extension_connected=true、bundled_loaded=true；再运行一条真实搜索。多个浏览器配置时使用 --profile 选定连接。

未配置偏好时，HTML 结果在当前工作目录 outputs/luz-crawl；已记住的用户路径优先。记忆在本目录 opencli/memory/，单次 --out 不改变默认。升级前保留个人 memory/；不要直接覆盖自己的 preferences/events/pending。node_modules 可能是共享运行时 junction，不能当冗余代码递归删除。

登录/验证出现时最多保留当前人工操作的一页，其他任务保存状态并关闭。运行 `continue TASK_ID` 会切换到该任务，必要时重新打开页面；用户完成操作后继续核验并关闭。不通过复制 Cookie 或账号资料实现迁移。连接成功、文件夹存在、打包成功分别不能证明已登录、已读网页或 Codex 客户端已重载新显示名。

打包命令输出四个 ZIP：完整 skill、Codex 插件、原生采集插件和独立浏览器扩展。每包有 SHA-256 清单。个人记忆、待登录任务、旧资料、node_modules 与原文归档不进分发包；包中的默认记忆按设备创建。Codex 插件清单的 displayName 是 LuzCrawl，skills 目录提供同一完整 skill。

浏览器扩展保留上游 1.0.24 的协议和安全检查，本地化名称、弹窗、标签组与安装说明。协议头、存储键和运行时包标识用于兼容，不作盲目替换。上游为 https://github.com/jackwener/opencli ，Apache-2.0，完整 LICENSE 与修改说明 NOTICE 随扩展保留。

## ZIP 和删除旧副本

- luz-crawl-skill.zip：解压所得 luz-crawl 文件夹为完整 Skill，复制到自己的 skills 目录。
- luz-crawl-codex-plugin.zip：根目录有 .codex-plugin/plugin.json 和同一完整 Skill，按 Codex 插件流程导入。
- luz-crawl-opencli-plugin.zip：原生采集插件；在采集引擎中安装该解压目录，再导入其中 browser-extension。日常使用推荐完整 Skill。
- LuzCrawl-browser-extension.zip：解压后选择直接含 manifest.json 的文件夹；不能选择 ZIP 文件本身。

删除旧浏览器副本：打开 edge://extensions 或 chrome://extensions，找到旧 OpenCLI / Browser Bridge，点击“移除”并确认；保留 LuzCrawl。只停用也能防止重复连接。旧任务先停放保存，不能把未完成任务一并删除。

安装包附 PACKAGE-CHECKSUMS.json，发布 checksums.json 给出各 ZIP 的 SHA-256。PowerShell 可运行 Get-FileHash -Algorithm SHA256 验证下载文件；不要覆盖已安装 Skill 的个人 memory/。
