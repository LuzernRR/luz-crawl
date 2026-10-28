import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { withBrowser, cancelTask } from '../opencli/lib/browser-session.mjs';
import { preferences, rememberPreferences, rememberSite, sites, pendingTasks } from '../opencli/lib/memory.mjs';
import { sourceCandidates, publicSourceAlternate } from '../opencli/lib/search.mjs';
import { sourceURL, searchURL, canonicalURL, CATALOG } from '../opencli/lib/platforms.mjs';
import { profileFromArgs } from '../opencli/lib/doctor.mjs';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'luzcrawl-session-'));
process.env.LUZ_CRAWL_STATE = path.join(tmp, 'memory');
test.after(() => fs.rm(tmp, { recursive: true, force: true }));
function fake() {
  const tabs = new Map();
  const closed = [];
  return { tabs, closed, factory: async () => ({
    connect: async ({ session }) => {
      const page = tabs.get(session) || `page-${session}`;
      tabs.set(session, page);
      return { contextId: 'test-profile', getActivePage: () => page, setActivePage: (id) => assert.equal(id, page), tabs: async () => [...tabs.values()].map((id) => ({ page: id })), closeTab: async (id) => { assert.equal(id, page); closed.push(id); tabs.delete(session); } };
    }, close: async () => {},
  }) };
}

test('normal completion closes only its owned page', async () => {
  const browser = fake(); browser.tabs.set('user', 'user-page');
  const result = await withBrowser('capture', { url: 'https://example.com/article', out: path.join(tmp, 'complete') }, async () => ({ status: 'captured', stop_reason: 'article_dom_complete' }), browser.factory);
  assert.equal(result.browser.closed, true); assert.equal(browser.closed.length, 1);
  assert.equal(browser.tabs.get('user'), 'user-page');
  assert.equal(result.summary_report.pages, 1);
  await fs.access(result.summary_report.file);
});

test('bridge setup failures are structured and saved before any page is opened', async () => {
  const out = path.join(tmp, 'setup-error');
  const result = await withBrowser('capture', { url: 'https://example.com', out }, async () => assert.fail('must not run'), async () => { throw new Error('bridge unavailable'); });
  assert.equal(result.status, 'failed'); assert.equal(result.browser.owned, false); assert.equal(result.browser.closed, true);
  const files = await fs.readdir(path.join(out, 'raw/tasks'));
  const saved = JSON.parse(await fs.readFile(path.join(out, 'raw/tasks', files[0]), 'utf8'));
  assert.equal(saved.result.error, 'bridge unavailable');
  await fs.access(result.summary_report.file);
});

test('summary write failure preserves capture status and closes only its owned page', async () => {
  const out=path.join(tmp,'summary-write-error'), browser=fake();
  await fs.mkdir(path.join(out,'raw/crawl-summary.json'),{recursive:true});
  const result=await withBrowser('capture',{url:'https://example.com/article',out},async()=>({status:'captured'}),browser.factory);
  assert.equal(result.status,'captured');
  assert.equal(result.browser.closed,true);
  assert.equal(browser.closed.length,1);
  assert.equal(typeof result.summary_error,'string');
});

test('bridge shutdown failures downgrade completion and preserve cleanup evidence', async () => {
  const browser = fake(); const out = path.join(tmp, 'shutdown-error');
  const result = await withBrowser('capture', { url: 'https://example.com', out }, async () => ({ status: 'captured' }), async () => ({ ...await browser.factory(), close: async () => { throw new Error('disconnect failed'); } }));
  assert.equal(result.status, 'partial'); assert.equal(result.browser.closed, true); assert.equal(result.cleanup_error, 'disconnect failed');
  const files = await fs.readdir(path.join(out, 'raw/tasks'));
  assert.equal(JSON.parse(await fs.readFile(path.join(out, 'raw/tasks', files[0]), 'utf8')).result.status, 'partial');
});

test('login reveals only the owned task page in the selected existing browser profile',async()=>{
  const browser=fake();const revealed=[];
  const factory=async()=>{const bridge=await browser.factory();return{...bridge,connect:async settings=>({...await bridge.connect(settings),revealTask:async page=>revealed.push(page)})};};
  const result=await withBrowser('capture',{url:'https://example.com/login',out:path.join(tmp,'visible-login')},async()=>({status:'blocked',stop_reason:'login_required'}),factory);
  assert.equal(result.status,'awaiting_user');assert.deepEqual(revealed,[result.browser.page]);assert.equal(result.browser.retained,true);
  await cancelTask(result.task_id,browser.factory);
});

test('headless login requirements save a parked task and report the owned page closed', async () => {
  const previous = process.env.LUZ_HEADLESS_PROFILE;
  process.env.LUZ_HEADLESS_PROFILE = 'test-profile';
  const browser = fake(); browser.tabs.set('user', 'user-page');
  try {
    const result = await withBrowser('capture', { url:'https://example.com/login', out:path.join(tmp,'headless-login') }, async () => ({status:'blocked',stop_reason:'login_required'}), browser.factory);
    assert.equal(result.status, 'awaiting_user'); assert.equal(result.browser.closed, true); assert.equal(result.browser.retained, false); assert.equal(result.browser.parked, true);
    assert.equal(browser.tabs.get('user'), 'user-page');
    const saved = (await pendingTasks()).find(task => task.id === result.task_id);
    assert(saved.parked); assert.equal(saved.page, undefined);
    await cancelTask(result.task_id, browser.factory);
  } finally { if(previous===undefined) delete process.env.LUZ_HEADLESS_PROFILE; else process.env.LUZ_HEADLESS_PROFILE=previous; }
});

