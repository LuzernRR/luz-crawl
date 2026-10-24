import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { capture } from './lib/capture.mjs';
import { search } from './lib/search.mjs';
import { withBrowser, cancelTask } from './lib/browser-session.mjs';
import { doctor, resolveOpenCLI } from './lib/doctor.mjs';
import { preferences, pendingTasks, sites, loadTask } from './lib/memory.mjs';
import { downloadArchive, downloadResult } from './lib/download.mjs';
import { browserActions } from './lib/browser-actions.mjs';

const runtime = await resolveOpenCLI();
if (!runtime) throw new Error('The LuzCrawl host runtime could not be resolved.');
const registry = createRequire(path.join(runtime.root, 'package.json')).resolve('@jackwener/opencli/registry');
const { cli, Strategy } = await import(pathToFileURL(registry).href);
const defaults = await preferences();
const commonArgs = [
  { name: 'out', type: 'string', default: defaults.output_dir, help: 'HTML output root; evidence goes in raw/' },
  { name: 'window', type: 'string', default: defaults.window, help: 'Real browser window: foreground or background' },
  { name: 'scrolls', type: 'int', default: 20, help: 'Maximum scroll rounds; exhausted budget means partial coverage' },
  { name: 'comments', type: 'boolean', default: false, help: 'Collect loaded comments and replies' },
  { name: 'download', type: 'boolean', default: false, help: 'Download observed post media after closing the browser' },
  { name: 'resume', type: 'boolean', default: false, help: 'Verify and continue an existing archive' },
  { name: 'screenshot', type: 'boolean', default: true, help: 'Save a browser screenshot as evidence' },
];
const local = { site: 'luz-crawl', access: 'read', strategy: Strategy.LOCAL, browser: false, defaultFormat: 'json' };
const operate = (page, options, kind) => kind === 'search' ? search(page, options) : kind === 'browser' ? browserActions(page, options) : capture(page, options);
async function run(kind, options) {
  const download = options.download || options.task && (await loadTask(options.task)).options.download;
  const result = await withBrowser(kind, options, operate);
  if (download && result.browser?.closed) await downloadResult(result);
  return result;
}

cli({ ...local, name: 'doctor', description: 'Scan LuzCrawl plugin and browser connection', args: [], func: doctor });
cli({ ...local, name: 'sites', description: 'List bundled and remembered websites', args: [], func: sites });
cli({ ...local, name: 'pending', description: 'List browser tasks awaiting manual login or verification', args: [], func: pendingTasks });
cli({ ...local, name: 'capture', description: 'Capture through Browser Bridge; retain the owned page when login needs the user', args: [{ name: 'url', positional: true, required: true, type: 'string' }, ...commonArgs], func: (options) => run('capture', options) });
cli({ ...local, name: 'search', description: 'Always search in a real browser, learn routes and read source pages', args: [{ name: 'platform', positional: true, required: true, type: 'string' }, { name: 'query', positional: true, required: true, type: 'string' }, { name: 'site', type: 'string', help: 'Domain for a public browser search' }, { name: 'read', type: 'int', default: 0, help: 'Number of source details to open (0-20)' }, ...commonArgs], func: (options) => run('search', options) });
cli({ ...local, name: 'continue', description: 'Resume the same owned browser task after manual login', args: [{ name: 'task', positional: true, required: true, type: 'string' }], func: (options) => run('capture', options) });
cli({ ...local, name: 'cancel', description: 'Cancel a pending task and close only its owned tab', args: [{ name: 'task', positional: true, required: true, type: 'string' }], func: (options) => cancelTask(options.task) });
cli({ ...local, name: 'download', description: 'Download browser-verified post media from an existing archive', args: [{ name: 'directory', positional: true, required: true, type: 'string' }], func: (options) => downloadArchive(options.directory) });
cli({ ...local, access: 'write', name: 'browser', description: 'Run bounded browser actions on an owned page; click/type need explicit authorization', args: [{ name: 'url', positional: true, required: true, type: 'string' }, { name: 'file', type: 'string', required: true }, { name: 'allow-write', type: 'boolean', default: false }, ...commonArgs], func: (options) => run('browser', options) });
