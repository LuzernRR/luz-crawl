import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateURL, sourceURL } from './platforms.mjs';
import { DEFAULT_OUTPUT, hash } from './archive.mjs';
import { createBrowserOperations } from './browser-operations.mjs';
import { OperationError, classifyFailure } from './failure.mjs';
import { VERSION, API_VERSION } from './version.mjs';

const fields = {
  read: ['selector', 'target', 'max_chars'], locate: ['selector', 'target'],
  click: ['selector', 'target', 'expect'], type: ['selector', 'target', 'text', 'expect'],
  form: ['selector', 'target', 'fields', 'expect'], submit: ['selector', 'target', 'submitter', 'expect'],
  scroll: ['selector', 'target', 'direction', 'amount', 'into_view', 'block', 'expect'],
  wait: ['ms'], wait_for: ['selector', 'target', 'condition', 'text', 'text_equals', 'value', 'url', 'timeout_ms', 'interval_ms', 'stable'],
  screenshot: ['full_page'], extract: ['comments'],
};
const writes = ['click', 'type', 'form', 'submit'];
const targetRoles = ['button', 'link', 'textbox', 'combobox', 'checkbox', 'radio', 'form', 'heading', 'article', 'dialog'];
const text = (value, maximum = 1000) => typeof value === 'string' && value.length > 0 && value.length <= maximum;
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

function validateTarget(step, required = false) {
  if (step.selector !== undefined && !text(step.selector)) throw new OperationError('invalid_action', 'Invalid CSS selector.');
  if (step.target !== undefined && (!step.target || Object.keys(step.target).some(key => !['role', 'name', 'exact'].includes(key)) || !targetRoles.includes(step.target.role) || step.target.name !== undefined && !text(step.target.name) || step.target.exact !== undefined && typeof step.target.exact !== 'boolean')) throw new OperationError('invalid_action', 'Target requires a supported role and optional accessible name.');
  if (step.selector && step.target || required && !step.selector && !step.target) throw new OperationError('invalid_action', 'Provide one CSS selector or semantic target.');
}

function validateCondition(value) {
  if (!value || Object.keys(value).some(key => !fields.wait_for.includes(key)) || value.condition !== undefined && !['visible', 'hidden', 'text', 'value', 'url'].includes(value.condition)) throw new OperationError('invalid_action', 'Invalid wait condition.');
  validateTarget(value, !value.url);
  if (value.url !== undefined) {
    validateURL(value.url);
    if (value.selector || value.target || value.condition && value.condition !== 'url' || ['text', 'text_equals', 'value'].some(key => value[key] !== undefined)) throw new OperationError('invalid_action', 'A URL wait cannot also target an element.');
  }
  for (const key of ['text', 'text_equals', 'value']) if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key].length > 10000)) throw new OperationError('invalid_action', 'Invalid expected text/value.');
  if (value.condition === 'text' && value.text === undefined && value.text_equals === undefined || value.condition === 'value' && value.value === undefined || value.condition === 'url' && !value.url) throw new OperationError('invalid_action', 'Wait condition is missing its expected value.');
  for (const [key, min, max] of [['timeout_ms', 1, 30000], ['interval_ms', 1, 5000], ['stable', 1, 3]]) if (value[key] !== undefined && !integer(value[key], min, max)) throw new OperationError('invalid_action', `Invalid wait setting: ${key}.`);
}

export function validateActions(steps, allowWrite = false) {
  if (!Array.isArray(steps) || !steps.length || steps.length > 20) throw new OperationError('invalid_action', 'Provide 1-20 browser actions.');
  for (const step of steps) {
    if (!step || !Object.hasOwn(fields, step.action)) throw new OperationError('invalid_action', 'Unsupported browser action.');
    if (Object.keys(step).some(key => key !== 'action' && !fields[step.action].includes(key))) throw new OperationError('invalid_action', `Unknown field for ${step.action}.`);
    if (writes.includes(step.action) && !allowWrite) throw new OperationError('authorization_required', 'Click/type/form/submit require --allow-write and explicit user authorization for the target action.');
    validateTarget(step, writes.includes(step.action));
    if (step.action === 'type' && (typeof step.text !== 'string' || step.text.length > 10000)) throw new OperationError('invalid_action', 'Type requires text of at most 10000 characters.');
    if (step.action === 'scroll' && (!['up', 'down', 'left', 'right'].includes(step.direction || 'down') || !integer(step.amount ?? 600, 1, 5000) || step.into_view !== undefined && typeof step.into_view !== 'boolean' || step.into_view && !step.selector && !step.target || step.block !== undefined && !['start', 'center', 'end', 'nearest'].includes(step.block))) throw new OperationError('invalid_action', 'Invalid scroll direction, amount or target.');
    if (step.action === 'read' && step.max_chars !== undefined && !integer(step.max_chars, 1, 50000)) throw new OperationError('invalid_action', 'Invalid read character bound.');
    if (step.action === 'wait' && !integer(step.ms, 1, 30000)) throw new OperationError('invalid_action', 'Wait requires ms from 1 to 30000.');
    if (step.action === 'wait_for') validateCondition(Object.fromEntries(Object.entries(step).filter(([key]) => key !== 'action')));
    if (step.expect !== undefined) validateCondition(step.expect);
    if (step.submitter !== undefined && !text(step.submitter)) throw new OperationError('invalid_action', 'Invalid submitter selector.');
    for (const key of ['comments', 'full_page']) if (step[key] !== undefined && typeof step[key] !== 'boolean') throw new OperationError('invalid_action', `Invalid ${key}.`);
    if (step.action === 'form') {
      if (!Array.isArray(step.fields) || !step.fields.length || step.fields.length > 20) throw new OperationError('invalid_action', 'Form requires 1-20 fields.');
      for (const field of step.fields) {
        if (!field || Object.keys(field).some(key => !['selector', 'target', 'value', 'checked'].includes(key))) throw new OperationError('invalid_action', 'Invalid form field.');
        validateTarget(field, true);
        if (field.value !== undefined ? typeof field.value !== 'string' || field.value.length > 10000 || field.checked !== undefined : typeof field.checked !== 'boolean') throw new OperationError('invalid_action', 'A form field needs one string value or boolean checked.');
      }
    }
  }
  return steps;
}

