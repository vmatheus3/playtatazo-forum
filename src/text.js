/* Turning player text into safe HTML, and small words for numbers and dates. A port of esc(),
   render_body(), inline(), when() and plural() in wiki/forum/server.py, with the same rules: everything
   a player wrote is escaped first; then only these come back: paragraphs, "- " lists, "> " quotes,
   **bold**, *italic*, `code`, [[Wiki]] links (to the wiki's search), and plain links only in posts by
   accounts a moderator trusts (marked nofollow ugc noopener noreferrer). No pictures, ever. */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' };

export function esc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

export function quotePlus(s) {
  return encodeURIComponent(s).replace(/%20/g, '+');
}

// The same pattern the database uses to find links (supabase/forum/03_functions.sql, forum.has_link).
const LINK = /\b(?:https?:\/\/|www\.)[^\s<>"]+|\b[a-z0-9][a-z0-9-]{0,62}\.(?:com|net|org|io|gg|me|tv|br|co|uk|app|dev|xyz|info|ly|to|link)\b(?:\/[^\s<>"]*)?/gi;
const NUL = String.fromCharCode(0);

export function inline(text, allowLinks, wikiUrl) {
  const keep = [];
  const stash = (html) => {
    keep.push(html);
    return NUL + (keep.length - 1) + NUL;
  };
  let t = String(text).split(NUL).join('');
  t = t.replace(/`([^`\n]{1,200})`/g, (_, code) => stash('<code>' + esc(code) + '</code>'));
  t = t.replace(/\[\[([^[\]\n]{1,60})\]\]/g, (_, name) =>
    stash('<a class="wiki" href="' + esc(wikiUrl + 'search.html?q=' + quotePlus(name.trim())) + '">' + esc(name.trim()) + '</a>'));
  if (allowLinks) {
    t = t.replace(LINK, (m) => {
      const url = m.replace(/[.,;:!?)]+$/, '');
      const tail = m.slice(url.length);
      const href = /^https?:\/\//i.test(url) ? url : 'https://' + url;
      return stash('<a href="' + esc(href) + '" rel="nofollow ugc noopener noreferrer">' + esc(url) + '</a>') + tail;
    });
  }
  t = esc(t);
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])/g, '<em>$1</em>');
  return t.replace(new RegExp(NUL + '(\\d+)' + NUL, 'g'), (_, i) => keep[Number(i)]);
}

export function renderBody(text, allowLinks, wikiUrl) {
  const out = [];
  for (const block of String(text || '').trim().replace(/\r\n/g, '\n').split(/\n\s*\n/)) {
    const lines = block.split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim());
    if (!lines.length) continue;
    if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
      out.push('<ul>' + lines.map((l) => '<li>' + inline(l.replace(/^\s*[-*]\s+/, ''), allowLinks, wikiUrl) + '</li>').join('') + '</ul>');
    } else if (lines.every((l) => l.replace(/^\s+/, '').startsWith('>'))) {
      out.push('<blockquote><p>' + lines.map((l) => inline(l.replace(/^\s+/, '').slice(1).trim(), allowLinks, wikiUrl)).join('<br>') + '</p></blockquote>');
    } else {
      out.push('<p>' + lines.map((l) => inline(l, allowLinks, wikiUrl)).join('<br>') + '</p>');
    }
  }
  return out.join('\n');
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// A friendly date: "just now", "3 min ago", "yesterday", "3 days ago", "12 March 2026".
export function when(iso, nowMs = Date.now()) {
  const t = new Date(iso);
  const d = Math.floor((nowMs - t.getTime()) / 1000);
  if (d < 60) return 'just now';
  if (d < 3600) return Math.floor(d / 60) + ' min ago';
  if (d < 86400) return Math.floor(d / 3600) + ' h ago';
  if (d < 2 * 86400) return 'yesterday';
  if (d < 7 * 86400) return Math.floor(d / 86400) + ' days ago';
  return longDate(iso);
}

export function longDate(iso) {
  const t = new Date(iso);
  return t.getUTCDate() + ' ' + MONTHS[t.getUTCMonth()] + ' ' + t.getUTCFullYear();
}

export function monthYear(iso) {
  const t = new Date(iso);
  return MONTHS[t.getUTCMonth()] + ' ' + t.getUTCFullYear();
}

export function plural(n, one, many) {
  return n + ' ' + (n === 1 ? one : many);
}

// Search snippets mark their matches with U+E000 ... U+E001 (supabase/forum/04_api.sql, forum_search).
export function snippet(s) {
  return esc(s).split(String.fromCharCode(0xe000)).join('<mark>').split(String.fromCharCode(0xe001)).join('</mark>');
}

// The colour of a player's medallion comes from the name (made up, like the name).
export function avatarIndex(name) {
  let h = 0x811c9dc5;
  for (const ch of String(name).toLowerCase()) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 8;
}
