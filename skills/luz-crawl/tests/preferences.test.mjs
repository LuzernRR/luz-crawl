import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { normalizeDirectory, getOutputPreferences, setOutputPreferences, SETTINGS_KEY } from '../browser-extension/preferences.js';
import { preferences, rememberPreferences } from '../opencli/lib/memory.mjs';
import { syncBrowserPreferences } from '../opencli/lib/browser-preferences.mjs';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'luzcrawl-preferences-'));
assert.equal(path.dirname(temp), path.resolve(os.tmpdir()));
process.env.LUZ_CRAWL_STATE = path.join(temp, 'memory');
test.after(() => fs.rm(temp, { recursive: true, force: true }));

test('directory settings reject relative paths and keep storage unchanged on invalid input', async () => {
  const records = {};
  const storage = { get: async () => records, set: async (next) => Object.assign(records, next) };
  assert.equal(normalizeDirectory(' E:\\Research\\LuzCrawl '), 'E:\\Research\\LuzCrawl');
  await setOutputPreferences({ output_dir: '/tmp/research', updated_at: 1 }, storage);
  for (const invalid of ['relative/path', 'https://example.com', 'C:\\bad\u0000path', '']) {
    await assert.rejects(() => setOutputPreferences({ output_dir: invalid }, storage), /绝对目录/);
  }
  assert.deepEqual(await getOutputPreferences(storage), { output_dir: '/tmp/research', updated_at: 1 });
  assert.equal(Object.keys(records)[0], SETTINGS_KEY);
});

test('newer browser directory becomes the CLI default without losing other preferences', async () => {
  await rememberPreferences({ out: path.join(temp, 'original'), keywords: '家具', profile: 'profile-a' });
  const initial = await preferences();
  let browser = { output_dir: path.join(temp, 'from-browser'), updated_at: initial.output_updated_at + 1 };
  const request = async (op, values, profile) => {
    assert.equal(profile, 'profile-a');
    if (op === 'set') browser = values;
    return browser;
  };
  const saved = await syncBrowserPreferences('profile-a', request);
  assert.equal(saved.output_dir, path.join(temp, 'from-browser'));
  assert.deepEqual(saved.keywords, ['家具']);
  assert.equal(saved.browser_profile, 'profile-a');
  assert.equal((await preferences()).output_dir, saved.output_dir);
  assert.equal((await preferences()).output_updated_at, browser.updated_at);
});

test('newer CLI preference reaches the browser, and a disconnected browser cannot erase it', async () => {
  const current = await preferences();
  await rememberPreferences({ out: path.join(temp, 'from-cli'), output_updated_at: current.output_updated_at + 1 });
  let browser = { output_dir: path.join(temp, 'old'), updated_at: 1 };
  const request = async (op, values) => { if (op === 'set') browser = values; return browser; };
  const saved = await syncBrowserPreferences('profile-a', request);
  assert.equal(browser.output_dir, saved.output_dir);
  const offline = await syncBrowserPreferences('profile-a', async () => { throw new Error('offline'); });
  assert.equal(offline.output_dir, saved.output_dir);
  assert.equal(offline.browser_settings_error, 'offline');
  const invalid = await syncBrowserPreferences('profile-a', async () => ({ output_dir: 'relative', updated_at: Date.now() + 1 }));
  assert.match(invalid.browser_settings_error, /无效/);
  assert.equal((await preferences()).output_dir, saved.output_dir);
});
