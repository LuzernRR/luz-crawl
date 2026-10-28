import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { browserProxy, desktopUserAgent, playwrightRuntime, retryVisibleIfIncomplete, visibleFallbackReason, withHeadlessSession, withVisibleFallbackOnHeadlessStartFailure } from '../opencli/lib/headless.mjs';
import { extractPage } from '../opencli/lib/extract-page.mjs';
import { domOperation, BrowserOperations } from '../opencli/lib/browser-operations.mjs';
import { rememberPreferences } from '../opencli/lib/memory.mjs';
import { testPolicy } from './helpers.mjs';

test('desktop Chromium identity keeps its native version; proxy credentials never enter the server URL', () => {
  assert.equal(desktopUserAgent('Mozilla HeadlessChrome/151.0.0.0 Safari/537.36'), 'Mozilla Chrome/151.0.0.0 Safari/537.36');
  assert.throws(() => desktopUserAgent('Chrome/151\r\nInjected: yes'));
  assert.deepEqual(browserProxy({ HTTPS_PROXY: 'http://user:pass%21@127.0.0.1:7897' }), { server: 'http://127.0.0.1:7897', username: 'user', password: 'pass!', bypass: 'localhost,127.0.0.1,[::1]' });
  assert.throws(() => browserProxy({ HTTPS_PROXY: 'file:///private' }));
});

test('an unauthorized headless action is rejected before creating a browser profile', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'luz-headless-validation-'));
  try {
    await assert.rejects(promisify(execFile)(process.execPath, [fileURLToPath(new URL('../scripts/luz-crawl.mjs', import.meta.url)), 'browser', 'https://example.com', '--headless', '--steps', JSON.stringify([{action:'click',selector:'button'}])], { windowsHide: true, env:{...process.env,LUZ_CRAWL_STATE:directory} }), error => Boolean(error.stdout?.includes('allow-write')));
    assert.deepEqual(await fs.readdir(directory), []);
  } finally { await fs.rm(directory, {recursive:true,force:true}); }
});

const runtime = await playwrightRuntime().catch(() => null);

test('an unsupported browser is rejected before opening a profile or running the operation', async () => {
  let called = false;
  await assert.rejects(withHeadlessSession(() => { called = true; }, { browser: '../outside' }), /chromium or edge/);
  assert.equal(called, false);
});

