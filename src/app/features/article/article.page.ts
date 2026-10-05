import { Component, ElementRef, OnInit, ViewChild, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Browser } from '@capacitor/browser';
import { Share } from '@capacitor/share';
import { AlertController, IonBackButton, IonButton, IonButtons, IonChip, IonContent, IonHeader, IonIcon, IonSegment, IonSegmentButton, IonSpinner, IonTitle, IonToolbar } from '@ionic/angular';
import type { AlertInput } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { contractOutline, contrastOutline, globeOutline, headsetOutline, imageOutline, pricetagOutline, shareOutline, star, starOutline, textOutline, volumeHighOutline } from 'ionicons/icons';
import { Article, ReadingMode, Tag } from '../../core/domain/models';
import { reconcileArticleTags } from '../../core/domain/article-tags';
import { extractMedia, MediaItem, youtubeThumbnail } from '../../core/domain/media';
import { absolutizeUrls, dropRepeatedTitle, extractMainContent } from '../../core/domain/readability';
import { contentHasImage, externalLinkFrom, sanitizeArticleHtml, shouldAutoloadReading } from '../../core/domain/html-safety';
import { Network } from '@capacitor/network';
import { AppSettingsService } from '../../core/services/app-settings.service';
import { StoragePort } from '../../core/storage/storage.port';
import { FeedHttpService } from '../../core/services/feed-http.service';
import { ListPreferencesService } from '../../core/services/list-preferences.service';
import { TtsService } from '../../core/services/tts.service';
import { PodcastPlayerService } from '../../core/services/podcast-player.service';
import { ArticleSummaryComponent } from './article-summary.component';

