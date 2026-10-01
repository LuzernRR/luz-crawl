export const BRIDGE_URL = "ws://127.0.0.1:8765/extension";
export const BRIDGE_RECONNECT_ALARM = "luz-crawl-bridge-reconnect";

const ACTIVE_STATUSES = new Set(["opening", "searching", "capturing", "waiting_user"]);

export function createExtensionBridge({
  chromeApi,
  WebSocketCtor,
  onJob,
  getActiveRuns,
  onConnectionChange = () => {},
  url = BRIDGE_URL,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}) {
  let socket = null;
  let reconnectTimer = null;
  let heartbeatTimer = null;
  let reconnectAttempt = 0;
  let stopped = false;

  function send(message) {
    if (socket?.readyState !== WebSocketCtor.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }

  function setConnected(connected, detail = "") {
    const value = { connected, detail, updatedAt: new Date().toISOString() };
    void chromeApi.storage.local.set({ bridgeStatus: value }).catch(() => {});
    onConnectionChange(value);
  }

  function connect() {
    if (stopped || socket?.readyState === WebSocketCtor.OPEN || socket?.readyState === WebSocketCtor.CONNECTING) return;
    if (reconnectTimer) {
      clearTimeoutFn(reconnectTimer);
      reconnectTimer = null;
    }
    try {
      socket = new WebSocketCtor(url);
    } catch (error) {
      setConnected(false, error?.message || "无法连接本机桥接服务。");
      scheduleReconnect();
      return;
    }

    socket.addEventListener("open", async () => {
      reconnectAttempt = 0;
      setConnected(true, "本机后端已连接");
      let activeRuns = [];
      try {
        activeRuns = await getActiveRuns();
      } catch {
        // A local storage read should not prevent the extension from receiving new work.
        setConnected(true, "本机后端已连接；未能恢复旧任务状态，新任务仍可执行。");
      }
      send({
        type: "ready",
        extensionId: chromeApi.runtime.id,
        version: chromeApi.runtime.getManifest().version,
        activeRuns: activeRuns.filter((run) => ACTIVE_STATUSES.has(run.status)),
      });
      heartbeatTimer = setIntervalFn(() => send({ type: "heartbeat" }), 20_000);
    });
    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.type === "reload-extension" && message.protocolVersion === 1) {
        chromeApi.runtime.reload();
        return;
      }
      if (message.type !== "search" || !message.job?.id) return;
      void (async () => {
        send({ type: "job-started", jobId: message.job.id });
        try {
          await onJob(message.job);
        } catch (error) {
          send({ type: "job-failed", jobId: message.job.id, message: error?.message || "扩展无法启动该搜索。" });
        }
      })();
    });
    socket.addEventListener("close", () => {
      socket = null;
      if (heartbeatTimer) clearIntervalFn(heartbeatTimer);
      heartbeatTimer = null;
      setConnected(false, "等待本机后端连接");
      scheduleReconnect();
    });
    socket.addEventListener("error", () => {
      try { socket?.close(); } catch { /* close event schedules a retry */ }
    });
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    const delay = Math.min(1_000 * (2 ** reconnectAttempt), 30_000);
    reconnectAttempt += 1;
    reconnectTimer = setTimeoutFn(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function ensureAlarm() {
    chromeApi.alarms.create(BRIDGE_RECONNECT_ALARM, { periodInMinutes: 0.5 });
    connect();
  }

  chromeApi.runtime.onInstalled.addListener(ensureAlarm);
  chromeApi.runtime.onStartup.addListener(ensureAlarm);
  chromeApi.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === BRIDGE_RECONNECT_ALARM) connect();
  });
  void chromeApi.alarms.get(BRIDGE_RECONNECT_ALARM).then((alarm) => {
    if (!alarm) ensureAlarm();
    else connect();
  }).catch(() => connect());

  return {
    connect,
    send,
    reportRun: (run) => run?.bridgeJobId && send({ type: "run-update", jobId: run.bridgeJobId, run }),
    reportCapture: (capture) => capture?.bridgeJobId && send({ type: "capture", jobId: capture.bridgeJobId, capture }),
    dispose() {
      stopped = true;
      if (reconnectTimer) clearTimeoutFn(reconnectTimer);
      if (heartbeatTimer) clearIntervalFn(heartbeatTimer);
      reconnectTimer = null;
      heartbeatTimer = null;
      socket?.close();
      socket = null;
    },
  };
}
