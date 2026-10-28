import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { atomicWrite, hash, verifyArchive } from './archive.mjs';
import { validateURL } from './platforms.mjs';
import { validateMediaURL, fetchBrowserMedia } from './media.mjs';
import { createBrowserOperations } from './browser-operations.mjs';
import { appendMediaExport, refreshTaskReport } from './report.mjs';
import { createExecutionPolicy } from './execution.mjs';
import { classifyFailure, httpFailure, OperationError } from './failure.mjs';

async function directDownload(item, source, mediaDir, fetchAsset, knownFiles) {
  const url = validateMediaURL(item.url, source);
  const options = { signal: AbortSignal.timeout(60000), timeoutMs: 60000, maxBytes: (item.kind === 'image' ? 25 : 250) * 1024 * 1024, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'manual' };
  if (!fetchAsset) throw new Error('Media downloads require a live LuzCrawl browser page.');
  const response = await fetchAsset(url, options);
  if (!response.ok) { await response.body?.cancel(); throw httpFailure(response); }
  const receivedMime = (response.headers.get('content-type') || '').split(';')[0].trim();
  const stream = receivedMime === 'application/octet-stream' && ['video/mp4', 'audio/mp4'].includes(item.mime) && /(^|\.)bilivideo\.com$/.test(new URL(url).hostname) && /\.m4s$/.test(new URL(url).pathname) && /(^|\.)bilibili\.com$/.test(new URL(source).hostname);
  const mime = stream ? item.mime : receivedMime;
  const types = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/webm': 'webm', 'audio/flac': 'flac' };
  const extension = types[mime];
  if (!extension || !mime.startsWith(item.kind + '/')) { await response.body?.cancel(); throw new Error(`Unsupported ${item.kind} MIME: ${mime}`); }
  const file = path.join(mediaDir, `${item.kind}-${hash(url).slice(0, 12)}.${extension}`);
  try {
    const stat = await fs.lstat(file); await response.body?.cancel();
    if (!stat.isFile() || !knownFiles.has(file) || knownFiles.get(file) !== hash(await fs.readFile(file))) throw new OperationError('unverified_media', 'Existing media is unverified; inspect the archive before retrying.');
    return { url, file, reused: true, bytes: stat.size, sha256: knownFiles.get(file), mime, browser_download: response.browser_download };
  }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const partial = `${file}.${randomUUID()}.part`;
  let bytes = 0;
  const digest = createHash('sha256');
  const limit = item.kind === 'image' ? 25 * 1024 * 1024 : 250 * 1024 * 1024;
  const meter = new Transform({ transform(chunk, _, done) { bytes += chunk.length; if (bytes > limit) done(new Error('Media size limit exceeded')); else { digest.update(chunk); done(null, chunk); } } });
  try {
    await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(partial, { flags: 'wx' }));
    if (!bytes) throw new Error('Empty media response');
    if (stream) {
      const handle = await fs.open(partial, 'r');
      try { const header = Buffer.alloc(12); await handle.read(header, 0, header.length, 0); if (!['ftyp', 'styp'].includes(header.toString('ascii', 4, 8))) throw new Error('Player stream is not an MP4 file.'); }
      finally { await handle.close(); }
    }
    await fs.rename(partial, file);
    return { url, file, bytes, sha256: digest.digest('hex'), mime, reused: false, source: response.browser_download ? 'browser_download' : undefined, browser_download: response.browser_download };
  } finally { await fs.rm(partial, { force: true }); }
}

async function mediaTool(command, args, timeout = 180000) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', error = '';
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (data) => { output = (output + data).slice(-1000000); }); child.stderr.on('data', (data) => { error = (error + data).slice(-64000); });
    child.on('error', (cause) => { clearTimeout(timer); resolve({ error: cause.code === 'ENOENT' ? `Optional ${command} is not installed.` : cause.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ output, error: code === 0 ? undefined : error.trim() || `${command} exited ${code}` }); });
  });
}