test('incomplete headless reads retry once in the saved foreground profile, but cooldowns never switch routes', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'luz-visible-fallback-'));
  const previousState = process.env.LUZ_CRAWL_STATE;
  const previousProfile = process.env.LUZ_HEADLESS_PROFILE;
  const previousVisibleFallback = process.env.LUZ_VISIBLE_FALLBACK;
  process.env.LUZ_CRAWL_STATE = directory;
  process.env.LUZ_HEADLESS_PROFILE = 'headless-profile';
  try {
    await rememberPreferences({ profile: 'saved-edge-profile' });
    const calls = [];
    const partial = { status: 'partial', stop_reason: 'target_body_not_found', url_check: { valid_content: false }, browser: { context_id: 'headless-profile' } };
    const result = await retryVisibleIfIncomplete(async options => { calls.push(options); assert.equal(process.env.LUZ_VISIBLE_FALLBACK, '1'); return { status: 'captured', url_check: { valid_content: true } }; }, { profile: 'headless-alias', window: 'background', url: 'https://www.xiaohongshu.com/explore/example' }, partial);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].profile, 'saved-edge-profile');
    assert.equal(calls[0].window, 'foreground');
    assert.equal(calls[0].resume, true);
    assert.equal(calls[0]._luz_visible_fallback, true);
    assert.equal(result.status, 'captured');
  assert.equal(result.visible_fallback.visible_window, 'foreground');
  assert.equal(result.headless_fallback.visible_window, 'foreground');
  assert.equal(visibleFallbackReason({ status: 'awaiting_user', stop_reason: 'login_required' }), 'visible_login_required');
    assert.equal(visibleFallbackReason({ status: 'partial', stop_reason: 'rate_limited' }), null);
    assert.equal(visibleFallbackReason({ status: 'blocked', stop_reason: 'operation_budget' }), null);
    const limited = { status: 'blocked', stop_reason: 'rate_limited' };
    assert.strictEqual(await retryVisibleIfIncomplete(() => { throw new Error('must not retry'); }, {}, limited), limited);
  } finally {
    if (previousState === undefined) delete process.env.LUZ_CRAWL_STATE; else process.env.LUZ_CRAWL_STATE = previousState;
    if (previousProfile === undefined) delete process.env.LUZ_HEADLESS_PROFILE; else process.env.LUZ_HEADLESS_PROFILE = previousProfile;
    if (previousVisibleFallback === undefined) delete process.env.LUZ_VISIBLE_FALLBACK; else process.env.LUZ_VISIBLE_FALLBACK = previousVisibleFallback;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('incomplete profile reads retry in the explicitly selected foreground profile and skip an already-visible handoff', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'luz-profile-fallback-'));
  const previousState = process.env.LUZ_CRAWL_STATE;
  const previousProfile = process.env.LUZ_HEADLESS_PROFILE;
  delete process.env.LUZ_HEADLESS_PROFILE;
  process.env.LUZ_CRAWL_STATE = directory;
  try {
    await rememberPreferences({ profile: 'saved-edge-profile' });
    const calls = [];
    const partial = { status: 'partial', stop_reason: 'scroll_budget', browser: { context_id: 'saved-context', closed: true } };
    const result = await retryVisibleIfIncomplete(async options => { calls.push(options); return { status: 'captured', url_check: { valid_content: true } }; }, { profile: 'selected-edge-profile', window: 'background', url: 'https://mp.weixin.qq.com/s/example' }, partial);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].profile, 'selected-edge-profile');
    assert.equal(calls[0].window, 'foreground');
    assert.equal(result.visible_fallback.trigger, 'visible_scroll_budget');
    assert.equal(result.headless_fallback, undefined);

    const alreadyVisible = { status: 'awaiting_user', awaiting_reason: 'login_required', browser: { retained: true, parked: false, closed: false } };
    assert.strictEqual(await retryVisibleIfIncomplete(() => { throw new Error('must not retry'); }, {}, alreadyVisible), alreadyVisible);
  } finally {
    if (previousState === undefined) delete process.env.LUZ_CRAWL_STATE; else process.env.LUZ_CRAWL_STATE = previousState;
    if (previousProfile === undefined) delete process.env.LUZ_HEADLESS_PROFILE; else process.env.LUZ_HEADLESS_PROFILE = previousProfile;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('an incomplete foreground retry persists fallback metadata with its continuation task', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'luz-fallback-task-record-'));
  const previousState = process.env.LUZ_CRAWL_STATE;
  const previousProfile = process.env.LUZ_HEADLESS_PROFILE;
  process.env.LUZ_CRAWL_STATE = directory;
  process.env.LUZ_HEADLESS_PROFILE = 'headless-profile';
  try {
    const out = path.join(directory, 'output');
    const taskId = 'visible-partial-task';
    const taskFile = path.join(out, 'raw/tasks', `${taskId}.json`);
    await fs.mkdir(path.dirname(taskFile), { recursive: true });
    await fs.writeFile(taskFile, JSON.stringify({ id: taskId, result: { status: 'awaiting_user', content_status: 'partial', awaiting_reason: 'content_incomplete' } }));
    const result = await retryVisibleIfIncomplete(
      async () => ({ status: 'awaiting_user', task_id: taskId, content_status: 'partial', awaiting_reason: 'content_incomplete' }),
      { out, url: 'https://mp.weixin.qq.com/s/example' },
      { status: 'partial', stop_reason: 'scroll_budget', browser: { context_id: 'headless-profile' } },
    );
    const saved = JSON.parse(await fs.readFile(taskFile, 'utf8'));
    assert.deepEqual(saved.result.visible_fallback, result.visible_fallback);
    assert.deepEqual(saved.result.headless_fallback, result.headless_fallback);
    assert.equal(saved.result.awaiting_reason, 'content_incomplete');
  } finally {
    if (previousState === undefined) delete process.env.LUZ_CRAWL_STATE; else process.env.LUZ_CRAWL_STATE = previousState;
    if (previousProfile === undefined) delete process.env.LUZ_HEADLESS_PROFILE; else process.env.LUZ_HEADLESS_PROFILE = previousProfile;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('headless startup failures use the visible profile, but errors after the operation starts are not retried', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'luz-headless-start-fallback-'));
  const previousState = process.env.LUZ_CRAWL_STATE;
  process.env.LUZ_CRAWL_STATE = directory;
  try {
    await rememberPreferences({ profile: 'saved-edge-profile' });
    const calls = [];
    const result = await withVisibleFallbackOnHeadlessStartFailure(
      { headless: true, window: 'background', url: 'https://www.xiaohongshu.com/explore/example' },
      async options => { calls.push(options); return { status: 'captured', url_check: { valid_content: true } }; },
      async () => { throw new Error('headless Edge failed to start'); },
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].profile, 'saved-edge-profile');
    assert.equal(calls[0].window, 'foreground');
    assert.equal(calls[0]._luz_visible_fallback, true);
    assert.equal(result.status, 'captured');
    assert.equal(result.headless_fallback.trigger, 'headless_unavailable');

    let startedCalls = 0;
    await assert.rejects(withVisibleFallbackOnHeadlessStartFailure(
      {},
      async () => { startedCalls++; return { status: 'failed' }; },
      async operation => { await operation('headless-profile'); throw new Error('headless shutdown failed'); },
    ), /headless shutdown failed/);
    assert.equal(startedCalls, 1);
  } finally {
    if (previousState === undefined) delete process.env.LUZ_CRAWL_STATE; else process.env.LUZ_CRAWL_STATE = previousState;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('semantic X articles retain exact body, exclude avatars, and do not borrow a quoted source ID', { skip: !runtime }, async () => {
  const browser = await runtime.chromium.launch({ headless: true, ...(process.platform === 'win32' ? { executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' } : {}) });
  try {
    const page = await browser.newPage();
    const article = `<article><a href="/author"><div class="x-avatar"><img src="https://pbs.twimg.com/profile_images/avatar.jpg"></div></a><a href="/author">Display Name</a><div class="text-lead" dir="auto">An introduction</div><div><h1 data-article-part="title">Article title</h1><div data-article-part="body"><p>Exact first paragraph.</p><p>Exact second paragraph.</p><a href="https://x.com/other/status/999">Quoted post</a><img src="https://pbs.twimg.com/media/example.jpg"></div></div><a href="/author/status/123">2026-10-25</a><a href="/author/status/123">1,234 views</a><div data-engagement-action="like">42</div><div data-engagement-action="reply">3</div></article>`;
    await page.route('https://x.com/**', route => route.fulfill({ contentType: 'text/html', body: `<main>${article}</main>` }));
    await page.goto('https://x.com/author/status/123');
    const value = await page.evaluate(extractPage, { platform: 'x', requestedURL: 'https://x.com/author/status/123', comments: true, includePresentation: false });
    assert.equal(value.target_present, true);
    assert.equal(value.post.account.handle, 'author');
    assert.equal(value.post.account.name, 'Display Name');
    assert.equal(value.post.engagement.likes.value, 42);
    assert.equal(value.post.engagement.views.value, 1234);
    assert(value.post.text.includes('Exact first paragraph.\n\nExact second paragraph.'));
    assert.deepEqual(value.post.images.map(x => x.url), ['https://pbs.twimg.com/media/example.jpg']);
    const wrong = await page.evaluate(extractPage, { platform: 'x', requestedURL: 'https://x.com/other/status/999', includePresentation: false });
    assert.equal(wrong.target_present, false);
    await page.setContent('<main><article data-testid="tweet"><div data-testid="User-Name"><div>Display Name</div><div>@author</div></div><a href="/author/status/123"><time datetime="2026-10-25">Today</time></a><div data-testid="tweetText">Original introduction</div></article><div data-testid="twitterArticleReadView"><div data-testid="twitterArticleRichTextView">Original article body<a href="/i/article/456/media/111">First image</a><a href="/i/article/456/media/222">Second image</a></div></div></main>');
    const classic = await page.evaluate(extractPage, { platform: 'x', requestedURL: 'https://x.com/author/status/123', includePresentation: false, articleMedia: {222:{url:'https://pbs.twimg.com/media/second.jpg'},111:{url:'https://pbs.twimg.com/media/first.jpg'}} });
    assert.equal(classic.target_present, true); assert.equal(classic.post.account.handle, 'author'); assert.equal(classic.post.account.name, 'Display Name'); assert(classic.post.text.startsWith('Original article body'));
    assert.deepEqual(classic.post.images.map(x=>x.url), ['https://pbs.twimg.com/media/first.jpg','https://pbs.twimg.com/media/second.jpg']);
    await page.evaluate(() => { const image=document.createElement('img');image.src='https://pbs.twimg.com/media/first?format=jpg&name=small';document.querySelector('[data-testid="twitterArticleRichTextView"]').prepend(image); });
    const variants = await page.evaluate(extractPage, { platform: 'x', requestedURL: 'https://x.com/author/status/123', includePresentation: false, articleMedia: {222:{url:'https://pbs.twimg.com/media/second.jpg'},111:{url:'https://pbs.twimg.com/media/first.jpg'}} });
    assert.deepEqual(variants.post.images.map(x=>x.url), ['https://pbs.twimg.com/media/first?format=jpg&name=small','https://pbs.twimg.com/media/second.jpg']);
    await page.setContent('<main>访问 x.com 的请求遭到拒绝 HTTP ERROR 403</main>');
    const blocked = await page.evaluate(extractPage, { platform: 'x', requestedURL: 'https://x.com/search?q=test', isSearch: true, includePresentation: false });
    assert.equal(blocked.gate, 'access_denied'); assert.equal(blocked.target_present, false);
    await page.setContent('<main></main>');
    const shell = await page.evaluate(extractPage, { platform:'x', requestedURL:'https://x.com/search?q=test', includePresentation:false });
    assert.equal(shell.target_present, false);
    await page.goto('https://x.com/i/jf/onboarding/web?mode=login');
    await page.setContent('');
    const login = await page.evaluate(extractPage, { platform:'x', requestedURL:'https://x.com/search?q=test', includePresentation:false });
    assert.equal(login.gate, 'login_required'); assert.equal(login.target_present, false);
    await page.route('https://example.com/**', route => route.fulfill({ contentType: 'text/html', body: '<main><h1>Prompt library</h1><p>Original prompt without social engagement controls.</p></main>' }));
    await page.goto('https://example.com/library');
    const generic = await page.evaluate(extractPage, { platform:'web', requestedURL:'https://example.com/library', includePresentation:false });
    assert.equal(generic.target_present, true);
    assert(generic.post.text.includes('Original prompt'));
    assert(Object.values(generic.post.engagement).every(metric => metric.value === null));
  } finally { await browser.close(); }
});

test('hidden containers cannot become body text, and visible verification prompts stop writes', { skip: !runtime }, async () => {
  const browser = await runtime.chromium.launch({ headless: true, ...(process.platform === 'win32' ? { executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' } : {}) });
  try {
    const page = await browser.newPage();
    const options = { platform:'web', requestedURL:'https://example.com/', includePresentation:false };
    await page.setContent('<body><main hidden><style>.ExperienceHero-enter{color:red}</style>Hidden content</main></body>');
    const hidden = await page.evaluate(extractPage, options);
    assert.equal(hidden.post?.text || '', ''); assert.equal(hidden.target_present, false);
    await page.setContent('<main hidden>Hidden content</main><main style="display:contents"><style>.unused{color:red}</style><p>Visible original text</p></main>');
    const contents = await page.evaluate(extractPage, options);
    assert.equal(contents.post.text, 'Visible original text');
    await page.setContent('<article><p>为保证您的正常访问,请进行如下验证</p></article><div hidden>为保证您的正常访问,请进行如下验证</div><button>Search</button>');
    assert.equal((await page.evaluate(domOperation, { action:'read' })).gate, null);
    assert.equal((await page.evaluate(extractPage, options)).gate, null);
    await page.setContent('<main><h2>访问验证</h2><p>为保证您的正常访问,请进行如下验证</p><button>Search</button></main>');
    assert.equal((await page.evaluate(domOperation, { action:'read' })).gate, 'verification_required');
    assert.equal((await page.evaluate(extractPage, options)).gate, 'verification_required');
    const write = await page.evaluate(domOperation, { action:'click', selector:'button' });
    assert.equal(write.ok, false); assert.equal(write.error.code, 'verification_required');
  } finally { await browser.close(); }
});

test('synchronous search popups stay in the owned page and cannot execute non-HTTP URLs', { skip: !runtime }, async () => {
  const browser = await runtime.chromium.launch({ headless: true, ...(process.platform === 'win32' ? { executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' } : {}) });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'luz-popup-'));
  try {
    const page = await browser.newPage();
    await page.route('https://example.com/**', route => route.fulfill({ contentType: 'text/html', body: '<main>Search results</main>' }));
    await page.goto('https://example.com/');
    await page.setContent('<button id="search" onclick="window.open(\'/results?q=doors\',\'_blank\',\'noopener,noreferrer\')">Search</button>');
    const operations = new BrowserOperations(page, testPolicy(directory), page.url());
    const result = await operations.dom({ action: 'click', selector: '#search' });
    assert.equal(result.navigation_url, 'https://example.com/results?q=doors');
    assert.equal(page.url(), result.navigation_url); assert.equal(page.context().pages().length, 1);
    assert.equal(result.result.effect_verified, false);
    await page.setContent('<button id="search" onclick="window.open(\'javascript:window.exposed=true\')">Search</button>');
    await assert.rejects(operations.dom({ action: 'click', selector: '#search' }), /HTTP/);
    assert.equal(await page.evaluate(() => Boolean(window.exposed)), false);
    await page.setContent('<button id="search" onclick="window.open(\'/a\');window.open(\'/b\')">Search</button>');
    const ambiguous = await page.evaluate(domOperation, { action: 'click', selector: '#search' });
    assert.equal(ambiguous.error.code, 'invalid_target');
    assert.equal(page.context().pages().length, 1);
    assert.equal(await page.evaluate(() => /\[native code\]/.test(window.open.toString())), true);
  } finally { await browser.close(); await fs.rm(directory, { recursive: true, force: true }); }
});

test('TikTok portals without a video payload remain readable', { skip: !runtime }, async () => {
  const browser = await runtime.chromium.launch({ headless: true, ...(process.platform === 'win32' ? { executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' } : {}) });
  try {
    const page = await browser.newPage();
    await page.setContent('<main><h1>Creative Center</h1><p>Top Ads and trends</p></main>');
    const portal = await page.evaluate(extractPage, { platform:'tiktok', requestedURL:'https://ads.tiktok.com/business/creativecenter/', includePresentation:false });
    assert(portal.post.text.includes('Top Ads and trends'));
    const missing = await page.evaluate(extractPage, { platform:'tiktok', requestedURL:'https://www.tiktok.com/@author/video/123', includePresentation:false });
    assert.equal(missing.target_present, false);
  } finally { await browser.close(); }
});

test('an interrupted headless operation closes only its dedicated browser', { skip: process.env.LUZ_HEADLESS_INTEGRATION !== '1' || !runtime }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'luz-headless-'));
  const previous = process.env.LUZ_CRAWL_STATE;
  process.env.LUZ_CRAWL_STATE = directory;
  let browser;
  try {
    await assert.rejects(withHeadlessSession(async (profile, context) => {
      assert(profile); browser = context.browser();
      const page = context.pages()[0] || await context.newPage();
      const agent = await page.evaluate(() => navigator.userAgent);
      if (!process.env.LUZ_HEADLESS_BROWSER || process.env.LUZ_HEADLESS_BROWSER === 'edge') assert(agent.includes('Edg/'), 'Default browser must be Microsoft Edge');
      throw new Error('intentional operation interruption');
    }), /intentional operation interruption/);
    assert.equal(browser.isConnected(), false);
  } finally { if (previous === undefined) delete process.env.LUZ_CRAWL_STATE; else process.env.LUZ_CRAWL_STATE = previous; await fs.rm(directory, { recursive: true, force: true }); }
});
