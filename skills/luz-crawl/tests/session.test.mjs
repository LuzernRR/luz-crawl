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
  try {
    process.argv = ['node', 'script']; assert.equal(profileFromArgs('saved-profile'), 'saved-profile');
    process.argv = ['node', 'script', '--profile', 'chosen-profile']; assert.equal(profileFromArgs('saved-profile'), 'chosen-profile');
    process.argv = ['node', 'script', '--profile=other-profile']; assert.equal(profileFromArgs('saved-profile'), 'other-profile');
  } finally { process.argv = prior; }
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
