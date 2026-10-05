import { SubscribePage } from './subscribe.page';
import { DirectoryService } from '../../core/services/directory.service';
import { StoragePort } from '../../core/storage/storage.port';
import { LocalFeedService } from '../../core/services/local-feed.service';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular';

function page(recommendations: DirectoryService['recommendations']) {
  return new SubscribePage({} as StoragePort, {} as LocalFeedService,
    { recommendations } as DirectoryService, {} as Router,
    { create: async () => ({ present: async () => undefined }) } as unknown as ToastController);
}

describe('topic discovery state', () => {
  it('keeps bundled-directory filtering separate from the topic being searched', () => {
    const view = page(async () => []);
    view.query = 'science';
    view.bundles.set([{ id: 'tech', title: 'Technology', feeds: [] }, { id: 'news', title: 'News', feeds: [] }]);
    view.filterDirectory('tech');
    expect(view.query).toBe('science');
    expect(view.directoryQuery).toBe('tech');
    expect(view.filtered().map(b => b.id)).toEqual(['tech']);
  });

  it('clears old topic results and uses the topic error, not the directory retry', async () => {
    const view = page(async () => { throw new Error('Feed discovery failed (502)'); });
    view.recommendations.set([{ title: 'Previous result', url: 'https://old.test/rss' }]);
    view.loadError.set('Separate directory error');
    await view.discoverTopic('science');
    expect(view.recommendations()).toEqual([]);
    expect(view.topicError()).toBe('Feed discovery failed (502)');
    expect(view.loadError()).toBe('Separate directory error');
    expect(view.busy()).toBe(false);
  });

  it('retries the same topic and clears its error when results arrive', async () => {
    const calls: string[] = [];
    const view = page(async topic => {
      calls.push(topic);
      return calls.length === 1 ? [] : [{ title: 'Science', url: 'https://science.test/rss' }];
    });
    await view.discoverTopic('science');
    expect(view.topicError()).toContain('No feeds found');
    await view.discoverTopic();
    expect(calls).toEqual(['science', 'science']);
    expect(view.topicError()).toBe('');
    expect(view.recommendations()).toHaveLength(1);
  });

  it('ignores an older response arriving after a newer topic search', async () => {
    let finishOld!: (rows: { title: string; url: string }[]) => void;
    const view = page(topic => topic === 'old' ? new Promise(resolve => { finishOld = resolve; }) : Promise.resolve([{ title: 'New result', url: 'https://new.test/rss' }]));
    const old = view.discoverTopic('old');
    await view.discoverTopic('new');
    finishOld([{ title: 'Old result', url: 'https://old.test/rss' }]);
    await old;
    expect(view.query).toBe('new');
    expect(view.recommendations()[0].title).toBe('New result');
  });

  it('does not repopulate discovery after switching to another tab', async () => {
    let finish!: (rows: { title: string; url: string }[]) => void;
    const view = page(() => new Promise(resolve => { finish = resolve; }));
    const search = view.discoverTopic('science');
    await view.switchMode('url');
    finish([{ title: 'Stale', url: 'https://stale.test/rss' }]);
    await search;
    expect(view.recommendations()).toEqual([]);
    expect(view.topicError()).toBe('');
    expect(view.busy()).toBe(false);
  });
});
