import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Jobs } from '../jobs.mjs';

async function waitFor(fn) {
  for (let i = 0; i < 100; i++) {
    const result = await fn();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('task did not finish');
}

test('人工验证保持任务，继续后持久化结果并限制文件范围', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'luz-mcp-jobs-'));
  const out = path.join(root, 'output');
  const folder = path.join(out, 'raw', '001_test');
  const pending = '11111111-1111-4111-8111-111111111111';
  const calls = [];
  let closes = 0;
  const runtime = {
    profile: 'test-profile',
    async start() {},
    async close() { closes++; },
    async run(args) {
      calls.push(args);
      if (args[0] === 'begin') {
        await mkdir(folder, { recursive: true });
        await writeFile(path.join(folder, 'content.json'), '{"text":"ok"}');
        return { status: 'ready', folder };
      }
      if (args[0] === 'capture') return { status: 'awaiting_user', task_id: pending };
      return { status: 'captured', task_id: pending };
    }
  };
  const jobs = new Jobs({ runtime, stateRoot: path.join(root, 'state'), outputRoot: out, verificationUrl: 'http://127.0.0.1:8765/verify/' });
  await jobs.init();
  const started = await jobs.start('capture', { url: 'https://example.com/', comments: false, download: false });
  const waiting = await waitFor(async () => {
    const job = await jobs.get(started.id);
    return job.state === 'awaiting_user' && job;
  });
  assert.equal(waiting.result.task_id, pending);
  assert.equal(waiting.pending_task_id, pending);
  assert.equal(jobs.items, undefined);
  assert.equal(jobs.waiting, started.id);
  assert.equal(closes, 0);
  assert.match(waiting.verification_url, /\/verify\/$/);
  await assert.rejects(jobs.start('capture', { url: 'https://example.com/' }), /等待人工验证/);
  assert.ok(calls[1].includes('foreground'));
  const files = await jobs.listFiles(started.id);
  assert.equal(files.files.length, 1);
  assert.equal(JSON.parse((await jobs.readText(files.files[0].path)).text).text, 'ok');
  await assert.rejects(jobs.readText('../outside.json'), /输出目录/);
  await jobs.resume(started.id);
  await waitFor(async () => (await jobs.get(started.id)).state === 'captured');
  assert.equal(calls[2][0], 'continue');
  assert.equal(calls[2][1], pending);
  assert.equal(closes, 1);
  const restored = new Jobs({ runtime, stateRoot: path.join(root, 'state'), outputRoot: out, verificationUrl: 'http://127.0.0.1:8765/verify/' });
  await restored.init();
  assert.equal((await restored.get(started.id)).state, 'captured');
  assert.equal(restored.items, undefined);
  assert.equal(restored.waiting, null);
});

test('无人处理的人工验证超时后释放浏览器，任务仍可续接', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'luz-mcp-verification-timeout-'));
  const pending = '55555555-5555-4555-8555-555555555555';
  const calls = [];
  let closes = 0;
  const runtime = {
    profile: 'test',
    async start() {},
    async close() { closes++; },
    async run(args) {
      calls.push(args);
      if (args[0] === 'begin') return { folder: path.join(root, 'out', '001') };
      if (args[0] === 'capture') return { status: 'awaiting_user', task_id: pending };
      if (args[0] === 'continue') return { status: 'captured' };
      throw new Error('unexpected command');
    }
  };
  const jobs = new Jobs({
    runtime,
    stateRoot: path.join(root, 'state'),
    outputRoot: path.join(root, 'out'),
    verificationUrl: 'http://localhost/verify/',
    verificationTimeoutMs: 250
  });
  await jobs.init();
  const started = await jobs.start('capture', { url: 'https://example.com/' });
  await waitFor(async () => (await jobs.get(started.id)).state === 'awaiting_user');
  const interrupted = await waitFor(async () => {
    const job = await jobs.get(started.id);
    return job.state === 'interrupted' && job;
  });
  assert.match(interrupted.message, /超时/);
  assert.equal(jobs.waiting, null);
  assert.equal(closes, 1);
  await jobs.resume(started.id);
  await waitFor(async () => (await jobs.get(started.id)).state === 'captured');
  assert.deepEqual(calls.at(-1).slice(0, 2), ['continue', pending]);
  assert.equal(closes, 2);
});

