import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBridgeServer } from "../bridge/server.mjs";
import WebSocket from "../bridge/node_modules/ws/index.js";

test("local bridge dispatches jobs to the extension and returns captured visible results", async () => {
  const directory = await mkdtemp(join(tmpdir(), "luz-crawl-bridge-"));
  const bridge = createBridgeServer({ port: 0, extensionId: "a".repeat(32), statePath: join(directory, "jobs.json") });
  const address = await bridge.listen();
  const base = `http://127.0.0.1:${address.port}`;
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/extension`, {
    origin: `chrome-extension://${"a".repeat(32)}`,
  });
  try {
    const incoming = new Promise((resolve, reject) => {
      socket.once("error", reject);
      socket.once("message", (message) => resolve(JSON.parse(message.toString())));
    });
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    assert.deepEqual(await incoming, { type: "hello", protocolVersion: 1 });
    socket.send(JSON.stringify({ type: "ready", extensionId: "a".repeat(32), version: "0.3.2", activeRuns: [] }));

    const response = await fetch(`${base}/api/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceId: "1688", query: "深圳家具工厂" }),
    });
    assert.equal(response.status, 202);
    const job = await response.json();
    const dispatched = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("bridge dispatch timed out")), 1000);
      socket.on("message", (message) => {
        const parsed = JSON.parse(message.toString());
        if (parsed.type === "search") {
          clearTimeout(timeout);
          resolve(parsed);
        }
      });
    });
    assert.equal(dispatched.job.id, job.id);
    assert.equal(dispatched.job.query, "深圳家具工厂");

    socket.send(JSON.stringify({ type: "job-started", jobId: job.id }));
    socket.send(JSON.stringify({
      type: "capture",
      jobId: job.id,
      capture: {
        id: "run-1", sourceId: "1688", query: "深圳家具工厂", title: "厂家结果",
        url: "https://s.1688.com/company/pc/factory_search.htm?keywords=x&auth=secret",
        capturedAt: "2026-09-30T00:00:00.000Z",
        links: [
          { title: "深圳家具厂家 13800138000", url: "https://shop.example.1688.com/?session=secret" },
          { title: "外部链接", url: "javascript:alert(1)" },
        ],
      },
    }));
    socket.send(JSON.stringify({
      type: "run-update", jobId: job.id,
      run: { sourceId: "1688", query: "深圳家具工厂", status: "completed", stage: "done", message: "完成", resultCount: 1, currentUrl: "https://s.1688.com/company/pc/factory_search.htm?keywords=x", updatedAt: "2026-09-30T00:00:00.000Z" },
    }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    const result = await (await fetch(`${base}/api/jobs/${job.id}`)).json();
    assert.equal(result.status, "completed");
    assert.equal(result.capture.links.length, 1);
    assert.equal(result.capture.links[0].title, "深圳家具厂家 [手机号已省略]");
    assert.doesNotMatch(result.capture.links[0].url, /session=/);
    assert.equal(result.capture.url.includes("auth="), false);

    const supersededDispatch = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("superseded-job dispatch timed out")), 1000);
      socket.on("message", (message) => {
        const parsed = JSON.parse(message.toString());
        if (parsed.type === "search" && parsed.job.query === "replacement search") {
          clearTimeout(timeout);
          resolve(parsed);
        }
      });
    });
    const nextResponse = await fetch(`${base}/api/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceId: "github", query: "replacement search" }),
    });
    const nextJob = await nextResponse.json();
    assert.equal(nextResponse.status, 202);
    assert.equal((await supersededDispatch).job.id, nextJob.id);
    socket.send(JSON.stringify({ type: "run-update", jobId: nextJob.id, run: {
      sourceId: "github", query: "replacement search", status: "superseded", stage: "done",
      message: "搜索标签页已复用，原搜索已停止。", resultCount: 0,
    } }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    const superseded = await (await fetch(`${base}/api/jobs/${nextJob.id}`)).json();
    assert.equal(superseded.status, "superseded");
  } finally {
    socket.close();
    await bridge.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("bridge shares the extension source catalog and rejects untrusted origins, unknown sites, and malformed queries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "luz-crawl-bridge-"));
  const bridge = createBridgeServer({ port: 0, extensionId: "b".repeat(32), statePath: join(directory, "jobs.json") });
  const address = await bridge.listen();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const sourceResponse = await fetch(`${base}/api/sources`);
    assert.equal(sourceResponse.status, 200);
    const catalog = await sourceResponse.json();
    assert.ok(catalog.sources.some((source) => source.id === "qichacha" && source.category === "企业信息" && !source.automatedSearch));
    assert.ok(catalog.sources.some((source) => source.id === "gsxt" && source.category === "政府公示" && !source.automatedSearch));
    const qccJobResponse = await fetch(`${base}/api/jobs`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceId: "qichacha", query: "深圳家具企业" }),
    });
    assert.equal(qccJobResponse.status, 202);
    assert.equal((await qccJobResponse.json()).sourceId, "qichacha");

    const badOrigin = await fetch(`${base}/api/jobs`, {
      method: "POST", headers: { origin: "https://example.com", "content-type": "application/json" },
      body: JSON.stringify({ sourceId: "1688", query: "家具" }),
    });
    assert.equal(badOrigin.status, 403);

    const badSource = await fetch(`${base}/api/jobs`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceId: "not-registered", query: "家具" }),
    });
    assert.equal(badSource.status, 400);

    const badQuery = await fetch(`${base}/api/jobs`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceId: "1688", query: "\u0000" }),
    });
    assert.equal(badQuery.status, 400);
  } finally {
    await bridge.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("queued jobs survive a local bridge restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "luz-crawl-bridge-"));
  const statePath = join(directory, "jobs.json");
  const extensionId = "c".repeat(32);
  const first = createBridgeServer({ port: 0, extensionId, statePath });
  const firstAddress = await first.listen();
  let job;
  try {
    const response = await fetch(`http://127.0.0.1:${firstAddress.port}/api/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceId: "github", query: "manifest v3 extension bridge" }),
    });
    job = await response.json();
    assert.equal(job.status, "queued");
  } finally {
    await first.close();
  }

  const second = createBridgeServer({ port: 0, extensionId, statePath });
  const secondAddress = await second.listen();
  try {
    const restored = await (await fetch(`http://127.0.0.1:${secondAddress.port}/api/jobs/${job.id}`)).json();
    assert.equal(restored.query, "manifest v3 extension bridge");
    assert.equal(restored.status, "queued");
  } finally {
    await second.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("file changes reload an idle extension and wait for an active search to finish", async () => {
  const directory = await mkdtemp(join(tmpdir(), "luz-crawl-auto-reload-"));
  let onFileChange;
  const bridge = createBridgeServer({
    port: 0,
    extensionId: "d".repeat(32),
    statePath: join(directory, "jobs.json"),
    autoReload: true,
    reloadDebounceMs: 10,
    watchFactory: (_path, _options, listener) => {
      onFileChange = listener;
      return { close() {} };
    },
  });
  const address = await bridge.listen();
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/extension`, {
    origin: `chrome-extension://${"d".repeat(32)}`,
  });
  const received = [];
  socket.on("message", (message) => received.push(JSON.parse(message.toString())));
  const waitFor = async (predicate, message) => {
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(message);
  };
  try {
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    await waitFor(() => received.some((item) => item.type === "hello"), "bridge hello timed out");
    const initialHealth = await (await fetch(`http://127.0.0.1:${address.port}/health`)).json();
    assert.equal(initialHealth.autoReload.watching, true);
    assert.equal(initialHealth.autoReload.extensionConnectionCount, 1);
    socket.send(JSON.stringify({ type: "ready", extensionId: "d".repeat(32), activeRuns: [] }));
    await waitFor(() => received.some((item) => item.type === "ready-ack"), "bridge ready ack timed out");

    const response = await fetch(`http://127.0.0.1:${address.port}/api/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceId: "github", query: "reload test" }),
    });
    const job = await response.json();
    await waitFor(() => received.some((item) => item.type === "search" && item.job.id === job.id), "search dispatch timed out");
    socket.send(JSON.stringify({ type: "job-started", jobId: job.id }));

    onFileChange("change", "popup.js");
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(received.some((item) => item.type === "reload-extension"), false);

    socket.send(JSON.stringify({
      type: "run-update",
      jobId: job.id,
      run: {
        sourceId: "github", query: "reload test", status: "completed", stage: "done",
        message: "done", resultCount: 0, currentUrl: "https://github.com/search?q=reload+test",
      },
    }));
    await waitFor(() => received.some((item) => item.type === "reload-extension"), "idle extension reload signal timed out");
    assert.deepEqual(received.find((item) => item.type === "reload-extension"), {
      type: "reload-extension", protocolVersion: 1,
    });
    const reloadHealth = await (await fetch(`http://127.0.0.1:${address.port}/health`)).json();
    assert.equal(reloadHealth.autoReload.pending, false);
    assert.ok(reloadHealth.autoReload.lastFileChangeAt);
    assert.ok(reloadHealth.autoReload.lastSignalAt);
  } finally {
    socket.close();
    await bridge.close();
    await rm(directory, { recursive: true, force: true });
  }
});
