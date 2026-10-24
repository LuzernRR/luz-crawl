#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { sites, preferences, pendingTasks } from '../opencli/lib/memory.mjs';
import { doctor } from '../opencli/lib/doctor.mjs';
import { parkTask } from '../opencli/lib/browser-session.mjs';
import { atomicWrite, verifyArchive } from '../opencli/lib/archive.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { values } = parseArgs({ options: { out: { type: 'string' }, platforms: { type: 'string' }, resume: { type: 'boolean' }, profile: { type: 'string' } } });
const defaults = await preferences();
const output = path.resolve(values.out || path.join(defaults.output_dir, 'raw/validation/platforms'));
const file = path.join(output, 'matrix.json');
let matrix = { version: '2.3.0', started_at: new Date().toISOString(), results: [] };
if (values.resume) { try { matrix = JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
const selected = values.platforms?.split(',');
const catalog = (await sites()).filter((site) => !selected || selected.includes(site.id));
if (selected && catalog.length !== selected.length) throw new Error('Unknown platform in --platforms; run sites.');
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts/luz-crawl.mjs'), ...args], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    child.on('error', reject);
    child.on('close', (code) => { try { resolve({ code, result: JSON.parse(stdout), stderr }); } catch { reject(new Error(`CLI exit ${code}: ${stdout}\n${stderr}`)); } });
  });
}

for (const [index, site] of catalog.entries()) {
  if (values.resume && matrix.results.some((result) => result.platform === site.id)) continue;
  const english = ['x', 'youtube', 'reddit', 'instagram', 'tiktok'].includes(site.id) || site.category === 'search';
  const query = site.category === 'procurement' ? '计算机' : site.category === 'company' ? '腾讯' : ['commerce', 'analytics'].includes(site.category) ? '家具' : site.category === 'creator' ? '内容' : english ? 'OpenAI' : '人工智能';
  const folder = path.join(output, site.id);
  console.log(`[${index + 1}/${catalog.length}] ${site.name}: browser search + one detail`);
  let record;
  try {
    const health = await doctor({ profile: values.profile || defaults.browser_profile });
    const connected = health.daemon?.profiles?.filter((profile) => profile.extensionConnected) || [];
    const profile = values.profile || defaults.browser_profile || (connected.length === 1 ? connected[0].contextId : null);
    if (!profile) throw new Error('Select a connected browser profile with --profile.');
    const args = ['search', site.id, query, '--read', '1', '--scrolls', '6', '--out', folder, '--profile', profile];
    const { result, stderr, code } = await run(args);
    await atomicWrite(path.join(folder, 'raw/cli-result.json'), result);
    await atomicWrite(path.join(folder, 'raw/cli-stderr.txt'), stderr);
    const archives = [...(result.attempts || []).map((attempt) => attempt.folder), ...(result.sources || []).map((source) => source.folder)].filter(Boolean);
    const integrity = await Promise.all([...new Set(archives)].map(verifyArchive));
    record = { platform: site.id, name: site.name, category: site.category, query, checked_at: new Date().toISOString(), status: result.status, cli_exit: code, search_performed: Boolean(result.search_performed), search_status: result.search_status, candidates: result.discovered_candidates || 0, details_opened: result.opened_sources || 0, details_captured: result.verified_sources || 0, details_readable: (result.sources || []).filter((source) => ['captured', 'partial'].includes(source.status) && source.url_check?.valid_content && source.completeness?.target_present && source.completeness.chars > 0 && !['login_required', 'verification_required', 'rate_limited', 'access_denied', 'unavailable', 'target_post_not_found', 'target_body_not_found'].includes(source.stop_reason)).length, sources: (result.sources || []).map((source) => ({ url: source.url, status: source.status, chars: source.completeness?.chars, stop_reason: source.stop_reason, html_file: source.html_file })), attempts: result.attempts, browser: result.browser, lifecycle_ok: Boolean(result.browser?.closed || (result.status === 'awaiting_user' && result.browser?.retained)), evidence_ok: integrity.length > 0 && integrity.every((item) => item.ok), task_id: result.task_id, gate: result.awaiting_reason || result.stop_reason, error: result.error || result.cleanup_error, result_file: path.join(folder, 'raw/cli-result.json') };
  } catch (error) { record = { platform: site.id, name: site.name, category: site.category, query, checked_at: new Date().toISOString(), status: 'failed', error: error.message, evidence_ok: false, lifecycle_ok: false }; }
  matrix.results = [...matrix.results.filter((item) => item.platform !== site.id), record];
  await atomicWrite(file, matrix);
  console.log(`  ${record.status}; candidates=${record.candidates || 0}; readable=${record.details_readable || 0}; tab=${record.browser?.retained ? 'retained_for_user' : record.browser?.closed ? 'closed' : 'unverified'}`);
}
for (const task of await pendingTasks()) {
  if (!task.page || !matrix.results.some((item) => item.task_id === task.id)) continue;
  await parkTask(task);
  const row = matrix.results.find((item) => item.task_id === task.id);
  row.browser = { ...row.browser, retained: false, closed: true, parked: true };
}
matrix.finished_at = new Date().toISOString();
await atomicWrite(file, matrix);
console.log(JSON.stringify({ matrix: file, tested: matrix.results.length, readable: matrix.results.filter((item) => item.details_readable > 0).length, awaiting_user: matrix.results.filter((item) => item.status === 'awaiting_user').length, lifecycle_failures: matrix.results.filter((item) => !item.lifecycle_ok).map((item) => item.platform) }, null, 2));
