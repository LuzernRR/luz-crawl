import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { batch, readBatch, batchConcurrency } from '../opencli/lib/batch.mjs';
import { OperationError } from '../opencli/lib/failure.mjs';
import vm from 'node:vm';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'luzcrawl-batch-'));
test.after(() => fs.rm(tmp, { recursive: true, force: true }));
async function options(name, jobs, extra = {}) {
  const file = path.join(tmp, `${name}.json`);
  await fs.writeFile(file, JSON.stringify(jobs));
  return { file, out: path.join(tmp, name), ...extra };
}

test('batch bounds simultaneous pages, serializes a site and preserves input order and evidence', async () => {
  const settings = await options('parallel', ['https://a.test/1', 'https://a.test/2', 'https://b.test/1', 'https://c.test/1', 'https://d.test/1']);
  const active = new Set(), events = [];
  let peak = 0;
  const result = await batch(settings, async (kind, opts) => {
    const host = new URL(opts.url).hostname;
    assert(!active.has(host)); active.add(host); peak = Math.max(peak, active.size);
    assert.equal(kind, 'capture'); assert.equal(opts.park_on_block, true); assert.equal(opts.window, 'background');
    events.push(opts.url);
    await new Promise(resolve => setImmediate(resolve));
    active.delete(host);
    return { status: 'captured', browser: { owned: true, closed: true } };
  });
  assert.equal(peak, 3); assert.equal(result.status, 'completed'); assert.equal(result.attempted, 5);
  assert(events.indexOf('https://a.test/1') < events.indexOf('https://a.test/2'));
  assert.deepEqual(result.results.map(row => row.url), ['https://a.test/1', 'https://a.test/2', 'https://b.test/1', 'https://c.test/1', 'https://d.test/1']);
  assert.deepEqual(JSON.parse(await fs.readFile(result.batch_file, 'utf8')), result);
});

test('login skips queued pages on that site while independent sites and failures settle', async () => {
  const settings = await options('blocked', ['https://a.test/login', 'https://a.test/2', 'https://b.test/1', 'https://c.test/1']);
  const visited = [];
  const result = await batch(settings, async (_, opts) => {
    visited.push(opts.url);
    if (opts.url.includes('a.test')) return { status: 'awaiting_user', stop_reason: 'verification_required', task_id: 'saved', browser: { closed: true, parked: true } };
    if (opts.url.includes('b.test')) throw new Error('offline');
    return { status: 'captured' };
  });
  assert.equal(result.status, 'partial'); assert.equal(result.attempted, 3); assert.equal(result.settled, 4);
  assert(!visited.includes('https://a.test/2'));
  assert.equal(result.results[1].blocked_by, 'verification_required');
  assert.equal(result.results[2].error, 'offline'); assert.equal(result.results[3].status, 'captured');
});

test('batch validates the whole plan and write authorization before executing any page', async () => {
  let attempted = 0;
  const execute = async () => { attempted++; return { status: 'completed' }; };
  async function check(name, jobs, extra, pattern) {
    const settings = await options(name, jobs, extra);
    await assert.rejects(() => batch(settings, execute), pattern);
  }
  await check('scheme', ['https://a.test/', 'file:///private'], {}, /HTTP/);
  await check('credentials', ['https://user:pass@a.test/'], {}, /credentials/);
  await check('override', [{ url: 'https://a.test/', out: 'elsewhere' }], {}, /only id/);
  await check('write', [{ url: 'https://a.test/', steps: [{ action: 'type', selector: '#q', text: '门窗' }] }], {}, /allow-write/);
  assert.equal(attempted, 0);
  const settings = await options('actions', [{ id: 'search', url: 'https://a.test/', steps: [{ action: 'read' }] }]);
  const jobs = await readBatch(settings); assert.equal(jobs[0].id, 'search');
  assert.equal(batchConcurrency(), 3);
  for (const value of [0, 5, 1.5, 'bad']) assert.throws(() => batchConcurrency(value), /1 to 4/);
  const result = await batch(settings, async (kind, opts) => { assert.equal(kind, 'browser'); assert.equal(opts.steps[0].action, 'read'); return { status: 'completed' }; });
  assert.equal(result.status, 'completed');
});

test('thrown cooldowns keep their failure code and stop the queued site', async () => {
  const settings = await options('thrown-cooldown', ['https://a.test/1', 'https://a.test/2', 'https://b.test/1']);
  const visited = [];
  const result = await batch(settings, async (_, opts) => {
    visited.push(opts.url);
    if (opts.url.includes('a.test')) throw new OperationError('rate_limited', 'HTTP 429', { retry_after_ms: 600000 });
    return { status: 'captured' };
  });
  assert.equal(result.results[0].failure.code, 'rate_limited');
  assert.equal(result.results[0].failure.retry_after_ms, 600000);
  assert.equal(result.results[1].status, 'skipped');
  assert(!visited.includes('https://a.test/2'));
  assert.equal(result.results[2].status, 'captured');
  assert.deepEqual(JSON.parse(await fs.readFile(result.batch_file, 'utf8')), JSON.parse(JSON.stringify(result)));
});

test('the native batch keeps its resolved output even if browser preferences change during child runs', async () => {
  const settings = await options('native-output', ['https://a.test/', 'https://b.test/']);
  const source = await fs.readFile(new URL('../opencli/commands.js', import.meta.url), 'utf8');
  const functions = ['run', 'runBatch'].map(name => {
    const start = source.indexOf(`async function ${name}(`);
    return source.slice(start, source.indexOf('\n}', start) + 2);
  }).join('\n');
  const outputs = []; let synced = 0;
  const runBatch = vm.runInNewContext(functions + '\nrunBatch', {
    process, defaults: { browser_profile: 'saved-profile' }, profileFromArgs: value => value,
    syncBrowserPreferences: async () => ({ output_dir: ++synced === 1 ? settings.out : path.join(tmp, 'changed-output') }),
    findTaskArchive: async folder => ({ folder }), readBatch, batch,
    withBrowser: async (_, values) => { outputs.push(values.out); return { status: 'captured', browser: { owned: true, closed: true } }; },
  });
  const result = await runBatch({ file: settings.file });
  assert.equal(result.status, 'completed'); assert.equal(synced, 1);
  assert.deepEqual(outputs, [settings.out, settings.out]);
});
