import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { lookup as lookupHost } from 'node:dns';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import { validateURL } from './platforms.mjs';
import { VERSION } from './version.mjs';
const agents = { 'http:': new http.Agent({ proxyEnv: process.env }), 'https:': new https.Agent({ proxyEnv: process.env }) };

export function privateAddress(address) {
  if (isIP(address) === 6) return !/^[23][\da-f]{3}:/i.test(address);
  const [a, b] = address.split('.').map(Number);
  return !isIP(address) || a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && [0, 168].includes(b) || a === 100 && b >= 64 && b <= 127 || a === 198 && [18, 19].includes(b);
}

export function validateMediaURL(value, source) {
  const url = validateURL(value);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if ((host === 'localhost' || isIP(host) && privateAddress(host)) && url.origin !== validateURL(source).origin) throw new Error('A public page cannot download from another local origin.');
  return url.href;
}

// Pin direct connections; an explicitly configured proxy resolves the checked public host itself.
export async function fetchMedia(value, source, options = {}, redirects = 0) {
  const url = validateURL(validateMediaURL(value, source));
  const sourceURL = validateURL(source);
  const sourceHost = sourceURL.hostname.replace(/^\[|\]$/g, '');
  const allowLocal = url.origin === sourceURL.origin && (sourceHost === 'localhost' || isIP(sourceHost) && privateAddress(sourceHost));
  const addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true });
  if (!addresses.length || !allowLocal && addresses.some(({ address }) => privateAddress(address))) throw new Error('Media host must resolve to public addresses.');
  const address = addresses[0];
  const biliMedia = /(^|\.)bilibili\.com$/.test(sourceURL.hostname) && /(^|\.)(bilivideo\.com|hdslb\.com)$/.test(url.hostname);
  const response = await new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).get(url, {
      signal: options.signal,
      agent: agents[url.protocol],
      lookup: (hostname, settings, callback) => hostname === url.hostname.replace(/^\[|\]$/g, '') ? settings.all ? callback(null, [address]) : callback(null, address.address, address.family) : lookupHost(hostname, settings, callback),
      headers: { Accept: '*/*', 'User-Agent': `LuzCrawl/${VERSION}`, ...(biliMedia ? { Referer: 'https://www.bilibili.com/' } : {}) },
    }, resolve);
    request.on('error', reject);
  });
  if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
    response.destroy();
    if (redirects >= 5) throw new Error('Too many media redirects.');
    return fetchMedia(new URL(response.headers.location, url).href, source, options, redirects + 1);
  }
  return { ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode, headers: new Headers(Object.entries(response.headers).filter(([, value]) => value !== undefined).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value])), body: Readable.toWeb(response) };
}
