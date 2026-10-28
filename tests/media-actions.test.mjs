import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { hash, atomicWrite, createTaskArchive, verifyArchive } from '../opencli/lib/archive.mjs';
import { downloadArchive as download, downloadResult } from '../opencli/lib/download.mjs';
import { privateAddress, validateMediaURL, fetchBrowserMedia } from '../opencli/lib/media.mjs';
import { observedPostVideos } from '../opencli/lib/extract-page.mjs';
import { validateActions, browserActions } from '../opencli/lib/browser-actions.mjs';
import { refreshTaskReport, sourceMarkup } from '../opencli/lib/report.mjs';
import { testPolicy, actionArgument } from './helpers.mjs';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'luzcrawl-media-'));
const downloadArchive = (folder, options) => download(folder, { executionPolicy: testPolicy(tmp), ...options });
test.after(() => fs.rm(tmp, { recursive: true, force: true }));
async function archive(name, post = { images: [], videos: [] }) {
  const folder = path.join(tmp, name);
  const content = JSON.stringify({ requested_url: 'https://x.com/example/status/123', url_check: { valid_content: true }, post });
  await atomicWrite(path.join(folder, 'raw/content.json'), content);
  await atomicWrite(path.join(folder, 'raw/manifest.json'), { files: [{ path: 'raw/content.json', sha256: hash(content) }] });
  return folder;
}

test('media download refreshes raw source evidence and the same single project report', async () => {
  const task = await createTaskArchive(path.join(tmp, 'project-media'), '图片项目');
  const folder = path.join(task, 'raw/001_原文');
  const content = JSON.stringify({requested_url:'https://example.com/article',resolved_url:'https://example.com/article',title:'原文',status:'captured',url_check:{valid_content:true},items:[{text:'完整正文'}],post:{images:[{url:'https://example.com/picture'}],videos:[]}});
  const source = '<html><body><img src="https://example.com/picture"></body></html>';
  await atomicWrite(path.join(folder, 'raw/content.json'), content);
  await atomicWrite(path.join(folder, 'raw/source.html'), source);
  await atomicWrite(path.join(folder, 'raw/manifest.json'), {output_layout:'raw_source_v2',primary_file:'source.html',source_file:'raw/source.html',files:[{path:'raw/content.json',sha256:hash(content)},{path:'raw/source.html',sha256:hash(source)}]});
  const before = await refreshTaskReport(task);
  const result = await downloadArchive(folder, {fetchAsset:async()=>new Response('image-bytes',{headers:{'content-type':'image/png'}})});
  assert.equal(result.status, 'downloaded');
  assert.equal(result.task_html, before.html_file);
  assert.match(await fs.readFile(before.html_file, 'utf8'), /data:image\/png;base64/);
  assert.equal((await verifyArchive(folder)).ok, true);
  assert.equal((await verifyArchive(task)).ok, true);
  assert.deepEqual((await fs.readdir(task)).filter(name=>name.endsWith('.html')), [path.basename(before.html_file)]);
});

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

test('downloads standalone audio and adds a playable local audio control to the delivered HTML', async () => {
  const output = path.join(tmp, 'audio-output');
  const folder = path.join(output, 'raw', '001_音频文章');
  const name = '001_音频文章.html';
  const content = JSON.stringify({ requested_url: 'https://example.com/audio', resolved_url: 'https://example.com/audio', platform: 'web', captured_at: '2026-10-25T00:00:00.000Z', url_check: { valid_content: true }, title: '音频文章', status: 'captured', items: [{ kind: 'page_body', text: '正文' }], media: [{ kind: 'audio', url: 'https://example.com/show.mp3' }], post: { text: '正文', images: [], videos: [], audios: [{ url: 'https://example.com/show.mp3', mime: 'audio/mpeg' }] } });
  const html = '<!doctype html><meta http-equiv="Content-Security-Policy" content="media-src https: http:"><body><p>正文</p></body></html>';
  await atomicWrite(path.join(folder, 'raw/content.json'), content);
  await atomicWrite(path.join(folder, name), html);
  await atomicWrite(path.join(output, name), html);
  await atomicWrite(path.join(folder, 'raw/manifest.json'), { output_layout: 'html_and_raw_v1', primary_file: name, delivery: { file: name, bytes: Buffer.byteLength(html), sha256: hash(html) }, files: [{ path: 'raw/content.json', sha256: hash(content) }, { path: name, sha256: hash(html) }] });
  const result = await downloadArchive(folder, { fetchAsset: async () => new Response('audio-bytes', { headers: { 'content-type': 'audio/mpeg' } }) });
  assert.equal(result.status, 'downloaded');
  assert.equal(result.requested_audios, 1);
  assert.equal(result.files[0].mime, 'audio/mpeg');
  assert.equal(result.export.audios, 1);
  assert.match(await fs.readFile(path.join(output, name), 'utf8'), /<audio controls preload="none" src="raw\/001_%E9%9F%B3%E9%A2%91%E6%96%87%E7%AB%A0\/raw\/media\/audio-/);
  assert.ok((await verifyArchive(folder)).ok);
});

test('refuses media type confusion, reports missing video and does not claim empty media downloaded', async () => {
  const folder = await archive('wrong-mime', { images: [{ url: 'https://example.com/photo' }], videos: [{ url: 'blob:unavailable' }] });
  const result = await downloadArchive(folder, { fetchAsset: async () => new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } }) });
  assert.equal(result.status, 'partial'); assert.equal(result.downloaded, 0);
  assert.match(result.failures[0].error, /Unsupported image MIME/);
  assert.match(result.failures[1].error, /browser has not provided/);
  assert.equal((await downloadArchive(await archive('empty'))).status, 'no_media');
  await fs.writeFile(path.join(folder, '.capture.lock'), 'already running');
  await assert.rejects(() => downloadArchive(folder), { code: 'EEXIST' });
});

