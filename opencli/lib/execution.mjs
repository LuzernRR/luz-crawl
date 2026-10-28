import fs from 'node:fs/promises';
import path from 'node:path';
import defaults from '../access-policy.json' with { type: 'json' };
import { atomicWrite, hash, stateRoot } from './archive.mjs';
import { platformOf, validateURL } from './platforms.mjs';
import { OperationError, classifyFailure } from './failure.mjs';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const limits = { max_attempts: 3, max_operations: 500, max_elapsed_ms: 900000, max_requests_per_window: 100, failure_threshold: 10 };

export function validatePolicy(value) {
  if (!value || value.schema_version !== 1 || !value.defaults || typeof value.defaults !== 'object' || !value.platforms || typeof value.platforms !== 'object' || Array.isArray(value.platforms)) throw new OperationError('invalid_policy', 'Policy requires schema_version: 1, defaults and platforms.');
  for (const [platform, settings] of [['defaults', value.defaults], ...Object.entries(value.platforms)]) {
    if (!/^[a-z0-9_.-]{1,100}$/i.test(platform) || ['__proto__', 'constructor', 'prototype'].includes(platform) || !settings || typeof settings !== 'object' || Array.isArray(settings)) throw new OperationError('invalid_policy', 'Invalid platform policy.');
    for (const [key, number] of Object.entries(settings)) {
      if (!Object.hasOwn(defaults.defaults, key) || typeof number !== 'number' || !Number.isFinite(number) || (key === 'jitter_ratio' ? number < 0 || number > 0.3 : !Number.isSafeInteger(number) || number < (key.includes('interval') ? 0 : 1) || number > (limits[key] || 86400000))) throw new OperationError('invalid_policy', `Invalid policy setting: ${key}.`);
    }
  }
  return value;
}

