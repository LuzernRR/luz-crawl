import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { canonicalURL, extractURLs } from './platforms.mjs';

export const hash = (value) => createHash('sha256').update(value).digest('hex');
export const DEFAULT_OUTPUT = path.resolve('outputs', 'luz-crawl');
export const stateRoot = () => process.env.LUZ_CRAWL_STATE || fileURLToPath(new URL('../memory/', import.meta.url));

export async function atomicWrite(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, typeof value === 'string' || Buffer.isBuffer(value) ? value : `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
    await fs.rename(temp, file);
  } finally { await fs.rm(temp, { force: true }); }
}

export function mergeItems(previous, incoming) {
  const records = new Map(previous.map((item) => [item.id || hash(item.url || item.text), item]));
  for (const item of incoming) {
    const id = item.id || hash(item.url || item.text);
    const old = records.get(id);
    if (!old || (item.text || '').length >= (old.text || '').length) records.set(id, { ...old, ...item, id });
  }
  return [...records.values()];
}

export function safeTitle(value) {
  return [...String(value || '').normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, 64).join('').replace(/[. ]+$/, '') || '未命名网页';
}

async function allocationLock(base, action) {
  await fs.mkdir(base, { recursive: true });
  const lock = path.join(base, '.archive-allocation.lock');
  await fs.writeFile(lock, String(process.pid), { flag: 'wx' });
  try { return await action(); } finally { await fs.rm(lock); }
}

export async function allocateRun(out, url, resume = false) {
  const output = path.resolve(out);
  const base = path.join(output, 'raw');
  const identity = canonicalURL(url);
  return allocationLock(base, async () => {
    let folder, previous = null, serial = 0, highest = 0;
    for (const directory of [base, output]) for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      highest = Math.max(highest, Number(entry.name.match(/^(\d+)_/)?.[1] || 0));
      if (!entry.isDirectory()) continue;
      const candidate = path.join(directory, entry.name);
      let record;
      for (const name of ['manifest.json', 'identity.json']) {
        try { record = JSON.parse(await fs.readFile(path.join(candidate, 'raw', name), 'utf8')); break; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      if (record?.canonical_url && canonicalURL(record.canonical_url) === identity) {
        if (folder) throw new Error('Duplicate URL archives found; resolve duplicates before resuming.');
        folder = candidate; previous = record.files ? record : null;
        serial = Number(entry.name.match(/^(\d+)_/)?.[1] || 0);
      }
    }
    if (folder && !resume) throw new Error(`Archive already exists: ${folder}. Use --resume to continue without overwriting it.`);
    serial ||= highest + 1;
    const previousFolder = folder;
    if (folder && path.dirname(folder) === output) {
      await fs.access(path.join(folder, '.capture.lock')).then(() => { throw new Error(`Archive is locked: ${folder}. Check the recorded process before removing a stale lock.`); }, (error) => { if (error.code !== 'ENOENT') throw error; });
      if (previous) {
        const integrity = await verifyArchive(folder);
        if (!integrity.ok) throw new Error(`Cannot resume a modified/incomplete archive: ${integrity.failures.join(', ')}`);
      }
      const target = path.join(base, path.basename(folder));
      await fs.access(target).then(() => { throw new Error(`Refusing to replace existing archive: ${target}`); }, (error) => { if (error.code !== 'ENOENT') throw error; });
      await fs.rename(folder, target);
      folder = target;
    }
    folder ||= path.join(base, `${String(serial).padStart(3, '0')}_未命名网页`);
    await fs.mkdir(path.join(folder, 'raw', 'snapshots'), { recursive: true });
    await fs.writeFile(path.join(folder, '.capture.lock'), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), { flag: 'wx' }).catch((error) => { throw new Error(`Archive is locked: ${folder} (${error.code}). Check the recorded process before removing a stale lock.`); });
    await atomicWrite(path.join(folder, 'raw', 'identity.json'), { canonical_url: identity, serial });
    const run = { output, base, folder, previousFolder, serial, previous, release: () => fs.rm(path.join(run.folder, '.capture.lock')) };
    return run;
  });
}

export async function nameRun(run, title) {
  const stem = `${String(run.serial).padStart(3, '0')}_${safeTitle(title)}`;
  const target = path.join(run.base, stem);
  if (path.dirname(run.folder) !== run.base || path.dirname(target) !== run.base) throw new Error('Archive rename escapes the output root.');
  const delivery = path.join(run.output, `${stem}.html`);
  try {
    const expected = run.previous?.files.find((item) => item.path === `${stem}.html`)?.sha256;
    if (hash(await fs.readFile(delivery)) !== expected) throw new Error(`Refusing to replace existing HTML: ${delivery}`);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (target !== run.folder) await allocationLock(run.base, async () => {
    await fs.access(target).then(() => { throw new Error(`Refusing to replace existing archive: ${target}`); }, (error) => { if (error.code !== 'ENOENT') throw error; });
    try { await fs.rename(run.folder, target); run.folder = target; }
    catch (error) {
      if (!['EPERM', 'EBUSY'].includes(error.code)) throw error;
      run.rename_warning = 'raw 证据目录改名受阻，保留原名称；交付 HTML 仍按序号和原标题命名';
    }
  });
  return `${stem}.html`;
}

export async function verifyArchive(folder) {
  const root = path.resolve(folder);
  const realRoot = await fs.realpath(root);
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'raw', 'manifest.json'), 'utf8'));
  const failures = [];
  for (const entry of manifest.files || []) {
    const target = path.resolve(root, entry.path);
    if (!target.startsWith(root + path.sep)) throw new Error('Manifest path escapes archive.');
    try {
      if (!(await fs.realpath(target)).startsWith(realRoot + path.sep)) throw new Error('Manifest file resolves outside archive.');
      if (hash(await fs.readFile(target)) !== entry.sha256) failures.push(entry.path);
    } catch { failures.push(entry.path); }
  }
  if (manifest.output_layout === 'html_and_raw_v1') {
    if (path.basename(path.dirname(root)) !== 'raw' || !manifest.primary_file?.endsWith('.html') || path.basename(manifest.primary_file) !== manifest.primary_file) throw new Error('Invalid HTML delivery path in manifest.');
    const delivery = path.join(path.dirname(path.dirname(root)), manifest.primary_file);
    const expected = manifest.files.find((entry) => entry.path === manifest.primary_file)?.sha256;
    try { if (hash(await fs.readFile(delivery)) !== expected) failures.push(`delivery:${manifest.primary_file}`); }
    catch { failures.push(`delivery:${manifest.primary_file}`); }
  }
  if (!(manifest.files?.length)) failures.push('manifest.files is empty');
  return { ok: failures.length === 0, failures, status: manifest.status, completeness: manifest.completeness };
}

export async function recordReference(run, result) {
  await allocationLock(run.base, async () => {
    const file = path.join(run.output, '参考链接.md');
    let previous = '';
    try { previous = await fs.readFile(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const title = result.title.replace(/[\[\]\\]/g, '\\$&').replace(/[\r\n]+/g, ' ');
    const entry = `- [${title}](<${result.primary_file}>) — ${result.requested_url}`;
    let found = false;
    const lines = previous.trimEnd().split('\n').filter(Boolean).flatMap((line) => {
      if (!extractURLs(line).some((url) => canonicalURL(url) === result.canonical_url)) return [line];
      if (found) return [];
      found = true; return [entry];
    });
    if (!found) lines.push(entry);
    await atomicWrite(file, lines.join('\n') + '\n');
  });
}

export async function recordExperience(event) {
  const identity = { platform: event.platform, url: event.canonical_url, query: event.query || '', outcome: event.status, reason: event.stop_reason, extractor_version: event.extractor_version || 'legacy' };
  const id = hash(JSON.stringify(identity)).slice(0, 24);
  const file = path.join(stateRoot(), 'events', `${id}.json`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.writeFile(file, `${JSON.stringify({ id, at: new Date().toISOString(), ...event }, null, 2)}\n`, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const previous = JSON.parse(await fs.readFile(file, 'utf8'));
    await atomicWrite(file, { ...previous, ...event, id, at: new Date().toISOString(), observations: (previous.observations || 1) + 1 });
  }
  return id;
}

export function matchesQuery(value, query) {
  return query.toLowerCase().trim().split(/\s+/).filter(Boolean).every((term) => {
    const text = value.toLowerCase();
    return /^[a-z\d_-]+$/i.test(term) ? new RegExp(`(^|[^a-z0-9_])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9_])`, 'i').test(text) : text.includes(term);
  });
}

export async function findExperience(query = '', platform) {
  const root = stateRoot();
  const records = [];
  const keywords = new Map();
  for (const entry of await fs.readdir(path.join(root, 'events')).catch(() => [])) {
    if (!entry.endsWith('.json')) continue;
    const value = JSON.parse(await fs.readFile(path.join(root, 'events', entry), 'utf8'));
    if (!platform || value.platform === platform) {
      if (value.query && matchesQuery(value.query, query)) {
        const old = keywords.get(value.query) || { query: value.query, observations: 0, readable: 0, last_seen: '' };
        old.observations += value.observations || 1;
        if (value.status === 'captured' || value.candidates > 0) old.readable += value.observations || 1;
        old.last_seen = old.last_seen > value.at ? old.last_seen : value.at;
        keywords.set(value.query, old);
      }
      if (matchesQuery(JSON.stringify(value), query)) records.push(value);
    }
  }
  const legacy = [];
  for (const name of ['search-keywords.md', 'search-skill-library.md', 'knowledge-index.md']) {
    const file = path.join(root, 'legacy', name);
    const lines = (await fs.readFile(file, 'utf8').catch(() => '')).split('\n');
    if (query) for (let index = lines.length - 1; index >= 0 && legacy.length < 12; index--) {
      if (matchesQuery(lines[index], query)) legacy.push({ file, line: index + 1, text: lines[index], current_verification_required: true });
    }
  }
  const seeds = JSON.parse(await fs.readFile(new URL('../experience/seeds.json', import.meta.url), 'utf8'));
  return { route_hints: seeds.routes.filter((item) => !platform || item.platform === platform), events: records.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20), keywords: [...keywords.values()].sort((a, b) => b.readable - a.readable || b.last_seen.localeCompare(a.last_seen)).slice(0, 20), legacy, state_root: root, note: 'Saved experience orders browser routes and suggests keywords; every search still opens a real browser and verifies the current page.' };
}
