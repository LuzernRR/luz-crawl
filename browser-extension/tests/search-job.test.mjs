import test from "node:test";
import assert from "node:assert/strict";
import { createSearchCoordinator, matchesSearchUrl } from "../luz-crawl/search-job.js";
import { buildSearchRequest, SEARCH_SOURCES } from "../luz-crawl/search-routes.js";

function createFakeBrowser({ permission = true, captures = [] } = {}) {
  const runs = new Map();
  const tabs = new Map();
  const savedCaptures = [];
  const calls = [];
  let id = 0;

  return {
    runs,
    tabs,
    savedCaptures,
    calls,
    createRunId: () => `run-${++id}`,
    hasHostPermission: async () => permission,
    createTab: async (url) => {
      const tab = { id: ++id, url, status: "loading" };
      tabs.set(tab.id, tab);
      calls.push(["createTab", url]);
      return tab;
    },
    getTab: async (tabId) => tabs.get(tabId) || null,
    saveRun: async (run) => runs.set(run.id, { ...run }),
    findRunByTab: async (tabId) => [...runs.values()].reverse().find((run) => run.tabId === tabId) || null,
    findReusableTab: async () => {
      const run = [...runs.values()].reverse().find((item) => Number.isInteger(item.tabId) && tabs.has(item.tabId));
      return run ? tabs.get(run.tabId) : null;
    },
    findWaitingUserRun: async () => [...runs.values()].reverse().find((run) => run.status === "waiting_user") || null,
    closeOtherManagedTabs: async (keepTabId) => {
      calls.push(["closeOtherManagedTabs", keepTabId]);
      for (const tabId of [...tabs.keys()]) if (tabId !== keepTabId) tabs.delete(tabId);
    },
    navigateTab: async (tabId, url) => {
      const tab = tabs.get(tabId);
      if (!tab) throw new Error("Tab not found");
      tab.url = url;
      tab.status = "loading";
      calls.push(["navigateTab", tabId, url]);
      return tab;
    },
    submitGbkSearch: async (tabId, request) => {
      calls.push(["submitGbkSearch", tabId, request]);
      const tab = tabs.get(tabId);
      tab.url = `${new URL(request.action).origin}${new URL(request.action).pathname}?keywords=%C9%EE%DB%DA%BC%D2%BE%DF%B9%A4%B3%A7`;
      tab.status = "loading";
    },
    capturePage: async (tabId) => {
      calls.push(["capturePage", tabId]);
      return captures.shift() || { title: "结果页", url: tabs.get(tabId).url, links: [] };
    },
    saveCapture: async (capture) => savedCaptures.unshift(capture),
  };
}

test("Manifest V3 grants only the loopback bridge and optional per-site access", async () => {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const { dirname, resolve } = await import("node:path");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "luz-crawl");
  const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.service_worker, "background.js");
  assert.deepEqual(manifest.optional_host_permissions, [
    "https://github.com/*",
    "https://www.xiaohongshu.com/*",
    "https://x.com/*",
    "https://www.zhihu.com/*",
    "https://weixin.sogou.com/*",
    "https://www.1688.com/*",
    "https://s.1688.com/*",
    "https://www.qcc.com/*",
    "https://www.gsxt.gov.cn/*",
  ]);
  assert.deepEqual(manifest.host_permissions, ["http://127.0.0.1:8765/*"]);
  assert.equal(manifest.optional_host_permissions.includes("<all_urls>"), false);
});

