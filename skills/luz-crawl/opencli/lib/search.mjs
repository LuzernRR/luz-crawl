import fs from 'node:fs/promises';
import path from 'node:path';
import { capture } from './capture.mjs';
import { clickSearchResult } from './extract-page.mjs';
import { resolveSite } from './memory.mjs';
import { canonicalURL, decodedLink, validateURL, sourceURL } from './platforms.mjs';
import { atomicWrite, recordExperience } from './archive.mjs';

export function sourceCandidates(content, site, external = false) {
  const seen = new Set();
  const pattern = site.detail ? new RegExp(site.detail, 'i') : null;
  return content.links.flatMap((item) => {
    let url;
    try { url = decodedLink(item.url); } catch { return []; }
    const parsed = validateURL(url);
    if (!external && !site.domains.some((domain) => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`))) return [];
    if (external && /(^|\.)(bing\.com|google\.com|sogou\.com|so\.com|duckduckgo\.com)$/.test(parsed.hostname)) return [];
    if (pattern && !pattern.test(url)) return [];
    if (/\/(login|signin|signup|privacy|terms|help|about)(?:[/?#]|$)/i.test(parsed.pathname)) return [];
    if (parsed.pathname === '/' && !/^#!?\//.test(parsed.hash)) return [];
    const key = canonicalURL(url);
    if (seen.has(key) || key === canonicalURL(content.requested_url)) return [];
    seen.add(key); return [{ ...item, url }];
  });
}

export function publicSourceAlternate(url) {
  const parsed = validateURL(url);
  const video = parsed.pathname.match(/\/video\/(\d+)/)?.[1];
  if (parsed.hostname === 'jingxuan.douyin.com' && video) return `https://www.douyin.com/video/${video}`;
  if (parsed.hostname === 'apps.weibo.com' && /^\/\d+\/[a-z0-9]+$/i.test(parsed.pathname)) { parsed.hostname = 'weibo.com'; return parsed.href; }
  if (parsed.hostname === 'www.reddit.com' && /\/comments\//.test(parsed.pathname)) { parsed.hostname = 'old.reddit.com'; return parsed.href; }
  return null;
}

export async function search(page, kwargs) {
  const count = Number(kwargs.read || 0);
  if (!Number.isInteger(count) || count < 0 || count > 20) throw new Error('--read must be 0-20.');
  if (!kwargs.query?.trim()) throw new Error('A non-empty search query is required.');
  const site = await resolveSite(kwargs.platform, kwargs.query, kwargs.site);
  const query = site.query;
  const routes = [{ kind: 'native', url: site.search?.replaceAll('{query}', encodeURIComponent(query)) || site.url, form: site.mode ? { mode: site.mode, parameter: site.parameter, entry_url: site.form_url } : undefined }];
  for (const url of site.alternates || []) routes.push({ kind: 'public_alternate', url: url.replaceAll('{query}', encodeURIComponent(query)) });
  if (site.public_index) routes.push({ kind: 'public_index', url: `https://www.bing.com/search?q=${encodeURIComponent(`site:${site.index_domain || site.domains[0]} ${kwargs.query}`)}` });
  if (site.preferred_route) routes.sort((a, b) => Number(b.kind === site.preferred_route) - Number(a.kind === site.preferred_route));
  let discovery;
  let candidates = [];
  let nativeGate;
  const attempts = [];
  for (const route of routes.slice(0, 3)) {
    console.error(`[LuzCrawl] ${site.name}: ${route.kind} browser search`);
    let current;
    try { current = await capture(page, { ...kwargs, resume: true, url: route.url, query, search_platform: site.id, search_form: route.form }); }
    catch (error) { attempts.push({ route_kind: route.kind, url: sourceURL(route.url), status: 'failed', error: error.message, search_performed: false, candidates: 0 }); continue; }
    const content = JSON.parse(await fs.readFile(path.join(current.folder, 'raw/content.json'), 'utf8'));
    const performed = Boolean(current.search_action?.submitted);
    const needsAccount = site.account && !performed && current.search_action?.login_visible;
    const gate = ['login_required', 'verification_required'].includes(current.stop_reason) ? current.stop_reason : needsAccount ? 'login_required' : null;
    if (route.kind !== 'public_index' && gate) nativeGate ||= { reason: gate, url: route.url };
    const found = performed && !gate && current.url_check?.valid_content ? sourceCandidates(content, site, site.external_results && !kwargs.site) : [];
    attempts.push({ route_kind: route.kind, url: sourceURL(route.url), resolved_url: current.resolved_url, url_check: current.url_check, search_performed: performed, status: current.status, gate, candidates: found.length, folder: current.folder, html_file: current.html_file, stop_reason: current.stop_reason });
    await recordExperience({ platform: site.id, extractor_version: '2.3.0', canonical_url: canonicalURL(route.url), query: kwargs.query, status: gate ? 'awaiting_user' : current.status, stop_reason: gate || current.stop_reason, route_kind: route.kind, search_performed: performed, valid_content: Boolean(current.url_check?.valid_content), resolved_url: current.resolved_url, candidates: found.length, lesson: current.limitations.join('; ') });
    discovery = { ...current, search_url: sourceURL(route.url), route_kind: route.kind };
    if (found.length) { candidates = found; break; }
  }
  const sources = [];
  let awaiting;
  if (!discovery) return { status: 'failed', search_url: routes[0].url, platform: site.id, query: kwargs.query, attempts, search_performed: false, error: attempts.at(-1)?.error || 'All browser routes failed.' };
  for (const [index, link] of candidates.slice(0, count).entries()) {
    let currentPage = false;
    if (site.id === 'xhs' && discovery.route_kind === 'native') {
      await page.goto(discovery.search_url);
      for (let attempt = 0; attempt < 10 && !currentPage; attempt++) {
        currentPage = await page.evaluate(`(${clickSearchResult.toString()})(${JSON.stringify({ url: link.url })})`);
        if (!currentPage) await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    const alternate = publicSourceAlternate(link.url);
    const learned = alternate && site.source_corrections.some((event) => event.source_host === new URL(link.url).hostname && event.verified_host === new URL(alternate).hostname);
    let source = await capture(page, { ...kwargs, resume: true, query: '', search_form: undefined, current_page: currentPage, url: learned ? alternate : link.url });
    if (alternate && !learned && !source.url_check?.valid_content && source.stop_reason !== 'verification_required' && (source.stop_reason !== 'login_required' || new URL(link.url).hostname === 'apps.weibo.com')) {
      const original = source;
      source = await capture(page, { ...kwargs, resume: true, query: '', search_form: undefined, url: alternate });
      source.url_correction = { original: sourceURL(link.url), alternate, original_status: original.status, original_reason: original.stop_reason, validated: Boolean(source.url_check?.valid_content) };
      await recordExperience({ platform: site.id, extractor_version: '2.3.0', canonical_url: canonicalURL(link.url), status: source.status, stop_reason: source.stop_reason, route_kind: 'source_url_correction', source_host: new URL(link.url).hostname, verified_host: new URL(alternate).hostname, validated_url: source.url_check?.valid_content ? source.resolved_url : undefined, lesson: `${source.url_check?.valid_content ? 'Verified' : 'Unverified'} public page for the same content ID: ${sourceURL(alternate)}` });
    }
    sources.push({ url: sourceURL(link.url), ...source });
    if (['login_required', 'verification_required'].includes(source.stop_reason)) { awaiting = { reason: source.stop_reason, url: source.url_correction?.alternate || link.url }; break; }
  }
  if (!candidates.length && nativeGate) { awaiting = nativeGate; await page.goto(nativeGate.url); }
  const result = { ...discovery, platform: site.id, platform_name: site.name, query: kwargs.query, scope: 'search_candidates_and_opened_sources', search_performed: attempts.some((item) => item.search_performed), search_status: candidates.length ? 'candidates_found' : awaiting ? 'awaiting_user' : 'no_verified_candidates', discovery_status: discovery.status, status: awaiting ? 'awaiting_user' : !candidates.length || sources.length < count || sources.some((item) => item.status !== 'captured') ? 'partial' : discovery.status, attempts, discovered_candidates: candidates.length, candidates: candidates.slice(0, 100), requested_sources: count, opened_sources: sources.length, verified_sources: sources.filter((item) => item.status === 'captured').length, sources, suggested_queries: site.suggested_queries, preferred_keywords: site.preferred_keywords, ...(awaiting ? { requires_user: true, awaiting_reason: awaiting.reason, handover_url: sourceURL(awaiting.url) } : {}) };
  const indexFile = path.resolve(kwargs.out, 'raw', `search-${path.basename(discovery.folder)}.json`);
  await atomicWrite(indexFile, result);
  return { ...result, search_index: indexFile };
}
