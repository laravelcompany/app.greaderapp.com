import { LocalFeedService } from './local-feed.service';
import { parserStub } from './local-feed.test-utils';

describe('LocalFeedService discovery', () => {
  it('discovers the advertised feed when given a plain website URL', async () => {
    const storage = { listSubscriptions: async () => [], existingArticleIds: async () => new Set<string>(), putSubscriptions: async () => undefined, putArticles: async () => undefined } as any;
    const page = '<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head></html>';
    const http = { get: async (url: string) => url.endsWith('/feed.xml') ? { status: 200, body: '<rss>real feed</rss>' } : { status: 200, body: page } } as any;
    const service = new LocalFeedService(parserStub(/<html/), storage, http);
    const sub = await service.subscribe('local', 'https://example.com/blog');
    expect(sub.title).toBe('Example Blog');
    expect(sub.feedUrl).toBe('https://example.com/feed.xml');
  });
});


describe('redirected discovery and persistence errors', () => {
  const storage = () => ({ listSubscriptions: async () => [], existingArticleIds: async () => new Set<string>(), putSubscriptions: async () => undefined, putArticles: async () => undefined });
  it('resolves relative advertised links against the final page URL after a redirect', async () => {
    const requested: string[] = [];
    const http = { get: async (url: string) => {
      requested.push(url);
      return requested.length === 1
        ? { status: 200, finalUrl: 'https://new.test/blog/', body: '<html><link rel="alternate" type="application/rss+xml" href="rss.xml"></html>' }
        : { status: 200, body: '<rss>feed</rss>' };
    } } as any;
    const sub = await new LocalFeedService(parserStub(/<html/), storage() as any, http).subscribe('local', 'https://old.test');
    expect(requested).toEqual(['https://old.test/', 'https://new.test/blog/rss.xml']);
    expect(sub.feedUrl).toBe('https://new.test/blog/rss.xml');
  });
  it('surfaces direct-feed storage errors without starting website discovery', async () => {
    const requested: string[] = [];
    const db = { ...storage(), putSubscriptions: async () => { throw new Error('Storage quota exceeded'); } };
    const http = { get: async (url: string) => { requested.push(url); return { status: 200, body: '<rss>feed</rss>' }; } } as any;
    await expect(new LocalFeedService(parserStub(/<html/), db as any, http).subscribe('local', 'https://example.test/rss')).rejects.toThrow('Storage quota exceeded');
    expect(requested).toEqual(['https://example.test/rss']);
  });
  it('does not continue through candidates when a discovered feed cannot be saved', async () => {
    const requested: string[] = [];
    const db = { ...storage(), putSubscriptions: async () => { throw new Error('Database unavailable'); } };
    const http = { get: async (url: string) => { requested.push(url); return { status: 200, body: requested.length === 1 ? '<html><link rel="alternate" type="application/rss+xml" href="/rss"><link rel="alternate" type="application/rss+xml" href="/atom"></html>' : '<rss>feed</rss>' }; } } as any;
    await expect(new LocalFeedService(parserStub(/<html/), db as any, http).subscribe('local', 'https://example.test')).rejects.toThrow('Database unavailable');
    expect(requested).toHaveLength(2);
  });
});
