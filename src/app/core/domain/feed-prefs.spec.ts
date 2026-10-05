import { applyFeedPrefs, FEED_CHOICES, FEED_TOGGLES, OFFLINE_CONTENT_OPTIONS } from './feed-prefs';
import { Subscription } from './models';

function sub(): Subscription {
  return {
    id: 's', accountId: 'a', uid: 'u', title: 'T', sort: 0, unreadCount: 0, newestItemAt: 0,
    syncExcluded: false, hidden: false, notification: false, imageFit: true, javascript: true,
    offlineContent: -1, displayContent: -1, linkFormat: -1, autoReadability: -1, userAgent: -1,
  };
}

describe('applyFeedPrefs', () => {
  it('applies toggle and choice changes without touching other fields', () => {
    const next = applyFeedPrefs(sub(), { notification: true, offlineContent: 2, userAgent: 1 });
    expect(next.notification).toBe(true);
    expect(next.offlineContent).toBe(2);
    expect(next.userAgent).toBe(1);
    expect(next.hidden).toBe(false);
    expect(next.title).toBe('T');
  });

  it('covers every declared option value in the model unions', () => {
    const next = applyFeedPrefs(sub(), { offlineContent: 4, displayContent: 1, linkFormat: 1, autoReadability: 2, userAgent: 3 });
    expect([next.offlineContent, next.displayContent, next.linkFormat, next.autoReadability, next.userAgent]).toEqual([4, 1, 1, 2, 3]);
  });

  it('rejects unknown preference keys', () => {
    expect(() => applyFeedPrefs(sub(), { title: 'x' } as any)).toThrow('Unknown feed preference');
  });

  it('ignores undefined values', () => {
    const original = sub();
    expect(applyFeedPrefs(original, { notification: undefined })).toEqual(original);
  });

  it('declares all model-backed keys', () => {
    expect(FEED_TOGGLES.map(x => x.key)).toEqual(['notification', 'syncExcluded', 'hidden', 'imageFit', 'javascript']);
    expect(FEED_CHOICES.map(x => x.key)).toEqual(['offlineContent', 'displayContent', 'linkFormat', 'autoReadability', 'userAgent']);
    expect(OFFLINE_CONTENT_OPTIONS.map(x => x.value)).toEqual([-1, 0, 1, 2, 3, 4]);
  });
});


describe('feed preference value validation', () => {
  it('rejects wrong toggle types rather than persisting truthy strings', () => {
    for (const value of ['false', 1, null]) {
      expect(() => applyFeedPrefs(sub(), { hidden: value } as any)).toThrow('Invalid value');
    }
  });
  it('rejects unsupported choice values and leaves the original subscription unchanged', () => {
    const original = sub();
    for (const value of [99, '2', null, NaN]) {
      expect(() => applyFeedPrefs(original, { offlineContent: value } as any)).toThrow('Invalid value');
    }
    expect(original.offlineContent).toBe(-1);
  });
});
