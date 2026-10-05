import { absolutizeUrls, extractMainContent } from './readability';

describe('extractMainContent', () => {
  it('prefers the article element and strips chrome', () => {
    const html = `<html><body><nav>Home | About</nav><article><h1>Story</h1><p>${'Long text. '.repeat(30)}</p><script>bad()</script></article><aside>ads</aside></body></html>`;
    const out = extractMainContent(html);
    expect(out).toContain('Long text.');
    expect(out).not.toContain('bad()');
    expect(out).not.toContain('Home | About');
  });

  it('scores the densest div when no semantic container exists', () => {
    const html = `<html><body><div class="x"><a href="#">link link link link link</a></div><div class="y"><p>${'Body copy. '.repeat(40)}</p></div></body></html>`;
    const out = extractMainContent(html);
    expect(out).toContain('Body copy.');
  });

  it('falls back to the body for tiny pages', () => {
    expect(extractMainContent('<html><body><p>Hi</p></body></html>')).toContain('Hi');
  });
});

describe('absolutizeUrls', () => {
  it('resolves relative hrefs and srcs against the page URL', () => {
    const out = absolutizeUrls('<p><a href="/next">n</a><img src="img.png"></p>', 'https://example.com/blog/post');
    expect(out).toContain('href="https://example.com/next"');
    expect(out).toContain('src="https://example.com/blog/img.png"');
    expect(out).toContain('target="_blank"');
  });

  it('leaves data URIs and absolute URLs untouched', () => {
    const out = absolutizeUrls('<img src="data:image/png;base64,AA"><a href="https://x.test/a">x</a>', 'https://example.com/');
    expect(out).toContain('src="data:image/png;base64,AA"');
    expect(out).toContain('href="https://x.test/a"');
  });
});

describe('extractMainContent cleanup', () => {
  it('removes common clutter and inline event handlers', () => {
    const out = extractMainContent(`<main><div class="article-body"><p onclick="steal()">${'Useful sentence. '.repeat(30)}</p><div class="newsletter">Sign up</div><div class="related">More stories</div></div></main>`);
    expect(out).toContain('Useful sentence.');
    expect(out).not.toContain('Sign up');
    expect(out).not.toContain('More stories');
    expect(out).not.toContain('onclick');
  });

  it('prefers article copy over a link-heavy container', () => {
    const links = '<a href="#">menu item</a>'.repeat(80);
    const copy = `<div class="story-body"><p>${'Full report sentence. '.repeat(45)}</p></div>`;
    expect(extractMainContent(`<body><div>${links}</div>${copy}</body>`)).toContain('Full report sentence.');
  });
});

describe('absolutizeUrls lazy images', () => {
  it('promotes lazy image URLs and adds loading hints', () => {
    const out = absolutizeUrls('<img data-src="/hero.jpg">', 'https://example.com/story');
    expect(out).toContain('src="https://example.com/hero.jpg"');
    expect(out).toContain('loading="lazy"');
  });
});

describe('extraction junk pruning', () => {
  const para = (n: number) => `<p>${'Real article sentence, with commas, and a full stop. '.repeat(n)}</p>`;
  it('drops related/newsletter/share blocks and short link lists inside the article', async () => {
    const { extractMainContent } = await import('./readability');
    const html = `<html><body><article>${para(6)}
      <div class="related-stories"><a href="/a">Other story one</a><a href="/b">Other story two</a></div>
      <div class="newsletter-signup"><p>Sign up for our newsletter</p></div>
      <ul><li><a href="/x">Tag one</a></li><li><a href="/y">Tag two</a></li></ul>
      <span class="visually-hidden">Image source,</span>${para(4)}</article></body></html>`;
    const out = extractMainContent(html);
    expect(out).toContain('Real article sentence');
    expect(out).not.toMatch(/Other story|newsletter|Tag one|Image source/);
  });

  it('keeps link-heavy blocks that carry real content like images or paragraphs', async () => {
    const { extractMainContent } = await import('./readability');
    const html = `<html><body><article>${para(6)}<div><a href="/i"><img src="/i.png"></a><a href="/j">caption link</a></div></article></body></html>`;
    expect(extractMainContent(html)).toContain('i.png');
  });
});

describe('dropRepeatedTitle', () => {
  it('removes a leading heading equal to the article title only', async () => {
    const { dropRepeatedTitle } = await import('./readability');
    expect(dropRepeatedTitle('<h1> My  Post </h1><p>Body</p>', 'my post')).toBe('<p>Body</p>');
    expect(dropRepeatedTitle('<h2>Section</h2><p>Body</p>', 'My post')).toContain('Section');
    expect(dropRepeatedTitle('<p>x</p>', undefined)).toBe('<p>x</p>');
  });
});


describe('responsive article media', () => {
  const base = 'https://example.com/blog/story';
  it('resolves every srcset candidate without folding descriptors into the URL', () => {
    const doc = new DOMParser().parseFromString(absolutizeUrls(
      '<img srcset="small.jpg 480w, /large.jpg 960w, https://cdn.test/full.jpg 2x">', base), 'text/html');
    expect(doc.querySelector('img')?.getAttribute('srcset')).toBe(
      'https://example.com/blog/small.jpg 480w, https://example.com/large.jpg 960w, https://cdn.test/full.jpg 2x');
  });
  it('resolves picture sources, lazy responsive images and video posters', () => {
    const doc = new DOMParser().parseFromString(absolutizeUrls(
      '<picture><source srcset="/cover.webp 1x, /cover@2x.webp 2x"><img data-src="/cover.jpg" data-srcset="/cover.jpg 1x, /cover@2x.jpg 2x"></picture><video poster="../poster.jpg" src="clip.mp4"></video>', base), 'text/html');
    expect(doc.querySelector('source')?.getAttribute('srcset')).toBe('https://example.com/cover.webp 1x, https://example.com/cover@2x.webp 2x');
    expect(doc.querySelector('img')?.getAttribute('srcset')).toBe('https://example.com/cover.jpg 1x, https://example.com/cover@2x.jpg 2x');
    expect(doc.querySelector('video')?.getAttribute('poster')).toBe('https://example.com/poster.jpg');
  });
  it('keeps embedded data URLs and handles candidates without descriptors', () => {
    const doc = new DOMParser().parseFromString(absolutizeUrls(
      '<img srcset="data:image/png;base64,AA 1x, /retina.png 2x"><source srcset="one.jpg, two.jpg">', base), 'text/html');
    expect(doc.querySelector('img')?.getAttribute('srcset')).toBe('data:image/png;base64,AA 1x, https://example.com/retina.png 2x');
    expect(doc.querySelector('source')?.getAttribute('srcset')).toBe('https://example.com/blog/one.jpg, https://example.com/blog/two.jpg');
  });
  it('does not replace a publishers existing srcset with a lazy fallback', () => {
    const doc = new DOMParser().parseFromString(absolutizeUrls(
      '<img srcset="/original.jpg 1x" data-srcset="/fallback.jpg 1x">', base), 'text/html');
    expect(doc.querySelector('img')?.getAttribute('srcset')).toBe('https://example.com/original.jpg 1x');
  });
});
