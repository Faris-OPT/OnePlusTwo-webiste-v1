/* Back office API. Every route needs a staff session (checked by middleware.js and again here).
   GET  /api/admin/me        who is signed in, their role, the staff list and setup checks
   GET  /api/admin/files     pages and images in the site
   GET  /api/admin/file      ?path=index.html  current saved version of one file
   POST /api/admin/publish   { message, files: [{ path, content, baseSha } | { path, remove: true, baseSha }] }
   POST /api/admin/upload    { name, base64 }  adds an image under assets/img/uploads/
   GET  /api/admin/history   recent published versions
   GET  /api/admin/vouchers  voucher codes, readable by staff
   POST /api/admin/vouchers  { vouchers: [...], baseSha }  saves and publishes the codes */
const A = require('../_lib/auth');
const G = require('../_lib/github');
const V = require('../_lib/vouchers');

const MAX_HTML = 400 * 1024;
const MAX_IMAGE = 3 * 1024 * 1024;

function err(res, e) {
  const status = e.status || 500;
  if (status >= 500) console.error(e);
  const body = { error: status === 409 ? 'Someone else has published a change to the same file since you opened it.' : (status >= 500 && !/GITHUB_TOKEN|SECRET/.test(e.message) ? 'Something went wrong while saving. Try again in a minute.' : e.message) };
  if (e.conflicts) body.conflicts = e.conflicts;
  res.status(status).json(body);
}

function checkConfig() {
  return {
    github: !!process.env.GITHUB_TOKEN,
    vouchers: !!(process.env.VOUCHER_SECRET && process.env.VOUCHER_SECRET.length >= 32),
    branch: process.env.GITHUB_BRANCH || 'main',
    repo: process.env.GITHUB_REPO || 'Faris-OPT/OnePlusTwo-webiste-v1'
  };
}

async function me(req, res, u) {
  res.json({ user: u, roleName: A.ROLE_NAMES[u.role], staff: A.staffList().map((s) => ({ email: s.email, role: s.role, roleName: A.ROLE_NAMES[s.role] })), config: checkConfig(), provider: (process.env.AUTH_PROVIDER || '').toLowerCase() });
}

async function files(req, res) {
  const all = await G.listFiles();
  res.json({
    pages: all.filter((f) => /^[a-z0-9-]+\.html$/.test(f.path)).map((f) => ({ path: f.path, sha: f.sha })),
    images: all.filter((f) => /^assets\/img\/.+\.(png|jpe?g|webp|gif|svg)$/i.test(f.path)).map((f) => ({ path: f.path, sha: f.sha, size: f.size }))
  });
}

async function file(req, res) {
  const p = String(req.query.path || '');
  if (!/^[\w\-./]+$/.test(p) || p.indexOf('..') > -1 || p.startsWith('/')) return res.status(400).json({ error: 'That file name is not allowed.' });
  res.json(await G.getFile(p));
}

async function publish(req, res, u) {
  const b = req.body || {};
  const list = Array.isArray(b.files) ? b.files : [];
  if (!list.length) return res.status(400).json({ error: 'There is nothing to publish.' });
  if (list.length > 60) return res.status(400).json({ error: 'Too many files in one go. Publish in smaller batches.' });
  const out = [];
  for (const f of list) {
    const p = String(f.path || '');
    const area = A.areaForPath(p);
    if (!area) return res.status(400).json({ error: p + ' cannot be changed from the back office.' });
    if (!u.perms[area]) return res.status(403).json({ error: 'Your role cannot change ' + p + '.' });
    if (f.remove) { if (area !== 'images') return res.status(400).json({ error: 'Only images can be deleted.' }); out.push({ path: p, remove: true, baseSha: f.baseSha || null }); continue; }
    const content = String(f.content == null ? '' : f.content);
    if (area === 'pages') {
      if (content.length > MAX_HTML || !/<html[\s>]/i.test(content) || !/<\/html>\s*$/i.test(content) || !/<main[\s>]/i.test(content)) return res.status(400).json({ error: p + ' does not look like a complete page, so it was not saved.' });
    }
    if (area === 'status') { try { const s = JSON.parse(content); if (!Array.isArray(s.components)) throw 0; } catch (e) { return res.status(400).json({ error: 'The status data is not valid, so it was not saved.' }); } }
    if (area === 'images') return res.status(400).json({ error: 'Use upload to add images.' });
    out.push({ path: p, content, baseSha: f.baseSha || null });
  }
  const message = String(b.message || '').trim().slice(0, 120) || 'Website update';
  const r = await G.commitFiles(out, message, u);
  res.json({ ok: true, sha: r.sha });
}

