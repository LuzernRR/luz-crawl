# 网站目录与对应技能

LuzCrawl 2.3.0 内置 53 个站点。下面是浏览器入口与对应能力，目录不等于全部实测通过；真实结果见 [验证记录](validation.md)。

从 Skill 目录使用 `node scripts/luz-crawl.mjs search ID "关键词" --read 1`；社交正文可按需要加 `--comments --download`。直接原文使用 capture。

| 网站 / ID | 浏览器入口 | 对应技能 | 条件与范围 |
| --- | --- | --- | --- |
| X / Twitter / `x` | [打开入口](<https://x.com/search?q=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD&src=typed_query&f=live>) | 原帖/长文、账号、图文/视频、互动与已加载讨论 | 隐藏数值为 null；关联讨论未必都是直接回复 |
| 小红书 / `xhs` | [打开入口](<https://www.xiaohongshu.com/search_result?keyword=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD&source=web_search_result_notes>) | 笔记作者、正文、图文/视频、赞评藏与已加载评论 | 优先点击真实卡片；验证提示交给用户 |
| 微信公众号 / `wechat` | [打开入口](<https://weixin.sogou.com/weixin?type=2&query=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD>) | 搜狗微信候选 → 打开公众号原文、作者与配图 | 索引不是全文；留言/阅读数可能不可见 |
| 抖音 / `douyin` | [打开入口](<https://www.douyin.com/search/%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD?type=general>) | 视频简介、作者、封面、赞评藏与已加载评论 | 下载依赖可访问媒体；没有字幕不做完整转录 |
| YouTube / `youtube` | [打开入口](<https://www.youtube.com/results?search_query=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD>) | 作者、简介、封面、可见字幕/评论与公开视频下载 | 字幕需页面实际提供；yt-dlp 为可选工具 |
| Reddit / `reddit` | [打开入口](<https://www.reddit.com/search/?q=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD>) | 帖子作者、正文、得分、评论与公开图片/视频 | 可尝试 old.reddit 公开入口，折叠/分页另计 |
| 知乎 / `zhihu` | [打开入口](<https://www.zhihu.com/search?type=content&q=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD>) | 回答/文章作者、正文、赞同与已加载评论 | 尝试打开评论面板；收藏数可能隐藏 |
| 豆瓣 / `douban` | [打开入口](<https://www.douban.com/search?q=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD>) | 日记/小组帖子/影评、账号、图文与已加载评论 | 电影条目资料不能当作账号帖子 |
| 哔哩哔哩 / `bilibili` | [打开入口](<https://search.bilibili.com/all?keyword=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD>) | UP主/视频介绍、封面、可见字幕与评论 | 下载、字幕及互动依页面与授权而定 |
| 微博 / `weibo` | [打开入口](<https://s.weibo.com/weibo?q=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD>) | 原帖/文章、账号、可见互动、图片/视频、已加载评论 | 按当前页面实际可见内容；登录、权限与限流单独报告 |
| 快手 / `kuaishou` | [打开入口](<https://www.kuaishou.com/search/video?searchKey=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD>) | 原帖/文章、账号、可见互动、图片/视频、已加载评论 | 按当前页面实际可见内容；登录、权限与限流单独报告 |
| Instagram / `instagram` | [打开入口](<https://www.instagram.com/explore/search/keyword/?q=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD>) | 原帖/文章、账号、可见互动、图片/视频、已加载评论 | 按当前页面实际可见内容；登录、权限与限流单独报告 |
| TikTok / `tiktok` | [打开入口](<https://www.tiktok.com/search?q=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD>) | 原帖/文章、账号、可见互动、图片/视频、已加载评论 | 按当前页面实际可见内容；登录、权限与限流单独报告 |
| Google / `google` | [打开入口](<https://www.google.com/search?q=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD>) | 浏览器检索、候选链接与指定域名发现 | 按当前页面实际可见内容；登录、权限与限流单独报告 |
| Bing / `bing` | [打开入口](<https://www.bing.com/search?q=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD>) | 浏览器检索、候选链接与指定域名发现 | 按当前页面实际可见内容；登录、权限与限流单独报告 |
| 百度 / `baidu` | [打开入口](<https://www.baidu.com/s?wd=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD>) | 浏览器检索、候选链接与指定域名发现 | 按当前页面实际可见内容；登录、权限与限流单独报告 |
| 搜狗 / `sogou` | [打开入口](<https://www.sogou.com/web?query=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD>) | 浏览器检索、候选链接与指定域名发现 | 按当前页面实际可见内容；登录、权限与限流单独报告 |
| 360 搜索 / `so360` | [打开入口](<https://www.so.com/s?q=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD>) | 浏览器检索、候选链接与指定域名发现 | 按当前页面实际可见内容；登录、权限与限流单独报告 |
| DuckDuckGo / `duckduckgo` | [打开入口](<https://duckduckgo.com/?q=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD>) | 浏览器检索、候选链接与指定域名发现 | 按当前页面实际可见内容；登录、权限与限流单独报告 |
| 指定网站公开检索 / `web` | [打开入口](<https://www.bing.com/search?q=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD>) | 浏览器检索、候选链接与指定域名发现 | 按当前页面实际可见内容；登录、权限与限流单独报告 |
| 中国政府采购网 / `ccgp` | [打开入口](<https://search.ccgp.gov.cn/bxsearch?searchtype=1&kw=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD>) | 公开采购/招标公告、条件、项目候选与原始链接 | 按当前页面实际可见内容；登录、权限与限流单独报告 |
| 全国公共资源交易平台 / `ggzy` | [打开入口](<https://www.ggzy.gov.cn/>) | 公开采购/招标公告、条件、项目候选与原始链接 | 按当前页面实际可见内容；登录、权限与限流单独报告 |
| 中国招标投标公共服务平台 / `cebpub` | [打开入口](<https://www.cebpubservice.com/>) | 公开采购/招标公告、条件、项目候选与原始链接 | 按当前页面实际可见内容；登录、权限与限流单独报告 |
| 中央政府采购网 / `zycg` | [打开入口](<https://www.zycg.gov.cn/>) | 公开采购/招标公告、条件、项目候选与原始链接 | 按当前页面实际可见内容；登录、权限与限流单独报告 |
| 中国国际招标网 / `chinabidding` | [打开入口](<https://www.chinabidding.com/>) | 公开采购/招标公告、条件、项目候选与原始链接 | 按当前页面实际可见内容；登录、权限与限流单独报告 |
| 千里马招标网 / `qianlima` | [打开入口](<https://www.qianlima.com/>) | 公开采购/招标公告、条件、项目候选与原始链接 | 按当前页面实际可见内容；登录、权限与限流单独报告 |
| 采招网 / `bidcenter` | [打开入口](<https://www.bidcenter.com.cn/>) | 公开采购/招标公告、条件、项目候选与原始链接 | 按当前页面实际可见内容；登录、权限与限流单独报告 |
| 1688 / `1688` | [打开入口](<https://s.1688.com/selloffer/offer_search.htm>) | GBK 中文商品/店铺检索与详情候选 | 商品卡片不是已核验工厂；价格/库存可能依赖账号 |
| 京东企业购 / `jd-procurement` | [打开入口](<https://search.jd.com/Search?keyword=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD&enc=utf-8>) | 商品、店铺与企业采购候选，核验公开详情 | 按当前页面实际可见内容；登录、权限与限流单独报告 |
| 中国制造网 / `made-in-china` | [打开入口](<https://cn.made-in-china.com/productdirectory.do?word=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD>) | 商品、店铺与企业采购候选，核验公开详情 | 按当前页面实际可见内容；登录、权限与限流单独报告 |
| 企查查 / `qcc` | [打开入口](<https://www.qcc.com/web/search?key=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD>) | 企业检索与公开公司信息 | 登录/付费字段不伪造，不调用收费 API |
| 天眼查 / `tianyancha` | [打开入口](<https://www.tianyancha.com/search?key=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD>) | 企业候选与当前页面可见的公司信息 | 按当前页面实际可见内容；登录、权限与限流单独报告 |
| 爱企查 / `aiqicha` | [打开入口](<https://aiqicha.baidu.com/s?q=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD>) | 企业候选与当前页面可见的公司信息 | 按当前页面实际可见内容；登录、权限与限流单独报告 |
| 灰豚数据 / `huitun` | [打开入口](<https://dy.huitun.com/>) | 灰豚当前账号可见榜单/数据页面 | 产品介绍不是后台数据；不越过付费权限 |
| 新榜 / `newrank` | [打开入口](<https://www.newrank.cn/>) | 当前账号可见的榜单、表格与数据页面 | 用户自己的账号登录后可见数据；验证交给用户 |
| 飞瓜数据 / `feigua` | [打开入口](<https://dy.feigua.cn/>) | 当前账号可见的榜单、表格与数据页面 | 用户自己的账号登录后可见数据；验证交给用户 |
| 蝉妈妈 / `chanmama` | [打开入口](<https://www.chanmama.com/>) | 当前账号可见的榜单、表格与数据页面 | 用户自己的账号登录后可见数据；验证交给用户 |
| 抖查查 / `douchacha` | [打开入口](<https://www.douchacha.com/>) | 当前账号可见的榜单、表格与数据页面 | 用户自己的账号登录后可见数据；验证交给用户 |
| 小红书创作服务平台 / `xhs-creator` | [打开入口](<https://creator.xiaohongshu.com/>) | 用户自己账号可见的内容与后台数据 | 用户自己的账号登录后可见数据；验证交给用户 |
| 微信公众平台后台 / `wechat-creator` | [打开入口](<https://mp.weixin.qq.com/>) | 用户自己账号可见的内容与后台数据 | 用户自己的账号登录后可见数据；验证交给用户 |
| 抖音创作者中心 / `douyin-creator` | [打开入口](<https://creator.douyin.com/>) | 用户自己账号可见的内容与后台数据 | 用户自己的账号登录后可见数据；验证交给用户 |
| B站创作中心 / `bilibili-creator` | [打开入口](<https://member.bilibili.com/platform/home>) | 用户自己账号可见的内容与后台数据 | 用户自己的账号登录后可见数据；验证交给用户 |
| 百家号 / `baijiahao` | [打开入口](<https://baijiahao.baidu.com/builder/rc/home>) | 用户自己账号可见的内容与后台数据 | 用户自己的账号登录后可见数据；验证交给用户 |
| YouTube Studio / `youtube-studio` | [打开入口](<https://studio.youtube.com/>) | 用户自己账号可见的内容与后台数据 | 用户自己的账号登录后可见数据；验证交给用户 |
| GitHub / `github` | [打开入口](<https://github.com/search?q=OpenAI&type=repositories>) | 仓库检索、README、公开文件、Issue/PR 页面 | 仓库根地址检索；不克隆全库或承诺所有折叠文件 |
| Gitee / `gitee` | [打开入口](<https://search.gitee.com/?q=OpenAI>) | 公开仓库检索与页面内容 | 搜索是动态页面，详情与登录分别验收 |
| CSDN / `csdn` | [打开入口](<https://so.csdn.net/so/search?q=OpenAI&t=blog>) | 技术文章正文、作者元信息与图片 | 公开文章可读性单独核验，不越过 VIP 权限 |
| 博客园 / `cnblogs` | [打开入口](<https://zzk.cnblogs.com/s/blogpost?w=OpenAI>) | 博客正文、代码段与页面信息 | 仅已打开文章；不可用摘要替代原文 |
| 掘金 / `juejin` | [打开入口](<https://juejin.cn/search?query=OpenAI&type=0>) | 技术文章、代码段与公开页面信息 | 登录/加载失败保留实际原因 |
| Stack Overflow / `stackoverflow` | [打开入口](<https://stackoverflow.com/search?q=OpenAI>) | 问题正文、公开代码与已加载讨论 | 基础版不保证所有答案和折叠内容 |
| DEV Community / `devto` | [打开入口](<https://dev.to/search?q=OpenAI>) | 开发者文章与公开页面内容 | 目录候选；按本次实际打开结果判断 |
| Hacker News / `hackernews` | [打开入口](<https://hn.algolia.com/?q=OpenAI>) | 检索讨论链接，打开 HN 讨论页面 | 索引和讨论正文分开核验 |
| V2EX / `v2ex` | [打开入口](<https://www.bing.com/search?q=site%3Av2ex.com%2Ft%2F%20OpenAI>) | 公开主题检索与已打开帖子 | 可能需要登录，拒绝访问先核对 URL |

## 搜索、URL 与登录

每次检索打开真实浏览器。新站点可用域名检索或 remember 登记；查询模板必须在登记域名内。错误/过期地址先从站内入口重进，只把当前打开的正确目标保存为成功经验。

一个手动登录/验证页可暂留；其余待办保存并关闭，continue 时再打开。无需登录即可读的公开页面可以使用，付费和验证码不能破解。

## 数据与下载

post.account 保存名称/账号标识/主页，post.engagement 保留 raw/value/approximate，未显示的值为 null。comments 仅含本次加载条目。视频链接、视频下载、字幕与完整转录分别记录。下载失败不把缩略图算成完整视频。

## 平台适配边界

GitHub 仓库检索过滤 stars/forks/导航；文件、Issue、PR 用原始 URL capture。小红书优先点击搜索卡片；1688 使用 GBK 表单；抖音可尝试相同视频 ID 的 www 公开入口，微博可从 apps 入口校正到同一 weibo.com 内容；Reddit 可尝试 old.reddit.com。校正必须实际打开并验证。

账号后台、收费统计、分页与折叠评论未加载时不能宣称全量。相应浏览器操作入口见 [README](../README.md#浏览器接口)。
