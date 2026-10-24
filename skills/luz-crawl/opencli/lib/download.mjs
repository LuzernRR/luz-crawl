import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { atomicWrite, hash, verifyArchive } from './archive.mjs';
import { validateURL } from './platforms.mjs';
import { validateMediaURL, fetchMedia } from './media.mjs';
import { appendMediaExport } from './report.mjs';

async function directDownload(item, source, mediaDir, fetchAsset) {
  const url = validateMediaURL(item.url, source);
  const options = { signal: AbortSignal.timeout(60000), credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'manual' };
  const response = await (fetchAsset ? fetchAsset(url, options) : fetchMedia(url, source, options));
  if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
  const receivedMime = (response.headers.get('content-type') || '').split(';')[0].trim();
  const stream = receivedMime === 'application/octet-stream' && ['video/mp4', 'audio/mp4'].includes(item.mime) && /(^|\.)bilivideo\.com$/.test(new URL(url).hostname) && /\.m4s$/.test(new URL(url).pathname) && /(^|\.)bilibili\.com$/.test(new URL(source).hostname);
  const mime = stream ? item.mime : receivedMime;
  const types = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3' };
  const extension = types[mime];
  if (!extension || !mime.startsWith(item.kind + '/')) { await response.body?.cancel(); throw new Error(`Unsupported ${item.kind} MIME: ${mime}`); }
  const file = path.join(mediaDir, `${item.kind}-${hash(url).slice(0, 12)}.${extension}`);
  try { await fs.access(file); await response.body?.cancel(); return { url, file, reused: true, bytes: (await fs.stat(file)).size, sha256: hash(await fs.readFile(file)), mime }; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const partial = `${file}.${randomUUID()}.part`;
  let bytes = 0;
  const digest = createHash('sha256');
  const limit = item.kind === 'video' ? 250 * 1024 * 1024 : 25 * 1024 * 1024;
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
    return { url, file, bytes, sha256: digest.digest('hex'), mime, reused: false };
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

async function publicVideo(source, mediaDir) {
  if(/(^|\.)bilibili\.com$/.test(validateURL(source).hostname)) return {files:[],error:'Bilibili requires a fresh browser capture of its player streams and FFmpeg.'};
  const args = ['--ignore-config', '--no-cache-dir', '--js-runtimes', `node:${process.execPath}`, '--no-playlist', '--no-overwrites', '--no-progress', '--quiet', '--restrict-filenames', '--socket-timeout', '20', '--retries', '1', '--max-filesize', '250M', '--format', 'bv*[height<=720][vcodec^=avc1]+ba[acodec^=mp4a]/b[height<=720][vcodec^=h264]/b[height<=720][vcodec^=avc1]/best[height<=720]', '--merge-output-format', 'mp4', '--paths', mediaDir, '--output', 'video-%(id)s-%(format_id)s.%(ext)s', '--print', 'after_move:filepath', '--', validateURL(source).href];
  const result = await mediaTool('yt-dlp', args);
  return { files: result.error ? [] : result.output.trim().split(/\r?\n/).filter(Boolean), error: result.error };
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

export async function downloadArchive(directory, { fetchAsset, videoFallback = true, videoHelper = publicVideo, muxHelper = mergeVideo } = {}) {
  const folder = path.resolve(directory);
  const lock = path.join(folder, '.capture.lock');
  await fs.writeFile(lock, JSON.stringify({ pid: process.pid, action: 'download' }), { flag: 'wx' });
  try {
    const integrity = await verifyArchive(folder);
    if (!integrity.ok) throw new Error(`Archive verification failed: ${integrity.failures.join(', ')}`);
    const content = JSON.parse(await fs.readFile(path.join(folder, 'raw/content.json'), 'utf8'));
    if (!content.url_check?.valid_content) throw new Error('Download requires a browser-verified source body.');
    const source = content.resolved_url || content.requested_url;
    const images = content.post?.images || (content.media || []).filter((item) => item.kind === 'img');
    const videos = content.post?.videos || (content.media || []).filter((item) => item.kind === 'video');
    const assets = [...new Map([...images.map((item) => ({ ...item, kind: 'image' })), ...videos.filter((item) => /^https?:\/\//.test(item.url || '')).map((item) => ({ ...item, kind: 'video' }))].map((item) => [item.url, item])).values()];
    const mediaDir = path.join(folder, 'raw/media'); await fs.mkdir(mediaDir, { recursive: true });
    if (!(await fs.realpath(mediaDir)).startsWith((await fs.realpath(folder)) + path.sep)) throw new Error('Media directory resolves outside archive.');
    const files = [], failures = [];
    for (const item of assets) {
      try {
        const downloaded = await directDownload(item, source, mediaDir, fetchAsset);
        if (item.kind === 'video' && item.audio_url) {
          const audio = await directDownload({url:item.audio_url,kind:'audio',mime:'audio/mp4'},source,mediaDir,fetchAsset);
          files.push(await muxHelper(downloaded,audio,mediaDir));
        } else files.push(downloaded);
      }
      catch (error) { failures.push({ url: item.url, kind: item.kind, error: error.message }); }
    }
    let fallback;
    if (videoFallback && videos.length && !files.some((file) => /^video\//.test(file.mime))) {
      fallback = await videoHelper(source, mediaDir);
      for (const file of fallback.files) {
        const resolved = path.resolve(file);
        if (!resolved.startsWith(mediaDir + path.sep)) { failures.push({ error: 'Video helper returned a path outside its media directory.' }); continue; }
        const stat = await fs.lstat(resolved);
        if (!stat.isFile() || !/\.(mp4|webm|mkv|mov)$/i.test(resolved) || !stat.size || stat.size > 250 * 1024 * 1024) { failures.push({ error: 'Video helper returned an invalid or oversized media file.' }); continue; }
        const bytes = await fs.readFile(resolved);
        files.push({ file: resolved, url: source, bytes: bytes.length, sha256: hash(bytes), mime: resolved.endsWith('.mp4') ? 'video/mp4' : resolved.endsWith('.webm') ? 'video/webm' : 'video/helper', source: 'public_yt_dlp' });
      }
    }
    const missingImages = images.some(image => !files.some(file => file.url === image.url && /^image\//.test(file.mime)));
    const missingVideos = files.filter(file => /^video\/(mp4|webm)$/.test(file.mime)).length < new Set(videos.map(video => video.url)).size;
    const result = { status: !images.length && !videos.length ? 'no_media' : missingImages || missingVideos ? 'partial' : 'downloaded', requested_images: images.length, requested_videos: videos.length, attempted_direct: assets.length, downloaded: files.length, files, failures, video_helper: fallback, scope: 'browser_observed_media_and_optional_public_video', at: new Date().toISOString() };
    const manifestFile = path.join(folder, 'raw/manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
    const records = new Map(manifest.files.map((item) => [item.path, item]));
    try {
      const exported = await appendMediaExport(folder,content,result,manifest);
      if(exported) { result.export = exported; records.set(exported.path,{path:exported.path,bytes:exported.bytes,sha256:exported.sha256}); manifest.delivery_media = {images:exported.images,videos:exported.videos}; }
    } catch(error) { result.export = {status:'failed',error:error.message}; result.status='partial'; }
    for (const file of files.flatMap(file => [...(file.parts || []),file])) { const relative = path.relative(folder, file.file).split(path.sep).join('/'); records.set(relative, { path: relative, bytes: file.bytes, sha256: file.sha256 }); }
    const json = JSON.stringify(result, null, 2) + '\n';
    await atomicWrite(path.join(folder, 'raw/downloads.json'), json);
    records.set('raw/downloads.json', { path: 'raw/downloads.json', bytes: Buffer.byteLength(json), sha256: hash(json) });
    await atomicWrite(manifestFile, { ...manifest, files: [...records.values()], downloads: { status: result.status, downloaded: result.downloaded } });
    return result;
  } finally { await fs.rm(lock); }
}

export async function downloadResult(result) {
  for (const source of result.sources || [result]) {
    if (!source.folder || !source.url_check?.valid_content) continue;
    try { source.downloads = await downloadArchive(source.folder); }
    catch (error) { source.downloads = { status: 'failed', error: error.message }; }
  }
  return result;
}
