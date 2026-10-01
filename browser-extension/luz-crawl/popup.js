import { SEARCH_SOURCES, buildSearchPlan, buildSearchRequest, getPermissionOrigins } from "./search-routes.js";
import { collectVisibleResults } from "./capture-page.js";

const sourceSelect = document.querySelector("#source");
const queryInput = document.querySelector("#query");
const planSource = document.querySelector("#plan-source");
const planQuery = document.querySelector("#plan-query");
const planSteps = document.querySelector("#plan-steps");
const planFallback = document.querySelector("#plan-fallback");
const status = document.querySelector("#status");
const runSummary = document.querySelector("#run-summary");
const captureList = document.querySelector("#captures");
const submitButton = document.querySelector("#search-form button[type='submit']");
const bridgeStatus = document.querySelector("#bridge-status");
const permissionSummary = document.querySelector("#permission-summary");
const permissionDetail = document.querySelector("#permission-detail");
const authorizeAllButton = document.querySelector("#authorize-all");
const allPermissionOrigins = getPermissionOrigins();

const groups = new Map();
for (const source of SEARCH_SOURCES) {
  let group = groups.get(source.category);
  if (!group) {
    group = document.createElement("optgroup");
    group.label = source.category;
    groups.set(source.category, group);
    sourceSelect.append(group);
  }
  const option = document.createElement("option");
  option.value = source.id;
  option.textContent = source.label;
  group.append(option);
}

const setStatus = (message, isError = false) => {
  status.textContent = message;
  status.style.color = isError ? "#b42318" : "#175b35";
};

function renderPlan() {
  const query = queryInput.value.trim();
  const source = SEARCH_SOURCES.find((item) => item.id === sourceSelect.value);
  if (!source) return;
  planSource.textContent = `来源：${source.label}（${source.domain}）`;
  planQuery.textContent = `精确关键词：${query || "（输入后显示）"}`;
  planSteps.replaceChildren();
  if (!query) {
    planSteps.append(document.createElement("li")).textContent = "先输入关键词，再检查搜索计划。";
    planFallback.textContent = "";
    return;
  }
  const plan = buildSearchPlan(source.id, query);
  for (const step of plan.steps) {
    const item = document.createElement("li");
    item.textContent = step;
    planSteps.append(item);
  }
  planFallback.textContent = plan.fallback;
}

function runMessage(run) {
  if (!run) return "";
  const label = {
    opening: "扩展正在打开搜索页。",
    searching: "扩展正在提交搜索并等待页面结果。",
    capturing: "扩展正在采集当前页可见链接。",
    waiting_user: "扩展已暂停；请在搜索标签页完成登录或安全验证，随后会在同一标签页重试原关键词。",
    completed: `自动采集完成：${run.resultCount || 0} 条可见结果链接。`,
    no_visible_results: "搜索页已打开，但没有找到可见结果链接。",
    manual_search_required: "此来源没有可靠的自动搜索入口；请在官网搜索后使用“手动采集当前页”。",
    failed: `未完成：${run.message || "扩展执行失败。"}`,
    tab_closed: "搜索标签页已关闭，采集停止。",
    superseded: "搜索标签页已复用，原搜索已停止。",
  };
  return `${run.source || run.sourceId} · ${run.query || ""}：${label[run.status] || run.message || run.status}`;
}

function renderRun(run) {
  runSummary.textContent = runMessage(run);
  runSummary.style.color = run?.status === "failed" ? "#b42318" : "#475467";
}

async function renderPermissionStatus() {
  const sources = SEARCH_SOURCES.filter((source) => getPermissionOrigins([source]).length > 0);
  const statuses = await Promise.all(sources.map(async (source) => ({
    source,
    granted: await chrome.permissions.contains({ origins: getPermissionOrigins([source]) }),
  })));
  const grantedCount = statuses.filter((item) => item.granted).length;
  permissionSummary.textContent = `已授权 ${grantedCount}/${statuses.length} 个来源`;
  const missing = statuses.filter((item) => !item.granted).map((item) => item.source.label);
  permissionDetail.textContent = missing.length
    ? `待授权：${missing.join("、")}`
    : "所有已登记来源均已授权。新增来源后，在这里一次申请新增权限。";
  authorizeAllButton.textContent = missing.length ? `一键授权剩余 ${missing.length} 个来源` : "所有来源已授权";
  authorizeAllButton.disabled = missing.length === 0;
}

function renderCaptures(captures) {
  captureList.replaceChildren();
  if (!captures.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "暂无本地采集记录。";
    captureList.append(empty);
    return;
  }

  for (const capture of captures.slice(0, 3)) {
    const card = document.createElement("article");
    card.className = "capture-card";
    const heading = document.createElement("strong");
    heading.textContent = capture.title || capture.url;
    const meta = document.createElement("small");
    meta.textContent = `${capture.query ? `关键词：${capture.query} · ` : ""}${capture.links.length} 条可见链接 · ${new Date(capture.capturedAt).toLocaleString()}`;
    const list = document.createElement("ul");
    for (const link of capture.links.slice(0, 5)) {
      const item = document.createElement("li");
      const anchor = document.createElement("a");
      anchor.href = link.url;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.textContent = link.title;
      item.append(anchor);
      list.append(item);
    }
    card.append(heading, meta, list);
    captureList.append(card);
  }
}

