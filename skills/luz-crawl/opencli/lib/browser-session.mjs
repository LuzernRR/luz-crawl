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

async function createBridge(profile) {
  const runtime = await resolveOpenCLI();
  if (!runtime?.compatible) throw new Error('A compatible LuzCrawl runtime is required; run doctor.');
  const { BrowserBridge } = await import(pathToFileURL(path.join(runtime.root, 'dist/src/browser/bridge.js')).href);
  const { resolveProfileSelection, profileRouteParams } = await import(pathToFileURL(path.join(runtime.root, 'dist/src/browser/profile.js')).href);
  const explicit = profileFromArgs(profile);
  const routing = profileRouteParams(resolveProfileSelection(explicit));
  const bridge = new BrowserBridge();
  return { connect: (options) => bridge.connect({ ...options, ...(options.contextId ? { contextId: options.contextId } : routing) }), close: () => bridge.close() };
}

export async function withBrowser(kind, values, operation, factory = createBridge) {
  const saved = values.task ? await loadTask(values.task) : null;
  const defaults = await preferences();
  const options = { out: defaults.output_dir, window: defaults.window, profile: defaults.browser_profile, ...values, ...(saved ? { ...saved.options, resume: true } : {}) };
  const id = saved?.id || randomUUID();
  const session = `luzcrawl-${id}`;
  const taskFile = path.join(options.out, 'raw/tasks', `${id}.json`);
  const policy = await createExecutionPolicy(options);
  const bridge = await factory(options.profile);
  let page;
  let result;
  let retained = false;
  let pendingSaved = false;
  try {
    if (saved) for (const task of await pendingTasks()) if (task.id !== saved.id && task.page) await parkTask(task, factory);
    page = await bridge.connect({ session, contextId: saved?.context_id, windowMode: options.window, surface: 'browser', timeout: 15 });
    policy.profile = page.contextId || policy.profile;
    await atomicWrite(taskFile, { id, kind: saved?.kind || kind, session, context_id: page.contextId, status: 'running', url: options.url ? sourceURL(options.url) : undefined, at: new Date().toISOString() });
    if (saved?.kind === 'browser') { options.current_page = false; options.url = saved.url; }
    if (saved?.page) {
      const tabs = await page.tabs();
      if (tabs.some((tab) => tab.page === saved.page)) { page.setActivePage(saved.page); if (saved.kind === 'browser') options.current_page = true; }
    }
    const operations = new BrowserOperations(page, policy, options.url);
    result = await operation(page, options, saved?.kind || kind, operations);
    result.execution ||= operations.summary();
    const reason = result.awaiting_reason || result.stop_reason;
    retained = result.requires_user || ['login_required', 'verification_required'].includes(reason);
    const target = page.getActivePage();
    result.browser = { session, page: target, context_id: page.contextId, owned: true, retained, closed: false };
    if (retained) {
      result.status = 'awaiting_user'; result.task_id = id; result.awaiting_reason = reason;
      const active = (await pendingTasks()).find((task) => task.id !== id && task.page && !task.parked);
      if (active && target) {
        result.browser.closed = await closeOwnedTab(page, target);
        result.browser.retained = false; result.browser.parked = true;
      }
      result.next_action = result.browser.parked ? `任务已保存、页面已关闭。执行 continue ${id} 时重新打开供你登录或验证。` : reason === 'verification_required' ? '请在当前保留页面手动完成验证，然后执行 continue。' : '请在当前保留页面手动登录，然后执行 continue。';
      const { executionPolicy, operations: ignoredOperations, ...persistentOptions } = options;
      const task = { id, kind: saved?.kind || kind, options: { ...persistentOptions, task: undefined, ...(kind === 'browser' || saved?.kind === 'browser' ? { action_cursor: result.next_action_index, plan_sha256: result.plan_sha256, pending_verification: result.pending_verification } : {}) }, session, page: result.browser.parked ? undefined : target, parked: Boolean(result.browser.parked), context_id: page.contextId, url: sourceURL(result.handover_url || options.url || result.search_url), reason, at: new Date().toISOString(), html_file: result.html_file };
      await atomicWrite(pendingFile(id), task);
      pendingSaved = true;
      await atomicWrite(path.join(options.out, 'raw/tasks', `${id}.json`), { ...task, result });
    } else {
      if (target) {
        result.browser.closed = await closeOwnedTab(page, target);
      } else result.browser.closed = true;
      if (saved) await fs.unlink(pendingFile(id));
      await atomicWrite(path.join(options.out, 'raw/tasks', `${id}.json`), { id, kind: saved?.kind || kind, at: new Date().toISOString(), result });
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
    try { await bridge.close(); } catch (error) { if (result) result.cleanup_error = error.message; }
    if (result?.error || result?.cleanup_error) await atomicWrite(taskFile, { id, kind: saved?.kind || kind, at: new Date().toISOString(), result }).catch((error) => { result.audit_error = error.message; });
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