test("1688 workflow submits the exact Chinese query through a GBK form and captures automatically", async () => {
  const browser = createFakeBrowser({ captures: [
    { title: "1688 首页", url: "https://www.1688.com/", links: [] },
    {
    title: "深圳家具工厂结果",
    url: "https://s.1688.com/company/pc/factory_search.htm?keywords=%C9%EE%DB%DA%BC%D2%BE%DF%B9%A4%B3%A7",
    capturedAt: "2026-09-30T00:00:00.000Z",
    links: [{ title: "深圳家具工厂供应商", url: "https://shop.example.1688.com/" }],
    },
  ] });
  const coordinator = createSearchCoordinator(browser);
  const run = await coordinator.start({ sourceId: "1688", query: "深圳家具工厂" });
  const tab = browser.tabs.get(run.tabId);
  tab.status = "complete";

  await coordinator.onTabUpdated(tab.id, { status: "complete" }, tab);
  const formCall = browser.calls.find(([name]) => name === "submitGbkSearch");
  assert.ok(formCall);
  assert.equal(formCall[2].query, "深圳家具工厂");
  assert.equal(formCall[2].charset, "GBK");

  tab.status = "complete";
  await coordinator.onTabUpdated(tab.id, { status: "complete" }, tab);
  assert.equal(browser.runs.get(run.id).status, "completed");
  assert.equal(browser.runs.get(run.id).resultCount, 1);
  assert.equal(browser.savedCaptures[0].links[0].title, "深圳家具工厂供应商");
});

test("direct search automatically captures after the result tab completes", async () => {
  const browser = createFakeBrowser({ captures: [{
    title: "GitHub repositories",
    url: "https://github.com/search?q=luz-crawl&type=repositories",
    links: [{ title: "Luz Crawl project", url: "https://github.com/example/luz-crawl" }],
  }] });
  const coordinator = createSearchCoordinator(browser);
  const run = await coordinator.start({ sourceId: "github", query: "luz-crawl" });
  const tab = browser.tabs.get(run.tabId);
  tab.status = "complete";

  await coordinator.onTabUpdated(tab.id, { status: "complete" }, tab);
  assert.equal(browser.runs.get(run.id).status, "completed");
  assert.equal(browser.savedCaptures[0].query, "luz-crawl");
});

test("later searches reuse the extension tab and close older extension-owned search tabs", async () => {
  const browser = createFakeBrowser({ captures: [
    { title: "GitHub repositories", url: "https://github.com/search?q=luz-crawl", links: [{ title: "Project", url: "https://github.com/example/project" }] },
    { title: "Zhihu search", url: "https://www.zhihu.com/search?type=content&q=extension", links: [{ title: "Question", url: "https://www.zhihu.com/question/123" }] },
  ] });
  const coordinator = createSearchCoordinator(browser);
  const first = await coordinator.start({ sourceId: "github", query: "luz-crawl" });
  const firstTab = browser.tabs.get(first.tabId);
  firstTab.status = "complete";
  await coordinator.onTabUpdated(firstTab.id, { status: "complete" }, firstTab);
  assert.equal(browser.runs.get(first.id).status, "completed");

  browser.tabs.set(900, { id: 900, url: "https://www.1688.com/", status: "complete" });
  const priorRuns = [...browser.runs.entries()];
  browser.runs.clear();
  browser.runs.set("legacy", { id: "legacy", sourceId: "1688", query: "旧搜索", status: "completed", tabId: 900 });
  for (const [runId, run] of priorRuns) browser.runs.set(runId, run);

  const second = await coordinator.start({ sourceId: "zhihu", query: "extension" });
  assert.equal(second.tabId, first.tabId);
  assert.equal(browser.tabs.size, 1);
  assert.ok(browser.calls.some(([name, tabId]) => name === "navigateTab" && tabId === first.tabId));
  assert.ok(browser.calls.some(([name, tabId]) => name === "closeOtherManagedTabs" && tabId === first.tabId));
  assert.equal(browser.calls.filter(([name]) => name === "createTab").length, 1);

  const secondTab = browser.tabs.get(second.tabId);
  secondTab.status = "complete";
  await coordinator.onTabUpdated(secondTab.id, { status: "complete" }, secondTab);
  assert.equal(browser.runs.get(second.id).status, "completed");
  assert.equal(browser.savedCaptures[0].query, "extension");
});

