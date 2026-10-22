/* Voucher codes live in assets/data/vouchers.json, which anyone can download. So the file only holds:
   - a SHA-256 hash of 'opt-voucher:' + CODE, which the shop compares against what the customer types, and
   - the code and staff note encrypted with VOUCHER_SECRET, so the back office can show them to staff again.
   Nobody can read the codes from the public file without the secret. */
const crypto = require('crypto');

const PATH = 'assets/data/vouchers.json';

function key() {
  const s = process.env.VOUCHER_SECRET;
  if (!s || s.length < 32) { const e = new Error('VOUCHER_SECRET is missing or shorter than 32 characters.'); e.status = 500; throw e; }
  return crypto.createHash('sha256').update(s).digest();
}
function hashCode(code) { return crypto.createHash('sha256').update('opt-voucher:' + code).digest('hex'); }
function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
function decrypt(b64) {
  try {
    const buf = Buffer.from(b64, 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'));
  } catch (e) { return null; }
}
function money(p) { return '£' + (p % 100 ? (p / 100).toFixed(2) : String(p / 100)); }
function label(v) { return v.type === 'percent' ? v.value + '% off' : money(v.value) + ' off'; }

/* Public file -> list for staff */
function toList(file) {
  const out = [];
  const all = (file && file.vouchers) || {};
  Object.keys(all).forEach((hash) => {
    const v = all[hash];
    const secret = v.c ? decrypt(v.c) : null;
    out.push({ hash, code: secret ? secret.code : null, note: secret ? secret.note || '' : '', createdBy: secret ? secret.by || '' : '', created: secret ? secret.created || '' : '', type: v.type, value: v.value, label: v.label, active: v.active !== false, start: v.start || '', end: v.end || '', min: v.min || 0 });
  });
  return out;
}

function clean(v, who) {
  const type = v.type === 'fixed' ? 'fixed' : 'percent';
  const value = Math.round(Number(v.value));
  if (!(value > 0) || (type === 'percent' && value > 100) || (type === 'fixed' && value > 1000000)) throw bad('Check the discount amount for ' + (v.code || 'a code') + '.');
  const date = (d) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '');
  const start = date(v.start), end = date(v.end);
  if (start && end && end < start) throw bad('The end date for ' + (v.code || 'a code') + ' is before its start date.');
  const min = Math.max(0, Math.round(Number(v.min) || 0));
  const out = { type, value, label: '', active: v.active !== false, start, end, min };
  out.label = label(out);
  return out;
}
function bad(msg) { const e = new Error(msg); e.status = 400; return e; }

/* Staff list -> public file. Existing codes are matched by hash; new codes must include the plain code. */
function fromList(list, previous, who) {
  const prev = (previous && previous.vouchers) || {};
  const vouchers = {};
  (list || []).forEach((v) => {
    let hash = v.hash, code = v.code ? String(v.code).trim().toUpperCase() : null;
    if (!hash) {
      if (!code || !/^[A-Z0-9]{3,20}$/.test(code)) throw bad('Codes need 3 to 20 letters or numbers, with no spaces.');
      hash = hashCode(code);
    }
    if (vouchers[hash]) throw bad((code || 'A code') + ' is listed twice.');
    const old = prev[hash];
    const oldSecret = old && old.c ? decrypt(old.c) : null;
    const entry = clean(v);
    entry.c = encrypt({
      code: code || (oldSecret && oldSecret.code) || '',
      note: String(v.note || '').slice(0, 200),
      by: (oldSecret && oldSecret.by) || who.name,
      created: (oldSecret && oldSecret.created) || new Date().toISOString().slice(0, 10)
    });
    vouchers[hash] = entry;
  });
  return { updated: new Date().toISOString(), vouchers };
}

module.exports = { PATH, hashCode, toList, fromList, encrypt, decrypt, label };
