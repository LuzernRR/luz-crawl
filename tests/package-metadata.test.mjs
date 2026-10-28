import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { sourceURL } from '../opencli/lib/platforms.mjs';

test('extension display version matches the Skill release', async () => {
  const pkg = JSON.parse(await fs.readFile(new URL('../opencli/package.json', import.meta.url), 'utf8'));
  const plugin = JSON.parse(await fs.readFile(new URL('../opencli/opencli-plugin.json', import.meta.url), 'utf8'));
  const lock = await fs.readFile(new URL('../opencli/package-lock.json', import.meta.url), 'utf8').then(JSON.parse).catch(error => {
    if (error.code === 'ENOENT') return null; // Lockfiles are intentionally excluded from distribution ZIPs.
    throw error;
  });
  const manifest = JSON.parse(await fs.readFile(new URL('../browser-extension/manifest.json', import.meta.url), 'utf8'));
  assert.equal(plugin.version, pkg.version);
  if (lock) assert.equal(lock.version, pkg.version);
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.version_name.startsWith(`LuzCrawl ${pkg.version} (`));
});

test('the referenced website library ships distinct public entries with separate acceptance states', async () => {
  const text = await fs.readFile(new URL('../references/site-library.json', import.meta.url), 'utf8');
  const library = JSON.parse(text);
  assert.equal(library.schema_version, 1); assert(library.sites.length > 0);
  const ids = new Set();
  for (const site of library.sites) {
    assert.equal(typeof site.id, 'string'); assert(site.id && !ids.has(site.id)); ids.add(site.id);
    assert(site.name && site.kind); assert.equal(sourceURL(site.url), site.url);
    assert(site.probe.status);
    for (const dimension of ['page', 'search', 'detail', 'statistics', 'media']) assert(library.verification_states.includes(site.verification[dimension]), `${site.id}.${dimension}`);
  }
  for (const id of ['gdggzy', 'qianlima', 'yfb', 'huitun', 'pinterest']) assert(ids.has(id));
  assert(!/\b[a-z]:[\\/]|12860|raw\/00|access_token|xsec_token|cookie=/i.test(text));
});
