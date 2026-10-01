import test from "node:test";
import assert from "node:assert/strict";
import { createExtensionBridge } from "../luz-crawl/bridge-client.js";

function createEvent() {
  const listeners = [];
  return {
    addListener(listener) { listeners.push(listener); },
    emit(...args) { for (const listener of listeners) listener(...args); },
  };
}

test("extension connects at startup, accepts backend jobs, reports state, and reconnects", async () => {
  const state = {};
  const sockets = [];
  const alarmEvents = createEvent();
  const installedEvents = createEvent();
  const startupEvents = createEvent();
  const timers = [];
  const handledJobs = [];
  let reloadCount = 0;

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
    }
    addEventListener(name, listener) {
      const handlers = this.handlers.get(name) || [];
      handlers.push(listener);
      this.handlers.set(name, handlers);
    }
    emit(name, event) { for (const handler of this.handlers.get(name) || []) handler(event); }
    send(value) { this.sent.push(JSON.parse(value)); }
    open() { this.readyState = FakeWebSocket.OPEN; this.emit("open", {}); }
    message(value) { this.emit("message", { data: JSON.stringify(value) }); }
    close() { this.readyState = FakeWebSocket.CLOSED; this.emit("close", {}); }
  }

  const chromeApi = {
    alarms: {
      onAlarm: alarmEvents,
      create(name, options) { state.alarm = { name, ...options }; },
      async get() { return null; },
    },
    runtime: {
      id: "a".repeat(32),
      getManifest: () => ({ version: "0.3.2" }),
      reload() { reloadCount += 1; },
      onInstalled: installedEvents,
      onStartup: startupEvents,
    },
    storage: { local: { async set(value) { Object.assign(state, value); } } },
  };
  const bridge = createExtensionBridge({
    chromeApi,
    WebSocketCtor: FakeWebSocket,
    getActiveRuns: async () => [{ bridgeJobId: "job-old", status: "searching" }],
    onJob: async (job) => handledJobs.push(job),
    setIntervalFn: () => "heartbeat",
    clearIntervalFn: () => {},
    setTimeoutFn: (callback, delay) => { const timer = { callback, delay }; timers.push(timer); return timer; },
    clearTimeoutFn: () => {},
  });

  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(sockets.length, 1);
    sockets[0].open();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(state.bridgeStatus.connected, true);
    assert.equal(sockets[0].sent[0].type, "ready");
    assert.equal(sockets[0].sent[0].activeRuns[0].bridgeJobId, "job-old");
    assert.equal(state.alarm.periodInMinutes, 0.5);

    sockets[0].message({ type: "search", job: { id: "job-1", sourceId: "1688", query: "深圳家具工厂" } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(handledJobs, [{ id: "job-1", sourceId: "1688", query: "深圳家具工厂" }]);
    assert.ok(sockets[0].sent.some((message) => message.type === "job-started" && message.jobId === "job-1"));

    bridge.reportRun({ bridgeJobId: "job-1", status: "completed", sourceId: "1688", query: "深圳家具工厂" });
    assert.ok(sockets[0].sent.some((message) => message.type === "run-update" && message.jobId === "job-1"));

    sockets[0].message({ type: "reload-extension", protocolVersion: 1 });
    assert.equal(reloadCount, 1);

    sockets[0].close();
    assert.equal(state.bridgeStatus.connected, false);
    assert.equal(timers.at(-1).delay, 1000);
    timers.at(-1).callback();
    assert.equal(sockets.length, 2);
  } finally {
    bridge.dispose();
  }
});

test("extension still reports ready when it cannot restore old run state", async () => {
  const state = {};
  let socket;

  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    constructor() {
      this.readyState = FakeWebSocket.CONNECTING;
      this.handlers = new Map();
      this.sent = [];
      socket = this;
    }
    addEventListener(name, listener) {
      const handlers = this.handlers.get(name) || [];
      handlers.push(listener);
      this.handlers.set(name, handlers);
    }
    emit(name, event) { for (const handler of this.handlers.get(name) || []) handler(event); }
    send(value) { this.sent.push(JSON.parse(value)); }
    open() { this.readyState = FakeWebSocket.OPEN; this.emit("open", {}); }
    close() { this.readyState = 3; }
  }

  const bridge = createExtensionBridge({
    chromeApi: {
      alarms: {
        onAlarm: createEvent(),
        create() {},
        async get() { return { name: "luz-crawl-bridge-reconnect" }; },
      },
      runtime: {
        id: "b".repeat(32),
      getManifest: () => ({ version: "0.3.2" }),
        onInstalled: createEvent(),
        onStartup: createEvent(),
      },
      storage: { local: { async set(value) { Object.assign(state, value); } } },
    },
    WebSocketCtor: FakeWebSocket,
    getActiveRuns: async () => { throw new Error("storage temporarily unavailable"); },
    onJob: async () => {},
    setIntervalFn: () => "heartbeat",
    clearIntervalFn: () => {},
    setTimeoutFn: () => "reconnect",
    clearTimeoutFn: () => {},
  });

  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    socket.open();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(state.bridgeStatus.connected, true);
    assert.equal(state.bridgeStatus.detail, "本机后端已连接；未能恢复旧任务状态，新任务仍可执行。");
    assert.equal(socket.sent[0].type, "ready");
    assert.deepEqual(socket.sent[0].activeRuns, []);
  } finally {
    bridge.dispose();
  }
});
