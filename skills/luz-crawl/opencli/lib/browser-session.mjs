import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolveOpenCLI, profileFromArgs } from './doctor.mjs';
import { atomicWrite } from './archive.mjs';
import { preferences, pendingFile, loadTask, pendingTasks } from './memory.mjs';
import { sourceURL } from './platforms.mjs';

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
  const bridge = await factory(options.profile);
  let page;
  let result;
  let retained = false;
  try {
    if (saved) for (const task of await pendingTasks()) if (task.id !== saved.id && task.page) await parkTask(task, factory);
    page = await bridge.connect({ session, contextId: saved?.context_id, windowMode: options.window, surface: 'browser', timeout: 15 });
    await atomicWrite(taskFile, { id, kind: saved?.kind || kind, session, context_id: page.contextId, status: 'running', url: options.url ? sourceURL(options.url) : undefined, at: new Date().toISOString() });
    if (saved?.page) {
      const tabs = await page.tabs();
      if (tabs.some((tab) => tab.page === saved.page)) page.setActivePage(saved.page);
    }
    result = await operation(page, options, saved?.kind || kind);
    const reason = result.awaiting_reason || result.stop_reason;
    retained = result.requires_user || ['login_required', 'verification_required'].includes(reason);
    const target = page.getActivePage();
    result.browser = { session, page: target, context_id: page.contextId, owned: true, retained, closed: false };
    if (retained) {
      result.status = 'awaiting_user'; result.task_id = id; result.awaiting_reason = reason;
      const active = (await pendingTasks()).find((task) => task.id !== id && task.page && !task.parked);
      if (active && target) {
        await page.closeTab(target);
        result.browser.closed = !(await page.tabs()).some((tab) => tab.page === target);
        if (!result.browser.closed) throw new Error('Queued login page could not be closed.');
        result.browser.retained = false; result.browser.parked = true;
      }
      result.next_action = result.browser.parked ? `任务已保存、页面已关闭。执行 continue ${id} 时重新打开供你登录或验证。` : reason === 'verification_required' ? '请在当前保留页面手动完成验证，然后执行 continue。' : '请在当前保留页面手动登录，然后执行 continue。';
      const task = { id, kind: saved?.kind || kind, options: { ...options, task: undefined }, session, page: result.browser.parked ? undefined : target, parked: Boolean(result.browser.parked), context_id: page.contextId, url: sourceURL(result.handover_url || options.url || result.search_url), reason, at: new Date().toISOString(), html_file: result.html_file };
      await atomicWrite(pendingFile(id), task);
      await atomicWrite(path.join(options.out, 'raw/tasks', `${id}.json`), { ...task, result });
    } else {
      if (target) {
        await page.closeTab(target);
        result.browser.closed = !(await page.tabs()).some((tab) => tab.page === target);
        if (!result.browser.closed) throw new Error('Owned tab remained open after close.');
      } else result.browser.closed = true;
      if (saved) await fs.unlink(pendingFile(id));
      await atomicWrite(path.join(options.out, 'raw/tasks', `${id}.json`), { id, kind: saved?.kind || kind, at: new Date().toISOString(), result });
    }
    return result;
  } catch (error) {
    if (result) {
      result.cleanup_error = error.message;
      result.limitations = [...(result.limitations || []), `浏览器任务收尾未完成：${error.message}`];
      if (result.status === 'captured') result.status = 'partial';
      return result;
    }
    result = { status: 'failed', stop_reason: 'browser_operation_error', error: error.message, browser: { session, page: page?.getActivePage(), context_id: page?.contextId, owned: Boolean(page), retained: false, closed: !page } };
    return result;
  } finally {
    if (!retained && !result?.browser?.closed && page) {
      const target = page.getActivePage();
      try {
        await page.closeTab(target);
        const tabs = await page.tabs();
        if (result?.browser) result.browser.closed = target ? !tabs.some((tab) => tab.page === target) : tabs.length === 0;
      } catch (error) { if (result) result.cleanup_error = error.message; }
    }
    await bridge.close();
    if (result?.error || result?.cleanup_error) await atomicWrite(taskFile, { id, kind: saved?.kind || kind, at: new Date().toISOString(), result }).catch((error) => { result.audit_error = error.message; });
  }
}

export async function parkTask(task, factory = createBridge) {
  if (!task.page) return task;
  const bridge = await factory(task.options?.profile);
  try {
    const page = await bridge.connect({ session: task.session, contextId: task.context_id, windowMode: 'background', surface: 'browser', timeout: 15 });
    if ((await page.tabs()).some((tab) => tab.page === task.page)) await page.closeTab(task.page);
    if ((await page.tabs()).some((tab) => tab.page === task.page)) throw new Error('Pending task page remained open.');
    const parked = { ...task, page: undefined, parked: true, parked_at: new Date().toISOString() };
    await atomicWrite(pendingFile(task.id), parked);
    await atomicWrite(path.join(task.options.out, 'raw/tasks', `${task.id}-parked.json`), parked);
    return parked;
  } finally { await bridge.close(); }
}

export async function cancelTask(id, factory = createBridge) {
  const task = await loadTask(id);
  if (!task.page) { await fs.unlink(pendingFile(id)); return { task_id: id, status: 'cancelled', browser: { closed: true } }; }
  const bridge = await factory();
  try {
    const page = await bridge.connect({ session: task.session, contextId: task.context_id, windowMode: 'foreground', surface: 'browser', timeout: 15 });
    if ((await page.tabs()).some((tab) => tab.page === task.page)) await page.closeTab(task.page);
    if ((await page.tabs()).some((tab) => tab.page === task.page)) throw new Error('Task tab could not be closed.');
    await fs.unlink(pendingFile(id));
    return { task_id: id, status: 'cancelled', browser: { closed: true } };
  } finally { await bridge.close(); }
}
