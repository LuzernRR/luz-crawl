import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const dir = await mkdtemp(path.join(os.tmpdir(), 'luz-mcp-live-'));
process.env.LUZ_CRAWL_STATE = path.join(dir, 'state');
process.env.LUZ_OUTPUT_ROOT = path.join(dir, 'out');
process.env.LUZ_MCP_HEADLESS = '1';
const { CrawlRuntime, stateRoot, outputRoot } = await import('../runtime.mjs');
const { Jobs } = await import('../jobs.mjs');
const { createHttpService } = await import('../server.mjs');
const token = 'test-token-only-for-local-browser-smoke-test';
const runtime = new CrawlRuntime();
const jobs = new Jobs({ runtime, stateRoot, outputRoot, verificationUrl: 'http://127.0.0.1/verify/' });
const app = createHttpService({ runtime, jobs, token, publicBase: 'http://127.0.0.1' });
const fixture = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (req.url === '/authorize') {
    res.writeHead(302, { 'Set-Cookie': 'demo_access=1; HttpOnly; SameSite=Lax', Location: '/gated' });
    return res.end();
  }
  if (req.url === '/gated' && !req.headers.cookie?.includes('demo_access=1')) {
    return res.end('<!doctype html><html><head><title>请登录</title></head><body><h1>请先登录后查看</h1><a id="manual-complete" href="/authorize">完成测试登录</a></body></html>');
  }
  res.end('<!doctype html><html><head><title>测试文章</title></head><body><main><article><h1>测试文章</h1><p>' + '这是一段用于验证浏览器采集与 MCP 调用的测试正文。'.repeat(50) + '</p></article></main></body></html>');
});
let client;
try {
  await jobs.init();
  app.listen(0, '127.0.0.1');
  fixture.listen(0, '127.0.0.1');
  await Promise.all([once(app, 'listening'), once(fixture, 'listening')]);
  client = new Client({ name: 'live-smoke', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('http://127.0.0.1:' + app.address().port + '/mcp'), { requestInit: { headers: { Authorization: 'Bearer ' + token } } });
  await client.connect(transport);
  const health = await client.callTool({ name: 'luz_health', arguments: {} });
  assert.equal(health.structuredContent.ready, false);
  const started = await client.callTool({ name: 'luz_capture', arguments: { url: 'http://127.0.0.1:' + fixture.address().port + '/article' } });
  assert.ok(started.structuredContent?.id, JSON.stringify(started));
  let result;
  for (let i = 0; i < 120; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    result = await client.callTool({ name: 'luz_status', arguments: { job_id: started.structuredContent.id } });
    if (!['queued', 'running'].includes(result.structuredContent.state)) break;
  }
  assert.equal(result.structuredContent.state, 'captured', JSON.stringify(result.structuredContent));
  assert.equal((await runtime.status()).ready, false, '普通任务完成后浏览器应已关闭');
  const files = await client.callTool({ name: 'luz_files', arguments: { job_id: started.structuredContent.id } });
  assert.ok(files.structuredContent.files.length > 0);
  const gated = await client.callTool({ name: 'luz_capture', arguments: { url: 'http://127.0.0.1:' + fixture.address().port + '/gated' } });
  let gatedStatus;
  for (let i = 0; i < 120; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    gatedStatus = await client.callTool({ name: 'luz_status', arguments: { job_id: gated.structuredContent.id } });
    if (!['queued', 'running'].includes(gatedStatus.structuredContent.state)) break;
  }
  assert.equal(gatedStatus.structuredContent.state, 'awaiting_user', JSON.stringify(gatedStatus.structuredContent));
  assert.equal((await runtime.status()).ready, true, '人工验证期间应保留浏览器');
  assert.ok(gatedStatus.structuredContent.result.task_id);
  const page = runtime.context.pages().find(item => item.url().includes('/gated'));
  assert.ok(page, '人工验证页面应保留在原浏览器中');
  await page.locator('#manual-complete').click();
  await page.waitForURL('**/gated');
  await client.callTool({ name: 'luz_continue', arguments: { job_id: gated.structuredContent.id } });
  for (let i = 0; i < 120; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    gatedStatus = await client.callTool({ name: 'luz_status', arguments: { job_id: gated.structuredContent.id } });
    if (!['queued', 'running'].includes(gatedStatus.structuredContent.state)) break;
  }
  assert.equal(gatedStatus.structuredContent.state, 'captured', JSON.stringify(gatedStatus.structuredContent));
  console.log(JSON.stringify({ health: health.structuredContent, capture: result.structuredContent.state, file_count: files.structuredContent.files.length, manual_resume: gatedStatus.structuredContent.state }));
} finally {
  await client?.close().catch(() => {});
  app.closeAllConnections();
  fixture.closeAllConnections();
  app.close();
  fixture.close();
  await runtime.close();
}
