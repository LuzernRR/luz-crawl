// Modified by LuzernRR for LuzCrawl: branding, visible labels and help entry.
// Based on OpenCLI Browser Bridge 1.0.24; Apache-2.0. See LICENSE and NOTICE.
import { getOutputPreferences, setOutputPreferences } from './preferences.js';

const directoryInput = document.getElementById('outputDir');
const settingsStatus = document.getElementById('settingsStatus');
getOutputPreferences().then((saved) => { directoryInput.value = saved.output_dir || ''; }).catch((error) => {
  settingsStatus.textContent = error.message;
  settingsStatus.classList.add('error');
});
document.getElementById('directoryForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = document.getElementById('saveDirectory');
  button.disabled = true;
  try {
    const saved = await setOutputPreferences({ output_dir: directoryInput.value });
    directoryInput.value = saved.output_dir;
    settingsStatus.textContent = '已保存，下一次采集生效；临时 --out 优先。';
    settingsStatus.classList.remove('error');
  } catch (error) {
    settingsStatus.textContent = error.message;
    settingsStatus.classList.add('error');
  } finally { button.disabled = false; }
});
// Query connection status from background service worker
chrome.runtime.sendMessage({ type: 'getStatus' }, (resp) => {
  const card = document.getElementById('card');
  const dot = document.getElementById('dot');
  const status = document.getElementById('status');
  const daemonVersion = document.getElementById('daemonVersion');
  const profileRow = document.getElementById('profileRow');
  const contextId = document.getElementById('contextId');
  const copyBtn = document.getElementById('copyBtn');
  const hint = document.getElementById('hint');
  const extVersion = document.getElementById('extVersion');

  if (resp && typeof resp.extensionVersion === 'string') {
    extVersion.textContent = chrome.runtime.getManifest().version_name || `v${resp.extensionVersion}`;
  }

  if (chrome.runtime.lastError || !resp) {
    setState(card, dot, 'disconnected');
    status.textContent = '等待 LuzCrawl 连接';
    daemonVersion.textContent = '';
    profileRow.style.display = 'none';
    hint.style.display = 'block';
    return;
  }

  if (typeof resp.contextId === 'string' && resp.contextId.length > 0) {
    contextId.textContent = resp.contextId;
    profileRow.style.display = 'flex';
    copyBtn.addEventListener('click', () => copyToClipboard(resp.contextId, copyBtn));
  } else {
    profileRow.style.display = 'none';
  }

  if (resp.connected) {
    setState(card, dot, 'connected');
    status.textContent = 'LuzCrawl 已连接';
    if (typeof resp.daemonVersion === 'string') {
      daemonVersion.textContent = `服务 v${resp.daemonVersion}`;
    }
    hint.style.display = 'none';
  } else if (resp.reconnecting) {
    setState(card, dot, 'connecting');
    status.textContent = '正在重新连接…';
    daemonVersion.textContent = '';
    hint.style.display = 'none';
  } else {
    setState(card, dot, 'disconnected');
    status.textContent = '等待 LuzCrawl 连接';
    daemonVersion.textContent = '';
    hint.style.display = 'block';
  }
});

function setState(card, dot, state) {
  card.classList.remove('connected', 'disconnected', 'connecting');
  card.classList.add(state);
  dot.classList.remove('connected', 'disconnected', 'connecting');
  dot.classList.add(state);
}

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(
    () => {
      const original = btn.textContent;
      btn.textContent = '已复制';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove('copied');
      }, 1200);
    },
    () => {
      btn.textContent = '复制失败';
      setTimeout(() => { btn.textContent = '复制'; }, 1200);
    },
  );
}
