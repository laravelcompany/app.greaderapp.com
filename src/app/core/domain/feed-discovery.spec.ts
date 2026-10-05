import { describe, expect, it } from 'vitest';
import { discoverFeedLinks } from './feed-discovery';

describe('feed discovery', () => {
  it('finds an advertised RSS link and resolves it against the page', () => {
    const html = '<html><head><link rel="alternate" type="application/rss+xml" title="Blog" href="/feed.xml"></head></html>';
    expect(discoverFeedLinks(html, 'https://example.com/blog')).toEqual([{ url: 'https://example.com/feed.xml', title: 'Blog' }]);
  });

  it('handles atom links and absolute hrefs with single quotes', () => {
    const html = "<link rel='alternate' type='application/atom+xml' href='https://feeds.example.com/atom'>";
    expect(discoverFeedLinks(html, 'https://example.com')[0].url).toBe('https://feeds.example.com/atom');
  });

  it('collects multiple advertised feeds', () => {
    const html = '<link rel="alternate" type="application/rss+xml" href="/rss"><link rel="alternate" type="application/atom+xml" href="/atom">';
    expect(discoverFeedLinks(html, 'https://example.com')).toHaveLength(2);
  });

  it('ignores non-feed alternates', () => {
    const html = '<link rel="alternate" type="text/html" hreflang="fr" href="/fr">';
    const links = discoverFeedLinks(html, 'https://example.com');
    expect(links.every(l => l.url !== 'https://example.com/fr')).toBe(true);
  });

  it('falls back to common feed paths when the page advertises nothing', () => {
    const links = discoverFeedLinks('<html></html>', 'https://example.com/blog/');
    expect(links.map(l => l.url)).toContain('https://example.com/feed');
    expect(links.map(l => l.url)).toContain('https://example.com/rss.xml');
  });
});

describe('feedUrlKey', () => {
  it('treats http/https, www, case and trailing slash as the same feed', async () => {
    const { feedUrlKey } = await import('./feed-discovery');
    expect(feedUrlKey('http://www.Example.com/feed/')).toBe(feedUrlKey('https://example.com/feed'));
    expect(feedUrlKey('https://example.com/feed')).not.toBe(feedUrlKey('https://example.com/rss'));
    expect(feedUrlKey(undefined)).toBe('');
  });
});


describe('website feed metadata', () => {
  it('decodes HTML entities in feed URLs and titles', () => {
    expect(discoverFeedLinks('<link rel="alternate" type="application/rss+xml" href="/rss?a=1&amp;b=2" title="News &amp; Views">', 'https://example.com/')).toEqual([
      { url: 'https://example.com/rss?a=1&b=2', title: 'News & Views' },
    ]);
  });
  it('supports unquoted attributes, mixed-case tokens and MIME parameters', () => {
    expect(discoverFeedLinks('<link rel="ALTERNATE stylesheet" type="Application/Atom+Xml; charset=utf-8" href=/atom>', 'https://example.com/')[0].url).toBe('https://example.com/atom');
  });
  it('ignores comments, prefix lookalikes and non-HTTP feed links', () => {
    const links = discoverFeedLinks(`<!-- <link rel="alternate" type="application/rss+xml" href="/fake"> -->
      <link data-href="/wrong" rel="alternately" type="application/rss+xml" href="/bad">
      <link rel="alternate" type="application/rss+xml" href="javascript:alert(1)">
      <link rel="alternate" type="application/rss+xml" href="data:text/xml,test">
      <link rel="alternate" type="application/rss+xml.fake" href="/mime-lookalike">`, 'https://example.com/');
    expect(links.map(l => l.url)).toContain('https://example.com/feed');
    expect(links.every(l => /^https:\/\/example.com\//.test(l.url))).toBe(true);
    expect(links.map(l => l.url)).not.toContain('https://example.com/fake');
    expect(links.map(l => l.url)).not.toContain('https://example.com/mime-lookalike');
  });
  it('deduplicates advertised URLs without confusing data attributes with href', () => {
    const links = discoverFeedLinks('<link rel="alternate" type="application/rss+xml" data-href="/wrong" href="/rss"><link rel="alternate" type="application/atom+xml" href="https://example.com/rss">', 'https://example.com/');
    expect(links).toEqual([{ url: 'https://example.com/rss', title: undefined }]);
  });
});
