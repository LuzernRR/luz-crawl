import { createSearchCoordinator, submitGbkSearchInPage } from "./search-job.js";
import { collectVisibleResults } from "./capture-page.js";
import { createExtensionBridge } from "./bridge-client.js";
import { getSearchSource } from "./search-routes.js";

const storage = chrome.storage.local;
let storageQueue = Promise.resolve();

function serializeStorage(operation) {
  const next = storageQueue.then(operation, operation);
  storageQueue = next.catch(() => {});
  return next;
}

async function getStoredRuns() {
  const { runs = [] } = await storage.get({ runs: [] });
  return runs;
}

function tabMatchesRunSource(tab, run) {
  if (!tab?.url || !run?.sourceId) return false;
  try {
    const host = new URL(tab.url).hostname.toLowerCase();
    const domain = getSearchSource(run.sourceId).domain.toLowerCase();
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

async function findReusableSearchTab() {
  for (const run of await getStoredRuns()) {
    if (!Number.isInteger(run.tabId) || ["tab_closed", "superseded"].includes(run.status)) continue;
    try {
      const tab = await chrome.tabs.get(run.tabId);
      if (tabMatchesRunSource(tab, run)) return tab;
    } catch {
      // A user may close a search tab between runs; continue to an older managed tab.
    }
  }
  return null;
}

async function findWaitingUserRun() {
  for (const run of await getStoredRuns()) {
    if (run.status !== "waiting_user" || !Number.isInteger(run.tabId)) continue;
    try {
      await chrome.tabs.get(run.tabId);
      return run;
    } catch {
      // Ignore a stale handoff whose tab was closed.
    }
  }
  return null;
}

async function closeOtherManagedSearchTabs(keepTabId) {
  const latestRunByTab = new Map();
  for (const run of await getStoredRuns()) {
    if (Number.isInteger(run.tabId) && !latestRunByTab.has(run.tabId)) latestRunByTab.set(run.tabId, run);
  }
  for (const [tabId, run] of latestRunByTab) {
    if (tabId === keepTabId || run.status === "waiting_user") continue;
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tabMatchesRunSource(tab, run)) continue;
      await chrome.tabs.remove(tabId);
    } catch {
      // The tab may already be closed.
    }
  }
}

const coordinator = createSearchCoordinator({
  createRunId: () => crypto.randomUUID(),
  hasHostPermission: (origins) => chrome.permissions.contains({ origins }),
  createTab: (url) => chrome.tabs.create({ url, active: true }),
  findReusableTab: findReusableSearchTab,
  findWaitingUserRun,
  closeOtherManagedTabs: closeOtherManagedSearchTabs,
  navigateTab: (tabId, url) => chrome.tabs.update(tabId, { url, active: true }),
  getTab: async (tabId) => {
    try {
      return await chrome.tabs.get(tabId);
    } catch {
      return null;
    }
  },
  saveRun: async (run) => {
    await serializeStorage(async () => {
      const { runs = [] } = await storage.get({ runs: [] });
      const next = [run, ...runs.filter((item) => item.id !== run.id)].slice(0, 100);
      await storage.set({ runs: next, latestRun: run });
    });
  },
  findRunByTab: async (tabId) => {
    const { runs = [] } = await storage.get({ runs: [] });
    return runs.find((run) => run.tabId === tabId) || null;
  },
  submitGbkSearch: async (tabId, request) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: submitGbkSearchInPage,
      args: [request.action, request.field, request.query],
    });
  },
  capturePage: async (tabId, sourceId = "") => {
    const [execution] = await chrome.scripting.executeScript({
      target: { tabId },
      func: collectVisibleResults,
      args: [{ sourceId }],
    });
    return execution?.result || null;
  },
  saveCapture: async (capture) => {
    await serializeStorage(async () => {
      const { captures = [] } = await storage.get({ captures: [] });
      await storage.set({ captures: [capture, ...captures].slice(0, 100) });
    });
  },
  reportRun: (run) => bridge?.reportRun(run),
  reportCapture: (capture) => bridge?.reportCapture(capture),
});

const bridge = createExtensionBridge({
  chromeApi: chrome,
  WebSocketCtor: WebSocket,
  getActiveRuns: async () => {
    const { runs = [] } = await storage.get({ runs: [] });
    return runs.filter((run) => run.bridgeJobId && !["completed", "no_visible_results", "failed", "tab_closed", "manual_search_required", "superseded"].includes(run.status));
  },
  onJob: ({ id, sourceId, query }) => coordinator.start({ sourceId, query, bridgeJobId: id }),
});

export { bridge };

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  void coordinator.onTabUpdated(tabId, changeInfo, tab);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void coordinator.onTabRemoved(tabId);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "luz-crawl/start-search") return false;
  sendResponse({ accepted: true });
  void coordinator.start({ sourceId: message.sourceId, query: message.query }).catch(async (error) => {
    const failure = {
      id: crypto.randomUUID(),
      sourceId: message.sourceId || "unknown",
      query: String(message.query || "").trim(),
      status: "failed",
      stage: "done",
      message: error?.message || "扩展未能启动搜索。",
      requestedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      resultCount: 0,
    };
    const { runs = [] } = await storage.get({ runs: [] });
    await storage.set({ runs: [failure, ...runs].slice(0, 100), latestRun: failure });
  });
  return false;
});

async function resumeWaitingUserRuns() {
  const { runs = [] } = await storage.get({ runs: [] });
  for (const run of runs) {
    if (run.status !== "waiting_user" || !Number.isInteger(run.tabId)) continue;
    try {
      const tab = await chrome.tabs.get(run.tabId);
      if (tab.status === "complete") await coordinator.onTabUpdated(tab.id, { status: "complete" }, tab);
    } catch {
      // The user may have closed a paused tab while the extension was reloading.
    }
  }
}

void resumeWaitingUserRuns().catch((error) => {
  console.warn("Luz Crawl could not resume a manual login or verification handoff:", error);
});
