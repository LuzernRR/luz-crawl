export function validateURL(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Only HTTP(S) page URLs without embedded credentials are supported.');
  }
  return url;
}

export function platformOf(value) {
  const host = validateURL(value).hostname.toLowerCase();
  const matches = (domain) => host === domain || host.endsWith(`.${domain}`);
  const domains = CATALOG.flatMap((site) => site.domains.map((domain) => ({ domain, id: site.id }))).sort((a, b) => b.domain.length - a.domain.length);
  for (const entry of domains) if (matches(entry.domain)) return entry.id;
  return 'web';
}

export function sourceURL(value) {
  const url = validateURL(value);
  // SPA paths identify analytics dashboards; ordinary in-page anchors do not.
  if (!/^#!?\//.test(url.hash)) url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_.+|fbclid|gclid|auth|authorization|access_token|refresh_token|api_key|session|sessionid|password|code)$/i.test(key)) url.searchParams.delete(key);
  }
  if (/^#!?\//.test(url.hash) && url.hash.includes('?')) {
    const prefix = url.hash.startsWith('#!') ? '#!' : '#';
    const fragment = new URL(url.hash.slice(prefix.length), url.origin);
    for (const key of [...fragment.searchParams.keys()]) if (/^(auth|authorization|access_token|refresh_token|api_key|session|sessionid|password|code)$/i.test(key)) fragment.searchParams.delete(key);
    url.hash = prefix + fragment.pathname + fragment.search;
  }
  return url.href;
}

export function canonicalURL(value) {
  const url = new URL(sourceURL(value));
  const platform = platformOf(url.href);
  if (platform === 'x') {
    const id = url.pathname.match(/\/(?:status|article)\/(\d+)/);
    if (id) return `https://x.com/i/${id[0].includes('/article/') ? 'article' : 'status'}/${id[1]}`;
  }
  if (platform === 'xhs') {
    const id = url.pathname.match(/\/(?:explore|discovery\/item|search_result)\/([a-f\d]+)/i);
    if (id) return `https://www.xiaohongshu.com/explore/${id[1]}`;
  }
  if (platform === 'youtube') {
    const id = url.searchParams.get('v') || (url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.pathname.match(/\/(?:shorts|embed)\/([^/]+)/)?.[1]);
    if (id) return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
  }
  if (platform === 'douyin') {
    const id = url.pathname.match(/\/(video|note)\/(\d+)/);
    if (id) return `https://www.douyin.com/${id[1]}/${id[2]}`;
  }
  for (const key of ['xsec_token', 'xsec_source', 'share', 'feature', 'si', 'source', 'ref', 'ref_src']) url.searchParams.delete(key);
  url.pathname = url.pathname.replace(/\/$/, '') || '/';
  return url.href;
}

export function searchURL(platform, query, site) {
  if (!query?.trim()) throw new Error('A non-empty search query is required.');
  const entry = CATALOG.find((item) => item.id === platform || item.aliases?.includes(platform));
  if (!entry) throw new Error(`Unknown platform: ${platform}. Register a website with remember, or capture its URL.`);
  return entry.search?.replaceAll('{query}', encodeURIComponent(site ? `site:${site} ${query.trim()}` : query.trim())) || entry.url;
}

export function decodedLink(value) {
  const url = validateURL(value);
  let target;
  if (/(^|\.)bing\.com$/.test(url.hostname) && url.pathname === '/ck/a') {
    const encoded = url.searchParams.get('u');
    if (encoded?.startsWith('a1')) target = Buffer.from(encoded.slice(2), 'base64url').toString('utf8');
  }
  if (/(^|\.)google\.com$/.test(url.hostname) && url.pathname === '/url') target = url.searchParams.get('q') || url.searchParams.get('url');
  if (/(^|\.)duckduckgo\.com$/.test(url.hostname)) target = url.searchParams.get('uddg');
  try { return target ? validateURL(target).href : url.href; } catch { return url.href; }
}

export function extractURLs(text) {
  const seen = new Set();
  return [...text.matchAll(/https?:\/\/[^\s<>\[\]"'`，。；）)]+/g)].map((match) => match[0]).filter((url) => {
    const key = canonicalURL(url);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
import { readFileSync } from 'node:fs';

export const CATALOG = JSON.parse(readFileSync(new URL('../catalog.json', import.meta.url), 'utf8')).sites;