test('a browser operation error preserves its cause, closes the owned page and saves cleanup evidence', async () => {
  const browser = fake(); browser.tabs.set('user', 'user-page');
  const out = path.join(tmp, 'transport-error');
  const result = await withBrowser('capture', { out, url: 'https://example.com' }, async () => { throw new Error('Command result is unknown'); }, browser.factory);
  assert.equal(result.status, 'failed'); assert.equal(result.error, 'Command result is unknown');
  assert.equal(result.browser.closed, true); assert.equal(browser.tabs.get('user'), 'user-page');
  const records = await fs.readdir(path.join(out, 'raw/tasks'));
  const saved = JSON.parse(await fs.readFile(path.join(out, 'raw/tasks', records[0]), 'utf8'));
  assert.equal(saved.result.browser.closed, true);
});

test('concurrent batch login tasks park independently without revealing pages or retaining the batch option', async () => {
  const browser = fake(); browser.tabs.set('user', 'user-page');
  const revealed = [];
  const factory = async () => { const bridge = await browser.factory(); return { ...bridge, connect: async settings => ({ ...await bridge.connect(settings), revealTask: async page => revealed.push(page) }) }; };
  const results = await Promise.all(['one', 'two'].map(name => withBrowser('capture', { url: `https://${name}.test/login`, out: path.join(tmp, name), park_on_block: true }, async () => ({ status: 'blocked', stop_reason: 'login_required' }), factory)));
  assert.deepEqual(revealed, []); assert.equal(browser.tabs.size, 1); assert.equal(browser.tabs.get('user'), 'user-page');
  for (const result of results) {
    assert.equal(result.browser.closed, true); assert.equal(result.browser.parked, true);
    const task = (await pendingTasks()).find(task => task.id === result.task_id);
    assert.equal(task.options.park_on_block, undefined);
    await cancelTask(result.task_id, browser.factory);
  }
});

test('one login page stays open; other tasks park and continue without losing state', async () => {
  const browser = fake();
  const values = { url: 'https://example.com/login', out: path.join(tmp, 'login') };
  const first = await withBrowser('capture', values, async () => ({ status: 'blocked', stop_reason: 'login_required' }), browser.factory);
  const other = await withBrowser('capture', { ...values, url: 'https://other.example.com/login' }, async () => ({ status: 'blocked', stop_reason: 'verification_required' }), browser.factory);
  assert.equal(first.status, 'awaiting_user'); assert.equal(first.browser.retained, true); assert.equal(browser.closed.length, 1);
  assert.equal(other.browser.closed, true); assert.equal(other.browser.parked, true);
  assert.notEqual(first.browser.page, other.browser.page); assert.equal((await pendingTasks()).length, 2);
  const done = await withBrowser('capture', { task: first.task_id }, async (_, options) => { assert.equal(options.resume, true); assert.equal(options.url, values.url); return { status: 'captured', stop_reason: 'article_dom_complete' }; }, browser.factory);
  assert.equal(done.browser.closed, true); assert.equal((await pendingTasks()).length, 1);
  assert.equal(browser.tabs.has(other.browser.session), false);
  await cancelTask(other.task_id, browser.factory); assert.equal((await pendingTasks()).length, 0);
});

test('foreground fallback parks older LuzCrawl pages and keeps the requested login page open', async () => {
  const browser = fake(); const revealed = [];
  const factory = async () => {
    const bridge = await browser.factory();
    return { ...bridge, connect: async settings => ({ ...await bridge.connect(settings), revealTask: async page => revealed.push(page) }) };
  };
  const first = await withBrowser('capture', { url: 'https://example.com/older-login', out: path.join(tmp, 'older-login') }, async () => ({ status: 'blocked', stop_reason: 'login_required' }), factory);
  const current = await withBrowser('capture', { url: 'https://example.com/current-login', out: path.join(tmp, 'current-login'), window: 'foreground', _luz_visible_fallback: true }, async () => ({ status: 'blocked', stop_reason: 'login_required' }), factory);
  const tasks = await pendingTasks();
  assert(tasks.find(task => task.id === first.task_id).parked);
  assert.equal(current.browser.retained, true);
  assert.equal(current.browser.parked, undefined);
  assert.equal(revealed.at(-1), current.browser.page);
  await cancelTask(current.task_id, browser.factory);
  await cancelTask(first.task_id, browser.factory);
});

