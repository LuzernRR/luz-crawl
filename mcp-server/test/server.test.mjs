import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as tcpServer } from 'node:net';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import WebSocket from 'ws';
import { createHttpService } from '../server.mjs';

test('MCP 鉴权、工具发现和人工验证 WebSocket', async t => {
  const token = 'test-token-which-is-long-enough-for-the-test';
  const vnc = tcpServer(socket => socket.on('data', chunk => socket.write(chunk)));
  vnc.listen(0, '127.0.0.1');
  await once(vnc, 'listening');
  const runtime = { status: async () => ({ ready: false, verification_available: false }) };
  const jobs = {
    async start(kind, input) { return { id: '11111111-1111-4111-8111-111111111111', kind, input, state: 'queued' }; },
    get(id) { return { id, state: 'awaiting_user', verification_url: 'http://127.0.0.1/verify/' }; },
    async resume(id) { return { id, state: 'queued' }; },
    async cancel(id) { return { id, state: 'cancelled' }; },
    async listFiles() { return { files: [] }; },
    async readText() { return { text: 'ok' }; }
  };
  const server = createHttpService({ runtime, jobs, token, publicBase: 'http://127.0.0.1', vncPort: vnc.address().port });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); vnc.close(); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const health = await fetch(base + '/healthz');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ready: true });
  assert.equal((await fetch(base + '/verify/')).url, base + '/verify/login');
  assert.equal((await fetch(base + '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  assert.equal((await fetch(base + '/mcp', { method: 'POST', headers: { Authorization: 'Bearer ' + token, Origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  const client = new Client({ name: 'test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(base + '/mcp'), { requestInit: { headers: { Authorization: 'Bearer ' + token } } });
  await client.connect(transport);
  t.after(() => client.close());
  const listing = await client.listTools();
  assert.ok(listing.tools.some(tool => tool.name === 'luz_capture'));
  const result = await client.callTool({ name: 'luz_capture', arguments: { url: 'https://example.com/' } });
  assert.equal(result.structuredContent.kind, 'capture');
  const cancelled = await client.callTool({ name: 'luz_cancel', arguments: { job_id: result.structuredContent.id } });
  assert.equal(cancelled.structuredContent.state, 'cancelled');
  const invalid = await client.callTool({ name: 'luz_capture', arguments: { url: 'file:///etc/passwd' } });
  assert.equal(invalid.isError, true);
  const login = await fetch(base + '/verify/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }), redirect: 'manual' });
  assert.equal(login.status, 303);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const rejectedWs = new WebSocket('ws://127.0.0.1:' + server.address().port + '/verify/ws', { headers: { Cookie: cookie, Origin: 'https://untrusted.example' } });
  await once(rejectedWs, 'error');
  const ws = new WebSocket('ws://127.0.0.1:' + server.address().port + '/verify/ws', { headers: { Cookie: cookie, Origin: 'http://127.0.0.1' } });
  await once(ws, 'open');
  ws.send(Buffer.from('ping'), { binary: true });
  const [data] = await once(ws, 'message');
  assert.equal(data.toString(), 'ping');
  ws.close();
  await once(ws, 'close');
  for (let attempt = 0; attempt < 8; attempt++) {
    const badLogin = await fetch(base + '/verify/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'token=bad', redirect: 'manual' });
    assert.equal(badLogin.status, 401);
  }
  const throttled = await fetch(base + '/verify/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'token=bad', redirect: 'manual' });
  assert.equal(throttled.status, 429);
});

test('人工验证会话有容量上限，最旧会话被逐出', async t => {
  const token = 'session-cap-test-token-long-enough-for-testing';
  const vnc = tcpServer();
  vnc.listen(0, '127.0.0.1');
  await once(vnc, 'listening');
  const runtime = { status: async () => ({ ready: false, verification_available: false }) };
  const jobs = {};
  const server = createHttpService({ runtime, jobs, token, publicBase: 'http://127.0.0.1', vncPort: vnc.address().port });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); vnc.close(); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const cookies = [];
  for (let i = 0; i < 65; i++) {
    const response = await fetch(base + '/verify/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
      redirect: 'manual'
    });
    assert.equal(response.status, 303);
    cookies.push(response.headers.get('set-cookie').split(';')[0]);
  }
  const evicted = await fetch(base + '/verify/', { headers: { Cookie: cookies[0] }, redirect: 'manual' });
  const current = await fetch(base + '/verify/', { headers: { Cookie: cookies.at(-1) }, redirect: 'manual' });
  assert.equal(evicted.status, 303);
  assert.equal(evicted.headers.get('location'), '/verify/login');
  assert.equal(current.status, 302);
  assert.match(current.headers.get('location'), /vnc\.html/);
});
