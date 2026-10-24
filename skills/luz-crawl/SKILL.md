---
name: luz-crawl
description: Search and capture real browser pages with the bundled LuzCrawl extension. Save HTML, source accounts, observed media, interaction counts and loaded comments; download accessible media, reuse local search memory, and resume manual login. Use for social content, technical sites, procurement and analytics dashboards.
---

# LuzCrawl

本 Skill → 本目录 opencli/ 采集插件 → browser-extension/ → 真实 Edge / Chrome 页面 → HTML 与 raw 证据 → opencli/memory/。保留完整目录；核心链路不转交其他私人 Skill，不用 HTTP 摘要代替浏览器阅读。

## 开始与搜索

相对路径从本 SKILL.md 解析，命令从本目录运行：

```powershell
node scripts/luz-crawl.mjs doctor
node scripts/luz-crawl.mjs experience --query "关键词" --platform xhs
node scripts/luz-crawl.mjs collect "主题或 URL" --read 1
node scripts/luz-crawl.mjs search xhs "关键词" --read 1 --comments --download
```

`doctor.ready` 证明连接；`extension_install.bundled_loaded` 核对本目录 LuzCrawl 扩展。登录和正文需要实际页面验收，断连按 [安装文档](references/install.md) 排查具体缺项。

每次搜索都打开真实浏览器执行新的检索。历史经验只影响路线顺序、关键词建议，不能替代本次访问。优先用户原词，结合已保存偏好和专业词扩展查询，不悄悄改换主题。默认串行调用；并行任务也必须分别收尾。

主题优先 collect：Agent 先规划平台和关键词，可用 --file plan.json 指定各站查询；--platform all 按已验证可用路线逐站执行。链接直接读取来源。collect 默认下载可访问媒体，raw 保存来源与任务，输出一份包含已取得文字、图片、视频和评论的 HTML。手动登录续接后用 report COLLECTION_DIRECTORY 更新合集；不把未取得的内容标为完整。

[可用网站](references/platforms.md) 只展示已取得目标正文的公开网站。其他内置路线或新增站点须重新验证，不能从搜索候选或后台外壳推断可用；实测边界见 [验证结果](references/validation.md)。

```powershell
node scripts/luz-crawl.mjs search github "browser automation" --read 1
node scripts/luz-crawl.mjs search csdn "Python 异步" --read 1
node scripts/luz-crawl.mjs search ccgp "计算机" --read 1
node scripts/luz-crawl.mjs search web "关键词" --site "example.com" --read 1
node scripts/luz-crawl.mjs capture "https://example.com/article" --comments --download
node scripts/luz-crawl.mjs batch --file "参考链接.md" --resume
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

用户可在扩展弹窗保存绝对目录，或用 remember 指定目录；采集前同步最新保存的偏好，本次 --out 优先。未配置时为当前工作目录 outputs/luz-crawl。支持 HTML，命名 NNN_原标题.html。输出根目录只放编号 HTML、一个参考链接.md 和一个 raw/；原文快照、评论、截图、媒体、报告证据与安装包在 raw 内。已有来源拒绝无提示覆盖；明确 --resume 时校验后追加当前快照。目录未同步先重载 LuzCrawl 扩展。

post 保存当前目标账号、正文、图片/视频与互动；comments 保存本次加载的条目。隐藏数据为 null，缩写数保留 raw 与 approximate。不要把视频简介称为完整视频、把可见评论称为全量评论。下载在页面关闭后执行，失败另报；不导出 Cookie。字段、接口和目录见 [README](README.md) 与 [证据规范](references/evidence.md)。

```powershell
node scripts/luz-crawl.mjs download DIRECTORY
node scripts/luz-crawl.mjs verify DIRECTORY
node scripts/luz-crawl.mjs remember --out "D:\Research\LuzCrawl" --format html
node scripts/luz-crawl.mjs remember --profile "浏览器配置 ID"
node scripts/luz-crawl.mjs remember --platform "xhs,wechat" --keywords "采购,家具"
node scripts/luz-crawl.mjs remember --site "https://example.com" --name example --template "https://example.com/search?q={query}"
```

DIRECTORY 用采集返回的 folder。只有用户明确“记住”才更新长期偏好，单次 --out 不改变默认。新增网站按域名检索或 remember 登记；模板必须属于登记域名。记忆保存在 opencli/memory/，不写全局 Codex memories，不保存密码、Cookie 或浏览器资料。分发排除个人 events、pending、legacy、preferences 与归档，仅带便携默认值。

## 浏览器接口与验收

[浏览器接口与策略](references/browser-api.md) 使用 JSON 的 read / locate / scroll / type / form / click / submit / wait_for / wait / extract / screenshot，最多 20 步；schema 输出机器可读定义。先 read / locate 取得真实控件，再使用唯一可见 selector 或 role/name。写操作要有用户对目标和内容的授权并显式 --allow-write，用 expect 核验结果；outcome_unknown 只读核验，不重新派发。真实点赞、发送尚无已验收的平台适配器。任意 JavaScript、Cookie 和 shell 不属于该接口。

浏览器、正文资源与下载共用平台节流；读取只对短暂故障作有界退避，写动作一次派发，wait_for 自适应轮询。policy 可查看或保存每站等待与预算。429 / 频繁访问立即保存冷却并停止后续访问，不能换入口规避；登录和安全验证保存人工任务。冷却状态位于 opencli/memory/execution/，不进入安装包。节流降低访问频率，不能保证账号不受限制。

X 长文与状态 ID 对齐、没有展开/加载控件、配图解析完、连续两次正文与资源一致时可走 article_dom_complete，不必滚到回复区；请求评论时继续加载。只从浏览器实际收到的目标响应补齐媒体，不重放私人 API。回复输入框不是长文。

其他页面默认最多 20 次滚动，连续三次到底且无增量才判稳定，预算耗尽为 partial。虚拟列表按 ID 合并；音视频只采页面提供的简介、字幕和可见评论，未提供字幕不自行宣称转录完整。原始快照不能改写。

报告实际 captured / partial / awaiting_user / blocked / failed，分别说明搜索、目标正文、账号/互动字段、评论、下载、文件完整性与关闭状态。verify 只证明 SHA-256；平台介绍页不是后台数据。测试、构建、打包通过不能替代真实平台验收。