test("concurrent starts serialize, reuse one tab, and finish the replaced run", async () => {
  const browser = createFakeBrowser();
  const coordinator = createSearchCoordinator(browser);

  const [first, second] = await Promise.all([
    coordinator.start({ sourceId: "github", query: "first search" }),
    coordinator.start({ sourceId: "zhihu", query: "second search" }),
  ]);

  assert.equal(browser.tabs.size, 1);
  assert.equal(first.tabId, second.tabId);
  assert.equal(browser.calls.filter(([name]) => name === "createTab").length, 1);
  assert.equal(browser.calls.filter(([name]) => name === "navigateTab").length, 1);
  assert.equal(browser.runs.get(first.id).status, "superseded");
  assert.equal(browser.runs.get(second.id).status, "opening");
});

test("permission denial prevents opening any page", async () => {
  const browser = createFakeBrowser({ permission: false });
  const coordinator = createSearchCoordinator(browser);
  await assert.rejects(coordinator.start({ sourceId: "github", query: "luz-crawl" }), /权限/);
  assert.equal(browser.tabs.size, 0);
});

test("a new search does not replace a tab paused for login or verification", async () => {
  const browser = createFakeBrowser();
  browser.runs.set("needs-user", {
    id: "needs-user", sourceId: "1688", query: "深圳家具工厂", status: "waiting_user", tabId: 99,
  });
  const coordinator = createSearchCoordinator(browser);

  await assert.rejects(
    coordinator.start({ sourceId: "github", query: "luz-crawl" }),
    /等待登录或安全验证/,
  );
  assert.equal(browser.tabs.size, 0);
});

test("verification pages remain resumable and are not reported as successful captures", async () => {
  const url = "https://github.com/search?q=luz-crawl&type=repositories";
  const browser = createFakeBrowser({ captures: [
    { title: "Security check", url, links: [], blockReason: "页面要求完成安全验证" },
    { title: "GitHub repositories", url, links: [{ title: "Luz Crawl", url: "https://github.com/example/luz-crawl" }] },
  ] });
  const coordinator = createSearchCoordinator(browser);
  const run = await coordinator.start({ sourceId: "github", query: "luz-crawl" });
  const tab = browser.tabs.get(run.tabId);
  tab.status = "complete";

  await coordinator.onTabUpdated(tab.id, { status: "complete" }, tab);
  assert.equal(browser.runs.get(run.id).status, "waiting_user");
  assert.equal(browser.savedCaptures.length, 0);

  await coordinator.onTabUpdated(tab.id, { status: "complete" }, tab);
  assert.equal(browser.runs.get(run.id).status, "completed");
  assert.equal(browser.savedCaptures.length, 1);
});

test("after the user completes login on the source site, the same tab retries the original search", async () => {
  const query = "深圳家具工厂";
  const request = buildSearchRequest("x", query);
  const loginUrl = "https://x.com/i/jf/onboarding/web?mode=login";
  const homeUrl = "https://x.com/home";
  const browser = createFakeBrowser({ captures: [
    { title: "Sign in to X", url: loginUrl, links: [], blockReason: "页面要求登录" },
    { title: "X Home", url: homeUrl, links: [] },
  ] });
  const coordinator = createSearchCoordinator(browser);
  const run = await coordinator.start({ sourceId: "x", query });
  const tab = browser.tabs.get(run.tabId);

  tab.url = loginUrl;
  tab.status = "complete";
  await coordinator.onTabUpdated(tab.id, { status: "complete" }, tab);
  assert.equal(browser.runs.get(run.id).status, "waiting_user");

  tab.url = homeUrl;
  await coordinator.onTabUpdated(tab.id, { status: "complete" }, tab);
  assert.equal(tab.url, request.url);
  assert.equal(browser.runs.get(run.id).status, "searching");
  assert.equal(browser.runs.get(run.id).stage, "waiting_results");
  assert.ok(browser.calls.some(([name, tabId, url]) => name === "navigateTab" && tabId === tab.id && url === request.url));
});

test("search URL matching requires the exact query for URL-routed sources", () => {
  const source = SEARCH_SOURCES.find((item) => item.id === "github");
  const request = buildSearchRequest("github", "luz crawl");
  assert.equal(matchesSearchUrl(source, request, request.url), true);
  assert.equal(matchesSearchUrl(source, request, "https://github.com/search?q=other"), false);
  assert.equal(matchesSearchUrl(source, request, "https://example.com/search?q=luz+crawl"), false);
});
