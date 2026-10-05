/** Readability-style main-content extraction for the article reading view. Pure DOM heuristics, no network. */

const STRIP = 'script, style, noscript, template, iframe, form, nav, header, footer, aside, button, svg, canvas, [hidden], [aria-hidden="true"], [role="navigation"], [role="banner"], [role="contentinfo"], .advertisement, .advert, .ads, .ad, .cookie, .newsletter, .related, .recommendations, .comments, .share, .social';

function linkDensity(el: Element): number {
  const text = el.textContent?.length ?? 0;
  if (!text) return 1;
  let linked = 0;
  el.querySelectorAll('a').forEach(a => { linked += a.textContent?.length ?? 0; });
  return linked / text;
}

function score(el: Element): number {
  const text = el.textContent?.trim().length ?? 0;
  const paragraphs = el.querySelectorAll('p').length;
  const sentences = (el.textContent?.match(/[.!?](?:\s|$)/g) ?? []).length;
  const commas = (el.textContent?.match(/,/g) ?? []).length;
  const classHint = `${el.id} ${el.className}`.toLowerCase();
  const boost = /article|story|post|entry|content|body|main/.test(classHint) ? 1.3 : 1;
  const penalty = /comment|footer|sidebar|promo|related|share|social|nav/.test(classHint) ? 0.25 : 1;
  return (text + paragraphs * 140 + sentences * 18 + commas * 5) * Math.max(0, 1 - linkDensity(el)) * boost * penalty;
}

/** Class/id words that mark page furniture living inside the article container (recirculation, promos, sharing). */
const JUNK_HINT = /(^|[-_\s])(related|recirc|more-from|more-stories|read-more|read-next|up-next|newsletter|promo|sponsor(ed)?|advert(isement)?|native-ad|ad-slot|ad-container|share|sharing|social|comments?|subscribe|signup|paywall|outbrain|taboola|popular|trending|breadcrumbs?|visually-hidden|sr-only|screen-reader-text)([-_\s]|$)/i;

/** Remove furniture that sits inside the chosen container: hinted blocks and short link lists. */
function pruneJunk(root: Element) {
  root.querySelectorAll('*').forEach(node => {
    if (!node.isConnected || node === root) return;
    const hint = `${node.id} ${typeof node.className === 'string' ? node.className : ''}`;
    if (JUNK_HINT.test(hint) && !node.querySelector('p p')) { node.remove(); return; }
  });
  root.querySelectorAll('div, section, ul, ol, nav, aside').forEach(node => {
    if (!node.isConnected) return;
    const text = node.textContent?.trim().length ?? 0;
    const links = node.querySelectorAll('a').length;
    if (links >= 2 && text < 500 && linkDensity(node) > 0.6 && !node.querySelector('p, img, figure, blockquote, pre')) node.remove();
  });
}

/** Remove page furniture (scripts, navigation, ads, share/related blocks, short link lists) from a parsed fragment in place. */
export function stripPageNoise(root: Element) {
  root.querySelectorAll(STRIP).forEach(node => node.remove());
  pruneJunk(root);
}

function cleanCandidate(el: Element): string {
  el.querySelectorAll(STRIP).forEach(node => node.remove());
  pruneJunk(el);
  el.querySelectorAll('*').forEach(node => {
    for (const attr of [...node.attributes]) if (/^on/i.test(attr.name) || attr.name === 'style') node.removeAttribute(attr.name);
  });
  return el.innerHTML;
}

/** Extract the main article HTML from a full web page. Falls back to the body when nothing scores. */
export function extractMainContent(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll(STRIP).forEach(el => el.remove());
  for (const selector of ['article', '[itemprop="articleBody"]', '.article-body', '.article__body', '.post-content', '.entry-content', 'main', '[role="main"]', '.article', '.post', '#content']) {
    const candidates = [...doc.querySelectorAll(selector)].sort((a, b) => score(b) - score(a));
    const el = candidates[0];
    if (el && (el.textContent?.trim().length ?? 0) > 200 && linkDensity(el) < .55) return cleanCandidate(el);
  }
  let best: Element | null = null;
  let bestScore = 0;
  for (const el of doc.body.querySelectorAll('div, section')) {
    const s = score(el);
    if (s > bestScore) { bestScore = s; best = el; }
  }
  if (best && ((best as Element).textContent?.trim().length ?? 0) > 100) return cleanCandidate(best as Element);
  return doc.body.innerHTML;
}

/** Resolve relative links and image sources against the page URL so the reading view stays usable. */
export function absolutizeUrls(html: string, baseUrl: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const fix = (el: Element, attr: string) => {
    const value = el.getAttribute(attr);
    if (!value || value.startsWith('data:')) return;
    try { el.setAttribute(attr, new URL(value, baseUrl).toString()); } catch { /* keep original */ }
  };
  doc.querySelectorAll('a').forEach(a => fix(a, 'href'));
  doc.querySelectorAll('img, video, audio, source').forEach(el => fix(el, 'src'));
  doc.querySelectorAll('img').forEach(img => {
    const lazy = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original');
    if (!img.getAttribute('src') && lazy) img.setAttribute('src', lazy);
    fix(img, 'src');
    const lazySet = img.getAttribute('data-srcset') || img.getAttribute('data-lazy-srcset');
    if (!img.getAttribute('srcset') && lazySet) img.setAttribute('srcset', lazySet);
    img.setAttribute('loading', 'lazy');
    img.setAttribute('decoding', 'async');
  });
  doc.querySelectorAll('img, source').forEach(el => {
    const value = el.getAttribute('srcset');
    if (value) el.setAttribute('srcset', resolveSrcset(value, baseUrl));
  });
  doc.querySelectorAll('video').forEach(el => fix(el, 'poster'));
  doc.querySelectorAll('a').forEach(a => { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); });
  return doc.body.innerHTML;
}

/** Resolve each responsive-image candidate, preserving its width/density descriptor.
 * URLs may contain commas (notably data URLs), so a comma split is not safe.
 */
function resolveSrcset(value: string, baseUrl: string): string {
  const candidates: string[] = [];
  let rest = value;
  while (rest.length) {
    rest = rest.replace(/^[\s,]+/, '');
    if (!rest) break;
    const token = rest.match(/^\S+/)?.[0] ?? '';
    rest = rest.slice(token.length);
    const trailingComma = token.endsWith(',');
    const url = token.replace(/,+$/, '');
    let descriptor = '';
    if (!trailingComma) {
      const comma = rest.indexOf(',');
      descriptor = (comma < 0 ? rest : rest.slice(0, comma)).trim();
      rest = comma < 0 ? '' : rest.slice(comma + 1);
    }
    let resolved = url;
    try { resolved = new URL(url, baseUrl).toString(); } catch { /* keep original */ }
    candidates.push(`${resolved}${descriptor ? ` ${descriptor}` : ''}`);
  }
  return candidates.join(', ');
}

/** The reading view prints the article title itself; drop an extracted h1/h2 near the top that repeats it. */
export function dropRepeatedTitle(html: string, title: string | undefined): string {
  const norm = (v: string) => v.replace(/\s+/g, ' ').trim().toLowerCase();
  const wanted = norm(title ?? '');
  if (!wanted) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const heading = [...doc.body.querySelectorAll('h1, h2')].slice(0, 2).find((h) => norm(h.textContent ?? '') === wanted);
  if (!heading) return html;
  heading.remove();
  return doc.body.innerHTML;
}
