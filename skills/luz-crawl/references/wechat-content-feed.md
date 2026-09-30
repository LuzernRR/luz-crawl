# WeChat Content Feed Crawling

Use this reference when `wechat-skills` or the user asks `.luz-crawl` to collect material for WeChat public-account articles.

## Freshness Gate

Default complete-article candidates must be current. A topic is current only if at least one of these is true:

- the original post, paper, product/company announcement, official blog, media story, or public release is within the last 60 days;
- the material is older, but recent platform evidence within the last 60 days shows it resurfaced, went viral, was translated, was discussed by media/newsletters, or became newly relevant;
- the user explicitly asks for evergreen/history/cold-knowledge content, in which case downstream must not call it "latest" or "recently popular".

Record exact source dates, platform post dates, visible metrics when available, and crawl date. If the date is unclear, mark the candidate `待补新鲜度`, not `可成文`.

## Mass-Accessibility Gate

Before a topic is marked `可成文`, check whether an ordinary reader would care before knowing the field. Public importance is not enough. "New paper", "first demonstration", "major lab", "Nature/Science", or "breakthrough" can support credibility, but they cannot be the hook.

Professional topics such as synthetic biology, astronomy, materials science, engineering, and niche AI research must pass at least two tests:

- the rough title can be rewritten as a plain question, scene, or conflict a non-specialist understands;
- real comments, posts, headlines, or media framing show ordinary curiosity, fear, amusement, or doubt;
- the story connects to body, food, sleep, work, money, family, phone, travel, future life, ethics, or a visible demo;
- after deleting institution names, journal names, author titles, and words like `breakthrough`, the remaining story is still interesting.

If the best title is still paper-language, downgrade the topic. For example, "synthetic cells from nonliving chemical components that feed, grow, copy, and divide" is a raw evidence phrase, not an article hook. It becomes article-ready only if the crawl can support a general-reader question like "does this count as alive?" with real public discussion and source verification.

## Responsibility Boundary

`.luz-crawl` is the upstream evidence layer only.

It must:

- crawl real sources from X/Twitter, Reddit, media, official pages, papers, Bilibili, Xiaohongshu, forums, newsletters, and comments; use GitHub only as a factual source for an already selected public-interest story, not as a default crawl lane;
- save raw outputs, links, authors, timestamps, metrics, media URLs, comment samples, and crawler limitations;
- separate viral/social signal from factual source-of-truth;
- extract story angles, public-interest hooks, visual references, and reusable search lessons;
- produce a compact evidence packet that downstream `wechat-skills` can consume.

It must not:

- write the final WeChat article;
- generate titles for final publication except as rough hook notes;
- call Hermes or any image generator;
- create `article.html`, `article_gzh.html`, covers, body images, or layout;
- invent comments, examples, dates, metrics, facts, source claims, or "what people are saying".

## Intake For WeChat Topics

Before searching, identify:

- target reader: general WeChat reader, AI/tech reader, workplace reader, science-curious reader, or niche audience;
- content type: fresh tech/news explanation, viral thought/experience article, strange science, aviation/space, life/biology, internet meme, product/person story, or tool/agent phenomenon with broad reader curiosity;
- desired feel: fun, story-like, knowledgeable, lively, not pure encyclopedia;
- freshness need: breaking/current, recent evergreen, or historical-but-new-to-readers;
- evidence risk: research claim, medical/health, finance/legal, product rumor, social meme, or personal anecdote;
- downstream artifact: research-only topic library or one single-article evidence packet. Complete-article handoff must be single-topic; do not prepare batch production seeds unless the user explicitly asks for a topic library with no finished article.

## Single-Article Handoff Rule

When the crawl is meant to feed `wechat-skills` complete article production, search and package only one公众号文章主题 at a time. Finish the evidence packet for the current article before starting another topic. Do not produce several article-ready packets, several image directions for different finished pieces, or a batch-production queue in the same run.

If the user asks for many fresh ideas, create a research-only candidate queue. Mark one `建议先写` topic, and make all other candidates `候选/待补源`; downstream may not start them until the current article has a publish-ready `article.html`.

## Search Lanes

For broad WeChat curiosity/topic discovery, cover at least four lanes:

