export interface FeedLink { url: string; title?: string; }

const FEED_TYPES = ['application/rss+xml', 'application/atom+xml', 'application/feed+json', 'application/json'];

/**
 * Feed discovery for plain website URLs: pull the <link rel="alternate"> feed
 * pointers out of a page, resolved against the page's URL. Falls back to common
 * feed paths when the page advertises nothing.
 */
export function discoverFeedLinks(html: string, pageUrl: string): FeedLink[] {
  const found: FeedLink[] = [];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const seen = new Set<string>();
  // Read only advertised feed metadata. DOM parsing decodes entities and
  // supports unquoted attributes without fetching or executing page content.
  for (const link of doc.querySelectorAll('link')) {
    const rel = (link.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
    if (!rel.includes('alternate')) continue;
    const type = (link.getAttribute('type') ?? '').split(';')[0].trim().toLowerCase();
    if (!FEED_TYPES.includes(type)) continue;
    const href = link.getAttribute('href')?.trim();
    if (!href) continue;
    try {
      const url = new URL(href, pageUrl);
      if (!['http:', 'https:'].includes(url.protocol) || seen.has(url.href)) continue;
      seen.add(url.href);
      found.push({ url: url.href, title: link.getAttribute('title') ?? undefined });
    } catch { /* unresolvable href */ }
  }
  if (!found.length) {
    for (const candidate of ['/feed', '/feed/', '/rss', '/rss.xml', '/atom.xml', '/feed.xml', '/index.xml']) {
      try { found.push({ url: new URL(candidate, pageUrl).toString() }); } catch { /* bad base */ }
    }
  }
  return found;
}

/** Loose feed-URL identity for duplicate checks: scheme, "www.", case and trailing slashes don't count. */
export function feedUrlKey(value: string | undefined): string {
  if (!value) return '';
  return value.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
}
