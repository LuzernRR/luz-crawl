import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateURL, sourceURL } from './platforms.mjs';

export function validateActions(steps, allowWrite = false) {
  if (!Array.isArray(steps) || !steps.length || steps.length > 20) throw new Error('Provide 1-20 browser actions.');
  for (const step of steps) {
    if (!step || !['read', 'click', 'type', 'scroll', 'screenshot'].includes(step.action)) throw new Error('Unsupported browser action.');
    if (['click', 'type'].includes(step.action) && !allowWrite) throw new Error('Click/type require --allow-write and explicit user authorization for the target action.');
    if (['click', 'type'].includes(step.action) && (!step.selector || typeof step.selector !== 'string')) throw new Error('Click/type require a CSS selector.');
    if (step.selector !== undefined && (typeof step.selector !== 'string' || step.selector.length > 1000)) throw new Error('Invalid CSS selector.');
    if (step.action === 'type' && (typeof step.text !== 'string' || step.text.length > 10000)) throw new Error('Type requires text of at most 10000 characters.');
    if (step.action === 'scroll' && ((!['up', 'down', 'left', 'right'].includes(step.direction || 'down')) || !Number.isInteger(step.amount ?? 600) || (step.amount ?? 600) < 1 || (step.amount ?? 600) > 5000)) throw new Error('Invalid scroll direction or amount.');
  }
  return steps;
}

export async function browserActions(page, options) {
  const steps = validateActions(JSON.parse(await fs.readFile(path.resolve(options.file), 'utf8')), options['allow-write']);
  const url = validateURL(options.url).href;
  await page.goto(url);
  const results = [];
  for (const [index, step] of steps.entries()) {
    try {
      let value;
      if (step.action === 'read') value = await page.evaluate(`(() => { const node = document.querySelector(${JSON.stringify(step.selector || 'body')}); if (!node) throw new Error('Read selector was not found.'); return {url: location.href, title: document.title, text: (node.innerText || node.textContent || '').slice(0, 30000)}; })()`);
      if (step.action === 'click' || step.action === 'type') {
        // shortcut: DOM click dispatches once; trusted pointer gestures need a separately verified adapter.
        const target = await page.evaluate(`(() => { const nodes = [...document.querySelectorAll(${JSON.stringify(step.selector)})].filter(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden'); if (nodes.length !== 1) throw new Error('Action selector must match exactly one visible element.'); const node = nodes[0]; if (node.type === 'password') throw new Error('Password inputs require manual login.'); if (node.disabled || node.getAttribute('aria-disabled') === 'true') throw new Error('Action target is disabled.'); if (node.tagName === 'A') node.target = '_self'; const target = {tag: node.tagName, label: node.getAttribute('aria-label') || node.innerText || ''}; ${step.action === 'click' ? "if (typeof node.click !== 'function') throw new Error('Target does not support DOM click.'); node.click();" : ''} return target; })()`);
        value = step.action === 'click' ? { click_method: 'dom', event_dispatched: true, effect_verified: false } : await page.fillText(step.selector, step.text);
        value = { target, result: value };
      }
      if (step.action === 'scroll') { await page.scroll(step.direction || 'down', step.amount ?? 600); value = { direction: step.direction || 'down', amount: step.amount ?? 600 }; }
      if (step.action === 'screenshot') { const file = path.resolve(options.out, 'raw/browser-actions', `${randomUUID()}.png`); await fs.mkdir(path.dirname(file), { recursive: true }); await page.screenshot({ path: file, fullPage: false }); value = { file }; }
      results.push({ index, action: step.action, status: 'done', value });
    } catch (error) {
      results.push({ index, action: step.action, status: 'failed', error: error.message });
      return { status: 'failed', stop_reason: 'browser_action_failed', url: sourceURL(url), attempted: results.length, results };
    }
  }
  return { status: 'completed', stop_reason: 'browser_actions_complete', url: sourceURL(url), attempted: results.length, results };
}
