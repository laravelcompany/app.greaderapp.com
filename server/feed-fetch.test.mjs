import { describe, it, expect, vi } from 'vitest';
import { fetchFeed, pinnedLookup } from './feed-fetch.mjs';

describe('feed fetch', () => {
  it('returns the pinned address in Node scalar and all-address lookup modes', () => {
    const lookup = pinnedLookup({ address: '93.184.216.34', family: 4 });
    lookup('example.com', {}, (_error, address, family) => {
      expect(address).toBe('93.184.216.34');
      expect(family).toBe(4);
    });
    lookup('example.com', { all: true }, (_error, addresses) => {
      expect(addresses).toEqual([{ address: '93.184.216.34', family: 4 }]);
    });
  });

  it('revalidates and pins every host in a redirect chain', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: 'http://feeds.example.net/rss' } }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://feeds.example.net/rss' } }))
      .mockResolvedValueOnce(new Response('<rss/>', { headers: { 'content-type': 'application/rss+xml' } }));
    const resolve = vi.fn()
      .mockResolvedValueOnce({ address: '93.184.216.34', family: 4 })
      .mockResolvedValueOnce({ address: '93.184.216.35', family: 4 })
      .mockResolvedValueOnce({ address: '93.184.216.35', family: 4 });
    const dispatcher = vi.fn(() => ({}));
    const result = await fetchFeed('http://old.example.com/rss', { fetch: request, resolve, dispatcher });
    expect(result.finalUrl).toBe('https://feeds.example.net/rss');
    expect(resolve).toHaveBeenCalledTimes(3);
    expect(request).toHaveBeenCalledTimes(3);
  });
});

it('passes JSON Feed bytes through the proxy for the client parser', async () => {
  const body = JSON.stringify({ version: 'https://jsonfeed.org/version/1.1', title: 'JSON Feed', items: [] });
  const feed = await fetchFeed('https://example.test/feed.json', {
    resolve: async () => ({ address: '93.184.216.34', family: 4 }),
    dispatcher: () => ({}),
    fetch: async () => new Response(body, { headers: { 'content-type': 'application/feed+json; charset=utf-8' } }),
  });
  expect(feed.body.toString('utf8')).toBe(body);
  expect(feed.contentType).toBe('application/feed+json; charset=utf-8');
  expect(feed.finalUrl).toBe('https://example.test/feed.json');
});
