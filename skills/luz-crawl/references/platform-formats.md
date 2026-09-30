# Platform Formats

## X / Twitter

Use this format for X posts, threads, quote posts, and prompt-sharing tweets.

For prompt-sharing collection tasks, use the minimal format below and do not add comments, analysis, conclusions, or limitations unless the user asks:

```markdown
# 主题

## 1. 标题

链接：https://x.com/...

图片：

<p>
  <img src="./images/001_01.jpg" height="220">
  <img src="./images/001_02.jpg" height="220">
</p>

提示词：

```text
完整提示词
```
```

```markdown
# NNN_X_主题

## 基本信息
- 爬取时间：
- 工具：
- 作者：
- 账号：
- 发布时间：
- 来源链接：
- 互动数据：
- 抓取状态：

## 一句话总结

## 帖子内容

## 线程/评论中的提示词

```text
完整提示词
```

## 图片与附件
- 原帖图片：
- 页面截图：
- 本地保存：

## 评论摘录

## 提示词结构拆解
- 主体：
- 构图：
- 风格：
- 光影：
- 文字/版式：
- 可替换变量：

## 可复用改写模板

```text
可复用模板
```

## 局限与待补
```

Notes:
- For X, the full prompt is often in the first reply. Always read the thread or comments.
- Preserve exact prompt wording when available, but avoid duplicating unrelated replies.
- If media cannot be downloaded, include the page screenshot and state that original attachments were not captured.

## Xiaohongshu / 小红书

Use this format for notes, image-text posts, comments, and topic searches.

If the user says not to log in, or login/risk-control appears without an already configured backend, save a public-crawl record instead of forcing access. If a backend can provide `id + xsec_token`, save concrete notes with the normal note format below.

```markdown
# NNN_小红书_主题

## 1. 标题

链接：https://...

图片：

无

内容：

```text
公开搜索结果、可见摘要、限制说明、安全处理。
```
```

```markdown
# NNN_小红书_主题

## 基本信息
- 爬取时间：
- 工具：
- 作者：
- 小红书号/主页：
- 发布时间：
- 笔记链接：
- 点赞/收藏/评论：
- 抓取状态：

## 一句话总结

## 笔记正文清洗版

## 图片/封面信息
- 图片数量：
- 本地保存：
- 画面要点：

## 评论洞察
- 高频问题：
- 真实需求：
- 情绪倾向：
- 可借鉴表达：

## 内容结构拆解
- 标题钩子：
- 开头：
- 主体：
- 结尾/互动引导：

## 可复用选题/话术

## 局限与待补
```

Notes:
- Xiaohongshu often requires login and `xsec_token`; never read by bare note id when the backend requires the full searched URL.
- Keep user comments short and representative. Remove duplicate emoji-only or low-information comments.

## Generic Web / Article

```markdown
# NNN_网页_主题

## 基本信息
- 爬取时间：
- 工具：
- 标题：
- 作者/机构：
- 发布/更新日期：
- 来源链接：
- 抓取状态：

## 核心结论

## 文章结构

## 关键摘录整理

## 数据/链接/资源

## 可复用要点

## 局限与待补
```

## Boss Zhipin / 招聘

Use this minimal format for job research. Do not include application advice unless requested. Do not send messages, upload resumes, click "沟通", or submit login/verification.

```markdown
# NNN_Boss直聘_主题

## 1. 职位标题

链接：https://www.zhipin.com/...

图片：

无

职位信息：

```text
公司：
城市：
薪资：
经验学历：
状态：
关键词：
岗位职责：
岗位要求：
公开抓取限制：
```
```

## WeChat Public Accounts / 公众号

Use this minimal format for public article or viral article research. Prefer accessible public URLs; if `mp.weixin.qq.com` URLs are expired or unreadable, use public mirrors/news/analysis pages and mark source type.

```markdown
# NNN_公众号_主题

## 1. 文章标题

链接：https://...

图片：

无

内容：

```text
发布时间：
作者/账号：
核心内容：
爆款结构：
可复用要点：
公开抓取限制：
```
```

## Prompt Gallery / Image Prompt Sites

```markdown
# NNN_提示词库_主题

## 基本信息
- 爬取时间：
- 工具：
- 站点：
- 页面：
- 来源链接：
- 抓取状态：

## 收集条目

### 1. 标题
- 图片：
- 模型：
- 标签：

```text
prompt
```

## 风格聚类

## 可复用模板

## 局限与待补
```

## Futures Market / 期货市场

Use this format for commodity, index, Treasury, FX, or other futures market information. Focus on information that can materially affect risk, volatility, liquidity, or directional expectations. Do not give personalized trading advice.

```markdown
# NNN_期货市场_主题

## 基本信息
- 爬取时间：
- 工具：
- 市场/品种：
- 来源链接：
- 抓取状态：
- 声明：以下为市场信息与风险因素，不构成投资建议。

## 重要信息

### 1. 事件/数据标题
- 来源：
- 时间：
- 影响品种：
- 信息类型：宏观/库存/持仓/交易所规则/天气/地缘/供需/资金
- 可能影响：波动率/流动性/保证金/供给/需求/期限结构
- 需要继续验证：

## 关键时间点

## 风险因素

## 原始链接清单
```

## HTX / Huobi Crypto Market

Use this format for HTX/Huobi market, crypto exchange, token, or crypto catalyst crawls. Prefer official HTX announcements plus reputable market/news sources. Avoid direct trading calls.

```markdown
# NNN_HTX_主题

## 基本信息
- 爬取时间：
- 工具：
- 市场/币种：
- 来源链接：
- 抓取状态：
- 声明：以下为市场信息与风险因素，不构成投资建议。

## 重要信息

### 1. 事件/公告标题
- 来源：
- 时间：
- 相关币种/交易对：
- 信息类型：上市/下架/维护/费率/安全/监管/宏观/流动性
- 可能影响：价格波动/成交量/充提/流动性/风险偏好
- 需要继续验证：

## 市场观察

## 风险因素

## 原始链接清单
```

## Stock Market / 股票市场

Use this format for stock market, sector, company, or macro-equity crawls. Prefer official filings, IR pages, exchange calendars, earnings calendars, and reputable news. Do not give personalized buy/sell advice.

```markdown
# NNN_股票市场_主题

## 基本信息
- 爬取时间：
- 工具：
- 市场/标的：
- 来源链接：
- 抓取状态：
- 声明：以下为市场信息与风险因素，不构成投资建议。

## 重要信息

### 1. 事件/数据标题
- 来源：
- 时间：
- 相关股票/指数/板块：
- 信息类型：财报/指引/SEC文件/宏观数据/利率/政策/行业/交易所公告
- 可能影响：估值/盈利预期/风险偏好/成交量/波动率
- 需要继续验证：

## 关键时间点

## 风险因素

## 原始链接清单
```
