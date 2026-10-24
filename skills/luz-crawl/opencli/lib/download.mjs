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

async function directDownload(item, source, mediaDir, fetchAsset) {
  const url = validateMediaURL(item.url, source);
  const options = { signal: AbortSignal.timeout(60000), credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'manual' };
  const response = await (fetchAsset ? fetchAsset(url, options) : fetchMedia(url, source, options));
  if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
  const mime = (response.headers.get('content-type') || '').split(';')[0].trim();
  const types = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/mpeg': 'mp3' };
  const extension = types[mime];
  if (!extension || !(item.kind === 'image' ? mime.startsWith('image/') : mime.startsWith('video/'))) { await response.body?.cancel(); throw new Error(`Unsupported ${item.kind} MIME: ${mime}`); }
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
    await fs.rename(partial, file);
    return { url, file, bytes, sha256: digest.digest('hex'), mime, reused: false };
  } finally { await fs.rm(partial, { force: true }); }
}

async function publicVideo(source, mediaDir) {
  return new Promise((resolve) => {
    const args = ['--ignore-config', '--no-cache-dir', '--js-runtimes', `node:${process.execPath}`, '--no-playlist', '--no-overwrites', '--no-progress', '--quiet', '--restrict-filenames', '--socket-timeout', '20', '--retries', '1', '--max-filesize', '250M', '--format', 'best[height<=720]/best', '--paths', mediaDir, '--output', 'video-%(id)s.%(ext)s', '--print', 'after_move:filepath', '--', validateURL(source).href];
    const child = spawn('yt-dlp', args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', error = '';
    const timer = setTimeout(() => child.kill(), 180000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (data) => { output += data; }); child.stderr.on('data', (data) => { error += data; });
    child.on('error', (cause) => { clearTimeout(timer); resolve({ files: [], error: cause.code === 'ENOENT' ? 'Optional yt-dlp is not installed.' : cause.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ files: code === 0 ? output.trim().split(/\r?\n/).filter(Boolean) : [], error: code === 0 ? undefined : error.trim() || `yt-dlp exited ${code}` }); });
  });
}

export async function downloadArchive(directory, { fetchAsset, videoFallback = true, videoHelper = publicVideo } = {}) {
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
      try { files.push(await directDownload(item, source, mediaDir, fetchAsset)); }
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
        files.push({ file: resolved, url: source, bytes: bytes.length, sha256: hash(bytes), mime: 'video/helper', source: 'public_yt_dlp' });
      }
    }
    const result = { status: !images.length && !videos.length ? 'no_media' : failures.length || (videos.length && !files.some((file) => /^video\//.test(file.mime))) ? 'partial' : 'downloaded', requested_images: images.length, requested_videos: videos.length, attempted_direct: assets.length, downloaded: files.length, files, failures, video_helper: fallback, scope: 'browser_observed_media_and_optional_public_video', at: new Date().toISOString() };
    const manifestFile = path.join(folder, 'raw/manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
    const records = new Map(manifest.files.map((item) => [item.path, item]));
    for (const file of files) { const relative = path.relative(folder, file.file).split(path.sep).join('/'); records.set(relative, { path: relative, bytes: file.bytes, sha256: file.sha256 }); }
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
