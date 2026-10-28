import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { canonicalURL, platformOf, searchURL, validateURL, extractURLs, CATALOG } from '../opencli/lib/platforms.mjs';
import { capture } from '../opencli/lib/capture.mjs';
import { createTaskArchive, verifyArchive, hash, mergeItems, recordExperience, findExperience, matchesQuery, safeTitle } from '../opencli/lib/archive.mjs';
import { htmlDocument } from '../opencli/lib/html.mjs';
import { articleMediaFromNetwork } from '../opencli/lib/extract-page.mjs';
import { search, sourceCandidates } from '../opencli/lib/search.mjs';
import { testPolicy } from './helpers.mjs';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'luz-crawl-test-'));
process.env.LUZ_CRAWL_STATE = path.join(tmp, 'state');
test.after(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

function snapshot(overrides = {}) {
  const body = 'This is the real page body, with enough content to distinguish it from an empty loading placeholder. '.repeat(3);
  return { url: 'https://x.com/a/status/123', title: 'Test source', text: body, html: `<article>${body}</article>`, presentation: { html: `<article>${body}</article>`, text_chars: body.length, assets: [], width: 598 }, items: [{ id: '123', url: 'https://x.com/a/status/123', author: 'a', kind: 'target_post', text: body }], media: [], links: [], transcript: [], article_links: [], target_present: true, gate: null, scroll: { at_bottom: true, height: 1500 }, ...overrides };
}
function page(snapshots) {
  let index = 0;
  return { opened: [], goto: async function (url) { this.opened.push(url); }, evaluate: async (code) => {
    if (code === 'location.href') return snapshots[0].url;
    if (code.includes('function extractPage')) return snapshots[Math.min(index++, snapshots.length - 1)];
    if (code.includes('function expandPage')) return [];
    if (code.includes('function scrollPage')) return { at_bottom: true, height: 1500, top: 500, viewport: 1000 };
    throw new Error('Unexpected browser operation');
  } };
}
const opts = (out, more = {}) => ({ url: 'https://x.com/a/status/123', out: path.join(tmp, out), executionPolicy: testPolicy(tmp), delay: 0, scrolls: 5, screenshot: false, ...more });

test('URL validation, aliases and ID deduplication', () => {
  for (const url of ['file:///secret', 'javascript:alert(1)', 'https://user:password@example.com']) assert.throws(() => validateURL(url));
  assert.equal(platformOf('https://x.com.evil.test/'), 'web');
  assert.equal(canonicalURL('https://twitter.com/a/status/123?s=20'), canonicalURL('https://x.com/b/status/123'));
  assert.equal(canonicalURL('https://www.xiaohongshu.com/discovery/item/abc123?xsec_token=x'), 'https://www.xiaohongshu.com/explore/abc123');
  assert.equal(canonicalURL('https://www.xiaohongshu.com/search_result/abc123?xsec_token=x'), 'https://www.xiaohongshu.com/explore/abc123');
  assert.equal(canonicalURL('https://youtu.be/abc?si=1'), 'https://www.youtube.com/watch?v=abc');
  assert.equal(extractURLs('[a](https://x.com/a/status/1) — https://twitter.com/b/status/1?x=1\nhttps://x.com/a/status/2').length, 2);
  for (const platform of ['x', 'xhs', 'wechat', 'douyin', 'youtube', 'reddit', 'zhihu', 'douban', 'bilibili', 'web']) assert.ok(searchURL(platform, '中文 & plus').startsWith('https://'));
});

test('Bilibili search excludes creator upload screens and accepts real detail IDs', () => {
  const content = {requested_url:'https://search.bilibili.com/all?keyword=Python',links:[{url:'https://member.bilibili.com/platform/upload/video/frame'},{url:'https://www.bilibili.com/video/BV1GJ411x7h7/'},{url:'https://www.bilibili.com/video/not-a-video'}]};
  assert.deepEqual(sourceCandidates(content,CATALOG.find(site=>site.id==='bilibili')).map(item=>item.url),['https://www.bilibili.com/video/BV1GJ411x7h7/']);
});

test('virtualized tweets survive scrolls; longer expansion wins', async () => {
  const second = { id: '456', url: 'https://x.com/a/status/456', author: 'a', kind: 'thread_or_reply', text: 'Second thread entry' };
  const first = snapshot();
  const browser = page([first, first, snapshot({ items: [second] })]);
  const result = await capture(browser, opts('virtual'));
  assert.equal(result.status, 'captured');
  assert.equal(result.completeness.items, 2);
  assert.equal(browser.opened.length, 1);
  assert.equal((await verifyArchive(result.folder)).ok, true);
  await assert.rejects(() => fs.access(path.join(result.folder, path.basename(result.html_file))), { code: 'ENOENT' });
  assert.equal(mergeItems([{ id: '1', text: 'short' }], [{ id: '1', text: 'a longer expanded paragraph' }])[0].text, 'a longer expanded paragraph');
});

test('login shell cannot become success, even with lots of UI text', async () => {
  const result = await capture(page([snapshot({ gate: 'login_required', items: [], target_present: false })]), opts('login'));
  assert.equal(result.status, 'blocked');
  assert.equal(result.stop_reason, 'login_required');
  assert.equal(result.completeness.target_present, false);
  assert.equal((await verifyArchive(result.folder)).ok, true);
});

test('error-page recommendation links are rejected before trying a public search route', async () => {
  let url;
  const browser = {
    opened: [],
    goto: async (value) => { url = value; browser.opened.push(value); },
    evaluate: async (code) => {
      if (code === 'location.href') return url;
      if (code.includes('function expandPage')) return [];
      if (code.includes('function scrollPage') && !code.includes('function extractPage')) return { at_bottom: true, height: 1500, top: 500, viewport: 1000 };
      if (code.includes('function extractPage')) {
        const failed = !url.includes('bing.com');
        return snapshot({ url, title: failed ? '404页面' : 'Actual search results', gate: failed ? 'unavailable' : null, links: [{ url: 'https://www.xiaohongshu.com/explore/abc123' }] });
      }
      throw new Error('Unexpected browser operation');
    },
  };
  const result = await search(browser, opts('search-error', { platform: 'xhs', query: '人工智能', read: 0, scrolls: 0 }));
  assert.equal(result.attempts[0].candidates, 0);
  assert.equal(result.route_kind, 'public_index');
  assert.equal(result.discovered_candidates, 1);
  assert.equal(browser.opened.length, 2);
});

test('scroll budget and absent target remain partial or blocked', async () => {
  const result = await capture(page([snapshot()]), opts('budget', { scrolls: 0 }));
  assert.equal(result.status, 'partial');
  assert.equal(result.stop_reason, 'scroll_budget');
  const missing = await capture(page([snapshot({ target_present: false, items: [] })]), opts('missing', { scrolls: 0 }));
  assert.equal(missing.status, 'blocked');
});

test('public search candidates cannot hide a native login gate when no source body was readable', async () => {
  let url;const opened=[];
  const browser={goto:async value=>{url=value;opened.push(value);},evaluate:async code=>{
    if(code==='location.href')return url;
    if(code.includes('function expandPage'))return[];
    if(code.includes('function scrollPage')&&!code.includes('function extractPage'))return{at_bottom:true,height:1500,top:500,viewport:1000};
    if(code.includes('function extractPage')){
      const index=url.includes('bing.com'),native=url.includes('search_result');
      return snapshot({url,gate:index?null:native?'login_required':'unavailable',target_present:index,items:index?snapshot().items:[],links:index?[{url:'https://www.xiaohongshu.com/explore/auth-required'}]:[]});
    }
    throw new Error('Unexpected browser operation');
  }};
  const result=await search(browser,opts('search-login-fallback',{platform:'xhs',query:'人工智能',read:1,scrolls:0}));
  assert(opened[0].includes('xiaohongshu.com/search_result'));
  assert.equal(result.discovered_candidates,1);assert.equal(result.sources[0].url_check.valid_content,false);
  assert.equal(result.status,'awaiting_user');assert.equal(result.awaiting_reason,'login_required');assert.equal(result.requires_user,true);
  assert(result.handover_url.includes('xiaohongshu.com/search_result'));
});

test('loading replies cannot become stable completion and displayed counts survive collapsed controls', async () => {
  const post = { id: '123', text: 'body', images: [], videos: [], engagement: { comments: { value: 12, raw: '12 Replies', approximate: false } } };
  const first = snapshot({ post });
  const later = snapshot({ post: { ...post, engagement: { comments: { value: null, raw: 'Hide comments', approximate: false } } }, comments: [], loading: true });
  const result = await capture(page([first, later]), opts('loading-replies', { comments: true, scrolls: 4 }));
  assert.equal(result.status, 'partial'); assert.equal(result.stop_reason, 'scroll_budget');
  assert.equal(result.post.engagement.comments.value, 12);
  assert.ok(result.limitations.some((value) => value.includes('未加载评论')));
});

test('resume verifies evidence, appends snapshots, never overwrites corrupted evidence', async () => {
  const options = opts('resume');
  const first = await capture(page([snapshot()]), options);
  await assert.rejects(() => capture(page([snapshot()]), options), /already exists/);
  const second = await capture(page([snapshot()]), { ...options, resume: true });
  assert.ok(second.completeness.snapshots > first.completeness.snapshots);
  assert.equal((await verifyArchive(second.folder)).ok, true);
  const manifest = path.join(second.folder, 'raw/manifest.json');
  const before = hash(await fs.readFile(manifest));
  await fs.appendFile(second.html_file, '\nTampered');
  await assert.rejects(() => capture(page([snapshot()]), { ...options, resume: true }), /Cannot resume/);
  assert.equal(hash(await fs.readFile(manifest)), before);
  await assert.rejects(() => fs.access(path.join(second.folder, '.capture.lock')));
});

test('browser failure still leaves an honest verifiable failure archive', async () => {
  const browser = page([]); browser.goto = async () => { throw new Error('Browser Bridge disconnected'); };
  const result = await capture(browser, opts('failed'));
  assert.equal(result.status, 'failed');
  const manifest = JSON.parse(await fs.readFile(path.join(result.folder, 'raw/manifest.json')));
  assert.equal(manifest.browser_opened, false);
  assert.equal((await verifyArchive(result.folder)).ok, true);
});

test('an occupied raw directory does not discard readable content or its titled HTML', async () => {
  const originalRename = fs.rename;
  try {
    fs.rename = async (from, to) => {
      if (String(from).endsWith('_未命名网页')) throw Object.assign(new Error('Directory is temporarily occupied'), { code: 'EPERM' });
      return originalRename(from, to);
    };
    const result = await capture(page([snapshot()]), opts('occupied-raw'));
    assert.equal(result.status, 'captured');
    assert.equal(path.basename(result.html_file), '001_Test source.html');
    assert.equal((await verifyArchive(result.folder)).ok, true);
  } finally { fs.rename = originalRename; }
});

test('idempotent search experience is in the local memory store', async () => {
  const event = { platform: 'x', canonical_url: 'https://x.com/i/status/987', query: 'test demand', status: 'partial', stop_reason: 'scroll_budget' };
  const one = await recordExperience(event), two = await recordExperience(event);
  assert.equal(one, two);
  const records = await findExperience('test demand', 'x');
  assert.equal(records.events.length, 1);
  assert.equal(records.events[0].status, 'partial');
  assert.equal(records.route_hints[0].platform, 'x');
  assert.equal(matchesQuery('Next queries', 'x'), false);
  assert.equal(matchesQuery('X search: 赚钱案例', 'x 赚钱'), true);
});

test('resume cannot reuse old body as evidence for a current login or error page', async () => {
  const first = await capture(page([snapshot()]), opts('fresh-resume'));
  const current = await capture(page([snapshot({ gate: 'login_required', target_present: false, items: [], text: 'Login shell' })]), opts('fresh-resume', { resume: true }));
  assert.equal(current.status, 'blocked');
  assert.equal(current.completeness.chars, 0);
  assert.ok(current.completeness.snapshots > first.completeness.snapshots);
});

test('clicked browser result can be archived without navigating to a bare link', async () => {
  const browser = page([snapshot()]);
  const current = await capture(browser, opts('clicked', { current_page: true }));
  assert.equal(browser.opened.length, 0);
  assert.equal(current.status, 'captured');
  assert.equal(current.url_check.entry_method, 'clicked_search_result');
});

for (const taskLayout of [false, true]) test(`X article links preserve child verification (task layout: ${taskLayout})`, async () => {
  let currentURL;
  let reads = 0;
  const articleURL = 'https://x.com/i/article/789';
  const browser = { goto: async (url) => { currentURL = url; reads = 0; }, evaluate: async (code) => {
    if (code === 'location.href') return currentURL;
    if (code.includes('function expandPage')) return [];
    if (code.includes('function scrollPage') && !code.includes('function extractPage')) return { at_bottom: true, height: 1500, top: 500, viewport: 1000 };
    if (currentURL === articleURL) return snapshot({ url: articleURL, items: [{ id: 'article:789', kind: 'article', text: 'Article full text', url: articleURL }] });
    return snapshot({ article_links: reads++ < 2 ? [articleURL] : [] });
  } };
  const options = opts(taskLayout ? 'article-task' : 'article');
  if (taskLayout) options.out = await createTaskArchive(options.out, 'article task', {newTask: true});
  const result = await capture(browser, options);
  const content = JSON.parse(await fs.readFile(path.join(result.folder, 'raw/content.json')));
  assert.equal(content.related.length, 1);
  assert.equal(content.related[0].status, 'captured');
  assert.equal((await verifyArchive(result.folder)).ok, true);
  const resumed = await capture(browser, {...options, resume: true});
  const resumedContent = JSON.parse(await fs.readFile(path.join(resumed.folder, 'raw/content.json')));
  assert.equal(resumedContent.related.length, 1);
  assert.equal((await verifyArchive(resumed.folder)).ok, true);
  const child = JSON.parse(await fs.readFile(path.join(content.related[0].folder, 'raw/content.json')));
  if (taskLayout) {
    assert.equal(path.dirname(content.related[0].html_file), path.join(content.related[0].folder, 'raw'));
    assert.ok(content.related[0].html_file.startsWith(options.out + path.sep));
    assert.equal(path.dirname(result.task_html), options.out);
  }
  await fs.appendFile(content.related[0].html_file, '\nModified child');
  assert.equal((await verifyArchive(result.folder)).ok, false);
});

test('redirected browser URL selects the actual platform extractor', async () => {
  const data = snapshot({ url: 'https://mp.weixin.qq.com/s/article', items: [{ id: 'article', text: 'Real article body', kind: 'page_body', url: 'https://mp.weixin.qq.com/s/article' }] });
  const result = await capture(page([data]), opts('redirect', { url: 'https://t.co/example' }));
  const content = JSON.parse(await fs.readFile(path.join(result.folder, 'raw/content.json')));
  assert.equal(content.platform, 'wechat');
  assert.equal(content.resolved_url, data.url);
});

test('resuming a renamed related page retains its snapshots and verifies current paths', async () => {
  const linkedURL = 'https://example.com/linked';
  let currentURL, linkedTitle = '旧关联标题';
  const browser = { goto: async url => { currentURL = url; }, evaluate: async code => {
    if (code === 'location.href') return currentURL;
    if (code.includes('function expandPage')) return [];
    if (code.includes('function scrollPage') && !code.includes('function extractPage')) return {at_bottom:true,height:1500,top:500,viewport:1000};
    return currentURL === linkedURL
      ? snapshot({url:linkedURL,title:linkedTitle,items:[{id:'linked',kind:'page_body',text:'Complete linked body',url:linkedURL}]})
      : snapshot({article_links:[linkedURL]});
  }};
  const options = opts('renamed-related');
  const first = await capture(browser, options);
  const oldChild = JSON.parse(await fs.readFile(path.join(first.folder, 'raw/content.json'))).related[0];
  const oldManifest = JSON.parse(await fs.readFile(path.join(oldChild.folder, 'raw/manifest.json')));
  linkedTitle = '新关联标题';
  const resumed = await capture(browser, {...options,resume:true});
  const currentChild = JSON.parse(await fs.readFile(path.join(resumed.folder, 'raw/content.json'))).related[0];
  assert.match(currentChild.folder, /新关联标题$/);
  assert.equal((await verifyArchive(resumed.folder)).ok, true);
  for (const entry of oldManifest.files.filter(e => e.path.startsWith('raw/snapshots/'))) {
    assert.equal(hash(await fs.readFile(path.join(currentChild.folder, entry.path))), entry.sha256);
  }
  await fs.appendFile(currentChild.html_file, '\nChanged current child');
  assert.equal((await verifyArchive(resumed.folder)).ok, false);
});

test('X Article body tied to the target permalink is substantive even when tweetText is empty', async () => {
  const data = snapshot({ title: 'Actual X Article title', items: [{ id: '123', kind: 'target_post', text: '', url: 'https://x.com/a/status/123' }, { id: 'article:123', kind: 'article', source_status_id: '123', text: 'Full article body', url: 'https://x.com/a/status/123' }] });
  const result = await capture(page([data]), opts('article-body'));
  assert.equal(result.status, 'captured');
  assert.equal(result.completeness.chars, 'Full article body'.length);
});

test('unchanged text above page bottom cannot stop lazy-loading capture early', async () => {
  const browser = page([snapshot()]);
  const evaluate = browser.evaluate;
  browser.evaluate = async (code) => {
    const value = await evaluate(code);
    if (code.includes('function extractPage')) value.scroll = { at_bottom: false, top: 200, viewport: 800, height: 20000 };
    return value;
  };
  const result = await capture(browser, opts('not-bottom'));
  assert.equal(result.status, 'partial');
  assert.equal(result.stop_reason, 'scroll_budget');
  assert.equal(result.completeness.snapshots, 6);
});

test('readable serial and source title replace URL hashes; resume keeps the serial', async () => {
  assert.equal(safeTitle('标题: 一 / 二? <三>\n'), '标题 一 二 三');
  assert.equal([...safeTitle('😀'.repeat(100))].length, 64);
  const first = await capture(page([snapshot({ title: '第一篇：保留中文' })]), opts('names'));
  assert.equal(path.basename(first.html_file), '001_第一篇：保留中文.html');
  assert.equal(path.dirname(first.html_file), path.join(first.folder, 'raw'));
  assert.equal(path.dirname(path.dirname(first.task_html)), opts('names').out);
  assert.equal(path.basename(path.dirname(first.folder)), 'raw');
  const second = await capture(page([snapshot({ url: 'https://x.com/a/status/456', title: '第二篇', items: [{ id: '456', text: 'second' }] })]), opts('names', { url: 'https://x.com/a/status/456' }));
  assert.equal(path.basename(second.folder), '002_第二篇');
  const resumed = await capture(page([snapshot({ title: '第一篇新标题' })]), opts('names', { resume: true }));
  assert.equal(path.basename(resumed.folder), '001_第一篇新标题');
  assert.equal((await verifyArchive(resumed.folder)).ok, true);
  await assert.rejects(() => fs.access(first.html_file));
  const summary = JSON.parse(await fs.readFile(path.join(path.dirname(resumed.task_html), 'raw/crawl-summary.json'), 'utf8'));
  assert.ok(summary.entries.some(row => row.title === '第一篇新标题'));
  assert.ok(summary.entries.some(row => row.title === '第二篇'));
  assert.equal(summary.entries.filter(row => row.url === 'https://x.com/a/status/123').length, 1);
  assert.equal(first.task_html, resumed.task_html);
  await assert.rejects(() => fs.access(path.join(opts('names').out, '参考链接.md')),{code:'ENOENT'});
  await assert.rejects(() => fs.access(path.join(resumed.folder, 'content.md')));
});

test('resuming a legacy archive moves evidence under raw and preserves its serial', async () => {
  const options = opts('legacy-layout');
  const output = options.out;
  options.out = path.join(output, 'raw', '001_legacy task');
  await fs.mkdir(options.out, {recursive:true});
  await fs.writeFile(path.join(options.out, 'luz-task.json'), JSON.stringify({schema_version:1,kind:'task_archive',delivery_layout:'sibling_raw_v1',title:'legacy task'}));
  const first = await capture(page([snapshot()]), options);
  const oldFolder = path.join(output, path.basename(first.folder));
  const manifestFile = path.join(first.folder, 'raw/manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestFile));
  delete manifest.output_layout;
  await fs.writeFile(manifestFile, JSON.stringify(manifest));
  await fs.rename(first.folder, oldFolder);
  const resumed = await capture(page([snapshot()]), { ...options, resume: true });
  assert.equal(resumed.folder, first.folder);
  assert.equal(resumed.html_file, first.html_file);
  assert.equal((await verifyArchive(resumed.folder)).ok, true);
  await assert.rejects(() => fs.access(oldFolder));
});

test('loose user-owned HTML blocks capture before it can create another project output', async () => {
  const options = opts('html-collision');
  await fs.mkdir(options.out, { recursive: true });
  const reserved = path.join(options.out, '001_留存.html');
  await fs.writeFile(reserved, 'User-owned HTML');
  await assert.rejects(() => capture(page([snapshot()]), options), /contains loose files/);
  assert.equal(await fs.readFile(reserved, 'utf8'), 'User-owned HTML');
  assert.deepEqual(await fs.readdir(options.out), ['001_留存.html']);
});

test('a verified complete X Article exports directly without scrolling through replies', async () => {
  const data = snapshot({ items: [{ id: 'article:123', source_status_id: '123', kind: 'article', text: 'Full article body' }], presentation: { kind: 'x_article', ready: true, media_pending: 0, text_chars: 17, html: '<article><h2>原小标题</h2><p>原段落</p><ol><li>原列表</li></ol></article>', assets: [], width: 598 } });
  const result = await capture(page([data]), opts('fast'));
  assert.equal(result.status, 'captured');
  assert.equal(result.stop_reason, 'article_dom_complete');
  assert.equal(result.completeness.scroll_rounds, 0);
  assert.equal(result.completeness.snapshots, 2);
  assert.match(await fs.readFile(result.html_file, 'utf8'), /<h2>原小标题<\/h2><p>原段落<\/p><ol><li>原列表/);
});

test('offline HTML embeds observed resources and reports resource failures honestly', async () => {
  const result = { platform: 'x', title: '<script>title</script>', status: 'captured', requested_url: 'https://x.com/a/status/1', items: [], limitations: [], presentation: { html: '<p>first</p><img src="https://pbs.twimg.com/a?x=1&amp;y=2"><p>last</p>', assets: [{ kind: 'image', url: 'https://pbs.twimg.com/a?x=1&y=2' }] } };
  const html = await htmlDocument(result, async () => new Response('png-bytes', { headers: { 'content-type': 'image/png' } }), { executionPolicy: testPolicy(tmp) });
  assert.equal(result.offline.embedded, 1);
  assert.match(html, /<p>first<\/p><img src="data:image\/png;base64,[^"]+"><p>last<\/p>/);
  assert.match(html, /&lt;script&gt;title/);
  const failed = structuredClone(result); failed.status = 'captured';
  await htmlDocument(failed, async () => new Response('denied', { status: 403 }), { executionPolicy: testPolicy(tmp) });
  assert.equal(failed.status, 'partial');
  assert.equal(failed.offline.failures[0].error, 'HTTP 403');
});

test('a rate-limited native search stops before public fallback routes', async () => {
  const browser = page([snapshot({ gate: 'rate_limited' })]);
  const result = await search(browser, opts('limited-search', { platform: 'xhs', query: '人工智能', read: 0, scrolls: 0 }));
  assert.equal(result.stop_reason, 'rate_limited'); assert.equal(result.attempts.length, 1); assert.equal(browser.opened.length, 1);
  assert.equal(result.discovered_candidates, 0);
});

test('HTML resource embedding stops on 429 and preserves missing asset evidence', async () => {
  let requests = 0;
  const result = { platform: 'x', title: 'test', requested_url: 'https://x.com/a/status/1', status: 'captured', items: [], limitations: [], presentation: { html: '<p>原文</p>', assets: [{ kind: 'image', url: 'https://example.com/one' }, { kind: 'image', url: 'https://example.com/two' }] } };
  await htmlDocument(result, async () => { requests++; return new Response('', { status: 429 }); }, { executionPolicy: testPolicy(tmp) });
  assert.equal(requests, 1); assert.equal(result.status, 'partial'); assert.equal(result.offline.failures.length, 2);
});

test('observed Article response media is limited to the target post and official image host', () => {
  const tweet = (id, url) => ({ rest_id: id, article: { article_results: { result: { media_entities: [{ media_id: '99', media_info: { original_img_url: url } }] } } } });
  const entry = { url: 'https://x.com/i/api/graphql/query/TweetDetail', responsePreview: JSON.stringify({ data: [tweet('123', 'https://pbs.twimg.com/media/original.jpg'), tweet('456', 'https://pbs.twimg.com/media/unrelated.jpg')] }) };
  assert.deepEqual(articleMediaFromNetwork([entry], '123'), { '99': { url: 'https://pbs.twimg.com/media/original.jpg', alt: '', source_status_id: '123' } });
  assert.deepEqual(articleMediaFromNetwork([{ ...entry, url: 'https://evil.test/i/api/graphql/query' }], '123'), {});
  assert.deepEqual(articleMediaFromNetwork([{ ...entry, responsePreview: JSON.stringify(tweet('123', 'http://127.0.0.1/secret')) }], '123'), {});
});


test('task evidence stays in raw while its only final HTML stays in the project folder', async () => {
  const options = opts('task-delivery');
  const output = options.out;
  const task = await createTaskArchive(output, 'one user request', {newTask: true});
  options.out = task;
  const captured = await capture(page([snapshot()]), options);
  assert.equal(path.dirname(captured.task_html), task);
  assert.ok(captured.folder.startsWith(task + path.sep));
  assert.deepEqual(await fs.readdir(output), [path.basename(task)]);
  assert.deepEqual((await fs.readdir(task)).filter(name => name.endsWith('.html')), [`${path.basename(task)}.html`]);
  assert.ok((await verifyArchive(captured.folder)).ok);
  const resumed = await capture(page([snapshot()]), {...options, resume: true});
  assert.equal(resumed.folder, captured.folder);
  assert.equal(resumed.html_file, captured.html_file);
  assert.ok((await verifyArchive(resumed.folder)).ok);
});


test('search thumbnails preserve source URLs without spending any media operations', async () => {
  const source = 'https://example.com/search';
  const thumbnails = Array.from({length: 40}, (_, index) => ({kind: 'image', url: `https://example.com/${index}.png`}));
  const result = {query: 'AI poster', platform: 'web', requested_url: source, resolved_url: source, title: 'Search', status: 'captured', limitations: [], items: [], presentation: {html: '<img src="https://example.com/0.png"><a href="/article">Target</a>', assets: thumbnails}};
  let downloads = 0;
  const html = await htmlDocument(result, () => {downloads++; throw new Error('Search should not download thumbnails');}, {executionPolicy: testPolicy(tmp)});
  assert.equal(downloads, 0);
  assert.match(html, /https:\/\/example.com\/0.png/);
  assert.equal(result.offline.resources, 40);
  assert.equal(result.offline.remote_search_resources, true);
  assert.equal(result.offline.failures.length, 0);
  assert.equal(result.status, 'captured');
});


test('a requested media export defers page assets to the single archive downloader', async () => {
  const result = {platform: 'web', requested_url: 'https://example.com/article', resolved_url: 'https://example.com/article', title: 'Article', status: 'captured', limitations: [], items: [], presentation: {html: '<img src="https://example.com/photo.png">', assets: [{kind: 'image',url: 'https://example.com/photo.png'}]}};
  let requests = 0;
  const html = await htmlDocument(result, () => {requests++;}, {executionPolicy: testPolicy(tmp), deferMedia: true});
  assert.equal(requests, 0);
  assert.match(html, /https:\/\/example.com\/photo.png/);
  assert.equal(result.offline.media_export_deferred, true);
  assert.equal(result.offline.embedded, 0);
});
