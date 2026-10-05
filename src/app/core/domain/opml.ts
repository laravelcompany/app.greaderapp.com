import { Subscription, Tag } from './models';

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** RFC 822 date used by OPML dateCreated, e.g. "Sun, 20 Sep 2026 16:51:00 GMT". */
export function opmlDate(now: number): string {
  return new Date(now).toUTCString();
}

/** Build an OPML 1.0 subscription list in the shape gReader and other readers export/import. */
/** Build an OPML 1.0 subscription list in the shape gReader and other readers export/import. Feeds in a folder are nested under a folder outline. */
export function buildOpml(subscriptions: Subscription[], title: string, now: number, folders: Tag[] = []): string {
  const line = (s: Subscription, indent: string) =>
    `${indent}<outline text="${escapeXml(s.title)}" title="${escapeXml(s.title)}" type="rss" xmlUrl="${escapeXml(s.feedUrl!)}"${s.htmlUrl ? ` htmlUrl="${escapeXml(s.htmlUrl)}"` : ''}/>`;
  const withFeed = subscriptions.filter(s => s.feedUrl);
  const byId = new Map(folders.map(f => [f.id, f] as const));
  const lines: string[] = [];
  for (const folder of [...folders].sort((a, b) => a.sort - b.sort)) {
    const members = withFeed.filter(s => s.folderId === folder.id);
    if (!members.length) continue;
    lines.push(`    <outline text="${escapeXml(folder.label)}" title="${escapeXml(folder.label)}">`, ...members.map(s => line(s, '      ')), '    </outline>');
  }
  lines.push(...withFeed.filter(s => !s.folderId || !byId.has(s.folderId)).map(s => line(s, '    ')));
  const outlines = lines.join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="1.0">
  <head>
    <title>${escapeXml(title)}</title>
    <dateCreated>${opmlDate(now)}</dateCreated>
  </head>
  <body>
${outlines}
  </body>
</opml>
`;
}

export interface OpmlEntry { url: string; title?: string; folder?: string; }

/** Feeds listed in an OPML file, with the label of the folder outline each sits in (if any). Duplicate URLs are listed once. */
export function parseOpml(xml: string): OpmlEntry[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror') || doc.documentElement.tagName.toLowerCase() !== 'opml' || ![...doc.documentElement.children].some(node => node.tagName.toLowerCase() === 'body')) throw new Error('That file is not valid OPML');
  const seen = new Set<string>();
  const entries: OpmlEntry[] = [];
  doc.querySelectorAll('outline').forEach(node => {
    const url = (node.getAttribute('xmlUrl') ?? node.getAttribute('xmlurl') ?? '').trim();
    if (!url || seen.has(url)) return;
    seen.add(url);
    const parent = node.parentElement;
    const folder = parent && parent.tagName.toLowerCase() === 'outline' && !parent.getAttribute('xmlUrl')
      ? (parent.getAttribute('title') || parent.getAttribute('text') || '').trim() || undefined
      : undefined;
    entries.push({ url, title: node.getAttribute('title') || node.getAttribute('text') || undefined, folder });
  });
  return entries;
}
