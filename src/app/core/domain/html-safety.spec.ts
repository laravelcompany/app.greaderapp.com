import { describe, expect, it } from 'vitest';
import { contentHasImage, externalLinkFrom, sanitizeArticleHtml, shouldAutoloadReading } from './html-safety';

describe('sanitizeArticleHtml', () => {
  it('removes scripts, inline handlers, styles and code-bearing embeds', () => {
    const out = sanitizeArticleHtml('<p style="color:red" onclick="x()">Hi<img src="a.png" onerror="steal()"></p><script>bad()</script><iframe src="https://evil"></iframe><form><input></form>');
    expect(out).not.toMatch(/onclick|onerror|style=|<script|<iframe|<form|<input/);
    expect(out).toContain('Hi');
    expect(out).toContain('<img');
  });

  it('drops javascript: and data:text links but keeps data images', () => {
    const out = sanitizeArticleHtml('<a href=" JaVaScript:alert(1)">x</a><a href="data:text/html,hi">y</a><img src="data:image/png;base64,AA">');
    expect(out).not.toMatch(/javascript|data:text/i);
    expect(out).toContain('data:image/png');
  });

  it('resolves relative links and images against the article URL', () => {
    const out = sanitizeArticleHtml('<a href="/post/2">next</a><img src="img/a.png">', 'https://blog.example.com/post/1');
    expect(out).toContain('href="https://blog.example.com/post/2"');
    expect(out).toContain('src="https://blog.example.com/post/img/a.png"');
  });

  it('returns an empty string for empty content', () => {
    expect(sanitizeArticleHtml('')).toBe('');
  });
});

describe('externalLinkFrom', () => {
  it('finds the http link around the clicked element', () => {
    document.body.innerHTML = '<a href="https://example.com/x"><span id="in">text</span></a><a href="#top"><b id="hash">t</b></a>';
    expect(externalLinkFrom(document.getElementById('in'))).toBe('https://example.com/x');
    expect(externalLinkFrom(document.getElementById('hash'))).toBeUndefined();
    expect(externalLinkFrom(null)).toBeUndefined();
  });
});

describe('contentHasImage', () => {
  it('matches the header image in the body ignoring scheme and query', () => {
    expect(contentHasImage('<p><img src="https://cdn.example.com/a.jpg?w=800"></p>', 'http://cdn.example.com/a.jpg')).toBe(true);
    expect(contentHasImage('<p><img src="https://cdn.example.com/b.jpg"></p>', 'https://cdn.example.com/a.jpg')).toBe(false);
    expect(contentHasImage(undefined, 'a.jpg')).toBe(false);
  });
});

describe('shouldAutoloadReading', () => {
  it('lets the feed setting override the global one', () => {
    expect(shouldAutoloadReading(false, 1, false)).toBe(true);
    expect(shouldAutoloadReading(true, 0, true)).toBe(false);
    expect(shouldAutoloadReading(false, 2, true)).toBe(true);
    expect(shouldAutoloadReading(true, 2, false)).toBe(false);
    expect(shouldAutoloadReading(true, -1, false)).toBe(true);
    expect(shouldAutoloadReading(false, undefined, true)).toBe(false);
    expect(shouldAutoloadReading(false, -1, false, 1)).toBe(true);
    expect(shouldAutoloadReading(false, -1, false, 0)).toBe(false);
  });
});


describe('lazy media safety before URL promotion', () => {
  it('removes unsafe lazy image URLs before they become src attributes', () => {
    const out = sanitizeArticleHtml('<img data-src="javascript:alert(1)"><img data-original="data:text/html,unsafe"><img data-lazy-src="vbscript:bad">', 'https://example.test/article');
    expect(out).not.toMatch(/javascript:|vbscript:|data:text/i);
    const doc = new DOMParser().parseFromString(out, 'text/html');
    expect([...doc.images].every(img => !img.getAttribute('src'))).toBe(true);
  });
  it('removes unsafe lazy responsive sources and still promotes safe lazy images', () => {
    const out = sanitizeArticleHtml('<img data-srcset="javascript:alert(1) 1x"><img data-lazy-srcset="data:text/html,bad 1x"><img data-src="/safe.jpg" data-srcset="/safe.jpg 1x, /safe@2x.jpg 2x">', 'https://example.test/article');
    expect(out).not.toMatch(/javascript:|data:text/i);
    expect(out).toContain('src="https://example.test/safe.jpg"');
    expect(out).toContain('srcset="https://example.test/safe.jpg 1x, https://example.test/safe@2x.jpg 2x"');
  });
});
