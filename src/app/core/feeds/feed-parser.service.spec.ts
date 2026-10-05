import { FeedParserService } from './feed-parser.service';

describe('FeedParserService', () => {
  const parser = new FeedParserService();

  it('parses RSS content, media and enclosures', () => {
    const feed = parser.parse(`<rss><channel><title>News</title><item><guid>x</guid><title>Hello</title><description><![CDATA[<p>Body<img src="https://x/i.jpg"></p>]]></description><enclosure url="https://x/a.mp3" type="audio/mpeg"/><pubDate>Sat, 19 Sep 2026 08:00:00 GMT</pubDate></item></channel></rss>`);
    expect(feed.title).toBe('News');
    expect(feed.items[0]).toMatchObject({ uid: 'x', title: 'Hello', audio: 'https://x/a.mp3', image: 'https://x/i.jpg' });
  });

  it('parses Atom alternate links', () => {
    const feed = parser.parse(`<feed xmlns="http://www.w3.org/2005/Atom"><title>A</title><entry><id>1</id><title>T</title><link rel="alternate" href="https://x/1"/><updated>2026-09-19T08:00:00Z</updated></entry></feed>`);
    expect(feed.items[0].link).toBe('https://x/1');
  });

  it('parses RDF/RSS 1.0 feeds whose items are siblings of the channel', () => {
    const feed = parser.parse(`<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><channel><title>RDF News</title><link>https://x/</link></channel><item rdf:about="https://x/1"><title>Story</title><link>https://x/1</link><date>2026-09-20T10:00:00Z</date></item></rdf:RDF>`);
    expect(feed.title).toBe('RDF News');
    expect(feed.items[0]).toMatchObject({ uid: 'https://x/1', title: 'Story', link: 'https://x/1' });
  });

  it('parses JSON Feed with attachments', () => {
    const feed = parser.parse(JSON.stringify({ version: 'https://jsonfeed.org/version/1.1', title: 'JSON News', home_page_url: 'https://x/', items: [{ id: 'j1', title: 'Audio', content_html: '<p>Hello</p>', date_published: '2026-09-20T11:00:00Z', attachments: [{ url: 'https://x/a.mp3', mime_type: 'audio/mpeg' }] }] }));
    expect(feed.items[0]).toMatchObject({ uid: 'j1', audio: 'https://x/a.mp3' });
  });

  it('reports HTML and malformed XML clearly', () => {
    expect(() => parser.parse('<html><body>Not a feed</body></html>')).toThrow('web page, not an RSS or Atom feed');
    expect(() => parser.parse('<rss><channel>')).toThrow('invalid XML');
  });

  it('finds item images in media:group, multiple media:thumbnails and image enclosures', () => {
    const rss = (item: string) => parser.parse(`<rss xmlns:media="http://search.yahoo.com/mrss/"><channel><title>N</title><item><guid>g</guid><title>T</title>${item}</item></channel></rss>`).items[0].image;
    expect(rss('<media:thumbnail url="https://x/t1.jpg"/><media:thumbnail url="https://x/t2.jpg"/>')).toBe('https://x/t1.jpg');
    expect(rss('<media:group><media:content url="https://x/g.jpg" type="image/jpeg"/></media:group>')).toBe('https://x/g.jpg');
    expect(rss('<enclosure url="https://x/e.png" type="image/png" length="1"/>')).toBe('https://x/e.png');
  });

  it('skips tracking pixels and emoji when taking the first body image', () => {
    const feed = parser.parse(`<rss><channel><title>N</title><item><guid>g</guid><title>T</title><description><![CDATA[<img src="https://feeds.feedburner.com/~r/x/~4/abc" height="1" width="1"><img src="https://s.w.org/images/core/emoji/15/72x72/1f600.png"><img src="https://x/real.jpg">]]></description></item></channel></rss>`);
    expect(feed.items[0].image).toBe('https://x/real.jpg');
  });

  it('caps future publish dates at now', () => {
    const before = Date.now();
    const feed = parser.parse(`<rss><channel><title>N</title><item><guid>g</guid><title>T</title><pubDate>Fri, 01 Jan 2100 00:00:00 GMT</pubDate></item></channel></rss>`);
    expect(feed.items[0].publishedAt).toBeGreaterThanOrEqual(before);
    expect(feed.items[0].publishedAt).toBeLessThanOrEqual(Date.now());
  });
});


