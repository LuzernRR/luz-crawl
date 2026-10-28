import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import vm from 'node:vm';
import defaults from '../opencli/access-policy.json' with { type: 'json' };
import { ExecutionPolicy, validatePolicy } from '../opencli/lib/execution.mjs';
import { OperationError, classifyFailure, retryAfter } from '../opencli/lib/failure.mjs';
import { executeActions, validateActions, readActions, ACTION_SCHEMA } from '../opencli/lib/browser-actions.mjs';
import { testPolicy, actionArgument } from './helpers.mjs';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'luzcrawl-policy-'));
process.env.LUZ_CRAWL_STATE = path.join(tmp, 'memory');
test.after(() => fs.rm(tmp, { recursive: true, force: true }));
const url = 'https://example.com/fixture';
const settings = values => ({ ...defaults, defaults: { ...defaults.defaults, ...values } });
const pageWith = read => ({ goto: async () => {}, evaluate: async code => read(actionArgument(code)) });

test('failure classification preserves Retry-After and separates validation, login and transient errors', () => {
  assert.equal(retryAfter('1.5'), 1500);
  assert.equal(retryAfter('Thu, 01 Jan 1970 00:00:02 GMT', 1000), 1000);
  assert.equal(retryAfter('nonsense'), 0);
  assert.equal(classifyFailure(new Error('HTTP 429')).retryable, false);
  assert.equal(classifyFailure(new Error('HTTP 403')).code, 'access_denied');
  assert.equal(classifyFailure(new Error('HTTP 401')).code, 'login_required');
  assert.equal(classifyFailure(new Error('HTTP 503')).retryable, true);
  assert.equal(classifyFailure(Object.assign(new Error('gone'), { code: 'ENOTFOUND' })).retryable, false);
  const write = classifyFailure(new Error('timeout'), { idempotent: false });
  assert.equal(write.retryable, false); assert.equal(write.outcome_unknown, true);
  assert.match(write.next_action, /verify/);
});

test('platform policy rejects unknown keys, excessive retries and malformed settings', () => {
  assert.equal(validatePolicy(defaults), defaults);
  for (const values of [{ max_attempts: 100 }, { jitter_ratio: 0.9 }, { read_interval_ms: -1 }, { shell: 1 }]) assert.throws(() => validatePolicy(settings(values)), { code: 'invalid_policy' });
  assert.throws(() => validatePolicy({ schema_version: 1, defaults: [], platforms: {} }), { code: 'invalid_policy' });
});

test('transient reads back off and stop at the configured bound; writes dispatch once', async () => {
  const policy = testPolicy(tmp); let calls = 0;
  assert.equal(await policy.run('read', url, async () => { if (++calls === 1) throw new Error('HTTP 503'); return 'ok'; }), 'ok');
  assert.equal(calls, 2); assert.equal(policy.retries, 1); assert.ok(policy.waited >= 700);
  let writes = 0;
  await assert.rejects(() => policy.run('interaction', url, async () => { writes++; throw new Error('timeout'); }, { idempotent: false }), error => error.outcome_unknown && !error.retryable);
  assert.equal(writes, 1);
});

test('429 cooldown persists across processes and subdomains, while profiles remain isolated', async () => {
  const directory = path.join(tmp, 'cooldown'); let time = Date.now(); let sent = 0;
  const make = profile => new ExecutionPolicy({ directory, profile, now: () => time, wait: async ms => { time += ms; }, random: () => 0 });
  await assert.rejects(() => make('one').run('navigation', 'https://www.xiaohongshu.com/explore/a', async () => { sent++; throw new OperationError('rate_limited', 'HTTP 429', { retry_after_ms: 1200000 }); }), { code: 'rate_limited' });
  await assert.rejects(() => make('one').run('media', 'https://xiaohongshu.com/explore/b', async () => { sent++; }), error => error.code === 'rate_limited' && error.retry_after_ms >= 1200000);
  assert.equal(sent, 1);
  await make('two').run('read', 'https://xiaohongshu.com/explore/b', async () => { sent++; });
  assert.equal(sent, 2);
});

