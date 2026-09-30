# X Browser Extraction

Use this reference when extracting prompt-sharing posts from a logged-in X/Twitter page such as bookmarks. Keep actions read-only. Reuse the already focused browser and tab when possible; keep only one X page/detail open at a time, return to bookmarks or close/release the detail page before opening the next candidate, and avoid accumulating tabs.

## Candidate Extraction

Open bookmarks in the logged-in in-app browser:

```text
https://x.com/i/bookmarks
```

Extract visible timeline articles with one DOM evaluation:

```js
const data = await tab.playwright.evaluate(() => {
  const norm = s => (s || "").replace(/\s+/g, " ").trim();
  const articles = Array.from(document.querySelectorAll("article")).map((a, i) => {
    const statusLinks = Array.from(a.querySelectorAll('a[href*="/status/"]'))
      .map(l => l.href.split("?")[0])
      .filter(h => !/\/(photo|analytics|quotes)(\/|$)/.test(h));
    const status = statusLinks[0] || "";
    const imgs = Array.from(a.querySelectorAll("img"))
      .map(img => ({
        src: img.src,
        alt: img.alt,
        w: img.naturalWidth,
        h: img.naturalHeight
      }))
      .filter(x => x.src.includes("pbs.twimg.com/media/"));
    return { i, status, text: norm(a.innerText).slice(0, 1600), imgs };
  }).filter(x => x.status);
  return { url: location.href, y: window.scrollY, articles };
});
```

Prompt-sharing signals:

```js
/prompt|提示词|GPT Image|Image\s*2|image2|ChatGPT-Image2|Nano Banana|midjourney|reconstruct|生成/i
```

Only open detail pages for candidates whose visible text clearly suggests prompt sharing. Do not open random posts just because they have images. Open one detail page, extract it, then close/release it or navigate the same tab back before moving to another candidate.

## Scrolling

If coordinate scrolling fails with "No element found at point", inspect the viewport:

```js
await tab.playwright.evaluate(() => ({
  w: innerWidth,
  h: innerHeight,
  y: window.scrollY,
  body: document.body.innerText.slice(0, 200)
}));
```

Then scroll from a point inside the viewport, or use DOM scroll:

```js
await tab.cua.scroll({ x: 300, y: 420, scrollY: 520, scrollX: 0 });
```

## Detail Page Extraction

Open the candidate status URL. Capture article text, status links, and media URLs:

```js
const detail = await tab.playwright.evaluate(() => {
  const norm = s => (s || "")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
  const articles = Array.from(document.querySelectorAll("article")).slice(0, 8).map((a, i) => {
    const statusLinks = Array.from(a.querySelectorAll('a[href*="/status/"]'))
      .map(l => l.href.split("?")[0]);
    const imgs = Array.from(a.querySelectorAll("img"))
      .map(img => ({ src: img.src, alt: img.alt, w: img.naturalWidth, h: img.naturalHeight }))
      .filter(x => x.src.includes("pbs.twimg.com/media/"));
    return { i, text: norm(a.innerText), statusLinks: Array.from(new Set(statusLinks)), imgs };
  });
  return { url: location.href.split("?")[0], title: document.title, articles };
});
```

Use `articles[0]` as the main post in normal cases. If the main post says `提示词在评论区`, `Prompt in comments`, or similar, find the author's prompt reply permalink in nearby articles and open it once. Stop if no complete prompt appears quickly.

## Media Rules

- Keep main post images separate from quote-post images and comment-reply images.
- Use the images that belong to the prompt item being saved.
- When a main post contains a quoted post, filter image ownership by each image's closest `a[href*="/photo/"]`. The photo link must contain `/status/{mainStatusId}/photo/`; otherwise it belongs to the quote or a reply.
- Ignore profile images and non-`pbs.twimg.com/media/` URLs.
- Convert thumbnail URLs to original by setting `name=orig`.

## Output Pipeline

1. Create folder with `prepare_output.py --with-images`.
2. Download media with `download_x_media.py`.
3. Render Markdown with `render_prompt_md.py`.
4. Validate with `validate_output.py --require-images`.

For ordinary luz-crawl dossiers, keep media under `raw\images\`. Prompt-library-specific scripts may still use their own category `images` folders.

## Read-Only Guardrails

Do not click:

- Like
- Repost
- Reply
- Follow
- Bookmarked/unbookmark controls
- Analytics controls
- Any dialog that changes account state
