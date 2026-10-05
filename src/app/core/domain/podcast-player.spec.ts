import { audioTracks, clampRate, clampSeek, formatTime } from './podcast-player';

describe('formatTime', () => {
  it('formats minutes and hours', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(3725)).toBe('1:02:05');
  });

  it('handles unknown durations', () => {
    expect(formatTime(NaN)).toBe('0:00');
    expect(formatTime(-5)).toBe('0:00');
  });
});

describe('clampRate', () => {
  it('keeps supported rates and resets others', () => {
    expect(clampRate(1.5)).toBe(1.5);
    expect(clampRate(3)).toBe(1);
  });
});

describe('audioTracks', () => {
  it('keeps only audio enclosures and links the article', () => {
    const tracks = audioTracks([
      { id: 'a', title: 'Episode', author: 'Show', audio: 'https://x.test/e.mp3' },
      { id: 'b', title: 'No audio' },
    ]);
    expect(tracks).toEqual([{ id: 'track:a', title: 'Episode', author: 'Show', url: 'https://x.test/e.mp3', articleId: 'a' }]);
  });
});

describe('clampSeek', () => {
  it('clamps into the track bounds', () => {
    expect(clampSeek(-10, 100)).toBe(0);
    expect(clampSeek(150, 100)).toBe(100);
    expect(clampSeek(50, 100)).toBe(50);
  });

  it('treats unknown duration as unbounded above', () => {
    expect(clampSeek(500, NaN)).toBe(500);
    expect(clampSeek(-1, NaN)).toBe(0);
  });
});


describe('invalid seek positions', () => {
  it('returns a safe finite position for NaN and infinities', () => {
    for (const position of [NaN, Infinity, -Infinity]) {
      expect(clampSeek(position, 100)).toBe(0);
      expect(clampSeek(position, NaN)).toBe(0);
    }
  });
});
