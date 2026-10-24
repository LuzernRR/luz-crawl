#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { doctor, resolveOpenCLI } from '../opencli/lib/doctor.mjs';
import { DEFAULT_OUTPUT, atomicWrite, findExperience, verifyArchive } from '../opencli/lib/archive.mjs';
import { extractURLs, validateURL } from '../opencli/lib/platforms.mjs';
import { preferences, rememberPreferences, rememberSite, sites, pendingTasks, loadTask } from '../opencli/lib/memory.mjs';
import { downloadArchive } from '../opencli/lib/download.mjs';
import { readActions, ACTION_SCHEMA } from '../opencli/lib/browser-actions.mjs';
import { syncBrowserPreferences } from '../opencli/lib/browser-preferences.mjs';
import { collect, refreshCollection } from '../opencli/lib/collect.mjs';
import { accessPolicy } from '../opencli/lib/execution.mjs';
import { classifyFailure } from '../opencli/lib/failure.mjs';
import { VERSION, API_VERSION } from '../opencli/lib/version.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const print = (value) => console.log(JSON.stringify(value, null, 2));

async function opencli(args, inherit = false) {
  const runtime = await resolveOpenCLI();
  if (!runtime) throw new Error('LuzCrawl runtime dependency is missing. Install npm install -g @jackwener/opencli@1.8.8; see references/install.md.');
  if (!runtime.compatible) throw new Error(`Untested LuzCrawl runtime ${runtime.version}; see references/install.md for isolated runtime installation.`);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runtime.main, ...args], { shell: false, windowsHide: true, stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1', CONTINUOUS_INTEGRATION: '1', OPENCLI_BROWSER_COMMAND_TIMEOUT: process.env.OPENCLI_BROWSER_COMMAND_TIMEOUT || '300' } });
    let output = '';
    if (!inherit) { child.stdout.setEncoding('utf8'); child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => process.stderr.write(chunk)); }
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(output) : reject(new Error(`LuzCrawl runtime exited ${code}: ${output.trim()}`)));
  });
}

function captureArgs(url, options) {
  const args = ['luz-crawl', 'capture', url, '--out', path.resolve(options.out), '--scrolls', String(options.scrolls ?? 20), '-f', 'json'];
  if (options.comments) args.push('--comments');
  if (options.download) args.push('--download');
  if (options.resume) args.push('--resume');
  if (options.profile) args.unshift('--profile', options.profile);
  if (options.window) args.push('--window', options.window);
  return args;
}

