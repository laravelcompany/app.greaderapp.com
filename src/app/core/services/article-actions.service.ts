import { Injectable } from '@angular/core';
import { Article } from '../domain/models';
import { markReadCutoff } from '../domain/list-preferences';
import { StoragePort } from '../storage/storage.port';

/** Read/star/mark-all actions shared by every article list renderer. Each change queues a pending mutation for provider sync. */
@Injectable({ providedIn: 'root' })
export class ArticleActionsService {
  constructor(private db: StoragePort) {}

  async setRead(article: Article, read: boolean): Promise<Article> {
    const change: Partial<Article> = { read, readAt: read ? Date.now() : undefined, keepUnread: !read };
    await this.db.updateArticle(article.id, change);
    await this.enqueue(article, 'read', read);
    return { ...article, ...change };
  }

  async setStarred(article: Article, starred: boolean): Promise<Article> {
    await this.db.updateArticle(article.id, { starred });
    await this.enqueue(article, 'star', starred);
    return { ...article, starred };
  }

  /** Mark articles read, limited by an age option from MARK_READ_AGES. Returns the number updated. */
  async markAllRead(accountId: string, ageId: string, subscriptionId?: string): Promise<number> {
    return this.db.markArticlesRead(accountId, { before: markReadCutoff(ageId, Date.now()), ...(subscriptionId ? { subscriptionId } : {}) });
  }

  private enqueue(article: Article, kind: 'read' | 'star', value: boolean): Promise<void> {
    return this.db.enqueue({
      // An acknowledgement of an older action must not erase a newer action sharing its millisecond.
      id: `${article.id}:${kind}:${crypto.randomUUID()}`, accountId: article.accountId, articleUid: article.uid,
      kind, value, createdAt: Date.now(), attempts: 0,
    });
  }
}
