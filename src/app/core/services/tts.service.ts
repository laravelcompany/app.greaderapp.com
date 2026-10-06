import { Injectable, signal } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { Article } from '../domain/models';
import { DEFAULT_TTS_PREFS, nextTrack, previousTrack, sanitizeTtsPrefs, speechText, TtsPrefs } from '../domain/tts';

const PREFS_KEY = 'ttsPrefs';

/** Voice-reading queue with playlist advance, voice/rate/pitch controls and media-session integration. */
@Injectable({ providedIn: 'root' })
export class TtsService {
  readonly queue = signal<Article[]>([]);
  readonly currentIndex = signal(-1);
  readonly playing = signal(false);
  readonly paused = signal(false);
  readonly prefs = signal<TtsPrefs>({ ...DEFAULT_TTS_PREFS });
  readonly voices = signal<SpeechSynthesisVoice[]>([]);

  private playbackGeneration = 0;

  private get synth(): SpeechSynthesis | undefined {
    return 'speechSynthesis' in window ? window.speechSynthesis : undefined;
  }

  async init(): Promise<void> {
    const { value } = await Preferences.get({ key: PREFS_KEY });
    this.prefs.set(sanitizeTtsPrefs(value));
    const synth = this.synth;
    if (!synth) return;
    const load = () => this.voices.set(synth.getVoices());
    load();
    synth.addEventListener?.('voiceschanged', load);
  }

  setQueue(articles: Article[]): void {
    this.stop();
    this.queue.set(articles);
  }

  async setPrefs(change: Partial<TtsPrefs>): Promise<void> {
    const next = { ...this.prefs(), ...change };
    this.prefs.set(next);
    await Preferences.set({ key: PREFS_KEY, value: JSON.stringify(next) });
  }

  play(index: number): void {
    const synth = this.synth;
    const article = this.queue()[index];
    if (!synth || !article) return;
    const generation = ++this.playbackGeneration;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(speechText(article.title, article.content));
    const prefs = this.prefs();
    const voice = this.voices().find(v => v.voiceURI === prefs.voiceUri);
    if (voice) utterance.voice = voice;
    utterance.rate = prefs.rate;
    utterance.pitch = prefs.pitch;
    // Cancellation can report an error after the next utterance has already started.
    const advance = () => { if (generation === this.playbackGeneration) this.advance(); };
    utterance.onend = advance;
    utterance.onerror = advance;
    this.currentIndex.set(index);
    this.playing.set(true);
    this.paused.set(false);
    this.updateMediaSession(article);
    synth.speak(utterance);
  }

  togglePause(): void {
    const synth = this.synth;
    if (!synth || !this.playing()) return;
    if (this.paused()) { synth.resume(); this.paused.set(false); }
    else { synth.pause(); this.paused.set(true); }
  }

  next(): void {
    const next = nextTrack(this.currentIndex(), this.queue().length);
    if (next >= 0) this.play(next); else this.stop();
  }

  previous(): void {
    const prev = previousTrack(this.currentIndex(), this.queue().length);
    if (prev >= 0) this.play(prev);
  }

  stop(): void {
    ++this.playbackGeneration;
    this.synth?.cancel();
    this.playing.set(false);
    this.paused.set(false);
    this.currentIndex.set(-1);
    this.clearMediaSession();
  }

  removeFromQueue(index: number): void {
    const queue = this.queue().filter((_, i) => i !== index);
    const current = this.currentIndex();
    this.queue.set(queue);
    if (index === current) this.stop();
    else if (index < current) this.currentIndex.set(current - 1);
  }

  private advance(): void {
    if (!this.playing()) return;
    this.next();
  }

  private updateMediaSession(article: Article): void {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: article.title, artist: article.author ?? 'gReader News' });
      navigator.mediaSession.setActionHandler('play', () => { if (this.paused()) this.togglePause(); });
      navigator.mediaSession.setActionHandler('pause', () => { if (!this.paused()) this.togglePause(); });
      navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
      navigator.mediaSession.setActionHandler('previoustrack', () => this.previous());
      navigator.mediaSession.setActionHandler('stop', () => this.stop());
    } catch { /* media session unavailable */ }
  }

  private clearMediaSession(): void {
    if (!('mediaSession' in navigator)) return;
    try { navigator.mediaSession.metadata = null; } catch { /* ignore */ }
  }
}
