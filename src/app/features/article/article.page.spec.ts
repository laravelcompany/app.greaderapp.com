import { ArticlePage } from './article.page';
import { Article } from '../../core/domain/models';
import { ActivatedRoute } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { DomSanitizer } from '@angular/platform-browser';
import { StoragePort } from '../../core/storage/storage.port';
import { FeedHttpService } from '../../core/services/feed-http.service';
import type { ListPreferencesService } from '../../core/services/list-preferences.service';
import type { TtsService } from '../../core/services/tts.service';
import type { PodcastPlayerService } from '../../core/services/podcast-player.service';
import type { AppSettingsService } from '../../core/services/app-settings.service';

function page(article: Article, updates: object[], finalUrl?: string) {
  return new ArticlePage(
    { snapshot: { paramMap: { get: () => article.id } } } as unknown as ActivatedRoute,
    {} as AlertController,
    { getArticle: async () => article, listTags: async () => [], listSubscriptions: async () => [], updateArticle: async (_id: string, change: object) => { updates.push(change); } } as unknown as StoragePort,
    { get: async () => ({ status: 200, finalUrl, body: `<article><p>${'Real article copy. '.repeat(30)}</p><img src="images/hero.jpg"><a href="next">Next</a></article>` }) } as unknown as FeedHttpService,
    {} as DomSanitizer,
    { init: async () => undefined } as unknown as ListPreferencesService,
    {} as TtsService, {} as PodcastPlayerService,
    { init: async () => undefined, settings: () => ({ autoloadReading: false }) } as unknown as AppSettingsService,
  );
}
const article = { id: 'a', accountId: 'local', subscriptionId: 'feed', title: 'Story', link: 'https://old.test/story', read: false, keepUnread: false } as Article;

describe('article opening and extraction', () => {
  it('does not mark a keep-unread article read when opened', async () => {
    const updates: object[] = [];
    await page({ ...article, keepUnread: true }, updates).ngOnInit();
    expect(updates).toEqual([]);
  });
  it('marks ordinary unread articles read and leaves already read articles alone', async () => {
    const updates: object[] = [];
    await page(article, updates).ngOnInit();
    expect(updates).toEqual([expect.objectContaining({ read: true })]);
    await page({ ...article, read: true }, updates).ngOnInit();
    expect(updates).toHaveLength(1);
  });
  it('resolves extracted images and links against the redirected source page', async () => {
    const view = page(article, [], 'https://new.test/news/story');
    await view.ngOnInit();
    await view.setMode('simplified');
    expect(view.extracted()).toContain('src="https://new.test/news/images/hero.jpg"');
    expect(view.extracted()).toContain('href="https://new.test/news/next"');
  });
  it('falls back to the article URL when final transport URL is absent', async () => {
    const view = page(article, []);
    await view.ngOnInit();
    await view.setMode('simplified');
    expect(view.extracted()).toContain('src="https://old.test/images/hero.jpg"');
    expect(view.extracting()).toBe(false);
    expect(view.extractError()).toBeUndefined();
  });
});