const targetSchema = { type: 'object', properties: { role: { enum: targetRoles }, name: { type: 'string', minLength: 1, maxLength: 1000 }, exact: { type: 'boolean' } }, required: ['role'], additionalProperties: false };
const properties = {
  selector: { type: 'string', minLength: 1, maxLength: 1000 }, target: targetSchema,
  text: { type: 'string', maxLength: 10000 }, text_equals: { type: 'string', maxLength: 10000 }, value: { type: 'string', maxLength: 10000 }, url: { type: 'string', format: 'uri' },
  direction: { enum: ['up', 'down', 'left', 'right'] }, amount: { type: 'integer', minimum: 1, maximum: 5000 },
  ms: { type: 'integer', minimum: 1, maximum: 30000 }, max_chars: { type: 'integer', minimum: 1, maximum: 50000 },
  timeout_ms: { type: 'integer', minimum: 1, maximum: 30000 }, interval_ms: { type: 'integer', minimum: 1, maximum: 5000 }, stable: { enum: [1, 2, 3] },
  condition: { enum: ['visible', 'hidden', 'text', 'value', 'url'] }, block: { enum: ['start', 'center', 'end', 'nearest'] },
  into_view: { type: 'boolean' }, comments: { type: 'boolean' }, full_page: { type: 'boolean' }, submitter: { type: 'string', minLength: 1, maxLength: 1000 },
};
properties.expect = { type: 'object', properties: Object.fromEntries(fields.wait_for.map(key => [key, properties[key]])), additionalProperties: false };
properties.fields = { type: 'array', minItems: 1, maxItems: 20, items: { type: 'object', properties: { selector: properties.selector, target: targetSchema, value: properties.value, checked: { type: 'boolean' } }, additionalProperties: false, allOf: [{ oneOf: [{ required: ['selector'] }, { required: ['target'] }] }, { oneOf: [{ required: ['value'] }, { required: ['checked'] }] }] } };
const conditionRules = [
  { if: { required: ['url'] }, then: { not: { anyOf: ['selector', 'target', 'text', 'text_equals', 'value'].map(key => ({ required: [key] })) }, properties: { condition: { const: 'url' } } }, else: { oneOf: [{ required: ['selector'] }, { required: ['target'] }] } },
  ...[['text', { anyOf: [{ required: ['text'] }, { required: ['text_equals'] }] }], ['value', { required: ['value'] }], ['url', { required: ['url'] }]].map(([condition, then]) => ({ if: { required: ['condition'], properties: { condition: { const: condition } } }, then })),
];
properties.expect.allOf = conditionRules;
export const ACTION_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'LuzCrawl browser actions v1', type: 'array', minItems: 1, maxItems: 20,
  items: { oneOf: Object.entries(fields).map(([action, keys]) => ({ type: 'object', required: ['action', ...(action === 'type' ? ['text'] : action === 'form' ? ['fields'] : action === 'wait' ? ['ms'] : [])], properties: { action: { const: action }, ...Object.fromEntries(keys.map(key => [key, properties[key]])) }, additionalProperties: false, ...(action === 'wait_for' ? { allOf: conditionRules } : writes.includes(action) ? { oneOf: [{ required: ['selector'] }, { required: ['target'] }] } : {}) })) },
};

