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
  it('treats http/https, www, host case and trailing slash as the same feed', async () => {
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


describe('case-sensitive feed URL identity', () => {
  it('does not merge distinct paths or query tokens while normalizing hostname case', async () => {
    const { feedUrlKey } = await import('./feed-discovery');
    expect(feedUrlKey('https://example.test/News')).not.toBe(feedUrlKey('https://example.test/news'));
    expect(feedUrlKey('https://example.test/rss?token=AbC')).not.toBe(feedUrlKey('https://example.test/rss?token=abc'));
    expect(feedUrlKey('https://WWW.Example.test/News/')).toBe(feedUrlKey('http://example.test/News'));
  });
});


describe('feed discovery document base', () => {
  it('resolves relative feed metadata against an absolute HTML base URL', () => {
    const html = '<base href="https://cdn.example.test/blog/"><link rel="alternate" type="application/rss+xml" href="feed.xml">';
    expect(discoverFeedLinks(html, 'https://example.test/post')).toEqual([{ url: 'https://cdn.example.test/blog/feed.xml', title: undefined }]);
  });
  it('resolves a relative base URL against the final page URL', () => {
    const html = '<base href="../news/"><link rel="alternate" type="application/atom+xml" href="atom.xml">';
    expect(discoverFeedLinks(html, 'https://example.test/blog/post')).toEqual([{ url: 'https://example.test/news/atom.xml', title: undefined }]);
  });
  it('ignores unsafe base schemes and keeps common fallback paths on the page origin', () => {
    const link = '<link rel="alternate" type="application/rss+xml" href="feed.xml">';
    expect(discoverFeedLinks('<base href="javascript:alert(1)">' + link, 'https://example.test/blog/')[0].url).toBe('https://example.test/blog/feed.xml');
    expect(discoverFeedLinks('<base href="https://cdn.example.test/">', 'https://example.test/blog/')[0].url).toBe('https://example.test/feed');
  });
});
