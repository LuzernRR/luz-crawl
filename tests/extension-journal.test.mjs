import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../browser-extension/dist/background.js', import.meta.url), 'utf8');
const journalCode = source.slice(source.indexOf('const JOURNAL_KEY ='), source.indexOf('\nlet ws = null;'));

function journal({ readError, writeError } = {}) {
  let stored = {}, reads = 0, writes = 0;
  const execute = vm.runInNewContext(journalCode + '\nexecuteWithJournal', {
    TextEncoder, structuredClone,
    chrome: { storage: { session: {
      get: async () => { reads++; await new Promise(resolve => setImmediate(resolve)); if (readError) throw new Error('storage read failed'); return structuredClone(stored); },
      set: async value => { writes++; await new Promise(resolve => setImmediate(resolve)); if (writeError?.(writes)) throw new Error('storage write failed'); stored = structuredClone(value); },
    } } },
  });
  return { execute, saved: () => stored.opencli_command_journal_v1 || {}, reads: () => reads };
}

test('parallel cold commands share one journal load and persist every result', async () => {
  const state = journal();
  const results = await Promise.all(['one', 'two', 'three'].map(id => state.execute({ id }, async () => ({ id, ok: true }))));
  assert(results.every(result => result.ok));
  assert.equal(state.reads(), 1);
  assert.deepEqual(Object.keys(state.saved()).sort(), ['one', 'three', 'two']);
  assert(Object.values(state.saved()).every(entry => entry.status === 'done'));
});

test('a command is durable before dispatch and replays without executing twice', async () => {
  const state = journal(); let calls = 0;
  const execute = async () => { calls++; assert.equal(state.saved().write.status, 'started'); return { id: 'write', ok: true }; };
  assert.equal((await state.execute({ id: 'write' }, execute)).ok, true);
  assert.equal((await state.execute({ id: 'write' }, execute)).ok, true);
  assert.equal(calls, 1);
});

test('unreadable or unwritable journals do not dispatch commands, and a later save can recover', async () => {
  for (const options of [{ readError: true }, { writeError: () => true }]) {
    const state = journal(options); let calls = 0;
    const result = await state.execute({ id: 'unsafe' }, async () => { calls++; return { ok: true }; });
    assert.equal(calls, 0); assert.equal(result.ok, false); assert.equal(result.errorCode, 'journal_unavailable');
  }
  const state = journal({ writeError: count => count === 1 }); let calls = 0;
  await state.execute({ id: 'first' }, async () => { calls++; return { ok: true }; });
  const result = await state.execute({ id: 'second' }, async () => { calls++; return { ok: true }; });
  assert.equal(result.ok, true); assert.equal(calls, 1);
});

test('oversized UTF-8 results keep an execution marker instead of replaying the command', async () => {
  const state = journal(); let calls = 0;
  await state.execute({ id: 'large' }, async () => { calls++; return { ok: true, text: '窗'.repeat(30000) }; });
  const replay = await state.execute({ id: 'large' }, async () => { calls++; });
  assert.equal(replay.errorCode, 'result_evicted'); assert.equal(calls, 1);
});

test('concurrent duplicates dispatch once and active markers survive the completed-entry limit', async () => {
  const state = journal(); let release, calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const execute = async () => { calls++; await gate; return { id: 'active', ok: true }; };
  const first = state.execute({ id: 'active' }, execute);
  const duplicate = state.execute({ id: 'active' }, execute);
  for (let i = 0; i < 70; i++) await state.execute({ id: `read-${i}` }, async () => ({ ok: true }));
  assert.equal(state.saved().active.status, 'started');
  release(); await Promise.all([first, duplicate]);
  assert.equal(calls, 1);
});