export async function executeActions(page, options) {
  const steps = validateActions(options.steps, options.allowWrite ?? options['allow-write']);
  const url = validateURL(options.url).href;
  const planHash = hash(JSON.stringify(steps)); const cursor = options.action_cursor ?? 0;
  if (!integer(cursor, 0, steps.length) || options.plan_sha256 && options.plan_sha256 !== planHash) throw new OperationError('plan_changed', 'The resumed action plan differs from its saved hash.');
  const operations = await createBrowserOperations(page, options);
  const results = [];
  const response = (status, stopReason, index, extra = {}) => ({ schema_version: 1, api_version: API_VERSION, version: VERSION, status, stop_reason: stopReason, url: sourceURL(url), attempted: results.length, completed_before: cursor, next_action_index: index, plan_sha256: planHash, results, execution: operations.summary(), ...extra });
  try { if (!options.current_page) await operations.navigate(url); }
  catch (error) { const failure = classifyFailure(error); return response(['rate_limited', 'login_required', 'verification_required'].includes(failure.code) ? 'blocked' : 'failed', failure.code, cursor, { error: failure.toJSON() }); }
  if (options.pending_verification) {
    const pending = options.pending_verification;
    let verified = false;
    if (pending.expect) {
      try { verified = (await operations.waitFor(pending.expect)).satisfied; } catch { /* Never replay a write with an unknown outcome. */ }
    }
    if (!verified) return response('failed', 'write_outcome_unknown', cursor, { pending_verification: pending, error: new OperationError('write_outcome_unknown', 'Inspect the previous write result manually before starting a new action plan.', { outcome_unknown: true }).toJSON() });
  }
  for (let index = cursor; index < steps.length; index++) {
    const step = steps[index]; const before = operations.policy.operations;
    let value;
    try {
      if (step.action === 'wait') { await operations.wait(step.ms); value = { waited_ms: step.ms }; }
      else if (step.action === 'wait_for') {
        value = await operations.waitFor(Object.fromEntries(Object.entries(step).filter(([key]) => key !== 'action')));
        if (!value.satisfied) throw new OperationError(value.gate || 'condition_timeout', value.gate ? 'The page needs user intervention or cooldown.' : 'Expected page condition was not observed before timeout.');
      } else if (step.action === 'extract') value = await operations.extract(step);
      else if (step.action === 'screenshot') {
        const file = path.resolve(options.out || DEFAULT_OUTPUT, 'raw/browser-actions', `${randomUUID()}.png`);
        await fs.mkdir(path.dirname(file), { recursive: true }); await operations.screenshot(file, Boolean(step.full_page)); value = { file };
      } else value = await operations.dom(step);
      if (value?.gate) throw new OperationError(value.gate, 'Page gate observed.');
      if (step.expect) {
        const expected = await operations.waitFor(step.expect);
        if (!expected.satisfied) throw new OperationError(expected.gate || 'condition_timeout', 'The action was dispatched once, but its expected effect was not observed.', { outcome_unknown: writes.includes(step.action) });
        value = { ...value, effect_verified: true, ...(value?.result ? { result: { ...value.result, effect_verified: true } } : {}) };
      }
      results.push({ index, action: step.action, status: 'done', operations: operations.policy.operations - before, value });
    } catch (error) {
      const failure = classifyFailure(error, { idempotent: !writes.includes(step.action) && step.action !== 'scroll' });
      if (failure.outcome_unknown && step.expect && ['transient_failure', 'write_outcome_unknown'].includes(failure.code)) {
        try {
          const expected = await operations.waitFor(step.expect);
          if (expected.satisfied) { results.push({ index, action: step.action, status: 'done', operations: operations.policy.operations - before, value: { effect_verified: true, completed_without_replay: true } }); continue; }
        } catch { /* Keep the original unknown write outcome. */ }
      }
      results.push({ index, action: step.action, status: 'failed', operations: operations.policy.operations - before, ...(value !== undefined ? { value } : {}), error: failure.message, failure: failure.toJSON() });
      if (failure.code === 'rate_limited') await operations.policy.noteFailure(operations.url, failure);
      const requiresUser = ['login_required', 'verification_required'].includes(failure.code);
      const pending = failure.outcome_unknown ? { index, action: step.action, expect: step.expect } : undefined;
      return response(requiresUser || failure.code === 'rate_limited' ? 'blocked' : 'failed', failure.code, failure.outcome_unknown ? index + 1 : index, { requires_user: requiresUser, handover_url: sourceURL(operations.url), pending_verification: pending, error: failure.toJSON() });
    }
  }
  return response('completed', 'browser_actions_complete', steps.length);
}

export async function readActions(options) {
  if ((options.steps !== undefined) === Boolean(options.file)) throw new OperationError('invalid_action', 'Provide exactly one --steps JSON or --file actions.json.');
  const steps = options.steps !== undefined ? typeof options.steps === 'string' ? JSON.parse(options.steps) : options.steps : JSON.parse(await fs.readFile(path.resolve(options.file), 'utf8'));
  return validateActions(steps, options.allowWrite ?? options['allow-write']);
}

export async function browserActions(page, options, operations) {
  return executeActions(page, { ...options, steps: await readActions(options), ...(operations ? { operations } : {}) });
}
