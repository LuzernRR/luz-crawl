# 浏览器操作 API · 1.0.0

LuzCrawl 2.7.0。供 Agent、脚本和其他模型使用；每次调用返回 JSON。所有动作先校验，再在后台打开本任务页面。单页正文不完整时会在已保存的浏览器配置中前台重试一次；前台结果仍不完整时保留页面和续接任务，并标记 partial；限流、冷却、预算耗尽和取消不会触发回退。batch 使用后台停放模式，不自动转前台。

```powershell
node scripts/luz-crawl.mjs schema
node scripts/luz-crawl.mjs browser "https://example.com" --file actions.json --allow-write
Get-Content actions.json -Raw | node scripts/luz-crawl.mjs browser "https://example.com" --file - --allow-write
```

也可传 `--steps JSON`，与 `--file` 二选一。单次 1–20 步；`click / type / form / submit` 要有用户对目标和内容的授权，再加 `--allow-write`。密码与验证码交给用户。

## 动作

| 动作 | 参数与结果 |
| :--- | :--- |
| `read` | 可选 selector / target、max_chars；返回可见文字与前 40 个控件 |
| `locate` | 可选 selector / target；返回候选、可复用选择器、视口与文档坐标 |
| `click` | 唯一可见目标；检查遮挡后派发一次 DOM 点击；同步 window.open 的 HTTP(S) 目标在同一任务页导航 |
| `type` | 唯一输入框与 text；触发 input / change |
| `form` | 表单 selector / target、fields；先检查全部字段，再填文本、下拉或勾选 |
| `submit` | 唯一表单，可选 submitter 选择器；校验必填项后提交一次 |
| `scroll` | direction / amount；支持容器，或目标 + into_view |
| `wait_for` | 等待 visible / hidden / text / value / url；支持 stable 1–3 次确认 |
| `wait` | ms 1–30000；受任务总时间预算约束 |
| `extract` | 可选 comments；一次返回正文快照与滚动位置 |
| `screenshot` | 可选 full_page；图片写入 raw/browser-actions/ |

目标使用 `"selector":"#search"`，或 `"target":{"role":"button","name":"搜索"}`。可写目标必须唯一、可见、可操作；位置用于定位与核查。跨域 iframe、封闭 Shadow DOM、canvas 和只接受可信输入事件的控件可能需要人工操作。

## 表单搜索

actions.json：

```json
[
  {"action":"read"},
  {"action":"form","selector":"#search","fields":[
    {"selector":"input[name=q]","value":"开源工具"},
    {"selector":"select[name=scope]","value":"public"}
  ]},
  {"action":"submit","selector":"#search","expect":{
    "selector":"#results","condition":"visible","timeout_ms":8000
  }},
  {"action":"read","selector":"#results"}
]
```

先 read / locate 取得真实控件，再填表。示例选择器要换成目标页实际返回的值。点击或提交使用 expect 确认结果；一次条件轮询可同时检查文字、可见性和当前位置，避免反复截图。

搜索会同步调用 window.open 时，click 临时截获地址，恢复原函数，再由导航层校验 URL 并在任务标签打开，避免结果页脱离任务；若请求多个页面则停止。异步弹窗、先开空白窗后写入、原生表单 target 新窗口流程仍需人工核查；不能仅据 event_dispatched 判定跳转或查询成功。

## 多站并发

从同一个任务目录执行，Skill 与原生插件接口一致：

```powershell
node scripts/luz-crawl.mjs batch --file jobs.json --concurrency 3 --out TASK_FOLDER --profile PROFILE_ID
opencli luz-crawl batch --file jobs.json --concurrency 3 --out TASK_FOLDER --profile PROFILE_ID
```

jobs.json 可为 URL 数组，或带步骤的任务数组：

```json
[
  {"id":"site-a","url":"https://example.com/","steps":[{"action":"read"},{"action":"extract"}]},
  {"id":"site-b","url":"https://example.org/"}
]
```

也支持含 URL 的文本文件。全部1–500项先校验，通过后才开页；未知字段、非法 URL、无授权的写动作整批拒绝。步骤同 browser 的1–20步限制，包含 click / type / form / submit 时加 --allow-write。依赖搜索结果的详情另生成下一批，不猜详情 URL。

