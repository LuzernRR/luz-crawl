import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWrite, hash, verifyArchive } from './archive.mjs';
import { validateURL } from './platforms.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const href = value => { try { return escape(validateURL(value).href); } catch { return ''; } };
const fileLink = (output, file) => path.relative(output,file).split(path.sep).map(encodeURIComponent).join('/');
const marker = '\n<!-- LUZCRAWL_ARCHIVE_MEDIA -->\n';
export const reportStyles = `.luz-report{font:14px/1.65 system-ui,-apple-system,"Microsoft YaHei",sans-serif;color:#35483b;background:#f9fcf6;overflow-wrap:anywhere}.luz-report main{max-width:980px;margin:auto;padding:24px 20px}.luz-report h1{font-size:26px;line-height:1.3;margin:0 0 8px}.luz-report h2{font-size:20px;line-height:1.4;margin:0 0 8px}.luz-report h3{font-size:14px;margin:16px 0 6px}.luz-report p{margin:6px 0}.luz-report a{color:#557d5e}.luz-report article{margin:18px 0;padding:18px;background:#fff;border:1px solid #deead9;border-radius:10px}.luz-report .meta{font-size:12px;color:#71816d}.luz-report .body{white-space:pre-wrap;margin:12px 0}.luz-report .pictures{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}.luz-report img{display:block;width:100%;max-height:700px;object-fit:contain;border-radius:6px}.luz-report video{display:block;width:100%;max-height:70vh;background:#18251c;border-radius:6px;margin:10px 0}.luz-report figure{margin:0}.luz-report figcaption{font-size:12px;margin:4px 0 12px}.luz-report details{margin:10px 0}.luz-report summary{cursor:pointer;color:#557d5e}.luz-report .comment{padding:9px 0;border-bottom:1px solid #edf2e9}.luz-report table{width:100%;border-collapse:collapse;font-size:12px;text-align:left}.luz-report td,.luz-report th{padding:7px;border-bottom:1px solid #e4ecdf;vertical-align:top}.luz-report th{background:#edf4e8}.luz-report ul{padding-left:20px}.luz-report .notice{font-size:12px;color:#816644}.luz-report :focus-visible{outline:2px solid #91b39a;outline-offset:3px}@media(max-width:600px){.luz-report main{padding:16px 10px}.luz-report article{padding:12px}.luz-report .pictures{grid-template-columns:1fr}}`;

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
  const files = downloads.files || [];
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
  const metrics = Object.entries({likes:'赞',comments:'评',favorites:'藏',shares:'分享',views:'播放 / 浏览'}).flatMap(([key,label]) => post.engagement?.[key]?.value != null ? [`${label} ${escape(post.engagement[key].raw || post.engagement[key].value)}`] : []).join(' · ');
  const author = post.account?.name || (content.items || []).find(item => item.author)?.author || '';
  const accountURL = href(post.account?.profile_url);
  const source = href(content.resolved_url || content.requested_url);
  const status = content.status === 'captured' ? '已获取' : '本次已取得的内容';
  const body = texts.map(text => `<div class="body">${escape(text)}</div>`).join('');
  const replies = comments.map(comment => `<div class="comment"><div class="meta">${escape(comment.account?.name || comment.author || '')}${comment.time ? ' · '+escape(comment.time) : ''}</div><div class="body">${escape(comment.text)}</div></div>`).join('');
  const transcript = (content.transcript || []).map(item => `<div>${escape(item.time)} ${escape(item.text)}</div>`).join('');
  return `<article id="source-${index}" data-source-url="${source}"><h2>${index}. ${escape(post.title || content.title)}</h2><p class="meta">${accountURL ? `<a href="${accountURL}" target="_blank" rel="noopener noreferrer">${escape(author)}</a>` : escape(author)} · ${escape(content.platform)} · ${escape(content.captured_at)} · ${status}</p><p class="meta">${metrics}</p><p class="meta"><a href="${source}" target="_blank" rel="noopener noreferrer">查看原文</a></p>${body}${pictures.length ? '<h3>图片</h3><div class="pictures">'+pictures.join('')+'</div>' : ''}${videos.length ? '<h3>视频</h3>'+videos.join('') : post.videos?.length ? '<p class="notice">视频未下载成功，播放文件尚不可用。</p>' : ''}${replies ? `<details open><summary>已加载评论 ${comments.length} 条</summary>${replies}</details>` : ''}${transcript ? `<details open><summary>已取得的字幕</summary>${transcript}</details>` : ''}${content.limitations?.length ? '<details><summary>采集范围</summary><ul>'+content.limitations.map(item=>`<li>${escape(item)}</li>`).join('')+'</ul></details>' : ''}</article>`;
}

