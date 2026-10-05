import { SyncService } from './sync.service';
import type { StoragePort } from '../storage/storage.port';
import type { LocalProvider } from '../providers/local.provider';
import type { FeedlyProvider, InoreaderProvider, OldReaderProvider } from '../providers/cloud.providers';
import type { Account, Article } from '../domain/models';

const account = { id: 'local', provider: 'local', label: 'Local', createdAt: 0 } as Account;
function fixture(connected = true, failedPush = false) {
  const calls: string[] = [];
  const writes: Article[][] = [];
  const db = {
    pending: async () => { calls.push('pending'); return [{ id: 'mutation' }]; },
    removePending: async (ids: string[]) => { calls.push(`ack:${ids.join(',')}`); },
    existingArticleIds: async () => new Set(['old']),
    putSubscriptions: async () => undefined, putTags: async () => undefined,
    putArticles: async (rows: Article[]) => { writes.push(rows); },
    putAccount: async () => { calls.push('account'); },
    listSubscriptions: async () => [],
  };
  const local = {
    push: async () => { calls.push('push'); if (failedPush) throw new Error('Push failed'); return ['mutation']; },
    sync: async () => { calls.push('snapshot'); return { subscriptions: [], tags: [], articles: [{ id: 'old' }, { id: 'new' }] }; },
  };
  const service = new SyncService(db as unknown as StoragePort, local as unknown as LocalProvider,
    {} as FeedlyProvider, {} as InoreaderProvider, {} as OldReaderProvider);
  service.network = { getStatus: async () => ({ connected, connectionType: connected ? 'wifi' : 'none' }) } as typeof service.network;
  return { service, calls, writes };
}

describe('sync offline and mutation safety', () => {
  it('does not remove pending mutations or update storage while offline', async () => {
    const { service, calls, writes } = fixture(false);
    expect(await service.sync(account)).toEqual({ newArticles: 0, feedAlerts: [] });
    expect(calls).toEqual([]);
    expect(writes).toEqual([]);
    expect(service.running()).toBe(false);
  });
  it('acknowledges mutations before snapshot and saves only genuinely new article IDs', async () => {
    const { service, calls, writes } = fixture();
    expect((await service.sync(account)).newArticles).toBe(1);
    expect(calls).toEqual(['pending', 'push', 'ack:mutation', 'snapshot', 'account']);
    expect(writes[0].map(a => a.id)).toEqual(['new']);
    expect(service.running()).toBe(false);
  });
  it('keeps unacknowledged mutations when push fails and exposes the error', async () => {
    const { service, calls, writes } = fixture(true, true);
    await expect(service.sync(account)).rejects.toThrow('Push failed');
    expect(calls).toEqual(['pending', 'push']);
    expect(writes).toEqual([]);
    expect(service.lastError()).toBe('Push failed');
    expect(service.running()).toBe(false);
  });
});
