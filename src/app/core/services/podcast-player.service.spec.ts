import { PodcastPlayerService } from './podcast-player.service';

function player() {
  const store = new Map<string, string>();
  const service = new PodcastPlayerService();
  service.preferences = {
    get: async ({ key }: { key: string }) => ({ value: store.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => { store.set(key, value); },
  } as typeof service.preferences;
  service.createAudio = () => ({
    preload: '', playbackRate: 1, currentTime: 0, duration: 300, paused: false, src: '',
    addEventListener: () => undefined, play: async () => undefined, pause: () => undefined,
  }) as unknown as HTMLAudioElement;
  service.setQueueFromArticles([{ id: 'a', title: 'A', audio: 'https://audio.test/a.mp3' }, { id: 'b', title: 'B', audio: 'https://audio.test/b.mp3' }]);
  return { service, store };
}

describe('podcast resume persistence', () => {
  it('saves the outgoing track position before switching to another episode', async () => {
    const { service, store } = player();
    await service.play(0);
    service.position.set(123);
    await service.next();
    expect(store.get('podcastPos:track:a')).toBe('123');
    expect(service.current()?.articleId).toBe('b');
    await service.previous();
    expect(service.position()).toBe(123);
  });
  it('saves the paused position without waiting until the queue stops', async () => {
    const { service, store } = player();
    await service.play(0);
    service.position.set(87);
    service.toggle();
    expect(store.get('podcastPos:track:a')).toBe('87');
    expect(service.playing()).toBe(false);
  });
});


describe('podcast stale media events', () => {
  it('ignores events from a replaced or stopped audio element', async () => {
    const { service } = player();
    const audios: { audio: HTMLAudioElement; emit: (event: string) => void }[] = [];
    service.createAudio = () => {
      const listeners = new Map<string, () => void>();
      const audio = {
        preload: '', playbackRate: 1, currentTime: 0, duration: 300, paused: false, src: '',
        addEventListener: (event: string, callback: () => void) => { listeners.set(event, callback); },
        play: async () => undefined, pause: () => undefined,
      } as unknown as HTMLAudioElement;
      audios.push({ audio, emit: event => listeners.get(event)?.() });
      return audio;
    };
    await service.play(0);
    const old = audios[0];
    await service.play(1);
    old.audio.currentTime = 88;
    Object.defineProperty(old.audio, 'duration', { value: 999 });
    for (const event of ['timeupdate', 'durationchange', 'loadedmetadata', 'error', 'ended']) old.emit(event);
    await Promise.resolve();
    expect(service.currentIndex()).toBe(1);
    expect(service.position()).toBe(0);
    expect(service.duration()).toBeNaN();
    expect(service.playing()).toBe(true);
    const active = audios[1];
    active.audio.currentTime = 42;
    active.emit('timeupdate');
    active.emit('loadedmetadata');
    expect(service.position()).toBe(42);
    expect(service.duration()).toBe(300);
    service.stop();
    active.emit('timeupdate');
    active.emit('loadedmetadata');
    expect(service.position()).toBe(0);
    expect(service.duration()).toBeNaN();
  });
});

describe('podcast asynchronous playback cancellation', () => {
  it('does not start an episode after stop while resume preferences are loading', async () => {
    const { service } = player();
    let resolve!: (value: { value: string | null }) => void;
    const loading = new Promise<{ value: string | null }>(done => { resolve = done; });
    service.preferences.get = async () => loading;
    let starts = 0;
    service.createAudio = () => ({
      preload: '', playbackRate: 1, currentTime: 0, duration: 300, paused: false, src: '',
      addEventListener: () => undefined, play: async () => { starts++; }, pause: () => undefined,
    }) as unknown as HTMLAudioElement;
    const request = service.play(0);
    await Promise.resolve();
    await Promise.resolve();
    service.stop();
    resolve({ value: '90' });
    await request;
    expect(starts).toBe(0);
    expect(service.playing()).toBe(false);
    expect(service.currentIndex()).toBe(-1);
    expect(service.position()).toBe(0);
  });

  it('does not restore an old episode position into a newer episode', async () => {
    const { service } = player();
    let resolve!: (value: { value: string | null }) => void;
    const loading = new Promise<{ value: string | null }>(done => { resolve = done; });
    service.preferences.get = async ({ key }) => key.endsWith('track:a') ? loading : { value: '25' };
    const request = service.play(0);
    await Promise.resolve();
    await Promise.resolve();
    await service.play(1);
    resolve({ value: '90' });
    await request;
    expect(service.current()?.articleId).toBe('b');
    expect(service.position()).toBe(25);
  });
});
