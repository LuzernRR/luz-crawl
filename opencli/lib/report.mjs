import fs from 'node:fs/promises';
import path from 'node:path';
import { allocationLock, atomicWrite, deliveryRootForArchive, findTaskArchive, hash, verifyArchive } from './archive.mjs';
import { validateURL } from './platforms.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const href = value => { try { return escape(validateURL(value).href); } catch { return ''; } };
const fileLink = (output, file) => path.relative(output,file).split(path.sep).map(encodeURIComponent).join('/');
const marker = '\n<!-- LUZCRAWL_ARCHIVE_MEDIA -->\n';
// Mirrors luz-design's file standard: light canvas, centered content, clear type scale,
// restrained tables/cards, and a mobile layout that never shrinks the whole page.
export const reportStyles = `:root{color-scheme:light;--bg:#f5f6f8;--surface:#fff;--ink:#243746;--muted:#62717e;--border:#dfe5e9;--brand:#536e8a;--brand-soft:#eaf0f6;--radius:14px;font-family:"Microsoft YaHei","PingFang SC",system-ui,sans-serif;font-size:16px;line-height:1.75}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);overflow-wrap:anywhere}a{color:var(--brand);text-underline-offset:4px}.skip{position:fixed;top:-80px;left:12px;z-index:2;background:var(--surface);padding:10px}.skip:focus{top:8px}.layout{max-width:1600px;margin:auto;padding:26px 28px 64px;display:grid;grid-template-columns:190px minmax(0,1fr);gap:28px}.rail{position:sticky;top:24px;align-self:start;max-height:calc(100svh - 48px);overflow:auto;font-size:14px}.rail a{display:block;padding:6px 10px;border-left:2px solid var(--border);color:var(--muted);text-decoration:none}.rail a:hover,.rail a:focus{background:var(--brand-soft);color:var(--brand);border-color:var(--brand)}main{min-width:0}.hero{padding:0 0 18px;margin-bottom:22px;border-bottom:1px solid var(--border)}h1{font-size:28px;line-height:1.4;letter-spacing:-.5px;margin:0}section{scroll-margin-top:90px;margin:26px 0}.section-head{margin-bottom:14px}.section-head h2{font-size:22px;line-height:1.5;margin:0}.card{min-width:0;padding:20px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius)}.table-wrap{max-width:100%;overflow:auto;border:1px solid var(--border);border-radius:12px;background:var(--surface)}table{width:100%;border-collapse:collapse;text-align:left;font-size:15px;line-height:1.75}th,td{padding:12px 14px;vertical-align:top;border-bottom:1px solid var(--border);overflow-wrap:anywhere}th{background:#eef2f6;color:#435b70;font-weight:650}tr:last-child td{border-bottom:0}.meta{margin:8px 0;color:var(--muted);font-size:14px}.body{margin:12px 0;white-space:pre-wrap}.source{margin:18px 0}.source h3{font-size:18px;line-height:1.5;margin:0 0 8px}.source .source-body{margin-top:14px}.source .pictures{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-top:10px}.source img{display:block;width:100%;max-height:700px;object-fit:contain;border-radius:8px;background:#f0f3f6}.source video,.source audio{display:block;width:100%;max-height:70vh;margin:10px 0;background:#243746;border-radius:8px}.source figure{margin:0}.source figcaption{margin:4px 0 12px;font-size:13px;color:var(--muted)}details{margin:12px 0}summary{cursor:pointer;color:var(--brand)}.comment{padding:9px 0;border-bottom:1px solid #edf1f4}.notice{color:#835d25}.empty{padding:25px;text-align:center;color:var(--muted)}:focus-visible{outline:3px solid #728da9;outline-offset:3px}@media(max-width:760px){.layout{display:block;padding:20px 14px 44px}.rail{position:static;display:flex;gap:6px;max-height:none;overflow:auto;margin:-4px 0 20px;padding-bottom:4px}.rail a{white-space:nowrap;border:1px solid var(--border);border-radius:8px;padding:6px 9px}h1{font-size:26px}.card{padding:14px}.source .pictures{grid-template-columns:1fr}}@media print{.rail,.skip{display:none}.layout{display:block;padding:0}.card,.source{break-inside:avoid}body{background:#fff}}`;

export async function readArchive(directory) {
  const folder = path.resolve(directory);
  const integrity = await verifyArchive(folder);
  if (!integrity.ok) throw new Error(`Archive verification failed: ${integrity.failures.join(', ')}`);
  const content = JSON.parse(await fs.readFile(path.join(folder,'raw/content.json'),'utf8'));
  if (!content.url_check?.valid_content || content.query) return null;
  let downloads = {files:[]};
  try { downloads = JSON.parse(await fs.readFile(path.join(folder,'raw/downloads.json'),'utf8')); }
  catch(error) { if(error.code !== 'ENOENT') throw error; }
  return {folder,content,downloads};
}

