# 浏览器操作 API · 1.0.0

LuzCrawl 2.5.0。供 Agent、脚本和其他模型使用；每次调用返回 JSON。所有动作先校验，再打开本任务页面。

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
| `click` | 唯一可见目标；检查遮挡后派发一次 DOM 点击 |
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

## 返回与续接

返回包含 `api_version`、`version`、`status`、`stop_reason`、`plan_sha256`、`next_action_index`、每步 results 与 execution。execution 记录操作数、重试数、等待时长和事件；browser 记录任务页关闭情况。

| 情况 | 处理 |
| :--- | :--- |
| 短暂超时、连接中断、HTTP 5xx | 只重试幂等读取，默认最多两次尝试 |
| 选择器缺失 / 歧义、无效表单 | 停止，先读取页面纠正目标 |
| 登录 / 验证 | awaiting_user；保存任务，手动完成后 continue TASK_ID |
| 写操作结果未知 | outcome_unknown；只读核验 expect，不能重放写操作 |
| HTTP 429 / 频繁访问页 | 保存平台冷却，关闭工具页；到 retry_after_ms 后再试 |
| 操作 / 时间预算耗尽 | 停止后续派发；已取得证据保留为 partial |

continue 使用保存的动作计划哈希与游标，跳过已完成步骤。未知写结果会保存 pending_verification；预期结果未证实时停止，不能自动重新点击或提交。任务停放后重新打开可能失去临时表单状态，需重新观察。

提取、正文完整度与下载分别记录。整页截图不可用时退到视口；直链视频失败可尝试一次公开视频下载器，429、登录或安全验证时停止下载降级。已下载音视频分轨在合并失败时仍登记校验，便于修复后接续。

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

冷却按平台与浏览器配置写入 opencli/memory/execution/，跨 CLI 调用共享，不随发布包分发。站内公开备用入口只用于定位同一内容，不能用于规避冷却。节流不能保证平台不限制账号；下载器内部的请求数及单次浏览器命令耗时由上游控制，不等于本接口操作数。

## 模块边界

- `browser-operations.mjs`：导航、定位、交互、条件等待、提取、截图；复用同一 BrowserOperations。
- `execution.mjs` / `failure.mjs`：节流、预算、退避、冷却与结构化错误。
- `extract-page.mjs` / `capture.mjs`：平台正文解析、快照与完整度。
- `media.mjs` / `download.mjs`：媒体地址验证、传输、分轨合并、校验与 HTML 回填。
- `browser-session.mjs`：任务页面所有权、人工接续与关闭。

Node 调用可直接导入 `executeActions(page, options)`；注入兼容的 goto / evaluate / screenshot 页面。需要真实桥接与自动收尾时，通过 `withBrowser` 的第四个回调参数复用 operations；页面所有权由 withBrowser 管理。
