import { Subscription } from './models';

export interface PrefOption { value: number; label: string; }

/** Per-feed preference options mirroring the gReader 5.2.0 feed-settings activity. -1 always means "use the global default". */
export const OFFLINE_CONTENT_OPTIONS: PrefOption[] = [
  { value: -1, label: 'Default' }, { value: 0, label: 'None' }, { value: 1, label: 'Text only' },
  { value: 2, label: 'Text and images' }, { value: 3, label: 'Full content' }, { value: 4, label: 'Full content with images' },
];
export const DISPLAY_CONTENT_OPTIONS: PrefOption[] = [
  { value: -1, label: 'Default' }, { value: 0, label: 'Feed content' }, { value: 1, label: 'Full content' },
];
export const LINK_FORMAT_OPTIONS: PrefOption[] = [
  { value: -1, label: 'Default' }, { value: 0, label: 'Mobile view' }, { value: 1, label: 'Desktop view' },
];
export const AUTO_READABILITY_OPTIONS: PrefOption[] = [
  { value: -1, label: 'Default' }, { value: 0, label: 'Off' }, { value: 1, label: 'On' }, { value: 2, label: 'On Wi-Fi only' },
];
export const USER_AGENT_OPTIONS: PrefOption[] = [
  { value: -1, label: 'Default' }, { value: 0, label: 'Android' }, { value: 1, label: 'Desktop' }, { value: 2, label: 'iPhone' }, { value: 3, label: 'Custom' },
];

export type FeedToggleKey = 'notification' | 'syncExcluded' | 'hidden' | 'imageFit' | 'javascript';
export type FeedChoiceKey = 'offlineContent' | 'displayContent' | 'linkFormat' | 'autoReadability' | 'userAgent';

export const FEED_TOGGLES: { key: FeedToggleKey; label: string }[] = [
  { key: 'notification', label: 'Notify on new articles' },
  { key: 'syncExcluded', label: 'Exclude from sync' },
  { key: 'hidden', label: 'Hide from subscription list' },
  { key: 'imageFit', label: 'Fit images to screen' },
  { key: 'javascript', label: 'Enable JavaScript' },
];
export const FEED_CHOICES: { key: FeedChoiceKey; label: string; options: PrefOption[] }[] = [
  { key: 'offlineContent', label: 'Offline content', options: OFFLINE_CONTENT_OPTIONS },
  { key: 'displayContent', label: 'Display content', options: DISPLAY_CONTENT_OPTIONS },
  { key: 'linkFormat', label: 'Link format', options: LINK_FORMAT_OPTIONS },
  { key: 'autoReadability', label: 'Auto readability', options: AUTO_READABILITY_OPTIONS },
  { key: 'userAgent', label: 'User agent', options: USER_AGENT_OPTIONS },
];

/** Apply whitelisted per-feed preference changes; unknown keys are rejected. */
export function applyFeedPrefs(subscription: Subscription, changes: Partial<Pick<Subscription, FeedToggleKey | FeedChoiceKey>>): Subscription {
  const allowed = new Set<string>([...FEED_TOGGLES.map(x => x.key), ...FEED_CHOICES.map(x => x.key)]);
  const next = { ...subscription };
  for (const [key, value] of Object.entries(changes)) {
    if (!allowed.has(key)) throw new Error(`Unknown feed preference: ${key}`);
    if (value === undefined) continue;
    const toggle = FEED_TOGGLES.some(option => option.key === key);
    const choice = FEED_CHOICES.find(option => option.key === key);
    if ((toggle && typeof value !== 'boolean') || (choice && !choice.options.some(option => option.value === value))) {
      throw new Error(`Invalid value for feed preference: ${key}`);
    }
    (next as Record<string, unknown>)[key] = value;
  }
  return next;
}