默认3、允许1–4个站点同时执行；已登记平台按平台ID共用队列，未知站按完整hostname排队，因此不同子域可能是不同队列。限制只对本次batch有效；Agent 不同时启动额外批次放大同站负载。每项独立浏览器任务，共用已确定的out，使用已有profile时复用其登录。每站内顺序执行，每次完成原子写入 batch_file；记录保持输入顺序，含 id、started_at、finished_at、status、stop_reason、browser及原有页面结果。程序中断后只把已落盘条目视为已记录，不自动重放未知结果的写操作。

批量 status=completed 表示每项为 captured/completed，其他情况 partial；这不等于所有查询、详情和统计均已验收。单页动作值在 `.results[].results[].value`，提取为 action=extract 的value；动作 completed 只代表派发与显式expect完成。应另验结果区域、实际相关卡片、详情正文、统计口径与字段。首页、页脚、样例、0条结果均按实际内容记录。

登录/验证会保存task_id、关闭并park页面；限流保留冷却；只跳过对应队列的后续项（skipped / site_blocked），其他站继续。若任务标签关闭未确认，也暂停该队列。批量不会自动显示或前台重试。用pending查看，再continue TASK_ID重新打开供人工操作；续接不会自动重跑本批跳过的项，应观察当前状态后另作计划。

## 返回与续接

返回包含 `api_version`、`version`、`status`、`stop_reason`、`plan_sha256`、`next_action_index`、每步 results 与 execution。execution 记录操作数、重试数、等待时长和事件；browser 记录任务页关闭情况。completed 不能代替目标内容验收；每步数据取 results[].value，不是 result。

| 情况 | 处理 |
| :--- | :--- |
| 短暂超时、连接中断、HTTP 5xx | 只重试幂等读取，默认最多两次尝试 |
| 选择器缺失 / 歧义、无效表单 | 停止，先读取页面纠正目标 |
| 登录 / 验证 | awaiting_user；保存任务，手动完成后 continue TASK_ID |
| 写操作结果未知 | outcome_unknown；只读核验 expect，不能重放写操作 |
| HTTP 429 / 频繁访问页 | 保存冷却并停止该站；有实际来源页面时展示同页证据供用户核验，无可展示页面时报告具体 HTTP 信号 |
| 操作 / 时间预算耗尽 | 停止后续派发；已取得证据保留为 partial |

continue 使用保存的动作计划哈希与游标，跳过已完成步骤。未知写结果会保存 pending_verification；预期结果未证实时停止，不能自动重新点击或提交。任务停放后重新打开可能失去临时表单状态，需重新观察。

提取、正文完整度与下载分别记录。整页截图不可用时退到视口；媒体只通过来源浏览器页和扩展下载，失败保留原因。429、登录或安全验证时停止。已下载音视频分轨仅用本地 FFmpeg 合并，失败仍登记分轨校验，便于修复后接续。

## 平台节流

```powershell
node scripts/luz-crawl.mjs policy
node scripts/luz-crawl.mjs policy --file policy.json
```

保存的配置是对 [默认策略](../opencli/access-policy.json) 的局部覆盖：

```json
{
  "schema_version": 1,
  "defaults": {"max_attempts": 2, "max_operations": 120},
  "platforms": {"xhs": {"navigation_interval_ms": 8000}}
}
```

默认每任务最多 120 次操作、5 分钟派发预算；小红书 / 抖音 / TikTok 导航至少间隔 6 秒，X / 知乎至少 5 秒，1688 等至少 8 秒。间隔增加最多 15% 的抖动；条件等待逐步退避。每站滑动窗口限制导航与媒体请求，429 至少冷却 10 分钟；连续网络故障触发短期暂停。

冷却按平台与浏览器配置写入 opencli/memory/execution/，跨 CLI 调用共享，不随发布包分发。站内公开备用入口只用于定位同一内容，不能用于规避冷却。节流不能保证平台不限制账号；页面内部请求数及单次浏览器命令耗时不等于本接口操作数。

## 运行文件

浏览器操作通过 `node scripts/luz-crawl.mjs browser` 调用；`schema` 查看动作定义。分发目录中的 `scripts/luz-crawl.mjs` 与 `opencli/commands.js` 是编译后的运行文件，未包含开发模块或源码映射。
