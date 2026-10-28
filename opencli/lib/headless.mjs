import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { atomicWrite, stateRoot } from './archive.mjs';
import { resolveOpenCLI } from './doctor.mjs';
import { pendingTasks, preferences } from './memory.mjs';
import { cancelTask, parkTask } from './browser-session.mjs';

const EDGE_EXECUTABLE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

export function visibleFallbackReason(result) {
  const reason = result?.awaiting_reason || result?.stop_reason || result?.failure?.code;
  if (result?.cooldown_evidence?.source === 'platform_page') return 'visible_platform_cooldown';
  if (['rate_limited', 'operation_budget', 'cancelled'].includes(reason)) return null;
  if (result?.status === 'awaiting_user') return ['login_required', 'verification_required'].includes(reason) ? `visible_${reason}` : null;
  if (['partial', 'blocked'].includes(result?.status)) return `visible_${reason || result.status}`;
  if (result?.status === 'failed' && ['login_required', 'verification_required', 'access_denied', 'unavailable', 'transient_failure'].includes(reason)) return `visible_${reason}`;
  if (result?.url_check?.valid_content === false) return 'visible_content_unverified';
  return null;
}

async function persistVisibleFallback(result, options) {
  if (!result.task_id || !options.out) return;
  const file = path.join(options.out, 'raw/tasks', `${result.task_id}.json`);
  try {
    const task = JSON.parse(await fs.readFile(file, 'utf8'));
    await atomicWrite(file, { ...task, result: { ...task.result, visible_fallback: result.visible_fallback, ...(result.headless_fallback ? { headless_fallback: result.headless_fallback } : {}) } });
  } catch (error) {
    result.visible_fallback = { ...result.visible_fallback, persistence_error: error.message };
  }
}

export async function retryVisibleIfIncomplete(operation, options, headlessResult) {
  const trigger = visibleFallbackReason(headlessResult);
  if (!trigger || (headlessResult?.browser?.retained && !headlessResult.browser.parked)) return headlessResult;
  const saved = await preferences();
  const headlessProfile = process.env.LUZ_HEADLESS_PROFILE;
  const headless = Boolean(headlessProfile && (options.profile === headlessProfile || headlessResult?.browser?.context_id === headlessProfile));
  const savedProfile = saved.reuse_browser_profile === false ? undefined : saved.browser_profile;
  const profile = headless ? savedProfile === headlessProfile ? undefined : savedProfile : options.profile || savedProfile;
  console.error(`[LuzCrawl] 读取未确认完整（${headlessResult.stop_reason || headlessResult.status}），正在已连接浏览器中前台重试一次。`);
  const previousProfile = process.env.LUZ_VISIBLE_FALLBACK_PROFILE;
  const previousFallback = process.env.LUZ_VISIBLE_FALLBACK;
  let visibleResult;
  try {
    process.env.LUZ_VISIBLE_FALLBACK_PROFILE = profile || '';
    process.env.LUZ_VISIBLE_FALLBACK = '1';
    visibleResult = await operation({ ...options, profile, headless: false, window: 'foreground', resume: true, _luz_visible_fallback: true });
  } catch (error) {
    const fallback = { trigger, initial_status: headlessResult.status, visible_status: 'failed', visible_error: error.message, visible_window: 'foreground' };
    const result = { ...headlessResult, visible_fallback: fallback, ...(headless ? { headless_fallback: fallback } : {}) };
    await persistVisibleFallback(result, options);
    return result;
  } finally {
    if (previousProfile === undefined) delete process.env.LUZ_VISIBLE_FALLBACK_PROFILE;
    else process.env.LUZ_VISIBLE_FALLBACK_PROFILE = previousProfile;
    if (previousFallback === undefined) delete process.env.LUZ_VISIBLE_FALLBACK;
    else process.env.LUZ_VISIBLE_FALLBACK = previousFallback;
  }
  if (visibleResult?.status === 'failed') {
    const fallback = { trigger, initial_status: headlessResult.status, visible_status: visibleResult.status, visible_error: visibleResult.error, visible_window: 'foreground' };
    const result = { ...headlessResult, visible_fallback: fallback, ...(headless ? { headless_fallback: fallback } : {}) };
    await persistVisibleFallback(result, options);
    return result;
  }
  let headlessPendingRemoved = false;
  let cleanupError;
  if (headlessResult?.task_id && headlessResult.task_id !== visibleResult?.task_id) {
    try { await cancelTask(headlessResult.task_id); headlessPendingRemoved = true; }
    catch (error) { cleanupError = error.message; }
  }
  const fallback = {
    trigger,
    initial_status: headlessResult.status,
    initial_stop_reason: headlessResult.stop_reason || headlessResult.awaiting_reason,
    ...(headlessResult.task_id ? { initial_task_id: headlessResult.task_id } : {}),
    ...(headlessPendingRemoved ? { initial_task_removed: true } : {}),
    ...(cleanupError ? { cleanup_error: cleanupError } : {}),
    visible_window: 'foreground',
  };
  const result = {
    ...visibleResult,
    visible_fallback: fallback,
    ...(headless ? { headless_fallback: {
      trigger,
      headless_status: headlessResult.status,
      headless_stop_reason: headlessResult.stop_reason || headlessResult.awaiting_reason,
      ...(headlessResult.task_id ? { headless_task_id: headlessResult.task_id } : {}),
      ...(headlessPendingRemoved ? { headless_pending_removed: true } : {}),
      ...(cleanupError ? { cleanup_error: cleanupError } : {}),
      visible_window: 'foreground',
    } } : {}),
  };
  await persistVisibleFallback(result, options);
  return result;
}

