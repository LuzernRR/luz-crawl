import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { allocateArchiveDirectory, createTaskArchive, hash, rawRootFor, verifyArchive } from '../opencli/lib/archive.mjs';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'luz-crawl-archive-'));
test.after(() => fs.rm(temp, { recursive: true, force: true }));

test('search archive allocation creates unique numbered child directories and rejects loose files', async () => {
  const out = path.join(temp, 'output');
  await fs.mkdir(path.join(out, '003_历史材料'), { recursive: true });
  await fs.writeFile(path.join(out, '遗留.html'), 'legacy');
  await assert.rejects(() => allocateArchiveDirectory(out, 'xhs_新查询'), /Raw root contains loose files/);
  await fs.rename(path.join(out, '遗留.html'), path.join(out, '003_历史材料', '遗留.html'));

  const first = await allocateArchiveDirectory(out, 'xhs_新查询/人工智能');
  const second = await allocateArchiveDirectory(out, 'xhs_新查询/人工智能');
  assert.equal(path.basename(first), '004_xhs_新查询 人工智能');
  assert.equal(path.basename(second), '005_xhs_新查询 人工智能');
  assert.deepEqual((await fs.readdir(out, { withFileTypes: true })).filter((entry) => !entry.isDirectory()).map((entry) => entry.name), []);
  assert.equal(rawRootFor(out), path.join(out, 'raw'));

  const configuredRawRoot = path.join(temp, 'explicit', 'raw');
  const direct = await allocateArchiveDirectory(configuredRawRoot, 'search_xhs_第三个查询');
  assert.equal(path.dirname(direct), path.dirname(configuredRawRoot));
  assert.equal(rawRootFor(configuredRawRoot), configuredRawRoot);
});

test('one Codex thread reuses its task archive across repeated and concurrent begin calls', async () => {
  const previousThread = process.env.CODEX_THREAD_ID;
  const previousState = process.env.LUZ_CRAWL_STATE;
  process.env.CODEX_THREAD_ID = 'archive-test-thread';
  process.env.LUZ_CRAWL_STATE = path.join(temp, 'task-state');
  try {
    const out = path.join(temp, 'task-output');
    const [first, concurrent] = await Promise.all([
      createTaskArchive(out, 'request title'),
      createTaskArchive(out, 'request title')
    ]);
    const repeated = await createTaskArchive(out, 'different keyword');
    const next = await createTaskArchive(out, 'new request', { newTask: true });
    const resumed = await createTaskArchive(out, 'new request');
    const folders = await fs.readdir(out, { withFileTypes: true });

    assert.equal(first, concurrent);
    assert.equal(first, repeated);
    assert.equal(next, resumed);
    assert.equal(first, next);
    assert.ok(folders.length === 1 && folders.every((entry) => entry.isDirectory()));
    assert.equal(JSON.parse(await fs.readFile(path.join(first, 'luz-task.json'), 'utf8')).thread_id, 'archive-test-thread');
  } finally {
    if (previousThread === undefined) delete process.env.CODEX_THREAD_ID;
    else process.env.CODEX_THREAD_ID = previousThread;
    if (previousState === undefined) delete process.env.LUZ_CRAWL_STATE;
    else process.env.LUZ_CRAWL_STATE = previousState;
  }
});

test('different conversations and projects stay isolated while each binding is reusable', async () => {
  const previousThread = process.env.CODEX_THREAD_ID;
  const previousState = process.env.LUZ_CRAWL_STATE;
  process.env.LUZ_CRAWL_STATE = path.join(temp, 'shared-task-state');
  try {
    const out = path.join(temp, 'shared-task-output');
    process.env.CODEX_THREAD_ID = 'coordinator-thread';
    const task = await createTaskArchive(out, 'user request');
    process.env.CODEX_THREAD_ID = 'worker-thread-a';
    const workerA = await createTaskArchive(out, 'keyword A');
    process.env.CODEX_THREAD_ID = 'worker-thread-b';
    const workerB = await createTaskArchive(out, 'keyword B');

    assert.notEqual(workerA, task);
    assert.notEqual(workerB, task);
    assert.notEqual(workerA, workerB);

    process.env.CODEX_THREAD_ID = 'coordinator-thread';
    const nextTask = await createTaskArchive(out, 'next user request', { newTask: true });
    process.env.CODEX_THREAD_ID = 'worker-thread-c';
    const workerC = await createTaskArchive(out, 'another keyword');
    const folders = await fs.readdir(out, { withFileTypes: true });

    assert.equal(nextTask, task);
    assert.notEqual(workerC, nextTask);
    assert.equal(folders.length, 4);
    const otherProject = await createTaskArchive(path.join(temp, 'second-project'), 'same query');
    assert.notEqual(otherProject, workerC);
    assert.equal(await createTaskArchive(out, 'return to first project'), workerC);
  } finally {
    if (previousThread === undefined) delete process.env.CODEX_THREAD_ID;
    else process.env.CODEX_THREAD_ID = previousThread;
    if (previousState === undefined) delete process.env.LUZ_CRAWL_STATE;
    else process.env.LUZ_CRAWL_STATE = previousState;
  }
});

test('verified delivery stays valid after all raw files are pruned and hashed in the manifest', async () => {
  const out = path.join(temp, 'compacted-output');
  const archive = path.join(out, 'raw', '001_post');
  await fs.mkdir(path.join(archive, 'raw'), { recursive: true });
  const delivery = path.join(out, '001_post.html');
  await fs.writeFile(delivery, 'verified');
  await fs.writeFile(path.join(archive, 'raw', 'manifest.json'), JSON.stringify({
    output_layout: 'html_and_raw_v1', status: 'captured', primary_file: '001_post.html',
    delivery: { file: '001_post.html', sha256: hash(await fs.readFile(delivery)) },
    files: [], pruned_files: [{ path: 'raw/content.json', bytes: 1234, sha256: 'a'.repeat(64) }]
  }));

  assert.deepEqual(await verifyArchive(archive), { ok: true, failures: [], status: 'captured', completeness: undefined });
});
