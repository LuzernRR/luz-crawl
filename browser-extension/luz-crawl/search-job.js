import { buildSearchRequest, getSearchSource } from "./search-routes.js";

const TERMINAL_STATES = new Set(["completed", "no_visible_results", "failed", "tab_closed", "manual_search_required", "superseded"]);

function hostMatches(url, domain) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const expected = domain.toLowerCase();
    return host === expected || host.endsWith(`.${expected}`);
  } catch {
    return false;
  }
}

function matchesSearchUrl(source, request, url) {
  try {
    const parsed = new URL(url);
    if (!hostMatches(url, source.domain)) return false;
    if (request.type === "form") {
      const expected = new URL(request.action);
      return parsed.pathname === expected.pathname && parsed.searchParams.has(request.field);
    }

    const expected = new URL(request.url);
    const searchKey = ["q", "query", "keyword"].find((key) => expected.searchParams.has(key));
    return Boolean(searchKey && parsed.searchParams.get(searchKey) === expected.searchParams.get(searchKey));
  } catch {
    return false;
  }
}

export function submitGbkSearchInPage(action, field, query) {
  const form = document.createElement("form");
  form.method = "get";
  form.action = action;
  form.acceptCharset = "GBK";
  form.target = "_self";

  const input = document.createElement("input");
  input.type = "hidden";
  input.name = field;
  input.value = query;
  form.append(input);
  document.body.append(form);
  setTimeout(() => form.submit(), 0);
  return true;
}

