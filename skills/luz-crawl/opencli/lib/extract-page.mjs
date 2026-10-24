// This function is serialized into the real browser page. Keep it free of module dependencies.
export function extractPage({ platform, requestedURL, comments = false, includePresentation = true, articleMedia = {}, observedVideos = [], isSearch = false }) {
  const first = (selectors, parent = document) => selectors.map((selector) => parent?.querySelector(selector)).find(Boolean);
  const text = (element) => (typeof element?.innerText === 'string' ? element.innerText : element?.textContent || '').trim();
  const visible = (element) => Boolean(element && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
  const selectors = {
    x: ['[data-testid="primaryColumn"]', 'main'],
    xhs: ['.note-container', '#noteContainer', '.note-detail-mask', 'main'],
    wechat: ['#js_article', '#img-content'],
    douyin: ['[data-e2e="video-detail"]', '[data-e2e="feed-active-video"]', 'main', '[data-e2e="detail-video-info"]'],
    youtube: ['ytd-watch-flexy', 'ytd-search', 'main'],
    bilibili: ['.video-page-v3', '#app', 'main'],
    tiktok: ['[data-e2e="browse-video"]', '[data-e2e="browse-video-desc"]', 'main'],
    reddit: ['main', '.content', 'shreddit-post', '#siteTable'],
    zhihu: ['.AnswerCard', '.Post-Main', '.Question-mainColumn', 'main'],
    douban: ['#content', '.article'],
    github: ['main', 'article.markdown-body', '.markdown-body'],
    csdn: ['main', '#article_content', '#content_views'],
    cnblogs: ['#cnblogs_post_body', '#mainContent'],
    juejin: ['.article-content', 'main'],
    stackoverflow: ['#question', '#answers', 'main'],
    web: ['article', 'main', '[role="main"]'],
  };
  const root = first(selectors[platform] || selectors.web) || document.body || document.documentElement;
  const body = text(document.body);
  const content = text(root);
  const pageURL = location.href;
  const wantedID = requestedURL.match(/\/status\/(\d+)/)?.[1];
  let loadedTarget, playerData;
  if (!isSearch && platform === 'bilibili') {
    const id = requestedURL.match(/\/video\/(BV[a-zA-Z0-9]{10}|av\d+)/)?.[1];
    const video = window.__INITIAL_STATE__?.videoData;
    if (id && video && (video.bvid === id || `av${video.aid}` === id)) { loadedTarget = video; playerData = window.__playinfo__?.data; }
  }
  if (!isSearch && platform === 'xhs') {
    const id = requestedURL.match(/\/(?:explore|discovery\/item|search_result)\/([^/?#]+)/)?.[1];
    const note = id && window.__INITIAL_STATE__?.note?.noteDetailMap?.[id]?.note;
    if (note && (note.noteId || note.id) === id) loadedTarget = note;
  }
  if (!isSearch && platform === 'tiktok') {
    try {
      const data = JSON.parse(document.querySelector('#__UNIVERSAL_DATA_FOR_REHYDRATION__')?.textContent || '{}');
      const video = data.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct;
      if (video?.id && video.id === requestedURL.match(/\/(?:video|photo)\/(\d+)/)?.[1]) loadedTarget = video;
    } catch {}
  }
  const items = [];
  let targetArticle;
  let longformContainer;
  let bodyRoot;
  let articleTitle = '';
  let bodyConfirmed = Boolean(document.body);
  if (platform === 'x') {
    for (const article of root.querySelectorAll('article[data-testid="tweet"]')) {
      const time = article.querySelector('time');
      const permalink = time?.closest('a')?.href || [...article.querySelectorAll('a[href*="/status/"]')].map((item) => item.href).find((href) => /\/status\/\d+$/.test(href));
      const id = permalink?.match(/\/status\/(\d+)/)?.[1];
      if (!id) continue;
      if (id === wantedID) targetArticle = article;
      const value = text(article.querySelector('[data-testid="tweetText"]'));
      items.push({ id, url: permalink, author: permalink.match(/x\.com\/([^/]+)/)?.[1] || text(article.querySelector('[data-testid="User-Name"]')), time: time?.dateTime || '', text: value,
        kind: id === wantedID ? 'target_post' : 'thread_or_reply', truncated: Boolean(article.querySelector('[data-testid="tweet-text-show-more-link"]')), metrics_text: text(article.querySelector('[role="group"]')) });
    }
    longformContainer = root.querySelector('[data-testid="twitterArticleReadView"]');
    articleTitle = text(root.querySelector('[data-testid="twitter-article-title"]'));
    const longform = first(['[data-testid="twitterArticleRichTextView"]', '[data-testid="longformRichTextComponent"]'], longformContainer || root) || (longformContainer && (longformContainer.querySelector('.DraftEditor-root') || longformContainer));
    bodyRoot = longform;
    const articleSourceID = [...(longformContainer?.querySelectorAll('a[href*="/status/"]') || [])].map((link) => link.href.match(/\/status\/(\d+)/)?.[1]).find((id) => id === wantedID);
    if (longform && text(longform)) items.unshift({ id: `article:${pageURL}`, url: pageURL, kind: 'article', text: text(longform), title: articleTitle, source_status_id: articleSourceID || (targetArticle ? wantedID : undefined), author: text(root.querySelector('[data-testid="User-Name"]')) });
    if (/\/i\/article\//.test(pageURL) && !longform && root.querySelector('article:not([data-testid="tweet"])')) items.unshift({ id: `article:${pageURL}`, url: pageURL, kind: 'article', text: text(root.querySelector('article:not([data-testid="tweet"])')) });
  } else {
    const bodySelectors = {
      xhs: ['#detail-desc', '.note-text', '.desc'], wechat: ['#js_content'],
      youtube: ['#description-inline-expander', 'ytd-text-inline-expander', '#description'],
      bilibili: ['#v_desc .basic-desc-info', '.basic-desc-info', '.desc-info-text', '.video-desc'],
      tiktok: ['[data-e2e="browse-video-desc"]', '[data-e2e="video-desc"]'],
      reddit: ['[slot="text-body"]', '[data-post-click-location="text-body"]', '.usertext-body'],
      zhihu: ['.RichContent-inner .RichText', '.Post-RichText', '.RichText'],
      douban: ['.topic-content', '#link-report', '.review-content', '.article'],
      douyin: ['[data-e2e="video-desc"]', '[data-e2e="detail-video-info"]', 'h1'],
      web: ['article', 'main', '[role="main"]'],
      github: ['article.markdown-body', '.markdown-body', '.react-code-lines', 'pre'],
      csdn: ['#article_content', '#content_views'],
      cnblogs: ['#cnblogs_post_body'],
      juejin: ['.article-content'],
      stackoverflow: ['.js-post-body', '.s-prose'],
    };
    const postContext = platform === 'reddit' && !isSearch ? root.querySelector('shreddit-post, .thing.link') || root : root;
    const article = first(bodySelectors[platform] || bodySelectors.web, postContext) || (platform === 'reddit' ? first(['[slot="title"]', '.top-matter .title'], postContext) || postContext : root);
    bodyRoot = article;
    const expectedDetail = !isSearch && (platform === 'xhs' && /\/(explore|discovery\/item|search_result)\/[^/?]+/.test(requestedURL) || platform === 'wechat' && /mp\.weixin\.qq\.com\/s(?:[/?]|$)/.test(pageURL) || platform === 'youtube' && /watch\?v=|youtu\.be\//.test(requestedURL) || platform === 'zhihu' && /\/answer\/|zhuanlan\.zhihu\.com\/p\//.test(requestedURL));
    if (expectedDetail) bodyConfirmed = article !== root || (platform === 'wechat' && article.id === 'js_content');
    if (!isSearch && platform === 'bilibili' && /\/video\//.test(requestedURL)) bodyConfirmed = Boolean(loadedTarget && root.querySelector('h1.video-title') && root.querySelector('video, #bilibili-player, .bpx-player-container'));
    if (!isSearch && platform === 'tiktok' && /\/(?:video|photo)\//.test(requestedURL)) bodyConfirmed = Boolean(loadedTarget && (document.querySelector('video') || loadedTarget.imagePost));
    if (platform === 'reddit' && !isSearch) {
      const id = requestedURL.match(/\/comments\/([^/]+)/)?.[1];
      bodyConfirmed = postContext.matches('shreddit-post, .thing.link') && (!id || [postContext.id.replace(/^thing_/, ''), postContext.getAttribute('data-fullname')].includes(`t3_${id}`) || postContext.getAttribute('permalink')?.includes(`/comments/${id}/`));
    }
    const value = platform === 'bilibili' && loadedTarget ? [text(root.querySelector('h1.video-title')), text(article)].filter(value => value && value !== '-').join('\n\n') : platform === 'tiktok' && bodyConfirmed ? loadedTarget.desc || text(article) : text(article);
    if (value) items.push({ id: pageURL, url: pageURL, kind: !bodyConfirmed ? 'page_shell' : ['youtube', 'douyin', 'bilibili', 'tiktok'].includes(platform) ? 'video_description' : 'page_body', text: value,
      author: document.querySelector('meta[name="author"]')?.content || text(first(['#js_name', '.author .username', '[slot="authorName"]', '#channel-name'])),
      time: root.querySelector('time')?.dateTime || document.querySelector('meta[property="article:published_time"]')?.content || '' });
    if (comments) {
      const commentSelectors = { xhs: '.comment-item', reddit: 'shreddit-comment', youtube: 'ytd-comment-thread-renderer', zhihu: '.CommentItem, [class*="CommentItem"]', douban: '.comment-item, .reply-item, .topic-reply', douyin: '[data-e2e="comment-item"]', weibo: '[class*="CommentItem"], .list_li', github: '.timeline-comment', stackoverflow: '.comment' };
      if (commentSelectors[platform]) for (const item of root.querySelectorAll(commentSelectors[platform])) {
        if (visible(item) && text(item)) items.push({ id: item.id || item.getAttribute('thingid') || `comment:${text(item)}`, kind: 'comment', text: text(item), url: pageURL });
      }
    }
  }
  const transcript = [...document.querySelectorAll('ytd-transcript-segment-renderer')].map((item) => ({ time: text(item.querySelector('.segment-timestamp')), text: text(item.querySelector('.segment-text')) })).filter((item) => item.text);
  const sourceRoot = platform === 'x' && wantedID ? (longformContainer || targetArticle) : root;
  let presentation;
  if (includePresentation && sourceRoot && (platform !== 'x' || longformContainer || targetArticle)) {
    const styled = sourceRoot.cloneNode(true);
    const properties = ('display position top right bottom left z-index box-sizing width height min-width max-width min-height max-height margin-top margin-right margin-bottom margin-left padding-top padding-right padding-bottom padding-left border-top border-right border-bottom border-left border-radius overflow overflow-x overflow-y flex-direction flex-wrap flex-grow flex-shrink flex-basis align-items align-self justify-content gap row-gap column-gap grid-template-columns grid-column grid-row font-family font-size font-weight font-style line-height letter-spacing text-align text-decoration text-transform text-indent white-space word-break overflow-wrap color background-color background-image background-size background-position background-repeat opacity object-fit object-position vertical-align list-style-type list-style-position list-style-image border-collapse border-spacing table-layout transform').split(' ');
    const css = (style) => properties.map((key) => `${key}:${style.getPropertyValue(key)}`).join(';');
    const assets = new Map();
    const pseudoCSS = [];
    const originalNodes = [sourceRoot, ...sourceRoot.querySelectorAll('*')];
    const cloneNodes = [styled, ...styled.querySelectorAll('*')];
    for (let index = 0; index < originalNodes.length; index++) {
      const source = originalNodes[index], clone = cloneNodes[index];
      clone.setAttribute('style', css(getComputedStyle(source)));
      for (const pseudo of ['::before', '::after']) {
        const style = getComputedStyle(source, pseudo);
        if (style.content && !['none', 'normal', '""'].includes(style.content)) {
          clone.setAttribute('data-luz-node', String(index));
          pseudoCSS.push(`[data-luz-node="${index}"]${pseudo}{content:${style.content};${css(style)}}`);
        }
      }
      for (const key of ['href', 'src', 'poster']) if (source.hasAttribute(key)) {
        const value = source[key]?.baseVal || source[key];
        if (typeof value === 'string' && /^https?:\/\//.test(value)) clone.setAttribute(key, value);
        else if (!(source.tagName === 'IMG' && /^data:image\//.test(value))) clone.removeAttribute(key);
      }
      clone.removeAttribute('srcset'); clone.removeAttribute('loading');
      if (source.tagName === 'IMG' && /^https?:\/\//.test(source.currentSrc || source.src)) {
        clone.setAttribute('src', source.currentSrc || source.src);
        assets.set(source.currentSrc || source.src, { kind: 'image', url: source.currentSrc || source.src });
      }
      for (const match of getComputedStyle(source).backgroundImage.matchAll(/url\(["']?(https?:\/\/[^"')]+)["']?\)/g)) assets.set(match[1], { kind: 'image', url: match[1] });
    }
    // The page's own Article response contains media URLs even while its DOM has image placeholders.
    for (const link of styled.querySelectorAll('a[href*="/article/"][href*="/media/"]')) {
      const id = link.href.match(/\/media\/(\d+)/)?.[1];
      const asset = articleMedia[id];
      if (!asset || !/^https:\/\/pbs\.twimg\.com\//.test(asset.url) || link.querySelector('img[src],video,source')) continue;
      const image = document.createElement('img'); image.src = asset.url; image.alt = asset.alt || 'Image';
      image.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block');
      link.style.position = 'relative'; link.appendChild(image);
      assets.set(asset.url, { kind: 'image', url: asset.url });
    }
    for (const item of styled.querySelectorAll('script, style, noscript, iframe, object, embed, form, input, textarea, select, button, meta, link, base, foreignObject, animate, set')) item.remove();
    if (longformContainer) for (const group of styled.querySelectorAll('[role="group"]')) {
      if (!group.closest('[data-testid="twitterArticleRichTextView"], [data-testid="longformRichTextComponent"]')) group.remove();
    }
    for (const item of [styled, ...styled.querySelectorAll('*')]) {
      for (const attribute of [...item.attributes]) if (/^on/i.test(attribute.name) || /^(value|srcdoc|nonce|autofocus|contenteditable|autoplay)$/i.test(attribute.name) || (/^(href|src|poster|xlink:href)$/i.test(attribute.name) && !/^(https?:\/\/|data:image\/|#)/i.test(attribute.value))) item.removeAttribute(attribute.name);
      if (item.tagName === 'A') { item.setAttribute('target', '_blank'); item.setAttribute('rel', 'noopener noreferrer'); }
    }
    const fonts = [];
    const fontRules = (rules) => { for (const rule of rules) { if (rule.type === CSSRule.FONT_FACE_RULE) fonts.push(rule.cssText); else if (rule.cssRules) fontRules(rule.cssRules); } };
    for (const sheet of document.styleSheets) { try { fontRules(sheet.cssRules); } catch {} }
    for (const rule of fonts) for (const match of rule.matchAll(/url\(["']?(https?:\/\/[^"')]+)["']?\)/g)) assets.set(match[1], { kind: 'font', url: match[1] });
    let background = 'rgb(255, 255, 255)';
    for (let element = sourceRoot; element; element = element.parentElement) {
      const color = getComputedStyle(element).backgroundColor;
      if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') { background = color; break; }
    }
    const viewerLinks = [...sourceRoot.querySelectorAll('a[href*="/article/"][href*="/media/"]')];
    presentation = { kind: longformContainer ? 'x_article' : 'rendered_dom', html: styled.outerHTML, styles: pseudoCSS.join('\n'), fonts, assets: [...assets.values()], width: Math.round(sourceRoot.getBoundingClientRect().width), background, color: getComputedStyle(sourceRoot).color, lang: document.documentElement.lang,
      text_chars: text(bodyRoot || sourceRoot).length, media_pending: viewerLinks.filter((link) => !link.querySelector('img[src],video[src],source[src]') && !articleMedia[link.href.match(/\/media\/(\d+)/)?.[1]]).length,
      ready: Boolean(longformContainer && text(bodyRoot).length && items.some((item) => item.kind === 'article' && (!wantedID || item.source_status_id === wantedID)) && !bodyRoot.querySelector('[aria-busy="true"], [role="progressbar"]') && !root.querySelector('[data-testid="tweet-text-show-more-link"]')) };
  }
  const media = [...(sourceRoot?.querySelectorAll('img, video, audio, source') || [])].map((item) => ({ kind: item.tagName.toLowerCase(), url: item.currentSrc || item.src || item.getAttribute('data-src') || '', alt: item.alt || '', poster: item.poster || '', viewer_url: item.closest('a[href*="/article/"][href*="/media/"]')?.href || '', loaded: item.tagName === 'IMG' ? item.complete && item.naturalWidth > 0 : item.readyState > 1 })).filter((item) => /^https?:\/\//.test(item.url));
  const links = [...(sourceRoot?.querySelectorAll('a[href]') || [])].map((item) => ({ url: item.href, text: text(item) })).filter((item) => /^https?:\/\//.test(item.url));
  if (platform === 'x') for (const link of links.filter((item) => /\/article\/\d+\/media\/\d+/.test(item.url))) {
    media.push({ kind: 'media_viewer', url: link.url, loaded: false, alt: '', note: 'Media viewer link observed; binary media URL not present in rendered DOM.' });
    const asset = articleMedia[link.url.match(/\/media\/(\d+)/)?.[1]];
    if (asset) media.push({ kind: 'img', url: asset.url, viewer_url: link.url, alt: asset.alt || '', loaded: false, source: 'observed_article_response' });
  }
  const articleLinks = platform === 'x' && wantedID ? links.filter((item) => /https:\/\/(?:www\.)?(?:x|twitter)\.com\/i\/article\/\d+/.test(item.url)).map((item) => item.url) : [];
  const gateDialog = [...document.querySelectorAll('[role="dialog"], .login-container, .login-modal, [class*="loginModal"], [class*="LoginModal"]')].filter(visible).map(text).join('\n');
  let gate = null;
  if (platform === 'xhs' && /请打开小红书App扫码查看/i.test(body)) gate = 'verification_required';
  else if (/\/(404|notfound|error)(?:[/?]|$)/i.test(location.pathname) || /^(?:404|410)(?:页面|\s*[-:|]?\s*(?:page|not found|error))|你访问的页面不见了|页面不存在|page not found/i.test(document.title)) gate = 'unavailable';
  else if ([...document.querySelectorAll('iframe[src*="captcha"], iframe[src*="challenge"], #challenge-running, .geetest_panel')].some(visible) || /^(验证|安全验证|安全检查|Just a moment|Human verification)/i.test(document.title) || /\/nocaptcha(?:[/?]|$)/i.test(location.pathname) || (content.length < 2000 && /完成验证|拖动滑块|请进行安全验证|verify you are human|checking your browser/i.test(content))) gate = 'verification_required';
  else if (/\/(?:i\/flow\/login|login|signin|passport)(?:[/?]|$)/i.test(location.pathname + location.hash) || (gateDialog && /登录|登入|sign in|log in/i.test(gateDialog))) gate = 'login_required';
  else if ([...document.querySelectorAll('input[type="password"]')].some(visible) && !document.querySelector('article')) gate = 'login_required';
  else if (content.length < 1800 && /请(?:先)?登录后|登录后(?:查看|使用|访问)|扫码(?:即可)?登录|sign in to continue|log in to continue/i.test(content) && !(bodyRoot !== root && text(bodyRoot).length > 500)) gate = 'login_required';
  else if (content.length < 1500 && /rate limit exceeded|too many requests|操作频繁|访问过于频繁|请求过于频繁/i.test(content)) gate = 'rate_limited';
  else if (content.length < 4000 && /access denied|403 forbidden|request rejected|拒绝访问|禁止访问|you(?:'ve| have) been blocked|blocked your request/i.test(document.title + '\n' + content)) gate = 'access_denied';
  else if (content.length < 1000 && /this post was deleted|this post is unavailable|帖子已删除|内容已删除|笔记不存在|内容不存在|该内容无法查看|account suspended|this account doesn.t exist|page not found/i.test(content)) gate = 'unavailable';
  const metric = (node) => {
    const label = node?.getAttribute('aria-label') || '';
    const raw = (/\d/.test(label) ? label : text(node) || label).trim();
    const match = raw.match(/(-?[\d,]+(?:\.\d+)?)\s*(万|亿|[kmb](?![a-z]))?/i);
    const units = { 万: 1e4, 亿: 1e8, k: 1e3, m: 1e6, b: 1e9 };
    return { value: match ? Number(match[1].replaceAll(',', '')) * (units[(match[2] || '').toLowerCase()] || 1) : null, raw, approximate: Boolean(match?.[2]) };
  };
  const account = (node, fallback = '') => {
    const names = { x: ['[data-testid="User-Name"] a span'], xhs: ['.author-wrapper .name', '.author .name', '.author .username', '.author-container .username', '.user-name'], zhihu: ['.AuthorInfo-name .UserLink-link', '.AuthorInfo-name', '.UserLink-link', 'a[href*="/people/"]:not(:has(img))'], douban: ['.note-author a', '.topic-doc h3 a', '.from a', '.user-name a', 'h4 a', '.pubdate a'], youtube: ['#channel-name a', '#author-text'], reddit: ['[slot="authorName"]', '[data-testid="comment_author_link"]', 'a.author', 'a[href*="/user/"]:not(:has(img))'], douyin: ['[data-e2e="detail-user-name"]', '[data-e2e="user-title"]', '.user-name', 'a[href*="/user/"]:not([href*="/user/self"]):not(:has(img))'], weibo: ['a[class*="head_name"]', 'a[class*="Head_name"]', '.name'] };
    const element = first(names[platform] || ['[rel="author"]'], node);
    const link = element?.closest('a') || element?.querySelector('a');
    const fallbackHandle = fallback.match(/@([a-z\d_]+)/i)?.[1] || (/^[a-z\d_]+$/i.test(fallback) ? fallback : '');
    const handle = platform === 'x' ? link?.href?.match(/(?:x|twitter)\.com\/([^/?#]+)/)?.[1] || fallbackHandle : (platform === 'youtube' ? link?.href?.match(/\/@([^/?#]+)/)?.[1] : '') || link?.href?.match(/\/(?:user\/profile|people|u|channel|user)\/([^/?#]+)/)?.[1] || '';
    const nameElement = platform === 'douyin' ? element?.querySelector('[data-click-from="title"] > span') || element : element;
    return { name: text(nameElement).split('\n')[0] || fallback || null, handle: handle || null, profile_url: link?.href && /^https?:\/\//.test(link.href) ? link.href : platform === 'x' && handle ? `https://x.com/${handle}` : null };
  };
  const engagementSelectors = {
    x: { likes: ['[data-testid="like"]', '[data-testid="unlike"]'], comments: ['[data-testid="reply"]'], favorites: ['[data-testid="bookmark"]', '[data-testid="removeBookmark"]'], shares: ['[data-testid="retweet"]', '[data-testid="unretweet"]'], views: ['a[href*="/analytics"]'] },
    xhs: { likes: ['.interact-container .like-wrapper .count', '.interact-container .like-container .count', '.like-wrapper .count'], favorites: ['.collect-wrapper .count', '.collect-container .count'], comments: ['.chat-wrapper .count', '.comment-wrapper .count'] },
    zhihu: { likes: ['.VoteButton--up', 'button.VoteButton:not(.VoteButton--down)'], comments: ['button[aria-label*="评论"]', '.ContentItem-action'], favorites: ['button[aria-label*="收藏"]'] },
    douban: { likes: ['.like-num', '.react-like .count', '.react-like', '.action-react-like'], favorites: ['.fav-num'], comments: ['.comments-count', '#comments .pl', '.topic-reply-count'] },
    youtube: { likes: ['ytd-segmented-like-dislike-button-renderer button[aria-label]', 'like-button-view-model button'], comments: ['ytd-comments-header-renderer #count'], views: ['#info-text'] },
    reddit: { likes: ['[score]', '.thing.link .score.unvoted'], comments: ['[comment-count]', '.thing.link .comments'] },
    douyin: { likes: ['[data-e2e="video-player-digg"]'], comments: ['[data-e2e="video-player-comment"]', '[data-e2e="feed-comment-icon"]'], favorites: ['[data-e2e="video-player-collect"]'], shares: ['[data-e2e="video-player-share"]'] },
    weibo: { likes: ['button[title*="赞"]', '[class*="woo-like-count"]'], comments: ['[aria-label*="评论"]'], shares: ['[aria-label*="转发"]'] },
  };
  const postRoot = platform === 'x' ? longformContainer || targetArticle : root;
  const bodyItem = items.find((item) => item.kind === 'article' || item.id === wantedID || item.kind === 'page_body' || item.kind === 'video_description') || (bodyConfirmed && ['xhs', 'youtube', 'douyin'].includes(platform) ? { text: '' } : null);
  let post = null;
  const extractedComments = [];
  if (!isSearch && postRoot && bodyConfirmed && bodyItem && !gate) {
    const mediaRoot = platform === 'youtube' ? postRoot.querySelector('#player') || bodyRoot : platform === 'reddit' ? postRoot.querySelector('shreddit-post, .thing.link') || bodyRoot : ['douyin', 'zhihu', 'douban', 'wechat', 'csdn', 'github', 'cnblogs', 'juejin', 'stackoverflow'].includes(platform) ? bodyRoot : postRoot;
    let imageSources;
    if (platform === 'bilibili' && loadedTarget) imageSources = [{ url: loadedTarget.pic, alt: loadedTarget.title, source: 'observed_video_cover' }];
    if (platform === 'xhs' && loadedTarget?.imageList?.length) imageSources = loadedTarget.imageList.map(image => ({url:image.urlDefault || image.urlPre,alt:loadedTarget.title,source:'observed_target_page_data'}));
    if (platform === 'tiktok' && loadedTarget) imageSources = loadedTarget.imagePost?.images?.map(image => ({url:image.imageURL?.urlList?.[0] || '',alt:loadedTarget.desc})) || [{url:loadedTarget.video?.cover || loadedTarget.video?.originCover || '',alt:loadedTarget.desc,source:'observed_video_cover'}];
    const images = (imageSources || (platform === 'youtube' ? [{ url: document.querySelector('meta[property="og:image"]')?.content || '', alt: document.title, source: 'observed_video_cover' }] : [...mediaRoot.querySelectorAll('img')].filter((node) => !node.closest('[data-testid*="UserAvatar"], [slot="credit-bar"], .avatar, .author, .comment-item, .comments-list, .topic-reply, .reply-item')).map((node) => ({ url: node.currentSrc || node.src || node.dataset.src || '', alt: node.alt || '' })))).filter((item) => /^https?:\/\//.test(item.url || '') && !(platform === 'xhs' && /^https?:\/\/sns-avatar[^/]*\.xhscdn\.com\/avatar\//.test(item.url)) && !(platform === 'douban' && /^https?:\/\/[^/]*doubanio\.com\/icon\/up/.test(item.url))).map(item => ({...item,url:item.url.replace(/^http:/,'https:')}));
    for (const item of Object.values(articleMedia)) if (!images.some((image) => image.url === item.url)) images.push({ url: item.url, alt: item.alt || '', source: 'observed_article_response' });
    const videos = [...(platform === 'douyin' ? postRoot : mediaRoot).querySelectorAll('video')].map((node) => ({ url: node.currentSrc || node.src || node.querySelector('source')?.src || '', poster: node.poster || '', direct: /^https?:\/\//.test(node.currentSrc || node.src || node.querySelector('source')?.src || '') })).filter(item => /^(https?:\/\/|blob:)/.test(item.url));
    let targetVideo;
    if (platform === 'bilibili' && playerData?.dash && !playerData.is_drm) {
      const dash = playerData.dash;
      const video = (dash.video || []).filter(item => item.codecid === 7 && item.height <= 720).sort((a,b) => b.height - a.height)[0];
      const audio = (dash.audio || []).find(item => /mp4a/.test(item.codecs || ''));
      // The primary address can be a peer CDN; use an official fallback already supplied by this player.
      const streamURL = item => [item?.baseUrl, item?.base_url, ...(item?.backupUrl || item?.backup_url || [])].find(url => /^https:\/\/[^/]+\.bilivideo\.com\//.test(url || ''));
      const url = streamURL(video);
      const audioURL = streamURL(audio);
      if (/^https:\/\/[^/]+\.bilivideo\.com\//.test(url || '') && /^https:\/\/[^/]+\.bilivideo\.com\//.test(audioURL || '')) targetVideo = {url,audio_url:audioURL,mime:'video/mp4',height:video.height,source:'observed_target_player_streams'};
    }
    if (platform === 'xhs' && loadedTarget?.video?.media?.video?.drmType === 0) {
      const stream = loadedTarget.video.media.stream;
      const video = [...(stream?.h264 || []), ...(stream?.EF4 || [])].filter(item => item.format === 'mp4').sort((a,b) => b.height - a.height)[0];
      const url = video?.masterUrl;
      if (/^https?:\/\/[^/]+\.xhscdn\.com\//.test(url || '')) targetVideo = {url:url.replace(/^http:/,'https:'),height:video.height,source:'observed_target_player_streams'};
    }
    if (platform === 'tiktok' && loadedTarget?.video) {
      const url = loadedTarget.video.PlayAddrStruct?.UrlList?.[0] || loadedTarget.video.playAddr;
      if (/^https:\/\/[^/]+\.(?:tiktok\.com|tiktokcdn\.com)\//.test(url || '')) targetVideo = {url,height:loadedTarget.video.height,source:'observed_target_player_streams'};
    }
    if (targetVideo) videos.splice(0, videos.length, {...targetVideo,direct:true});
    for (const video of videos) if (/^https?:\/\//.test(video.poster) && !images.some(image => image.url === video.poster)) images.push({url:video.poster,alt:'',source:'observed_video_cover'});
    for (const item of observedVideos) if (!videos.some((video) => video.url === item.url)) videos.push({ ...item, direct: true });
    const engagement = Object.fromEntries(['likes', 'comments', 'favorites', 'shares', 'views'].map((key) => {
      const element = first(engagementSelectors[platform]?.[key] || [], postRoot);
      if (platform === 'zhihu' && key === 'comments') {
        const count = text(postRoot.querySelector('.Comments-container')).match(/[\d,.万亿]+\s*条评论/)?.[0];
        if (count) return [key, metric({ getAttribute: () => count })];
      }
      if (key === 'likes' && element?.hasAttribute('score')) return [key, metric({ getAttribute: () => element.getAttribute('score') })];
      if (key === 'comments' && element?.hasAttribute('comment-count')) return [key, metric({ getAttribute: () => element.getAttribute('comment-count') })];
      return [key, metric(element)];
    }));
    post = { id: wantedID || pageURL.match(/\/(?:explore|search_result|answer|video|topic|note)\/([^/?#]+)/)?.[1] || pageURL, url: pageURL, title: articleTitle || document.title, text: bodyItem.text, account: account(postRoot, bodyItem.author || ''), engagement, images, videos, content_present: Boolean(bodyItem.text?.trim() || images.length || videos.length), scope: videos.length ? 'visible_post_and_video_metadata' : 'visible_post' };
    if (platform === 'bilibili' && loadedTarget) post.account = {name:loadedTarget.owner?.name || post.account.name,handle:String(loadedTarget.owner?.mid || '') || null,profile_url:loadedTarget.owner?.mid ? `https://space.bilibili.com/${loadedTarget.owner.mid}` : null};
    if (platform === 'tiktok' && loadedTarget) post.account = {name:loadedTarget.author?.nickname || null,handle:loadedTarget.author?.uniqueId || null,profile_url:loadedTarget.author?.uniqueId ? `https://www.tiktok.com/@${loadedTarget.author.uniqueId}` : null};
    const counts = platform === 'bilibili' ? loadedTarget?.stat : platform === 'tiktok' ? loadedTarget?.stats : null;
    if (counts) for (const [key, field] of Object.entries(platform === 'bilibili' ? {likes:'like',comments:'reply',favorites:'favorite',shares:'share',views:'view'} : {likes:'diggCount',comments:'commentCount',favorites:'collectCount',shares:'shareCount',views:'playCount'})) {
      if (counts[field] !== undefined && /^\d+$/.test(String(counts[field]))) post.engagement[key] = {...metric({getAttribute:()=>String(counts[field])}),source:'observed_target_page_data'};
    }
  }
  if (comments && platform === 'x') for (const node of root.querySelectorAll('article[data-testid="tweet"]')) {
    const permalink = node.querySelector('time')?.closest('a')?.href;
    const id = permalink?.match(/\/status\/(\d+)/)?.[1];
    if (!id || id === wantedID) continue;
    const value = text(node.querySelector('[data-testid="tweetText"]'));
    if (value) extractedComments.push({ id, url: permalink, text: value, account: account(node, permalink.match(/(?:x|twitter)\.com\/([^/]+)/)?.[1] || ''), likes: metric(first(['[data-testid="like"]', '[data-testid="unlike"]'], node)), time: node.querySelector('time')?.dateTime || null, scope: 'loaded_thread_item' });
  }
  if (comments && platform !== 'x') {
    const selector = { xhs: '.comment-item', zhihu: '.CommentItem, [class*="CommentItem"], .Comments-container .CommentContent', douban: '.comment-item, .reply-item, .topic-reply', reddit: 'shreddit-comment, .thing.comment', youtube: 'ytd-comment-thread-renderer', douyin: '[data-e2e="comment-item"]', weibo: '[class*="CommentItem"], .list_li', github: '.timeline-comment', stackoverflow: '.comment' }[platform];
    const contentSelectors = { xhs: ['.content .note-text', '.note-text', '.content'], zhihu: ['.CommentRichText', '.CommentContent', '.RichText', '[class*="CommentContent"]'], douban: ['.reply-content', '.comment-text', '.content'], reddit: ['[slot="comment"]', '.usertext-body'], youtube: ['#content-text'], douyin: ['[data-e2e="comment-text"]', '.comment-item-content', '[class*="comment-content"]'], github: ['.comment-body'], stackoverflow: ['.comment-copy'] };
    const commentRoot = ['zhihu', 'youtube', 'reddit'].includes(platform) ? document : root;
    if (selector) for (const node of commentRoot.querySelectorAll(selector)) {
      if (!visible(node)) continue;
      if (platform === 'zhihu' && node.closest('[class*="CommentItem"]') && node.closest('[class*="CommentItem"]') !== node) continue;
      let container = node;
      if (platform === 'zhihu' && node.classList.contains('CommentContent')) for (let depth = 0; depth < 4 && container.parentElement && !container.querySelector('a[href*="/people/"]'); depth++) container = container.parentElement;
      const douyinBody = platform === 'douyin' ? container.querySelector('.comment-item-info-wrap')?.nextElementSibling : null;
      const value = text(first(contentSelectors[platform] || ['.content'], container) || douyinBody || node);
      if (value) extractedComments.push({ id: container.id || container.getAttribute('thingid') || (platform === 'douyin' ? container.querySelector('[id^="tooltip_"]')?.id.replace(/^tooltip_/, '') : null) || `comment:${value}`, url: pageURL, text: value, account: account(container), likes: metric(first(['.like-wrapper .count', '.like .count', '#vote-count-middle', '[aria-label*="赞"]', '.comment-item-stats-container p'], container)), time: container.querySelector('time')?.dateTime || text(first(['.date', '.time'], container) || douyinBody?.nextElementSibling) || null, scope: 'loaded_visible_comment' });
    }
  }
  const clone = root.cloneNode(true);
  for (const item of clone.querySelectorAll('script, style, noscript, iframe, object, embed, form, input, textarea, select, button, meta, link, base')) item.remove();
  for (const item of [clone, ...clone.querySelectorAll('*')]) for (const attribute of [...item.attributes]) {
    if (/^on/i.test(attribute.name) || /^(value|srcdoc|nonce)$/i.test(attribute.name) || /^(?:javascript|data):/i.test(attribute.value)) item.removeAttribute(attribute.name);
  }
  const scrollElement = document.scrollingElement || document.documentElement;
  const bodyTitle = platform === 'wechat' ? text(document.querySelector('#activity-name')) : platform === 'xhs' && bodyConfirmed && !isSearch ? text(root.querySelector('#detail-title, .title, h1')) : platform === 'zhihu' && !isSearch ? text(document.querySelector('.QuestionHeader-title,.Post-Title')) : platform === 'douyin' && !isSearch ? text(bodyRoot).split('\n')[0] : '';
  if (post) post.title = articleTitle || bodyTitle || document.title;
  return { url: pageURL, title: articleTitle || bodyTitle || document.title, platform, text: content, body_text_length: body.length, html: clone.outerHTML, presentation,
    items, media, links, article_links: articleLinks, transcript, gate, post, comments: extractedComments,
    target_present: bodyConfirmed && (!wantedID || items.some((item) => item.id === wantedID || item.source_status_id === wantedID)),
    login_notice: /登录|sign in|log in/i.test(gateDialog),
    loading: [...root.querySelectorAll('[aria-busy="true"], [role="progressbar"]')].some(visible),
    visible_expand_controls: [...root.querySelectorAll('[data-testid="tweet-text-show-more-link"], .RichContent-expandButton, .unfold, [class*="expand"]')].filter(visible).length,
    scroll: { top: scrollElement.scrollTop, height: scrollElement.scrollHeight, viewport: scrollElement.clientHeight } };
}

export function articleMediaFromNetwork(entries, targetID) {
  const media = {};
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (String(value.rest_id || value.legacy?.id_str || '') === targetID) {
      const article = value.article?.article_results?.result;
      for (const item of Object.values(article?.media_entities || {})) {
        const url = item?.media_info?.original_img_url;
        if (item.media_id && /^https:\/\/pbs\.twimg\.com\//.test(url || '')) media[String(item.media_id)] = { url, alt: item.media_info?.alt_text || '', source_status_id: targetID };
      }
      const cover = article?.cover_media;
      if (cover?.media_id && /^https:\/\/pbs\.twimg\.com\//.test(cover?.media_info?.original_img_url || '')) media[String(cover.media_id)] = { url: cover.media_info.original_img_url, source_status_id: targetID };
    }
    for (const item of Object.values(value)) if (item && typeof item === 'object') visit(item);
  };
  for (const entry of entries) {
    if (!/^https:\/\/(?:www\.)?x\.com\/i\/api\/graphql\//.test(entry.url || '')) continue;
    for (const body of [entry.responseBody, entry.responsePreview, entry.body]) {
      try { visit(typeof body === 'string' ? JSON.parse(body) : body); } catch {}
    }
  }
  return media;
}

export function observedPostVideos(entries, targetID) {
  const videos = new Map();
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (String(value.rest_id || value.legacy?.id_str || '') === targetID) for (const item of value.legacy?.extended_entities?.media || value.legacy?.entities?.media || []) {
      const best = (item.video_info?.variants || []).filter((variant) => variant.content_type === 'video/mp4' && /^https:\/\/video\.twimg\.com\//.test(variant.url || '')).sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
      if (best) videos.set(best.url, { url: best.url, bitrate: best.bitrate || null, mime: 'video/mp4', source_status_id: targetID, source: 'observed_post_response' });
    }
    for (const item of Object.values(value)) if (item && typeof item === 'object') visit(item);
  };
  for (const entry of entries) if (/^https:\/\/(?:www\.)?x\.com\/i\/api\/graphql\//.test(entry.url || '')) for (const body of [entry.responseBody, entry.responsePreview, entry.body]) {
    try { visit(typeof body === 'string' ? JSON.parse(body) : body); } catch {}
  }
  return [...videos.values()];
}

export function expandPage({ platform, comments = false }) {
  const selectors = {
    x: ['[data-testid="tweet-text-show-more-link"]'],
    xhs: ['.note-content .expand', '.note-content .show-more'],
    youtube: ['ytd-text-inline-expander #expand', 'tp-yt-paper-button#expand', 'ytd-video-description-transcript-section-renderer button'],
    zhihu: ['.RichContent-expandButton'],
    douban: ['.unfold'],
  };
  const clicked = [];
  for (const dialog of document.querySelectorAll('[role="dialog"], .login-container, .login-modal, [class*="loginModal"], [class*="LoginModal"]')) {
    if (!dialog.getClientRects().length || !/登录|sign in|log in/i.test(dialog.innerText || '')) continue;
    const close = [...dialog.querySelectorAll('button, [role="button"], [aria-label]')].find((node) => node.getClientRects().length && /^(关闭|稍后|暂不登录|以后再说|游客访问|Close|Not now|×)$/i.test((node.getAttribute('aria-label') || node.innerText || '').trim()));
    if (close) { close.click(); clicked.push('dismiss_optional_login'); }
  }
  for (const selector of selectors[platform] || []) for (const item of document.querySelectorAll(selector)) {
    if (item.getClientRects().length && !item.disabled && item.dataset.luzExpanded !== 'yes') {
      item.dataset.luzExpanded = 'yes'; item.click(); clicked.push(selector);
    }
  }
  if (comments && platform === 'reddit') for (const item of document.querySelectorAll('shreddit-comment-tree button')) {
    if (/^(view more comments|load more comments|more replies|更多回复)$/i.test(item.innerText.trim()) && item.getClientRects().length) { item.click(); clicked.push('more_comments'); }
  }
  if (comments && ['zhihu', 'douyin'].includes(platform)) {
    const scope = platform === 'zhihu' ? document.querySelector('.AnswerCard') || document : document;
    const openList = platform === 'douyin' && [...scope.querySelectorAll('[data-e2e="comment-list"]')].some(node => node.getClientRects().length);
    const item = !openList && [...scope.querySelectorAll(platform === 'zhihu' ? 'button.ContentItem-action' : '[data-e2e="video-player-comment"], [data-e2e="feed-comment-icon"]')].find((node) => node.getClientRects().length && node.dataset.luzComments !== 'yes' && (platform !== 'zhihu' || /评论/.test(node.innerText || node.getAttribute('aria-label') || '')));
    if (item) { item.dataset.luzComments = 'yes'; item.click(); clicked.push('open_comments'); }
  }
  return clicked;
}

export function scrollPage({ move = true, comments = false, platform } = {}) {
  const commentSelectors = { xhs: '.comments-container, .comments-list', zhihu: '.CommentListV2, .CommentsV2-withPagination, .Comments-container', douyin: '[data-e2e="comment-list"]' };
  const commentRoot = comments && commentSelectors[platform] ? document.querySelector(commentSelectors[platform]) : null;
  const root = commentRoot || document.querySelector('[data-testid="primaryColumn"]') || document.querySelector('.note-container, #js_article, main, article, [role="main"]') || document.body || document.documentElement;
  const ancestors = [];
  for (let item = root; item; item = item.parentElement) ancestors.push(item);
  const canScroll = (item) => Boolean(item && item.clientHeight > 100 && item.scrollHeight > item.clientHeight + 3 && (item === document.scrollingElement || /auto|scroll|overlay/.test(getComputedStyle(item).overflowY)));
  const element = ancestors.find(canScroll) || (canScroll(document.scrollingElement) ? document.scrollingElement : null) || [...root.querySelectorAll('*')].filter(canScroll).sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth)[0] || document.scrollingElement;
  const before = element.scrollTop;
  if (move) element.scrollBy(0, Math.max(200, Math.round(element.clientHeight * 0.8)));
  return { before, top: element.scrollTop, after: element.scrollTop, height: element.scrollHeight, viewport: element.clientHeight, at_bottom: element.scrollTop + element.clientHeight >= element.scrollHeight - 3, element: element.getAttribute('data-testid') || element.id || element.tagName };
}

// Serialized into the browser; submit the site's search, never a login form.
export function submitSearch({ query, mode, url, parameter = 'keywords' }) {
  if (mode === 'gbk') {
    const form = document.createElement('form');
    form.action = url; form.method = 'get'; form.acceptCharset = 'GBK';
    const field = document.createElement('input'); field.name = parameter; field.value = query;
    form.append(field); document.body.append(form); form.submit();
    return { submitted: true, method: 'native_GBK_form', query };
  }
  const visible = (node) => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
  const input = [...document.querySelectorAll('input')].filter(visible).find((node) => /search|搜索|关键词|关键字/i.test(`${node.type} ${node.placeholder} ${node.name} ${node.getAttribute('aria-label') || ''}`) && !/password|验证码|手机号|邮箱/i.test(`${node.type} ${node.placeholder}`));
  if (!input) return { submitted: false, method: 'no_visible_search', login_visible: /登录|登入|sign in|log in/i.test(document.body.innerText || '') };
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, query);
  input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  const form = input.closest('form');
  if (form?.querySelector('input[type="password"]')) return {submitted:false,method:'login_form_rejected',login_visible:true};
  const container = form || input.parentElement?.parentElement || document;
  const button = [...container.querySelectorAll('button,[role="button"],input[type="submit"]')].find((node) => visible(node) && /^(搜索(?:网页)?|查找|查询|搜一下|Search(?: the web)?)$/i.test((node.innerText || node.value || node.getAttribute('aria-label') || node.title || '').trim()));
  if (button) { button.click(); return { submitted: true, method: 'visible_search_button', query, input:input.id || input.name, button:button.id || button.getAttribute('aria-label') }; }
  if (form) { form.requestSubmit(); return { submitted: true, method: 'native_search_form', query, input:input.id || input.name }; }
  return { submitted: false, method: 'search_control_not_confirmed', login_visible: /登录|sign in/i.test(document.body.innerText || '') };
}


export function clickSearchResult({ url }) {
  const target = new URL(url);
  const noteID = (path) => path.match(/\/(?:explore|discovery\/item|search_result)\/([^/?]+)/)?.[1];
  const id = noteID(target.pathname);
  const link = [...document.querySelectorAll('a[href]')].find((item) => {
    const candidate = new URL(item.href);
    return item.getClientRects().length && candidate.origin === target.origin && (candidate.pathname === target.pathname || (id && noteID(candidate.pathname) === id));
  });
  if (!link) return false;
  link.target = '_self'; link.click(); return true;
}