@Component({
  selector: 'app-article',
  template: `<ion-header><ion-toolbar color="primary"><ion-buttons slot="start"><ion-back-button defaultHref="/feeds"></ion-back-button></ion-buttons><ion-title>{{article()?.title||'Article'}}</ion-title><ion-buttons slot="end"><ion-button (click)="toggleStar()"><ion-icon [name]="article()?.starred?'star':'star-outline'"></ion-icon></ion-button><ion-button aria-label="Edit tags" (click)="editTags()"><ion-icon name="pricetag-outline"></ion-icon></ion-button><ion-button (click)="speak()"><ion-icon name="volume-high-outline"></ion-icon></ion-button><ion-button (click)="share()"><ion-icon name="share-outline"></ion-icon></ion-button></ion-buttons></ion-toolbar><ion-toolbar><ion-segment [value]="mode()" (ionChange)="setMode($any($event.detail.value))"><ion-segment-button value="feed">Feed</ion-segment-button><ion-segment-button value="simplified">Reading</ion-segment-button><ion-segment-button value="original">Web</ion-segment-button></ion-segment></ion-toolbar><ion-toolbar *ngIf="appSettings.settings().showArticleControls"><ion-buttons slot="end"><ion-button aria-label="Decrease font size" (click)="font(-0.1)"><ion-icon name="text-outline"></ion-icon></ion-button><ion-button aria-label="Increase font size" (click)="font(0.1)"><strong style="font-size:1.25rem">A</strong></ion-button><ion-button aria-label="Invert colors" [class.active]="prefs.invert()" (click)="prefs.setInvert(!prefs.invert())"><ion-icon name="contrast-outline"></ion-icon></ion-button><ion-button aria-label="Fit images" [class.active]="prefs.imageFit()" (click)="prefs.setImageFit(!prefs.imageFit())"><ion-icon name="image-outline"></ion-icon></ion-button></ion-buttons></ion-toolbar></ion-header>
  <ion-content class="ion-padding" [class.invert]="prefs.invert()"><div class="loading" *ngIf="extracting()"><ion-spinner></ion-spinner><p>Extracting article…</p></div><article *ngIf="article() as item" [style.font-size.rem]="prefs.fontScale()" [class.fit-images]="prefs.imageFit()"><h1>{{item.title}}</h1><p class="byline"><span *ngIf="item.author">{{item.author}} · </span>{{item.publishedAt|date:'medium'}}</p><img *ngIf="item.image && !heroInBody()" class="hero" [src]="item.image" alt=""><div class="media" *ngFor="let m of media()">
      <div class="yt" *ngIf="m.type==='youtube'">
        <img *ngIf="activeEmbed()!==m.videoId" [src]="thumb(m.videoId)" alt="YouTube video" (click)="playEmbed(m.videoId)"><button class="yt-play" *ngIf="activeEmbed()!==m.videoId" (click)="playEmbed(m.videoId)" aria-label="Play YouTube video">&#9654;</button>
        <iframe *ngIf="activeEmbed()===m.videoId" [src]="embedUrl(m)" allowfullscreen allow="autoplay; encrypted-media; picture-in-picture"></iframe>
      </div>
      <div class="gif" *ngIf="m.type==='gif'" (click)="gifOverlay.set(m.url)"><img [src]="m.url" alt="GIF"><span class="badge">GIF</span></div>
      <div class="vid" *ngIf="m.type==='video'"><video #vidEl [src]="m.url" controls></video><ion-button *ngIf="pipSupported" size="small" fill="outline" (click)="togglePip(vidEl)"><ion-icon name="contract-outline" slot="start"></ion-icon>Picture in picture</ion-button></div>
    </div>
    <div class="tag-chips" *ngIf="tagLabels().length"><ion-chip *ngFor="let label of tagLabels()" outline>{{label}}</ion-chip></div><app-article-summary [articleId]="item.id" [title]="item.title" [html]="summaryHtml()" [enabled]="appSettings.settings().aiSummaries"></app-article-summary><div class="body" #bodyEl [innerHTML]="body()" (click)="onBodyClick($event)"></div><div class="extract-error" *ngIf="extractError()"><p>{{extractError()}}</p><ion-button size="small" fill="outline" (click)="retryExtract()">Try again</ion-button><ion-button size="small" fill="clear" (click)="setMode('feed')">Show feed content</ion-button></div><ion-button *ngIf="item.audio" (click)="playAudio()"><ion-icon name="headset-outline" slot="start"></ion-icon>Play podcast episode</ion-button><video *ngIf="item.video" [src]="item.video" controls></video><ion-button *ngIf="mode()==='original'&&item.link" (click)="openWeb()"><ion-icon name="globe-outline" slot="start"></ion-icon>Open original page</ion-button></article><div class="gif-overlay" *ngIf="gifOverlay()" (click)="gifOverlay.set(undefined)"><img [src]="gifOverlay()" alt="GIF fullscreen"></div></ion-content>`,
  styles: [`article{max-width:760px;margin:auto;line-height:1.65}.media{margin:0 0 1rem}.yt{position:relative;aspect-ratio:16/9;background:#000}.yt img{width:100%;height:100%;object-fit:cover;cursor:pointer}.yt iframe{width:100%;height:100%;border:0;position:absolute;inset:0}.yt-play{position:absolute;inset:0;margin:auto;width:64px;height:64px;border-radius:50%;border:0;background:rgba(0,0,0,.7);color:#fff;font-size:1.5rem;cursor:pointer}.gif{position:relative;cursor:zoom-in}.gif img{max-width:100%}.gif .badge{position:absolute;top:.5rem;left:.5rem;background:rgba(0,0,0,.7);color:#fff;padding:.15rem .5rem;border-radius:4px;font-weight:700;font-size:.8rem}.gif-overlay{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.9);display:flex;align-items:center;justify-content:center;cursor:zoom-out}.gif-overlay img{max-width:100vw;max-height:100vh}.vid video{width:100%}article img,video{max-width:100%;height:auto}article.fit-images img{max-width:100%!important;height:auto!important}.byline{color:var(--ion-color-medium)}audio{width:100%}.invert article{filter:invert(0.92) hue-rotate(180deg)}.loading{text-align:center;padding:3rem;color:var(--ion-color-medium)}.extract-error{color:var(--ion-color-warning-shade)}.extract-error p{margin-bottom:.25rem}ion-button.active{--color:var(--ion-color-warning)}.tag-chips{margin:0 0 .5rem}`],
  imports: [CommonModule, ArticleSummaryComponent, IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonButton, IonIcon, IonSegment, IonSegmentButton, IonContent, IonSpinner, IonChip],
})
export class ArticlePage implements OnInit {
  /** Image errors don't bubble, so catch them on the way down and collapse dead images instead of showing a broken-image box. */
  @ViewChild('bodyEl') set bodyEl(ref: ElementRef<HTMLElement> | undefined) {
    const el = ref?.nativeElement;
    if (!el || el === this.watchedEl) return;
    this.watchedEl = el;
    el.addEventListener('error', (e) => { if (e.target instanceof HTMLImageElement) e.target.style.display = 'none'; }, true);
  }
  private watchedEl?: HTMLElement;
  article = signal<Article | undefined>(undefined);
  accountTags = signal<Tag[]>([]);
  tagLabels = computed(() => {
    const a = this.article();
    if (!a?.tags?.length) return [] as string[];
    const byId = new Map(this.accountTags().map(t => [t.id, t.label] as const));
    return a.tags.map(id => byId.get(id)).filter((label): label is string => !!label);
  });
  mode = signal<ReadingMode>('feed');
  extracted = signal<string | undefined>(undefined);
  activeEmbed = signal<string | undefined>(undefined);
  gifOverlay = signal<string | undefined>(undefined);
  pipSupported = typeof document !== 'undefined' && 'pictureInPictureEnabled' in document && document.pictureInPictureEnabled;
  media = computed<MediaItem[]>(() => {
    const a = this.article();
    return a?.content ? extractMedia(a.content, a.link) : [];
  });
  thumb = youtubeThumbnail;
  extracting = signal(false);
  extractError = signal<string | undefined>(undefined);
  /** Feed and extracted HTML are untrusted: sanitize before bypassing Angular's sanitizer (which would also strip embeds we rebuild ourselves). */
  body = computed<SafeHtml>(() => {
    const a = this.article();
    const raw = (this.mode() === 'simplified' && this.extracted()) || a?.content;
    const safe = raw ? sanitizeArticleHtml(raw, a?.link) : '';
    return this.sanitizer.bypassSecurityTrustHtml(safe || '<p>No article content was included in this feed. Switch to Reading to load the full article.</p>');
  });
  /** Text source for the AI summary: the Reading-mode extraction when it has been loaded (usually the full article), else the feed content. */
  summaryHtml = computed(() => this.extracted() || this.article()?.content || '');
  /** The feed's header image is usually repeated as the first image in the body; show it once. */
  heroInBody = computed(() => {
    const a = this.article();
    return contentHasImage((this.mode() === 'simplified' && this.extracted()) || a?.content, a?.image);
  });