export function createSearchCoordinator(browser) {
  const inFlight = new Map();
  let startQueue = Promise.resolve();

  async function save(run, patch = {}) {
    Object.assign(run, patch, { updatedAt: new Date().toISOString() });
    await browser.saveRun(run);
    await browser.reportRun?.(run);
    return run;
  }

  async function waitForManualAction(run, message, tab) {
    const resumeStage = run.stage === "waiting_user"
      ? run.resumeStage
      : run.stage === "capturing"
        ? "waiting_results"
        : run.stage;
    await save(run, {
      status: "waiting_user",
      stage: "waiting_user",
      resumeStage,
      message,
      currentUrl: tab?.url || run.currentUrl || null,
    });
  }

  async function capture(run, tab) {
    await save(run, { status: "capturing", stage: "capturing", currentUrl: tab.url });
    const result = await browser.capturePage(tab.id, run.sourceId);
    if (result?.blockReason) {
      await waitForManualAction(
        run,
        `${result.blockReason}；请在当前标签页手动完成后，扩展会继续检查。`,
        tab,
      );
      return;
    }

    const links = Array.isArray(result?.links) ? result.links : [];
    if (!links.length) {
      await save(run, {
        status: "no_visible_results",
        stage: "done",
        message: "页面已打开，但没有找到可见结果链接。",
        resultCount: 0,
        currentUrl: result?.url || tab.url,
      });
      return;
    }

    const capturedAt = result.capturedAt || new Date().toISOString();
    const record = {
      id: run.id,
      bridgeJobId: run.bridgeJobId || null,
      sourceId: run.sourceId,
      query: run.query,
      title: result.title || "",
      url: result.url || tab.url,
      capturedAt,
      links: links.slice(0, 40),
    };
    await browser.saveCapture(record);
    await browser.reportCapture?.(record);
    await save(run, {
      status: "completed",
      stage: "done",
      message: `扩展已自动采集 ${record.links.length} 条当前页可见结果链接。`,
      resultCount: record.links.length,
      currentUrl: record.url,
      capturedAt,
    });
  }

  async function processCompleteTab(run, tab) {
    const source = getSearchSource(run.sourceId);
    const request = buildSearchRequest(run.sourceId, run.query);

    if (run.stage === "waiting_entry" || run.stage === "submitting_form") {
      if (!hostMatches(tab.url, source.domain)) {
        await waitForManualAction(run, "搜索入口跳转到了其他站点；请检查当前标签页。", tab);
        return;
      }
      if (matchesSearchUrl(source, request, tab.url)) {
        await capture(run, tab);
        return;
      }
      const entryCheck = await browser.capturePage(tab.id, run.sourceId);
      if (entryCheck?.blockReason) {
        await waitForManualAction(run, `${entryCheck.blockReason}；请手动完成后，扩展会继续搜索。`, tab);
        return;
      }
      await save(run, { status: "searching", stage: "submitting_form", currentUrl: tab.url });
      await browser.submitGbkSearch(tab.id, request);
      await save(run, { status: "searching", stage: "waiting_results" });
      const latest = await browser.getTab(tab.id);
      if (latest?.status === "complete" && matchesSearchUrl(source, request, latest.url)) {
        await capture(run, latest);
      }
      return;
    }

    if (run.stage !== "waiting_results" && run.stage !== "waiting_user" && run.stage !== "capturing") return;

    if (!hostMatches(tab.url, source.domain)) {
      await waitForManualAction(run, "站点跳转到登录或验证页面；请在当前标签页手动处理。", tab);
      return;
    }

    if (run.stage === "waiting_user" && run.resumeStage === "waiting_entry") {
      const entryCheck = await browser.capturePage(tab.id, run.sourceId);
      if (entryCheck?.blockReason) {
        await waitForManualAction(run, `${entryCheck.blockReason}；请手动完成后，扩展会继续搜索。`, tab);
        return;
      }
      await save(run, { status: "searching", stage: "submitting_form", currentUrl: tab.url, resumeStage: null });
      await browser.submitGbkSearch(tab.id, request);
      await save(run, { status: "searching", stage: "waiting_results" });
      const latest = await browser.getTab(tab.id);
      if (latest?.status === "complete" && matchesSearchUrl(source, request, latest.url)) await capture(run, latest);
      return;
    }

    if (!matchesSearchUrl(source, request, tab.url)) {
      if (run.stage === "waiting_results" || run.stage === "capturing") {
        await waitForManualAction(run, "没有到达预期搜索结果页；请在当前标签页检查或完成站内搜索。", tab);
      } else if (run.stage === "waiting_user" && run.resumeStage === "waiting_results" && request.type === "url") {
        await save(run, {
          status: "searching",
          stage: "waiting_results",
          resumeStage: null,
          currentUrl: request.url,
          message: "站点页面已恢复；扩展正在同一标签页重试原搜索关键词。",
        });
        await browser.navigateTab(tab.id, request.url);
      }
      return;
    }

    await capture(run, tab);
  }

  async function onTabUpdated(tabId, changeInfo = {}, tabArg = null) {
    if (changeInfo.status !== "complete") return;
    const existing = inFlight.get(tabId);
    if (existing) return existing;

    const task = (async () => {
      const run = await browser.findRunByTab(tabId);
      if (!run || TERMINAL_STATES.has(run.status)) return;
      const tab = tabArg?.id === tabId ? tabArg : await browser.getTab(tabId);
      if (!tab?.url) return;
      await processCompleteTab(run, tab);
    })();
    inFlight.set(tabId, task);
    try {
      await task;
    } catch (error) {
      const run = await browser.findRunByTab(tabId);
      if (run) await save(run, { status: "failed", stage: "done", message: error?.message || "自动搜索或采集失败。" });
    } finally {
      inFlight.delete(tabId);
    }
  }

  async function startSearch({ sourceId, query, bridgeJobId = null }) {
    const request = buildSearchRequest(sourceId, query);
    const source = getSearchSource(sourceId);
    const pendingUserRun = await browser.findWaitingUserRun?.();
    if (pendingUserRun) {
      throw new Error("当前搜索标签页正在等待登录或安全验证；请先完成该页面操作，再开始新的搜索。为避免覆盖页面，没有启动新标签。");
    }

    const run = {
      id: browser.createRunId(),
      bridgeJobId,
      sourceId,
      source: source.label,
      query: request.query,
      requestedAt: new Date().toISOString(),
      status: request.type === "manual-homepage" ? "manual_search_required" : "opening",
      stage: request.type === "manual-homepage" ? "manual_search_required" : "opening",
      message: request.type === "manual-homepage"
        ? "已打开官方站点；该来源需要先在页面内手动搜索。"
        : "扩展正在启动站内搜索。",
      resultCount: 0,
    };

    const permissionOrigins = Array.isArray(source.permissionOrigin) ? source.permissionOrigin : [source.permissionOrigin];
    if (request.type !== "manual-homepage" && !await browser.hasHostPermission(permissionOrigins)) {
      throw new Error(`尚未获得 ${source.domain} 的页面读取权限，请在扩展弹出的权限提示中允许。`);
    }

    const entryUrl = request.type === "form" ? source.entryUrl : request.url;
    run.stage = request.type === "form" ? "waiting_entry" : request.type === "manual-homepage" ? "manual_search_required" : "waiting_results";
    const reusableTab = await browser.findReusableTab?.();
    let tab = null;

    if (reusableTab?.id && browser.navigateTab) {
      const tabId = reusableTab.id;
      const previousRun = await browser.findRunByTab?.(tabId);
      const navigationGate = Promise.resolve();
      const priorWork = inFlight.get(tabId);
      if (priorWork) await priorWork;
      inFlight.set(tabId, navigationGate);
      try {
        if (previousRun && !TERMINAL_STATES.has(previousRun.status)) {
          await save(previousRun, {
            status: "superseded",
            stage: "done",
            message: "搜索标签页已复用，原搜索已停止。",
          });
        }
        run.tabId = tabId;
        run.currentUrl = entryUrl;
        await browser.saveRun(run);
        tab = await browser.navigateTab(tabId, entryUrl);
        run.currentUrl = tab?.url || entryUrl;
        await browser.saveRun(run);
      } catch {
        inFlight.delete(tabId);
        delete run.tabId;
        run.currentUrl = null;
        await browser.saveRun(run);
      } finally {
        if (inFlight.get(tabId) === navigationGate) inFlight.delete(tabId);
      }
    }

    if (!tab) {
      tab = await browser.createTab(entryUrl);
      run.tabId = tab.id;
      run.currentUrl = tab.url || entryUrl;
      await browser.saveRun(run);
    }

    await browser.closeOtherManagedTabs?.(tab.id);

    if (request.type !== "manual-homepage") {
      const latest = await browser.getTab(tab.id);
      if (latest?.status === "complete") await onTabUpdated(tab.id, { status: "complete" }, latest);
    }
    return run;
  }

  function start(args) {
    const operation = startQueue.then(() => startSearch(args), () => startSearch(args));
    startQueue = operation.catch(() => {});
    return operation;
  }

  async function onTabRemoved(tabId) {
    const run = await browser.findRunByTab(tabId);
    if (!run || TERMINAL_STATES.has(run.status)) return;
    await save(run, { status: "tab_closed", stage: "done", message: "搜索标签页已关闭，采集停止。" });
  }

  return { start, onTabUpdated, onTabRemoved };
}

export { matchesSearchUrl };
