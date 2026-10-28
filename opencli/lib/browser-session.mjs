import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolveOpenCLI, profileFromArgs } from './doctor.mjs';
import { atomicWrite } from './archive.mjs';
import { preferences, pendingFile, loadTask, pendingTasks } from './memory.mjs';
import { sourceURL } from './platforms.mjs';
import { createExecutionPolicy } from './execution.mjs';
import { BrowserOperations } from './browser-operations.mjs';
import { classifyFailure, OperationError } from './failure.mjs';
import { downloadResult } from './download.mjs';
import { writeCrawlSummary } from './crawl-summary.mjs';

async function createBridge(profile) {
  const runtime = await resolveOpenCLI();
  if (!runtime?.compatible) throw new Error('A compatible LuzCrawl runtime is required; run doctor.');
  const { BrowserBridge } = await import(pathToFileURL(path.join(runtime.root, 'dist/src/browser/bridge.js')).href);
  const { resolveProfileSelection, profileRouteParams } = await import(pathToFileURL(path.join(runtime.root, 'dist/src/browser/profile.js')).href);
  const { sendCommand } = await import(pathToFileURL(path.join(runtime.root, 'dist/src/browser/daemon-client.js')).href);
  const explicit = profileFromArgs(profile);
  const routing = profileRouteParams(resolveProfileSelection(explicit));
  const bridge = new BrowserBridge();
  return { connect: async (options) => {
    const page = await bridge.connect({ ...options, ...(options.contextId ? { contextId: options.contextId } : routing) });
    page.downloadMedia = (mediaUrl, sourceUrl, settings) => sendCommand('wait-download', { ...page._cmdOpts(), mediaUrl, sourceUrl, ...settings });
    page.revealTask = target => sendCommand('tabs', { ...page._cmdOpts(), op:'select', page:target, windowMode:'foreground' });
    return page;
  }, close: () => bridge.close() };
}

