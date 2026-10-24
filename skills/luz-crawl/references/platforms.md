# 可用网站

公开样本验证：2026-10-24。只列已取得目标正文的 29 个网站；范围取决于当前页面与账号。

| 网站 | 命令 ID | 已验证范围 |
| :--- | :--- | :--- |
| [小红书](https://xiaohongshu.com/) | `xhs` | 目标正文 / 简介、账号与可访问媒体；逐站范围见下表 |
| [X](https://x.com/) | `x` | 作者、指标、视频下载；本次回复未加载 |
| [知乎](https://zhihu.com/) | `zhihu` | 回答、账号、赞同 / 收藏、已加载评论 |
| [豆瓣](https://douban.com/) | `douban` | 日记、作者、点赞、已加载评论 |
| [Reddit](https://reddit.com/) | `reddit` | 图片帖、作者、得分、评论、图片下载 |
| [抖音](https://douyin.com/) | `douyin` | 作者、简介、赞评藏、已加载评论、视频下载 |
| [哔哩哔哩](https://bilibili.com/) | `bilibili` | UP 主、简介、赞评藏、封面、视频；评论未逐条验收 |
| [TikTok](https://tiktok.com/) | `tiktok` | 账号、简介、赞评藏、封面、视频；本次评论未加载 |
| [YouTube](https://youtube.com/) | `youtube` | 作者、简介、已加载评论、封面、视频下载 |
| [微信公众号](https://mp.weixin.qq.com/) | `wechat` | 公众号公开文章正文 |
| [微博](https://weibo.com/) | `weibo` | 公开帖子正文 |
| [Instagram](https://instagram.com/) | `instagram` | 公开帖子页面文字 |
| [GitHub](https://github.com/) | `github` | 公开仓库、文章、问题与可见讨论 |
| [Gitee](https://gitee.com/) | `gitee` | 公开仓库、文章、问题与可见讨论 |
| [CSDN](https://csdn.net/) | `csdn` | 公开仓库、文章、问题与可见讨论 |
| [博客园](https://cnblogs.com/) | `cnblogs` | 公开仓库、文章、问题与可见讨论 |
| [掘金](https://juejin.cn/) | `juejin` | 公开仓库、文章、问题与可见讨论 |
| [Stack Overflow](https://stackoverflow.com/) | `stackoverflow` | 公开仓库、文章、问题与可见讨论 |
| [DEV Community](https://dev.to/) | `devto` | 公开仓库、文章、问题与可见讨论 |
| [Hacker News](https://news.ycombinator.com/) | `hackernews` | 公开仓库、文章、问题与可见讨论 |
| [V2EX](https://v2ex.com/) | `v2ex` | 公开仓库、文章、问题与可见讨论 |
| [Google](https://google.com/) | `google` | 浏览器检索与来源发现 |
| [Bing](https://bing.com/) | `bing` | 浏览器检索与来源发现 |
| [中国政府采购网](https://ccgp.gov.cn/) | `ccgp` | 公开公告正文 |
| [全国公共资源交易平台](https://www.ggzy.gov.cn/) | `ggzy` | 公开公告正文 |
| [中国国际招标网](https://www.chinabidding.com/) | `chinabidding` | 公开公告正文 |
| [千里马招标网](https://www.qianlima.com/) | `qianlima` | 公开公告正文 |
| [采招网](https://www.bidcenter.com.cn/) | `bidcenter` | 公开公告正文 |
| [中国制造网](https://made-in-china.com/) | `made-in-china` | 公开商品列表 |

`node scripts/luz-crawl.mjs search ID "关键词" --read 1`；需评论 / 媒体时加 `--comments --download`。

其他站点须重新验证。搜索候选、后台外壳和产品介绍页不算目标正文；浏览器动作见 [README](../README.md#浏览器接口)。
