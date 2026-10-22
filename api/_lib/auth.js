/* Sessions, staff list and permissions for the back office. Node runtime, no dependencies. */
const crypto = require('crypto');

const COOKIE = 'opt_admin';
const SESSION_HOURS = 12;
const DOMAIN = () => (process.env.AUTH_DOMAIN || 'oneplustwo.co.uk').toLowerCase();

/* ---------- Signed tokens: base64url(json) + '.' + base64url(hmac) ---------- */
function b64url(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function fromB64url(s) { return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'); }

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET is missing or shorter than 32 characters');
  return s;
}
function sign(data) {
  const body = b64url(JSON.stringify(data));
  const sig = b64url(crypto.createHmac('sha256', secret()).update(body).digest());
  return body + '.' + sig;
}
function verify(token) {
  if (!token || token.indexOf('.') < 0) return null;
  const [body, sig] = token.split('.');
  let expected;
  try { expected = b64url(crypto.createHmac('sha256', secret()).update(body).digest()); } catch (e) { return null; }
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(fromB64url(body).toString('utf8'));
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch (e) { return null; }
}

/* ---------- Cookies ---------- */
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(/;\s*/).forEach((c) => { const i = c.indexOf('='); if (i > 0) out[c.slice(0, i)] = decodeURIComponent(c.slice(i + 1)); });
  return out;
}
function cookie(name, value, opts) {
  opts = opts || {};
  let c = name + '=' + encodeURIComponent(value) + '; Path=' + (opts.path || '/') + '; HttpOnly; Secure; SameSite=Lax';
  if (opts.maxAge != null) c += '; Max-Age=' + opts.maxAge;
  return c;
}

/* ---------- Staff and roles ----------
   ADMIN_USERS in Vercel: "faris.a@oneplustwo.co.uk=owner, sales@oneplustwo.co.uk=editor"
   Roles: owner (everything), editor (pages and images), shop (voucher codes), support (system status). */
const ROLE_NAMES = { owner: 'Owner', editor: 'Editor', shop: 'Shop manager', support: 'Support' };
function staffList() {
  return (process.env.ADMIN_USERS || '').split(',').map((item) => {
    const [e, r] = item.split('=').map((s) => (s || '').trim().toLowerCase());
    return e ? { email: e, role: ROLE_NAMES[r] ? r : 'editor' } : null;
  }).filter(Boolean);
}
function roleFor(email) {
  const u = staffList().find((x) => x.email === String(email || '').toLowerCase());
  return u ? u.role : null;
}

const PERMS = {
  owner: { pages: true, images: true, vouchers: true, status: true },
  editor: { pages: true, images: true, vouchers: false, status: true },
  shop: { pages: false, images: false, vouchers: true, status: false },
  support: { pages: false, images: false, vouchers: false, status: true }
};
function perms(role) { return PERMS[role] || {}; }

/* Which area a file belongs to, or null if the back office may never write it. */
function areaForPath(p) {
  if (/^[a-z0-9-]+\.html$/.test(p)) return 'pages';
  if (p === 'assets/data/status.json') return 'status';
  if (/^assets\/img\/[a-z0-9/_.-]+\.(png|jpe?g|webp|gif)$/i.test(p) && p.indexOf('..') < 0) return 'images';
  return null;
}

/* Returns the signed-in staff member, or sends 401/403 and returns null. */
function requireStaff(req, res) {
  const s = verify(parseCookies(req)[COOKIE]);
  const role = s && roleFor(s.e);
  if (!s || !role) { res.status(401).json({ error: 'signed_out' }); return null; }
  if (req.method !== 'GET' && req.headers['x-opt-admin'] !== '1') { res.status(403).json({ error: 'Request blocked. Reload the back office and try again.' }); return null; }
  return { email: s.e, name: s.n || s.e, role, perms: perms(role) };
}

module.exports = { COOKIE, SESSION_HOURS, DOMAIN, sign, verify, parseCookies, cookie, staffList, roleFor, perms, areaForPath, requireStaff, ROLE_NAMES };
