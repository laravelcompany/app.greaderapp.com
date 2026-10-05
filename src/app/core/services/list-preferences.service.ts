import { Injectable, signal } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { ArticleListMode, FeedSortMode } from '../domain/list-preferences';

const LIST_MODE_KEY = 'articleListMode';
const FEED_SORT_KEY = 'feedSortMode';
const FONT_SCALE_KEY = 'articleFontScale';
const INVERT_KEY = 'articleInvert';
const IMAGE_FIT_KEY = 'articleImageFit';

@Injectable({ providedIn: 'root' })
export class ListPreferencesService {
  /** Storage seam keeps tests independent of Capacitor module import order. */
  preferences = Preferences;
  readonly listMode = signal<ArticleListMode>('list');
  readonly feedSort = signal<FeedSortMode>('custom');
  readonly fontScale = signal(1);
  readonly invert = signal(false);
  readonly imageFit = signal(true);

  async init(): Promise<void> {
    const [{ value: mode }, { value: sort }, { value: scale }, { value: invert }, { value: fit }] = await Promise.all([
      this.preferences.get({ key: LIST_MODE_KEY }),
      this.preferences.get({ key: FEED_SORT_KEY }),
      this.preferences.get({ key: FONT_SCALE_KEY }),
      this.preferences.get({ key: INVERT_KEY }),
      this.preferences.get({ key: IMAGE_FIT_KEY }),
    ]);
    if (mode === 'list' || mode === 'grid' || mode === 'card') this.listMode.set(mode);
    if (sort === 'custom' || sort === 'alphabetical' || sort === 'unread' || sort === 'newest') this.feedSort.set(sort);
    const parsed = scale === null ? 1 : Number(scale);
    if (Number.isFinite(parsed) && parsed >= 0.7 && parsed <= 1.8) this.fontScale.set(parsed);
    this.invert.set(invert === 'true');
    this.imageFit.set(fit !== 'false');
  }

  async setListMode(mode: ArticleListMode): Promise<void> {
    this.listMode.set(mode);
    await this.preferences.set({ key: LIST_MODE_KEY, value: mode });
  }

  async setFeedSort(mode: FeedSortMode): Promise<void> {
    this.feedSort.set(mode);
    await this.preferences.set({ key: FEED_SORT_KEY, value: mode });
  }

  async setFontScale(scale: number): Promise<void> {
    const clamped = Math.min(1.8, Math.max(0.7, Math.round(scale * 100) / 100));
    this.fontScale.set(clamped);
    await this.preferences.set({ key: FONT_SCALE_KEY, value: String(clamped) });
  }

  async setInvert(invert: boolean): Promise<void> {
    this.invert.set(invert);
    await this.preferences.set({ key: INVERT_KEY, value: String(invert) });
  }

  async setImageFit(fit: boolean): Promise<void> {
    this.imageFit.set(fit);
    await this.preferences.set({ key: IMAGE_FIT_KEY, value: String(fit) });
  }
}
