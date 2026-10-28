import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { capture } from './lib/capture.mjs';
import { search } from './lib/search.mjs';
import { withBrowser, cancelTask } from './lib/browser-session.mjs';
import { doctor, resolveOpenCLI, profileFromArgs } from './lib/doctor.mjs';
import { syncBrowserPreferences } from './lib/browser-preferences.mjs';
import { preferences, pendingTasks, sites, loadTask } from './lib/memory.mjs';
import { downloadArchive } from './lib/download.mjs';
import { browserActions, readActions, ACTION_SCHEMA } from './lib/browser-actions.mjs';
import { collect, refreshCollection } from './lib/collect.mjs';
import { accessPolicy } from './lib/execution.mjs';
import fs from 'node:fs/promises';
import { VERSION, API_VERSION } from './lib/version.mjs';
import { retryVisibleIfIncomplete, withHeadlessSession, withVisibleFallbackOnHeadlessStartFailure } from './lib/headless.mjs';
import { classifyFailure } from './lib/failure.mjs';
import { createTaskArchive, findTaskArchive } from './lib/archive.mjs';
import { batch, readBatch } from './lib/batch.mjs';

const runtime = await resolveOpenCLI();
if (!runtime) throw new Error('The LuzCrawl host runtime could not be resolved.');
const registry = createRequire(path.join(runtime.root, 'package.json')).resolve('@jackwener/opencli/registry');
const { cli, Strategy } = await import(pathToFileURL(registry).href);
const defaults = await preferences();
const commonArgs = [
  { name: 'headless', type: 'boolean', default: true, help: 'Use Microsoft Edge silently by default; an explicit connected --profile selects that browser' },
  { name: 'out', type: 'string', default: defaults.output_dir, help: 'Output root or an existing LuzCrawl task folder; evidence goes under raw/' },
  { name: 'window', type: 'string', default: 'background', help: 'Inactive task tab in the selected browser; foreground is explicit' },
  { name: 'scrolls', type: 'int', default: 20, help: 'Maximum scroll rounds; exhausted budget means partial coverage' },
  { name: 'comments', type: 'boolean', default: false, help: 'Collect loaded comments and replies' },
  { name: 'download', type: 'boolean', default: false, help: 'Download observed post media through the browser before closing its page' },
  { name: 'resume', type: 'boolean', default: false, help: 'Verify and continue an existing archive' },
  { name: 'screenshot', type: 'boolean', default: true, help: 'Save a browser screenshot as evidence' },
];
const local = { site: 'luz-crawl', access: 'read', strategy: Strategy.LOCAL, browser: false, defaultFormat: 'json' };
const operate = async (page, options, kind, operations) => {
  if (kind !== 'download') return kind === 'search' ? search(page, options, operations) : kind === 'browser' ? browserActions(page, options, operations) : capture(page, options, operations);
  try { return await downloadArchive(options.directory, { ...options, page, operations, executionPolicy: operations.policy }); }
  catch (error) { const failure = classifyFailure(error); return {status:'failed',stop_reason:failure.code,error:failure.message}; }
};
async function run(kind, options) {
  if (kind === 'browser') { const steps = await readActions(options); options = { ...options, steps, file: undefined }; }
  if (process.env.LUZ_VISIBLE_FALLBACK === '1') options = { ...options, _luz_visible_fallback: true };
  if (!process.env.LUZ_HEADLESS_PROFILE && options.__opencliOptionSources?.headless !== 'cli') options = { ...options, profile: profileFromArgs(options.profile || defaults.browser_profile) };
  if (options.headless && !process.env.LUZ_HEADLESS_PROFILE && (!options.profile || options.__opencliOptionSources?.headless === 'cli')) return headless(options, values => run(kind, values));
  if (!options.task && options.__opencliOptionSources?.out !== 'cli') {
    const saved = await syncBrowserPreferences(profileFromArgs(options.profile || defaults.browser_profile));
    options = { ...options, out: saved.output_dir };
  }
  if (!options.task && kind !== 'download' && !(kind === 'capture' && options.resume)) {
    const out = (await findTaskArchive(options.out))?.folder || await createTaskArchive(options.out, options.query || options.url || kind);
    options = { ...options, out };
  }
  const { _luz_visible_fallback, ...browserOptions } = options;
  const sessionOptions = _luz_visible_fallback ? { ...browserOptions, _luz_visible_fallback: true } : browserOptions;
  const result = await withBrowser(kind, sessionOptions, (page, values, taskKind, operations) => operate(page, values, taskKind, operations));
  if (!_luz_visible_fallback && !options.park_on_block && ['capture', 'search', 'download'].includes(kind)) return retryVisibleIfIncomplete(values => run(kind, values), browserOptions, result);
  return result;
}

async function headless(options, operation) {
  if (profileFromArgs()) throw new Error('--headless uses its own persistent profile; omit --profile.');
  return withVisibleFallbackOnHeadlessStartFailure(options, operation);
}

