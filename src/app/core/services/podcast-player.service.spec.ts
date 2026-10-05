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
