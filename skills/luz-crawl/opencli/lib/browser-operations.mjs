import { validateURL, sourceURL, platformOf } from './platforms.mjs';
import { createExecutionPolicy } from './execution.mjs';
import { OperationError } from './failure.mjs';
import { extractPage, scrollPage } from './extract-page.mjs';

// Serialized into the page; check every selector and form field before writing.
export function domOperation(step) {
  const visible = node => Boolean(node?.getClientRects().length && getComputedStyle(node).visibility !== 'hidden' && getComputedStyle(node).display !== 'none');
  const label = node => node.getAttribute('aria-label') || (node.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ').trim() || [...(node.labels || [])].map(item => item.innerText).join(' ') || node.innerText || node.placeholder || node.title || '';
  const role = node => node.getAttribute('role') || ({ BUTTON: 'button', A: 'link', TEXTAREA: 'textbox', SELECT: 'combobox', FORM: 'form', ARTICLE: 'article', DIALOG: 'dialog' }[node.tagName]) || (/^H[1-6]$/.test(node.tagName) ? 'heading' : node.tagName === 'INPUT' ? /checkbox|radio/.test(node.type) ? node.type : /button|submit/.test(node.type) ? 'button' : 'textbox' : '');
  const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
  const selectorFor = node => {
    const candidates = [node.id && '#' + CSS.escape(node.id), ...['data-testid', 'name', 'aria-label'].map(key => node.getAttribute(key) && `${node.tagName.toLowerCase()}[${key}=${JSON.stringify(node.getAttribute(key))}]`)];
    const parts = [];
    for (let item = node; item && parts.length < 5; item = item.parentElement) {
      parts.unshift(item.id ? '#' + CSS.escape(item.id) : `${item.tagName.toLowerCase()}:nth-of-type(${[...(item.parentElement?.children || [item])].filter(peer => peer.tagName === item.tagName).indexOf(item) + 1})`);
      if (item.id) break;
    }
    candidates.push(parts.join(' > '));
    return candidates.find(candidate => candidate && document.querySelectorAll(candidate).length === 1) || null;
  };
  const describe = node => {
    const rect = node.getBoundingClientRect();
    return { tag: node.tagName, role: role(node), label: label(node).trim().slice(0, 300), type: node.type || undefined, selector: selectorFor(node), disabled: Boolean(node.disabled || node.getAttribute('aria-disabled') === 'true'), requires_user: node.type === 'password' || node.autocomplete === 'one-time-code', rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, document_x: rect.x + window.scrollX, document_y: rect.y + window.scrollY }, in_view: rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth };
  };
  const resolve = (target, unique = true) => {
    let nodes;
    try {
      nodes = target.selector ? [...document.querySelectorAll(target.selector)] : [...document.querySelectorAll('button,a[href],input,textarea,select,form,h1,h2,h3,h4,h5,h6,article,dialog,[role]')].filter(node => (!target.target?.role || role(node) === target.target.role) && (!target.target?.name || (target.target.exact === false ? label(node).includes(target.target.name) : label(node).trim() === target.target.name)));
    } catch { fail('invalid_selector', 'Invalid CSS selector.'); }
    nodes = nodes.filter(visible);
    if (unique && nodes.length !== 1) fail(nodes.length ? 'selector_ambiguous' : 'target_not_found', 'Action selector must match exactly one visible element.');
    return unique ? nodes[0] : nodes;
  };
  const writable = node => {
    if (node.type === 'password' || node.autocomplete === 'one-time-code' || node.closest('form')?.querySelector('input[type="password"],input[autocomplete="one-time-code"]')) fail('login_required', 'Password and verification forms require manual login.');
    if (node.disabled || node.readOnly || node.getAttribute('aria-disabled') === 'true') fail('target_disabled', 'Action target is disabled or read-only.');
    return node;
  };
  const fieldPlan = (field, root) => {
    const node = writable(resolve(field));
    if (root && !root.contains(node)) fail('invalid_form', 'A field is outside the declared form container.');
    if (field.checked !== undefined && !['checkbox', 'radio'].includes(node.type)) fail('invalid_form', 'Checked requires a checkbox or radio input.');
    if (field.value !== undefined && !['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName) && !node.isContentEditable) fail('invalid_form', 'The field does not support text or selection.');
    if (node.tagName === 'SELECT' && ![...node.options].some(option => option.value === field.value && !option.disabled)) fail('invalid_form', 'The requested select option is unavailable.');
    return { node, field };
  };
  const fill = ({ node, field }) => {
    if (field.checked !== undefined) Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked').set.call(node, field.checked);
    else if (node.isContentEditable) node.textContent = field.value;
    else Object.getOwnPropertyDescriptor(({ INPUT: HTMLInputElement, TEXTAREA: HTMLTextAreaElement, SELECT: HTMLSelectElement })[node.tagName].prototype, 'value').set.call(node, field.value);
    node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true }));
    return { target: describe(node), filled: true };
  };
  const body = (document.body?.innerText || '').slice(0, 2000);
  const gate = /^(?:429|too many requests|访问过于频繁|操作过于频繁)/i.test(document.title) || (body.length < 1500 && /^(?:too many requests|访问过于频繁|操作过于频繁)/i.test(body.trim())) ? 'rate_limited' : /^(?:安全验证|安全检查|验证中心|Just a moment|Human verification|Verify you are human)/i.test(document.title) || [...document.querySelectorAll('iframe[src*="captcha"],iframe[src*="challenge"],#challenge-running,.geetest_panel')].some(visible) ? 'verification_required' : /^(?:登录|登入|Sign in|Log in)(?:\s|$|[-|])/i.test(document.title) && [...document.querySelectorAll('input[type="password"]')].some(visible) ? 'login_required' : null;
  try {
    if (gate && !['read', 'locate', 'wait_for'].includes(step.action)) fail(gate, 'The page requires a cooldown or manual verification.');
    let value;
    if (step.action === 'read') {
      const node = resolve({ ...step, selector: step.selector || (step.target ? undefined : 'body') });
      const controls = [...node.querySelectorAll('button,a[href],input,textarea,select,[role="button"]')].filter(visible);
      value = { text: (node.innerText || node.textContent || '').slice(0, step.max_chars || 30000), controls: controls.slice(0, 40).map(describe), controls_total: controls.length, target: describe(node) };
    } else if (step.action === 'locate') {
      const nodes = resolve(step, false); value = { matches: nodes.length, targets: nodes.slice(0, 20).map(describe), viewport: { width: window.innerWidth, height: window.innerHeight, scroll_x: window.scrollX, scroll_y: window.scrollY } };
    } else if (step.action === 'wait_for') {
      const nodes = step.url ? [] : resolve(step, false); const node = nodes.length === 1 ? nodes[0] : null;
      const condition = step.condition || (step.url ? 'url' : step.value !== undefined ? 'value' : step.text !== undefined || step.text_equals !== undefined ? 'text' : 'visible');
      const text = node ? node.innerText || node.textContent || '' : '';
      if (node?.type === 'password') fail('login_required', 'Password values require manual login.');
      value = { satisfied: condition === 'url' ? location.href === step.url : condition === 'hidden' ? nodes.length === 0 : condition === 'text' ? Boolean(node && (step.text_equals !== undefined ? text.trim() === step.text_equals : text.includes(step.text))) : condition === 'value' ? Boolean(node && node.value === step.value) : Boolean(node), matches: nodes.length, text: text.slice(0, 1000), target: node ? describe(node) : null };
    } else if (step.action === 'click') {
      const node = writable(resolve(step)); node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      const rect = node.getBoundingClientRect(); const hit = document.elementFromPoint(Math.max(0, Math.min(innerWidth - 1, rect.x + rect.width / 2)), Math.max(0, Math.min(innerHeight - 1, rect.y + rect.height / 2)));
      if (!hit || hit !== node && !node.contains(hit)) fail('target_obscured', 'The target is covered; inspect the overlay before clicking.');
      if (typeof node.click !== 'function') fail('invalid_target', 'The target does not support DOM click.');
      if (node.tagName === 'A') node.target = '_self';
      const target = describe(node); node.click(); value = { target, result: { click_method: 'dom', event_dispatched: true, effect_verified: false } };
    } else if (step.action === 'type') {
      const plan = fieldPlan({ ...step, value: step.text }); value = { ...fill(plan), result: { event_dispatched: true, effect_verified: false } };
    } else if (step.action === 'form') {
      const root = writable(resolve(step)); const plans = step.fields.map(field => fieldPlan(field, root));
      if (new Set(plans.map(item => item.node)).size !== plans.length) fail('invalid_form', 'Form fields must identify distinct controls.');
      value = { target: describe(root), fields: plans.map(fill), submitted: false };
    } else if (step.action === 'submit') {
      const form = writable(resolve(step));
      if (form.tagName !== 'FORM' || form.querySelector('input[type="password"]')) fail('invalid_form', 'Submit requires a non-login form.');
      const submitter = step.submitter ? writable(resolve({ selector: step.submitter })) : undefined;
      if (submitter && (submitter.form !== form || !['submit', 'image'].includes(submitter.type))) fail('invalid_form', 'Submitter must belong to the declared form.');
      if (!form.checkValidity()) fail('invalid_form', 'Required form fields are not valid.');
      form.requestSubmit(submitter); value = { target: describe(form), submitted: true, effect_verified: false };
    } else if (step.action === 'scroll') {
      const root = step.selector || step.target ? resolve(step) : document.scrollingElement; const before = { x: root.scrollLeft, y: root.scrollTop };
      if (step.into_view) root.scrollIntoView({ block: step.block || 'center', inline: 'nearest', behavior: 'instant' });
      else { const amount = step.amount || 600; root.scrollBy(['left', 'right'].includes(step.direction) ? amount * (step.direction === 'left' ? -1 : 1) : 0, ['left', 'right'].includes(step.direction) ? 0 : amount * (step.direction === 'up' ? -1 : 1)); }
      value = { before, after: { x: root.scrollLeft, y: root.scrollTop }, target: describe(root), at_bottom: root.scrollTop + root.clientHeight >= root.scrollHeight - 3 };
    }
    return { ok: true, url: location.href, title: document.title, gate, ...value };
  } catch (error) { return { ok: false, url: location.href, title: document.title, error: { code: error.code || 'invalid_target', message: error.message } }; }
}

