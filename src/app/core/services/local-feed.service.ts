import { Injectable } from '@angular/core';
import { Article, Subscription } from '../domain/models';
import { FeedParserService } from '../feeds/feed-parser.service';
import { StoragePort } from '../storage/storage.port';
import { FeedHttpService } from './feed-http.service';
import { stableId } from '../domain/feed-refresh';
import { discoverFeedLinks } from '../domain/feed-discovery';
import { parseOpml } from '../domain/opml';
import { createFolder } from '../domain/folders';

@Injectable({ providedIn: 'root' })
export class LocalFeedService {
  constructor(private parser: FeedParserService, private storage: StoragePort, private http: FeedHttpService) {}

  async subscribe(accountId: string, url: string): Promise<Subscription> {
    const normalized = this.normalizeUrl(url);
    const response = await this.http.get(normalized);
    if (response.status < 200 || response.status >= 300) throw new Error(`Feed request failed (${response.status})`);
    try { this.parser.parse(response.body); }
    catch { return this.subscribeViaDiscovery(accountId, response.finalUrl || normalized, response.body); }
    // Storage failures are not format errors. Surface them instead of fetching unrelated candidates.
    return this.importXml(accountId, response.body, normalized);
  }

  /** The URL points at a web page: follow its advertised feed links, then common feed paths. */
  private async subscribeViaDiscovery(accountId: string, pageUrl: string, html: string): Promise<Subscription> {
    for (const link of discoverFeedLinks(html, pageUrl)) {
      let body: string;
      try {
        const feed = await this.http.get(link.url);
        if (feed.status < 200 || feed.status >= 300) continue;
        this.parser.parse(feed.body);
        body = feed.body;
      } catch { continue; /* candidate was unavailable or not a feed */ }
      return this.importXml(accountId, body, link.url);
    }
    throw new Error('No feed found on that page. Paste the direct feed URL instead.');
  }

  async importXml(accountId: string, xml: string, sourceUrl?: string): Promise<Subscription> {
    const parsed = this.parser.parse(xml);
    const id = this.stableId(accountId, sourceUrl || parsed.link || parsed.title);
    const previous = (await this.storage.listSubscriptions(accountId)).find(s => s.id === id);
    const candidates = new Map<string, Article>();
    for (const item of parsed.items) {
      const articleId = this.stableId(accountId, item.uid);
      if (candidates.has(articleId)) continue;
      candidates.set(articleId, {
        id: articleId, accountId, subscriptionId: id, uid: item.uid, title: item.title,
        content: item.content, author: item.author, link: item.link, image: item.image, audio: item.audio, video: item.video,
        publishedAt: item.publishedAt, updatedAt: item.publishedAt, starred: false, cached: true, read: false, keepUnread: false,
      });
    }
    // Re-adding a feed (or re-importing an OPML) must not reset read/starred state or the feed's own settings.
    const stored = await this.storage.existingArticleIds([...candidates.keys()]);
    const articles = [...candidates.values()].filter(a => !stored.has(a.id));
    const newestItemAt = Math.max(0, ...parsed.items.map(x => x.publishedAt));
    if (previous) {
      const updated: Subscription = {
        ...previous, title: parsed.title || previous.title, feedUrl: sourceUrl ?? previous.feedUrl,
        htmlUrl: parsed.link ?? previous.htmlUrl, iconUrl: parsed.image ?? previous.iconUrl,
        unreadCount: previous.unreadCount + articles.length, newestItemAt: Math.max(previous.newestItemAt ?? 0, newestItemAt),
      };
      await Promise.all([this.storage.putSubscriptions([updated]), this.storage.putArticles(articles)]);
      return updated;
    }
    const subscription: Subscription = {
      id, accountId, uid: sourceUrl || parsed.link || id, title: parsed.title, feedUrl: sourceUrl, htmlUrl: parsed.link,
      iconUrl: parsed.image, sort: Date.now(), unreadCount: articles.length, newestItemAt,
      syncExcluded: false, hidden: false, notification: false, imageFit: true, javascript: true,
      offlineContent: -1, displayContent: -1, linkFormat: -1, autoReadability: -1, userAgent: -1,
    };
    await Promise.all([this.storage.putSubscriptions([subscription]), this.storage.putArticles(articles)]);
    return subscription;
  }

  /**
   * Import an OPML file: feeds are fetched four at a time, folder outlines become folders (reusing
   * an existing folder with the same name), and feeds already subscribed keep their own settings.
   */
  async importOpml(accountId: string, xml: string, onProgress?: (done: number, total: number) => void): Promise<{ imported: number; failed: string[] }> {
    const entries = parseOpml(xml);
    const failed: string[] = []; let imported = 0; let done = 0;
    const tags = await this.storage.listTags(accountId);
    const folders = new Map(tags.filter(t => t.type === 'folder').map(t => [t.label.toLowerCase(), t] as const));
    let nextSort = tags.reduce((n, t) => Math.max(n, t.sort), 0) + 1;
    const folderFor = async (label: string) => {
      const key = label.toLowerCase();
      let folder = folders.get(key);
      if (!folder) {
        folder = createFolder(accountId, label, nextSort++);
        folders.set(key, folder);
        await this.storage.putTags([folder]);
      }
      return folder;
    };
    onProgress?.(0, entries.length);
    const queue = [...entries];
    const worker = async () => {
      for (let entry = queue.shift(); entry; entry = queue.shift()) {
        try {
          const sub = await this.subscribe(accountId, entry.url);
          if (entry.folder && !sub.folderId) {
            const folder = await folderFor(entry.folder);
            await this.storage.putSubscriptions([{ ...sub, folderId: folder.id }]);
          }
          imported++;
        } catch { failed.push(entry.url); }
        onProgress?.(++done, entries.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, entries.length) }, worker));
    return { imported, failed };
  }

  private normalizeUrl(value: string) { const v = value.trim(); return new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`).toString(); }
  private stableId = stableId;
}
