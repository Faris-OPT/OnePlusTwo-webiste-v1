/* Sign in with a work Microsoft or Google account (OpenID Connect, authorisation code flow with PKCE).
   /api/auth/login     -> sends the person to Microsoft or Google
   /api/auth/callback  -> checks who they are, then sets the staff session cookie
   /api/auth/logout    -> clears the session
   Settings (Vercel environment variables) are listed in ADMIN-GUIDE.md. */
const crypto = require('crypto');
const A = require('../_lib/auth');

const FLOW_COOKIE = 'opt_oauth';

function provider() {
  const p = (process.env.AUTH_PROVIDER || '').toLowerCase();
  if (p === 'google') {
    return {
      id: 'google',
      authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
      token: 'https://oauth2.googleapis.com/token',
      issuers: ['https://accounts.google.com', 'accounts.google.com']
    };
  }
  if (p === 'microsoft') {
    const t = process.env.AUTH_TENANT_ID;
    if (!t) return null;
    return {
      id: 'microsoft',
      authorize: 'https://login.microsoftonline.com/' + t + '/oauth2/v2.0/authorize',
      token: 'https://login.microsoftonline.com/' + t + '/oauth2/v2.0/token',
      issuers: ['https://login.microsoftonline.com/' + t + '/v2.0']
    };
  }
  return null;
}

function siteUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  return 'https://' + req.headers.host;
}
function redirectUri(req) { return siteUrl(req) + '/api/auth/callback'; }
function rand(n) { return crypto.randomBytes(n).toString('base64url'); }
function safeNext(n) { return typeof n === 'string' && /^\/admin(\/[\w\-./]*)?(#[\w-]*)?$/.test(n) ? n : '/admin'; }
function fail(res, code) { res.statusCode = 302; res.setHeader('Location', '/admin/login?error=' + encodeURIComponent(code)); res.setHeader('Cache-Control', 'no-store'); res.end(); }

function decodeJwtPayload(jwt) {
  const parts = String(jwt || '').split('.');
  if (parts.length !== 3) throw new Error('bad token');
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
}

async function login(req, res) {
  const p = provider();
  if (!p || !process.env.AUTH_CLIENT_ID || !process.env.AUTH_CLIENT_SECRET) return fail(res, 'not_configured');
  const state = rand(24), nonce = rand(24), verifier = rand(48);
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const flow = A.sign({ state, nonce, verifier, next: safeNext(req.query.next), exp: Math.floor(Date.now() / 1000) + 600 });
  const q = new URLSearchParams({
    client_id: process.env.AUTH_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri(req),
    scope: 'openid email profile',
    state, nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account'
  });
  if (p.id === 'google') q.set('hd', A.DOMAIN());
  if (p.id === 'microsoft') q.set('response_mode', 'query');
  res.setHeader('Set-Cookie', A.cookie(FLOW_COOKIE, flow, { path: '/api/auth', maxAge: 600 }));
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = 302;
  res.setHeader('Location', p.authorize + '?' + q.toString());
  res.end();
}

async function callback(req, res) {
  const p = provider();
  if (!p) return fail(res, 'not_configured');
  const flow = A.verify(A.parseCookies(req)[FLOW_COOKIE]);
  const clearFlow = A.cookie(FLOW_COOKIE, '', { path: '/api/auth', maxAge: 0 });
  if (req.query.error) { res.setHeader('Set-Cookie', clearFlow); return fail(res, 'cancelled'); }
  if (!flow || !req.query.state || req.query.state !== flow.state || !req.query.code) { res.setHeader('Set-Cookie', clearFlow); return fail(res, 'expired'); }

  /* Swap the one-time code for an ID token. This is a direct HTTPS call to Microsoft or Google,
     so the token comes straight from them (OpenID Connect Core 3.1.3.7). */
  let tokens;
  try {
    const r = await fetch(p.token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(req.query.code),
        redirect_uri: redirectUri(req),
        client_id: process.env.AUTH_CLIENT_ID,
        client_secret: process.env.AUTH_CLIENT_SECRET,
        code_verifier: flow.verifier
      }).toString()
    });
    tokens = await r.json();
    if (!r.ok || !tokens.id_token) throw new Error('token exchange failed: ' + (tokens.error || r.status));
  } catch (e) {
    console.error(e);
    res.setHeader('Set-Cookie', clearFlow);
    return fail(res, 'provider');
  }

  let c;
  try { c = decodeJwtPayload(tokens.id_token); } catch (e) { res.setHeader('Set-Cookie', clearFlow); return fail(res, 'provider'); }
  const now = Math.floor(Date.now() / 1000);
  const audOk = Array.isArray(c.aud) ? c.aud.includes(process.env.AUTH_CLIENT_ID) : c.aud === process.env.AUTH_CLIENT_ID;
  if (!audOk || !p.issuers.includes(c.iss) || !c.exp || c.exp < now || c.nonce !== flow.nonce) { res.setHeader('Set-Cookie', clearFlow); return fail(res, 'provider'); }

  let email;
  if (p.id === 'google') {
    if (c.email_verified !== true || String(c.hd || '').toLowerCase() !== A.DOMAIN()) { res.setHeader('Set-Cookie', clearFlow); return fail(res, 'domain'); }
    email = c.email;
  } else {
    if (c.tid !== process.env.AUTH_TENANT_ID) { res.setHeader('Set-Cookie', clearFlow); return fail(res, 'domain'); }
    email = c.email || c.preferred_username;
  }
  email = String(email || '').toLowerCase();
  if (!email.endsWith('@' + A.DOMAIN())) { res.setHeader('Set-Cookie', clearFlow); return fail(res, 'domain'); }
  if (!A.roleFor(email)) { res.setHeader('Set-Cookie', clearFlow); return fail(res, 'not_staff'); }

  const session = A.sign({ e: email, n: c.name || email, exp: now + A.SESSION_HOURS * 3600 });
  res.setHeader('Set-Cookie', [clearFlow, A.cookie(A.COOKIE, session, { maxAge: A.SESSION_HOURS * 3600 })]);
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = 302;
  res.setHeader('Location', flow.next || '/admin');
  res.end();
}

function logout(req, res) {
  res.setHeader('Set-Cookie', A.cookie(A.COOKIE, '', { maxAge: 0 }));
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = 302;
  res.setHeader('Location', '/admin/login?signed_out=1');
  res.end();
}

function info(req, res) {
  const p = provider();
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ provider: p ? p.id : null, configured: !!(p && process.env.AUTH_CLIENT_ID && process.env.AUTH_CLIENT_SECRET && process.env.SESSION_SECRET) });
}

module.exports = async function handler(req, res) {
  try {
    switch (req.query.action) {
      case 'login': return await login(req, res);
      case 'callback': return await callback(req, res);
      case 'logout': return logout(req, res);
      case 'info': return info(req, res);
      default: res.status(404).json({ error: 'Not found' });
    }
  } catch (e) {
    console.error(e);
    return fail(res, 'server');
  }
};
