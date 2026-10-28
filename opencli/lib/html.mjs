import { httpFailure, classifyFailure } from './failure.mjs';
import { createExecutionPolicy } from './execution.mjs';
const escape = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

export async function htmlDocument(result, fetchAsset, options = {}) {
  const presentation = result.presentation;
  let content = presentation?.html || `<h1>${escape(result.title)}</h1>${result.items.map((item) => `<section><p>${escape(item.author)}</p><div style="white-space:pre-wrap">${escape(item.text)}</div></section>`).join('')}`;
  let fonts = [...(presentation?.fonts || []), presentation?.styles || ''].join('\n').replace(/</g, '\\3c ');
  const assets = [...new Map((presentation?.assets || []).filter((item) => /^https?:\/\//.test(item.url)).map((item) => [item.url, item])).values()];
  const replacements = new Map();
  const failures = [];
  const policy = await createExecutionPolicy({ profile: result.browser_profile, ...options });
  // Discovery thumbnails and a requested media export must not trigger duplicate downloads.
  for (const asset of result.query || options.deferMedia ? [] : assets) {
      try {
        const embedded = await policy.run('media', result.resolved_url || result.requested_url, async () => {
        const options = { signal: AbortSignal.timeout(12000), timeoutMs: 12000, maxBytes: 20 * 1024 * 1024, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'manual' };
        if (!fetchAsset) throw new Error('Resource embedding requires a live LuzCrawl browser page.');
        const response = await fetchAsset(asset.url, options);
        if (!response.ok) { await response.body?.cancel(); throw httpFailure(response); }
        const mime = (response.headers.get('content-type') || '').split(';')[0];
        if (!(asset.kind === 'font' ? /^(font\/|application\/(?:font|x-font|octet-stream))/.test(mime) : /^image\//.test(mime))) { await response.body?.cancel(); throw new Error(`Unexpected MIME: ${mime}`); }
        const chunks = []; let size = 0;
        for await (const chunk of response.body) { size += chunk.length; if (size > 20 * 1024 * 1024) throw new Error('Asset exceeds 20 MiB'); chunks.push(chunk); }
        return `data:${mime};base64,${Buffer.concat(chunks).toString('base64')}`;
        }, { label: 'embed_' + asset.kind });
        replacements.set(asset.url, embedded);
      } catch (error) {
        const failure = classifyFailure(error); failures.push({ url: asset.url, error: failure.message, failure: failure.toJSON() });
        if (['rate_limited', 'operation_budget', 'login_required', 'verification_required', 'cancelled'].includes(failure.code)) {
          for (const pending of assets.slice(assets.indexOf(asset) + 1)) failures.push({ url: pending.url, error: 'Skipped after ' + failure.code });
          break;
        }
      }
  }
  for (const [url, data] of replacements) {
    for (const encoded of new Set([url, url.replaceAll('&', '&amp;')])) { content = content.split(encoded).join(data); fonts = fonts.split(encoded).join(data); }
  }
  result.offline = { resources: assets.length, embedded: replacements.size, remote_search_resources: Boolean(result.query), media_export_deferred: Boolean(options.deferMedia), failures };
  result.layout_fidelity = presentation ? 'source_dom_and_computed_styles' : 'text_only';
  if (!presentation) result.limitations.push('未取得原页面排版 DOM；此 HTML 仅保存可核验文本，不能称为原排版');
  if (failures.length) result.limitations.push(`${failures.length} 个图片/字体资源未能内嵌，保留原地址`);
  if (result.platform === 'x' && (!presentation || failures.length) && result.status === 'captured') result.status = 'partial';
  const width = Math.max(280, Math.min(1600, Number(presentation?.width) || 680));
  return `<!DOCTYPE html>\n<html lang="${escape(presentation?.lang || 'zh-CN')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'; font-src data: https: http:; media-src https: http:; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><meta name="source-url" content="${escape(result.requested_url)}"><title>${escape(result.title)}</title><style>${fonts}\nhtml{background:${presentation?.background || '#fff'};color:${presentation?.color || '#0f1419'}}body{margin:0 auto;width:${width}px;max-width:100%;font-family:Arial,sans-serif}img{max-width:100%}.luz-source{font:12px/1.6 sans-serif;color:#536471;padding:24px 16px;overflow-wrap:anywhere}</style></head><body>${content}<footer class="luz-source"><a href="${escape(result.requested_url)}" target="_blank" rel="noopener noreferrer">查看原文</a> · ${escape(result.captured_at)} · ${escape(result.status)}</footer></body></html>\n`;
}
