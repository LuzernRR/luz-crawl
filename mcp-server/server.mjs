import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CrawlRuntime, stateRoot, outputRoot } from './runtime.mjs';
import { Jobs } from './jobs.mjs';

const text = value => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value });
const failure = error => ({ isError: true, content: [{ type: 'text', text: error.message }] });
const safely = fn => async args => {
  try { return text(await fn(args)); } catch (error) { return failure(error); }
};

export function buildMcp(runtime, jobs) {
  const mcp = new McpServer({ name: 'luz-crawl', version: '0.1.0' });
  const url = z.string().max(2048).url().refine(value => {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password;
  }, '必须是没有内嵌凭据的 HTTP(S) 地址。');
  const jobId = z.string().uuid().describe('由启动工具返回的 MCP 任务 ID');
  mcp.registerTool('luz_health', {
    description: '检查采集浏览器、扩展和人工验证入口是否可用。'
  }, safely(() => runtime.status()));
  mcp.registerTool('luz_capture', {
    description: '启动网页采集任务，立即返回任务 ID；用 luz_status 查询，遇登录验证时返回人工操作入口。',
    inputSchema: { url, comments: z.boolean().default(false), download: z.boolean().default(false) }
  }, safely(input => jobs.start('capture', input)));
  mcp.registerTool('luz_search', {
    description: '启动指定平台或域名的真实浏览器搜索；结果通过 luz_status 查询。',
    inputSchema: {
      platform: z.string().min(1).max(100),
      query: z.string().min(1).max(2000),
      read: z.number().int().min(0).max(20).default(0),
      comments: z.boolean().default(false),
      download: z.boolean().default(false)
    }
  }, safely(input => jobs.start('search', input)));
  mcp.registerTool('luz_collect', {
    description: '启动主题或网址的合集采集。调用后以 luz_status 查询结果。',
    inputSchema: {
      input: z.string().min(1).max(2000),
      platform: z.string().max(200).optional(),
      read: z.number().int().min(1).max(20).default(1)
    }
  }, safely(input => jobs.start('collect', input)));
  mcp.registerTool('luz_status', {
    description: '查询任务状态。awaiting_user 表示需要用户打开 verification_url 手动登录或验证。',
    inputSchema: { job_id: jobId }
  }, safely(async ({ job_id }) => {
    const job = await jobs.get(job_id);
    if (job.state === 'awaiting_user' && !(await runtime.status()).verification_available) {
      delete job.verification_url;
      job.instruction = '任务需要人工验证，但远程浏览器画面当前不可用；请检查服务状态。';
    }
    return job;
  }));
  mcp.registerTool('luz_continue', {
    description: '用户在验证页面完成操作后继续原任务；不会自动处理验证码或绕过限流。',
    inputSchema: { job_id: jobId }
  }, safely(({ job_id }) => jobs.resume(job_id)));
  mcp.registerTool('luz_cancel', {
    description: '取消等待人工验证或已中断的任务，释放浏览器给后续任务，保留已保存的证据。',
    inputSchema: { job_id: jobId }
  }, safely(({ job_id }) => jobs.cancel(job_id)));
  mcp.registerTool('luz_files', {
    description: '列出任务输出文件及其相对于输出卷的路径。',
    inputSchema: { job_id: jobId }
  }, safely(({ job_id }) => jobs.listFiles(job_id)));
  mcp.registerTool('luz_read', {
    description: '读取输出目录内不超过 1 MiB 的文本、HTML、JSON 或 CSV 文件。',
    inputSchema: { path: z.string().min(1).max(4096) }
  }, safely(({ path: relativePath }) => jobs.readText(relativePath)));
  return mcp;
}