test('paired Bilibili streams require MP4 bytes and preserve both parts in the manifest', async () => {
  const folder = await archive('dash',{images:[],videos:[{url:'https://upos.bilivideo.com/video.m4s',audio_url:'https://upos.bilivideo.com/audio.m4s',mime:'video/mp4'}]});
  const content = JSON.stringify({requested_url:'https://www.bilibili.com/video/BV1GJ411x7h7/',url_check:{valid_content:true},post:{images:[],videos:[{url:'https://upos.bilivideo.com/video.m4s',audio_url:'https://upos.bilivideo.com/audio.m4s',mime:'video/mp4'}]}});
  await atomicWrite(path.join(folder,'raw/content.json'),content);
  await atomicWrite(path.join(folder,'raw/manifest.json'),{files:[{path:'raw/content.json',sha256:hash(content)}]});
  const bytes = Buffer.from([0,0,0,16,102,116,121,112,105,115,111,109,0,0,0,0]);
  const result = await downloadArchive(folder,{fetchAsset:async()=>new Response(bytes,{headers:{'content-type':'application/octet-stream'}}),muxHelper:async(video,audio,dir)=>{const file=path.join(dir,'merged.mp4');await fs.writeFile(file,bytes);return{file,url:video.url,bytes:bytes.length,sha256:hash(bytes),mime:'video/mp4',parts:[video,audio]};}});
  assert.equal(result.downloaded,1); assert.equal(result.files[0].parts.length,2); assert.ok((await verifyArchive(folder)).ok);
  const bad = await archive('bad-stream',{images:[],videos:[{url:'https://upos.bilivideo.com/video.m4s',mime:'video/mp4'}]});
  const rejected = await downloadArchive(bad,{fetchAsset:async()=>new Response('<html>login</html>',{headers:{'content-type':'application/octet-stream'}}),videoFallback:false});
  assert.equal(rejected.downloaded,0); assert.equal(rejected.status,'partial');
});

test('a denied browser stream stays partial without invoking an external video downloader',async()=>{
  const folder=await archive('recovered',{images:[],videos:[{url:'https://example.com/video.mp4'}]});
  let helperCalls=0;
  const result=await downloadArchive(folder,{fetchAsset:async()=>new Response('',{status:403}),videoHelper:async()=>{helperCalls++;return{files:[]};}});
  assert.equal(result.status,'partial');assert.equal(result.downloaded,0);assert.equal(result.failures[0].error,'HTTP 403');assert.equal(helperCalls,0);
  assert.ok((await verifyArchive(folder)).ok);
});

test('a media login gate saves its source for manual handover and stops later source downloads',async()=>{
  const folder=await archive('media-login',{images:[{url:'https://example.com/private.png'}],videos:[]});
  const source={folder,url_check:{valid_content:true},resolved_url:'https://x.com/example/status/123'};
  const later={...source};const result={status:'captured',sources:[source,later]};
  await downloadResult(result,{executionPolicy:testPolicy(tmp),fetchAsset:async()=>new Response('',{status:401})});
  assert.equal(result.requires_user,true);assert.equal(result.awaiting_reason,'login_required');assert.equal(result.handover_url,source.resolved_url);
  assert.equal(source.downloads.status,'partial');assert.equal(later.downloads,undefined);
});