export async function reportDocument(title, archives, output, runs=[]) {
  const sections=[];
  for(const [index,archive] of archives.entries()) sections.push(await sourceMarkup(archive,output,index+1));
  const table = runs.length ? `<details open><summary>本次检索 ${runs.length} 个任务</summary><table><thead><tr><th>平台</th><th>关键词 / 链接</th><th>结果</th></tr></thead><tbody>${runs.map(run=>`<tr><td>${escape(run.platform || '链接')}</td><td>${escape(run.query || run.url)}</td><td>${escape(run.status)}${run.task_id ? ' · 待手动验证 '+escape(run.task_id) : ''}</td></tr>`).join('')}</tbody></table></details>` : '';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' file: data: https: http:; media-src 'self' file: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><title>${escape(title)}</title><style>${reportStyles}</style></head><body class="luz-report"><main><h1>${escape(title)}</h1><p class="meta">LuzCrawl · ${archives.length} 个已读取来源 · ${escape(new Date().toISOString())}</p><p class="meta">图片已保存时直接内嵌；视频从 raw/ 播放。文字与评论按本次实际取得的内容展示。</p>${table}<nav>${archives.map((archive,index)=>`<a href="#source-${index+1}">${index+1}. ${escape(archive.content.title)}</a>`).join(' · ')}</nav>${sections.join('')}${archives.length ? '' : '<p class="notice">本次未取得可核验的目标正文，详情保存在 raw/。</p>'}</main></body></html>\n`;
}

export async function appendMediaExport(folder, content, downloads, manifest) {
  const name = manifest.primary_file;
  if (!name?.endsWith('.html')) return null;
  if (path.basename(name) !== name) throw new Error('Export filename escapes archive.');
  const file = path.join(folder,name);
  const original = await fs.readFile(file,'utf8');
  let base = original;
  if(manifest.delivery_media) { const start=base.lastIndexOf(marker); if(start>=0) base=base.slice(0,start)+'</body></html>\n'; }
  const markup = await sourceMarkup({folder,content,downloads},path.dirname(path.dirname(folder)));
  const html = base.replace(/media-src https: http:/,"media-src 'self' file: data: https: http:").replace(/<\/body>\s*<\/html>\s*$/i,`${marker}<style>${reportStyles}</style><div class="luz-report">${markup}</div></body></html>\n`);
  const delivery = manifest.output_layout === 'html_and_raw_v1' ? path.join(path.dirname(path.dirname(folder)),name) : null;
  let delivered;
  if(delivery) delivered = await fs.readFile(delivery,'utf8');
  try { await atomicWrite(file,html); if(delivery) await atomicWrite(delivery,html); }
  catch(error) { await atomicWrite(file,original); if(delivery) await atomicWrite(delivery,delivered); throw error; }
  return {file:delivery || file,path:name,bytes:Buffer.byteLength(html),sha256:hash(html),images:(downloads.files || []).filter(file=>/^image\//.test(file.mime)).length,videos:(downloads.files || []).filter(file=>/^video\//.test(file.mime)).length};
}
