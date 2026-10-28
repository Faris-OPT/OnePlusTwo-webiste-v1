/* Back office gatekeeper (Vercel Routing Middleware).
   Runs before every request to /admin, /api/admin and the start of sign-in (/api/auth/login). Two locks:
   1. HTTP authentication (the browser's own username and password box), when ADMIN_BASIC_USER and
      ADMIN_BASIC_PASS are set in Vercel. Anyone without them never sees the back office or its sign-in page.
   2. A staff session. Anyone without one is sent to the sign-in page (or gets a 401 for API calls). The session
      cookie is set by /api/auth/callback after the person signs in with their work Microsoft or Google account.
   See ADMIN-GUIDE.md. */

export const config = { matcher: ['/admin', '/admin/:path*', '/api/admin/:path*', '/api/auth/login'] };

const OPEN_PATHS = ['/admin/login', '/admin/login.html', '/admin/admin.css'];
const COOKIE = 'opt_admin';

export default async function middleware(request) {
  const url = new URL(request.url);
  if (!(await basicAuthOk(request.headers.get('authorization')))) return askForPassword();
  if (url.pathname === '/api/auth/login' || OPEN_PATHS.includes(url.pathname)) return next();

  const user = await readSession(request.headers.get('cookie') || '', process.env.SESSION_SECRET);
  if (user && staffRole(user.e)) return next();

  if (url.pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'signed_out' }), { status: 401, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  }
  const login = new URL('/admin/login', url);
  login.searchParams.set('next', url.pathname + url.hash);
  return Response.redirect(login.toString(), 302);
}

/* ---------- HTTP authentication (optional outer lock) ---------- */
const REALM = 'OnePlusTwo back office';

async function basicAuthOk(header) {
  const user = process.env.ADMIN_BASIC_USER, pass = process.env.ADMIN_BASIC_PASS;
  if (!user || !pass) return true; // not switched on
  if (!header || !/^Basic\s+/i.test(header)) return false;
  let decoded;
  try { decoded = new TextDecoder().decode(b64ToBytes(header.replace(/^Basic\s+/i, '').trim())); } catch (e) { return false; }
  const i = decoded.indexOf(':');
  if (i < 0) return false;
  /* Compare both parts in full every time, so the response time gives nothing away. */
  const okUser = await sameText(decoded.slice(0, i), user);
  const okPass = await sameText(decoded.slice(i + 1), pass);
  return okUser && okPass;
}

async function sameText(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const p = new Uint8Array(x), q = new Uint8Array(y);
  let diff = 0;
  for (let k = 0; k < p.length; k++) diff |= p[k] ^ q[k];
  return diff === 0;
}

function b64ToBytes(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function askForPassword() {
  return new Response('<!doctype html><meta charset="utf-8"><title>Staff only</title><p style="font-family:sans-serif">This area is for OnePlusTwo staff only.</p>', {
    status: 401,
    headers: {
      'www-authenticate': 'Basic realm="' + REALM + '", charset="UTF-8"',
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex'
    }
  });
}

/* Let the request carry on to the page or function. */
function next() {
  return new Response(null, { headers: { 'x-middleware-next': '1' } });
}

/* Same staff list format as api/_lib/auth.js: "name@oneplustwo.co.uk=owner, other@oneplustwo.co.uk=editor" */
function staffRole(email) {
  const list = (process.env.ADMIN_USERS || '').split(',');
  for (const item of list) {
    const [e, r] = item.split('=').map((s) => (s || '').trim().toLowerCase());
    if (e && e === String(email || '').toLowerCase()) return r || 'editor';
  }
  return null;
}

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function readSession(cookieHeader, secret) {
  if (!secret) return null;
  const match = cookieHeader.split(/;\s*/).find((c) => c.startsWith(COOKIE + '='));
  if (!match) return null;
  const token = match.slice(COOKIE.length + 1);
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  try {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('HMAC', key, b64urlToBytes(sig), new TextEncoder().encode(body));
    if (!ok) return null;
    const data = JSON.parse(new TextDecoder().decode(b64urlToBytes(body)));
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch (e) {
    return null;
  }
}
