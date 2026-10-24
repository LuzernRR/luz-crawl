import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { hash, atomicWrite, verifyArchive } from '../opencli/lib/archive.mjs';
import { downloadArchive } from '../opencli/lib/download.mjs';
import { privateAddress, validateMediaURL, fetchMedia } from '../opencli/lib/media.mjs';
import { observedPostVideos } from '../opencli/lib/extract-page.mjs';
import { validateActions, browserActions } from '../opencli/lib/browser-actions.mjs';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'luzcrawl-media-'));
test.after(() => fs.rm(tmp, { recursive: true, force: true }));
async function archive(name, post = { images: [], videos: [] }) {
  const folder = path.join(tmp, name);
  const content = JSON.stringify({ requested_url: 'https://x.com/example/status/123', url_check: { valid_content: true }, post });
  await atomicWrite(path.join(folder, 'raw/content.json'), content);
  await atomicWrite(path.join(folder, 'raw/manifest.json'), { files: [{ path: 'raw/content.json', sha256: hash(content) }] });
  return folder;
}

test('downloads observed images and videos, releases reused bodies and tracks file integrity', async () => {
  const folder = await archive('complete', { images: [{ url: 'https://example.com/photo' }], videos: [{ url: 'https://example.com/clip' }] });
  let cancelled = 0;
  const fetchAsset = async (url, options) => {
    assert.equal(options.credentials, 'omit');
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); }, cancel() { cancelled++; } }), { headers: { 'content-type': url.endsWith('photo') ? 'image/png' : 'video/mp4' } });
  };
  // A closed body is needed for the first streaming download.
  const first = await downloadArchive(folder, { fetchAsset: async (url) => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': url.endsWith('photo') ? 'image/png' : 'video/mp4' } }) });
  assert.equal(first.status, 'downloaded'); assert.equal(first.downloaded, 2);
  assert.ok((await verifyArchive(folder)).ok);
  const reused = await downloadArchive(folder, { fetchAsset });
  assert.ok(reused.files.every((file) => file.reused)); assert.equal(cancelled, 2);
  await fs.writeFile(first.files[0].file, 'changed');
  await assert.rejects(() => downloadArchive(folder), /verification failed/);
  await assert.rejects(() => fs.access(path.join(folder, '.capture.lock')));
});

test('refuses media type confusion, reports missing video and does not claim empty media downloaded', async () => {
  const folder = await archive('wrong-mime', { images: [{ url: 'https://example.com/photo' }], videos: [{ url: 'blob:unavailable' }] });
  const result = await downloadArchive(folder, { fetchAsset: async () => new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } }), videoHelper: async () => ({ files: [], error: 'Sign in required' }) });
  assert.equal(result.status, 'partial'); assert.equal(result.downloaded, 0); assert.equal(result.video_helper.error, 'Sign in required');
  assert.equal((await downloadArchive(await archive('empty'))).status, 'no_media');
  await fs.writeFile(path.join(folder, '.capture.lock'), 'already running');
  await assert.rejects(() => downloadArchive(folder), { code: 'EEXIST' });
});

test('media fetch rejects private addresses and redirects outside an authorized local fixture', async () => {
  assert.ok(privateAddress('127.0.0.1')); assert.ok(privateAddress('::ffff:7f00:1')); assert.ok(privateAddress('172.20.1.1'));
  assert.equal(privateAddress('8.8.8.8'), false);
  assert.throws(() => validateMediaURL('http://127.0.0.1/image', 'https://example.com'), /local origin/);
  assert.throws(() => validateMediaURL('https://user:secret@example.com/image', 'https://example.com'), /credentials/);
  const server = http.createServer((request, response) => request.url === '/redirect' ? response.writeHead(302, { location: 'http://127.0.0.1:1/private' }).end() : response.writeHead(200, { 'content-type': 'image/png' }).end('fixture'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const source = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetchMedia(source + '/image', source, { signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 200); assert.equal(await new Response(response.body).text(), 'fixture');
    await assert.rejects(() => fetchMedia(source + '/redirect', source), /local origin/);
  } finally { await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }); }
});

test('video URLs must come from the target post response and official video host', () => {
  const item = (id, url) => ({ rest_id: id, legacy: { extended_entities: { media: [{ video_info: { variants: [{ url, content_type: 'video/mp4', bitrate: 100 }] } }] } } });
  const entries = [{ url: 'https://x.com/i/api/graphql/test/TweetDetail', responseBody: JSON.stringify([item('123', 'https://video.twimg.com/123.mp4'), item('456', 'https://video.twimg.com/456.mp4'), item('123', 'https://video.twimg.com.evil.test/123.mp4')]) }];
  assert.deepEqual(observedPostVideos(entries, '123').map((video) => video.url), ['https://video.twimg.com/123.mp4']);
  assert.deepEqual(observedPostVideos([{ ...entries[0], url: 'https://evil.test/response' }], '123'), []);
});

test('browser interface validates every action before navigation and stops on failure', async () => {
  assert.throws(() => validateActions([{ action: 'click', selector: '#like' }]), /allow-write/);
  assert.throws(() => validateActions([{ action: 'eval', code: 'anything' }], true), /Unsupported/);
  assert.throws(() => validateActions([{ action: 'scroll', amount: -1 }]), /Invalid scroll/);
  const file = path.join(tmp, 'actions.json');
  await atomicWrite(file, [{ action: 'click', selector: '#button' }]);
  let navigations = 0;
  const page = { goto: async () => { navigations++; }, evaluate: async (code) => { if (code.includes('node.click()')) throw new Error('Ambiguous target'); return { text: 'result' }; } };
  await assert.rejects(() => browserActions(page, { file, url: 'https://example.com' }), /allow-write/);
  assert.equal(navigations, 0);
  const result = await browserActions(page, { file, url: 'https://example.com', 'allow-write': true });
  assert.equal(result.status, 'failed'); assert.equal(result.results[0].error, 'Ambiguous target');
});

test('DOM click dispatches once and leaves outcome verification to a subsequent read', async (t) => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'luz-actions-'));
  t.after(() => fs.rm(out, { recursive: true, force: true }));
  const file = path.join(out, 'actions.json');
  await fs.writeFile(file, JSON.stringify([{action:'click',selector:'#counter'},{action:'read',selector:'#count'}]));
  let clicks = 0;
  const page = { goto: async () => {}, evaluate: async code => { if (code.includes('node.click()')) { clicks++; return {tag:'BUTTON',label:'Count'}; } return {text:String(clicks)}; } };
  const result = await browserActions(page, {file,url:'https://example.com',out,'allow-write':true});
  assert.equal(clicks, 1); assert.equal(result.results[1].value.text, '1');
  assert.equal(result.results[0].value.result.effect_verified, false);
});