export class BrowserOperations {
  constructor(page, policy, url) { this.page = page; this.policy = policy; this.url = url ? validateURL(url).href : undefined; this.browserCalls = 0; }
  summary() { return { ...this.policy.summary(), browser_calls: this.browserCalls }; }
  async navigate(value) {
    const url = validateURL(value).href; this.url = url;
    return this.policy.run('navigation', url, () => { this.browserCalls++; return this.page.goto(url); });
  }
  async evaluate(fn, value, { idempotent = true, label = 'page_read' } = {}) {
    const expression = (idempotent ? '' : '/*luzcrawl:once*/') + (typeof fn === 'string' ? fn : `(${fn.toString()})(${JSON.stringify(value)})`);
    return this.policy.run(idempotent ? 'read' : 'interaction', this.url, () => { this.browserCalls++; return this.page.evaluate(expression); }, { idempotent, label });
  }
  async dom(step) {
    const response = await this.evaluate(domOperation, step, { idempotent: ['read', 'locate', 'wait_for'].includes(step.action), label: step.action });
    if (!response || typeof response !== 'object' || typeof response.ok !== 'boolean' || typeof response.url !== 'string') throw new OperationError('invalid_response', 'Invalid browser operation envelope.');
    if (response?.url) this.url = validateURL(response.url).href;
    if (response?.ok === false) throw new OperationError(response.error.code, response.error.message);
    if (response?.gate === 'rate_limited') await this.policy.noteFailure(this.url, new OperationError('rate_limited', 'Page rate limit observed.'));
    const { ok, ...value } = response || {}; return { ...value, ...(value.url ? { url: sourceURL(value.url) } : {}) };
  }
  async waitFor(condition) { return this.policy.waitUntil(this.url, () => this.dom({ ...condition, action: 'wait_for' }), value => value.satisfied, condition); }
  async wait(ms) { return this.policy.run('wait', this.url, () => this.policy.delay(ms), { attempts: 1, label: 'explicit_wait' }); }
  async extract(options = {}) {
    const args = { platform: platformOf(this.url), requestedURL: this.url, comments: false, includePresentation: false, ...options };
    const code = `(() => { const snapshot = (${extractPage.toString()})(${JSON.stringify(args)}); snapshot.scroll = (${scrollPage.toString()})(${JSON.stringify({move:false,comments:Boolean(args.comments),platform:args.platform})}); return snapshot; })()`;
    return this.evaluate(code, undefined, { label: 'extract_and_position' });
  }
  async screenshot(file, fullPage = false, attempts) { return this.policy.run('read', this.url, () => { this.browserCalls++; return this.page.screenshot({ path: file, fullPage }); }, { attempts, label: fullPage ? 'full_page_screenshot' : 'viewport_screenshot' }); }
  async startResponseCapture(filter) { return this.policy.run('read', this.url, () => { this.browserCalls++; return this.page.startNetworkCapture(filter); }, { attempts: 1, label: 'observe_responses' }); }
  async readResponses() { return this.policy.run('read', this.url, () => { this.browserCalls++; return this.page.readNetworkCapture(); }, { label: 'read_observed_responses' }); }
}

export async function createBrowserOperations(page, options = {}) {
  return options.operations || new BrowserOperations(page, await createExecutionPolicy(options), options.url);
}
