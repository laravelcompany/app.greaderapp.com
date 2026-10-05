import { absolutizeUrls } from './readability';

/** Elements that can run code, submit data or pull in foreign documents. YouTube embeds are rebuilt separately from the media list. */
const DANGEROUS =
  'script, style, link, meta, base, iframe, frame, frameset, object, embed, applet, form, input, button, select, textarea, template, noscript';
const URL_ATTRS = ['href', 'src', 'srcset', 'action', 'formaction', 'poster', 'xlink:href', 'background', 'data-src', 'data-lazy-src', 'data-original', 'data-srcset', 'data-lazy-srcset'];

function unsafeUrl(value: string): boolean {
  const v = value.replace(/[\u0000-\u0020]/g, '').toLowerCase();
  return v.startsWith('javascript:') || v.startsWith('vbscript:') || (v.startsWith('data:') && !v.startsWith('data:image/'));
}

/**
 * Make feed or extracted HTML safe to render inside the app: feed content is untrusted, and in the
 * native app an inline handler (onerror, onclick) or a javascript: link would run with bridge access.
 * Also resolves relative links/images against the article URL so they work outside the source site.
 */
export function sanitizeArticleHtml(html: string, baseUrl?: string): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll(DANGEROUS).forEach((el) => el.remove());
  doc.body.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || name === 'style' || name === 'srcdoc') el.removeAttribute(attr.name);
      else if (URL_ATTRS.includes(name) && unsafeUrl(attr.value)) el.removeAttribute(attr.name);
    }
  });
  const clean = doc.body.innerHTML;
  return baseUrl ? absolutizeUrls(clean, baseUrl) : clean;
}

/** The http(s) URL of the link a click landed in, if any - so the app can open it outside its own webview. */
export function externalLinkFrom(target: EventTarget | null): string | undefined {
  const el = target instanceof Element ? target.closest('a[href]') : null;
  const href = el?.getAttribute('href');
  return href && /^https?:\/\//i.test(href) ? href : undefined;
}

/** True when the article body already shows this image, so the header copy would be a duplicate. */
export function contentHasImage(html: string | undefined, src: string | undefined): boolean {
  if (!html || !src) return false;
  const key = (u: string) => u.replace(/^https?:/i, '').split(/[?#]/)[0];
  const wanted = key(src);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return [...doc.querySelectorAll('img')].some((img) => {
    const s = img.getAttribute('src') || img.getAttribute('data-src') || '';
    return !!s && key(s) === wanted;
  });
}

/**
 * Whether to open an article straight in Reading mode. Per-feed "Auto readability" wins
 * (0 off, 1 on, 2 on Wi-Fi only); -1 defers to the global "Autoload reading mode" setting.
 */
export function shouldAutoloadReading(globalSetting: boolean, feedSetting: number | undefined, onWifi: boolean, displayContent?: number): boolean {
  if (displayContent === 1) return true; // per-feed "Display content: Full content"
  if (feedSetting === 1) return true;
  if (feedSetting === 0) return false;
  if (feedSetting === 2) return onWifi;
  return globalSetting;
}