test('download refreshes both HTML copies with full text, inline pictures and a relative video player', async () => {
  const output = path.join(tmp,'html-output'); const folder=path.join(output,'raw','001_原标题'); const name='001_原标题.html';
  const content = JSON.stringify({requested_url:'https://example.com/article',platform:'web',url_check:{valid_content:true},title:'原标题',status:'captured',items:[{kind:'page_body',text:'正文尾部不得省略'}],comments:[{text:'评论最后一句'}],post:{text:'正文尾部不得省略',images:[{url:'https://example.com/picture'}],videos:[{url:'https://example.com/clip'}]}});
  const html="<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"media-src https: http:\"><body><p>原排版</p><img src=\"https://example.com/picture\"></body></html>";
  await atomicWrite(path.join(folder,'raw/content.json'),content); await atomicWrite(path.join(folder,name),html); await atomicWrite(path.join(output,name),html);
  await atomicWrite(path.join(folder,'raw/manifest.json'),{output_layout:'html_and_raw_v1',primary_file:name,files:[{path:'raw/content.json',sha256:hash(content)},{path:name,sha256:hash(html)}]});
  const fetchAsset=async url=>new Response('media-bytes',{headers:{'content-type':url.endsWith('picture')?'image/png':'video/mp4'}});
  const result=await downloadArchive(folder,{fetchAsset}); assert.equal(result.export.videos,1);
  let delivered=await fs.readFile(path.join(output,name),'utf8'); assert.ok(delivered.includes('data:image/png;base64,'));assert.ok(!delivered.includes('src=\"https://example.com/picture\"'));assert.match(delivered,/<video[^>]+src="raw\//); assert.ok(delivered.includes('评论最后一句') && delivered.includes('正文尾部不得省略'));
  assert.ok((await verifyArchive(folder)).ok); await downloadArchive(folder,{fetchAsset});
  delivered=await fs.readFile(path.join(output,name),'utf8'); assert.equal(delivered.split('<!-- LUZCRAWL_ARCHIVE_MEDIA -->').length,2); assert.ok((await verifyArchive(folder)).ok);
  await assert.rejects(()=>sourceMarkup({folder,content:JSON.parse(content),downloads:{files:[{file:path.join(tmp,'outside.png'),url:'https://example.com/picture',mime:'image/png',sha256:'wrong'}]}},output),/escapes|ENOENT/);
});

test('download updates the single delivered HTML without recreating a raw export', async () => {
  const output=path.join(tmp,'single-html'); const folder=path.join(output,'raw','001_原文'); const name='001_原文.html';
  const content=JSON.stringify({requested_url:'https://example.com/post',url_check:{valid_content:true},title:'原文',status:'captured',items:[{text:'完整正文'}],post:{images:[{url:'https://example.com/picture'}],videos:[]}});
  const html='<html><body><p>原排版</p><img src=\"https://example.com/picture\"></body></html>';
  await atomicWrite(path.join(folder,'raw/content.json'),content); await atomicWrite(path.join(output,name),html);
  await atomicWrite(path.join(folder,'raw/manifest.json'),{output_layout:'html_and_raw_v1',primary_file:name,delivery:{file:name,bytes:Buffer.byteLength(html),sha256:hash(html)},files:[{path:'raw/content.json',sha256:hash(content)}]});
  const result=await downloadArchive(folder,{fetchAsset:async()=>new Response('image-bytes',{headers:{'content-type':'image/png'}})});
  assert.equal(result.export.external,true); assert.match(await fs.readFile(path.join(output,name),'utf8'),/data:image\/png;base64/);
  await assert.rejects(()=>fs.access(path.join(folder,name)),{code:'ENOENT'}); assert.ok((await verifyArchive(folder)).ok);
  await fs.appendFile(path.join(output,name),'modified'); assert.equal((await verifyArchive(folder)).ok,false);
});

test('browser media requires its extension, rejects private origins and validates downloaded bytes and redirects', async () => {
  assert.ok(privateAddress('127.0.0.1')); assert.ok(privateAddress('::ffff:7f00:1')); assert.ok(privateAddress('172.20.1.1'));
  assert.equal(privateAddress('8.8.8.8'), false);
  assert.throws(() => validateMediaURL('http://127.0.0.1/image', 'https://example.com'), /local origin/);
  assert.throws(() => validateMediaURL('https://user:secret@example.com/image', 'https://example.com'), /credentials/);
  const previous=process.env.LUZ_CRAWL_STATE; process.env.LUZ_CRAWL_STATE=path.join(tmp,'browser-state');
  const source='http://127.0.0.1:9999';
  let file;
  const page={downloadMedia:async(url,origin,settings)=>{
    assert.equal(origin,source+'/'); assert.equal(settings.maxBytes,20);
    file=path.join(process.env.LUZ_CRAWL_STATE,'browser-downloads',settings.filename);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'fixture');
    return{downloaded:true,filename:file,mime:'image/png',danger:'safe',finalUrl:url};
  }};
  try {
    await assert.rejects(()=>fetchBrowserMedia(source+'/image',source,{}),/browser extension/);
    const response = await fetchBrowserMedia(source + '/image', source, page, { maxBytes:20 });
    assert.equal(response.status, 200); assert.equal(await new Response(response.body).text(), 'fixture');
    await assert.rejects(()=>fetchBrowserMedia(source+'/image',source,{downloadMedia:async(...args)=>({...await page.downloadMedia(...args),finalUrl:'http://127.0.0.1:1/private'})},{maxBytes:20}),/local origin/);
    await assert.rejects(()=>fs.access(file),{code:'ENOENT'});
    await assert.rejects(()=>fetchBrowserMedia(source+'/image',source,{downloadMedia:async(...args)=>({...await page.downloadMedia(...args),danger:'dangerous'})},{maxBytes:20}),/safe/);
    await assert.rejects(()=>fs.access(file),{code:'ENOENT'});
  } finally { if(previous===undefined)delete process.env.LUZ_CRAWL_STATE;else process.env.LUZ_CRAWL_STATE=previous; }
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
  const page = { goto: async () => { navigations++; }, evaluate: async () => { throw new Error('Ambiguous target'); } };
  await assert.rejects(() => browserActions(page, { file, url: 'https://example.com' }), /allow-write/);
  assert.equal(navigations, 0);
  const result = await browserActions(page, { file, url: 'https://example.com', 'allow-write': true, executionPolicy: testPolicy(tmp) });
  assert.equal(result.status, 'failed'); assert.equal(result.results[0].error, 'Ambiguous target');
});

