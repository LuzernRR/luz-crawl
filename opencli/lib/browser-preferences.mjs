import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { preferences, rememberPreferences } from './memory.mjs';
import { resolveOpenCLI, profileFromArgs } from './doctor.mjs';

async function extensionPreferences(op, values, profile) {
  const runtime = await resolveOpenCLI();
  if (!runtime?.compatible) throw new Error('需要兼容的 LuzCrawl 运行时。');
  const { requestDaemon } = await import(pathToFileURL(path.join(runtime.root, 'dist/src/browser/daemon-transport.js')).href);
  const { profileRouteParams, resolveProfileSelection } = await import(pathToFileURL(path.join(runtime.root, 'dist/src/browser/profile.js')).href);
  const routing = profileRouteParams(resolveProfileSelection(profileFromArgs(profile)));
  const response = await requestDaemon('/command', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, timeout: 6000,
    body: JSON.stringify({ id: `luzcrawl-settings-${randomUUID()}`, action: 'luzcrawl-preferences', op, values, session: 'luzcrawl-settings', surface: 'browser', timeout: 4, ...routing }),
  });
  if (!response.ok) throw new Error(`目录同步 HTTP ${response.status}`);
  const result = await response.json();
  if (!result.ok) throw new Error(result.error || '请在扩展页重新加载 LuzCrawl。');
  return result.data;
}

export async function syncBrowserPreferences(profile, request = extensionPreferences) {
  let local = await preferences();
  try {
    const browser = await request('get', {}, profile);
    if (browser?.output_dir) {
      if (!path.isAbsolute(browser.output_dir) || /[\u0000-\u001f\u007f]/.test(browser.output_dir) || browser.output_dir.length > 4096 || !Number.isSafeInteger(browser.updated_at) || browser.updated_at < 0) throw new Error('浏览器保存目录无效。');
      if (browser.updated_at > (local.output_updated_at || 0)) local = await rememberPreferences({ out: browser.output_dir, output_updated_at: browser.updated_at });
    }
    if (local.output_updated_at && local.output_updated_at > (browser?.updated_at || 0)) {
      await request('set', { output_dir: local.output_dir, updated_at: local.output_updated_at }, profile);
    }
    return local;
  } catch (error) {
    return { ...local, browser_settings_error: error.message };
  }
}