test('an incomplete foreground retry stays open with an honest partial status for manual continuation', async () => {
  const browser = fake();
  const result = await withBrowser('capture', { url: 'https://mp.weixin.qq.com/s/example', out: path.join(tmp, 'incomplete-visible'), window: 'foreground', _luz_visible_fallback: true }, async () => ({ status: 'partial', stop_reason: 'scroll_budget' }), browser.factory);
  assert.equal(result.status, 'awaiting_user');
  assert.equal(result.content_status, 'partial');
  assert.equal(result.awaiting_reason, 'content_incomplete');
  assert.equal(result.browser.retained, true);
  assert.equal(result.browser.closed, false);
  await cancelTask(result.task_id, browser.factory);
});

test('temporary output does not change saved preferences; custom sites validate domain boundaries', async () => {
  const before = await preferences();
  const browser = fake();
  await withBrowser('capture', { out: path.join(tmp, 'temporary'), url: 'https://example.com/article' }, async () => ({ status: 'captured' }), browser.factory);
  assert.equal((await preferences()).output_dir, before.output_dir);
  await rememberPreferences({ out: path.join(tmp, 'preferred'), format: 'html', keywords: '采购,家具' });
  assert.equal((await preferences()).format, 'html');
  await assert.rejects(() => rememberSite({ site: 'https://example.com', name: 'example', template: 'https://evil.test/?q={query}' }), /registered site/);
  await rememberSite({ site: 'https://example.com', name: 'example', template: 'https://example.com/search?q={query}' });
  assert.ok((await sites()).some((site) => site.id === 'example'));
});

test('saved browser selection is used and explicit profile flags take precedence', async () => {
  await rememberPreferences({ profile: 'saved-profile' });
  const browser = fake();
  await withBrowser('capture', { url: 'https://example.com/article', out: path.join(tmp, 'profile') }, async (_, options) => {
    assert.equal(options.profile, 'saved-profile');
    return { status: 'captured' };
  }, browser.factory);
  const prior = process.argv;
  const fallbackProfile = process.env.LUZ_VISIBLE_FALLBACK_PROFILE;
  try {
    process.argv = ['node', 'script']; assert.equal(profileFromArgs('saved-profile'), 'saved-profile');
    process.argv = ['node', 'script', '--profile', 'chosen-profile']; assert.equal(profileFromArgs('saved-profile'), 'chosen-profile');
    process.argv = ['node', 'script', '--profile=other-profile']; assert.equal(profileFromArgs('saved-profile'), 'other-profile');
    process.env.LUZ_VISIBLE_FALLBACK_PROFILE = 'visible-profile';
    assert.equal(profileFromArgs('saved-profile'), 'visible-profile');
    process.env.LUZ_VISIBLE_FALLBACK_PROFILE = '';
    assert.equal(profileFromArgs('saved-profile'), undefined);
  } finally {
    process.argv = prior;
    if (fallbackProfile === undefined) delete process.env.LUZ_VISIBLE_FALLBACK_PROFILE; else process.env.LUZ_VISIBLE_FALLBACK_PROFILE = fallbackProfile;
  }
});

test('search candidates decode engine redirects and reject lookalike domains and login links', () => {
  const target = 'https://www.qcc.com/firm/company.html';
  const redirect = 'https://www.bing.com/ck/a?u=a1' + Buffer.from(target).toString('base64url');
  const result = sourceCandidates({ requested_url: 'https://bing.com/search?q=test', links: [{ url: redirect }, { url: target }, { url: 'https://qcc.com.evil.test/firm/a' }, { url: 'https://qcc.com/login' }] }, { domains: ['qcc.com'], detail: '/firm/' });
  assert.deepEqual(result.map((item) => item.url), [target]);
  assert.equal(sourceURL('https://dy.huitun.com/#/rank/douyin'), 'https://dy.huitun.com/#/rank/douyin');
  assert.ok(searchURL('灰豚', 'query').startsWith('https://dy.huitun.com'));
  assert.equal(sourceURL('https://example.com/#/rank?access_token=secret&tab=public'), 'https://example.com/#/rank?tab=public');
  assert.equal(canonicalURL('https://jingxuan.douyin.com/m/video/123'), canonicalURL('https://www.douyin.com/video/123'));
  assert.equal(publicSourceAlternate('https://jingxuan.douyin.com/m/video/123'), 'https://www.douyin.com/video/123');
  assert.equal(publicSourceAlternate('https://jingxuan.douyin.com.evil.test/m/video/123'), null);
  assert.equal(publicSourceAlternate('https://apps.weibo.com/3223014472/P8PCpnQkb'), 'https://weibo.com/3223014472/P8PCpnQkb');
  assert.equal(publicSourceAlternate('https://apps.weibo.com.evil.test/3223014472/P8PCpnQkb'), null);
});

test('GitHub repository discovery rejects stars, forks, files and site navigation', () => {
  const base = 'https://github.com/polyformproject/polyform-licenses';
  const urls = [base, base + '/stargazers', base + '/forks', base + '/blob/main/LICENSE', 'https://github.com/topics/crawler'];
  const found = sourceCandidates({ requested_url: 'https://github.com/search?q=license', links: urls.map((url) => ({ url })) }, CATALOG.find((site) => site.id === 'github'));
  assert.deepEqual(found.map((item) => item.url), [base]);
});