async function runCollect(options) {
  if (process.env.LUZ_VISIBLE_FALLBACK === '1') options = { ...options, _luz_visible_fallback: true };
  if (!process.env.LUZ_HEADLESS_PROFILE && options.__opencliOptionSources?.headless !== 'cli') options = { ...options, profile: profileFromArgs(options.profile || defaults.browser_profile) };
  if (options.headless && !process.env.LUZ_HEADLESS_PROFILE && (!options.profile || options.__opencliOptionSources?.headless === 'cli')) return headless(options, runCollect);
  if (options.__opencliOptionSources?.out !== 'cli') options.out = (await syncBrowserPreferences(profileFromArgs(options.profile || defaults.browser_profile))).output_dir;
  options.out = (await findTaskArchive(options.out))?.folder || await createTaskArchive(options.out, options.input);
  return collect(options.input, options);
}

async function runBatch(options) {
  await readBatch(options);
  options = { ...options, profile: profileFromArgs(options.profile || defaults.browser_profile) };
  if (options.headless && !process.env.LUZ_HEADLESS_PROFILE && (!options.profile || options.__opencliOptionSources?.headless === 'cli')) return headless(options, runBatch);
  if (options.__opencliOptionSources?.out !== 'cli') options.out = (await syncBrowserPreferences(options.profile)).output_dir;
  options.out = (await findTaskArchive(options.out))?.folder || await createTaskArchive(options.out, 'batch');
  options.__opencliOptionSources = { ...options.__opencliOptionSources, out: 'cli' };
  return batch(options, run);
}

cli({ ...local, name: 'doctor', description: 'Scan LuzCrawl plugin and browser connection', args: [], func: doctor });
cli({ ...local, name: 'sites', description: 'List bundled and remembered websites', args: [], func: sites });
cli({ ...local, name: 'pending', description: 'List browser tasks awaiting manual login or verification', args: [], func: pendingTasks });
cli({ ...local, name: 'schema', description: 'Machine-readable browser action schema', args: [], func: () => ({ version: VERSION, api_version: API_VERSION, actions: ACTION_SCHEMA }) });
cli({ ...local, name: 'policy', description: 'View or save bounded platform pacing and retry settings', args: [{ name: 'file', type: 'string' }], func: async options => accessPolicy(options.file ? JSON.parse(await fs.readFile(options.file, 'utf8')) : undefined) });
cli({ ...local, name: 'collect', description: 'Plan browser searches and save all captured text and media in one HTML', args: [{name:'input',positional:true,required:true,type:'string'},{name:'platform',type:'string',help:'Comma-separated sites, or all verified sites'},{name:'file',type:'string',help:'Agent JSON search plan or links file'},{name:'read',type:'int',default:1},...commonArgs.map(arg=>['comments','download'].includes(arg.name)?{...arg,default:true}:arg)], func: runCollect });
cli({ ...local, name: 'report', description: 'Refresh a saved collection after continuing its manual login tasks', args: [{name:'directory',positional:true,required:true,type:'string'}], func: options=>refreshCollection(options.directory) });
cli({ ...local, name: 'capture', description: 'Capture through Browser Bridge; retain the owned page when login needs the user', args: [{ name: 'url', positional: true, required: true, type: 'string' }, ...commonArgs], func: (options) => run('capture', options) });
cli({ ...local, access: 'write', name: 'batch', description: 'Read multiple owned pages concurrently; queue each site and park login tasks', args: [{ name: 'file', type: 'string', required: true }, { name: 'concurrency', type: 'int', default: 3 }, { name: 'allow-write', type: 'boolean', default: false }, ...commonArgs], func: runBatch });
cli({ ...local, name: 'search', description: 'Always search in a real browser, learn routes and read source pages', args: [{ name: 'platform', positional: true, required: true, type: 'string' }, { name: 'query', positional: true, required: true, type: 'string' }, { name: 'site', type: 'string', help: 'Domain for a public browser search' }, { name: 'read', type: 'int', default: 0, help: 'Number of source details to open (0-20)' }, ...commonArgs], func: (options) => run('search', options) });
cli({ ...local, name: 'continue', description: 'Resume the same owned browser task after manual login', args: [{ name: 'task', positional: true, required: true, type: 'string' }, {name:'headless',type:'boolean',default:true}], func: (options) => run('capture', options) });
cli({ ...local, name: 'cancel', description: 'Cancel a pending task and close only its owned tab', args: [{ name: 'task', positional: true, required: true, type: 'string' }], func: (options) => cancelTask(options.task) });
cli({ ...local, name: 'download', description: 'Reopen the source silently and download its observed media through the browser', args: [{ name: 'directory', positional: true, required: true, type: 'string' }, ...commonArgs.filter(arg=>['headless','window'].includes(arg.name))], func: async options => {
  const directory = path.resolve(options.directory);
  const content = JSON.parse(await fs.readFile(path.join(directory,'raw/content.json'),'utf8'));
  return run('download', {...options,directory,url:content.resolved_url || content.requested_url,out:path.dirname(path.dirname(directory))});
} });
cli({ ...local, access: 'write', name: 'browser', description: 'Run bounded browser actions on an owned page; writes need explicit authorization', args: [{ name: 'url', positional: true, required: true, type: 'string' }, { name: 'file', type: 'string' }, { name: 'steps', type: 'string', help: 'JSON action array; use this or --file' }, { name: 'allow-write', type: 'boolean', default: false }, ...commonArgs], func: (options) => run('browser', options) });