export async function withVisibleFallbackOnHeadlessStartFailure(options, operation, runHeadless = withHeadlessSession) {
  let operationStarted = false;
  try {
    return await runHeadless(profile => {
      operationStarted = true;
      return operation({ ...options, headless: false, profile, window: 'background' });
    });
  } catch (error) {
    if (operationStarted) throw error;
    const result = await retryVisibleIfIncomplete(operation, options, { status: 'failed', stop_reason: 'unavailable', error: error.message });
    return result.visible_fallback ? { ...result, headless_fallback: { ...result.visible_fallback, trigger: 'headless_unavailable' } } : result;
  }
}

export function desktopUserAgent(value) {
  if (typeof value !== 'string' || !/Chrome\/[\d.]+/.test(value) || /[\r\n]/.test(value)) throw new Error('Invalid Chromium user agent.');
  return value.replaceAll('HeadlessChrome/', 'Chrome/');
}

export function browserProxy(env = process.env) {
  const value = env.HTTPS_PROXY || env.HTTP_PROXY || env.ALL_PROXY;
  if (!value) return undefined;
  const url = new URL(value);
  if (!['http:', 'https:', 'socks5:'].includes(url.protocol)) throw new Error('Unsupported browser proxy protocol.');
  return { server: `${url.protocol}//${url.host}`, bypass: 'localhost,127.0.0.1,[::1]', ...(url.username ? { username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) } : {}) };
}

export async function playwrightRuntime() {
  const require = createRequire(import.meta.url);
  const candidates = [process.env.LUZ_PLAYWRIGHT_MODULE];
  try { candidates.push(require.resolve('playwright')); } catch {}
  candidates.push(path.resolve(path.dirname(process.execPath), '../node_modules/playwright/index.mjs'), path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'));
  for (const file of candidates.filter(Boolean)) {
    try { await fs.access(file); } catch { continue; }
    const runtime = await import(pathToFileURL(path.resolve(file)).href);
    if (runtime.chromium) return runtime;
  }
  throw new Error('Playwright is unavailable. Install playwright in opencli/, or set LUZ_PLAYWRIGHT_MODULE to its entry file.');
}

async function daemonStatus() {
  const response = await fetch('http://127.0.0.1:19825/status', { headers: { 'X-OpenCLI': '1' }, signal: AbortSignal.timeout(2500) });
  if (!response.ok) throw new Error('OpenCLI daemon status is unavailable.');
  return response.json();
}

async function ensureDaemon() {
  try { await daemonStatus(); return; } catch {}
  const runtime = await resolveOpenCLI();
  if (!runtime?.compatible) throw new Error('A compatible OpenCLI runtime is required.');
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runtime.main, 'daemon', 'restart'], { windowsHide: true, stdio: 'ignore', shell: false });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error('OpenCLI daemon did not start.')));
  });
}

