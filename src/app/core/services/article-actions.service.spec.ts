import { vi } from 'vitest';
import { ArticleActionsService } from './article-actions.service';
import { Article, PendingMutation } from '../domain/models';

function article(partial: Partial<Article> = {}): Article {
  return {
    id: 'a:1', accountId: 'a', subscriptionId: 's', uid: 'u1', title: 'One', publishedAt: 1, updatedAt: 1,
    starred: false, cached: true, read: false, keepUnread: false, ...partial,
  };
}

function storage() {
  const queued: PendingMutation[] = [];
  return {
    queued,
    updates: [] as { id: string; change: Partial<Article> }[],
    updateArticle: async function (this: any, id: string, change: Partial<Article>) { this.updates.push({ id, change }); },
    markArticlesRead: async (_accountId: string, _options: { before?: number }) => 7,
    enqueue: async (value: PendingMutation) => { queued.push(value); },
  } as any;
}

describe('ArticleActionsService', () => {
  it('marks an article read and queues the read mutation', async () => {
    const db = storage();
    const service = new ArticleActionsService(db);
    const updated = await service.setRead(article(), true);
    expect(updated.read).toBe(true);
    expect(updated.readAt).toBeDefined();
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0].id).toBe('a:1');
    expect(db.updates[0].change.read).toBe(true);
    expect(db.queued.map((x: PendingMutation) => [x.kind, x.value, x.articleUid])).toEqual([['read', true, 'u1']]);
  });

  it('keeps an article unread when marking it unread again', async () => {
    const db = storage();
    const service = new ArticleActionsService(db);
    const updated = await service.setRead(article({ read: true }), false);
    expect(updated.read).toBe(false);
    expect(updated.keepUnread).toBe(true);
    expect(db.queued[0].value).toBe(false);
  });

  it('stars and unstars with a queued star mutation', async () => {
    const db = storage();
    const service = new ArticleActionsService(db);
    expect((await service.setStarred(article(), true)).starred).toBe(true);
    expect((await service.setStarred(article({ starred: true }), false)).starred).toBe(false);
    expect(db.queued.map((x: PendingMutation) => x.kind)).toEqual(['star', 'star']);
  });

  it('delegates mark-all with the resolved age cutoff', async () => {
    const db = storage();
    const calls: { before?: number; subscriptionId?: string }[] = [];
    db.markArticlesRead = async (_a: string, o: { before?: number; subscriptionId?: string }) => { calls.push(o); return 3; };
    const service = new ArticleActionsService(db);
    expect(await service.markAllRead('a', 'all')).toBe(3);
    expect(await service.markAllRead('a', 'week')).toBe(3);
    expect(calls[0].before).toBeUndefined();
    expect(calls[1].before).toBeLessThan(Date.now());
    expect(calls[0].subscriptionId).toBeUndefined();
  });

  it('scopes mark-all-read to one feed when a subscription is selected', async () => {
    const calls: { before?: number; subscriptionId?: string }[] = [];
    const db = storage();
    db.markArticlesRead = async (_a: string, o: { before?: number; subscriptionId?: string }) => { calls.push(o); return 2; };
    const service = new ArticleActionsService(db);
    expect(await service.markAllRead('a', 'all', 'sub-tnw')).toBe(2);
    expect(calls[0].subscriptionId).toBe('sub-tnw');
  });
});


describe('pending mutation identity', () => {
  it('keeps every same-millisecond action instead of overwriting a queued mutation', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(123456);
    try {
      const db = storage();
      const persisted = new Map<string, PendingMutation>();
      db.enqueue = async (mutation: PendingMutation) => { persisted.set(mutation.id, mutation); };
      const service = new ArticleActionsService(db);
      await service.setRead(article(), true);
      await service.setRead(article(), false);
      await service.setStarred(article(), true);
      await service.setStarred(article(), false);
      expect(persisted.size).toBe(4);
      expect([...persisted.values()].map(x => [x.kind, x.value, x.createdAt])).toEqual([
        ['read', true, 123456], ['read', false, 123456],
        ['star', true, 123456], ['star', false, 123456],
      ]);
    } finally { clock.mockRestore(); }
  });
});
