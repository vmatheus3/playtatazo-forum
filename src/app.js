/* The TATAZO forum's pages, built in the browser from the forum's Supabase functions. A port of the
   pages in wiki/forum/server.py (the same markup and wording, the wiki's look from static/wiki/ and
   static/forum.css), with hash addresses (#/c/guides, #/t/12) so any static host can serve it.
   Every rule is checked by the database (supabase/forum/): the pages only ask and show what comes back.
   Player text only ever reaches the page through esc() and renderBody() (src/text.js). */
import { CONFIG } from './config.js';
import * as api from './api.js';
import { ICON, CAT_GLYPH } from './glyphs.js';
import { esc, quotePlus, renderBody, when, longDate, monthYear, plural, snippet, avatarIndex } from './text.js';

const WIKI = (CONFIG.WIKI_URL || '/wiki/').replace(/\/?$/, '/');
const ASSET = 'static/wiki/';
const NAME_MAX = 20;
const PASSWORD_MIN = 8;
const TITLE_MAX = 100;
const BODY_MAX = 5000;
const NOTE_MAX = 300;
const AGE_BLOCK_KEY = 'tatazo_forum_grown_up';
const AGE_TOKEN_KEY = 'tatazo_forum_age';
const REPORT_REASONS = [
  ['unkind', 'It is unkind or bullying'],
  ['personal', 'It shares personal details (a real name, age, school, address, contact)'],
  ['unsafe', 'It makes me feel unsafe'],
  ['spam', 'It is spam or selling something'],
  ['other', 'Something else'],
];
const SORTS = [['active', 'Latest activity'], ['new', 'Newest'], ['replies', 'Most replies']];

const state = { me: undefined, route: null };

// --- small pieces ---------------------------------------------------------------------------------------

const svg = (body, cls = 'ico', box = '0 0 24 24') => `<svg class="${cls}" viewBox="${box}" fill="currentColor" aria-hidden="true" focusable="false">${body}</svg>`;
const icon = (name, cls = 'ico') => svg(ICON[name], cls);
const link = (path) => '#' + path;
const enc = (s) => encodeURIComponent(s);

function catSlot(slug, cls = '') {
  const glyph = CAT_GLYPH[slug] || CAT_GLYPH.questions;
  return `<span class="slot sparks c-${esc(slug)}${cls ? ' ' + cls : ''}" aria-hidden="true">${svg(glyph, 'glyph', '0 0 64 64')}</span>`;
}

function avatar(name) {
  if (!name) return '<span class="av av-x" aria-hidden="true">?</span>';
  return `<span class="av av-${avatarIndex(name)}" aria-hidden="true">${esc(name.slice(0, 1).toUpperCase())}</span>`;
}

function head(title, text = '', tools = '', h1Extra = '') {
  return `<div class="list-head"><div class="lh-t"><h1>${h1Extra}${esc(title)}</h1>${text ? `<p>${text}</p>` : ''}</div>${tools ? `<div class="tools">${tools}</div>` : ''}</div>`;
}

const formError = (problem) => (problem ? `<div class="callout warn" role="alert"><p>${esc(problem)}</p></div>` : '');
const isMod = () => Boolean(state.me && state.me.is_mod);
const paused = () => Boolean(state.me && state.me.paused_until);

function lostPanel(title, text, actions = `<a class="btn" href="#/">Back to the forum</a>`) {
  return `<div class="panel lost"><span class="lost-compass" aria-hidden="true"></span><h1>${esc(title)}</h1>${text ? `<p class="lost-line">${esc(text)}</p>` : ''}<p class="lost-act">${actions}</p></div>`;
}

function errorPage(title, text) {
  return { title, body: lostPanel(title, text), cls: 'pg-lost' };
}