async function userAgent(chromium, launch) {
  const executable = launch.executablePath || chromium.executablePath();
  const stat = await fs.stat(executable);
  const revision = `${executable}:${stat.size}:${stat.mtimeMs}`;
  const cacheFile = path.join(stateRoot(), 'headless-runtime.json');
  let cached;
  try { cached = JSON.parse(await fs.readFile(cacheFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  if (cached?.revision === revision) return desktopUserAgent(cached.user_agent);
  const browser = await chromium.launch({ ...launch, headless: true });
  try {
    const page = await browser.newPage();
    const agent = desktopUserAgent(await page.evaluate(() => navigator.userAgent));
    await atomicWrite(cacheFile, { revision, user_agent: agent });
    return agent;
  } finally { await browser.close(); }
}

export async function withHeadlessSession(operation, { headed = false, browser = process.env.LUZ_HEADLESS_BROWSER || 'edge' } = {}) {
  if (!['chromium', 'edge'].includes(browser)) throw new Error('LUZ_HEADLESS_BROWSER must be chromium or edge.');
  const launch = browser === 'edge' ? { executablePath: EDGE_EXECUTABLE } : { channel: 'chromium' };
  const { chromium } = await playwrightRuntime();
  const agent = await userAgent(chromium, launch);
  await ensureDaemon();
  const extensionCandidates = ['../../browser-extension/', '../browser-extension/'].map(value => fileURLToPath(new URL(value, import.meta.url)));
  let extension;
  for (const candidate of extensionCandidates) { try { await fs.access(path.join(candidate, 'manifest.json')); extension = candidate; break; } catch {} }
  if (!extension) throw new Error('The bundled LuzCrawl extension is missing.');
  const context = await chromium.launchPersistentContext(path.join(stateRoot(), browser === 'edge' ? 'browser-profile-edge' : 'browser-profile'), { ...launch, headless: !headed, userAgent: agent, acceptDownloads: true, downloadsPath: path.join(stateRoot(), 'browser-downloads'), viewport: { width: 1220, height: 720 }, proxy: browserProxy(), args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const previousProfile = process.env.LUZ_HEADLESS_PROFILE;
  let profile;
  try {
    let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
    // Persistent Edge profiles can retain an older unpacked extension script.
    const refreshed = context.waitForEvent('serviceworker', { timeout: 15000 });
    await worker.evaluate(() => chrome.runtime.reload()).catch(error => { if (!/closed|destroyed/i.test(error.message)) throw error; });
    worker = await refreshed;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      profile = await worker.evaluate(async () => (await chrome.storage.local.get('opencli_context_id_v1')).opencli_context_id_v1);
      if (typeof profile === 'string' && (await daemonStatus()).profiles?.some(item => item.contextId === profile && item.extensionConnected)) {
        if (!headed) process.env.LUZ_HEADLESS_PROFILE = profile;
        return await operation(profile, context);
      }
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    throw new Error('The headless LuzCrawl extension did not connect within 15 seconds.');
  } finally {
    try { if (profile) for (const task of await pendingTasks()) if (task.context_id === profile && task.page && !task.parked) await parkTask(task); }
    finally {
      try { await context.close(); }
      finally { if (previousProfile === undefined) delete process.env.LUZ_HEADLESS_PROFILE; else process.env.LUZ_HEADLESS_PROFILE = previousProfile; }
    }
  }
}
