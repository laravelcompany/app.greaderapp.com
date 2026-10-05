import dns from 'node:dns/promises';
import net from 'node:net';

export const MAX_FEED_BYTES = 5 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 15_000;
export const MAX_REDIRECTS = 3;
export const ALLOWED_PORTS = new Set(['', '80', '443']);

export class FeedPolicyError extends Error {
  constructor(message) { super(message); this.name = 'FeedPolicyError'; this.code = 'blocked_target'; }
}

function ipv4Private(ip) {
  const n = ip.split('.').map(Number);
  return n[0] === 0 || n[0] === 10 || n[0] === 127 || n[0] >= 224 ||
    (n[0] === 100 && n[1] >= 64 && n[1] <= 127) || (n[0] === 169 && n[1] === 254) ||
    (n[0] === 172 && n[1] >= 16 && n[1] <= 31) || (n[0] === 192 && n[1] === 0) ||
    (n[0] === 192 && n[1] === 168) || (n[0] === 198 && (n[1] === 18 || n[1] === 19));
}

export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) return ipv4Private(ip);
  if (!net.isIPv6(ip)) return true;
  const value = ip.toLowerCase();
  return value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd') ||
    value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb') ||
    value.startsWith('ff') || (value.startsWith('::ffff:') && ipv4Private(value.slice(7)));
}

export function parsePublicHttpUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new FeedPolicyError('Invalid feed URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new FeedPolicyError('Only HTTP(S) feed URLs are allowed');
  if (url.username || url.password) throw new FeedPolicyError('Feed URLs cannot contain credentials');
  if (!ALLOWED_PORTS.has(url.port)) throw new FeedPolicyError('Only ports 80 and 443 are allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) throw new FeedPolicyError('Private hosts are blocked');
  if (net.isIP(host) && isPrivateAddress(host)) throw new FeedPolicyError('Private addresses are blocked');
  return url;
}

export async function resolvePublic(url, lookup = dns.lookup) {
  const records = await lookup(url.hostname, { all: true, verbatim: true });
  if (!records.length || records.some(record => isPrivateAddress(record.address))) throw new FeedPolicyError('Feed host resolves to a private or unavailable address');
  return records[0];
}

export function allowedContentType(value = '') {
  // text/html is allowed so a pasted website URL can be scanned for its feed
  // links (the native HTTP path imposes no content-type gate at all); the SSRF
  // policy and size cap still bound what comes back.
  return /^application\/(?:feed\+json|json)(?:;|$)/i.test(value) || /(^|\/|\+)(xml|rss|atom|html)($|;)|^text\/(plain|html)(?:;|$)|^application\/octet-stream(?:;|$)/i.test(value);
}