function pageNo(q) {
  const n = parseInt(q.get('page') || '1', 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function pager(base, page, more, extra = '') {
  const sep = base.includes('?') ? '&' : '?';
  const x = extra ? '&' + extra : '';
  const parts = [];
  if (page > 1) parts.push(`<a class="pg-btn prev" href="${esc(link(base + sep + 'page=' + (page - 1) + x))}"><small>Page ${page - 1}</small><b>Newer</b></a>`);
  if (more) parts.push(`<a class="pg-btn next" href="${esc(link(base + sep + 'page=' + (page + 1) + x))}"><small>Page ${page + 1}</small><b>Older</b></a>`);
  return parts.length ? `<nav class="pager" aria-label="Pages">${parts.join('')}</nav>` : '';
}

async function ensureMe() {
  if (state.me === undefined) {
    state.me = api.hasLogin() && api.configured() ? await api.rpc('forum_me').catch(() => null) : null;
  }
  return state.me;
}

// --- the page shell -------------------------------------------------------------------------------------

function whoHtml() {
  const u = state.me;
  if (!u) return `<a class="btn cream sm login" href="#/login">${icon('user')}Log in</a><a class="btn sm join" href="#/signup">Join</a>`;
  const mod = u.is_mod ? `<a class="role mod" href="#/mod">${icon('shield')}Moderation</a>` : '';
  return `<a class="me" href="${esc(link('/u/' + enc(u.name)))}">${avatar(u.name)}<b>${esc(u.name)}</b></a>${mod}<a class="btn cream sm" href="#/account">Account</a>`
    + `<form class="inline" method="post" data-action="logout"><button class="btn cream sm" type="submit">${icon('out')}Log out</button></form>`;
}

function layout(page) {
  const u = state.me;
  const here = page.nav || 'forum';
  const cur = (k) => (here === k ? ' aria-current="page"' : '');
  const nav = `<a href="${esc(WIKI)}">Wiki</a><a href="#/"${cur('forum')}>Forum</a><a href="#/rules"${cur('rules')}>Rules</a><a href="#/search"${cur('search')}>Search</a>`;
  const rows = [['#/', 'people', 'Forum', 'Categories and threads', here === 'forum'], [WIKI, 'book', 'Wiki', 'Items, creatures and guides', false],
    ['#/rules', 'scroll', 'Rules', 'Be kind, stay safe', here === 'rules'], ['#/search', 'search', 'Search', 'Find a thread', here === 'search']];
  if (u && u.is_mod) rows.push(['#/mod', 'shield', 'Moderation', 'Reports and the log', false]);
  const drawerRows = rows.map(([h, ic, t, sm, on]) => `<a class="dl" href="${esc(h)}"${on ? ' aria-current="page"' : ''}><span class="orb">${icon(ic)}</span>`
    + `<span class="dl-t"><b>${esc(t)}</b><small>${esc(sm)}</small></span>${icon('chevron', 'ico chev-r')}</a>`).join('');
  const mobileWho = u ? `<a class="macct" href="#/account" aria-label="Your account">${avatar(u.name)}</a>` : '<a class="macct login" href="#/login">Log in</a>';
  let crumbs = '';
  if (page.crumbs) {
    const parts = [`<a class="home" href="#/">${icon('home')}<span class="sr">Forum home</span></a>`];
    for (const [t, h] of page.crumbs) parts.push(h ? `<a href="${esc(link(h))}">${esc(t)}</a>` : `<span aria-current="page">${esc(t)}</span>`);
    crumbs = `<nav class="crumbs" aria-label="Breadcrumbs">${parts.join('<i class="sep" aria-hidden="true"></i>')}</nav>`;
  }
  const banner = u && u.paused_until
    ? `<div class="callout warn"><p>Your account is paused until ${esc(longDate(u.paused_until))}: ${esc(u.pause_reason || 'a moderator paused it')}. You can still read the forum.</p></div>` : '';
  const logo = (alt) => `<img src="${ASSET}img/logo-360.webp" width="360" height="175" alt="${alt}">`;
  const q = page.q || '';
  return `<a class="skip" href="#main" data-skip>Skip to the page</a>
<header class="top"><div class="bar">`
    + `<details class="menu"><summary class="burger" aria-label="Menu">${icon('menu', 'ico i-menu')}${icon('close', 'ico i-close')}</summary>`
    + `<div class="drawer"><div class="drawer-in" role="dialog" aria-label="Menu"><p class="drawer-logo">${logo('TATAZO')}<span>Forum</span></p><hr class="dv">`
    + `<form class="dsearch" role="search" data-action="search"><input type="search" name="q" placeholder="Search the forum…" aria-label="Search the forum">`
    + `<button class="go" type="submit" aria-label="Search">${icon('search')}</button></form>`
    + `<nav aria-label="Menu">${drawerRows}</nav><div class="dwho">${whoHtml()}</div><p class="motto">Share your legend</p></div></div></details>`
    + `<a class="brand" href="#/">${logo('TATAZO Forum home')}<span class="brand-tag">Forum</span></a>`
    + `<nav class="nav" aria-label="Sections">${nav}</nav>`
    + `<form class="search" role="search" data-action="search"><input type="search" name="q" placeholder="Search the forum…" aria-label="Search the forum" value="${esc(q)}">`
    + `<button class="go" type="submit" aria-label="Search">${icon('search')}</button></form>`
    + `<div class="who">${whoHtml()}</div>${mobileWho}`
    + `</div><span class="leaves l" aria-hidden="true"></span><span class="leaves r" aria-hidden="true"></span></header>
<main id="main" tabindex="-1">${crumbs}${banner}${page.body}</main>
<footer class="foot"><div class="foot-art" aria-hidden="true"></div><div class="foot-in">`
    + `<a class="foot-brand" href="#/">TATAZO</a><p class="foot-motto">Become a legend of the isles</p>`
    + `<nav class="foot-links" aria-label="About the forum"><a href="#/rules">Rules</a><a href="#/privacy">What we keep</a>`
    + `<a href="${esc(WIKI)}">Wiki</a><a href="${esc(WIKI)}guides/family-safety.html">Families</a></nav></div>`
    + `<p class="foot-note"><b>TATAZO Forum</b>: questions, guides, builds and stories from players. Be kind, keep personal details to yourself, `
    + `and report anything that worries you. No email, no ads, no trackers, no cookies: your browser keeps you logged in.</p></footer>`;
}

function paint(page) {
  document.title = page.title + ' · TATAZO Forum';
  document.body.className = 'forum ' + (page.cls || 'pg');
  document.body.innerHTML = layout(page);
  const target = page.scrollTo && document.getElementById(page.scrollTo);
  if (target) target.scrollIntoView();
  else if (!page.keepScroll) window.scrollTo(0, 0);
}

// --- the pages -------------------------------------------------------------------------------------------

async function home() {
  const d = await api.rpc('forum_home');
  state.me = d.me;
  const cards = d.categories.map((r) => `<a class="cat fcat" href="${esc(link('/c/' + r.slug))}">${catSlot(r.slug)}<span class="cat-t"><b>${esc(r.name)}</b>`
    + `<span class="cnt">${plural(r.threads, 'thread', 'threads')} · ${plural(r.posts, 'post', 'posts')}</span>`
    + `<small class="last">${r.latest ? 'Latest: ' + esc(r.latest) : 'No threads yet: be the first!'}</small></span></a>`).join('')
    + `<a class="cat fcat" href="${esc(WIKI)}">${catSlot('wiki')}<span class="cat-t"><b>The wiki</b><span class="cnt">Items, creatures, guides</span>`
    + `<small class="last">Look it up before you ask</small></span></a>`;
  let act;
  let first;
  if (state.me) {
    act = `<a class="btn" href="#/new">${icon('plus')}Start a thread</a>`;
    first = ['#/new', 'Start a thread', 'Ask a question or share a guide, a build or a story.'];
  } else {
    act = `<a class="btn" href="#/signup">Join the forum</a><a class="btn cream" href="#/login">${icon('user')}Log in</a>`;
    first = ['#/signup', 'Join with a made-up game name', 'No email, no real names. Many players here are kids.'];
  }
  const start = [['#/rules', 'Read the rules', 'Be kind, and never share personal details: yours or anyone else\'s.'], first,
    ['#/search', 'Search before you ask', 'The answer may already be here, or in the wiki.'],
    ['#/privacy', 'What the forum keeps', 'A game name, a scrambled password and an age group. Nothing else.']];
  const startRows = start.map(([h, t, sm]) => `<li><a href="${esc(h)}"><span class="gem"></span><span class="t"><b>${esc(t)}</b><small>${esc(sm)}</small></span>${icon('chevron', 'ico chev-r')}</a></li>`).join('');
  const latestRows = d.latest.map((r) => `<li><a href="${esc(link('/t/' + r.id))}">${catSlot(r.slug, 'mini')}<span class="t"><b>${esc(r.title)}</b>`
    + `<small>${esc(r.cat)} · by ${r.author ? esc(r.author) : 'former member'} · ${plural(r.replies, 'reply', 'replies')}</small></span><time>${esc(when(r.last_post_at))}</time></a></li>`).join('')
    || '<li class="none"><span class="gem"></span>No threads yet. Start the first one!</li>';
  const body = `<section class="hero"><h1><img src="${ASSET}img/logo-640.webp" width="640" height="311" alt="TATAZO forum"></h1>`
    + `<p class="slogan">Share your legend</p><span class="slogan-dia" aria-hidden="true"></span>`
    + `<form class="hsearch search-box" role="search" data-action="search">${icon('search', 'ico mag')}<input type="search" name="q" autocomplete="off" `
    + `placeholder="Search questions, guides and stories" aria-label="Search the forum"></form>`
    + `<div class="hero-act">${act}</div></section>`
    + `<div class="wrap"><nav class="cats fcats" aria-label="The forum's categories">${cards}</nav>`
    + `<div class="duo"><section class="panel"><h2 class="orn-h">New here? Start here</h2><ul class="rows">${startRows}</ul></section>`
    + `<section class="panel"><h2 class="orn-h">Latest threads</h2><ul class="rows upd">${latestRows}</ul></section></div>`
    + `<p class="kind"><span class="gem"></span>Everyone here is a player, and many of us are kids: be kind, and never share personal details.<span class="gem"></span></p></div>`;
  return { title: 'Categories', body, cls: 'pg-home' };
}

async function category(slug, q) {
  const page = pageNo(q);
  const sort = q.get('sort') || 'active';
  const d = await api.rpc('forum_category', { p_slug: slug, p_sort: sort, p_page: page });
  if (!d) return errorPage('No such category', 'Pick one from the list.');
  state.me = d.me;
  const c = d.category;
  const items = d.threads.map((r) => `<li class="trow${r.pinned ? ' pinned' : ''}${r.hidden ? ' hidden' : ''}"><a href="${esc(link('/t/' + r.id))}">${catSlot(c.slug, 'mini')}`
    + `<span class="t"><b>${esc(r.title)}</b><small>by ${r.author ? esc(r.author) : 'former member'} · started ${esc(when(r.created_at))}</small></span>`
    + `<span class="tchips">${r.pinned ? `<span class="chip pin">${icon('pin')}Pinned</span>` : ''}${r.locked ? `<span class="chip">${icon('lock')}Locked</span>` : ''}`
    + `${r.hidden ? '<span class="chip warn">Hidden</span>' : ''}</span><span class="rc"><b>${r.replies}</b><small>repl${r.replies === 1 ? 'y' : 'ies'}</small></span>`
    + `<time>${esc(when(r.last_post_at))}</time></a></li>`).join('');
  let neu;
  if (state.me && !paused()) neu = `<a class="btn" href="${esc(link('/new?c=' + enc(slug)))}">${icon('plus')}New thread</a>`;
  else if (state.me) neu = '';
  else neu = `<p class="small signin"><a class="btn cream sm" href="#/login">${icon('user')}Log in</a> or <a href="#/signup">join</a> to start a thread.</p>`;
  const sorts = `<nav class="sorts" aria-label="Sort the threads">${SORTS.map(([k, label]) => `<a href="${esc(link('/c/' + slug + (k === 'active' ? '' : '?sort=' + k)))}"${k === d.sort ? ' aria-current="true"' : ''}>${esc(label)}</a>`).join('')}</nav>`;
  const cats = d.categories.map((r) => `<a href="${esc(link('/c/' + r.slug))}"${r.slug === slug ? ' aria-current="page"' : ''}><span class="box" aria-hidden="true"></span><span class="nm">${esc(r.name)}</span><span class="n">${r.threads}</span></a>`).join('');
  const body = `<div class="listpage flist">${head(c.name, esc(c.blurb), sorts + (state.me ? neu : ''), catSlot(c.slug, 'hslot'))}`
    + `<aside class="panel filters"><h2>Categories</h2><nav class="catlist" aria-label="Categories">${cats}</nav>`
    + `<div class="fnew">${neu || '<p class="small muted">Your account is paused: you can read, not post.</p>'}</div></aside>`
    + `<div class="lmain"><div class="panel tlist"><ul class="trows">${items || '<li class="none"><span class="gem"></span>No threads yet. Be the first!</li>'}</ul></div>`
    + `${pager('/c/' + slug, d.page, d.more, d.sort === 'active' ? '' : 'sort=' + d.sort)}</div></div>`;
  return { title: c.name, body, crumbs: [[c.name, null]], cls: 'pg-list' };
}

function postHtml(p, t) {
  const author = p.author
    ? `<a class="author" href="${esc(link('/u/' + enc(p.author)))}">${avatar(p.author)}<b>${esc(p.author)}</b></a>`
    : `<span class="author gone">${avatar(null)}<b>former member</b></span>`;
  const badge = p.author && (p.author_role === 'moderator' || p.author_role === 'admin') ? ` <span class="role mod">${icon('shield')}Moderator</span>` : '';
  let body;
  if (p.removed) body = '<p class="muted"><i>Removed by its author.</i></p>';
  else if (p.body === null) body = '<p class="muted"><i>A moderator hid this post.</i></p>';
  else body = (p.hidden ? '<p class="chip warn">Hidden from members</p>' : '') + renderBody(p.body, p.links, WIKI);
  const tools = [];
  if (state.me && !p.mine && !p.removed && !paused()) tools.push(`<a class="report" href="${esc(link('/p/' + p.id + '/report?t=' + t.id))}">${icon('flag')}Report</a>`);
  if (!state.me && !p.removed) tools.push(`<a class="report" href="#/login">${icon('flag')}Report</a>`);
  if (isMod()) {
    tools.push(`<form class="inline" method="post" data-action="mod-post" data-id="${p.id}" data-act="${p.hidden ? 'unhide' : 'hide'}">`
      + `<button class="linkish" type="submit">${icon('eye')}${p.hidden ? 'Show again' : 'Hide'}</button></form>`);
  }
  const cls = 'panel post' + (p.n === 1 ? ' op' : '') + (badge ? ' by-mod' : '') + (p.hidden ? ' is-hidden' : '');
  return `<article class="${cls}" id="p${p.id}"><header class="phead">${author}${badge}<span class="pmeta">${p.n === 1 ? '<span class="opener">Started the thread</span> · ' : ''}`
    + `${esc(when(p.created_at))} · <a href="${esc(link('/t/' + t.id + '?p=' + p.id))}">#${p.n}</a></span></header>`
    + `<div class="body">${body}</div>${tools.length ? `<footer class="ptools">${tools.join('')}</footer>` : ''}</article>`;
}

async function thread(id, q, opts = {}) {
  const d = await api.rpc('forum_thread', { p_id: Number(id), p_page: pageNo(q) });
  if (!d) return errorPage('Thread not found', 'It may have been hidden by a moderator.');
  state.me = d.me;
  const t = d.thread;
  const posts = d.posts.map((p) => postHtml(p, t)).join('');
  const starter = t.author ? `<a href="${esc(link('/u/' + enc(t.author)))}">${esc(t.author)}</a>` : 'former member';
  let tools = '';
  if (isMod()) {
    const acts = [[t.locked ? 'unlock' : 'lock', t.locked ? 'Unlock' : 'Lock'], [t.pinned ? 'unpin' : 'pin', t.pinned ? 'Unpin' : 'Pin'],
      [t.hidden ? 'unhide' : 'hide', t.hidden ? 'Show thread' : 'Hide thread']];
    tools = `<section class="panel side modtools"><h2 class="line-h">Moderator tools</h2><div class="modbar">${acts.map(([a, label]) =>
      `<form class="inline" method="post" data-action="mod-thread" data-id="${t.id}" data-act="${a}"><button class="btn small cream" type="submit">${label}</button></form>`).join('')}</div></section>`;
  }
  let reply;
  if (t.locked) reply = '<div class="callout note"><p>This thread is locked: no new replies.</p></div>';
  else if (!state.me) {
    reply = `<div class="panel signin-panel"><p><b>Want to reply?</b> Log in, or join with a made-up game name.</p>`
      + `<div class="actions"><a class="btn" href="#/login">${icon('user')}Log in</a><a class="btn cream" href="#/signup">Join the forum</a></div></div>`;
  } else if (paused()) reply = '';
  else {
    reply = `<form class="panel compose reply" method="post" data-action="reply" data-id="${t.id}"><h2>Write a reply</h2>${formError(opts.error)}`
      + `<label class="sr" for="reply-body">Your reply</label><textarea id="reply-body" name="body" rows="6" maxlength="${BODY_MAX}" required>${esc(opts.draft || '')}</textarea>`
      + `${HINT}<div class="actions"><button class="btn" type="submit">${icon('bubble')}Post reply</button></div></form>`;
  }
  const chips = (t.pinned ? `<span class="chip pin">${icon('pin')}Pinned</span>` : '') + (t.locked ? `<span class="chip">${icon('lock')}Locked</span>` : '')
    + (t.hidden ? '<span class="chip warn">Hidden</span>' : '');
  const facts = [['Category', `<a href="${esc(link('/c/' + t.slug))}">${esc(t.cat)}</a>`], ['Started by', starter], ['Started', esc(when(t.created_at))],
    ['Replies', String(t.replies)], ['Last post', esc(when(t.last_post_at))], ['Status', t.locked ? 'Locked' : 'Open']];
  const box = `<div class="infobox tbox"><div class="ib"><p class="ib-title">This thread</p>${catSlot(t.slug, 'tslot')}<dl class="stats">`
    + `${facts.map(([k, v]) => `<div class="st"><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl><div class="ib-foot"><p class="motto">Be kind, stay safe</p></div></div></div>`;
  const safety = '<section class="panel side"><h2 class="line-h">Stay safe</h2><ul class="tips">'
    + '<li>Never share your real name, age, school, address, phone or photos.</li>'
    + '<li>Nobody here should ask you for them, or to chat somewhere else.</li>'
    + '<li>Something wrong? Press <b>Report</b> on the post, and tell a grown-up you trust.</li></ul></section>';
  const body = `<div class="fthread"><div class="tmain"><div class="ahead"><div class="title-row"><h1>${esc(t.title)}</h1>`
    + `<a class="kbadge" href="${esc(link('/c/' + t.slug))}">${svg(CAT_GLYPH[t.slug] || '', 'ico kglyph', '0 0 64 64')}${esc(t.cat)}</a></div>`
    + `<p class="sub">Started by ${starter} · ${esc(when(t.created_at))} · ${plural(t.replies, 'reply', 'replies')}</p>${chips ? `<div class="chips">${chips}</div>` : ''}<hr class="dv"></div>`
    + `<div class="posts">${posts}</div>${pager('/t/' + t.id, d.page, d.more)}${reply}</div><aside class="taside">${tools}${box}${safety}</aside></div>`;
  return { title: t.title, body, crumbs: [[t.cat, '/c/' + t.slug], [t.title, null]], cls: 'pg-thread', scrollTo: opts.scrollTo || (q.get('p') ? 'p' + q.get('p') : null) };
}

const HINT = '<p class="hint">**bold**, *italic*, `code`, lines starting with - make a list, [[Moonstone]] links to the wiki. Never share personal details.</p>';

async function search(q) {
  const words = (q.get('q') || '').trim().slice(0, 100);
  let results = '';
  if (words) {
    const rows = await api.rpc('forum_search', { p_q: words });
    if (rows.length) {
      results = `<p class="found">${plural(rows.length, 'thread', 'threads')} found</p><ul class="rows found-rows">${rows.map((r) =>
        `<li><a href="${esc(link('/t/' + r.thread_id + '?p=' + r.post_id))}">${catSlot(r.slug, 'mini')}<span class="t"><b>${esc(r.title)}</b><small>${esc(r.cat)} · ${snippet(r.snip)}</small></span>${icon('chevron', 'ico chev-r')}</a></li>`).join('')}</ul>`;
    } else {
      results = `<div class="callout note"><p>Nothing found on the forum. Try the <a href="${esc(WIKI + 'search.html?q=' + quotePlus(words))}">wiki</a>.</p></div>`;
    }
  }
  await ensureMe();
  const body = `${head('Search', 'Search every thread title and post on the forum.')}<div class="panel apanel fsearch"><form class="hsearch" role="search" data-action="search">${icon('search', 'ico mag')}`
    + `<input type="search" name="q" value="${esc(words)}" placeholder="Search questions, guides and stories" aria-label="Search words">`
    + `<button class="btn" type="submit">Search</button></form>${results || `<p class="muted small">Tip: the wiki has every item, creature and recipe. <a href="${esc(WIKI)}">Open the wiki</a>.</p>`}</div>`;
  return { title: 'Search', body, crumbs: [['Search', null]], cls: 'pg-form', nav: 'search', q: words };
}

async function profile(name) {
  const d = await api.rpc('forum_profile', { p_name: name });
  if (!d) return errorPage('No such player', 'That name is not on the forum.');
  state.me = d.me;
  const u = d.profile;
  const chips = [];
  if (u.role === 'moderator' || u.role === 'admin') chips.push(`<span class="role mod">${icon('shield')}Moderator</span>`);
  if (u.trusted) chips.push('<span class="chip">Trusted</span>');
  let mod = '';
  if (d.mod) {
    const acts = [];
    if (d.mod.paused_until) acts.push(['unpause', 'Unpause', '']);
    else {
      acts.push(['pause', 'Pause', '<select name="days" aria-label="How long"><option value="1">1 day</option><option value="7">7 days</option>'
        + '<option value="30">30 days</option><option value="36500">For good</option></select>'
        + '<input name="reason" maxlength="120" placeholder="Why (the player sees this)" required>']);
    }
    acts.push(u.trusted ? ['untrust', 'Stop trusting (no links)', ''] : ['trust', 'Trust (may post links)', '']);
    acts.push(['rename', 'Give a new game name', '']);
    const pausedLine = d.mod.paused_until ? ` Paused until ${esc(longDate(d.mod.paused_until))}: ${esc(d.mod.pause_reason)}.` : '';
    mod = `<section class="panel apanel"><h2>Moderation</h2>${acts.map(([a, label, extra]) =>
      `<form class="modrow" method="post" data-action="mod-user" data-id="${esc(u.id)}" data-act="${a}">${extra}<button class="btn small cream" type="submit">${label}</button></form>`).join('')}`
      + `<p class="small muted">Age group: ${esc(d.mod.age_band)}. Joined ${esc(when(u.created_at))}.${pausedLine}</p></section>`;
  }
  const body = `<div class="fpage"><div class="fmain">${head(u.name, '', '', avatar(u.name))}<section class="panel apanel profile"><div class="phero"><div><div class="chips">`
    + `${chips.join('') || '<span class="chip">Member</span>'}</div><p>Joined ${esc(monthYear(u.created_at))} · ${plural(u.posts, 'post', 'posts')}</p></div></div></section>${mod}</div></div>`;
  return { title: u.name, body, crumbs: [[u.name, null]], cls: 'pg-form' };
}

function tipsPanel() {
  return `<section class="panel side"><h2 class="line-h">Good threads</h2><ul class="tips"><li>Search first: the answer may already be here or in the `
    + `<a href="${esc(WIKI)}">wiki</a>.</li><li>Pick the right category and a title that says what it is about.</li>`
    + '<li>Trades are for items and orange coins in the game, never real money.</li>'
    + '<li>Never share personal details: yours or anyone else\'s.</li></ul></section>';
}

async function newThread(q, opts = {}) {
  if (!api.hasLogin()) return { redirect: '/login' };
  const d = await api.rpc('forum_categories');
  state.me = d.me;
  if (!state.me) return { redirect: '/login' };
  if (paused()) return errorPage('Your account is paused', 'You can read the forum, but not post, until the pause ends.');
  const want = opts.cat || q.get('c') || '';
  const opts2 = d.categories.map((c) => `<option value="${esc(c.slug)}"${c.slug === want ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
  const body = `<div class="fpage">${head('New thread', 'Ask a question, share a guide, show a build or tell a story.')}<div class="fmain">`
    + `<form class="panel apanel compose" method="post" data-action="new-thread">${formError(opts.error)}<label>Category <select name="c">${opts2}</select></label>`
    + `<label>Title <input name="title" maxlength="${TITLE_MAX}" required value="${esc(opts.title || '')}"></label>`
    + `<label>Your post <textarea name="body" rows="10" maxlength="${BODY_MAX}" required>${esc(opts.draft || '')}</textarea></label>`
    + '<p class="hint">**bold**, *italic*, `code`, lines starting with - make a list, [[Moonstone]] links to the wiki. Never share personal details: '
    + 'not your real name, age, school, address, phone, photos or other accounts.</p>'
    + `<div class="actions"><button class="btn" type="submit">${icon('plus')}Post thread</button></div></form></div><aside class="fside">${tipsPanel()}</aside></div>`;
  return { title: 'New thread', body, crumbs: [['New thread', null]], cls: 'pg-form' };
}

async function reportForm(pid, q, opts = {}) {
  if (!api.hasLogin()) return { redirect: '/login' };
  await ensureMe();
  if (!state.me) return { redirect: '/login' };
  const tid = q.get('t');
  const back = tid ? link('/t/' + tid + '?p=' + pid) : '#/';
  const reasons = REPORT_REASONS.map(([k, v]) => `<label class="choice"><input type="radio" name="reason" value="${k}" required> ${esc(v)}</label>`).join('');
  const body = `<div class="fpage">${head('Report a post', 'Thank you for looking out for everyone. A moderator will look at it. The person you report is not told who reported them.')}`
    + `<div class="fmain"><form class="panel apanel compose" method="post" data-action="report" data-id="${esc(pid)}" data-thread="${esc(tid || '')}">${formError(opts.error)}`
    + `<fieldset><legend>What is wrong?</legend>${reasons}</fieldset>`
    + `<label>Anything else a moderator should know? (optional) <textarea name="note" rows="3" maxlength="${NOTE_MAX}"></textarea></label>`
    + `<div class="actions"><button class="btn" type="submit">${icon('flag')}Send the report</button> <a class="btn cream" href="${esc(back)}">Cancel</a></div>`
    + '<div class="callout note"><p>If someone is making you feel unsafe, tell a grown-up you trust too.</p></div></form></div>'
    + '<aside class="fside"><section class="panel side"><h2 class="line-h">What happens next</h2><ul class="tips"><li>A moderator reads every report.</li>'
    + '<li>The person you report is not told who reported them.</li><li>You don\'t need to argue or reply: the report is enough.</li></ul></section></aside></div>';
  return { title: 'Report a post', body, crumbs: [['Report', null]], cls: 'pg-form' };
}

// --- joining and logging in ----------------------------------------------------------------------------------

function grownUpBlocked() {
  try {
    return Number(localStorage.getItem(AGE_BLOCK_KEY) || 0) > Date.now();
  } catch (e) {
    return false;
  }
}

function joinPanel() {
  return `<section class="panel side"><h2 class="line-h">Already a member?</h2><p><a class="btn cream" href="#/login">${icon('user')}Log in</a></p>`
    + '<ul class="tips"><li>No email needed, and no real names.</li><li>Many players here are kids: be kind.</li>'
    + '<li>Read the <a href="#/rules">rules</a> before you post.</li></ul></section>';
}

async function signupAge(q, opts = {}) {
  await ensureMe();
  if (state.me) return { redirect: '/' };
  if (grownUpBlocked()) return grownUp();
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    .map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
  const year = new Date().getUTCFullYear();
  let years = '';
  for (let y = year; y > year - 100; y -= 1) years += `<option value="${y}">${y}</option>`;
  const body = `<div class="fpage">${head('Join the forum', 'A made-up game name and a password. No email, no real names.')}<div class="fmain">`
    + `<form class="panel apanel compose" method="post" data-action="age">${formError(opts.error)}<p class="step">Step 1 of 2</p><h2>When were you born?</h2>`
    + `<div class="row"><label>Month <select name="month" required><option value="" selected disabled>Month</option>${months}</select></label>`
    + `<label>Year <select name="year" required><option value="" selected disabled>Year</option>${years}</select></label></div>`
    + '<div class="actions"><button class="btn" type="submit">Next</button></div><p class="hint">The forum keeps only an age group, never the date.</p></form></div>'
    + `<aside class="fside">${joinPanel()}</aside></div>`;
  return { title: 'Join', body, crumbs: [['Join', null]], cls: 'pg-form' };
}

function grownUp() {
  const body = '<div class="panel lost grownup"><span class="lost-compass" aria-hidden="true"></span><h1>Ask a grown-up to help</h1>'
    + '<p class="lost-line">Thanks for telling us! To join the forum, players your age need a parent or '
    + `guardian to set up the account with them.</p><p>Until then, you can read everything here, and the <a href="${esc(WIKI)}">wiki</a> has guides, `
    + 'tales and every item and creature in the game.</p><div class="callout note"><p><b>For parents and guardians:</b> family accounts are '
    + 'not open yet. When they are, this is where you will set one up.</p></div>'
    + `<p class="lost-act"><a class="btn" href="#/">Read the forum</a><a class="btn cream" href="${esc(WIKI)}">Open the wiki</a></p></div>`;
  return { title: 'Ask a grown-up', body, crumbs: [['Join', null]], cls: 'pg-lost' };
}

function ageToken() {
  try {
    return sessionStorage.getItem(AGE_TOKEN_KEY) || '';
  } catch (e) {
    return state.ageToken || '';
  }
}

async function signupName(q, opts = {}) {
  await ensureMe();
  if (state.me) return { redirect: '/' };
  if (grownUpBlocked()) return grownUp();
  if (!ageToken()) return { redirect: '/signup' };
  const names = await api.rpc('forum_suggest_names').catch(() => []);
  const suggestions = names.map((n) => `<li><code>${esc(n)}</code></li>`).join('');
  const body = `<div class="fpage">${head('Join the forum', 'A made-up game name and a password. No email, no real names.')}<div class="fmain">`
    + `<form class="panel apanel compose" method="post" data-action="join"><p class="step">Step 2 of 2</p><h2>Pick a game name</h2>${formError(opts.error)}`
    + `<div class="callout safe"><p><b>Never use your real name.</b> Pick a made-up name, like one of these:</p><ul class="inline-list">${suggestions}</ul></div>`
    + `<label>Game name <input name="name" maxlength="${NAME_MAX}" autocomplete="username" required value="${esc(opts.name || '')}"></label>`
    + `<label>Password <input type="password" name="password" autocomplete="new-password" minlength="${PASSWORD_MIN}" required></label>`
    + `<label>Password again <input type="password" name="password2" autocomplete="new-password" minlength="${PASSWORD_MIN}" required></label>`
    + '<p class="hint">No email needed. Write your password down somewhere safe at home: without email, it can\'t be sent to you.</p>'
    + '<label class="choice"><input type="checkbox" name="rules" value="yes" required> I have read the <a href="#/rules">rules</a> and will be kind.</label>'
    + `<div class="actions"><button class="btn" type="submit">Join the forum</button></div></form></div><aside class="fside">${joinPanel()}</aside></div>`;
  return { title: 'Join', body, crumbs: [['Join', null]], cls: 'pg-form' };
}

async function loginForm(q, opts = {}) {
  await ensureMe();
  const body = `<div class="fpage">${head('Log in', 'Welcome back! Log in with your game name.')}<div class="fmain"><form class="panel apanel compose" method="post" data-action="login">${formError(opts.error)}`
    + `<label>Game name <input name="name" autocomplete="username" required value="${esc(opts.name || '')}"></label>`
    + '<label>Password <input type="password" name="password" autocomplete="current-password" required></label>'
    + `<div class="actions"><button class="btn" type="submit">${icon('user')}Log in</button></div></form></div>`
    + '<aside class="fside"><section class="panel side"><h2 class="line-h">New here?</h2><p>Join with a made-up game name. No email needed.</p>'
    + '<p><a class="btn" href="#/signup">Join the forum</a></p><div class="callout safe"><p><b>Never use your real name</b> as your game name or password.</p></div>'
    + '<p class="small"><b>Forgot your password?</b> There is no email, so it can\'t be sent to you. Ask a grown-up to contact the forum team: '
    + 'a moderator can set a new one once they know the account is yours.</p></section></aside></div>';
  return { title: 'Log in', body, crumbs: [['Log in', null]], cls: 'pg-form' };
}

async function account(q, opts = {}) {
  if (!api.hasLogin()) return { redirect: '/login' };
  await ensureMe();
  if (!state.me) return { redirect: '/login' };
  const u = state.me;
  const body = `<div class="fpage">${head('Your account')}<div class="fmain">${opts.message ? `<div class="callout note" role="status"><p>${esc(opts.message)}</p></div>` : ''}`
    + `<section class="panel apanel profile"><div class="phero">${avatar(u.name)}<p>Game name: <b>${esc(u.name)}</b>. Joined ${esc(when(u.created_at))}.</p></div></section>`
    + '<form class="panel apanel compose" method="post" data-action="password"><h2>Change your password</h2>'
    + '<label>Password now <input type="password" name="old" autocomplete="current-password" required></label>'
    + `<label>New password <input type="password" name="new" autocomplete="new-password" minlength="${PASSWORD_MIN}" required></label>`
    + '<div class="actions"><button class="btn" type="submit">Change it</button></div></form>'
    + '<form class="panel apanel compose danger" method="post" data-action="delete"><h2>Delete your account</h2><p>This removes your account and the words of all '
    + 'your posts, for good. Other people\'s replies stay.</p><label>Password <input type="password" name="password" autocomplete="current-password" required></label>'
    + '<label class="choice"><input type="checkbox" name="sure" value="yes" required> Yes, delete my account</label>'
    + '<div class="actions"><button class="btn cream" type="submit">Delete my account</button></div></form></div>'
    + '<aside class="fside"><section class="panel side"><h2 class="line-h">Your details</h2><ul class="tips"><li>The forum keeps your game name, a scrambled '
    + 'password and an age group. <a href="#/privacy">What the forum keeps</a>.</li><li>Write your password down somewhere safe at home.</li></ul></section></aside></div>';
  return { title: 'Your account', body, crumbs: [['Your account', null]], cls: 'pg-form' };
}

// --- the fixed pages -----------------------------------------------------------------------------------------

async function rules() {
  await ensureMe();
  const article = `<article class="panel apanel prose rules">
<h2>Be kind</h2>
<ul><li>Talk to others the way you would like them to talk to you.</li><li>No bullying, teasing, mean nicknames or piling on.</li>
<li>Everyone was new once. Answer questions patiently.</li><li>Disagree with ideas, never with people.</li></ul>
<h2>Keep personal details to yourself</h2>
<ul><li>Never post your real name, age, birthday, school, town, address, phone number, email or photos of yourself.</li>
<li>Never share accounts on other apps or invite people to chat somewhere else.</li><li>Never ask anyone else for these things either.</li>
<li>Never agree to meet someone from the internet. If anyone asks, tell a grown-up you trust and press Report.</li></ul>
<h2>Keep it about the game</h2>
<ul><li>Post in the right category, and search before you ask: the answer may already be there, or in the <a href="${esc(WIKI)}">wiki</a>.</li>
<li>Trades are for items and orange coins in the game. Never trade for real money or gift cards, and never share your game password.</li>
<li>No spam, no adverts, no chain messages.</li><li>Only post writing that is your own, and say so when you tell someone else's idea.</li></ul>
<h2>When something is wrong</h2>
<ul><li>Press <b>Report</b> on the post instead of arguing. Moderators read every report.</li>
<li>If something online makes you feel worried, scared or uncomfortable, stop and tell a grown-up you trust. It is never your fault.</li></ul>
<h2>What moderators do</h2>
<p>Moderators can hide posts, lock threads, give an account a new game name, and pause accounts for a while or for good. They do it to keep the forum safe, and every action is written in a log.</p>
<h2>For grown-ups</h2>
<p>If you are an adult here, you are welcome, and you have a special job: help younger players, never ask a child personal questions, and report anything that
worries you. Accounts that try to contact children privately are removed.</p></article>`;
  const short = [['Be kind', 'Talk to others the way you would like them to talk to you.'],
    ['Keep personal details to yourself', 'No real names, ages, schools, addresses, phones or photos.'],
    ['Keep it about the game', 'Trades are for items and orange coins, never real money.'],
    ['Report, don\'t argue', 'Moderators read every report. Tell a grown-up you trust.']]
    .map(([t, sm]) => `<li><span class="gem"></span><span class="t"><b>${esc(t)}</b><small>${esc(sm)}</small></span></li>`).join('');
  const body = `<div class="fpage">${head('The rules', 'This forum is for everyone who plays TATAZO, and many players are children. These rules keep it friendly and safe.')}`
    + `<div class="fmain">${article}</div><aside class="fside"><section class="panel side"><h2 class="line-h">In short</h2><ul class="rows short">${short}</ul></section>`
    + '<section class="panel side"><h2 class="line-h">Something wrong?</h2><p>Press <b>Report</b> on the post. The person you report is not told who reported them.</p>'
    + '<p class="small"><a href="#/privacy">What the forum keeps</a></p></section></aside></div>';
  return { title: 'Rules', body, crumbs: [['Rules', null]], cls: 'pg-form', nav: 'rules' };
}

async function privacy() {
  await ensureMe();
  const article = `<article class="panel apanel prose"><h2>What is kept</h2>
<ul><li><b>Your game name</b> and a <b>scrambled copy of your password</b> (a "hash": nobody can read the password back, not even the forum's owner).</li>
<li><b>An age group</b> (13 to 15, 16 to 17 or 18 and over), so safety rules can fit. Not your birthday.</li>
<li><b>What you post</b>, your reports, and when things happened.</li>
<li><b>A login key in your browser</b> while you are logged in (kept in the browser's storage for this site). No cookies.</li></ul>
<p>The forum does <b>not</b> ask for an email, a real name, a photo or a phone number. Behind the scenes your account has a made-up address built from your
game name (like <code>mossyotter42@players.tatazo.invalid</code>): it is not an email, it can never receive anything, and nothing is ever sent to it.</p>
<p>The forum has no adverts and no trackers. Its pages are kept by a web host and its database by Supabase, the companies that run it for us; they don't use
what is here for adverts. Like every website, they see visitors' internet addresses for a short while to keep things running and slow down spam.
When you join, the forum keeps a scrambled form of your internet address for one hour, so one place can't make lots of accounts.</p>
<p>You can delete your account at any time on the <a href="#/account">account page</a>: your posts' words are removed with it.</p></article>`;
  const body = `<div class="fpage">${head('What the forum keeps', 'Only what the forum needs to work and to keep players safe.')}<div class="fmain">${article}</div><aside class="fside">`
    + '<section class="panel side"><h2 class="line-h">Nothing else</h2><ul class="tips"><li>No email and no real names.</li><li>No adverts and no trackers.</li>'
    + '<li>Nothing is sold or shared for adverts.</li></ul></section></aside></div>';
  return { title: 'What the forum keeps', body, crumbs: [['Privacy', null]], cls: 'pg-form', nav: '' };
}

function opensSoon() {
  const body = '<div class="panel lost"><span class="lost-compass" aria-hidden="true"></span><h1>The forum opens soon</h1>'
    + '<p class="lost-line">The TATAZO forum is getting ready: a friendly place to ask questions and share guides, builds and stories.</p>'
    + `<p>Until then, the <a href="${esc(WIKI)}">wiki</a> has guides, tales and every item and creature in the game, and you can read the forum's rules now.</p>`
    + `<p class="lost-act"><a class="btn" href="#/rules">Read the rules</a><a class="btn cream" href="${esc(WIKI)}">Open the wiki</a></p></div>`;
  return { title: 'Opens soon', body, cls: 'pg-lost' };
}

// --- moderation -----------------------------------------------------------------------------------------------

const REASON_TEXT = Object.fromEntries(REPORT_REASONS);

async function modHome() {
  if (!api.hasLogin()) return { redirect: '/login' };
  const d = await api.rpc('forum_mod_home');
  state.me = d.me;
  const rows = d.reports.map((r) => `<li class="report-row"><p class="rhead">${icon('flag')}<span><b>${esc(REASON_TEXT[r.reason] || r.reason)}</b> · `
    + `<a href="${esc(link('/t/' + r.thread_id + '?p=' + r.post_id))}">a post by ${r.author ? esc(r.author) : 'former member'}</a> · ${esc(when(r.created_at))}</span></p>`
    + `<blockquote><p>${esc(r.body)}</p></blockquote>${r.note ? `<p class="small">Note: ${esc(r.note)}</p>` : ''}`
    + `<div class="actions"><form class="inline" method="post" data-action="mod-report" data-id="${r.id}" data-act="hide"><button class="btn small" type="submit">Hide the post</button></form> `
    + `<form class="inline" method="post" data-action="mod-report" data-id="${r.id}" data-act="dismiss"><button class="btn small cream" type="submit">Nothing wrong</button></form></div></li>`).join('');
  const prow = d.paused.map((u) => `<li><a href="${esc(link('/u/' + enc(u.name)))}">${esc(u.name)}</a> until ${esc(longDate(u.until))}: ${esc(u.reason)}</li>`).join('');
  const lrow = d.log.map((a) => `<tr><td class="nowrap">${esc(when(a.at))}</td><td>${esc(a.who)}</td><td>${esc(a.action)} ${esc(a.target)} ${esc(a.detail)}</td></tr>`).join('');
  const body = `<div class="fpage">${head('Moderation', 'Open reports first. Hidden posts stay in the database and can be shown again; every action is logged.')}`
    + `<div class="fmain"><section class="panel apanel"><h2>Open reports <span class="count">${d.reports.length}</span></h2><ul class="plain reports">${rows || '<li class="muted">No open reports.</li>'}</ul></section>`
    + `<section class="panel apanel"><h2>Recent actions</h2>${lrow ? `<div class="table-wrap"><table class="list"><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead><tbody>${lrow}</tbody></table></div>` : '<p class="muted">Nothing yet.</p>'}</section></div>`
    + `<aside class="fside"><section class="panel side"><h2 class="line-h">Paused accounts</h2><ul class="tips">${prow || '<li class="muted">None.</li>'}</ul></section></aside></div>`;
  return { title: 'Moderation', body, crumbs: [['Moderation', null]], cls: 'pg-form' };
}

// --- routing ----------------------------------------------------------------------------------------------------

function parseRoute() {
  let raw;
  try {
    raw = decodeURI(location.hash.replace(/^#/, '')) || '/';
  } catch (e) {
    raw = '/nowhere';
  }
  const [path, query] = raw.split('?');
  return { path: path || '/', q: new URLSearchParams(query || '') };
}

const ROUTES = [
  [/^\/$/, () => home()],
  [/^\/c\/([a-z-]+)$/, (m, q) => category(m[1], q)],
  [/^\/t\/(\d+)$/, (m, q, o) => thread(m[1], q, o)],
  [/^\/new$/, (m, q, o) => newThread(q, o)],
  [/^\/p\/(\d+)\/report$/, (m, q, o) => reportForm(m[1], q, o)],
  [/^\/search$/, (m, q) => search(q)],
  [/^\/signup$/, (m, q, o) => signupAge(q, o)],
  [/^\/signup\/name$/, (m, q, o) => signupName(q, o)],
  [/^\/grown-up$/, () => grownUp()],
  [/^\/login$/, (m, q, o) => loginForm(q, o)],
  [/^\/u\/([A-Za-z0-9_-]+)$/, (m) => profile(m[1])],
  [/^\/account$/, (m, q, o) => account(q, o)],
  [/^\/rules$/, () => rules()],
  [/^\/privacy$/, () => privacy()],
  [/^\/mod$/, () => modHome()],
];

async function render(opts = {}) {
  const r = parseRoute();
  state.route = r;
  let page;
  if (!api.configured() && !['/rules', '/privacy'].includes(r.path)) {
    state.me = null;
    page = opensSoon();
  } else {
    const hit = ROUTES.map(([re, fn]) => [r.path.match(re), fn]).find(([m]) => m);
    try {
      page = hit ? await hit[1](hit[0], r.q, opts) : errorPage('Page not found', 'There is nothing at this address. Try the categories or the search.');
    } catch (e) {
      page = problemPage(e);
    }
  }
  if (page.redirect) {
    go(page.redirect);
    return;
  }
  if (opts.keepScroll) page.keepScroll = true;
  paint(page);
  if (opts.focusError) {
    const note = document.querySelector('main [role=alert], main [role=status]');
    if (note) note.scrollIntoView({ block: 'center' });
  }
}

function problemPage(e) {
  if (e && e.code === '42501') {
    if (/log in/i.test(e.message)) return { redirect: '/login' };
    return errorPage(/Moderators/.test(e.message) ? 'Moderators only' : 'Not allowed', /Moderators/.test(e.message) ? 'This page is for the forum team.' : e.message);
  }
  if (e && e.code === 'P0002') return errorPage('Not found', e.message);
  return errorPage('Something went wrong', (e && e.status === 0) || !(e && e.message) ? api.OFFLINE : 'Please try again in a moment.');
}

function go(path) {
  if (location.hash === '#' + path) render();
  else location.hash = path;
}

// --- forms -----------------------------------------------------------------------------------------------------

const ACTIONS = {
  async search(f) {
    const q = (f.elements.q.value || '').trim();
    go('/search' + (q ? '?q=' + enc(q) : ''));
  },
  async logout() {
    await api.logout();
    state.me = null;
    go('/');
  },
  async age(f) {
    const d = await api.rpc('forum_age_check', { p_month: Number(f.elements.month.value), p_year: Number(f.elements.year.value) });
    if (d.grown_up) {
      // Like the Python forum's cookie: this browser gets the same page for a day. Nothing is sent or kept anywhere else.
      try { localStorage.setItem(AGE_BLOCK_KEY, String(Date.now() + 24 * 3600 * 1000)); } catch (e) { /* storage off: the page still shows */ }
      go('/grown-up');
      return;
    }
    state.ageToken = d.token;
    try { sessionStorage.setItem(AGE_TOKEN_KEY, d.token); } catch (e) { /* kept in memory instead */ }
    go('/signup/name');
  },
  async join(f) {
    const name = f.elements.name.value.trim();
    const password = f.elements.password.value;
    const again = { name };
    if (grownUpBlocked()) return go('/grown-up');
    if (password !== f.elements.password2.value) return retry({ ...again, error: 'The two passwords are not the same.' });
    if (!f.elements.rules.checked) return retry({ ...again, error: 'Please read the rules and tick the box.' });
    // The database checks everything (name, password, age answer, rules box, sign-ups from this address)
    // and makes the account; then the page logs in with Supabase Auth.
    const check = await api.rpc('forum_signup', { p_name: name, p_password: password, p_age_token: ageToken(), p_rules: true })
      .catch((e) => { e.keep = again; throw e; });
    if (check.restart) {
      try { sessionStorage.removeItem(AGE_TOKEN_KEY); } catch (e) { /* nothing kept */ }
      state.ageToken = '';
      go('/signup');
      return;
    }
    if (check.problem) return retry({ ...again, error: check.problem });
    await api.login(name, password);
    try { sessionStorage.removeItem(AGE_TOKEN_KEY); } catch (e) { /* nothing kept */ }
    state.me = undefined;
    go('/');
  },
  async login(f) {
    const name = f.elements.name.value.trim();
    await api.login(name, f.elements.password.value).catch((e) => { e.keep = { name }; throw e; });
    state.me = undefined;
    await ensureMe();
    go('/');
  },
  async 'new-thread'(f) {
    const fields = { cat: f.elements.c.value, title: f.elements.title.value, draft: f.elements.body.value };
    const id = await api.rpc('forum_new_thread', { p_category: fields.cat, p_title: fields.title, p_body: fields.draft })
      .catch((e) => { e.keep = fields; throw e; });
    go('/t/' + id);
  },
  async reply(f) {
    const draft = f.elements.body.value;
    const d = await api.rpc('forum_reply', { p_thread: Number(f.dataset.id), p_body: draft }).catch((e) => { e.keep = { draft }; throw e; });
    go('/t/' + d.thread_id + '?' + (d.page > 1 ? 'page=' + d.page + '&' : '') + 'p=' + d.post_id);
  },
  async report(f) {
    const reason = f.elements.reason.value;
    if (!reason) return retry({ error: 'Pick what is wrong and try again.' });
    await api.rpc('forum_report', { p_post: Number(f.dataset.id), p_reason: reason, p_note: f.elements.note.value });
    const back = f.dataset.thread ? link('/t/' + f.dataset.thread + '?p=' + f.dataset.id) : '#/';
    paint({ title: 'Report sent', cls: 'pg-lost', body: lostPanel('Thank you', 'A moderator will look at it soon.', `<a class="btn" href="${esc(back)}">Back to the thread</a>`) });
  },
  async password(f) {
    const message = await api.rpc('forum_change_password', { p_old: f.elements.old.value, p_new: f.elements.new.value });
    return retry({ message });
  },
  async delete(f) {
    const r = await api.rpc('forum_delete_account', { p_password: f.elements.password.value, p_sure: f.elements.sure.checked });
    if (r !== 'deleted') return retry({ message: r });
    api.forget();
    state.me = null;
    paint({ title: 'Account deleted', cls: 'pg-lost', body: lostPanel('Your account is gone', 'Thanks for being part of the forum.') });
  },
  async 'mod-post'(f) {
    const d = await api.rpc('forum_mod_post', { p_post: Number(f.dataset.id), p_action: f.dataset.act });
    go('/t/' + d.thread_id + '?p=' + d.post_id);
  },
  async 'mod-thread'(f) {
    await api.rpc('forum_mod_thread', { p_thread: Number(f.dataset.id), p_action: f.dataset.act });
    render({ keepScroll: true });
  },
  async 'mod-user'(f) {
    const args = { p_user: f.dataset.id, p_action: f.dataset.act };
    if (f.dataset.act === 'pause') {
      args.p_days = Number(f.elements.days.value);
      args.p_reason = f.elements.reason.value;
    }
    const d = await api.rpc('forum_mod_user', args);
    go('/u/' + enc(d.name));
  },
  async 'mod-report'(f) {
    await api.rpc('forum_mod_report', { p_report: Number(f.dataset.id), p_action: f.dataset.act });
    render({ keepScroll: true });
  },
};

// Show the same page again with a message and what the player typed.
function retry(opts) {
  return render({ ...opts, keepScroll: true, focusError: true });
}

document.addEventListener('submit', async (ev) => {
  const f = ev.target.closest('form[data-action]');
  if (!f) return;
  ev.preventDefault();
  const run = ACTIONS[f.dataset.action];
  if (!run || f.dataset.busy) return;
  f.dataset.busy = '1';
  f.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  try {
    await run(f);
  } catch (e) {
    const keep = e.keep || {};
    if (e.code === '42501' || e.code === 'P0002' || !e.message || e.code === 'offline') {
      const page = problemPage(e);
      if (page.redirect) go(page.redirect);
      else paint(page);
    } else {
      await retry({ ...keep, error: e.message });
    }
  } finally {
    delete f.dataset.busy;
    f.querySelectorAll('button').forEach((b) => { b.disabled = false; });
  }
});

// The skip link targets the main area without changing the hash (which is the page's address).
document.addEventListener('click', (ev) => {
  const a = ev.target.closest('a[data-skip]');
  if (!a) return;
  ev.preventDefault();
  const main = document.getElementById('main');
  if (main) main.focus();
});

window.addEventListener('hashchange', () => render());

export async function boot() {
  const mock = new URLSearchParams(location.search).get('mock') === '1';
  await api.start(mock);
  await render();
}
