import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWrite, DEFAULT_OUTPUT, stateRoot, findExperience } from './archive.mjs';
import { CATALOG, validateURL, sourceURL } from './platforms.mjs';

async function readJSON(name, fallback) {
  try { return JSON.parse(await fs.readFile(path.join(stateRoot(), name), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

export async function preferences() {
  return { output_dir: DEFAULT_OUTPUT, format: 'html', naming: '{seq}_{title}', window: 'foreground', close_after_use: true, browser: 'edge', reuse_browser_profile: true, ...await readJSON('preferences.json', {}) };
}

export async function rememberPreferences(values) {
  const next = await preferences();
  if (values.out) {
    next.output_dir = path.resolve(values.out);
    next.output_updated_at = values.output_updated_at ?? Date.now();
    if (!Number.isSafeInteger(next.output_updated_at) || next.output_updated_at < 0) throw new Error('保存时间无效。');
  }
  if (values.format && values.format !== 'html') throw new Error('Current export contract is HTML; supported format: html.');
  if (values.format) next.format = values.format;
  if (values.window && !['foreground', 'background'].includes(values.window)) throw new Error('Window must be foreground or background.');
  if (values.window) next.window = values.window;
  if (values.profile) next.browser_profile = values.profile.trim();
  if (values.browser) {
    const browser = values.browser.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{0,31}$/.test(browser)) throw new Error('Browser must be a short browser name such as edge or chrome.');
    next.browser = browser;
  }
  const reuseProfile = values['reuse-profile'] ?? values.reuse_profile;
  if (reuseProfile !== undefined) {
    if (typeof reuseProfile !== 'boolean') throw new Error('--reuse-profile must be a boolean.');
    next.reuse_browser_profile = reuseProfile;
  }
  if (values.keywords) next.keywords = [...new Set([...(next.keywords || []), ...values.keywords.split(/[,，\n]/).map((x) => x.trim()).filter(Boolean)])];
  if (values.platform) next.preferred_platforms = values.platform.split(/[,，]/).map((value) => value.trim()).filter(Boolean);
  await atomicWrite(path.join(stateRoot(), 'preferences.json'), next);
  return next;
}

export async function sites() {
  const custom = await readJSON('sites.json', []);
  return [...new Map([...CATALOG, ...custom].map((site) => [site.id, site])).values()];
}

export async function rememberSite(values) {
  const url = validateURL(values.site);
  const domain = url.hostname;
  const id = values.name || domain;
  if (!/^[a-z0-9][a-z0-9._-]{0,100}$/i.test(id)) throw new Error('Site ID must contain letters, digits, dot, dash or underscore.');
  let search;
  if (values.template) {
    if (!values.template.includes('{query}')) throw new Error('Search template must contain {query}.');
    const target = validateURL(values.template.replaceAll('{query}', 'test'));
    if (target.hostname !== domain && !target.hostname.endsWith(`.${domain}`)) throw new Error('Search template must stay on the registered site.');
    search = values.template;
  }
  const records = await readJSON('sites.json', []);
  const prior = records.find((item) => item.id === id) || CATALOG.find((item) => item.id === id);
  const value = { ...prior, id, name: prior?.name || id, category: prior?.category || 'custom', domains: [...new Set([...(prior?.domains || []), domain])], url: sourceURL(url.href), ...(search ? { search, mode: undefined } : !prior?.search ? { mode: 'form' } : {}), public_index: prior?.public_index ?? false, learned_at: new Date().toISOString() };
  await atomicWrite(path.join(stateRoot(), 'sites.json'), [...records.filter((item) => item.id !== id), value]);
  return value;
}

export async function resolveSite(platform, query, domain) {
  const all = await sites();
  let site = all.find((item) => item.id.toLowerCase() === platform.toLowerCase() || item.aliases?.some((alias) => alias.toLowerCase() === platform.toLowerCase()));
  if (!site) {
    if (!platform.includes('.') && !platform.includes('://')) throw new Error(`Unknown platform: ${platform}. Run sites or register a hostname with remember.`);
    const url = validateURL(platform.includes('://') ? platform : `https://${platform}`);
    site = await rememberSite({ site: url.href });
  }
  if (domain) {
    const url = validateURL(domain.includes('://') ? domain : `https://${domain}`);
    await rememberSite({ site: url.origin });
    site = { ...site, index_domain: url.hostname, external_results: false, domains: [url.hostname] };
  }
  const history = await findExperience('', site.id);
  const remembered = history.events.find((item) => item.search_performed && item.valid_content && item.candidates > 0 && ['captured', 'partial'].includes(item.status));
  return { ...site, query: domain ? `site:${site.index_domain} ${query}` : query, preferred_route: remembered?.route_kind, source_corrections: history.events.filter((event) => event.route_kind === 'source_url_correction' && event.validated_url), suggested_queries: history.keywords || [], preferred_keywords: (await preferences()).keywords || [] };
}

export function pendingFile(id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid task ID.');
  return path.join(stateRoot(), 'pending', `${id}.json`);
}

export async function pendingTasks() {
  const result = [];
  for (const name of await fs.readdir(path.join(stateRoot(), 'pending')).catch((error) => { if (error.code === 'ENOENT') return []; throw error; })) {
    if (!name.endsWith('.json')) continue;
    result.push(JSON.parse(await fs.readFile(path.join(stateRoot(), 'pending', name), 'utf8')));
  }
  return result;
}

export async function loadTask(id) {
  return JSON.parse(await fs.readFile(pendingFile(id), 'utf8'));
}
