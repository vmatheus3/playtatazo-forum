/* Talking to Supabase with plain fetch: Auth (sign up, log in, refresh, log out) and PostgREST
   (POST /rest/v1/rpc/forum_*). No library, no CDN, no cookies: the login is kept in this browser's
   localStorage and sent as a bearer token. The database checks every rule; this file only carries
   requests and turns errors into the forum's sentences. With ?mock=1 it talks to src/mock.js instead
   (fixture data in memory, for trying the pages without a Supabase project). */
import { CONFIG } from './config.js';

const KEY = 'tatazo_forum_login';
let backend = null; // the mock, when on
let session = null;

export class ForumError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const OFFLINE = 'The forum could not be reached. Please try again in a moment.';

export async function start(mock) {
  if (mock) {
    try {
      backend = await import('./mock.js');
      return;
    } catch (e) {
      backend = null; // the built forum has no mock (scripts/build-forum.sh leaves it out)
    }
  }
  try {
    session = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch (e) {
    session = null;
  }
}

export function configured() {
  return Boolean(backend) || Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);
}

export function hasLogin() {
  return backend ? backend.hasLogin() : Boolean(session);
}

function remember(s) {
  session = s;
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch (e) {
    // Private windows may refuse storage: the login then lasts until the page is closed.
  }
}

function base() {
  return CONFIG.SUPABASE_URL.replace(/\/+$/, '');
}

export function loginEmail(name) {
  return String(name).trim().toLowerCase() + '@' + CONFIG.PLAYER_EMAIL_DOMAIN;
}

async function send(path, body, token) {
  let res;
  try {
    res = await fetch(base() + path, {
      method: 'POST',
      headers: { apikey: CONFIG.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + (token || CONFIG.SUPABASE_ANON_KEY), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  } catch (e) {
    throw new ForumError(OFFLINE, 0, 'offline');
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    data = null;
  }
  if (!res.ok) {
    const msg = data && (data.message || data.msg || data.error_description || data.error);
    throw new ForumError(typeof msg === 'string' ? msg : OFFLINE, res.status, data && (data.error_code || data.code || data.error));
  }
  return data;
}

function fromAuth(d) {
  if (!d || !d.access_token) return null;
  return { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600) };
}

async function refresh() {
  if (!session) return;
  try {
    remember(fromAuth(await send('/auth/v1/token?grant_type=refresh_token', { refresh_token: session.refresh_token })));
  } catch (e) {
    if (e.code !== 'offline') remember(null); // logged out elsewhere (a password change, a deleted account)
    else throw e;
  }
}

async function token() {
  if (session && session.expires_at * 1000 - 60000 < Date.now()) await refresh();
  return session ? session.access_token : null;
}

// Call a forum function. Returns its JSON; throws ForumError with the database's sentence on a problem.
export async function rpc(name, args = {}) {
  if (backend) return backend.rpc(name, args);
  try {
    return await send('/rest/v1/rpc/' + name, args, await token());
  } catch (e) {
    if (e.status === 401 && session) {
      await refresh();
      return send('/rest/v1/rpc/' + name, args, await token());
    }
    throw e;
  }
}

export async function login(name, password) {
  if (backend) return backend.login(name, password);
  try {
    remember(fromAuth(await send('/auth/v1/token?grant_type=password', { email: loginEmail(name), password })));
  } catch (e) {
    if (e.status === 429 || /too many/i.test(e.message)) throw new ForumError('Too many tries. Wait fifteen minutes and try again.', e.status, e.code);
    if (e.status === 400) throw new ForumError("That name and password don't match.", 400, e.code);
    throw new ForumError(OFFLINE, e.status, e.code);
  }
}

// Accounts are made by the database (rpc forum_signup, which checks the password as well), never by
// Supabase Auth's own sign-up, which is switched off: see web/forum/README.md.

export async function logout() {
  if (backend) return backend.logout();
  const t = session && session.access_token;
  remember(null);
  if (t) {
    try {
      await send('/auth/v1/logout?scope=local', undefined, t);
    } catch (e) {
      // Already gone on the server: nothing to do.
    }
  }
}

// After deleting the account or when the server says the login is gone.
export function forget() {
  if (backend) return backend.logout();
  remember(null);
}