export async function withBrowser(kind, values, operation, factory = createBridge) {
  const saved = values.task ? await loadTask(values.task) : null;
  const defaults = await preferences();
  const defaultProfile = defaults.reuse_browser_profile === false ? undefined : defaults.browser_profile;
  const options = { out: defaults.output_dir, window: defaults.window, profile: defaultProfile, ...values, ...(saved ? { ...saved.options, resume: true, profile: values.profile || saved.options.profile || defaultProfile, window: values.window || saved.options.window || defaults.window } : {}) };
  const id = saved?.id || randomUUID();
  const session = `luzcrawl-${id}`;
  const taskFile = path.join(options.out, 'raw/tasks', `${id}.json`);
  const policy = await createExecutionPolicy(options);
  let bridge;
  let page;
  let result;
  let retained = false;
  let pendingSaved = false;
  try {
    bridge = await factory(options.profile);
    if (saved || options._luz_visible_fallback) for (const task of await pendingTasks()) if (task.id !== id && task.page) await parkTask(task, factory);
    page = await bridge.connect({ session, contextId: values.profile ? undefined : saved?.context_id, windowMode: options.window, surface: 'browser', timeout: 15 });
    policy.profile = page.contextId || policy.profile;
    await atomicWrite(taskFile, { id, kind: saved?.kind || kind, session, context_id: page.contextId, status: 'running', url: options.url ? sourceURL(options.url) : undefined, at: new Date().toISOString() });
    if (saved?.kind === 'browser') { options.current_page = false; options.url = saved.url; }
    if (saved?.page && saved.context_id === page.contextId) {
      const tabs = await page.tabs();
      if (tabs.some((tab) => tab.page === saved.page)) { page.setActivePage(saved.page); if (saved.kind === 'browser') options.current_page = true; }
    }
    const operations = new BrowserOperations(page, policy, options.url);
    result = await operation(page, options, saved?.kind || kind, operations);
    if (options.download && !result.requires_user && !['login_required', 'verification_required'].includes(result.awaiting_reason || result.stop_reason)) {
      await downloadResult(result, { executionPolicy: policy, profile: page.contextId, page, operations });
    }
    result.execution = operations.summary();
    const contentStatus = result.status;
    const incompleteVisible = options._luz_visible_fallback && ['partial', 'blocked'].includes(result.status) && !['rate_limited', 'operation_budget', 'cancelled'].includes(result.awaiting_reason || result.stop_reason);
    const platformCooldown = result.cooldown_evidence?.source === 'platform_page';
    const reason = incompleteVisible ? 'content_incomplete' : platformCooldown ? 'platform_cooldown' : result.awaiting_reason || result.stop_reason;
    retained = result.requires_user || platformCooldown || ['login_required', 'verification_required'].includes(reason) || Boolean(incompleteVisible);
    const target = page.getActivePage();
    result.browser = { session, page: target, context_id: page.contextId, owned: true, retained, closed: false };
    if (retained) {
      result.status = 'awaiting_user'; result.task_id = id; result.awaiting_reason = reason;
      if (incompleteVisible) { result.content_status = result.content_status || contentStatus; result.requires_user = true; }
      const active = (await pendingTasks()).find((task) => task.id !== id && task.page && !task.parked);
      const headless = process.env.LUZ_HEADLESS_PROFILE === page.contextId;
      if ((active || headless || options.park_on_block) && target) {
        result.browser.closed = await closeOwnedTab(page, target);
        result.browser.retained = false; result.browser.parked = true;
      }
      else if (target && page.revealTask) await page.revealTask(target);
      result.next_action = reason === 'platform_cooldown' ? headless ? `检测到来源页明确显示平台冷却。已保存原页面证据；静默页已关闭，正在同一来源地址交给已连接浏览器展示，不会继续搜索或换路由。` : '来源页明确显示平台冷却；当前页面已展示并保留，已停止该站后续访问。' : headless ? `任务已保存、静默页面已关闭。运行 headless-login ${id} 打开受阻网站，手动完成登录或验证并关闭窗口，再执行 continue ${id}。` : result.browser.parked ? `任务已保存、页面已关闭。执行 continue ${id} 时重新打开供你登录或验证。` : reason === 'content_incomplete' ? `正文仍不完整，当前浏览器页面已保留。检查页面并完成需要的操作后，执行 continue ${id} 更新采集。` : reason === 'verification_required' ? '请在当前保留页面手动完成验证，然后执行 continue。' : '请在当前保留页面手动登录，然后执行 continue。';
      const { executionPolicy, operations: ignoredOperations, ...persistentOptions } = options;
      const task = { id, kind: saved?.kind || kind, options: { ...persistentOptions, task: undefined, park_on_block: undefined, ...(kind === 'browser' || saved?.kind === 'browser' ? { action_cursor: result.next_action_index, plan_sha256: result.plan_sha256, pending_verification: result.pending_verification } : {}) }, session, page: result.browser.parked ? undefined : target, parked: Boolean(result.browser.parked), context_id: page.contextId, url: sourceURL(result.handover_url || options.url || result.search_url), reason, at: new Date().toISOString(), html_file: result.html_file };
      await atomicWrite(pendingFile(id), task);
      pendingSaved = true;
      await atomicWrite(path.join(options.out, 'raw/tasks', `${id}.json`), { ...task, result });
    } else {
      if (target) {
        result.browser.closed = await closeOwnedTab(page, target);
      } else result.browser.closed = true;
      if (saved) await fs.unlink(pendingFile(id));
      await atomicWrite(path.join(options.out, 'raw/tasks', `${id}.json`), { id, kind: saved?.kind || kind, url: options.url ? sourceURL(options.url) : undefined, at: new Date().toISOString(), result });
    }
    return result;
  } catch (error) {
    if (result) {
      result.cleanup_error = error.message;
      result.limitations = [...(result.limitations || []), `浏览器任务收尾未完成：${error.message}`];
      if (['captured', 'completed'].includes(result.status)) result.status = 'partial';
      return result;
    }
    const failure = classifyFailure(error);
    result = { status: 'failed', stop_reason: failure.code, error: failure.message, failure: failure.toJSON(), execution: policy.summary(), browser: { session, page: page?.getActivePage(), context_id: page?.contextId, owned: Boolean(page), retained: false, closed: !page } };
    return result;
  } finally {
    if (retained && !pendingSaved) { retained = false; if (result?.browser) result.browser.retained = false; }
    if (!retained && !result?.browser?.closed && page) {
      const target = page.getActivePage();
      try {
        if (result?.browser) result.browser.closed = await closeOwnedTab(page, target);
      } catch (error) { if (result) result.cleanup_error = error.message; }
    }
    try { await bridge?.close(); } catch (error) {
      if (result) {
        result.cleanup_error = error.message;
        if (['captured', 'completed'].includes(result.status)) result.status = 'partial';
      }
    }
    if (result?.error || result?.cleanup_error) await atomicWrite(taskFile, { id, kind: saved?.kind || kind, url: options.url ? sourceURL(options.url) : undefined, at: new Date().toISOString(), result }).catch((error) => { result.audit_error = error.message; });
    if (result) {
      try {
        result.summary_report = await writeCrawlSummary(options.out);
        if (result.summary_report.html_file) {
          if (result.html_file && result.html_file !== result.summary_report.html_file) result.source_html = result.html_file;
          result.html_file = result.summary_report.html_file;
        }
      }
      catch (error) { result.summary_error = error.message; }
    }
  }
}

export async function closeOwnedTab(page, target) {
  if (!target) return true;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.closeTab(target);
      if (!(await page.tabs()).some(tab => tab.page === target)) return true;
      throw new OperationError('tab_close_unconfirmed', 'Owned tab close was not confirmed.', { retryable: true });
    } catch (error) {
      if (!(await page.tabs()).some(tab => tab.page === target)) return true;
      if (attempt || !classifyFailure(error).retryable) throw error;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }
  return false;
}

export async function parkTask(task, factory = createBridge) {
  if (!task.page) return task;
  const bridge = await factory(task.options?.profile);
  try {
    const page = await bridge.connect({ session: task.session, contextId: task.context_id, windowMode: 'background', surface: 'browser', timeout: 15 });
    if ((await page.tabs()).some((tab) => tab.page === task.page)) await closeOwnedTab(page, task.page);
    const parked = { ...task, page: undefined, parked: true, parked_at: new Date().toISOString() };
    await atomicWrite(pendingFile(task.id), parked);
    await atomicWrite(path.join(task.options.out, 'raw/tasks', `${task.id}-parked.json`), parked);
    return parked;
  } finally { await bridge.close(); }
}

export async function cancelTask(id, factory = createBridge) {
  const task = await loadTask(id);
  if (!task.page) { await fs.unlink(pendingFile(id)); return { task_id: id, status: 'cancelled', browser: { closed: true } }; }
  const bridge = await factory(task.options?.profile);
  try {
    const page = await bridge.connect({ session: task.session, contextId: task.context_id, windowMode: 'foreground', surface: 'browser', timeout: 15 });
    if ((await page.tabs()).some((tab) => tab.page === task.page)) await closeOwnedTab(page, task.page);
    await fs.unlink(pendingFile(id));
    return { task_id: id, status: 'cancelled', browser: { closed: true } };
  } finally { await bridge.close(); }
}