test('request window and repeated network failures stop further access', async () => {
  const limited = testPolicy(tmp, settings({ max_requests_per_window: 1 }));
  await limited.run('navigation', url, async () => {});
  await assert.rejects(() => limited.run('media', url, async () => assert.fail('must not send')), { code: 'operation_budget' });
  const circuit = testPolicy(tmp);
  for (let i = 0; i < 3; i++) await assert.rejects(() => circuit.run('navigation', url, async () => { throw new Error('HTTP 503'); }, { attempts: 1 }), { code: 'transient_failure' });
  await assert.rejects(() => circuit.run('navigation', url, async () => assert.fail('must not send')), { code: 'rate_limited' });
});

test('operation, wait and cancellation budgets stop work before another browser call', async () => {
  const policy = testPolicy(tmp, settings({ max_operations: 1 }));
  await policy.run('read', url, async () => {});
  await assert.rejects(() => policy.run('read', url, async () => assert.fail('must not send')), { code: 'operation_budget' });
  const short = testPolicy(tmp, settings({ max_elapsed_ms: 100 }));
  await assert.rejects(() => short.delay(101), { code: 'operation_budget' });
  const signal = AbortSignal.abort(); const cancelled = new ExecutionPolicy({ directory: path.join(tmp, 'cancel'), signal });
  await assert.rejects(() => cancelled.run('read', url, async () => assert.fail('must not send')), { name: 'AbortError' });
});

test('condition waits use bounded adaptive polls and require stable matches', async () => {
  const policy = testPolicy(tmp); let polls = 0;
  const result = await policy.waitUntil(url, async () => ++polls, value => value >= 2, { stable: 2 });
  assert.equal(result.polls, 3); assert.equal(result.satisfied, true); assert.ok(policy.waited > 350);
  const gate = await policy.waitUntil(url, async () => ({ gate: 'verification_required' }), () => true);
  assert.equal(gate.satisfied, false); assert.equal(gate.polls, 1);
});

test('action input validates every step and refuses conflicting or unsafe form data', async () => {
  for (const step of [{ action: 'wait_for', selector: '#a', condition: 'text' }, { action: 'form', selector: '#f', fields: [{ selector: '#q', value: 'x', checked: true }] }, { action: 'scroll', into_view: true }, { action: 'click', selector: '#a', target: { role: 'button' } }]) assert.throws(() => validateActions([step], true), { code: 'invalid_action' });
  await assert.rejects(() => readActions({ file: 'unused', steps: [{ action: 'read' }] }), { code: 'invalid_action' });
  await assert.rejects(() => readActions({ steps: [{ action: 'submit', selector: '#f' }] }), { code: 'authorization_required' });
  assert.equal(ACTION_SCHEMA.items.oneOf.length, 11);
});

test('browser reads retry and report their actual operation count', async () => {
  let reads = 0;
  const page = pageWith(() => { if (++reads === 1) throw new Error('timeout'); return { ok: true, url, text: 'body' }; });
  const result = await executeActions(page, { url, steps: [{ action: 'read' }], executionPolicy: testPolicy(tmp) });
  assert.equal(result.status, 'completed'); assert.equal(result.execution.retries, 1);
  assert.equal(result.results[0].operations, 2); assert.equal(result.plan_sha256.length, 64);
});

test('a timed out write verifies its effect without replaying the action', async () => {
  let clicks = 0;
  const page = pageWith(step => { if (step.action === 'click') { clicks++; throw new Error('timeout'); } return { ok: true, url, satisfied: true, text: '1' }; });
  const result = await executeActions(page, { url, steps: [{ action: 'click', selector: '#button', expect: { selector: '#count', text_equals: '1' } }], allowWrite: true, executionPolicy: testPolicy(tmp) });
  assert.equal(clicks, 1); assert.equal(result.status, 'completed');
  assert.equal(result.results[0].value.completed_without_replay, true);
});