describe('JSON Feed plain-text content', () => {
  const parser = new FeedParserService();
  it('escapes literal markup and preserves line breaks in content_text', () => {
    const feed = parser.parse(JSON.stringify({ version: 'https://jsonfeed.org/version/1.1', items: [{ id: 'text', content_text: 'Use <button> & <script> as examples.\nNext line.' }] }));
    expect(feed.items[0].content).toBe('Use &lt;button&gt; &amp; &lt;script&gt; as examples.<br>Next line.');
    expect(feed.items[0].image).toBeUndefined();
  });
  it('keeps real content_html as markup and escapes a plain-text summary fallback', () => {
    const feed = parser.parse(JSON.stringify({ version: 'https://jsonfeed.org/version/1', items: [{ id: 'html', content_html: '<p>Markup</p>', content_text: 'Fallback' }, { id: 'summary', summary: 'A < B & C' }] }));
    expect(feed.items[0].content).toBe('<p>Markup</p>');
    expect(feed.items[1].content).toBe('A &lt; B &amp; C');
  });
});


describe('Atom media enclosures', () => {
  it('finds audio/video rel=enclosure links while preserving the article alternate URL', () => {
    const feed = new FeedParserService().parse(`<feed xmlns="http://www.w3.org/2005/Atom"><title>Podcast</title><entry><id>episode</id><title>Episode</title><link rel="enclosure" type="audio/mpeg" href="https://media.test/episode.mp3"/><link rel="enclosure" type="video/mp4" href="https://media.test/episode.mp4"/><link rel="alternate" href="https://show.test/episode"/></entry></feed>`);
    expect(feed.items[0]).toMatchObject({ link: 'https://show.test/episode', audio: 'https://media.test/episode.mp3', video: 'https://media.test/episode.mp4' });
  });
  it('ignores non-media enclosure types and unrelated links', () => {
    const feed = new FeedParserService().parse(`<feed xmlns="http://www.w3.org/2005/Atom"><title>N</title><entry><id>x</id><link rel="alternate" type="audio/mpeg" href="https://site.test/x"/><link rel="enclosure" type="application/pdf" href="https://site.test/doc.pdf"/></entry></feed>`);
    expect(feed.items[0].audio).toBeUndefined();
    expect(feed.items[0].video).toBeUndefined();
  });
});


describe('Atom article link selection', () => {
  const parser = new FeedParserService();
  const atom = (links: string) => parser.parse(`<feed><title>Feed</title>${links}<entry><id>episode</id><title>Episode</title>${links}</entry></feed>`);
  it('does not treat a lone audio enclosure as an article or homepage link', () => {
    const feed = atom('<link rel="enclosure" type="audio/mpeg" href="https://media.test/audio.mp3"/>');
    expect(feed.link).toBeUndefined();
    expect(feed.items[0].link).toBeUndefined();
    expect(feed.items[0].audio).toBe('https://media.test/audio.mp3');
    expect(feed.items[0].uid).toBe('episode');
  });
  it('does not fall back to self or enclosure when no alternate exists', () => {
    const feed = atom('<link rel="self" href="https://site.test/feed.xml"/><link rel="enclosure" type="video/mp4" href="https://media.test/video.mp4"/>');
    expect(feed.link).toBeUndefined();
    expect(feed.items[0].link).toBeUndefined();
    expect(feed.items[0].video).toBe('https://media.test/video.mp4');
  });
  it('accepts an omitted rel as an alternate while ignoring a self link', () => {
    const feed = atom('<link rel="self" href="https://site.test/feed.xml"/><link href="https://site.test/article"/>');
    expect(feed.link).toBe('https://site.test/article');
    expect(feed.items[0].link).toBe('https://site.test/article');
  });
});
