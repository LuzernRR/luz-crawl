import test from "node:test";
import assert from "node:assert/strict";

function createEvent() {
  const listeners = [];
  return {
    listeners,
    addListener(listener) { listeners.push(listener); },
    emit(...args) { for (const listener of listeners) listener(...args); },
  };
}

function waitFor(predicate, attempts = 40) {
  return new Promise((resolve, reject) => {
    let count = 0;
    const tick = () => {
      if (predicate()) return resolve();
      if (++count >= attempts) return reject(new Error("timed out waiting for extension state"));
      setTimeout(tick, 2);
    };
    tick();
  });
}

test("MV3 background auto-connects and executes backend search jobs without popup interaction", async () => {
  const oldChrome = globalThis.chrome;
  const oldCrypto = globalThis.crypto;
  const oldWebSocket = globalThis.WebSocket;
  const state = {};
  const tab = { id: 71, url: "https://www.1688.com/", status: "loading" };
  const managedOldTab = { id: 72, url: "https://github.com/search?q=old", status: "complete" };
  const unrelatedUserTab = { id: 99, url: "https://example.com/account", status: "complete" };
  const tabs = new Map([[71, tab], [72, managedOldTab], [99, unrelatedUserTab]]);
  const removedTabIds = [];
  let createCount = 0;
  let updateCount = 0;
  const onUpdated = createEvent();
  const onRemoved = createEvent();
  const onMessage = createEvent();
  const onInstalled = createEvent();
  const onStartup = createEvent();
  const onAlarm = createEvent();
  const sockets = [];
  globalThis.crypto ||= { randomUUID: () => "test-run" };

  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url) {
      this.url = url;
      this.readyState = FakeWebSocket.CONNECTING;
      this.handlers = new Map();
      this.sent = [];
      sockets.push(this);
      setTimeout(() => {
        this.readyState = FakeWebSocket.OPEN;
        this.emit("open", {});
      }, 0);
    }
    addEventListener(name, listener) {
      const handlers = this.handlers.get(name) || [];
      handlers.push(listener);
      this.handlers.set(name, handlers);
    }
    emit(name, event) {
      for (const handler of this.handlers.get(name) || []) handler(event);
    }
    emitMessage(value) { this.emit("message", { data: JSON.stringify(value) }); }
    send(value) { this.sent.push(JSON.parse(value)); }
    close() {
      this.readyState = FakeWebSocket.CLOSED;
      this.emit("close", {});
    }
  }
  globalThis.WebSocket = FakeWebSocket;

  globalThis.chrome = {
    storage: {
      local: {
        async get(defaults = {}) { return { ...defaults, ...state }; },
        async set(values) { Object.assign(state, structuredClone(values)); },
      },
    },
    permissions: { async contains() { return true; } },
    alarms: {
      onAlarm,
      create() {},
      async get() { return null; },
    },
    tabs: {
      onUpdated,
      onRemoved,
      async create({ url }) { createCount += 1; tab.url = url; tab.status = "loading"; return { ...tab }; },
      async update(tabId, { url }) { assert.equal(tabId, tab.id); updateCount += 1; tab.url = url; tab.status = "loading"; return { ...tab }; },
      async remove(tabId) { removedTabIds.push(tabId); tabs.delete(tabId); },
      async get(tabId) {
        const found = tabs.get(tabId);
        if (!found) throw new Error("Tab not found");
        return { ...found };
      },
    },
    scripting: {
      async executeScript({ func, args = [] }) {
        if (func.name === "submitGbkSearchInPage") {
          const [action, field, query] = args;
          assert.equal(action, "https://s.1688.com/company/pc/factory_search.htm");
          assert.equal(field, "keywords");
          assert.equal(query, "深圳家具工厂");
          tab.url = "https://s.1688.com/company/pc/factory_search.htm?keywords=%C9%EE%DB%DA%BC%D2%BE%DF%B9%A4%B3%A7";
          tab.status = "loading";
          return [{ result: true }];
        }
        if (func.name === "collectVisibleResults") {
          return [{ result: {
            title: "深圳家具工厂结果",
            url: tab.url,
            capturedAt: "2026-09-30T00:00:00.000Z",
            links: [{ title: "深圳家具企业", url: "https://shop.example.1688.com/" }],
            blockReason: null,
          } }];
        }
        throw new Error(`Unexpected injected function: ${func.name}`);
      },
    },
    runtime: {
      id: "a".repeat(32),
      getManifest: () => ({ version: "0.3.2" }),
      onMessage,
      onInstalled,
      onStartup,
    },
  };

  let module;
  try {
    module = await import(`../luz-crawl/background.js?runtime-test=${Date.now()}`);
    await waitFor(() => state.bridgeStatus?.connected === true && sockets.length === 1);
    assert.equal(sockets[0].url, "ws://127.0.0.1:8765/extension");
    assert.equal(sockets[0].sent[0].type, "ready");

    sockets[0].emitMessage({
      type: "search",
      job: { id: "backend-job-1", sourceId: "1688", query: "深圳家具工厂" },
    });
    await waitFor(() => state.latestRun?.tabId !== undefined);
    assert.equal(state.latestRun.bridgeJobId, "backend-job-1");
    assert.equal(state.latestRun.stage, "waiting_entry");

    tab.status = "complete";
    onUpdated.emit(tab.id, { status: "complete" }, { ...tab });
    await waitFor(() => state.latestRun?.stage === "waiting_results");
    tab.status = "complete";
    onUpdated.emit(tab.id, { status: "complete" }, { ...tab });
    await waitFor(() => state.latestRun?.status === "completed");

    assert.equal(state.latestRun.resultCount, 1);
    assert.equal(state.captures[0].query, "深圳家具工厂");
    assert.ok(sockets[0].sent.some((message) => message.type === "capture" && message.jobId === "backend-job-1"));
    assert.ok(sockets[0].sent.some((message) => message.type === "run-update" && message.run.status === "completed"));

    sockets[0].emitMessage({
      type: "search",
      job: { id: "backend-job-2", sourceId: "github", query: "luz-crawl" },
    });
    await waitFor(() => state.latestRun?.bridgeJobId === "backend-job-2");
    assert.equal(state.latestRun.tabId, tab.id);
    assert.equal(createCount, 1);
    assert.equal(updateCount, 1);

    tab.status = "complete";
    onUpdated.emit(tab.id, { status: "complete" }, { ...tab });
    await waitFor(() => state.latestRun?.status === "completed");
    assert.equal(state.runs[0].tabId, state.runs[1].tabId);

    state.runs.push({ id: "managed-old", sourceId: "github", status: "completed", tabId: 72 });
    state.runs.push({ id: "unrelated-tab", sourceId: "github", status: "completed", tabId: 99 });
    sockets[0].emitMessage({
      type: "search",
      job: { id: "backend-job-3", sourceId: "x", query: "extension" },
    });
    await waitFor(() => state.latestRun?.bridgeJobId === "backend-job-3");
    assert.equal(state.latestRun.tabId, tab.id);
    assert.ok(removedTabIds.includes(72));
    assert.equal(removedTabIds.includes(99), false);
    assert.ok(tabs.has(99));
  } finally {
    module?.bridge.dispose();
    if (oldChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = oldChrome;
    if (oldCrypto === undefined) delete globalThis.crypto;
    if (oldWebSocket === undefined) delete globalThis.WebSocket;
    else globalThis.WebSocket = oldWebSocket;
  }
});
