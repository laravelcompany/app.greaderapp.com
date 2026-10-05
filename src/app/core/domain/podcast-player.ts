export interface PodcastTrack { id: string; title: string; author?: string; url: string; articleId?: string; }

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export function clampRate(rate: number): number {
  return PLAYBACK_RATES.includes(rate) ? rate : 1;
}

/** mm:ss or h:mm:ss for the player UI; non-finite input renders as 0:00. */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/** Extract playable audio tracks from articles with audio enclosures. */
export function audioTracks(articles: { id: string; title: string; author?: string; audio?: string }[]): PodcastTrack[] {
  return articles
    .filter(a => !!a.audio)
    .map(a => ({ id: `track:${a.id}`, title: a.title, author: a.author, url: a.audio!, articleId: a.id }));
}

/** Seek target clamped into [0, duration]; duration may be unknown (NaN) while metadata loads. */
export function clampSeek(position: number, duration: number): number {
  if (!Number.isFinite(position)) return 0;
  if (!Number.isFinite(duration) || duration <= 0) return Math.max(0, position);
  return Math.min(Math.max(0, position), duration);
}
