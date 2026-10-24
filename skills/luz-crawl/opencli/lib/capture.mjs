import fs from 'node:fs/promises';
import path from 'node:path';
import { extractPage, expandPage, scrollPage, articleMediaFromNetwork, observedPostVideos, submitSearch } from './extract-page.mjs';
import { platformOf, validateURL, canonicalURL, sourceURL } from './platforms.mjs';
import { DEFAULT_OUTPUT, allocateRun, nameRun, atomicWrite, hash, mergeItems, recordExperience, recordReference, verifyArchive } from './archive.mjs';
import { htmlDocument } from './html.mjs';
import { createBrowserOperations } from './browser-operations.mjs';
import { classifyFailure, OperationError } from './failure.mjs';
import { VERSION } from './version.mjs';

const uniq = (items, key) => [...new Map(items.map((item) => [key(item), item])).values()];
const EXTRACTOR_VERSION = VERSION;

export async function capture(page, options, sharedOperations) {
  const started = Date.now();
  const url = validateURL(options.url).href;
  const budget = Number(options.scrolls ?? 20);
  if (!Number.isInteger(budget) || budget < 0 || budget > 500) throw new Error('--scrolls must be an integer from 0 to 500.');
  const operations = sharedOperations || await createBrowserOperations(page, options);
  operations.url = url;
  const pause = ms => operations.policy.delay(ms);
  const run = await allocateRun(options.out || DEFAULT_OUTPUT, url, Boolean(options.resume));
  const file = (name) => path.join(run.folder, name);
  let priorContent;
  if (run.previous) {
    try {
      const integrity = await verifyArchive(run.folder);
      if (!integrity.ok) throw new Error(`Cannot resume a modified/incomplete archive: ${integrity.failures.join(', ')}`);
      priorContent = JSON.parse(await fs.readFile(file('raw/content.json'), 'utf8'));
    } catch (error) { await run.release(); throw error; }
  }
  let result = { schema_version: 2, requested_url: sourceURL(url), canonical_url: canonicalURL(url), platform: platformOf(url), requested_platform: options.search_platform, query: options.query || '', title: '', captured_at: new Date().toISOString(), status: 'partial', stop_reason: 'scroll_budget', text: '', items: [], media: [], links: [], transcript: [], snapshots: [], expansions: [], related: [], limitations: [], route: 'LuzCrawl skill > bundled OpenCLI plugin > LuzCrawl Browser Bridge > real browser DOM', browser_opened: false };
  let files = [];
  let firstTarget = false;
  let stable = 0;
  let fingerprint = '';
  let lastSnapshot;
  let articleFingerprint = '';
  let scrollRounds = 0;
  let networkCapture = false;
  let articleMedia = {};
  let observedVideos = [];
  try {
    if (run.previous) {
      result.snapshots = priorContent.snapshots || [];
      result.related = priorContent.related || [];
      for (const item of result.related) for (const key of ['folder', 'html_file']) if (item[key]?.startsWith(run.previousFolder + path.sep)) item[key] = run.folder + item[key].slice(run.previousFolder.length);
      files = [...run.previous.files.filter((item) => ['raw/snapshots/', 'raw/legacy/', 'raw/related/', 'raw/media/', 'raw/downloads.json'].some((prefix) => item.path.startsWith(prefix)))];
    }
    result.extractor_version = EXTRACTOR_VERSION;
    console.error(`[luz-crawl] Opening ${sourceURL(url)}`);
    if (result.platform === 'x' && page.startNetworkCapture) {
      try { networkCapture = await operations.startResponseCapture('/i/api/graphql/'); } catch (error) { console.error(`[luz-crawl] Optional response capture unavailable: ${error.message}`); }
    }
    if (!options.current_page) await operations.navigate(validateURL(options.search_form?.entry_url || url).href);
    result.browser_opened = true;
    if (options.search_form) {
      await pause(900);
      result.search_action = await operations.evaluate(submitSearch, { ...options.search_form, url, query: options.query }, { idempotent: false, label: 'submit_search_once' });
      if (result.search_action.submitted) await pause(1200);
    } else if (options.query) result.search_action = { submitted: true, method: 'browser_search_url', query: options.query };
    const resolvedURL = validateURL(await operations.evaluate('location.href')).href;
    result.resolved_url = sourceURL(resolvedURL);
    result.platform = platformOf(resolvedURL);
    operations.url = resolvedURL;
    const ready = await operations.policy.waitUntil(resolvedURL,
      () => operations.evaluate(extractPage, { platform: result.platform, requestedURL: url, comments: Boolean(options.comments), includePresentation: false, isSearch: Boolean(options.query) }),
      snapshot => snapshot?.target_present && Boolean(snapshot.text?.trim() || snapshot.post?.content_present));
    const initial = ready.last;
    if (initial?.post && !result.post) result.post = initial.post;
    for (let round = 0; round <= budget; round++) {
      if (networkCapture && round < 3) {
        try {
          const network = await operations.readResponses();
          articleMedia = { ...articleMedia, ...articleMediaFromNetwork(network, url.match(/\/status\/(\d+)/)?.[1]) };
          observedVideos = observedPostVideos(network, url.match(/\/status\/(\d+)/)?.[1]);
        }
        catch (error) { networkCapture = false; console.error(`[luz-crawl] Response capture unavailable: ${error.message}`); }
      }
      const expanded = initial?.gate ? [] : await operations.evaluate(expandPage, { platform: result.platform, comments: Boolean(options.comments) }, { idempotent: false, label: 'expand_visible_content_once' });
      if (expanded.length) { result.expansions.push(...expanded); await pause(600); }
      const snapshot = await operations.extract({ platform: result.platform, requestedURL: url, comments: Boolean(options.comments), articleMedia, observedVideos, isSearch: Boolean(options.query), includePresentation: true });
      if (!snapshot || typeof snapshot.text !== 'string' || !Array.isArray(snapshot.items)) throw new Error('Browser Bridge returned an invalid extraction envelope.');
      if (!snapshot.scroll || typeof snapshot.scroll.at_bottom !== 'boolean') throw new OperationError('invalid_response', 'Extraction is missing its scroll position.');
      lastSnapshot = snapshot;
      result.login_notice = snapshot.login_notice;
      if (snapshot.post) {
        const previous = result.post;
        const engagement = Object.fromEntries(Object.entries(snapshot.post.engagement).map(([key, value]) => [key, value.value === null && previous?.engagement?.[key]?.value != null ? previous.engagement[key] : value]));
        result.post = { ...previous, ...snapshot.post, engagement, text: (previous?.text?.length || 0) > snapshot.post.text.length ? previous.text : snapshot.post.text, images: uniq([...(previous?.images || []), ...snapshot.post.images], (item) => item.url), videos: uniq([...(previous?.videos || []), ...snapshot.post.videos], (item) => item.url) };
      }
      result.comments = mergeItems(result.comments || [], snapshot.comments || []);
      const index = result.snapshots.length;
      const stem = `raw/snapshots/${String(index).padStart(4, '0')}`;
      const { html, ...data } = snapshot;
      for (const [suffix, value] of [['.json', `${JSON.stringify(data, null, 2)}\n`], ['.html', html]]) {
        await atomicWrite(file(stem + suffix), value);
        files.push({ path: stem + suffix, sha256: hash(value), bytes: Buffer.byteLength(value) });
      }
      result.snapshots.push({ path: stem + '.json', url: sourceURL(snapshot.url), at: new Date().toISOString(), round });
      if (snapshot.title) result.title = snapshot.title;
      if (snapshot.presentation && (!result.presentation || snapshot.presentation.text_chars >= result.presentation.text_chars)) result.presentation = snapshot.presentation;
      if (snapshot.text.length > result.text.length) result.text = snapshot.text;
      result.items = mergeItems(result.items, snapshot.items.map((item) => ({ ...item, url: item.url ? sourceURL(item.url) : '' })));
      result.media = uniq([...result.media, ...snapshot.media], (item) => item.url);
      result.links = uniq([...result.links, ...snapshot.links], (item) => item.url);
      result.article_links = [...new Set([...(result.article_links || []), ...(snapshot.article_links || [])])];
      result.transcript = mergeItems(result.transcript, snapshot.transcript.map((item) => ({ ...item, id: `${item.time}:${item.text}` })));
      firstTarget ||= snapshot.target_present;
      const signature = hash(JSON.stringify([result.items, result.media, snapshot.text, snapshot.scroll.height]));
      const waitingComments = options.comments && result.post?.engagement?.comments?.value > 0 && !result.comments?.length;
      stable = signature === fingerprint && snapshot.scroll.at_bottom && !snapshot.loading && !waitingComments ? stable + 1 : 0;
      fingerprint = signature;
      console.error(`[luz-crawl] Snapshot ${index}: ${snapshot.text.length} chars, ${result.items.length} items, stable=${stable}`);
      if (snapshot.gate) { result.stop_reason = snapshot.gate; if (snapshot.gate === 'rate_limited') await operations.policy.noteFailure(resolvedURL, new OperationError('rate_limited', 'Page rate limit observed.')); break; }
      const article = snapshot.presentation;
      if (!options.comments && article?.ready && !article.media_pending) {
        const current = hash(JSON.stringify([article.text_chars, snapshot.items.filter((item) => item.kind === 'article').map((item) => item.text), article.assets]));
        if (current === articleFingerprint) { result.stop_reason = 'article_dom_complete'; break; }
        articleFingerprint = current;
      } else articleFingerprint = '';
      if (stable >= 3) { result.stop_reason = 'stable_after_3_scrolls'; break; }
      if (round === budget) break;
      // A complete X Article is already in the DOM; let deferred assets settle before scrolling.
      if (!options.comments && article?.ready && (round < 2 || !article.media_pending)) { await pause(350); continue; }
      await operations.evaluate(scrollPage, { comments: Boolean(options.comments), platform: result.platform }, { idempotent: false, label: 'scroll_content_once' });
      scrollRounds++;
      await pause(Number(options.delay ?? (waitingComments ? 750 : 350)));
    }
    if (result.platform === 'x' && !firstTarget && /\/status\//.test(url)) result.stop_reason = lastSnapshot?.gate || 'target_post_not_found';
    if (!options.query && !firstTarget && result.platform !== 'x') result.stop_reason = lastSnapshot?.gate || 'target_body_not_found';
    const targetID = url.match(/\/status\/(\d+)/)?.[1];
    const target = result.items.find((item) => item.id === targetID);
    result.items = result.items.map((item) => result.platform === 'x' && item.kind === 'thread_or_reply' ? { ...item, kind: target?.author && item.author === target.author ? 'same_author_thread' : 'reply' } : item);
    if (result.platform === 'x' && !options.comments) result.items = result.items.filter((item) => item.kind !== 'reply');
    const blocked = ['login_required', 'verification_required', 'rate_limited', 'unavailable', 'access_denied', 'target_post_not_found', 'target_body_not_found'].includes(result.stop_reason);
    const targetArticle = result.items.find((item) => item.kind === 'article' && item.source_status_id === targetID);
    const substantive = result.platform === 'x' && targetID ? Boolean(target?.text?.trim() || targetArticle?.text?.trim() || result.post?.content_present) : firstTarget && (result.items.some((item) => item.kind !== 'page_shell' && item.text?.trim()) || result.post?.content_present);
    result.status = blocked ? (substantive ? 'partial' : 'blocked') : substantive && ['stable_after_3_scrolls', 'article_dom_complete'].includes(result.stop_reason) ? 'captured' : 'partial';
    result.title = result.items.find((item) => item.kind === 'article' && item.title)?.title || result.title || target?.text?.split('\n')[0] || new URL(url).hostname;
    if (!substantive) result.limitations.push('目标正文未确认，页面壳或搜索卡片不能作为正文成功证据');
    if (result.stop_reason === 'scroll_budget') result.limitations.push('达到滚动预算，后续内容尚未确认');
    if (result.items.some((item) => item.truncated)) { result.status = 'partial'; result.limitations.push('仍有未展开的正文'); }
    if (blocked) result.limitations.push(`页面限制：${result.stop_reason}`);
    result.url_check = { requested: sourceURL(url), resolved: result.resolved_url, target_confirmed: firstTarget, valid_content: substantive && !blocked, entry_method: options.current_page ? 'clicked_search_result' : 'browser_navigation', reason: blocked ? result.stop_reason : undefined };
    if (options.search_form && !result.search_action?.submitted) result.limitations.push('当前页面未确认可操作的搜索控件，未把首页当作已执行搜索');
    const oldFolder = run.folder;
    result.primary_file = await nameRun(run, result.title);
    for (const item of result.related) for (const key of ['folder', 'html_file']) if (item[key]?.startsWith(oldFolder + path.sep)) item[key] = run.folder + item[key].slice(oldFolder.length);
    if (result.platform === 'x' && !options.related) {
      const shortLinkShell = target && target.text.replace(/https?:\/\/\S+/g, '').trim().length < 40;
      const links = [...(result.article_links || []), ...(shortLinkShell ? result.links.filter((link) => /^https:\/\/t\.co\//.test(link.url)).map((link) => link.url) : [])];
      const candidates = uniq(links.map((value) => ({ url: value })), (item) => canonicalURL(item.url));
      if (candidates.length > 2) { result.status = 'partial'; result.limitations.push('关联链接超过本次自动跟读上限 2 个，其余需继续打开'); }
      for (const link of candidates.slice(0, 2)) {
        if (canonicalURL(link.url) === canonicalURL(url)) continue;
        try {
          const related = await capture(page, { ...options, url: link.url, out: path.join(run.folder, 'raw', 'related'), related: true }, operations);
          result.related.push({ url: link.url, folder: related.folder, html_file: related.html_file, status: related.status });
          const relatedManifest = path.join(related.folder, 'raw', 'manifest.json');
          const relatedFiles = JSON.parse(await fs.readFile(relatedManifest, 'utf8')).files;
          for (const entry of relatedFiles) files.push({ ...entry, path: path.relative(run.folder, path.join(related.folder, entry.path)).split(path.sep).join('/') });
          const bytes = await fs.readFile(relatedManifest);
          files.push({ path: path.relative(run.folder, relatedManifest).split(path.sep).join('/'), sha256: hash(bytes), bytes: bytes.length });
          const delivered = await fs.readFile(related.html_file);
          files.push({ path: path.relative(run.folder, related.html_file).split(path.sep).join('/'), sha256: hash(delivered), bytes: delivered.length });
          if (related.status !== 'captured') { result.status = 'partial'; result.limitations.push(`关联正文尚未验证完整：${sourceURL(link.url)}`); }
        }
        catch (error) { result.related.push({ url: link.url, error: error.message }); result.status = 'partial'; }
      }
      if (target && target.text.replace(/https?:\/\/\S+/g, '').trim().length < 40 && result.links.some((link) => /^https:\/\/t\.co\//.test(link.url)) && !result.related.length) {
        result.status = 'partial'; result.limitations.push('原帖可能是长文或外链入口；需打开正文中的短链继续采集');
      }
    }
    if (['youtube', 'douyin', 'bilibili'].includes(result.platform)) result.limitations.push('正文/简介与页面可见字幕已归档；未转录未提供字幕的音视频，也未执行 OCR');
    if (options.comments) {
      result.limitations.push('评论范围仅限本次浏览器实际加载的条目，不代表平台全部评论');
      result.comments_coverage = { loaded: result.comments?.length || 0, displayed_total: result.post?.engagement?.comments?.value ?? null, all_comments_verified: false };
      if (!result.comments_coverage.loaded && result.comments_coverage.displayed_total > 0) { result.status = 'partial'; result.limitations.push('页面显示有评论，但本次未加载评论条目，需继续浏览器阅读'); }
    }
    for (const viewer of result.media.filter((item) => item.kind === 'media_viewer')) {
      const asset = result.media.find((item) => item.viewer_url === viewer.url && item.kind !== 'media_viewer');
      if (asset) { viewer.asset_url = asset.url; viewer.loaded = asset.loaded; viewer.resolved = true; }
    }
    const unresolvedMedia = result.media.filter((item) => item.kind === 'media_viewer' && !item.asset_url).length;
    if (unresolvedMedia) { result.status = 'partial'; result.limitations.push(`${unresolvedMedia} 个媒体查看链接已保留，页面只加载了占位区域，媒体文件地址尚未解析`); }
    if (options.screenshot !== false) {
      try {
        if (result.related.length) await operations.navigate(url);
        try { await operations.screenshot(file('raw/page.png'), true); result.screenshot_scope = 'full_page'; }
        catch { await operations.screenshot(file('raw/page.png'), false, 1); result.screenshot_scope = 'viewport'; result.limitations.push('整页截图超出浏览器能力，已保存当前视口截图'); }
        const bytes = await fs.readFile(file('raw/page.png')); files.push({ path: 'raw/page.png', sha256: hash(bytes), bytes: bytes.length });
      }
      catch (error) { result.limitations.push(`截图失败：${error.message}`); }
    }
  } catch (error) {
    const failure = classifyFailure(error);
    result.status = result.snapshots.length ? 'partial' : 'failed'; result.stop_reason = failure.code; result.error = failure.message; result.failure = failure.toJSON(); result.limitations.push(failure.message);
    result.url_check ||= { requested: sourceURL(url), resolved: result.resolved_url, target_confirmed: firstTarget, valid_content: firstTarget && !['login_required', 'verification_required', 'rate_limited', 'access_denied'].includes(failure.code) };
  }
  try {
    result.execution = operations.summary(); result.browser_profile = operations.policy.profile;
    result.primary_file = await nameRun(run, result.title || new URL(url).hostname);
    if (run.rename_warning && !result.limitations.includes(run.rename_warning)) result.limitations.push(run.rename_warning);
    result.related = uniq(result.related, (item) => item.url);
    result.completeness = { scope: options.query ? 'search_candidates' : result.presentation?.kind === 'x_article' ? 'target_article_dom_and_already_loaded_replies' : result.platform === 'x' ? 'target_post_and_loaded_same_author_thread' : 'rendered_body_and_loaded_items', all_site_content: false, target_present: firstTarget, scroll_bottom: Boolean(lastSnapshot?.scroll?.at_bottom), snapshots: result.snapshots.length, scroll_rounds: scrollRounds, items: result.items.length, chars: result.items.filter((item) => item.kind !== 'page_shell').reduce((sum, item) => sum + (item.text?.length || 0), 0), media: result.media.length, media_assets: result.media.filter((item) => item.kind !== 'media_viewer').length, media_viewers_unresolved: result.media.filter((item) => item.kind === 'media_viewer' && !item.asset_url).length, stop_reason: result.stop_reason, budget };
    const html = await htmlDocument(result, options.fetchAsset, { executionPolicy: operations.policy });
    result.execution = operations.summary();
    result.elapsed_ms = Date.now() - started;
    // Keep the previous readable export as historical evidence during a format migration.
    for (const old of ['content.md', priorContent?.primary_file].filter((name) => name && name !== result.primary_file)) {
      if (path.basename(old) !== old) throw new Error('Previous export path escapes archive.');
      try {
        const bytes = await fs.readFile(file(old));
        const legacy = `raw/legacy/${Date.now()}_${old}`;
        await atomicWrite(file(legacy), bytes);
        files.push({ path: legacy, sha256: hash(bytes), bytes: bytes.length });
        await fs.unlink(file(old));
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    for (const [name, value] of [['raw/content.json', `${JSON.stringify(result, null, 2)}\n`], [result.primary_file, html]]) {
      await atomicWrite(file(name), value); files.push({ path: name, sha256: hash(value), bytes: Buffer.byteLength(value) });
    }
    const htmlFile = path.join(run.output, result.primary_file);
    await atomicWrite(htmlFile, html);
    files = uniq(files, (item) => item.path);
    await atomicWrite(file('raw/manifest.json'), { schema_version: 2, output_layout: 'html_and_raw_v1', extractor_version: EXTRACTOR_VERSION, canonical_url: result.canonical_url, requested_url: result.requested_url, resolved_url: result.resolved_url, primary_file: result.primary_file, captured_at: result.captured_at, platform: result.platform, route: result.route, browser_opened: result.browser_opened, status: result.status, layout_fidelity: result.layout_fidelity, offline: result.offline, elapsed_ms: result.elapsed_ms, screenshot_scope: result.screenshot_scope, stop_reason: result.stop_reason, completeness: result.completeness, limitations: result.limitations, files });
    if (run.previous?.output_layout === 'html_and_raw_v1' && priorContent.primary_file !== result.primary_file) await fs.unlink(path.join(run.output, priorContent.primary_file));
    await recordReference(run, result);
    try { await recordExperience({ platform: result.platform, extractor_version: EXTRACTOR_VERSION, canonical_url: result.canonical_url, requested_url: result.requested_url, validated_url: result.url_check?.valid_content ? result.resolved_url : undefined, entry_method: result.url_check?.entry_method, query: result.query, status: result.status, stop_reason: result.stop_reason, chars: result.completeness.chars, folder: run.folder, lesson: result.limitations.join('; '), route: result.route }); }
    catch (error) { console.error(`[luz-crawl] Experience save failed: ${error.message}`); }
    return { folder: run.folder, html_file: htmlFile, status: result.status, stop_reason: result.stop_reason, browser_opened: result.browser_opened, resolved_url: result.resolved_url, url_check: result.url_check, elapsed_ms: result.elapsed_ms, offline: result.offline, search_action: result.search_action, login_notice: result.login_notice, completeness: result.completeness, post: result.post || null, comments: result.comments || [], comments_coverage: result.comments_coverage, limitations: result.limitations, execution: result.execution, ...(result.error ? { error: result.error, failure: result.failure } : {}) };
  } finally { await run.release(); }
}