test('DOM click dispatches once and leaves outcome verification to a subsequent read', async (t) => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'luz-actions-'));
  t.after(() => fs.rm(out, { recursive: true, force: true }));
  const file = path.join(out, 'actions.json');
  await fs.writeFile(file, JSON.stringify([{action:'click',selector:'#counter'},{action:'read',selector:'#count'}]));
  let clicks = 0;
  const page = { goto: async () => {}, evaluate: async code => { const step = actionArgument(code); if (step.action === 'click') { clicks++; return {ok:true,url:'https://example.com',result:{effect_verified:false}}; } return {ok:true,url:'https://example.com',text:String(clicks)}; } };
  const result = await browserActions(page, {file,url:'https://example.com',out,'allow-write':true,executionPolicy:testPolicy(tmp)});
  assert.equal(clicks, 1); assert.equal(result.results[1].value.text, '1');
  assert.equal(result.results[0].value.result.effect_verified, false);
});

test('media retries transient failures, preserves failed attempts, and cleans partial files', async () => {
  const folder = await archive('media-retry', { images: [{ url: 'https://example.com/retry' }], videos: [] });
  let calls = 0;
  const result = await downloadArchive(folder, { fetchAsset: async () => ++calls === 1 ? new Response('', { status: 503 }) : new Response('image', { headers: { 'content-type': 'image/png' } }) });
  assert.equal(calls, 2); assert.equal(result.status, 'downloaded'); assert.equal(result.execution.retries, 1);
  assert.equal(result.execution.events[0].error.code, 'transient_failure');
  assert.ok((await verifyArchive(folder)).ok);
  assert.equal((await fs.readdir(path.join(folder, 'raw/media'))).filter(name => name.endsWith('.part')).length, 0);
});

test('429 stops remaining media and optional helpers instead of switching download routes', async () => {
  const folder = await archive('media-cooldown', { images: [{ url: 'https://example.com/one' }, { url: 'https://example.com/two' }], videos: [{ url: 'https://example.com/video' }] });
  let calls = 0, helpers = 0;
  const result = await downloadArchive(folder, { fetchAsset: async () => { calls++; return new Response('', { status: 429, headers: { 'Retry-After': '1200' } }); }, videoHelper: async () => { helpers++; return { files: [] }; } });
  assert.equal(calls, 1); assert.equal(helpers, 0); assert.equal(result.stop_reason, 'rate_limited');
  assert.equal(result.attempted_direct, 1); assert.equal(result.failures[0].failure.retry_after_ms, 1200000);
  assert.ok((await verifyArchive(folder)).ok);
});

test('failed mux retains verified streams so retrying cannot silently replace them', async () => {
  const folder = await archive('mux-failure', { images: [], videos: [{ url: 'https://example.com/video', audio_url: 'https://example.com/audio' }] });
  const result = await downloadArchive(folder, { fetchAsset: async url => new Response('part', { headers: { 'content-type': url.endsWith('audio') ? 'audio/mp4' : 'video/mp4' } }), muxHelper: async () => { throw new Error('Optional ffmpeg is not installed.'); }, videoFallback: false });
  assert.equal(result.status, 'partial'); assert.equal(result.retained_parts.length, 2);
  assert.ok((await verifyArchive(folder)).ok);
  await fs.appendFile(result.retained_parts[0].file, 'changed');
  await assert.rejects(() => downloadArchive(folder), /verification failed/);
});