const usage = `LuzCrawl ${VERSION} — skill, browser extension and local memory
  node scripts/luz-crawl.mjs doctor
  node scripts/luz-crawl.mjs install
  node scripts/luz-crawl.mjs collect "topic or URL" [--platform xhs,github,bing] [--read 1] [--out DIRECTORY]
  node scripts/luz-crawl.mjs report COLLECTION_DIRECTORY
  node scripts/luz-crawl.mjs capture URL --out DIRECTORY [--scrolls 20] [--comments] [--resume]
  node scripts/luz-crawl.mjs batch --file links.md --out DIRECTORY [--resume]
  node scripts/luz-crawl.mjs search x "query" --out DIRECTORY [--read 5]
  node scripts/luz-crawl.mjs experience --query "keyword" [--platform x]
  node scripts/luz-crawl.mjs sites [--category analytics]
  node scripts/luz-crawl.mjs remember --out DIRECTORY --format html [--keywords "word1,word2"]
  node scripts/luz-crawl.mjs remember --site https://example.com --name example --template "https://example.com/search?q={query}"
  node scripts/luz-crawl.mjs pending
  node scripts/luz-crawl.mjs continue TASK_ID
  node scripts/luz-crawl.mjs cancel TASK_ID
  node scripts/luz-crawl.mjs verify DIRECTORY
  node scripts/luz-crawl.mjs download ARCHIVE_DIRECTORY
  node scripts/luz-crawl.mjs browser URL --file actions.json [--allow-write]
  node scripts/luz-crawl.mjs browser URL --steps JSON [--allow-write]
  node scripts/luz-crawl.mjs schema
  node scripts/luz-crawl.mjs policy [--file policy.json]
Use --profile ALIAS to select a connected LuzCrawl browser profile; --window background is optional.
Default output: ${DEFAULT_OUTPUT}; --out overrides it. HTML and 参考链接.md are public; evidence stays in raw/.
Browser Bridge must be connected. See references/install.md for browser installation prompts.`;

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: 'string' }, scrolls: { type: 'string' }, comments: { type: 'boolean' }, download: { type: 'boolean' }, 'allow-write': { type: 'boolean' }, resume: { type: 'boolean' }, file: { type: 'string' }, steps: { type: 'string' }, query: { type: 'string' }, platform: { type: 'string' }, read: { type: 'string' }, site: { type: 'string' }, profile: { type: 'string' }, window: { type: 'string' }, format: { type: 'string' }, name: { type: 'string' }, template: { type: 'string' }, keywords: { type: 'string' }, category: { type: 'string' }, help: { type: 'boolean' } } });
  const [command, ...args] = positionals;
  if (values.help || !command) { console.log(usage); return; }
  if (command === 'schema') { print({ version: VERSION, api_version: API_VERSION, actions: ACTION_SCHEMA }); return; }
  if (command === 'policy') { print(await accessPolicy(values.file ? JSON.parse(await fs.readFile(path.resolve(values.file), 'utf8')) : undefined)); return; }
  if (command === 'browser') {
    validateURL(args[0]);
    if (values.file === '-') { if (values.steps !== undefined) throw new Error('Use only --steps or --file.'); let input = ''; for await (const chunk of process.stdin) { input += chunk; if (input.length > 5 * 1024 * 1024) throw new Error('Action input exceeds 5 MiB.'); } values.steps = input; values.file = undefined; }
    values.steps = JSON.stringify(await readActions(values)); values.file = undefined;
  }
  const defaults = await preferences();
  values.profile ||= defaults.browser_profile;
  if (command === 'doctor') { const result = await doctor({ profile: values.profile }); if (values.out) await atomicWrite(path.resolve(values.out, 'raw', 'doctor.json'), result); print(result); process.exitCode = result.ready ? 0 : 2; return; }
  if (command === 'install') {
    const installed = (await doctor()).native_plugin;
    console.log(await opencli(installed ? ['plugin', 'update', 'luz-crawl'] : ['plugin', 'install', path.join(root, 'opencli')]));
    const result = await doctor(); print(result); process.exitCode = result.ready ? 0 : 2; return;
  }
  if (command === 'experience') { print(await findExperience(values.query || '', values.platform)); return; }
  if (command === 'sites') { print((await sites()).filter((item) => !values.category || item.category === values.category)); return; }
  if (command === 'pending') { print(await pendingTasks()); return; }
  if (command === 'remember') {
    const saved = values.site ? await rememberSite(values) : await rememberPreferences(values);
    print(values.out && !values.site ? await syncBrowserPreferences(values.profile) : saved); return;
  }
  if (command === 'continue' || command === 'cancel') {
    if (!args[0]) throw new Error('A pending task ID is required.');
    await loadTask(args[0]);
    const native = ['luz-crawl', command, args[0], '-f', 'json'];
    if (values.profile) native.unshift('--profile', values.profile);
    console.log(await opencli(native)); return;
  }
  if (command === 'verify') { if (!args[0]) throw new Error('Archive directory is required.'); const result = await verifyArchive(args[0]); print(result); process.exitCode = result.ok ? 0 : 2; return; }
  if (command === 'download') { if (!args[0]) throw new Error('Archive directory is required.'); const result = await downloadArchive(args[0], { profile: values.profile }); print(result); process.exitCode = result.status === 'partial' ? 2 : 0; return; }
  if (command === 'report') { if (!args[0]) throw new Error('Collection directory is required.'); print(await refreshCollection(args[0])); return; }
  if (!['capture', 'batch', 'search', 'browser', 'collect'].includes(command)) throw new Error(`Unknown command: ${command}`);
  const current = await syncBrowserPreferences(values.profile);
  values.out ||= current.output_dir;
  values.window ||= defaults.window;
  let batchURLs;
  if (command === 'batch') {
    if (!values.file) throw new Error('--file is required.');
    batchURLs = extractURLs(await fs.readFile(path.resolve(values.file), 'utf8'));
    if (!batchURLs.length) throw new Error('No HTTP(S) URLs found in input file.');
  }
  const health = await doctor({ profile: values.profile });
  if (!health.ready && !(['profile_selection_required', 'profile_disconnected'].includes(health.state) && values.profile)) {
    await atomicWrite(path.resolve(values.out, 'raw', 'preflight.json'), { command, status: 'blocked', browser_opened: false, requested: batchURLs?.length ?? (command === 'capture' ? 1 : undefined), sources: batchURLs, attempted: 0, health });
    print(health); process.exitCode = 2; return;
  }
  await atomicWrite(path.resolve(values.out, 'raw', 'preflight.json'), { command, status: 'ready_to_attempt', requested: batchURLs?.length, health });
  if (command === 'collect') {
    if(!args[0] && !values.file) throw new Error('Provide a topic, URL or --file.');
    const result=await collect(args[0] || values.name || path.basename(values.file),values);
    print(result); if(!['captured','completed'].includes(result.status)) process.exitCode=2;
  } else if (command === 'capture') {
    validateURL(args[0]);
    const output = await opencli(captureArgs(args[0], values));
    console.log(output);
    const result = JSON.parse(output);
    if (['blocked', 'failed'].includes(result.status)) process.exitCode = 2;
  } else if (command === 'browser') {
    const native = ['luz-crawl', 'browser', args[0], '--steps', values.steps, '--out', path.resolve(values.out), '--window', values.window, '-f', 'json'];
    if (values.profile) native.unshift('--profile', values.profile);
    if (values['allow-write']) native.push('--allow-write');
    const output = await opencli(native); console.log(output);
    if (JSON.parse(output).status !== 'completed') process.exitCode = 2;
  } else if (command === 'search') {
    if (!args[0] || !args[1]) throw new Error('Search requires platform and query.');
    const native = ['luz-crawl', 'search', args[0], args[1], '--out', path.resolve(values.out), '--scrolls', values.scrolls || '12', '--read', values.read || '0', '-f', 'json'];
    if (values.profile) native.unshift('--profile', values.profile);
    for (const key of ['site', 'window']) if (values[key]) native.push(`--${key}`, values[key]);
    for (const key of ['resume', 'comments', 'download']) if (values[key]) native.push(`--${key}`);
    const output = await opencli(native); console.log(output);
    if (['blocked', 'failed'].includes(JSON.parse(output).status)) process.exitCode = 2;
  } else {
    const urls = batchURLs;
    const indexFile = path.resolve(values.out, 'raw', 'batch.json');
    const records = [];
    for (const url of urls) {
      try { records.push({ url, ...JSON.parse(await opencli(captureArgs(url, values))) }); }
      catch (error) { records.push({ url, status: 'failed', error: error.message }); }
      await atomicWrite(indexFile, { requested: urls.length, attempted: records.length, captured: records.filter((item) => item.status === 'captured').length, partial: records.filter((item) => item.status === 'partial').length, blocked_or_failed: records.filter((item) => ['blocked', 'failed'].includes(item.status)).length, results: records });
      if (['login_required', 'verification_required', 'rate_limited'].includes(records.at(-1).stop_reason)) break;
    }
    print({ batch_file: indexFile, requested: urls.length, attempted: records.length, results: records });
    if (records.some((item) => ['blocked', 'failed'].includes(item.status)) || records.length < urls.length) process.exitCode = 2;
  }
}

main().catch((error) => { const failure = classifyFailure(error); print({ status: 'failed', error: failure.message, failure: failure.toJSON() }); process.exitCode = 1; });
