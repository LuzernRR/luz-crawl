import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { atomicWrite, createTaskArchive, hash, verifyArchive } from '../opencli/lib/archive.mjs';
import { refreshTaskReport } from '../opencli/lib/report.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'luz-crawl-session-layout-'));
process.env.LUZ_CRAWL_STATE = path.join(root, 'state');
test.after(() => fs.rm(root, { recursive: true, force: true }));

async function source(task, number) {
  const folder = path.join(task, 'raw', `${String(number).padStart(3, '0')}_来源${number}`);
  await fs.mkdir(path.join(folder, 'raw'), { recursive: true });
  const content = JSON.stringify({
    requested_url: `https://example.com/${number}`,
    canonical_url: `https://example.com/${number}`,
    resolved_url: `https://example.com/${number}`,
    title: `来源 ${number}`,
    platform: 'web',
    status: 'captured',
    captured_at: new Date().toISOString(),
    url_check: { valid_content: true },
    items: [{ kind: 'page_body', text: `正文 ${number}` }],
    post: { text: `正文 ${number}` },
  }) + '\n';
  await atomicWrite(path.join(folder, 'raw/content.json'), content);
  await atomicWrite(path.join(folder, 'raw/manifest.json'), { output_layout: 'raw_source_v2', source_file: 'raw/content.json', files: [{ path: 'raw/content.json', bytes: Buffer.byteLength(content), sha256: hash(content) }] });
}

test('one session has one numbered folder and one luz-design HTML delivery', async () => {
  const output = path.join(root, 'output');
  const task = await createTaskArchive(output, '搜索主题', { newTask: true });
  await source(task, 1);
  await source(task, 2);
  const report = await refreshTaskReport(task);
  const top = await fs.readdir(task, { withFileTypes: true });
  const html = top.filter(entry => entry.isFile() && entry.name.endsWith('.html'));
  assert.equal(html.length, 1);
  assert.equal(html[0].name, `${path.basename(task)}.html`);
  assert.equal(report.html_file, path.join(task, html[0].name));
  const delivered = await fs.readFile(report.html_file, 'utf8');
  assert.match(delivered, /--bg:#f5f6f8/);
  const ids = [...delivered.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual((await verifyArchive(task)).ok, true);
  assert.deepEqual((await fs.readdir(output)).sort(), [path.basename(task)]);
});

test('parallel refreshes keep one valid report and refuse edited, extra or untracked HTML', async () => {
  const task = await createTaskArchive(path.join(root, 'parallel'), '并发项目');
  await source(task, 1);
  const reports = await Promise.all(Array.from({length:4}, () => refreshTaskReport(task)));
  assert.ok(reports.every(report => report.html_file === reports[0].html_file));
  assert.equal((await verifyArchive(task)).ok, true);
  await fs.writeFile(path.join(task, 'extra.HTML'), 'user file');
  assert.equal((await verifyArchive(task)).ok, false);
  await assert.rejects(() => refreshTaskReport(task), /extra HTML/);
  await fs.rm(path.join(task, 'extra.HTML'));
  await fs.appendFile(reports[0].html_file, 'edited');
  await assert.rejects(() => refreshTaskReport(task), /edited/);
  await fs.rm(path.join(task, 'raw/manifest.json'));
  await assert.rejects(() => refreshTaskReport(task), /no manifest/);
});