test('合集中的人工验证可续接并刷新报告', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'luz-mcp-collection-'));
  const out = path.join(root, 'out');
  const folder = path.join(out, 'raw', '001');
  const collection = path.join(folder, 'raw', 'collection');
  const pending = '22222222-2222-4222-8222-222222222222';
  const calls = [];
  const runtime = {
    profile: 'test',
    async run(args) {
      calls.push(args);
      if (args[0] === 'begin') { await mkdir(collection, { recursive: true }); return { folder }; }
      if (args[0] === 'collect') return {
        status: 'partial', folder: collection, awaiting_user: [{ task_id: pending }],
        results: [{ status: 'awaiting_user', task_id: pending }]
      };
      if (args[0] === 'continue') return { status: 'captured' };
      return { status: 'partial', requested_tasks: 3, attempted_tasks: 1 };
    }
  };
  const jobs = new Jobs({ runtime, stateRoot: path.join(root, 'state'), outputRoot: out, verificationUrl: 'http://localhost/verify/' });
  await jobs.init();
  const started = await jobs.start('collect', { input: 'test topic', read: 1 });
  await waitFor(async () => (await jobs.get(started.id)).state === 'awaiting_user');
  assert.equal((await jobs.get(started.id)).pending_task_id, pending);
  await jobs.resume(started.id);
  await waitFor(async () => (await jobs.get(started.id)).state === 'partial');
  assert.equal(calls.at(-1)[0], 'report');
  assert.match((await jobs.get(started.id)).message, /未自动执行/);
});

test('搜索中的人工验证续接后在同一任务目录重跑原搜索', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'luz-mcp-search-resume-'));
  const out = path.join(root, 'out');
  const folder = path.join(out, 'raw', '001_search');
  const pending = '33333333-3333-4333-8333-333333333333';
  const calls = [];
  const runtime = {
    profile: 'test',
    async start() {},
    async close() {},
    async run(args) {
      calls.push(args);
      if (args[0] === 'begin') { await mkdir(folder, { recursive: true }); return { folder }; }
      if (args[0] === 'search' && calls.filter(call => call[0] === 'search').length === 1) {
        return { status: 'partial', sources: [{ status: 'awaiting_user', task_id: pending }] };
      }
      if (args[0] === 'continue') return { status: 'captured', task_id: pending };
      return { status: 'captured', folder };
    }
  };
  const jobs = new Jobs({ runtime, stateRoot: path.join(root, 'state'), outputRoot: out, verificationUrl: 'http://localhost/verify/' });
  await jobs.init();
  const started = await jobs.start('search', { platform: 'xhs', query: 'test query', read: 2, comments: false, download: false });
  await waitFor(async () => (await jobs.get(started.id)).state === 'awaiting_user');
  await jobs.resume(started.id);
  await waitFor(async () => (await jobs.get(started.id)).state === 'captured');
  assert.deepEqual(calls[2].slice(0, 2), ['continue', pending]);
  assert.equal(calls[3][0], 'search');
  assert.equal(calls[3][1], 'xhs');
  assert.equal(calls[3][2], 'test query');
  assert.equal(calls[3][calls[3].indexOf('--out') + 1], folder);
});

test('取消需工具确认；成功后释放浏览器并保留任务文件', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'luz-mcp-cancel-'));
  const out = path.join(root, 'out');
  const folder = path.join(out, 'raw', '001_cancel');
  const pending = '44444444-4444-4444-8444-444444444444';
  let cancelStatus = 'running';
  let closes = 0;
  const runtime = {
    profile: 'test',
    async start() {},
    async close() { closes++; },
    async run(args) {
      if (args[0] === 'begin') {
        await mkdir(folder, { recursive: true });
        await writeFile(path.join(folder, 'kept.json'), '{"kept":true}');
        return { folder };
      }
      if (args[0] === 'capture') return { status: 'awaiting_user', task_id: pending };
      if (args[0] === 'cancel') return { status: cancelStatus };
      throw new Error('unexpected command');
    }
  };
  const jobs = new Jobs({ runtime, stateRoot: path.join(root, 'state'), outputRoot: out, verificationUrl: 'http://localhost/verify/' });
  await jobs.init();
  const started = await jobs.start('capture', { url: 'https://example.com/' });
  await waitFor(async () => (await jobs.get(started.id)).state === 'awaiting_user');
  await assert.rejects(jobs.cancel(started.id), /未确认取消/);
  assert.equal((await jobs.get(started.id)).state, 'awaiting_user');
  assert.equal(jobs.active, null);
  cancelStatus = 'cancelled';
  const cancelled = await jobs.cancel(started.id);
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(closes, 1);
  const files = await jobs.listFiles(started.id);
  assert.equal(files.files.length, 1);
  assert.equal(JSON.parse((await jobs.readText(files.files[0].path)).text).kept, true);
  assert.equal(jobs.active, null);
});

test('重启后不自动重放进行中的任务', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'luz-mcp-restart-'));
  let invoked = false;
  const runtime = { profile: 'test', run: () => { invoked = true; return new Promise(() => {}); } };
  const options = { runtime, stateRoot: path.join(root, 'state'), outputRoot: path.join(root, 'out'), verificationUrl: 'http://localhost/verify/' };
  const first = new Jobs(options);
  await first.init();
  const started = await first.start('capture', { url: 'https://example.com/' });
  await waitFor(() => invoked);
  const second = new Jobs(options);
  await second.init();
  assert.equal((await second.get(started.id)).state, 'interrupted');
  await assert.rejects(second.resume(started.id), /没有可续接/);
});
