import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { preferences } from './memory.mjs';

export function profileFromArgs(fallback) {
  const index = process.argv.indexOf('--profile');
  return (index >= 0 ? process.argv[index + 1] : process.argv.find((value) => value.startsWith('--profile='))?.slice(10)) || fallback;
}

export async function resolveOpenCLI() {
  const candidates = [process.argv[1] && path.resolve(path.dirname(process.argv[1]), '..', '..'), process.env.LUZ_OPENCLI_ROOT, path.join(os.homedir(), '.opencli', 'node_modules', '@jackwener', 'opencli'), ...String(process.env.PATH || '').split(path.delimiter).map((entry) => path.join(entry, 'node_modules', '@jackwener', 'opencli'))].filter(Boolean);
  try { candidates.unshift(path.dirname(createRequire(import.meta.url).resolve('@jackwener/opencli'))); } catch {}
  for (const candidate of [...new Set(candidates)]) {
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(candidate, 'package.json'), 'utf8'));
      if (pkg.name !== '@jackwener/opencli') continue;
      const main = path.join(candidate, typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.opencli);
      await fs.access(main);
      return { root: candidate, main, version: pkg.version, compatible: /^1\.8\.(?:[8-9]|[1-9]\d+)(?:\D|$)/.test(pkg.version) || /^1\.(?:9|[1-9]\d)\./.test(pkg.version) };
    } catch {}
  }
  return null;
}

async function scanExtensions() {
  const local = process.env.LOCALAPPDATA;
  const bases = process.platform === 'win32' && local ? [path.join(local, 'Microsoft', 'Edge', 'User Data'), path.join(local, 'Google', 'Chrome', 'User Data')] : [path.join(os.homedir(), '.config', 'google-chrome'), path.join(os.homedir(), '.config', 'microsoft-edge'), path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome')];
  const records = [];
  for (const base of bases) {
    for (const profile of await fs.readdir(base).catch(() => [])) {
      if (!/^(Default|Profile \d+)$/.test(profile)) continue;
      for (const filename of ['Preferences', 'Secure Preferences']) {
        let settings;
        try { settings = JSON.parse(await fs.readFile(path.join(base, profile, filename), 'utf8')).extensions?.settings || {}; } catch { continue; }
        for (const [id, value] of Object.entries(settings)) {
          if (!/opencli|browser bridge|luz-?crawl/i.test(`${value.path || ''} ${value.manifest?.name || ''}`)) continue;
          const extensionPath = value.path && (path.isAbsolute(value.path) ? value.path : path.join(base, profile, 'Extensions', value.path));
          let manifest;
          try { manifest = JSON.parse(await fs.readFile(path.join(extensionPath, 'manifest.json'), 'utf8')); } catch {}
          records.push({ browser_data: base, profile, id, path: extensionPath, version: manifest?.version, name: manifest?.name, disabled: value.state === 0 || Boolean(value.disable_reasons?.length), disable_reasons: value.disable_reasons || [], source: filename });
        }
      }
    }
  }
  return records;
}

export async function doctor(options = {}) {
  const opencli = await resolveOpenCLI();
  const profile = profileFromArgs(options.profile || (await preferences()).browser_profile);
  let routing = {};
  if (opencli) {
    const { resolveProfileSelection, profileRouteParams } = await import(pathToFileURL(path.join(opencli.root, 'dist/src/browser/profile.js')).href);
    routing = profileRouteParams(resolveProfileSelection(profile));
  }
  let daemon = null;
  try {
    const query = new URLSearchParams(routing).toString();
    const response = await fetch(`http://127.0.0.1:19825/status${query ? `?${query}` : ''}`, { headers: { 'X-OpenCLI': '1' }, signal: AbortSignal.timeout(2500) });
    if (response.ok) daemon = await response.json();
  } catch {}
  const extensions = await scanExtensions();
  const pluginPath = path.join(os.homedir(), '.opencli', 'plugins', 'luz-crawl');
  let plugin = null;
  try { plugin = { ...JSON.parse(await fs.readFile(path.join(pluginPath, 'opencli-plugin.json'), 'utf8')), path: pluginPath }; } catch {}
  const state = !opencli ? 'opencli_missing' : !opencli.compatible ? 'opencli_version_unsupported' : !plugin ? 'native_plugin_missing' : !daemon ? 'daemon_stopped' : daemon.profileRequired ? 'profile_selection_required' : daemon.profileDisconnected ? 'profile_disconnected' : !daemon.extensionConnected ? 'extension_disconnected' : 'ready';
  const hints = {
    opencli_missing: 'Install the tested runtime: npm install -g @jackwener/opencli@1.8.8, then run this skill install.',
    opencli_version_unsupported: 'This release is tested with OpenCLI 1.8.8. Use a separate 1.8.8 installation via LUZ_OPENCLI_ROOT; do not silently downgrade a global runtime.',
    native_plugin_missing: 'Run node scripts/luz-crawl.mjs install from this skill directory.',
    daemon_stopped: 'Run opencli daemon restart, then repeat doctor.',
    profile_selection_required: 'Run opencli profile list; pass --profile with the intended connected browser profile.',
    profile_disconnected: 'The selected browser profile is offline. Open that profile or choose a connected profile with --profile.',
    extension_disconnected: 'Open Edge/Chrome and load this skill browser-extension/ in the extension manager, then repeat doctor. Disable the old bridge copy to avoid duplicate connections.',
    ready: 'Browser Bridge is connected. Platform login/content still requires an actual page capture.',
  };
  const bundled = [fileURLToPath(new URL('../../browser-extension/', import.meta.url)), fileURLToPath(new URL('../browser-extension/', import.meta.url))];
  let bundledPath;
  for (const folder of bundled) { try { await fs.access(path.join(folder, 'manifest.json')); bundledPath = folder; break; } catch {} }
  return { schema_version: 2, state, ready: state === 'ready', checked_at: new Date().toISOString(), opencli, native_plugin: plugin, daemon: daemon ? { version: daemon.daemonVersion, context_id: daemon.contextId, extension_connected: daemon.extensionConnected, profiles: daemon.profiles, pending: daemon.pending } : null, extensions, hint: hints[state], extension_install: { bundled_path: bundledPath, bundled_loaded: extensions.some((extension) => !extension.disabled && extension.name === 'LuzCrawl' && extension.path && path.resolve(extension.path) === path.resolve(bundledPath || '.')), upstream_release: 'https://github.com/jackwener/opencli/releases', tested_bridge: '1.0.24', manual_step: 'Enable Developer mode, Load unpacked and select this skill browser-extension directory; disable the old bridge copy and verify the LuzCrawl connection.' } };
}
