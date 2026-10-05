import { htmlToText } from './text-preview';

export interface TtsPrefs { voiceUri: string | null; rate: number; pitch: number; }

export const DEFAULT_TTS_PREFS: TtsPrefs = { voiceUri: null, rate: 1, pitch: 1 };
export const RATE_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
export const PITCH_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** Long utterances get truncated by several engines; cap the spoken text. */
export const MAX_UTTERANCE_CHARS = 4000;

export function sanitizeTtsPrefs(raw: string | null | undefined): TtsPrefs {
  if (!raw) return { ...DEFAULT_TTS_PREFS };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out = { ...DEFAULT_TTS_PREFS };
    if (typeof parsed['voiceUri'] === 'string') out.voiceUri = parsed['voiceUri'];
    if (typeof parsed['rate'] === 'number' && RATE_OPTIONS.includes(parsed['rate'])) out.rate = parsed['rate'];
    if (typeof parsed['pitch'] === 'number' && PITCH_OPTIONS.includes(parsed['pitch'])) out.pitch = parsed['pitch'];
    return out;
  } catch {
    return { ...DEFAULT_TTS_PREFS };
  }
}

/** Spoken form of an article: title, then visible body text with markup removed and whitespace collapsed. */
export function speechText(title: string, contentHtml: string | undefined): string {
  const body = htmlToText(contentHtml);
  const text = `${htmlToText(title)}. ${body}`.replace(/\s+/g, ' ').trim();
  return text.length > MAX_UTTERANCE_CHARS ? `${text.slice(0, MAX_UTTERANCE_CHARS)}…` : text;
}

/** Next queue index in playlist order, or -1 when the playlist is exhausted. */
export function nextTrack(current: number, queueLength: number): number {
  return current + 1 < queueLength ? current + 1 : -1;
}

/** Previous queue index, clamped at 0 (-1 when the queue is empty). */
export function previousTrack(current: number, queueLength: number): number {
  if (queueLength === 0) return -1;
  return Math.max(0, current - 1);
}