test('unknown write outcomes advance the cursor and block automatic replay on continuation', async () => {
  let clicks = 0;
  const page = pageWith(() => { clicks++; throw new Error('timeout'); });
  const steps = [{ action: 'click', selector: '#button' }];
  const first = await executeActions(page, { url, steps, allowWrite: true, executionPolicy: testPolicy(tmp) });
  assert.equal(first.next_action_index, 1); assert.equal(first.error.outcome_unknown, true);
  const resumed = await executeActions(page, { url, steps, allowWrite: true, current_page: true, action_cursor: 1, plan_sha256: first.plan_sha256, pending_verification: first.pending_verification, executionPolicy: testPolicy(tmp) });
  assert.equal(resumed.stop_reason, 'write_outcome_unknown'); assert.equal(clicks, 1);
  await assert.rejects(() => executeActions(page, { url, steps: [{ action: 'read' }], plan_sha256: first.plan_sha256, executionPolicy: testPolicy(tmp) }), { code: 'plan_changed' });
});

test('the extension blocks upstream semantic retries after a write loses its execution context', async () => {
  const source = await fs.readFile(new URL('../browser-extension/dist/background.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function handleExec(');
  const execute = vm.runInNewContext(source.slice(start, source.indexOf('\nasync function handleFrames(', start)) + '\nhandleExec', {
    resolveCommandTabId: async () => 1, resolveTabId: async () => 1, getSurfaceFromKey: () => 'browser', commandCdpTimeoutMs: () => 1000,
    evaluateAsync: async () => { throw new Error('Inspected target navigated or closed'); }, UNKNOWN_OUTCOME_HINT: 'Inspect before retrying.',
    errorResult: (id, error) => ({ id, ok: false, error: error.message, errorCode: 'target_navigated' }),
  });
  const written = await execute({ id: 'one', code: '/*luzcrawl:once*/document.querySelector("button").click()' }, 'test');
  assert.equal(written.errorCode, 'command_result_unknown');
  assert.doesNotMatch(written.error, /target navigated|Detached|No tab/);
  const failure = classifyFailure(Object.assign(new Error(written.error), { code: written.errorCode }), { idempotent: false });
  assert.equal(failure.outcome_unknown, true); assert.equal(failure.retryable, false);
  assert.equal((await execute({ id: 'two', code: 'document.title' }, 'test')).errorCode, 'target_navigated');
});

test('schema is available to models without opening a browser, and unauthorized plans fail early', async () => {
  const cli = new URL('../scripts/luz-crawl.mjs', import.meta.url);
  const { fileURLToPath } = await import('node:url');
  const run = promisify(execFile);
  const { stdout } = await run(process.execPath, [fileURLToPath(cli), 'schema']);
  assert.equal(JSON.parse(stdout).actions.title, ACTION_SCHEMA.title);
  await assert.rejects(() => run(process.execPath, [fileURLToPath(cli), 'browser', url, '--steps', JSON.stringify([{ action: 'click', selector: '#send' }])]), error => JSON.parse(error.stdout).failure.code === 'authorization_required');
});

test('background leases create an inactive tab in the existing window and release only that tab',async()=>{
  const source=await fs.readFile(new URL('../browser-extension/dist/background.js',import.meta.url),'utf8');
  const begin=source.indexOf('async function createOwnedTabLeaseUnlocked(');
  const sessions=new Map();const created=[];const removed=[];
  const chrome={windows:{getAll:async()=>[{id:10,focused:true}],create:async()=>{throw new Error('Unexpected new window');}},tabs:{create:async value=>{created.push(value);return{id:20,windowId:value.windowId,url:value.url};},remove:async id=>removed.push(id)}};
  const context={chrome,isSafeNavigationUrl:()=>true,getWindowMode:()=> 'background',getSessionFromKey:()=> 'test',getSurfaceFromKey:()=> 'browser',setLeaseSession:(key,value)=>sessions.set(key,value),resetWindowIdleTimer:()=>{},automationSessions:sessions,sessionOverrides:new Map(),scheduleIdleAlarm:()=>{},IDLE_TIMEOUT_NONE:0,safeDetach:async()=>{},evictTab:()=>{},persistRuntimeState:async()=>{},console:{log:()=>{}}};
  const create=vm.runInNewContext(source.slice(begin,source.indexOf('\nasync function getAutomationWindow(',begin))+'\ncreateOwnedTabLeaseUnlocked',context);
  const result=await create('test','https://example.com/');
  assert.equal(result.tabId,20);assert.equal(created[0].windowId,10);assert.equal(created[0].active,false);assert.equal(sessions.get('test').preferredTabId,20);
  const releaseStart=source.indexOf('async function releaseLease(');
  const release=vm.runInNewContext(source.slice(releaseStart,source.indexOf('\nasync function reconcileTargetLeaseRegistry(',releaseStart))+'\nreleaseLease',context);
  await release('test');assert.deepEqual(removed,[20]);assert.equal(sessions.size,0);
});

test('a task cannot close or select a user tab sharing the same browser window',async()=>{
  const source=await fs.readFile(new URL('../browser-extension/dist/background.js',import.meta.url),'utf8');const begin=source.indexOf('async function handleTabs(');
  const sessions=new Map([['test',{owned:true,windowId:10,preferredTabId:20}]]);
  const context={automationSessions:sessions,resolveCommandTabId:async()=>30,resolveTargetId:async()=> 'user-page',chrome:{tabs:{get:async()=>({id:30,windowId:10})}}};
  const handle=vm.runInNewContext(source.slice(begin,source.indexOf('\nasync function handleCookies(',begin))+'\nhandleTabs',context);
  assert.equal((await handle({id:'close',op:'close',page:'user-page'},'test')).ok,false);
  assert.equal((await handle({id:'select',op:'select',page:'user-page'},'test')).ok,false);
});

test('only explicit foreground handover restores a minimized browser window',async()=>{
  const source=await fs.readFile(new URL('../browser-extension/dist/background.js',import.meta.url),'utf8');const begin=source.indexOf('async function focusOwnedWindowIfRequested(');const calls=[];
  const focus=vm.runInNewContext(source.slice(begin,source.indexOf('\nasync function toOwnedContainerGroupCandidate(',begin))+'\nfocusOwnedWindowIfRequested',{chrome:{windows:{get:async()=>({state:'minimized'}),update:async(id,values)=>calls.push({id,...values})}}});
  await focus(10,'background');assert.equal(calls.length,0);await focus(10,'foreground');assert.equal(calls[0].id,10);assert.equal(calls[0].focused,true);assert.equal(calls[0].state,'normal');
});

test('an empty rendered browser read never falls back to embedded scripts', async () => {
  const { domOperation } = await import('../opencli/lib/browser-operations.mjs');
  const body = { tagName:'BODY', innerText:'', textContent:'private embedded state', children:[], labels:[],
    getAttribute:()=>null, querySelectorAll:()=>[], getClientRects:()=>[{}],
    getBoundingClientRect:()=>({x:0,y:0,width:100,height:100,top:0,left:0,bottom:100,right:100}) };
  const result = vm.runInNewContext('(' + domOperation.toString() + ')({action:"read",selector:"body"})', {
    document:{body,title:'Fixture',getElementById:()=>null,querySelectorAll:s=>s.startsWith('body')?[body]:[]},
    window:{scrollX:0,scrollY:0,innerWidth:100,innerHeight:100}, location:{href:url},
    getComputedStyle:()=>({visibility:'visible',display:'block'})
  });
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.text, '');
  assert.ok(!JSON.stringify(result).includes('private embedded state'));
});
