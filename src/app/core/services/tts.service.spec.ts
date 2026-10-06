import { vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: store.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => { store.set(key, value); },
  },
}));

import { TtsService } from './tts.service';
import { Article } from '../domain/models';

function article(id: string, title = id): Article {
  return {
    id, accountId: 'a', subscriptionId: 's', uid: id, title, content: '<p>Body</p>',
    publishedAt: 1, updatedAt: 1, starred: false, cached: true, read: false, keepUnread: false,
  };
}

class FakeUtterance {
  static last: FakeUtterance | undefined;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  rate = 1; pitch = 1; voice: unknown = null;
  constructor(public text: string) { FakeUtterance.last = this; }
}

function fakeSynth() {
  return {
    spoken: [] as string[],
    cancelled: 0,
    paused: 0,
    resumed: 0,
    speak(u: FakeUtterance) { this.spoken.push(u.text); },
    cancel() { this.cancelled++; },
    pause() { this.paused++; },
    resume() { this.resumed++; },
    getVoices() { return []; },
    addEventListener() { /* noop */ },
  };
}

describe('TtsService', () => {
  let synth: ReturnType<typeof fakeSynth>;

  beforeEach(() => {
    store.clear();
    synth = fakeSynth();
    (window as any).speechSynthesis = synth;
    (globalThis as any).SpeechSynthesisUtterance = FakeUtterance;
  });

  afterEach(() => {
    delete (window as any).speechSynthesis;
  });

  it('plays an article with stripped speech text and persisted prefs', async () => {
    const service = new TtsService();
    await service.init();
    await service.setPrefs({ rate: 1.5 });
    service.setQueue([article('one', 'Hello')]);
    service.play(0);
    expect(synth.spoken).toEqual(['Hello. Body']);
    expect(FakeUtterance.last?.rate).toBe(1.5);
    expect(service.playing()).toBe(true);
    expect(service.currentIndex()).toBe(0);
    const restored = new TtsService();
    await restored.init();
    expect(restored.prefs().rate).toBe(1.5);
  });

  it('auto-advances through the playlist and stops at the end', async () => {
    const service = new TtsService();
    await service.init();
    service.setQueue([article('a'), article('b')]);
    service.play(0);
    FakeUtterance.last?.onend?.();
    expect(service.currentIndex()).toBe(1);
    expect(synth.spoken.length).toBe(2);
    FakeUtterance.last?.onend?.();
    expect(service.playing()).toBe(false);
    expect(service.currentIndex()).toBe(-1);
  });

  it('pauses, resumes and skips', async () => {
    const service = new TtsService();
    await service.init();
    service.setQueue([article('a'), article('b')]);
    service.play(0);
    service.togglePause();
    expect(synth.paused).toBe(1);
    service.togglePause();
    expect(synth.resumed).toBe(1);
    service.next();
    expect(service.currentIndex()).toBe(1);
    service.previous();
    expect(service.currentIndex()).toBe(0);
  });

  it('ignores delayed callbacks from an utterance replaced by a manual skip', async () => {
    const service = new TtsService();
    await service.init();
    service.setQueue([article('a'), article('b'), article('c')]);
    service.play(0);
    const old = FakeUtterance.last!;
    service.next();
    old.onerror?.();
    old.onend?.();
    expect(service.currentIndex()).toBe(1);
    expect(synth.spoken.length).toBe(2);
    FakeUtterance.last?.onend?.();
    expect(service.currentIndex()).toBe(2);
  });

  it('ignores a cancelled utterance callback after a new queue starts', async () => {
    const service = new TtsService();
    await service.init();
    service.setQueue([article('a')]);
    service.play(0);
    const old = FakeUtterance.last!;
    service.setQueue([article('b'), article('c')]);
    service.play(0);
    old.onerror?.();
    expect(service.currentIndex()).toBe(0);
    expect(service.playing()).toBe(true);
    expect(synth.spoken.length).toBe(2);
  });

  it('handles repeated media-session play and pause without reversing the requested state', async () => {
    const previous = Object.getOwnPropertyDescriptor(navigator, 'mediaSession');
    const metadata = Object.getOwnPropertyDescriptor(globalThis, 'MediaMetadata');
    const handlers = new Map<string, () => void>();
    Object.defineProperty(navigator, 'mediaSession', { configurable: true, value: {
      metadata: null, setActionHandler: (name: string, callback: () => void) => handlers.set(name, callback),
    } });
    Object.defineProperty(globalThis, 'MediaMetadata', { configurable: true, value: class {} });
    try {
      const service = new TtsService();
      await service.init();
      service.setQueue([article('a')]);
      service.play(0);
      handlers.get('play')?.();
      expect(service.paused()).toBe(false);
      expect(synth.paused).toBe(0);
      handlers.get('pause')?.();
      handlers.get('pause')?.();
      expect(service.paused()).toBe(true);
      expect(synth.paused).toBe(1);
      expect(synth.resumed).toBe(0);
      handlers.get('play')?.();
      handlers.get('play')?.();
      expect(service.paused()).toBe(false);
      expect(synth.resumed).toBe(1);
    } finally {
      if (previous) Object.defineProperty(navigator, 'mediaSession', previous);
      else Reflect.deleteProperty(navigator, 'mediaSession');
      if (metadata) Object.defineProperty(globalThis, 'MediaMetadata', metadata);
      else Reflect.deleteProperty(globalThis, 'MediaMetadata');
    }
  });

  it('removing the current item stops playback; earlier items shift the index', async () => {
    const service = new TtsService();
    await service.init();
    service.setQueue([article('a'), article('b'), article('c')]);
    service.play(2);
    service.removeFromQueue(0);
    expect(service.currentIndex()).toBe(1);
    service.removeFromQueue(1);
    expect(service.playing()).toBe(false);
    expect(service.queue().map(x => x.id)).toEqual(['b']);
  });
});
