import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { mkdir, readFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(process.env.LUZ_PROJECT_ROOT || fileURLToPath(new URL('..', import.meta.url)));
export const stateRoot = path.resolve(process.env.LUZ_CRAWL_STATE || path.join(os.homedir(), '.luz-crawl-mcp', 'state'));
export const outputRoot = path.resolve(process.env.LUZ_OUTPUT_ROOT || path.join(os.homedir(), '.luz-crawl-mcp', 'outputs'));
process.env.LUZ_CRAWL_STATE = stateRoot;
process.env.LUZ_NO_BROWSER_LAUNCH = '1';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(stateRoot, 'browsers');
process.env.PLAYWRIGHT_SKIP_BROWSER_GC = '1';

export function runProcess(command, args, { cwd = projectRoot, timeout = 600_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let failure;
    const timer = setTimeout(() => {
      failure = new Error('命令超时，任务已中断，需检查状态后再操作。');
      child.kill();
    }, timeout);
    function append(stream, chunk) {
      if (failure) return;
      const bytes = Buffer.byteLength(chunk);
      if (outputBytes + bytes > 4 * 1024 * 1024) {
        failure = new Error('命令输出超过限制，任务已中断。');
        child.kill();
        return;
      }
      outputBytes += bytes;
      if (stream === 'stdout') stdout += chunk;
      else stderr += chunk;
    }
    child.stdout.setEncoding('utf8').on('data', chunk => append('stdout', chunk));
    child.stderr.setEncoding('utf8').on('data', chunk => append('stderr', chunk));
    child.on('error', error => { failure = error; });
    child.on('close', code => {
      clearTimeout(timer);
      if (failure) return reject(failure);
      let data;
      try { data = JSON.parse(stdout); }
      catch { return reject(new Error('采集进程没有返回有效 JSON。')); }
      if (code !== 0 && !data.status && data.ready !== false) return reject(new Error('采集进程执行失败。'));
      resolve(data);
    });
  });
}

async function daemonStatus() {
  const res = await fetch('http://127.0.0.1:19825/status', {
    headers: { 'X-OpenCLI': '1' },
    signal: AbortSignal.timeout(2500)
  });
  if (!res.ok) throw new Error('OpenCLI 服务不可用。');
  return res.json();
}

async function opencliMain() {
  const root = process.env.LUZ_OPENCLI_ROOT || path.join(os.homedir(), '.opencli', 'node_modules', '@jackwener', 'opencli');
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (pkg.name !== '@jackwener/opencli' || !/^1\.(?:8\.(?:[89]|[1-9]\d+)|[9-9]\.\d+|[1-9]\d+\.\d+)/.test(pkg.version)) {
    throw new Error('需要兼容的 OpenCLI 1.8.8 至 1.x。');
  }
  return path.join(root, typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.opencli);
}

async function ensureDaemon() {
  try { return await daemonStatus(); } catch {}
  const main = await opencliMain();
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [main, 'daemon', 'restart'], { env: process.env, stdio: 'ignore', windowsHide: true });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error('OpenCLI 服务启动失败。')));
  });
  return daemonStatus();
}

async function displayAvailable() {
  return new Promise(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port: 5900 });
    const finish = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(500);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}

export class CrawlRuntime {
  constructor() {
    this.context = null;
    this.profile = null;
    this.starting = null;
    this.headless = process.env.LUZ_MCP_HEADLESS === '1';
  }

  async start() {
    if (this.context && this.profile) return;
    if (this.starting) return this.starting;
    this.starting = this.startBrowser();
    try { await this.starting; }
    finally { this.starting = null; }
  }

  async startBrowser() {
    const { chromium } = await import('playwright');
    await mkdir(stateRoot, { recursive: true, mode: 0o700 });
    await mkdir(outputRoot, { recursive: true, mode: 0o700 });
    await ensureDaemon();
    const extension = path.join(projectRoot, 'browser-extension');
    const browserOptions = {
      headless: this.headless,
      chromiumSandbox: true,
      acceptDownloads: true,
      viewport: { width: 1220, height: 720 },
      args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension]
    };
    if (process.env.LUZ_MCP_BROWSER_PATH) browserOptions.executablePath = process.env.LUZ_MCP_BROWSER_PATH;
    else browserOptions.channel = 'chromium';
    const context = await chromium.launchPersistentContext(path.join(stateRoot, 'browser-profile'), browserOptions);
    this.context = context;
    context.on('close', () => {
      if (this.context === context) { this.context = null; this.profile = null; }
    });
    try {
      const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 20_000 });
      const until = Date.now() + 20_000;
      while (Date.now() < until) {
        const id = await worker.evaluate(async () => (await chrome.storage.local.get('opencli_context_id_v1')).opencli_context_id_v1);
        const status = await daemonStatus().catch(() => null);
        if (typeof id === 'string' && status?.profiles?.some(p => p.contextId === id && p.extensionConnected)) {
          this.profile = id;
          const diagnosis = await runProcess(process.execPath, [path.join(projectRoot, 'scripts', 'luz-crawl.mjs'), 'doctor', '--profile', id]);
          const native = diagnosis.native_plugin?.path && await realpath(diagnosis.native_plugin.path);
          const expected = await realpath(path.join(projectRoot, 'opencli'));
          if (!diagnosis.ready || !native || native.toLowerCase() !== expected.toLowerCase()) {
            throw new Error('OpenCLI 插件未连接到本服务的 LuzCrawl 目录。');
          }
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      throw new Error('浏览器扩展未连接 OpenCLI。');
    } catch (error) {
      await context.close().catch(() => {});
      if (this.context === context) { this.context = null; this.profile = null; }
      throw error;
    }
  }

  async status() {
    const daemon = await daemonStatus().catch(() => null);
    const connected = !!this.profile && !!daemon?.profiles?.some(p => p.contextId === this.profile && p.extensionConnected);
    return { ready: connected, browser: this.headless ? 'headless' : 'visible', verification_available: connected && !this.headless && await displayAvailable() };
  }

  async run(args) {
    if (!this.profile || !(await this.status()).ready) throw new Error('浏览器或扩展尚未连接。');
    return runProcess(process.execPath, [path.join(projectRoot, 'scripts', 'luz-crawl.mjs'), ...args]);
  }

  async close() {
    if (this.starting) await this.starting.catch(() => {});
    const context = this.context;
    this.context = null;
    this.profile = null;
    if (context) await context.close().catch(() => {});
  }
}
