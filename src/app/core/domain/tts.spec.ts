import { MAX_UTTERANCE_CHARS, nextTrack, previousTrack, sanitizeTtsPrefs, speechText } from './tts';

describe('sanitizeTtsPrefs', () => {
  it('returns defaults for missing or broken input', () => {
    expect(sanitizeTtsPrefs(null)).toEqual({ voiceUri: null, rate: 1, pitch: 1 });
    expect(sanitizeTtsPrefs('{')).toEqual({ voiceUri: null, rate: 1, pitch: 1 });
  });

  it('keeps valid values and drops out-of-range ones', () => {
    const out = sanitizeTtsPrefs(JSON.stringify({ voiceUri: 'urn:voice:en', rate: 1.5, pitch: 3 }));
    expect(out).toEqual({ voiceUri: 'urn:voice:en', rate: 1.5, pitch: 1 });
  });
});

describe('speechText', () => {
  it('strips markup and collapses whitespace', () => {
    expect(speechText('Title', '<p>Hello <b>world</b></p>\n<p>Again</p>')).toBe('Title. Hello world Again');
  });

  it('handles missing content', () => {
    expect(speechText('Only title', undefined)).toBe('Only title.');
  });

  it('caps very long articles', () => {
    const text = speechText('T', `<p>${'word '.repeat(2000)}</p>`);
    expect(text.length).toBeLessThanOrEqual(MAX_UTTERANCE_CHARS + 1);
    expect(text.endsWith('…')).toBe(true);
  });
});

describe('track navigation', () => {
  it('advances until the queue is exhausted', () => {
    expect(nextTrack(0, 3)).toBe(1);
    expect(nextTrack(2, 3)).toBe(-1);
  });

  it('clamps previous at the queue start', () => {
    expect(previousTrack(2, 3)).toBe(1);
    expect(previousTrack(0, 3)).toBe(0);
    expect(previousTrack(0, 0)).toBe(-1);
  });
});


describe('speech text cleanup', () => {
  it('keeps paragraph boundaries and excludes script/style text from speech', () => {
    expect(speechText('Story', '<p>First paragraph.</p><p>Second paragraph.</p><script>tracking()</script><style>.ad{display:none}</style>')).toBe('Story. First paragraph. Second paragraph.');
  });
  it('decodes title markup and entities instead of reading them literally', () => {
    expect(speechText('<b>News &amp; Views</b>', '<p>A &amp; B</p>')).toBe('News & Views. A & B');
  });
});
