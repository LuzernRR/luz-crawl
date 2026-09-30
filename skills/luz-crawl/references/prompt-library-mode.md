# Prompt Library Mode

Use this reference when the user wants X bookmark prompt-image posts saved in the `prompt-collect-skills` library shape, while using the current `luz-crawl` skill.

## Scope

This mode collects reusable Chinese prompt-image pairs from user-authorized X/Twitter pages, especially bookmarks.

The current `luz-crawl` skill is the implementation source. Existing prompt-library folders may be read to understand category names and Markdown shape, but the crawl, extraction, prompt cleaning, downloading, appending, registry update, and validation must be done by this skill's instructions and scripts only.

Do not call or depend on:

- `prompt-collect-skills` scripts or plugin workflow.
- EdgeBrowserAgent / Luz-browser.
- `collect_x_feed.py`, `collect_prompts.py`, old link queues, old failed-link retry files, old prompt-polish scripts, public readers, X API, fxtwitter, or cached search results.
- Screenshot substitutes when original X images are available.

Use only the current skill's allowed toolchain: Agent Reach health checks, the logged-in browser available in this session, Firecrawl only when currently available, OpenCLI read-only commands when appropriate, and current `luz-crawl` scripts such as `download_x_media.py`.

## Output Root

Write prompt-library results only under:

```text
%USERPROFILE%\Documents\prompt-collect-skills
```

Allowed write targets:

```text
%USERPROFILE%\Documents\prompt-collect-skills\<分类名>\<分类名>.md
%USERPROFILE%\Documents\prompt-collect-skills\<分类名>\images\
%USERPROFILE%\Documents\prompt-collect-skills\00记录\prompt_collection_registry.json
```

Forbidden target:

```text
%USERPROFILE%\Documents\prompt-collect-skills\00二创
```

Do not create numbered task folders in Prompt Library Mode. The library is long-lived by category.

## Category Markdown Format

Each category file is append-only unless repairing a current-run mistake:

```markdown
# 分类名提示词库

- 条目按编号顺序排列。
- 图片按原始字节保存到 images 文件夹。
- 提示词代码块必须是可直接复用的中文文本。

<!-- prompt-collect source=https://x.com/user/status/123 item=123 index=1 -->
## 001. 中文标题

**画面比例**：1:1 方形

**分类**：插画风格

**图片**
<img src="images/001-中文标题-01.jpg" alt="中文标题-01" width="180"> <img src="images/001-中文标题-02.jpg" alt="中文标题-02" width="180">

**提示词**

```text
可直接复用的中文提示词。

画幅比例固定为 1:1 方形。
```

<details><summary>来源信息</summary>

- 原链接：https://x.com/user/status/123
- 作者：@user
- 来源标题：原帖清洗标题
- 采集时间：YYYY-MM-DD HH:mm:ss
- 图片来源：pbs.twimg.com/media 原图

</details>
```

Rules:

- Keep all final prompt text in Chinese.
- Prompt must include an explicit aspect ratio sentence.
- Put images above the prompt block.
- Put multiple images on one Markdown line with the same `width="180"` in category libraries.
- Do not include commentary, trend analysis, unrelated comments, UI text, teaser copy, or raw English prompt as final output.

## Registry Format

Maintain:

```text
%USERPROFILE%\Documents\prompt-collect-skills\00记录\prompt_collection_registry.json
```

Minimum shape:

```json
{
  "version": 1,
  "updated_at": "YYYY-MM-DDTHH:mm:ss+08:00",
  "sources": {
    "https://x.com/user/status/123": {
      "source_url": "https://x.com/user/status/123",
      "tweet_id": "123",
      "status": "ready",
      "title": "中文标题",
      "category": "插画风格",
      "prompt_hash": "sha256-prefix",
      "image_urls": ["https://pbs.twimg.com/media/...&name=orig"],
      "local_images": ["插画风格/images/001-中文标题-01.jpg"],
      "collected_at": "YYYY-MM-DDTHH:mm:ss+08:00"
    }
  },
  "prompt_hash_index": {
    "sha256-prefix": ["https://x.com/user/status/123"]
  },
  "image_url_index": {
    "https://pbs.twimg.com/media/...&name=orig": ["https://x.com/user/status/123"]
  }
}
```

