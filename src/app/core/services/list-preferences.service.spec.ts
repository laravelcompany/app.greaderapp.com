import { ListPreferencesService } from './list-preferences.service';

const store = new Map<string, string>();
function service() {
  const value = new ListPreferencesService();
  value.preferences = {
    get: async ({ key }: { key: string }) => ({ value: store.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => { store.set(key, value); },
  } as typeof value.preferences;
  return value;
}

describe('ListPreferencesService', () => {
  beforeEach(() => store.clear());

  it('defaults to list mode and custom feed order', async () => {
    const prefs = service();
    await prefs.init();
    expect(prefs.listMode()).toBe('list');
    expect(prefs.feedSort()).toBe('custom');
  });

  it('restores persisted preferences', async () => {
    store.set('articleListMode', 'grid');
    store.set('feedSortMode', 'unread');
    const prefs = service();
    await prefs.init();
    expect(prefs.listMode()).toBe('grid');
    expect(prefs.feedSort()).toBe('unread');
  });

  it('ignores values outside the known options', async () => {
    store.set('articleListMode', 'mosaic');
    store.set('feedSortMode', 'random');
    const prefs = service();
    await prefs.init();
    expect(prefs.listMode()).toBe('list');
    expect(prefs.feedSort()).toBe('custom');
  });

  it('persists changes immediately', async () => {
    const prefs = service();
    await prefs.setListMode('card');
    await prefs.setFeedSort('alphabetical');
    expect(store.get('articleListMode')).toBe('card');
    expect(store.get('feedSortMode')).toBe('alphabetical');
    const restored = service();
    await restored.init();
    expect(restored.listMode()).toBe('card');
    expect(restored.feedSort()).toBe('alphabetical');
  });
});
