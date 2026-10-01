import { createServer } from "node:http";
import { mkdirSync, readFileSync, renameSync, watch as watchFiles, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { SEARCH_SOURCES } from "../luz-crawl/search-routes.js";

const HOST = "127.0.0.1";
const TERMINAL = new Set(["completed", "no_visible_results", "failed", "tab_closed", "manual_search_required", "superseded"]);
const ALLOWED_SOURCES = new Set(SEARCH_SOURCES.map((source) => source.id));
const SOURCE_CATALOG = SEARCH_SOURCES.map(({ id, label, category, domain, mode }) => ({
  id,
  label,
  category,
  domain,
  mode,
  automatedSearch: mode !== "manual-homepage",
}));
const MAX_BODY_BYTES = 64 * 1024;
const MAX_JOBS = 100;

function now() {
  return new Date().toISOString();
}

function redactText(value, limit = 240) {
  return String(value ?? "")
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, "[手机号已省略]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[邮箱已省略]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value));
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    for (const key of [...url.searchParams.keys()]) {
      if (/^(xsec_token|access_token|auth|auth_code|signature|session|cookie)$/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.hash = "";
    return url.toString().slice(0, 2048);
  } catch {
    return null;
  }
}

function safeCapture(value) {
  if (!value || typeof value !== "object") return null;
  const links = Array.isArray(value.links) ? value.links.slice(0, 40).flatMap((item) => {
    const url = safeHttpUrl(item?.url);
    return url ? [{ title: redactText(item?.title), url }] : [];
  }) : [];
  return {
    id: redactText(value.id, 80),
    sourceId: redactText(value.sourceId, 40),
    query: redactText(value.query, 200),
    title: redactText(value.title),
    url: safeHttpUrl(value.url),
    capturedAt: redactText(value.capturedAt, 40),
    links,
  };
}

function safeRun(value) {
  if (!value || typeof value !== "object") return null;
  const status = String(value.status ?? "");
  const allowedStatuses = new Set([
    "opening", "searching", "capturing", "waiting_user", "completed",
    "no_visible_results", "manual_search_required", "failed", "tab_closed", "superseded",
  ]);
  if (!allowedStatuses.has(status)) return null;
  return {
    sourceId: redactText(value.sourceId, 40),
    query: redactText(value.query, 200),
    status,
    stage: redactText(value.stage, 40),
    message: redactText(value.message, 500),
    resultCount: Math.max(0, Math.min(40, Number(value.resultCount) || 0)),
    currentUrl: safeHttpUrl(value.currentUrl),
    updatedAt: redactText(value.updatedAt, 40),
  };
}

function readInitialJobs(statePath) {
  try {
    const data = JSON.parse(readFileSync(statePath, "utf8"));
    const entries = Array.isArray(data.jobs) ? data.jobs : [];
    return new Map(entries
      .filter((job) => job && typeof job.id === "string" && ALLOWED_SOURCES.has(job.sourceId))
      .slice(-MAX_JOBS)
      .map((saved) => {
        const job = { ...saved };
        if (!TERMINAL.has(job.status) && job.status !== "waiting_user") {
          job.status = "queued";
          job.message = "桥接服务已恢复，任务重新排队。";
        }
        return [job.id, job];
      }));
  } catch (error) {
    if (error?.code !== "ENOENT") process.stderr.write(`Ignoring unreadable bridge state: ${error.message}\n`);
    return new Map();
  }
}

export function createBridgeServer({
  port = Number(process.env.LUZ_CRAWL_BRIDGE_PORT || 8765),
  extensionId = process.env.LUZ_CRAWL_EXTENSION_ID || "pcacifdgnnmfdlmgehmhleiefienblle",
  statePath = process.env.LUZ_CRAWL_BRIDGE_STATE || join(process.env.LOCALAPPDATA || homedir(), "LuzCrawl", "bridge-jobs.json"),
  autoReload = false,
  watchFactory = watchFiles,
  extensionDir = resolve(dirname(fileURLToPath(import.meta.url)), "../luz-crawl"),
  reloadDebounceMs = 300,
} = {}) {
  if (!/^[a-p]{32}$/.test(extensionId)) throw new Error("LUZ_CRAWL_EXTENSION_ID must be a 32-character Chromium extension ID.");
  let jobs = readInitialJobs(statePath);
  let extension = null;
  let activeJobId = null;
  let writeQueue = Promise.resolve();
  let boundPort = port;
  let reloadPending = false;
  let reloadTimer = null;
  let extensionWatcher = null;
  let lastExtensionChangeAt = null;
  let lastReloadSignalAt = null;
  let extensionConnectionCount = 0;

  function persist() {
    const snapshot = JSON.stringify({ version: 1, updatedAt: now(), jobs: [...jobs.values()].slice(-MAX_JOBS) }, null, 2);
    writeQueue = writeQueue.then(() => {
      mkdirSync(dirname(statePath), { recursive: true });
      const tempPath = `${statePath}.${process.pid}.tmp`;
      writeFileSync(tempPath, snapshot, "utf8");
      renameSync(tempPath, statePath);
    });
    return writeQueue;
  }

  function send(message) {
    if (extension?.readyState !== WebSocket.OPEN) return false;
    extension.send(JSON.stringify(message));
    return true;
  }

  async function updateJob(job, patch) {
    Object.assign(job, patch, { updatedAt: now() });
    await persist();
    return job;
  }

  function dispatchNext() {
    if (extension?.readyState !== WebSocket.OPEN) return;
    const active = activeJobId ? jobs.get(activeJobId) : null;
    if (active && !TERMINAL.has(active.status)) return;
    if (reloadPending) {
      if (!reloadTimer && send({ type: "reload-extension", protocolVersion: 1 })) {
        reloadPending = false;
        lastReloadSignalAt = now();
      }
      return;
    }
    const next = [...jobs.values()].find((job) => job.status === "queued");
    if (!next) {
      activeJobId = null;
      return;
    }
    activeJobId = next.id;
    void updateJob(next, { status: "dispatched", message: "已连接扩展，任务正在派发。" }).then(() => {
      send({ type: "search", job: { id: next.id, sourceId: next.sourceId, query: next.query } });
    });
  }

  function scheduleExtensionReload(_eventType, filename) {
    const changedPath = String(filename ?? "").replace(/\\/g, "/");
    if (changedPath && !/\.(?:js|html|css|json)$/i.test(changedPath)) return;
    reloadPending = true;
    lastExtensionChangeAt = now();
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      dispatchNext();
    }, reloadDebounceMs);
  }

  if (autoReload) {
    try {
      extensionWatcher = watchFactory(extensionDir, { recursive: true }, scheduleExtensionReload);
      extensionWatcher.on?.("error", (error) => {
        process.stderr.write(`Extension auto-reload watcher error: ${error.message}\n`);
      });
    } catch (error) {
      process.stderr.write(`Extension auto-reload watcher unavailable: ${error.message}\n`);
    }
  }

  async function handleExtensionMessage(raw) {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!message || typeof message.type !== "string") return;
    if (message.type === "ready") {
      const activeRuns = Array.isArray(message.activeRuns) ? message.activeRuns : [];
      for (const run of activeRuns) {
        const safe = safeRun(run);
        if (!safe || !run.bridgeJobId || !jobs.has(run.bridgeJobId)) continue;
        await updateJob(jobs.get(run.bridgeJobId), { ...safe, status: safe.status, run: safe });
        if (!TERMINAL.has(safe.status)) activeJobId = run.bridgeJobId;
      }
      send({ type: "ready-ack", protocolVersion: 1, serverTime: now() });
      dispatchNext();
      return;
    }
    if (message.type === "heartbeat") {
      send({ type: "heartbeat-ack", at: now() });
      return;
    }
    const jobId = typeof message.jobId === "string" ? message.jobId : "";
    const job = jobs.get(jobId);
    if (!job) return;

    if (message.type === "job-started") {
      await updateJob(job, { status: "searching", message: "扩展已接收并开始执行。" });
      return;
    }
    if (message.type === "run-update") {
      const run = safeRun(message.run);
      if (!run) return;
      await updateJob(job, {
        ...run,
        status: run.status,
        message: run.message || job.message,
        currentUrl: run.currentUrl || job.currentUrl || null,
        run,
      });
      if (TERMINAL.has(run.status)) {
        activeJobId = null;
        dispatchNext();
      }
      return;
    }
    if (message.type === "capture") {
      const capture = safeCapture(message.capture);
      if (capture) await updateJob(job, { capture });
      return;
    }
    if (message.type === "job-failed") {
      const error = redactText(message.message || "扩展任务启动失败。", 500);
      await updateJob(job, { status: "failed", message: error, run: { status: "failed", message: error } });
      activeJobId = null;
      dispatchNext();
    }
  }

  function sendJson(response, statusCode, value) {
    const body = Buffer.from(JSON.stringify(value));
    response.writeHead(statusCode, {
      "content-type": "application/json; charset=utf-8",
      "content-length": body.length,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    response.end(body);
  }

  async function readJson(request) {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of request) {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) throw Object.assign(new Error("请求体超过 64 KiB。"), { statusCode: 413 });
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw Object.assign(new Error("请求体必须是有效 JSON。"), { statusCode: 400 });
    }
  }

  const httpServer = createServer(async (request, response) => {
    const requestOrigin = request.headers.origin;
    if (requestOrigin && requestOrigin !== `chrome-extension://${extensionId}`) {
      sendJson(response, 403, { error: "origin_not_allowed" });
      return;
    }
    if (request.headers.host !== `127.0.0.1:${boundPort}`) {
      sendJson(response, 421, { error: "host_not_allowed" });
      return;
    }
    const url = new URL(request.url || "/", `http://${HOST}:${boundPort}`);
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, {
        service: "luz-crawl-extension-bridge",
        protocolVersion: 1,
        extensionConnected: extension?.readyState === WebSocket.OPEN,
        autoReload: {
          watching: Boolean(extensionWatcher),
          pending: reloadPending,
          lastFileChangeAt: lastExtensionChangeAt,
          lastSignalAt: lastReloadSignalAt,
          extensionConnectionCount,
        },
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/sources") {
      sendJson(response, 200, { sources: SOURCE_CATALOG });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/jobs") {
      try {
        const body = await readJson(request);
        const sourceId = String(body?.sourceId || "");
        const query = String(body?.query || "").trim();
        if (!ALLOWED_SOURCES.has(sourceId)) throw Object.assign(new Error("不支持的扩展搜索来源。"), { statusCode: 400 });
        if (!query || query.length > 200 || /[\u0000-\u001f\u007f]/.test(query)) {
          throw Object.assign(new Error("关键词必须为 1 到 200 个字符，且不能含控制字符。"), { statusCode: 400 });
        }
        const job = {
          id: crypto.randomUUID(), sourceId, query, status: "queued",
          message: extension?.readyState === WebSocket.OPEN ? "搜索任务已排队。" : "任务已排队，等待 Luz Crawl 扩展连接。",
          createdAt: now(), updatedAt: now(), resultCount: 0, currentUrl: null, capture: null,
        };
        jobs.set(job.id, job);
        while (jobs.size > MAX_JOBS) {
          const removable = [...jobs.values()].find((item) => TERMINAL.has(item.status));
          if (!removable) break;
          jobs.delete(removable.id);
        }
        await persist();
        dispatchNext();
        sendJson(response, 202, job);
      } catch (error) {
        sendJson(response, error.statusCode || 400, { error: "invalid_job", message: redactText(error.message, 300) });
      }
      return;
    }
    const match = /^\/api\/jobs\/([0-9a-f-]+)$/i.exec(url.pathname);
    if (request.method === "GET" && match) {
      const job = jobs.get(match[1]);
      sendJson(response, job ? 200 : 404, job || { error: "job_not_found" });
      return;
    }
    sendJson(response, 404, { error: "not_found" });
  });

  const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  httpServer.on("upgrade", (request, socket, head) => {
    const originAllowed = request.headers.origin === `chrome-extension://${extensionId}`;
    const hostAllowed = request.headers.host === `127.0.0.1:${boundPort}`;
    if (!originAllowed || !hostAllowed || request.url !== "/extension") {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (client) => webSocketServer.emit("connection", client, request));
  });
  webSocketServer.on("connection", (client) => {
    extensionConnectionCount += 1;
    if (extension && extension !== client && extension.readyState === WebSocket.OPEN) extension.close(4001, "replaced by a newer extension connection");
    extension = client;
    client.on("message", (raw) => { void handleExtensionMessage(raw); });
    client.on("close", () => {
      if (extension === client) extension = null;
    });
    client.on("error", (error) => process.stderr.write(`Extension socket error: ${error.message}\n`));
    send({ type: "hello", protocolVersion: 1 });
  });

  return {
    httpServer,
    webSocketServer,
    jobs,
    async listen() {
      await new Promise((resolve, reject) => {
        const onError = (error) => { httpServer.off("listening", onListening); reject(error); };
        const onListening = () => { httpServer.off("error", onError); resolve(); };
        httpServer.once("error", onError);
        httpServer.once("listening", onListening);
        httpServer.listen(port, HOST);
      });
      boundPort = httpServer.address().port;
      return httpServer.address();
    },
    async close() {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = null;
      extensionWatcher?.close();
      for (const client of webSocketServer.clients) client.close();
      await new Promise((resolve) => webSocketServer.close(() => resolve()));
      if (httpServer.listening) await new Promise((resolve) => httpServer.close(() => resolve()));
      await writeQueue;
    },
  };
}

if (process.argv[1] && import.meta.url.toLowerCase() === pathToFileURL(resolve(process.argv[1])).href.toLowerCase()) {
  const bridge = createBridgeServer({ autoReload: process.env.LUZ_CRAWL_AUTO_RELOAD !== "0" });
  bridge.httpServer.on("error", (error) => {
    process.stderr.write(`Luz Crawl bridge failed: ${error.message}\n`);
    process.exitCode = 1;
  });
  const address = await bridge.listen();
  process.stdout.write(`Luz Crawl bridge listening on http://${HOST}:${address.port}\n`);
  const shutdown = async () => { await bridge.close(); process.exit(0); };
  process.on("SIGINT", () => { void shutdown(); });
  process.on("SIGTERM", () => { void shutdown(); });
}