async function localMedia(folder, file) {
  const root = await fs.realpath(folder);
  const resolved = path.resolve(file.file);
  if (!resolved.startsWith(path.resolve(folder) + path.sep) || !(await fs.realpath(resolved)).startsWith(root + path.sep)) throw new Error('Report media escapes its source archive.');
  const bytes = await fs.readFile(resolved);
  if (hash(bytes) !== file.sha256) throw new Error('Report media checksum does not match.');
  return bytes;
}

export async function sourceMarkup({folder,content,downloads={files:[]}}, output, index=1) {
  const post = content.post || {};
  const files = [...(downloads.files || []), ...(downloads.retained_parts || [])];
  const texts = [...new Set([post.text,...(content.items || []).filter(item => !['page_shell','comment','reply','thread_or_reply'].includes(item.kind)).map(item => item.text)].filter(value => value?.trim()))];
  const comments = content.comments?.length ? content.comments : (content.items || []).filter(item => ['comment','reply'].includes(item.kind));
  const images = post.images || (content.media || []).filter(item => item.kind === 'img');
  const pictures = [];
  for(const image of images) {
    const file = files.find(file => file.url === image.url && /^image\//.test(file.mime));
    const src = file ? `data:${file.mime};base64,${(await localMedia(folder,file)).toString('base64')}` : href(image.url);
    if(src) pictures.push(`<figure><img src="${src}" alt="${escape(image.alt)}" loading="lazy">${file ? `<figcaption><a href="${escape(fileLink(output,file.file))}" download>下载图片</a></figcaption>` : '<figcaption class="notice">图片未保存，当前使用来源地址</figcaption>'}</figure>`);
  }
  const videos = [];
  for(const file of files.filter(file => /^video\//.test(file.mime))) {
    await localMedia(folder,file);
    const link = escape(fileLink(output,file.file));
    videos.push(`<figure><video controls preload="none" playsinline src="${link}"></video><figcaption><a href="${link}" download>下载视频</a> · ${Math.round(file.bytes/1024)} KiB</figcaption></figure>`);
  }
  const audios = post.audios || (content.media || []).filter(item => item.kind === 'audio');
  const sounds = [];
  for(const audio of audios) {
    const file = files.find(file => file.url === audio.url && /^audio\//.test(file.mime));
    const src = file ? escape(fileLink(output,file.file)) : href(audio.url);
    if(src) sounds.push(`<figure><audio controls preload="none" src="${src}"></audio><figcaption>${file ? `<a href="${src}" download>下载音频</a>` : '<span class="notice">音频未保存，当前使用来源地址</span>'}</figcaption></figure>`);
  }
  const metrics = Object.entries({likes:'赞',comments:'评',favorites:'藏',shares:'分享',views:'播放 / 浏览'}).flatMap(([key,label]) => post.engagement?.[key]?.value != null ? [`${label} ${escape(post.engagement[key].raw || post.engagement[key].value)}`] : []).join(' · ');
  const author = post.account?.name || (content.items || []).find(item => item.author)?.author || '';
  const accountURL = href(post.account?.profile_url);
  const source = href(content.resolved_url || content.requested_url);
  const status = content.status === 'captured' ? '已获取' : '本次已取得的内容';
  const body = texts.map(text => `<div class="body">${escape(text)}</div>`).join('');
  const replies = comments.map(comment => `<div class="comment"><div class="meta">${escape(comment.account?.name || comment.author || '')}${comment.time ? ' · '+escape(comment.time) : ''}</div><div class="body">${escape(comment.text)}</div></div>`).join('');
  const transcript = (content.transcript || []).map(item => `<div>${escape(item.time)} ${escape(item.text)}</div>`).join('');
  return `<article class="source card" id="source-${index}" data-source-url="${source}"><h2>${index}. ${escape(post.title || content.title)}</h2><p class="meta">${accountURL ? `<a href="${accountURL}" target="_blank" rel="noopener noreferrer">${escape(author)}</a>` : escape(author)} · ${escape(content.platform)} · ${status}</p><p class="meta">${metrics}</p><p class="meta"><a href="${source}" target="_blank" rel="noopener noreferrer">查看原文</a></p><div class="source-body">${body}</div>${pictures.length ? '<h3>图片</h3><div class="pictures">'+pictures.join('')+'</div>' : ''}${videos.length ? '<h3>视频</h3>'+videos.join('') : post.videos?.length ? '<p class="notice">视频未下载成功，播放文件尚不可用。</p>' : ''}${sounds.length ? '<h3>音频</h3>'+sounds.join('') : audios.length ? '<p class="notice">音频未保存，当前使用来源地址</p>' : ''}${replies ? `<details open><summary>已加载评论 ${comments.length} 条</summary>${replies}</details>` : ''}${transcript ? `<details open><summary>已取得的字幕</summary>${transcript}</details>` : ''}${content.limitations?.length ? '<details><summary>采集范围</summary><ul>'+content.limitations.map(item=>`<li>${escape(item)}</li>`).join('')+'</ul></details>' : ''}</article>`;
}

export async function reportDocument(title, archives, output, runs=[], entries=[]) {
  const sections=[];
  for(const [index,archive] of archives.entries()) sections.push(await sourceMarkup(archive,output,index+1));
  const labels = {captured:'已获取',completed:'已完成',partial:'部分获取',awaiting_user:'需人工处理',blocked:'受阻',failed:'失败',skipped:'未访问'};
  const table = runs.length ? `<section id="searches"><div class="section-head"><h2>检索结果</h2></div><div class="table-wrap" tabindex="0" aria-label="检索结果"><table><thead><tr><th scope="col">平台</th><th scope="col">关键词 / 页面</th><th scope="col">结果</th></tr></thead><tbody>${runs.map(run=>`<tr><td>${escape(run.platform || '网页')}</td><td>${escape(run.query || '')}${run.url && href(run.url) ? `<a href="${href(run.url)}" target="_blank" rel="noopener noreferrer">${escape(run.title || '打开页面')}</a>` : ''}</td><td>${escape(labels[run.status] || '待阅读')}${run.error ? ' · '+escape(run.error) : ''}${run.candidates?.length ? '<ul>'+run.candidates.filter(item=>href(item.url)).map(item=>`<li><a href="${href(item.url)}" target="_blank" rel="noopener noreferrer">${escape(item.text || item.title || '候选页面')}</a> · 待阅读</li>`).join('')+'</ul>' : ''}</td></tr>`).join('')}</tbody></table></div></section>` : '';
  const overview = !archives.length && !runs.length && entries.length ? `<section><div class="table-wrap" tabindex="0" aria-label="采集内容"><table><thead><tr><th scope="col">页面</th><th scope="col">内容</th><th scope="col">状态</th></tr></thead><tbody>${entries.map(row=>`<tr><td><a class="title" href="${href(row.url)}" target="_blank" rel="noopener noreferrer">${escape(row.title)}</a></td><td>${escape(row.summary)}</td><td>${escape(row.label)}</td></tr>`).join('')}</tbody></table></div></section>` : '';
  const nav = archives.length >= 4 ? `<aside class="rail" aria-label="页面目录">${runs.length ? '<a href="#searches">检索结果</a>' : ''}${archives.map((archive,index)=>`<a href="#source-${index+1}">${index+1}. ${escape(archive.content.title || '来源')}</a>`).join('')}</aside>` : '';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' file: data: https: http:; media-src 'self' file: data: https: http:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><title>${escape(title)}</title><style>${reportStyles}\n.compact{display:block;max-width:1120px}#searches table{min-width:640px;table-layout:fixed}#searches th:first-child{width:88px}#searches th:nth-child(2){width:210px}#searches td:first-child{white-space:nowrap}h2{font-size:22px;line-height:1.5;margin:0 0 14px}.meta,.source figcaption{font-size:15px}</style></head><body class="luz-report"><a class="skip" href="#main">跳到正文</a><div class="layout${nav ? '' : ' compact'}">${nav}<main id="main"><div class="hero"><h1>${escape(title)}</h1></div>${table}${overview}${archives.map((archive,index)=>`<section class="source-section">${sections[index]}</section>`).join('')}${archives.length || overview || table ? '' : '<section><div class="card notice">本次未取得目标正文。</div></section>'}</main></div></body></html>\n`;
}

async function taskRoot(directory) {
  let current = path.resolve(directory);
  while (true) {
    if (await findTaskArchive(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function sourceArchives(taskFolder) {
  const found = [];
  async function visit(directory) {
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) { await visit(file); continue; }
      if (entry.name !== 'manifest.json' || path.basename(directory).toLowerCase() !== 'raw') continue;
      const sourceFolder = path.dirname(directory);
      try {
        if (path.basename(sourceFolder) === 'raw') continue;
        if (!(await fs.stat(path.join(sourceFolder, 'raw', 'content.json'))).isFile()) continue;
        const archive = await readArchive(sourceFolder);
        if (archive) found.push(archive);
      } catch { /* An incomplete source remains in raw and is reported by its own manifest. */ }
    }
  }
  await visit(path.join(taskFolder, 'raw'));
  const seen = new Set();
  return found.filter(item => { const key = item.content.canonical_url || item.content.requested_url; if (seen.has(key)) return false; seen.add(key); return true; });
}

async function taskRuns(taskFolder) {
  const runs = [];
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(() => [])) {
      if (entry.isSymbolicLink()) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) { await visit(file); continue; }
      if (!/^(search-|batch-).*\.json$/.test(entry.name) && entry.name !== 'collection.json') continue;
      try {
        const value = JSON.parse(await fs.readFile(file, 'utf8'));
        if (entry.name.startsWith('search-')) runs.push({ platform: value.platform, query: value.query, status: value.status, task_id: value.task_id, error: value.error, candidates: value.candidates });
        else if (Array.isArray(value.results)) runs.push(...value.results.map(row => ({ platform: row.platform, query: row.query, url: row.url, status: row.status, task_id: row.task_id })));
      } catch { /* malformed records stay as raw evidence */ }
    }
  }
  await visit(path.join(taskFolder, 'raw'));
  return runs;
}

export async function refreshTaskReport(directory) {
  const folder = await taskRoot(directory);
  if (!folder) return null;
  return allocationLock(path.join(folder, 'raw'), async () => {
    const marker = await findTaskArchive(folder);
    const name = `${path.basename(folder)}.html`;
    const file = path.join(folder, name);
    const manifestFile = path.join(folder, 'raw', 'manifest.json');
    const htmlFiles = (await fs.readdir(folder)).filter(entry => /\.html?$/i.test(entry));
    if (htmlFiles.some(entry => entry !== name)) throw new Error('Task folder contains extra HTML files; archive them before refreshing.');
    if (await fs.access(manifestFile).then(() => true, () => false)) {
      const integrity = await verifyArchive(folder);
      if (!integrity.ok) throw new Error(`Task HTML or evidence was edited; refusing to overwrite it: ${integrity.failures.join(', ')}`);
    } else if (htmlFiles.length) throw new Error('Task HTML has no manifest; refusing to overwrite it.');
    const archives = await sourceArchives(folder);
    const runs = await taskRuns(folder);
    let summary;
    try { summary = JSON.parse(await fs.readFile(path.join(folder, 'raw', 'crawl-summary.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const html = await reportDocument(marker.title, archives, folder, runs, summary?.entries);
    await atomicWrite(file, html);
    const record = { schema_version: 3, kind: 'task_report', output_layout: 'task_html_and_raw_v3', primary_file: name, title: marker.title, captured_at: new Date().toISOString(), delivery: { file: name, bytes: Buffer.byteLength(html), sha256: hash(html) }, files: [{ path: name, bytes: Buffer.byteLength(html), sha256: hash(html) }] };
    await atomicWrite(manifestFile, record);
    return { folder, html_file: file, sources: archives.length, runs: runs.length };
  });
}

export async function appendMediaExport(folder, content, downloads, manifest) {
  const name = manifest.primary_file;
  if (!name?.endsWith('.html')) return null;
  if (path.basename(name) !== name) throw new Error('Export filename escapes archive.');
  const output = await deliveryRootForArchive(folder);
  const delivery = manifest.output_layout === 'html_and_raw_v1' ? path.join(output,name) : null;
  const file = manifest.source_file ? path.join(folder,manifest.source_file) : manifest.delivery ? delivery : path.join(folder,name);
  const original = await fs.readFile(file,'utf8');
  let base = original;
  if(manifest.delivery_media) { const start=base.lastIndexOf(marker); if(start>=0) base=base.slice(0,start)+'</body></html>\n'; }
  for (const image of (downloads.files || []).filter(file => /^image\//.test(file.mime))) {
    const data = `data:${image.mime};base64,${(await localMedia(folder, image)).toString('base64')}`;
    for (const url of new Set([image.url, image.url.replaceAll('&', '&amp;')])) base = base.split(url).join(data);
  }
  const markup = await sourceMarkup({folder,content,downloads},output);
  const html = base.replace(/media-src https: http:/,"media-src 'self' file: data: https: http:").replace(/<\/body>\s*<\/html>\s*$/i,`${marker}<style>${reportStyles}</style><div class="luz-report">${markup}</div></body></html>\n`);
  let delivered;
  if(delivery && delivery !== file) delivered = await fs.readFile(delivery,'utf8');
  try { await atomicWrite(file,html); if(delivery && delivery !== file) await atomicWrite(delivery,html); }
  catch(error) { await atomicWrite(file,original); if(delivery && delivery !== file) await atomicWrite(delivery,delivered); throw error; }
  return {file:delivery || file,path:manifest.source_file || name,external:Boolean(manifest.delivery),bytes:Buffer.byteLength(html),sha256:hash(html),images:(downloads.files || []).filter(file=>/^image\//.test(file.mime)).length,videos:(downloads.files || []).filter(file=>/^video\//.test(file.mime)).length,audios:(downloads.files || []).filter(file=>/^audio\//.test(file.mime)).length};
}