Deduplicate before writing by:

- Normalized status URL: `https://x.com/<handle>/status/<id>`.
- Prompt hash after lowercasing and whitespace normalization.
- Original image URL after setting `name=orig`.
- Same-author repeated reply text.

If any duplicate is found, skip the item and update only the registry note when useful.

## X Bookmarks Workflow

1. Run `agent-reach doctor --json` for platform health.
2. Use the already logged-in browser/session. Reuse the current tab when possible; keep only one X page/detail open at a time.
3. Open `https://x.com/i/bookmarks`.
4. Screen visible cards by text first. Candidate signals include `Prompt:`, `提示词`, `提示词在评论区`, `Prompt in comments`, `GPT Image`, `ChatGPT-Image2`, `Image2`, `Nano Banana`, `reconstruct`, `生成`, and comparable prompt-sharing phrases.
5. Do not open normal AI news, tool lists, articles, opinions, job posts, or image-only showcases unless the visible text clearly indicates a prompt is shared.
6. For one selected candidate, open its detail in the same tab, extract the main article text and its `pbs.twimg.com/media` images.
7. If the main post says the prompt is in comments, make one quick author-reply attempt. If no complete prompt appears, skip; do not keep scrolling.
8. Keep main post images separate from quote-post and reply images. For X quote pages, keep only media whose closest `/photo/` link belongs to the target status.
9. Download image URLs with `name=orig`, verify bytes are JPEG/PNG/WebP, then write category Markdown.
10. Return to bookmarks or close/release the detail before the next candidate.

When the prompt is in an author reply but the images are attached to the parent post, save the parent status URL as the source, use only the parent post's own images, and use the author reply text as the prompt. Do not use the reply URL as the library source unless the reply itself owns the images. This prevents prompt-image pairs from becoming split across different source IDs.

## Prompt Cleaning

The model, not a fixed script, decides whether a prompt is usable.

Allowed cleanup:

- Translate faithful English prompt content into Chinese.
- Remove X UI noise, metrics, author names, timestamps, URLs, quote labels, teaser phrases, and unrelated comments.
- Normalize line breaks, punctuation, list hierarchy, and code-block formatting.
- Add a short aspect-ratio sentence when missing, based on the source image shape or explicit source text.
- Add minimal missing generation constraints only when the source prompt is too thin but the source image and text clearly prove the intended visual task.

Forbidden cleanup:

- Do not invent a new subject, style, scene, brand, or structure.
- Do not keep pure English as final prompt text.
- Do not save `Prompt in comments`, `提示词见评论区`, `Show more`, or incomplete teaser text as a prompt.
- Do not save garbled text, placeholders, `XX`, `某某`, unresolved template fields, API errors, login-wall text, or unrelated comments.

## Category Guidance

Use existing top-level categories where possible:

- `插画风格`: illustration, doodle, vector, flat, hand-drawn, character style.
- `设计师通用`: layout systems, moodboards, storyboards, generic design methods, visual frameworks.
- `电商零售`: product ads, packaging, product detail pages, retail posters.
- `电影海报`: film posters, cinematic key visuals, trailers, drama boards.
- `人像写真`: portraits, fashion portraits, avatar/photo styles.
- `建筑空间`: interior, architecture, spatial scenes.
- `餐饮美食`: food photography, menus, drink ads.
- `服饰美妆`: fashion, beauty, cosmetics, outfit visuals.
- `教育培训`: teaching cards, learning diagrams, course visuals.
- `文旅城市`: city, travel, map, destination visuals.
- `文娱IP`: IP characters, games, comics, fandom visuals.
- `医疗健康`: health, medical, wellness visuals.
- `体育赛事`: sports visuals, event posters.

Create a new category only when no existing category fits.

## Validation Checklist

Before finishing:

- Category Markdown exists and contains the new item.
- Every referenced local image exists, is non-empty, and has recognizable image bytes.
- Image references use category-relative paths such as `images/001-title-01.jpg`.
- Final prompt is Chinese, direct, reusable, and includes aspect ratio.
- Registry contains source URL, prompt hash, image URL index, local images, category, and status.
- No files under `00二创` changed.
- No legacy prompt-collect plugin/script was called.
