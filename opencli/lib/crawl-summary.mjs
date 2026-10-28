import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWrite, findTaskArchive } from './archive.mjs';
import { refreshTaskReport } from './report.mjs';

const clean = value => String(value || '').replace(/https?:\/\/[^\s<>"）)]+/g, '').replace(/\s+/g, ' ').trim();
const queues = new Map();
const names = {'ggzy.gov.cn':'全国公共资源交易平台','ygp.gdzwfw.gov.cn':'广东省公共资源交易平台','gdgpo.czt.gd.gov.cn':'广东省政府采购网','fszc.zcjb.com.cn':'佛山阳光采购平台','qianlima.com':'千里马招标网','yfbzb.com':'乙方宝','bidcenter.com.cn':'采招网','qcc.com':'企查查','xydec.com.cn':'星艺装饰官网','mingdiao.com.cn':'名雕装饰官网','mjdec.com':'名匠装饰官网','szecp.com.cn':'华润守正采购平台','search.crc.com.cn':'华润站内搜索','plap.mil.cn':'军队采购网','lw.gov.cn':'荔湾区政府网站','powerchina.cn':'中国电建采购平台','szygcg.com':'深圳阳光采购平台','zcg.szcg.cn':'特区建工采购平台'};

async function taskRoot(directory) {
  const initial = path.resolve(directory);
  for (let current = initial; ; current = path.dirname(current)) {
    if (await findTaskArchive(current)) return current;
    if (current === path.dirname(current)) return initial;
  }
}

// Ignore media, snapshots and symlinks; the summary reads persisted evidence only.
async function evidenceFiles(root) {
  let entries;
  try { entries = await fs.readdir(root, {withFileTypes:true}); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const files = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const file = path.join(root, entry.name);
    if (entry.isDirectory() && !['snapshots','browser-actions','media','downloads','platform-probes'].includes(entry.name)) files.push(...await evidenceFiles(file));
    else if (entry.isFile() && entry.name.endsWith('.json') && (['content.json','collection.json'].includes(entry.name) || /^(batch-|search-)/.test(entry.name) || path.basename(root) === 'tasks')) files.push(file);
  }
  return files;
}

export function summaryEntry(result, at = '', fallbackURL) {
  if (!result || typeof result !== 'object') return null;
  const actions = Array.isArray(result.results) ? result.results : [];
  const observed = actions.filter(v => v.value?.url).at(-1)?.value;
  const read = actions.filter(v => ['read','extract'].includes(v.action) && v.value?.text).at(-1)?.value;
  const extracted = actions.filter(v => v.action === 'extract' && (!observed || v.value?.url === observed.url)).at(-1)?.value;
  const post = result.post || extracted?.post || {};
  let url;
  try {
    const parsed = new URL(result.inspection?.url || observed?.url || result.resolved_url || result.handover_url || result.search_url || result.requested_url || result.url || fallbackURL);
    if (!['https:','http:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    url = parsed.href;
  } catch { return null; }
  const text = String(post.text || result.text || (read?.url === observed?.url ? read?.text : '') || result.items?.filter(v => v.kind !== 'page_shell').map(v => v.text || '').join('\n') || '');
  const title = clean(result.title || post.title || result.inspection?.title || observed?.title || result.query || '页面详情').slice(0,110) || '页面详情';
  const status = result.status || 'unknown';
  const labels = {captured:'已保存',completed:'动作完成',partial:'部分获取',awaiting_user:'需人工处理',blocked:'受阻',failed:'失败',skipped:'未访问'};
  const lines = text.split(/[\r\n]+/).map(clean).filter(v => v.length >= 8 && !/^Copyright|^版权所有/i.test(v));
  const excerpt = (lines.find(v => v.includes(title.slice(0,15))) || lines.find(v => v.length >= 50) || lines[0] || '').slice(0,125);
  const count = Number(result.discovered_candidates ?? result.candidates?.length ?? 0);
  const media = result.media || extracted?.media || [];
  const images = post.images?.length || media.filter(v=>v.kind === 'image').length, videos = post.videos?.length || media.filter(v=>v.kind === 'video').length;
  const audios = post.audios?.length || media.filter(v=>v.kind === 'audio').length;
  const reason = result.awaiting_reason || result.stop_reason || result.failure?.code || '';
  const reasons = {login_required:'需要登录',verification_required:'需要验证',rate_limited:'平台限流',access_denied:'访问被拒绝',operation_budget:'操作预算已用尽'};
  const summary = status === 'skipped' ? '同站前序任务受阻，本页尚未访问。' : ['failed','blocked','awaiting_user'].includes(status) ? `${text ? `保留${text.length}字可见文字；` : '未取得可用正文；'}${clean(reasons[reason] || reason || result.error?.message || result.error || '等待处理')}。` : `${excerpt ? `取得“${excerpt}${excerpt.length === 125 ? '…' : ''}”等可见内容` : text ? '取得页面可见文字' : '没有取得目标正文'}${text ? `（约${text.length}字）` : ''}${count ? `，发现${count}条候选，详情须另行核验` : ''}${images || videos || audios ? `，观察到${images}张图片、${videos}段视频、${audios}段音频` : ''}。`;
  const host = new URL(url).hostname;
  const site = Object.entries(names).find(([domain]) => host === domain || host.endsWith('.'+domain))?.[1] || clean(result.platform_name || title);
  return {url,host,site,title,status,label:labels[status] || '待核验',summary,chars:text.length,body_observed:typeof result.text === 'string' || Array.isArray(result.items) || actions.some(v=>['read','extract'].includes(v.action)),at:result.captured_at || result.finished_at || at || ''};
}

export async function writeCrawlSummary(directory) {
  const root = await taskRoot(directory), previous = queues.get(root) || Promise.resolve();
  const pending = previous.catch(() => {}).then(async () => {
    const rows = new Map(), warnings = [];
    const put = (value, at, fallback) => {
      const row = summaryEntry(value, at, fallback);
      if (!row) return;
      const old = rows.get(row.url);
      if (!old || row.at >= old.at) {
        // Session results can omit the body already persisted by the same successful capture.
        if (old?.chars && !row.chars && ['captured','completed','partial'].includes(row.status) && row.status === old.status && !row.body_observed) {
          Object.assign(row,{title:old.title,site:old.site,summary:old.summary,chars:old.chars});
        }
        rows.set(row.url,row);
      } else if (row.chars && !old.chars && row.status === old.status && !old.body_observed) {
        rows.set(row.url,{...row,at:old.at});
      }
    };
    for (const file of await evidenceFiles(root)) {
      let value;
      try { value = JSON.parse(await fs.readFile(file,'utf8')); }
      catch (error) { warnings.push(`${path.basename(file)}: ${error.message}`); continue; }
      if (value.result) put(value.result,value.at,value.url || value.options?.url);
      else if (path.basename(file).startsWith('batch-') || path.basename(file) === 'collection.json') for (const row of value.results || []) put(row,row.finished_at || value.created_at,row.url);
      else { put(value,value.at); for (const source of value.sources || []) if (typeof source === 'object') put(source,value.at); }
    }
    const entries = [...rows.values()].sort((a,b) => a.host.localeCompare(b.host) || b.at.localeCompare(a.at));
    const visited = entries.filter(v => v.status !== 'skipped'), sites = new Set(visited.map(v => v.host));
    const file = path.join(root, 'raw', 'crawl-summary.json');
    const summary = {websites:sites.size,pages:visited.length,records:entries.length,entries,warnings};
    await atomicWrite(file, summary);
    const report = await refreshTaskReport(root);
    return {file,...summary,...(report ? {html_file:report.html_file} : {})};
  });
  queues.set(root,pending);
  try { return await pending; } finally { if (queues.get(root) === pending) queues.delete(root); }
}