export async function accessPolicy(value) {
  if (value !== undefined) {
    validatePolicy(value);
    await atomicWrite(path.join(stateRoot(), 'access-policy.json'), value);
  }
  let custom;
  try { custom = validatePolicy(JSON.parse(await fs.readFile(path.join(stateRoot(), 'access-policy.json'), 'utf8'))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { schema_version: 1, defaults: { ...defaults.defaults, ...custom?.defaults }, platforms: Object.fromEntries([...new Set([...Object.keys(defaults.platforms), ...Object.keys(custom?.platforms || {})])].map(key => [key, { ...defaults.platforms[key], ...custom?.platforms[key] }])) };
}

export async function createExecutionPolicy(options = {}) {
  return options.executionPolicy || new ExecutionPolicy({ settings: await accessPolicy(), profile: options.profile });
}

export class ExecutionPolicy {
  constructor({ settings = defaults, profile = 'default', directory = path.join(stateRoot(), 'execution'), now = Date.now, wait = sleep, random = Math.random, signal } = {}) {
    this.settings = validatePolicy(settings); this.profile = profile || 'default'; this.directory = directory;
    this.now = now; this.wait = wait; this.random = random; this.signal = signal; this.started = now();
    this.deadline = this.started + settings.defaults.max_elapsed_ms;
    this.operations = 0; this.retries = 0; this.waited = 0; this.events = [];
  }
  forURL(value) {
    const url = validateURL(value);
    const platform = platformOf(url.href);
    const key = platform === 'web' ? url.hostname : platform;
    return { platform: key, ...this.settings.defaults, ...this.settings.platforms[key] };
  }
  summary() { return { operations: this.operations, retries: this.retries, waited_ms: this.waited, elapsed_ms: this.now() - this.started, events: this.events }; }
  async delay(ms) {
    this.signal?.throwIfAborted();
    if (this.now() + ms > this.deadline) throw new OperationError('operation_budget', 'Waiting would exceed the task time budget.');
    if (ms > 0) { this.waited += ms; await this.wait(ms); }
    this.signal?.throwIfAborted();
  }
  async state(url, mutate) {
    const config = this.forURL(url);
    const file = path.join(this.directory, `${hash(config.platform + ':' + this.profile).slice(0, 24)}.json`);
    const lock = file + '.lock';
    await fs.mkdir(this.directory, { recursive: true });
    let handle;
    for (let attempt = 0; attempt < 5; attempt++) {
      try { handle = await fs.open(lock, 'wx'); break; }
      catch (error) { if (error.code !== 'EEXIST') throw error; if (attempt === 4) throw new OperationError('access_busy', 'Another process is updating this platform policy; keep the task queued.', { retry_after_ms: 250 }); await this.delay(50); }
    }
    try {
      await handle.writeFile(JSON.stringify({ pid: process.pid, platform: config.platform, at: this.now() }));
      let record = {};
      try { record = JSON.parse(await fs.readFile(file, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw new OperationError('policy_state_invalid', 'Access state is unreadable; review it before accessing this platform.', { cause: error }); }
      if (!record || Array.isArray(record) || Object.values(record).some(value => typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)) throw new OperationError('policy_state_invalid', 'Invalid access state.');
      let result, failure;
      try { result = mutate(record, config); } catch (error) { failure = error; }
      await atomicWrite(file, record);
      if (failure) throw failure;
      return result;
    } finally { await handle.close(); await fs.rm(lock); }
  }
  async reserve(url, kind) {
    return this.state(url, (record, config) => {
      const now = this.now();
      if (record.blocked_until > now) throw new OperationError('rate_limited', 'Saved access cooldown is active; no browser or download request was sent.', { retry_after_ms: record.blocked_until - now });
      if (record.local_budget_until > now) throw new OperationError('operation_budget', 'Local request window is exhausted; no browser or download request was sent.', { retry_after_ms: record.local_budget_until - now });
      const network = ['navigation', 'media'].includes(kind);
      if (network && now - (record.window_started || 0) >= config.request_window_ms) { record.window_started = now; record.requests = 0; }
      if (network && (record.requests || 0) >= config.max_requests_per_window) {
        record.local_budget_until = (record.window_started ?? now) + config.request_window_ms;
        throw new OperationError('operation_budget', 'Local request window is exhausted.', { retry_after_ms: record.local_budget_until - now });
      }
      const lane = network ? 'network' : kind === 'interaction' ? 'interaction' : 'read';
      const interval = kind === 'wait' ? 0 : config[`${kind === 'navigation' ? 'navigation' : kind === 'media' ? 'media' : kind === 'interaction' ? 'interaction' : 'read'}_interval_ms`];
      const delay = Math.max(0, (record[`${lane}_at`] || 0) - now);
      if (delay > config.max_pacing_wait_ms) throw new OperationError('operation_budget', 'Local pacing queue is full; wait for its reserved interval.', { retry_after_ms: delay });
      record[`${lane}_at`] = now + delay + interval + Math.floor(interval * config.jitter_ratio * this.random());
      if (network) { record.window_started ??= now; record.requests = (record.requests || 0) + 1; }
      return delay;
    });
  }
  async noteFailure(url, error, kind = 'read') {
    const failure = classifyFailure(error);
    if (!['rate_limited', 'transient_failure'].includes(failure.code)) return;
    await this.state(url, (record, config) => {
      if (failure.code === 'rate_limited') record.blocked_until = Math.max(record.blocked_until || 0, this.now() + Math.max(config.rate_limit_cooldown_ms, failure.retry_after_ms || 0));
      else if (['navigation', 'media'].includes(kind)) {
        record.failures = (record.failures || 0) + 1;
        if (record.failures >= config.failure_threshold) record.blocked_until = this.now() + config.failure_cooldown_ms;
        if (failure.retry_after_ms) record.blocked_until = Math.max(record.blocked_until || 0, this.now() + failure.retry_after_ms);
      }
    });
  }
  async run(kind, url, operation, { idempotent = true, attempts, label = kind } = {}) {
    const config = this.forURL(url);
    this.deadline = Math.min(this.deadline, this.started + config.max_elapsed_ms);
    const maximum = idempotent ? attempts ?? config.max_attempts : 1;
    if (!Number.isInteger(maximum) || maximum < 1 || maximum > config.max_attempts) throw new OperationError('invalid_policy', 'Retry attempts exceed the configured bound.');
    for (let attempt = 1; attempt <= maximum; attempt++) {
      this.signal?.throwIfAborted();
      if (this.operations >= config.max_operations || this.now() >= this.deadline) throw new OperationError('operation_budget', 'Operation/time budget exhausted; resume only the unfinished read work.');
      const delay = await this.reserve(url, kind);
      if (this.now() + delay >= this.deadline) throw new OperationError('operation_budget', 'Pacing would exceed the task time budget.');
      await this.delay(delay); this.operations++;
      const event = { operation: this.operations, kind, label, platform: config.platform, attempt, status: 'running' }; this.events.push(event);
      try {
        const result = await operation(); event.status = 'done';
        if (['navigation', 'media'].includes(kind)) await this.state(url, record => { record.failures = 0; });
        return result;
      } catch (error) {
        const failure = classifyFailure(error, { idempotent }); event.status = 'failed'; event.error = failure.toJSON();
        await this.noteFailure(url, failure, kind);
        if (!failure.retryable || attempt === maximum) { failure.attempts_exhausted = failure.retryable; throw failure; }
        this.retries++;
        const backoff = Math.ceil(Math.min(config.retry_max_ms, config.retry_base_ms * 2 ** (attempt - 1)) * (1 + config.jitter_ratio * this.random()));
        if (failure.retry_after_ms > config.max_pacing_wait_ms) throw new OperationError('rate_limited', 'Server requested a cooldown; retry after Retry-After.', { retry_after_ms: failure.retry_after_ms });
        await this.delay(Math.max(backoff, failure.retry_after_ms || 0));
      }
    }
  }
  async waitUntil(url, read, accept, { timeout_ms = 8000, interval_ms, stable = 1 } = {}) {
    const config = this.forURL(url); const started = this.now(); let polls = 0, matched = 0, last;
    const interval = interval_ms ?? config.poll_interval_ms;
    if (!Number.isInteger(timeout_ms) || timeout_ms < 1 || timeout_ms > 30000 || !Number.isInteger(interval) || interval < 1 || interval > 5000 || ![1, 2, 3].includes(stable)) throw new OperationError('invalid_wait', 'Invalid wait bound.');
    do {
      last = await read(); polls++;
      if (last?.gate) return { satisfied: false, polls, gate: last.gate, last };
      matched = accept(last) ? matched + 1 : 0;
      if (matched >= stable) return { satisfied: true, polls, last };
      const remaining = timeout_ms - (this.now() - started);
      if (remaining <= 0) break;
      await this.delay(Math.min(remaining, config.poll_max_ms, Math.ceil(interval * 1.5 ** (polls - 1))));
    } while (this.now() - started < timeout_ms);
    return { satisfied: false, polls, last };
  }
}