- **viral social**: X high-engagement posts/articles, Reddit hot/Top posts, user-recommended threads, Hacker News/YouTube/Bilibili discussions, Xiaohongshu/WeChat when accessible;
- **source-of-truth**: official blog, paper, product docs, primary article, institution page, company newsroom, or release announcement. GitHub README/release is only needed when the story itself is about a public repo becoming a news phenomenon; do not crawl GitHub issues, vulnerabilities, install docs, or open-source risk threads for ordinary WeChat topic discovery.
- **comment texture**: replies, Reddit comments, Bilibili comments, forum threads, quote tweets, creator comments showing what readers ask, laugh at, doubt, or misunderstand;
- **media/story sources**: reputable science/tech/industry media, longform explainers, newsletters, interviews, podcasts, conference talks, and recently shared "everyone is talking about this" articles;
- **visual reference**: source article images, paper figures, official graphics, videos, demos, product screenshots, media thumbnails. Save as reference URLs/notes only unless allowed.
- **truthful product visuals**: for concrete products, robots, phones, vehicles, aircraft, hardware, lab devices, and software interfaces, collect official product images, media photos, screenshots, video frames, and source URLs. Mark whether downstream should use the real image directly, crop/format it to 2.35:1, or feed it into Hermes as a reference image. Do not suggest AI lookalikes for factual product appearance.
- **style benchmark**: high-performing WeChat public accounts, tech/science explainers, creator newsletters, X articles, Reddit long posts, and Chinese accounts such as 新智元/量子位-like explainers when accessible. Save title patterns, opening moves, background style, pacing, humor, paragraph density, source handling, and how they turn complex material into readable narration. For a single complete article, collect benchmark/style samples only as much as needed to calibrate the current topic; for explicit research-only topic libraries, collect broader benchmark material without triggering batch production.

Use source-graph expansion: mine every strong source for people, labs, companies, handles, terms, methods, paper titles, repos, comments, and adjacent domains. For single-article handoff, follow only the graph branches that improve the current article's evidence, voice, or image references. Save unrelated good leads as candidates instead of opening new article pipelines.

Do not stay in AI/product naming. For broad feeds, deliberately open multiple curiosity lanes:

- AI and tools: model behavior, agents, interpretability, creator methods, and tool/agent phenomena that have a story, surprising behavior, or broad social discussion;
- technology and internet culture: new interfaces, odd product launches, platform memes, unexpected user behavior;
- aviation and space: flight safety, cockpit automation, space missions, aircraft design, human factors;
- life and biology: cognition, sleep, memory, perception, health-adjacent findings with careful limits;
- science and engineering: materials, lab demos, robots, sensors, energy, climate, manufacturing.
- viral thought and writing: recent high-engagement creator essays, public notebooks, Substack/newsletter posts, Reddit essays, influential X long posts, or newly translated articles that contain usable ideas, personal methods, or memorable arguments. For these, extract what the author actually said and what a reader can do, not why the post went viral.

For single-article handoff, apply a theme-rotation check before selecting the next topic. If downstream recently published AI/robot/product/company-launch stories, prioritize a different lane: fresh ideas, psychology, life science, aviation/space, everyday behavior, internet culture, creator thinking, or a surprising research finding with a public hook. Do not hand off another product launch merely because it is current. Product announcements become article-ready only when the crawl finds a broader story, social emotion, ordinary-life question, behavior change, or memorable thought beyond the launch itself.

Treat "fresh" as cognitive freshness, not only publication date. A good WeChat handoff should let downstream write one of these sentences: "原来我每天这样做是因为这个", "这个发现把一个常识翻过来了", "这个人/研究给了一个能照着做的想法", or "这件事看起来像新闻，其实是在讲普通人的生活变化". If the packet can only say "who launched what, when, with what features", downgrade it to candidate.

Apply the product-launch stripping test before marking any tech/product/company story `可成文`: remove the company, product name, feature name, parameter, price, and launch wording. If the remaining hook is not a normal-reader question, scene, thought, behavior change, research finding, or strange public reaction, the candidate is not ready. Continue searching around user comments, independent explainers, related research, human factors, ordinary-life use cases, or downgrade it.

For fresh discovery, prefer query families that surface ideas and public curiosity instead of launch calendars:

```text
"new study" "why people" comments
"human factors" "people keep" aviation safety
"cognition" "everyday" "new research"
"life science" "does this count as" comments
"viral essay" "what I learned" creator
"X long post" "how to" "life" "work"
"Reddit" "I just learned" science
"internet culture" "why everyone" "suddenly"
```

Product terms can be added later as source-graph branches, but they should not dominate the first search pass unless the user explicitly names a product.

Do not start from imagined article ideas. Start from platform discovery: current X posts, Reddit threads, newsletters, media pages, paper feeds, official blogs, public-account articles, video discussions, and forum conversations. Use model knowledge only to expand keywords and source graphs after real sources are found.

For each lane, collect at least one "story-bearing" source when possible: a person, lab, company, experiment, failure, demo, field report, or first-person method. A topic that is only a fact summary with no scene or protagonist should be downgraded unless the fact itself is unusually delightful.

## Topic Selection For WeChat