  constructor(private route: ActivatedRoute, private alerts: AlertController, private db: StoragePort, private http: FeedHttpService, private sanitizer: DomSanitizer, public prefs: ListPreferencesService, private tts: TtsService, private player: PodcastPlayerService, public appSettings: AppSettingsService) {
    addIcons({ shareOutline, star, starOutline, volumeHighOutline, globeOutline, textOutline, contrastOutline, imageOutline, headsetOutline, contractOutline, pricetagOutline });
  }

  async ngOnInit() {
    await Promise.all([this.prefs.init(), this.appSettings.init()]);
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      const a = await this.db.getArticle(id);
      this.article.set(a);
      if (a) this.accountTags.set(await this.db.listTags(a.accountId));
      if (a && !a.read && !a.keepUnread) await this.db.updateArticle(id, { read: true, readAt: Date.now() });
      if (a?.link && await this.autoloadReading(a)) await this.setMode('simplified');
    }
  }

  /** Honors the global "Autoload reading mode" setting and the feed's own "Auto readability" choice. */
  private async autoloadReading(a: Article): Promise<boolean> {
    try {
      const sub = (await this.db.listSubscriptions(a.accountId)).find(s => s.id === a.subscriptionId);
      const onWifi = sub?.autoReadability === 2 ? (await Network.getStatus()).connectionType === 'wifi' : false;
      return shouldAutoloadReading(this.appSettings.settings().autoloadReading, sub?.autoReadability, onWifi, sub?.displayContent);
    } catch { return false; }
  }

  /** Links inside the article open in the system browser instead of replacing the app's own page. */
  async onBodyClick(event: MouseEvent) {
    const url = externalLinkFrom(event.target);
    if (!url) return;
    event.preventDefault();
    await Browser.open({ url });
  }

  async retryExtract() {
    this.extracted.set(undefined);
    await this.extract();
  }

  async setMode(mode: ReadingMode) {
    this.mode.set(mode);
    if (mode === 'simplified' && !this.extracted() && !this.extracting()) await this.extract();
  }

  private async extract() {
    const a = this.article();
    if (!a?.link) { this.extractError.set('This article has no source page to extract from.'); return; }
    this.extracting.set(true);
    this.extractError.set(undefined);
    try {
      const response = await this.http.get(a.link);
      if (response.status < 200 || response.status >= 300) throw new Error(`Source page request failed (${response.status})`);
      this.extracted.set(absolutizeUrls(dropRepeatedTitle(extractMainContent(response.body), a.title), response.finalUrl || a.link));
    } catch (error) {
      this.extractError.set(error instanceof Error ? `Could not extract the article: ${error.message}` : 'Could not extract the article.');
    } finally {
      this.extracting.set(false);
    }
  }

  playEmbed(videoId: string) { this.activeEmbed.set(videoId); }
  embedUrl(item: MediaItem) { return item.type === 'youtube' ? this.sanitizer.bypassSecurityTrustResourceUrl(item.embedUrl) : ''; }
  async togglePip(video: HTMLVideoElement) {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch { /* PiP rejected (user gesture required or unsupported) */ }
  }
  async font(delta: number) { await this.prefs.setFontScale(this.prefs.fontScale() + delta); }
  async editTags() {
    const a = this.article();
    if (!a) return;
    const tags = this.accountTags().filter(t => t.type === 'tag');
    const selected = new Set(a.tags ?? []);
    const inputs: AlertInput[] = tags.map(t => ({ name: 'tag', type: 'checkbox', label: t.label, value: t.id, checked: selected.has(t.id) }));
    inputs.push({ name: 'newLabel', type: 'text', placeholder: 'New tag label' });
    const alert = await this.alerts.create({
      header: 'Article tags',
      inputs,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Save', handler: async (data) => {
          const checked = data.tag ?? [];
          const ids = (Array.isArray(checked) ? checked : [checked]).filter(Boolean) as string[];
          const { tagIds, created } = reconcileArticleTags(ids, data.newLabel ?? '', a.accountId, this.accountTags());
          if (created) {
            await this.db.putTags([created]);
            this.accountTags.set([...this.accountTags(), created]);
          }
          await this.db.updateArticle(a.id, { tags: tagIds });
          this.article.set({ ...a, tags: tagIds });
        } },
      ],
    });
    await alert.present();
  }
  async toggleStar() { const a = this.article(); if (!a) return; const starred = !a.starred; await this.db.updateArticle(a.id, { starred }); this.article.set({ ...a, starred }); }
  async share() { const a = this.article(); if (a) await Share.share({ title: a.title, text: a.title, url: a.link }); }
  async openWeb() { const url = this.article()?.link; if (url) await Browser.open({ url }); }
  async playAudio() {
    const a = this.article(); if (!a?.audio) return;
    await this.player.init();
    this.player.setQueueFromArticles([a]);
    await this.player.play(0);
  }

  speak() {
    const a = this.article(); if (!a) return;
    this.tts.setQueue([a]);
    this.tts.play(0);
  }
}
