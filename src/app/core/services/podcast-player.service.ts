import { Injectable, signal } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { audioTracks, clampRate, clampSeek, PodcastTrack } from '../domain/podcast-player';

const RATE_KEY = 'podcastRate';
const POSITION_KEY_PREFIX = 'podcastPos:';

/** Background audio player for podcast enclosures: queue, transport, persisted rate and resume positions, media-session controls. */
@Injectable({ providedIn: 'root' })
export class PodcastPlayerService {
  preferences = Preferences;
  createAudio = (url: string): HTMLAudioElement => new Audio(url);
  readonly queue = signal<PodcastTrack[]>([]);
  readonly currentIndex = signal(-1);
  readonly playing = signal(false);
  readonly position = signal(0);
  readonly duration = signal(NaN);
  readonly rate = signal(1);

  private audio?: HTMLAudioElement;

  current(): PodcastTrack | undefined {
    return this.queue()[this.currentIndex()];
  }

  async init(): Promise<void> {
    const { value } = await this.preferences.get({ key: RATE_KEY });
    this.rate.set(clampRate(value === null ? 1 : Number(value)));
  }

  /** Replace the queue from articles with audio enclosures. Returns the number of playable tracks. */
  setQueueFromArticles(articles: { id: string; title: string; author?: string; audio?: string }[]): number {
    this.stop();
    const tracks = audioTracks(articles);
    this.queue.set(tracks);
    return tracks.length;
  }

  async play(index: number): Promise<void> {
    const track = this.queue()[index];
    if (!track) return;
    await this.persistPosition();
    this.teardown();
    const audio = this.createAudio(track.url);
    audio.preload = 'auto';
    audio.playbackRate = this.rate();
    audio.addEventListener('timeupdate', () => { if (this.audio === audio) this.position.set(audio.currentTime); });
    audio.addEventListener('durationchange', () => { if (this.audio === audio) this.duration.set(audio.duration); });
    audio.addEventListener('loadedmetadata', () => { if (this.audio === audio) this.duration.set(audio.duration); });
    audio.addEventListener('ended', () => { if (this.audio === audio) void this.next(); });
    audio.addEventListener('error', () => { if (this.audio === audio) void this.next(); });
    this.audio = audio;
    this.currentIndex.set(index);
    this.position.set(0);
    this.duration.set(NaN);
    await this.restorePosition(track);
    this.updateMediaSession(track);
    await audio.play();
    this.playing.set(true);
  }

  toggle(): void {
    const audio = this.audio;
    if (!audio) { if (this.queue().length) void this.play(0); return; }
    if (audio.paused) { void audio.play(); this.playing.set(true); }
    else { audio.pause(); this.playing.set(false); void this.persistPosition(); }
  }

  async next(): Promise<void> {
    const next = this.currentIndex() + 1;
    if (next < this.queue().length) await this.play(next);
    else this.stop();
  }

  async previous(): Promise<void> {
    await this.play(Math.max(0, this.currentIndex() - 1));
  }

  seek(seconds: number): void {
    if (!this.audio) return;
    const target = clampSeek(seconds, this.duration());
    this.audio.currentTime = target;
    this.position.set(target);
  }

  skip(deltaSeconds: number): void {
    this.seek(this.position() + deltaSeconds);
  }

  async setRate(rate: number): Promise<void> {
    const clamped = clampRate(rate);
    this.rate.set(clamped);
    if (this.audio) this.audio.playbackRate = clamped;
    await this.preferences.set({ key: RATE_KEY, value: String(clamped) });
  }

  stop(): void {
    void this.persistPosition();
    this.teardown();
    this.playing.set(false);
    this.currentIndex.set(-1);
    this.position.set(0);
    this.duration.set(NaN);
    if ('mediaSession' in navigator) { try { navigator.mediaSession.metadata = null; } catch { /* ignore */ } }
  }

  private teardown(): void {
    if (!this.audio) return;
    const audio = this.audio;
    this.audio = undefined;
    audio.pause();
    audio.src = '';
    this.playing.set(false);
  }

  /** Resume positions survive app restarts, keyed per track. */
  private async restorePosition(track: PodcastTrack): Promise<void> {
    const { value } = await this.preferences.get({ key: `${POSITION_KEY_PREFIX}${track.id}` });
    const saved = value === null ? 0 : Number(value);
    if (this.audio && Number.isFinite(saved) && saved > 5) {
      this.audio.currentTime = saved;
      this.position.set(saved);
    }
  }

  private async persistPosition(): Promise<void> {
    const track = this.current();
    if (!track) return;
    await this.preferences.set({ key: `${POSITION_KEY_PREFIX}${track.id}`, value: String(Math.floor(this.position())) });
  }

  private updateMediaSession(track: PodcastTrack): void {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.author ?? 'gReader News' });
      navigator.mediaSession.setActionHandler('play', () => this.toggle());
      navigator.mediaSession.setActionHandler('pause', () => this.toggle());
      navigator.mediaSession.setActionHandler('nexttrack', () => void this.next());
      navigator.mediaSession.setActionHandler('previoustrack', () => void this.previous());
      navigator.mediaSession.setActionHandler('seekbackward', () => this.skip(-15));
      navigator.mediaSession.setActionHandler('seekforward', () => this.skip(30));
      navigator.mediaSession.setActionHandler('stop', () => this.stop());
    } catch { /* media session unavailable */ }
  }
}