async function mergeVideo(video, audio, mediaDir) {
  const file = path.join(mediaDir, `video-${hash(video.url + '\n' + audio.url).slice(0, 12)}.mp4`);
  const partial = `${file}.${randomUUID()}.part`;
  try {
    const result = await mediaTool('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file,pipe', '-i', video.file, '-protocol_whitelist', 'file,pipe', '-i', audio.file, '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', partial], 60000);
    if (result.error) throw new Error(result.error);
    const bytes = (await fs.stat(partial)).size;
    if (!bytes || bytes > 250 * 1024 * 1024) throw new Error('Merged video is empty or exceeds 250 MiB.');
    await fs.rename(partial, file);
    return { file, url: video.url, bytes, sha256: hash(await fs.readFile(file)), mime: 'video/mp4', source: 'observed_streams_ffmpeg', parts: [video, audio] };
  } finally { await fs.rm(partial, { force: true }); }
}

export async function downloadArchive(directory, options = {}) {
  const { muxHelper = mergeVideo } = options;
  const folder = path.resolve(directory);
  const lock = path.join(folder, '.capture.lock');
  await fs.writeFile(lock, JSON.stringify({ pid: process.pid, action: 'download' }), { flag: 'wx' });
  try {
    const integrity = await verifyArchive(folder);
    if (!integrity.ok) throw new Error(`Archive verification failed: ${integrity.failures.join(', ')}`);
    const content = JSON.parse(await fs.readFile(path.join(folder, 'raw/content.json'), 'utf8'));
    if (!content.url_check?.valid_content) throw new Error('Download requires a browser-verified source body.');
    const source = content.resolved_url || content.requested_url;
    const policy = await createExecutionPolicy({ profile: content.browser_profile, ...options });
    let operations;
    if (options.page) {
      operations = options.operations || await createBrowserOperations(options.page, { ...options, url: source, executionPolicy: policy });
      operations.url = source;
      if (await operations.evaluate('location.href') !== source) await operations.navigate(source);
      const ready = await policy.waitUntil(source, () => operations.extract({requestedURL:source,includePresentation:false}), snapshot => snapshot?.target_present);
      if (ready.last?.gate || !ready.last?.target_present) throw new OperationError(ready.last?.gate || 'target_body_not_found', 'Media download requires the current source body in the browser.');
    }
    const fetchAsset = options.fetchAsset || (options.page ? (url, settings) => { operations.browserCalls++; return fetchBrowserMedia(url, source, options.page, settings); } : undefined);
    const manifestFile = path.join(folder, 'raw/manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
    const knownFiles = new Map(manifest.files.map(item => [path.resolve(folder, item.path), item.sha256]));
    const images = content.post?.images || (content.media || []).filter((item) => item.kind === 'img');
    const videos = content.post?.videos || (content.media || []).filter((item) => item.kind === 'video');
    const audios = content.post?.audios || (content.media || []).filter((item) => item.kind === 'audio');
    const pairedAudioURLs = new Set(videos.map((item) => item.audio_url).filter(Boolean));
    const standaloneAudios = audios.filter((item) => !pairedAudioURLs.has(item.url));
    const assets = [...new Map([
      ...images.map((item) => ({ ...item, kind: 'image' })),
      ...videos.filter((item) => /^https?:\/\//.test(item.url || '')).map((item) => ({ ...item, kind: 'video' })),
      ...standaloneAudios.map((item) => ({ ...item, kind: 'audio' })),
    ].map((item) => [item.url, item])).values()];
    const mediaDir = path.join(folder, 'raw/media'); await fs.mkdir(mediaDir, { recursive: true });
    if (!(await fs.realpath(mediaDir)).startsWith((await fs.realpath(folder)) + path.sep)) throw new Error('Media directory resolves outside archive.');
    const files = [], failures = [], retainedParts = [];
    let stopped, directAttempts = 0;
    const downloadItem = async item => {
      const file = await policy.run('media', source, () => directDownload(item, source, mediaDir, fetchAsset, knownFiles), { label: item.kind });
      knownFiles.set(file.file, file.sha256); retainedParts.push(file); return file;
    };
    for (const item of assets) {
      directAttempts++;
      try {
        const downloaded = await downloadItem(item);
        if (item.kind === 'video' && item.audio_url) {
          const audio = await downloadItem({url:item.audio_url,kind:'audio',mime:'audio/mp4'});
          files.push(await muxHelper(downloaded,audio,mediaDir));
        } else files.push(downloaded);
      }
      catch (error) {
        const failure = classifyFailure(error); failures.push({ url: item.url, kind: item.kind, error: failure.message, failure: failure.toJSON() });
        if (['rate_limited', 'login_required', 'verification_required', 'operation_budget', 'cancelled'].includes(failure.code)) { stopped = failure.code; break; }
      }
    }
    for (const video of videos.filter(video => !/^https?:\/\//.test(video.url || ''))) failures.push({url:video.url,kind:'video',error:'The browser has not provided a downloadable media stream.'});
    const missingImages = images.some(image => !files.some(file => file.url === image.url && /^image\//.test(file.mime)));
    const missingVideos = files.filter(file => /^video\/(mp4|webm)$/.test(file.mime)).length < new Set(videos.map(video => video.url)).size;
    const missingAudios = standaloneAudios.some(audio => !files.some(file => file.url === audio.url && /^audio\//.test(file.mime)));
    const result = { status: !images.length && !videos.length && !standaloneAudios.length ? 'no_media' : missingImages || missingVideos || missingAudios ? 'partial' : 'downloaded', stop_reason: stopped, requested_images: images.length, requested_videos: videos.length, requested_audios: standaloneAudios.length, attempted_direct: directAttempts, downloaded: files.length, files, failures, retained_parts: retainedParts.filter(part => !files.some(file => file.file === part.file)), execution: policy.summary(), scope: 'browser_observed_media_only', at: new Date().toISOString() };
    const records = new Map(manifest.files.map((item) => [item.path, item]));
    try {
      const exported = await appendMediaExport(folder,content,result,manifest);
      if(exported) { result.export = exported; if(exported.external) manifest.delivery={file:exported.path,bytes:exported.bytes,sha256:exported.sha256}; else records.set(exported.path,{path:exported.path,bytes:exported.bytes,sha256:exported.sha256}); manifest.delivery_media = {images:exported.images,videos:exported.videos,audios:exported.audios}; }
    } catch(error) { result.export = {status:'failed',error:error.message}; result.status='partial'; }
    for (const file of [...retainedParts, ...files.flatMap(file => [...(file.parts || []),file])]) { const relative = path.relative(folder, file.file).split(path.sep).join('/'); records.set(relative, { path: relative, bytes: file.bytes, sha256: file.sha256 }); }
    const json = JSON.stringify(result, null, 2) + '\n';
    await atomicWrite(path.join(folder, 'raw/downloads.json'), json);
    records.set('raw/downloads.json', { path: 'raw/downloads.json', bytes: Buffer.byteLength(json), sha256: hash(json) });
    await atomicWrite(manifestFile, { ...manifest, files: [...records.values()], downloads: { status: result.status, downloaded: result.downloaded } });
    try { result.task_html = (await refreshTaskReport(folder))?.html_file; }
    catch (error) { result.report_error = error.message; }
    return result;
  } finally { await fs.rm(lock); }
}

export async function downloadResult(result, options = {}) {
  const policy = await createExecutionPolicy(options);
  for (const source of result.sources || [result]) {
    if (!source.folder || !source.url_check?.valid_content) continue;
    try { source.downloads = await downloadArchive(source.folder, { ...options, executionPolicy: policy }); }
    catch (error) {
      const failure = classifyFailure(error);
      source.downloads = { status: 'failed', stop_reason: failure.code, error: failure.message };
    }
    if (['login_required', 'verification_required'].includes(source.downloads.stop_reason)) { result.requires_user = true; result.awaiting_reason = source.downloads.stop_reason; result.handover_url = source.resolved_url || source.requested_url || source.url; break; }
  }
  return result;
}