async function upload(req, res, u) {
  if (!u.perms.images) return res.status(403).json({ error: 'Your role cannot add images.' });
  const b = req.body || {};
  const m = String(b.name || '').toLowerCase().match(/^(.*?)\.(png|jpe?g|webp|gif)$/);
  if (!m) return res.status(400).json({ error: 'Upload a JPG, PNG, WebP or GIF image.' });
  const base = m[1].replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'image';
  const data = String(b.base64 || '').replace(/^data:[^,]*,/, '');
  const size = Math.floor(data.length * 3 / 4);
  if (!size) return res.status(400).json({ error: 'The file is empty.' });
  if (size > MAX_IMAGE) return res.status(400).json({ error: 'That image is over 3 MB. Make it smaller and try again.' });
  const existing = new Set((await G.listFiles()).map((f) => f.path));
  let path = 'assets/img/uploads/' + base + '.' + m[2], n = 2;
  while (existing.has(path)) path = 'assets/img/uploads/' + base + '-' + (n++) + '.' + m[2];
  await G.commitFiles([{ path, base64: data, mustNotExist: true }], 'Add image ' + path.split('/').pop(), u);
  res.json({ ok: true, path });
}

async function removeImage(req, res, u) {
  if (!u.perms.images) return res.status(403).json({ error: 'Your role cannot delete images.' });
  const p = String((req.body || {}).path || '');
  if (A.areaForPath(p) !== 'images' && !/^assets\/img\/.+\.svg$/i.test(p)) return res.status(400).json({ error: 'That file cannot be deleted.' });
  await G.commitFiles([{ path: p, remove: true }], 'Delete image ' + p.split('/').pop(), u);
  res.json({ ok: true });
}

async function history(req, res) { res.json({ items: await G.history(30) }); }

async function vouchers(req, res, u) {
  if (!u.perms.vouchers) return res.status(403).json({ error: 'Your role cannot manage voucher codes.' });
  let current = { sha: null, data: { vouchers: {} } };
  try { const f = await G.getFile(V.PATH); current = { sha: f.sha, data: JSON.parse(f.content) }; } catch (e) { if (e.status !== 404) throw e; }
  if (req.method === 'GET') return res.json({ sha: current.sha, vouchers: V.toList(current.data) });
  const b = req.body || {};
  const next = V.fromList(b.vouchers, current.data, u);
  const content = JSON.stringify(next, null, 2) + '\n';
  const r = await G.commitFiles([{ path: V.PATH, content, baseSha: b.baseSha || current.sha || null, mustNotExist: !current.sha }], String(b.message || 'Update voucher codes').slice(0, 120), u);
  const saved = await G.getFile(V.PATH).catch(() => null);
  res.json({ ok: true, sha: saved ? saved.sha : null, commit: r.sha, vouchers: V.toList(next) });
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const u = A.requireStaff(req, res);
  if (!u) return;
  try {
    const a = req.query.action;
    if (a === 'me' && req.method === 'GET') return await me(req, res, u);
    if (a === 'files' && req.method === 'GET') return await files(req, res, u);
    if (a === 'file' && req.method === 'GET') return await file(req, res, u);
    if (a === 'publish' && req.method === 'POST') return await publish(req, res, u);
    if (a === 'upload' && req.method === 'POST') return await upload(req, res, u);
    if (a === 'remove-image' && req.method === 'POST') return await removeImage(req, res, u);
    if (a === 'history' && req.method === 'GET') return await history(req, res, u);
    if (a === 'vouchers' && (req.method === 'GET' || req.method === 'POST')) return await vouchers(req, res, u);
    res.status(404).json({ error: 'Not found' });
  } catch (e) { err(res, e); }
};