async function loadState() {
  const stored = await chrome.storage.local.get({ captures: [], latestRun: null, bridgeStatus: null });
  renderCaptures(stored.captures);
  renderRun(stored.latestRun);
  bridgeStatus.textContent = stored.bridgeStatus?.connected
    ? "本机后端已连接，可由 Luz Crawl 自动派发搜索。"
    : "本机后端未连接；扩展会自动重试连接。";
  bridgeStatus.dataset.connected = String(Boolean(stored.bridgeStatus?.connected));
  await renderPermissionStatus();
}

authorizeAllButton.addEventListener("click", async () => {
  authorizeAllButton.disabled = true;
  permissionDetail.textContent = "正在请求浏览器授权…";
  try {
    // Chromium requires permissions.request() to run directly from a user gesture.
    const request = chrome.permissions.request({ origins: allPermissionOrigins });
    const granted = await request;
    await renderPermissionStatus();
    if (granted) {
      setStatus("站点权限已授权；现在可以从本机后端派发这些来源的搜索。留意浏览器显示的权限范围。");
    } else {
      setStatus("浏览器没有授予全部站点权限；你可以稍后再次点击授权，或在扩展设置中逐项管理。", true);
    }
  } catch (error) {
    await renderPermissionStatus();
    setStatus(error.message || "无法申请站点权限。", true);
  }
});

sourceSelect.addEventListener("change", renderPlan);
queryInput.addEventListener("input", renderPlan);

document.querySelector("#search-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  submitButton.disabled = true;
  try {
    const sourceId = sourceSelect.value;
    const request = buildSearchRequest(sourceId, queryInput.value);
    const source = SEARCH_SOURCES.find((item) => item.id === sourceId);

    // Request the selected origin directly from this user gesture when it was not granted in bulk.
    if (source.permissionOrigin) {
      const origins = getPermissionOrigins([source]);
      const granted = await chrome.permissions.request({ origins });
      if (!granted) throw new Error(`未获得 ${source.domain} 权限，扩展没有读取该站页面。`);
    }

    await chrome.storage.local.set({
      lastSearch: {
        sourceId,
        query: request.query,
        requestedAt: new Date().toISOString(),
      },
    });
    const response = await chrome.runtime.sendMessage({
      type: "luz-crawl/start-search",
      sourceId,
      query: request.query,
    });
    if (!response?.accepted) throw new Error("扩展后台没有接收本次搜索任务。");
    setStatus("扩展已启动；搜索会复用扩展的搜索标签，并自动采集可见结果。");
  } catch (error) {
    setStatus(error.message || "未能启动搜索。", true);
  } finally {
    submitButton.disabled = false;
  }
});

document.querySelector("#capture").addEventListener("click", async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("没有可采集的当前页面。");
    const stored = await chrome.storage.local.get({ captures: [], lastSearch: null });
    const [execution] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectVisibleResults,
      args: [{ sourceId: stored.lastSearch?.sourceId || "" }],
    });
    const result = execution?.result;
    if (!result) throw new Error("当前页面没有返回可见结果。");
    if (result.blockReason) throw new Error(`${result.blockReason}；请手动处理后再试。`);
    if (!result.links?.length) throw new Error("当前页没有可见结果链接。");

    const capture = {
      id: crypto.randomUUID(),
      title: result.title,
      url: result.url,
      capturedAt: result.capturedAt,
      links: result.links,
      query: stored.lastSearch?.query || null,
    };
    const captures = [capture, ...stored.captures].slice(0, 100);
    await chrome.storage.local.set({ captures });
    renderCaptures(captures);
    setStatus(`已保存 ${capture.links.length} 条可见链接到本地。`);
  } catch (error) {
    setStatus(error.message || "采集失败；确认当前页已加载且不是浏览器内部页面。", true);
  }
});

document.querySelector("#clear").addEventListener("click", async () => {
  const confirmed = window.confirm("确定删除 Luz Crawl 扩展本地保存的采集记录吗？此操作无法撤销。");
  if (!confirmed) return;
  await chrome.storage.local.remove(["captures", "lastSearch", "latestRun", "runs"]);
  renderCaptures([]);
  renderRun(null);
  setStatus("本地采集记录已清除。");
});

chrome.storage.onChanged.addListener(() => {
  void loadState().catch((error) => setStatus(error.message || "无法读取扩展状态。", true));
});

chrome.permissions.onAdded.addListener(() => {
  void renderPermissionStatus().catch((error) => setStatus(error.message || "无法读取站点授权状态。", true));
});
chrome.permissions.onRemoved.addListener(() => {
  void renderPermissionStatus().catch((error) => setStatus(error.message || "无法读取站点授权状态。", true));
});

renderPlan();
loadState().catch((error) => setStatus(error.message || "无法读取本地记录。", true));