Score candidate topics by:

- novelty: new/current or newly resurfaced;
- public relevance: connects to daily cognition, AI usage, work, life, health, space, aviation, biology, money, relationships, learning, or internet culture;
- mass accessibility: a non-specialist reader can understand the hook from the title/opening without knowing the field. Professional papers, synthetic biology, astronomy, materials, engineering, or niche AI research must have a normal-reader entry point such as body, sleep, food, money, work, phone, family, travel, fear, curiosity, a visible demo, or a funny everyday analogy.
- story: has a protagonist, experiment, conflict, before/after, weird object, mistake, discovery, or vivid scene;
- evidence: has at least one A/B source and separate C-level social signal;
- comment energy: readers ask "really?", "how?", "can I use it?", "is this scary?", or make memorable jokes;
- imageability: one image can clearly represent the paragraph or scene;
- risk: no unsupported medical/legal/financial advice, privacy invasion, panic framing, political sensitivity, or rumor laundering.
- theme freshness: compared with the last 3 downstream articles, the topic changes at least two of content type, reader entry point, visual scene, and takeaway.

Treat X/Reddit/media popularity as a lead, not the article itself. If the seed is a Dan Koe-style viral essay or creator thread, the packet should summarize the original idea, author context, key steps, and what readers can do; do not turn the packet into a "why it went viral" analysis unless requested. If the seed is a tech/science news item, pair social curiosity with official/paper/media verification before marking it "可成文".

Downgrade topics that are:

- only a hot take with no source-of-truth;
- only an official announcement with no reader emotion;
- only a product launch, model update, company announcement, funding item, or feature list, without a general-reader question, story scene, social reaction, life connection, or new thought;
- too similar to the previous downstream article's theme category, especially consecutive robot/AI/product-launch pieces, unless the user explicitly requested that lane;
- different only in brand/product/model name from the previous topic, with the same "new product launched" article shape;
- older than 60 days with no recent resurgence evidence;
- scientifically important but too specialist for a general WeChat reader unless a strong everyday hook is found;
- pure listicle with no story;
- a tool tutorial, installation guide, API walkthrough, repo comparison, changelog digest, or open-source risk/audit note without a public-interest story;
- mainly about GitHub issue triage, security risks, dependency warnings, setup pitfalls, or how to use an open-source project;
- dependent on fabricated examples or invented comments;
- too technical to explain without losing the fun.

Use the "delete the prestige words" test: remove the paper title, institution name, author title, and words like `breakthrough`, `landmark`, `Nature`, `important`. If the remaining story does not still make an ordinary reader curious, keep it as a candidate instead of a finished article topic. For example, a synthetic cell paper can work only if framed around a broad question like "does this count as alive?" and backed by real public reactions; if it reads mainly as synthetic biology progress, it is weak for complete-publication mode.

For WeChat feed crawling, do not spend crawl budget on tool-class how-to material unless the user explicitly asks for tutorials. A tool can enter the feed only when it is a cultural/behavioral phenomenon, a fresh product/news story, or a vivid example of how people are changing work/life. In that case, collect what proves the phenomenon and reader reaction; skip low-level usage steps, CLI flags, GitHub issue risks, dependency problems, and repo-hardening details.

## Evidence Packet Shape

Save the user-facing dossier as a normal `.luz-crawl` output. In `raw\`, include raw command outputs where feasible.

Recommended primary Markdown sections:

```markdown
# NNN_公众号趣味知识选题供料_主题

## 一句话结论

## 可成文题目
| 题目 | 内容类型 | 新鲜度 | 故事钩子 | 事实来源 | 社媒/评论信号 | 视觉方向 | 风险 |

## 重点候选详解
### 题目
- 适合标题钩子：
- 原始内容/原文：
- 作者/机构是谁：
- 事实来源：
- 社媒讨论和评论样本：
- 读者为什么会点：
- 公众号讲述角度：
- 可执行/可转述要点：
- 故事骨架：人物/机构、场景、冲突或误会、转折、现在为什么值得讲。
- 配图可参考的原图/视频/风格：
- 不得写成事实的部分：

## 来源地图
| 类型 | 来源 | 链接 | 作者/机构 | 时间/指标 | 能证明什么 | 局限 |

## 评论和语气样本
| 平台 | 原话/标题 | 链接/ID | 指标 | 可借鉴语气 | 不能照搬原因 |

## 视觉参考
| 题目 | 来源图片/视频 | 风格/构图 | 可二创方向 | 版权/限制 |

## 对标风格样本
| 来源/账号 | 文章/帖子 | 链接/ID | 适合学习什么 | 不能照搬什么 |

