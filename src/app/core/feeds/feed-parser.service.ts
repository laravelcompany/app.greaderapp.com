import { Injectable } from '@angular/core';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { ParsedFeed, ParsedFeedItem } from '../domain/models';

@Injectable({ providedIn: 'root' })
export class FeedParserService {
  private parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    trimValues: true,
    parseTagValue: false,
  });

  parse(source: string): ParsedFeed {
    const body = source.replace(/^\uFEFF/, '').trim();
    if (!body) throw new Error('The feed is empty');
    if (body.startsWith('{')) return this.parseJsonFeed(body);
    if (/^<!doctype\s+html|^<html[\s>]/i.test(body)) {
      throw new Error('This URL returned a web page, not an RSS or Atom feed');
    }
    const valid = XMLValidator.validate(body);
    if (valid !== true) {
      throw new Error(`The feed contains invalid XML${valid.err?.line ? ` at line ${valid.err.line}` : ''}`);
    }

    const document = this.parser.parse(body);
    const rss = document.rss?.channel;
    const rdf = document.RDF;
    const atom = document.feed;
    const root = rss ?? rdf?.channel ?? atom;
    if (!root) throw new Error('Unsupported feed format. Expected RSS, Atom, RDF or JSON Feed');
    const entries = this.array(rss?.item ?? rdf?.item ?? atom?.entry);

    return {
      title: this.text(root.title) || 'Untitled feed',
      link: this.link(root.link),
      description: this.text(root.description ?? root.subtitle),
      language: this.text(root.language),
      image: this.image(root),
      items: entries.map(entry => this.item(entry)),
    };
  }

  private parseJsonFeed(body: string): ParsedFeed {
    let feed: any;
    try { feed = JSON.parse(body); } catch { throw new Error('The feed contains invalid JSON'); }
    if (!feed || typeof feed !== 'object' || !String(feed.version ?? '').includes('jsonfeed.org/version/')) {
      throw new Error('Unsupported JSON feed format');
    }
    return {
      title: this.text(feed.title) || 'Untitled feed',
      link: this.text(feed.home_page_url),
      description: this.text(feed.description),
      language: this.text(feed.language),
      image: this.text(feed.icon ?? feed.favicon),
      items: this.array<any>(feed.items).map(item => {
        const attachments = this.array<any>(item.attachments);
        const audio = attachments.find(value => String(value?.mime_type ?? '').startsWith('audio/'))?.url;
        const video = attachments.find(value => String(value?.mime_type ?? '').startsWith('video/'))?.url;
        const content = item.content_html != null
          ? this.text(item.content_html)
          : this.plainTextHtml(this.text(item.content_text ?? item.summary));
        const link = this.text(item.url ?? item.external_url);
        return {
          uid: this.text(item.id) || link || `${this.text(item.title)}:${this.text(item.date_published)}`,
          title: this.text(item.title) || '(untitled)', link,
          author: this.text(item.author?.name ?? item.authors?.[0]?.name), content,
          image: this.text(item.image ?? item.banner_image) || this.htmlImage(content), audio, video,
          publishedAt: this.date(item.date_published ?? item.date_modified),
        };
      }),
    };
  }

  /** JSON Feed content_text is text, not markup. Preserve literal tags and line breaks. */
  private plainTextHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r\n?|\n/g, '<br>');
  }

  private item(item: any): ParsedFeedItem {
    const link = this.link(item.link);
    const content = this.text(item.encoded ?? item.content ?? item.description ?? item.summary);
    const enclosures = [
      ...this.array<any>(item.enclosure),
      ...this.array<any>(item.link).filter(value => value?.['@_rel'] === 'enclosure').map(value => ({ '@_url': value['@_href'], '@_type': value['@_type'] })),
    ];
    const media = this.array<any>(item.content).filter(value => value && typeof value === 'object' && value['@_url']);
    const audio = [...enclosures, ...media].find(value => String(value?.['@_type'] ?? '').startsWith('audio/'))?.['@_url'];
    const video = [...enclosures, ...media].find(value => String(value?.['@_type'] ?? '').startsWith('video/'))?.['@_url'];
    const uid = this.text(item.guid ?? item.id ?? item['@_about']) || link || `${this.text(item.title)}:${this.text(item.pubDate ?? item.updated)}`;
    return {
      uid,
      title: this.text(item.title) || '(untitled)',
      link,
      author: this.text(item.author?.name ?? item.author ?? item.creator),
      content,
      image: this.image(item) || this.htmlImage(content),
      audio,
      video,
      publishedAt: this.date(item.pubDate ?? item.published ?? item.updated ?? item.date),
    };
  }

  private image(value: any): string | undefined {
    const first = (v: any) => this.array<any>(v)[0];
    const media = [
      ...this.array<any>(value.content),
      ...this.array<any>(value.group).flatMap((g: any) => this.array<any>(g?.content)),
    ];
    const isImage = (item: any) =>
      String(item?.['@_medium'] ?? '').toLowerCase() === 'image' || String(item?.['@_type'] ?? '').toLowerCase().startsWith('image/');
    return this.text(value.image?.url ?? (typeof value.image === 'string' ? value.image : undefined) ?? value.logo ?? value.icon ?? first(value.thumbnail)?.['@_url'] ?? first(value.group)?.thumbnail?.['@_url']) ||
      media.find(item => item && typeof item === 'object' && item['@_url'] && isImage(item))?.['@_url'] ||
      this.array<any>(value.enclosure).find(item => String(item?.['@_type'] ?? '').toLowerCase().startsWith('image/'))?.['@_url'] ||
      undefined;
  }

  /** First real image in the item HTML - skipping 1x1 tracking pixels and emoji sprites. */
  private htmlImage(html: string) {
    for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
      const tag = match[0];
      const src = tag.match(/\bsrc=["']([^"']+)/i)?.[1];
      if (!src) continue;
      if (/\b(width|height)=["']?1["'\s>]/i.test(tag)) continue;
      if (/feedburner\.com|feedsportal|stats\.wordpress\.com|pixel|\/emoji\/|s\.w\.org\/images\/core\/emoji|doubleclick|\.gif\?/i.test(src)) continue;
      return src;
    }
    return undefined;
  }
  /** Missing/unparseable dates read as now; dates in the future (bad server clocks, scheduled posts) are capped at now so they don't pin to the top. */
  private date(value: any) { const parsed = Date.parse(this.text(value).trim()); const now = Date.now(); return Number.isNaN(parsed) ? now : Math.min(parsed, now); }
  private link(value: any) {
    if (Array.isArray(value)) value = value.find(item => !item?.['@_rel'] || item['@_rel'] === 'alternate');
    if (value == null || (value?.['@_rel'] && value['@_rel'] !== 'alternate')) return undefined;
    return typeof value === 'string' ? value : value?.['@_href'] ?? value?.['@_resource'] ?? this.text(value);
  }
  private text(value: any): string {
    if (value == null) return '';
    if (typeof value === 'object') return String(value['#text'] ?? value['@_href'] ?? value['@_resource'] ?? '');
    return String(value);
  }
  private array<T>(value: T | T[] | undefined): T[] { return value == null ? [] : Array.isArray(value) ? value : [value]; }
}
