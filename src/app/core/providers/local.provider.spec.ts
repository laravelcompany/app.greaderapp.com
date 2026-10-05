import { LocalProvider } from './local.provider';
import { Account, Subscription } from '../domain/models';
import { FeedParserService } from '../feeds/feed-parser.service';
import { StoragePort } from '../storage/storage.port';
import { FeedHttpService } from '../services/feed-http.service';

const account = { id: 'local', provider: 'local', label: 'Local', createdAt: 0 } as Account;
function provider(http: object, subscriptions: Subscription[]) {
  return new LocalProvider(
    { parse: (body: string) => ({ items: [{ uid: body, title: body, publishedAt: 1 }] }) } as unknown as FeedParserService,
    { listSubscriptions: async () => subscriptions, existingArticleIds: async () => new Set<string>() } as unknown as StoragePort,
    http as FeedHttpService,
  );
}
const subscriptions = Array.from({ length: 11 }, (_, i) => ({ id: `s${i}`, feedUrl: `https://feed.test/${i}` }) as Subscription);

describe('bounded local refresh', () => {
  it('never starts more than four feed requests at once and still visits every feed', async () => {
    let active = 0;
    let peak = 0;
    const requested: string[] = [];
    const http = { get: async (url: string) => {
      requested.push(url); active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 1)); active--;
      return { status: 200, body: url };
    } };
    const snapshot = await provider(http, subscriptions).sync(account);
    expect(peak).toBe(4);
    expect(new Set(requested).size).toBe(11);
    expect(snapshot.articles).toHaveLength(11);
  });
  it('continues after rejected requests and non-success responses, skipping excluded feeds', async () => {
    const requested: string[] = [];
    const http = { get: async (url: string) => {
      requested.push(url);
      if (url.endsWith('/0')) throw new Error('Unavailable');
      return { status: url.endsWith('/1') ? 429 : 200, body: url };
    } };
    const snapshot = await provider(http, [...subscriptions, { id: 'excluded', feedUrl: 'https://feed.test/excluded', syncExcluded: true } as Subscription]).sync(account);
    expect(requested).toHaveLength(11);
    expect(snapshot.articles).toHaveLength(9);
    expect(requested).not.toContain('https://feed.test/excluded');
  });
});