function equalsSecret(left, right) {
  const a = Buffer.from(left || '');
  const b = Buffer.from(right || '');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createHttpService({ runtime, jobs, token, publicBase, vncPort = 5900, noVncDir = '/usr/share/novnc' }) {
  if (typeof token !== 'string' || token.length < 32) throw new Error('LUZ_MCP_TOKEN 至少需要 32 个字符。');
  const publicUrl = new URL(publicBase);
  if (!['http:', 'https:'].includes(publicUrl.protocol) || publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash || publicUrl.username || publicUrl.password) {
    throw new Error('LUZ_PUBLIC_BASE_URL 必须是 HTTP(S) 根地址。');
  }
  const sessions = new Map();
  const failedLogins = new Map();
  const sessionLimit = 64;
  const failedLoginLimit = 256;
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    // no-referrer makes HTML form POST origins null, unlike the following WebSocket.
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Content-Security-Policy': "frame-ancestors 'none'" });
    if (req.headers.origin && req.headers.origin !== publicUrl.origin) return res.status(403).json({ error: 'invalid_origin' });
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '4kb' }));

  function sessionFor(req) {
    const cookie = (req.headers.cookie || '').split(';').map(item => item.trim()).find(item => item.startsWith('luz_verify='));
    const id = cookie?.slice('luz_verify='.length);
    const session = id && sessions.get(id);
    if (!session || session.expires <= Date.now()) {
      if (id) sessions.delete(id);
      return null;
    }
    return session;
  }

  app.get('/verify/login', (req, res) => {
    res.set('Cache-Control', 'no-store').type('html').send('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LuzCrawl 人工验证</title><style>body{font:16px system-ui;background:#f4f6f9;color:#18202c;margin:0;display:grid;place-items:center;min-height:100vh}main{background:white;padding:32px;border-radius:14px;width:min(380px,80vw);box-shadow:0 8px 28px #18202c18}input,button{box-sizing:border-box;width:100%;padding:12px;margin-top:12px;font:inherit}button{background:#2e5b95;color:white;border:0;border-radius:6px;cursor:pointer}p{line-height:1.6;color:#526171}</style><main><h1>打开验证浏览器</h1><p>输入此 MCP 服务的访问密钥，然后在浏览器画面中完成网站登录或验证。</p><form method="post"><input type="password" name="token" autocomplete="off" required aria-label="MCP 访问密钥"><button type="submit">打开浏览器</button></form></main></html>');
  });
  app.post('/verify/login', (req, res) => {
    const now = Date.now();
    for (const [id, session] of sessions) if (session.expires <= now) sessions.delete(id);
    for (const [address, record] of failedLogins) if (record.until <= now) failedLogins.delete(address);
    const key = req.socket.remoteAddress || '';
    const prior = failedLogins.get(key);
    if (prior && prior.until > Date.now() && prior.count >= 8) return res.status(429).send('尝试次数过多，请稍后重试。');
    if (typeof req.body?.token !== 'string' || !equalsSecret(req.body.token, token)) {
      const record = prior && prior.until > Date.now() ? prior : { count: 0, until: Date.now() + 60_000 };
      record.count++;
      if (!failedLogins.has(key) && failedLogins.size >= failedLoginLimit) failedLogins.delete(failedLogins.keys().next().value);
      failedLogins.set(key, record);
      return res.status(401).send('访问密钥不正确。');
    }
    failedLogins.delete(key);
    if (sessions.size >= sessionLimit) sessions.delete(sessions.keys().next().value);
    const session = randomBytes(32).toString('hex');
    sessions.set(session, { expires: now + 30 * 60_000 });
    const secure = publicUrl.protocol === 'https:' ? '; Secure' : '';
    res.setHeader('Set-Cookie', 'luz_verify=' + session + '; Path=/verify; HttpOnly; SameSite=Strict; Max-Age=1800' + secure);
    res.redirect(303, '/verify/');
  });
  app.use('/verify', (req, res, next) => {
    if (!sessionFor(req)) return res.redirect(303, '/verify/login');
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.get('/verify/', (req, res) => res.redirect('/verify/vnc.html?autoconnect=1&resize=scale&path=verify%2Fws'));
  app.use('/verify', express.static(noVncDir, { index: false, fallthrough: false }));

  app.get('/healthz', (req, res) => {
    res.set('Cache-Control', 'no-store').json({ ready: true });
  });

  app.use('/mcp', (req, res, next) => {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ') || !equalsSecret(auth.slice(7), token)) return res.status(401).json({ error: 'unauthorized' });
    next();
  });
  app.post('/mcp', async (req, res) => {
    const mcp = buildMcp(runtime, jobs);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void transport.close(); void mcp.close(); });
    try {
      await mcp.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'MCP request failed' }, id: null });
    }
  });
  app.all('/mcp', (req, res) => res.status(405).end());

  const server = createServer(app);
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
  let activeViewer;
  server.on('upgrade', (req, socket, head) => {
    const session = sessionFor(req);
    if (new URL(req.url, publicBase).pathname !== '/verify/ws' || req.headers.origin !== publicUrl.origin || !session) {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(req, socket, head, ws => {
      if (activeViewer) activeViewer.close(1000, 'another viewer connected');
      activeViewer = ws;
      const tcp = createConnection({ host: '127.0.0.1', port: vncPort });
      const deadline = setTimeout(() => ws.close(1000, 'session expired'), Math.max(0, session.expires - Date.now()));
      ws.on('message', (data, binary) => {
        if (!binary || tcp.writableLength > 16 * 1024 * 1024) return ws.close(1008, 'invalid input');
        tcp.write(data);
      });
      tcp.on('data', data => {
        if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 16 * 1024 * 1024) return tcp.destroy();
        ws.send(data, { binary: true });
      });
      tcp.on('error', () => ws.close(1011, 'browser display unavailable'));
      tcp.on('close', () => ws.close());
      ws.on('error', () => tcp.destroy());
      ws.on('close', () => {
        clearTimeout(deadline);
        tcp.destroy();
        if (activeViewer === ws) activeViewer = null;
      });
    });
  });
  return server;
}

async function main() {
  const token = process.env.LUZ_MCP_TOKEN;
  const publicBase = process.env.LUZ_PUBLIC_BASE_URL || 'http://127.0.0.1:8765';
  if (!token || token.length < 32) throw new Error('请设置至少 32 个字符的 LUZ_MCP_TOKEN。');
  const runtime = new CrawlRuntime();
  const jobs = new Jobs({ runtime, stateRoot, outputRoot, verificationUrl: new URL('/verify/', publicBase).href });
  await jobs.init();
  let server;
  try { server = createHttpService({ runtime, jobs, token, publicBase }); }
  catch (error) { await runtime.close(); throw error; }
  const port = Number(process.env.LUZ_MCP_PORT || 8765);
  const host = process.env.LUZ_MCP_HOST || '127.0.0.1';
  server.listen(port, host, () => console.error('LuzCrawl MCP listening on ' + host + ':' + port));
  const shutdown = () => {
    server.close();
    server.closeAllConnections();
    setTimeout(() => process.exit(1), 8000).unref();
    void runtime.close().finally(() => process.exit(0));
  };
  server.on('error', error => { console.error(error.message); shutdown(); });
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