## 给 wechat-skills 的交接
- 本轮只交接哪一篇：
- 其他候选为什么暂不启动：
- 本篇主题大类：
- 最近 3 篇下游主题大类（若可见）：
- 与上一篇相比的新鲜点：内容类型 / 读者入口 / 画面场景 / 知识收获
- 是否通过发布会剥皮检查：
- 哪些来源必须引用：
- 哪些说法要降级：
- 图片生成应贴合哪些段落：
- 适合的文章长度档：S 500-700 / M 700-950 / L 950-1200，以及原因：
- 可借鉴的解说者风格：
```

## Visual Reference Rules

If a referenced source already has images or video:

- record the source image/video URL, platform, author, date, and visible style;
- describe the reusable style: composition, lighting, object, color, perspective, atmosphere, and story function;
- for concrete products/devices/interfaces, distinguish factual product images from mood/style references. Official/media product images can be passed downstream as truthful final-image candidates or Hermes reference inputs; mood/style images should remain inspiration only.
- downstream `wechat-skills` may ask Hermes for a second-creation image in a similar style, or may feed real reference images into Hermes so the final image keeps the product's real appearance while unifying style/ratio;
- when Hermes uses reference images, the crawl packet must note which visual facts must stay unchanged: product shape, interface layout, logo/brand placement, material, color, proportions, and visible components;
- prioritize "one image can stand for this paragraph" over abstract metaphor.
- when the source has a strong visual style, describe how downstream can second-create the mood without copying: camera distance, subject scale, color, materials, scene logic, and what must change.

Good visual notes:

- "Ultrasound silent speech: close-up under-chin transducer, laptop waveform, lab desk; should feel like real research demo, not brain-reading sci-fi."
- "Claude J-space: research desk, Claude/J-space as minimal short text, neural diagrams as background, no explanation tiles."
- "Dan Koe anti-vision: blank notebook, crossed-out sticky notes, calendar reminders; no readable method list."

Bad visual notes:

- "High-tech blue abstract background."
- "Logo plus text cards."
- "Explain the whole article in labels."
- "Use source screenshot as final image."

## Style Notes For Downstream WeChat

`.luz-crawl` should not write the final article, but it should label the likely narrative mode:

- explainer mode: like a lively science/tech narrator; strong opening scene, then evidence;
- thought-sharing mode: introduce creator/author, summarize original idea, give usable steps;
- story mode: protagonist/discovery/conflict/turning point;
- meme mode: explain why a nickname or hot phrase works, without eating-melon framing;
- caution mode: fun but careful, especially for consciousness, health, finance, privacy, or safety claims.

Record "what must not be exaggerated" for every risky topic.

For benchmark style collection, record concrete writing moves instead of vague praise:

- opening move: question, contradiction, scene, surprising metric, absurd nickname, or direct quote;
- background move: how the writer introduces a person, company, lab, paper, product, or community without becoming a biography;
- explanation move: how jargon is translated into ordinary language;
- humor move: where吐槽 appears and how often;
- evidence move: how sources are mentioned without turning the article into a footnote dump;
- pacing: paragraph length, subtitle use, rhythm between fact and joke;
- article length signal: whether the material deserves S/M/L treatment downstream.

For each candidate topic, record the recommended narrative stance:

- 解说者视角：像新智元/量子位一类科技解说者，先交代人、公司、实验室、产品或论文背景，再讲事件和意义；适合 AI/科技/研究/公司故事。
- 思想分享视角：先介绍作者是谁和原文主张，再整理可执行步骤；适合 Dan Koe 这类创作者爆文。
- 梗感解释视角：解释外号/热梗为什么传神，社媒只提供语气，事实仍靠官方或权威来源。

Also record the suggested article length band and why:

- S 500-700 Chinese characters: one sharp meme, name, or single-point cold fact.
- M 700-950 Chinese characters: one topic with background, source split, and a clear misconception.
- L 950-1200 Chinese characters: strong source depth, creator method, complex research, or company/lab background that genuinely needs space.

Do not recommend long-form treatment just because the topic is popular. Length must follow source density, story layers, reader value, and risk-boundary needs. 1200 Chinese characters is the hard maximum for downstream WeChat articles unless the user explicitly changes the contract.

Do not copy sentences from benchmark accounts into downstream copy. Style samples are for rhythm and structure only; article facts and claims still come from the source map.

## Search Experience To Deposit

After a WeChat-feed crawl, append to:

- `<experience-root>\search-keywords.md`: worked/weak queries, platform wording, people/orgs/communities, next queries;
- `<experience-root>\search-skill-library.md`: tool route, backend, errors, comment/media handling, fallback, source graph seeds.

Do not put internal deposition notes in the downstream WeChat article.
