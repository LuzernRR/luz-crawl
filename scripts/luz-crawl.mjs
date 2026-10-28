#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { doctor, resolveOpenCLI } from '../opencli/lib/doctor.mjs';
import { atomicWrite, createTaskArchive, findExperience, findTaskArchive, verifyArchive } from '../opencli/lib/archive.mjs';
import { validateURL } from '../opencli/lib/platforms.mjs';
import { preferences, rememberPreferences, rememberSite, sites, pendingTasks, loadTask } from '../opencli/lib/memory.mjs';
import { readActions, ACTION_SCHEMA } from '../opencli/lib/browser-actions.mjs';
import { syncBrowserPreferences } from '../opencli/lib/browser-preferences.mjs';
import { collect, refreshCollection } from '../opencli/lib/collect.mjs';
import { accessPolicy } from '../opencli/lib/execution.mjs';
import { classifyFailure } from '../opencli/lib/failure.mjs';
import { VERSION, API_VERSION } from '../opencli/lib/version.mjs';
import { withHeadlessSession } from '../opencli/lib/headless.mjs';
import { readBatch } from '../opencli/lib/batch.mjs';
import { writeCrawlSummary } from '../opencli/lib/crawl-summary.mjs';

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
  node scripts/luz-crawl.mjs begin "task or request name" [--out OUTPUT_ROOT] [--new]
  node scripts/luz-crawl.mjs capture URL --out DIRECTORY
  node scripts/luz-crawl.mjs headless-login [TASK_ID or URL]
  node scripts/luz-crawl.mjs install
  node scripts/luz-crawl.mjs collect "topic or URL" [--platform xhs,github,bing] [--read 1] [--out DIRECTORY]
  node scripts/luz-crawl.mjs report COLLECTION_DIRECTORY
  node scripts/luz-crawl.mjs summary TASK_DIRECTORY
  node scripts/luz-crawl.mjs capture URL --out DIRECTORY [--scrolls 20] [--comments] [--resume]
  node scripts/luz-crawl.mjs batch --file links.md --out DIRECTORY [--concurrency 3] [--resume]
  node scripts/luz-crawl.mjs search x "query" --out DIRECTORY [--read 5]
  node scripts/luz-crawl.mjs experience --query "keyword" [--platform x]
  node scripts/luz-crawl.mjs sites [--category analytics]
  node scripts/luz-crawl.mjs remember --out DIRECTORY --format html [--keywords "word1,word2"]
  node scripts/luz-crawl.mjs remember --browser edge --profile PROFILE_ID [--no-reuse-profile]
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
Browser commands reuse the saved connected profile by default. Use --profile ID to override it; doctor reports browser preference separately from site login state.
Default output: ${(await preferences()).output_dir}; --out overrides it. Each conversation uses one NNN_topic/ folder with raw/ and one same-name final HTML. Pass the returned folder to every operation. Separate projects use separate output roots or an explicitly saved task folder; other threads never guess from a global active task.
Browser Bridge must be connected. See references/install.md for browser installation prompts.`;

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { headless: { type: 'boolean' }, out: { type: 'string' }, new: { type: 'boolean' }, scrolls: { type: 'string' }, concurrency: { type: 'string' }, comments: { type: 'boolean' }, download: { type: 'boolean' }, 'allow-write': { type: 'boolean' }, resume: { type: 'boolean' }, file: { type: 'string' }, steps: { type: 'string' }, query: { type: 'string' }, platform: { type: 'string' }, read: { type: 'string' }, site: { type: 'string' }, profile: { type: 'string' }, browser: { type: 'string' }, 'reuse-profile': { type: 'boolean' }, window: { type: 'string' }, format: { type: 'string' }, name: { type: 'string' }, template: { type: 'string' }, keywords: { type: 'string' }, category: { type: 'string' }, help: { type: 'boolean' } } });
  const [command, ...args] = positionals;
  if (values.help || !command) { console.log(usage); return; }
  if (command === 'batch') await readBatch(values);
  if (command === 'browser') {
    validateURL(args[0]);
    if (values.file === '-') { if (values.steps !== undefined) throw new Error('Use only --steps or --file.'); let input = ''; for await (const chunk of process.stdin) { input += chunk; if (input.length > 5 * 1024 * 1024) throw new Error('Action input exceeds 5 MiB.'); } values.steps = input; values.file = undefined; }
    values.steps = JSON.stringify(await readActions(values)); values.file = undefined;
  }
  if (command === 'headless-login') {
    const task = args[0] && /^[a-f0-9-]{36}$/.test(args[0]) ? await loadTask(args[0]) : null;
    const url = validateURL(task?.url || args[0] || 'https://x.com/i/flow/login').href;
    const result = await withHeadlessSession(async (_, context) => {
      const page = context.pages()[0] || await context.newPage();
      await page.goto(url, { waitUntil: 'commit' });
      console.error(`请在独立 ${(process.env.LUZ_HEADLESS_BROWSER || 'edge') === 'edge' ? 'Edge' : 'Chromium'} 窗口完成 ${new URL(url).hostname} 的登录或验证，然后关闭该窗口。无需向 Agent 发送密码。`);
      await page.waitForEvent('close', { timeout: 600000 });
      return { status: 'profile_saved', login_verified: false, url, next_action: task ? `Run continue ${task.id} to verify and resume the saved task silently.` : `Capture ${url} to verify the saved login silently.` };
    }, { headed: true });
    print(result); return;
  }
  if (!values.headless && ['capture','batch','search','browser','collect','download','continue'].includes(command)) {
    const saved = await preferences();
    if (saved.reuse_browser_profile !== false) values.profile ||= saved.browser_profile;
  }
  if (values.headless || !values.profile && ['capture','batch','search','browser','collect','download','continue'].includes(command)) {
    if (values.profile) throw new Error('--headless uses its own persistent profile; omit --profile.');
    return withHeadlessSession(profile => execute({ ...values, headless: false, profile, window: 'background' }, positionals));
  }
  return execute(values, positionals);
}

async function execute(values, positionals) {
  const [command, ...args] = positionals;
  if (command === 'schema') { print({ version: VERSION, api_version: API_VERSION, actions: ACTION_SCHEMA }); return; }
  if (command === 'policy') { print(await accessPolicy(values.file ? JSON.parse(await fs.readFile(path.resolve(values.file), 'utf8')) : undefined)); return; }
  const defaults = await preferences();
  if (defaults.reuse_browser_profile !== false) values.profile ||= defaults.browser_profile;
  if (command === 'begin') {
    if (!args[0]) throw new Error('A task or request name is required.');
    const output = values.out || (await syncBrowserPreferences(values.profile)).output_dir;
    const folder = (await findTaskArchive(output))?.folder || await createTaskArchive(output, args[0], { newTask: values.new });
    const report = await writeCrawlSummary(folder);
    print({ folder, title: args[0], html_file: report.html_file, status: 'ready' }); return;
  }
  if (command === 'doctor') { const result = await doctor({ profile: values.profile }); if (values.out) { const folder = (await findTaskArchive(values.out))?.folder || await createTaskArchive(values.out, 'doctor'); await atomicWrite(path.join(folder, 'raw/doctor.json'), result); await writeCrawlSummary(folder); } print(result); process.exitCode = result.ready ? 0 : 2; return; }
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
  if (command === 'download') {
    if (!args[0]) throw new Error('Archive directory is required.');
    const native = ['luz-crawl','download',path.resolve(args[0]),'-f','json'];
    if (values.profile) native.unshift('--profile',values.profile);
    console.log(await opencli(native)); return;
  }
  if (command === 'report') { if (!args[0]) throw new Error('Collection directory is required.'); print(await refreshCollection(args[0])); return; }
  if (command === 'summary') { if (!args[0]) throw new Error('Task directory is required.'); print(await writeCrawlSummary(args[0])); return; }
  if (!['capture', 'batch', 'search', 'browser', 'collect'].includes(command)) throw new Error(`Unknown command: ${command}`);
  const current = await syncBrowserPreferences(values.profile);
  values.out ||= current.output_dir;
  values.window ||= 'background';
  let batchURLs;
  if (command === 'batch') {
    batchURLs = (await readBatch(values)).map(job => job.url);
  }
  if (command === 'capture' || command === 'browser') validateURL(args[0]);
  if (command === 'search' && (!args[0] || !args[1])) throw new Error('Search requires platform and query.');
  if (command === 'collect' && !args[0] && !values.file) throw new Error('Provide a topic, URL or --file.');
  const archiveTitle = command === 'search' ? `${args[0]}_${args[1]}` : command === 'batch' ? `batch_${path.basename(values.file)}` : command === 'collect' ? `collect_${args[0] || values.name || path.basename(values.file || 'links')}` : `${command}_${args[0] || 'run'}`;
  const archiveFolder = (await findTaskArchive(values.out))?.folder || await createTaskArchive(values.out, archiveTitle);
  const health = await doctor({ profile: values.profile });
  if (!health.ready && !(['profile_selection_required', 'profile_disconnected'].includes(health.state) && values.profile)) {
    await atomicWrite(path.join(archiveFolder, 'raw/preflight.json'), { command, status: 'blocked', browser_opened: false, requested: batchURLs?.length ?? (command === 'capture' ? 1 : undefined), sources: batchURLs, attempted: 0, health });
    const report = await writeCrawlSummary(archiveFolder);
    print({...health,folder:archiveFolder,html_file:report.html_file}); process.exitCode = 2; return;
  }
  await atomicWrite(path.join(archiveFolder, 'raw/preflight.json'), { command, status: 'ready_to_attempt', requested: batchURLs?.length, health });
  if (command === 'collect') {
    const result=await collect(args[0] || values.name || path.basename(values.file),{...values,out:archiveFolder});
    print(result); if(!['captured','completed'].includes(result.status)) process.exitCode=2;
  } else if (command === 'capture') {
    const output = await opencli(captureArgs(args[0], { ...values, out: archiveFolder }));
    console.log(output);
    const result = JSON.parse(output);
    if (['blocked', 'failed'].includes(result.status)) process.exitCode = 2;
  } else if (command === 'browser') {
    const native = ['luz-crawl', 'browser', args[0], '--steps', values.steps, '--out', archiveFolder, '--window', values.window, '-f', 'json'];
    if (values.profile) native.unshift('--profile', values.profile);
    if (values['allow-write']) native.push('--allow-write');
    const output = await opencli(native); console.log(output);
    if (JSON.parse(output).status !== 'completed') process.exitCode = 2;
  } else if (command === 'search') {
    const native = ['luz-crawl', 'search', args[0], args[1], '--out', archiveFolder, '--scrolls', values.scrolls || '12', '--read', values.read || '0', '-f', 'json'];
    if (values.profile) native.unshift('--profile', values.profile);
    for (const key of ['site', 'window']) if (values[key]) native.push(`--${key}`, values[key]);
    for (const key of ['resume', 'comments', 'download']) if (values[key]) native.push(`--${key}`);
    const output = await opencli(native); console.log(output);
    if (['blocked', 'failed'].includes(JSON.parse(output).status)) process.exitCode = 2;
  } else {
    const native = ['luz-crawl', 'batch', '--file', path.resolve(values.file), '--out', archiveFolder, '--concurrency', values.concurrency || '3', '--scrolls', values.scrolls || '20', '-f', 'json'];
    if (values.profile) native.unshift('--profile', values.profile);
    for (const key of ['resume', 'comments', 'download', 'allow-write']) if (values[key]) native.push(`--${key}`);
    const output = await opencli(native); console.log(output);
    if (JSON.parse(output).status !== 'completed') process.exitCode = 2;
  }
}

main().catch((error) => { const failure = classifyFailure(error); print({ status: 'failed', error: failure.message, failure: failure.toJSON() }); process.exitCode = 1; });
