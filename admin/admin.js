/* OnePlusTwo back office.
   Talks to /api/admin/* (see api/admin/[action].js). Website edits are kept as drafts in this browser until someone
   presses Publish, which saves them to GitHub in one go; Vercel then republishes the site. Voucher codes and the
   system status page save straight away. */
(function () {
  'use strict';

  /* ================= Helpers ================= */
  function $(s, el) { return (el || document).querySelector(s); }
  function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function icon(id, s) { s = s || 16; return '<svg width="' + s + '" height="' + s + '" aria-hidden="true"><use href="#i-' + id + '"/></svg>'; }
  function money(p) { return '£' + (p / 100).toLocaleString('en-GB', { minimumFractionDigits: p % 100 ? 2 : 0, maximumFractionDigits: 2 }); }
  function money2(p) { return '£' + (p / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(iso) { if (!iso) return ''; var d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso); return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
  function fmtTime(d) { return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function fmtDT(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.getDate() + ' ' + MONTHS[d.getMonth()] + ', ' + fmtTime(d); }
  function ago(ts) { var m = Math.round((Date.now() - new Date(ts).getTime()) / 60000); if (m < 1) return 'Just now'; if (m < 60) return m + ' min ago'; var h = Math.round(m / 60); if (h < 24) return h + ' hr ago'; var d = Math.round(h / 24); return d === 1 ? 'Yesterday' : d + ' days ago'; }
  function uid() { return Math.random().toString(36).slice(2, 9); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function ukToday() { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date()); } catch (e) { return new Date().toISOString().slice(0, 10); } }
  function nowIso() { var d = new Date(), off = -d.getTimezoneOffset(), p = function (n) { return String(Math.abs(n)).padStart(2, '0'); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':00' + (off >= 0 ? '+' : '-') + p(Math.floor(Math.abs(off) / 60)) + ':' + p(Math.abs(off) % 60); }
  var toastT;
  function toast(msg, bad) { $('#toast-msg').textContent = msg; var t = $('#toast'); t.style.background = bad ? 'var(--bad)' : ''; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, bad ? 6000 : 3400); }
  function copy(text) { try { navigator.clipboard.writeText(text).then(function () { toast('Copied ' + text); }, function () { toast(text); }); } catch (e) { toast(text); } }
  function busy(btn, on) { if (btn) { btn.classList.toggle('is-busy', on); btn.disabled = on; } }

  function api(action, opts) {
    opts = opts || {};
    var url = '/api/admin/' + action + (opts.query ? '?' + new URLSearchParams(opts.query).toString() : '');
    return fetch(url, {
      method: opts.method || 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: opts.body ? { 'content-type': 'application/json', 'x-opt-admin': '1' } : { 'x-opt-admin': '1' },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      if (r.status === 401) { location.href = '/admin/login?next=' + encodeURIComponent('/admin' + location.hash); throw new Error('Signed out'); }
      return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) { var e = new Error(d.error || 'Something went wrong (' + r.status + ').'); e.status = r.status; e.conflicts = d.conflicts; throw e; } return d; });
    });
  }

  /* ================= State ================= */
  var S = {
    me: null, files: null, view: 'dashboard',
    drafts: {},           // path -> { content, baseSha, baseline, notes: { key: text }, when }
    pageCache: {},        // path -> { content, sha }
    ed: null,             // page editor state
    status: null, statusDraft: null, incForm: false, mntForm: false, updFor: null,
    vouchers: null, vSha: null, vFilter: 'all', vConfirm: null,
    history: null, find: { q: '', r: '', results: null }, mediaSel: null
  };
  var DRAFT_KEY = function () { return 'opt-admin-drafts:' + (S.me ? S.me.user.email : ''); };
  function saveDrafts() { try { localStorage.setItem(DRAFT_KEY(), JSON.stringify(S.drafts)); } catch (e) {} updateChrome(); }
  function loadDrafts() { try { S.drafts = JSON.parse(localStorage.getItem(DRAFT_KEY())) || {}; } catch (e) { S.drafts = {}; } }
  function draftList() { return Object.keys(S.drafts).map(function (p) { return { path: p, d: S.drafts[p] }; }); }
  function changeCount() { return draftList().reduce(function (n, x) { return n + Object.keys(x.d.notes).length; }, 0); }
  function can(area) { return S.me && S.me.user.perms[area]; }
  function rawUrl(path) { var c = S.me.config; return 'https://raw.githubusercontent.com/' + c.repo + '/' + c.branch + '/' + path; }

  function setDraft(path, content, baseSha, baseline, key, note) {
    var d = S.drafts[path] || { baseSha: baseSha, baseline: baseline, notes: {} };
    d.content = content; d.when = Date.now();
    if (key) d.notes[key] = note;
    if (content === d.baseline) delete S.drafts[path]; else S.drafts[path] = d;
    saveDrafts();
  }

  /* ================= Page names ================= */
  var NAMES = { 'index.html': 'Home', 'why-us.html': 'Why us?', '404.html': 'Page not found', 'shop.html': 'Shop', 'status.html': 'System status', 'book-a-demo.html': 'Book a demo' };
  function pageName(file) { return NAMES[file] || file.replace(/\.html$/, '').replace(/-/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); }); }
  function pageUrl(file) { return file === 'index.html' ? '/' : '/' + file.replace(/\.html$/, ''); }
  var GROUPS = [
    ['Main pages', ['index.html', 'pricing.html', 'why-us.html', 'customers.html', 'book-a-demo.html', 'software.html', 'integrations.html', 'blog.html']],
    ['Products', ['products.html', 'point-of-sale.html', 'self-service-kiosks.html', 'online-ordering.html', 'kitchen-display-screens.html', 'collection-display-screens.html', 'integrated-payments.html', 'hardware.html']],
    ['Who we serve', ['who-we-serve.html', 'restaurants.html', 'cafes.html', 'takeaways.html', 'events-and-festivals.html', 'retail.html']],
    ['Shop, legal and other', ['shop.html', 'terms-of-sale.html', 'privacy-policy.html', 'status.html', '404.html']]
  ];
  function groupedPages() {
    var known = {}, all = (S.files ? S.files.pages : []).map(function (p) { return p.path; });
    var groups = GROUPS.map(function (g) { return [g[0], g[1].filter(function (f) { known[f] = 1; return all.indexOf(f) > -1; })]; });
    var other = all.filter(function (f) { return !known[f]; });
    if (other.length) groups.push(['Other pages', other]);
    return groups;
  }

  /* ================= Chrome and routing ================= */
  var VIEWS = { dashboard: 'Dashboard', pages: 'Pages and layout', media: 'Images', details: 'Prices and details', vouchers: 'Voucher codes', status: 'System status', history: 'Publish history', staff: 'Staff accounts' };
  var VIEW_PERM = { pages: 'pages', media: 'images', details: 'pages', vouchers: 'vouchers', status: 'status' };
  function updateChrome() {
    var n = changeCount();
    $('#pending-chip').hidden = !n;
    $('#pending-n').textContent = n + (n === 1 ? ' change' : ' changes');
    $('#publish-btn').disabled = !n;
    if (S.status) $('#nav-sdot').style.background = 'var(--' + overall(S.status).key + ')';
  }
  function go(view) {
    if (!VIEWS[view] || (VIEW_PERM[view] && !can(VIEW_PERM[view]))) view = 'dashboard';
    S.view = view;
    if (location.hash.slice(1) !== view) history.replaceState(null, '', '#' + view);
    $$('#nav a').forEach(function (a) { if (a.dataset.view === view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    $('#crumb').textContent = VIEWS[view];
    $('#app').classList.remove('nav-open');
    window.scrollTo(0, 0);
    render();
  }
  function render() {
    var fn = { dashboard: vDashboard, pages: vPages, media: vMedia, details: vDetails, vouchers: vVouchers, status: vStatus, history: vHistory, staff: vStaff }[S.view];
    $('#view').innerHTML = fn();
    updateChrome();
    if (S.view === 'pages') afterPagesRender();
  }
  function loadingBlock(text) { return '<div class="loading"><span class="spinner"></span>' + esc(text || 'Loading…') + '</div>'; }
  function errorBlock(e, retry) { return '<div class="notice notice--warn">' + icon('alert') + '<span>' + esc(e.message || e) + (retry ? ' <a href="#" data-action="' + retry + '">Try again</a>' : '') + '</span></div>'; }

  /* ================= Status helpers ================= */
  var ST = { operational: 'Operational', degraded: 'Degraded performance', partial_outage: 'Partial outage', major_outage: 'Major outage', maintenance: 'Under maintenance' };
  var INC = { investigating: 'Investigating', identified: 'Identified', monitoring: 'Monitoring', resolved: 'Resolved' };
  function overall(st) {
    var c = (st.components || []).map(function (x) { return x.status; });
    if (c.indexOf('major_outage') > -1) return { key: 'bad', label: 'Major outage', bar: 'a-major' };
    if (c.indexOf('partial_outage') > -1) return { key: 'orange', label: 'Partial outage', bar: 'a-major' };
    if (c.indexOf('degraded') > -1) return { key: 'warn', label: 'Degraded performance', bar: 'a-minor' };
    if (c.indexOf('maintenance') > -1) return { key: 'info', label: 'Maintenance in progress', bar: 'a-maint' };
    var soon = (st.maintenance || []).find(function (m) { return m.status !== 'completed' && new Date(m.start) - Date.now() < 864e5 && new Date(m.end) > Date.now(); });
    return { key: 'ok', label: 'All systems operational', bar: soon ? 'a-maint' : '', soon: soon };
  }
  function loadStatus() {
    return api('file', { query: { path: 'assets/data/status.json' } }).then(function (f) {
      var data = JSON.parse(f.content);
      (data.incidents || []).forEach(function (i) { i._id = uid(); });
      (data.maintenance || []).forEach(function (m) { m._id = uid(); });
      data.incidents = data.incidents || []; data.maintenance = data.maintenance || [];
      S.status = data; S.statusSha = f.sha; S.statusDraft = clone(data);
      updateChrome();
    });
  }
  function statusForSave(d) {
    var out = clone(d);
    out.incidents.forEach(function (i) { delete i._id; });
    out.maintenance.forEach(function (m) { delete m._id; });
    return JSON.stringify(out, null, 2) + '\n';
  }

  /* ================= Vouchers helpers ================= */
  function vLabel(v) { return v.type === 'percent' ? v.value + '% off' : money(v.value) + ' off'; }
  function vState(v) {
    var today = ukToday();
    if (v.end && v.end < today) return { k: 'muted', t: 'Expired', f: 'ended' };
    if (!v.active) return { k: 'warn', t: 'Paused', f: 'paused' };
    if (v.start && v.start > today) return { k: 'info', t: 'Starts ' + fmtDate(v.start), f: 'scheduled' };
    return { k: 'ok', t: 'Active', f: 'active' };
  }
  function genCode() { var w = ['VENUE', 'TILLS', 'KIOSK', 'FEAST', 'SERVE', 'ORDER', 'TABLE']; return w[Math.floor(Math.random() * w.length)] + Math.floor(10 + Math.random() * 89); }
  function loadVouchers() { return api('vouchers').then(function (d) { S.vouchers = d.vouchers; S.vSha = d.sha; }); }
  function saveVouchers(list, message) {
    return api('vouchers', { method: 'POST', body: { vouchers: list.map(function (v) { return { hash: v.hash || null, code: v.hash ? null : v.code, type: v.type, value: v.value, active: v.active, start: v.start, end: v.end, min: v.min, note: v.note }; }), baseSha: S.vSha, message: message } })
      .then(function (d) { S.vouchers = d.vouchers; S.vSha = d.sha; return d; });
  }

  /* ================= DASHBOARD ================= */
  function vDashboard() {
    if (!S.history) api('history').then(function (d) { S.history = d.items; if (S.view === 'dashboard') render(); }).catch(function () { S.history = []; });
    if (!S.status && can('status')) loadStatus().then(function () { if (S.view === 'dashboard') render(); }).catch(function () {});
    if (!S.vouchers && can('vouchers') && S.me.config.vouchers) loadVouchers().then(function () { if (S.view === 'dashboard') render(); }).catch(function () {});
    var h = new Date().getHours(), first = (S.me.user.name || '').split(' ')[0];
    var greet = (h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening') + (first && first.indexOf('@') < 0 ? ', ' + first : '');
    var n = changeCount();
    var cfg = S.me.config, warns = [];
    if (!cfg.github) warns.push('GITHUB_TOKEN is not set, so nothing can be saved yet.');
    if (!cfg.vouchers && can('vouchers')) warns.push('VOUCHER_SECRET is not set, so voucher codes cannot be managed yet.');
    var cards = [];
    if (can('status')) { var o = S.status ? overall(S.status) : null; cards.push('<a class="ov" href="#status"><span class="k">System status</span><span class="v">' + (o ? '<span class="big-dot" style="background:var(--' + o.key + ')"></span>' + esc(o.label) : '…') + '</span><span class="s">' + (S.status ? 'Updated ' + fmtDT(S.status.updated) : 'Loading') + '</span></a>'); }
    cards.push('<a class="ov" href="#history" data-action="open-publish"><span class="k">Waiting to publish</span><span class="v tnum">' + n + (n === 1 ? ' change' : ' changes') + '</span><span class="s">' + (n ? 'Review and publish when ready' : 'Everything is live') + '</span></a>');
    if (can('vouchers')) { var act = S.vouchers ? S.vouchers.filter(function (v) { return vState(v).f === 'active'; }).length : null; cards.push('<a class="ov" href="#vouchers"><span class="k">Voucher codes</span><span class="v tnum">' + (act == null ? '…' : act + ' active') + '</span><span class="s">' + (S.vouchers ? S.vouchers.length + ' in total' : (cfg.vouchers ? 'Loading' : 'Not set up')) + '</span></a>'); }
    var last = S.history && S.history[0];
    cards.push('<a class="ov" href="#history"><span class="k">Last published</span><span class="v">' + (last ? esc(ago(last.when)) : '…') + '</span><span class="s">' + (last ? 'By ' + esc(last.who) : 'Loading') + '</span></a>');
    var qa = [];
    if (can('pages')) qa.push(qaBtn('pages', 'Edit the homepage', 'Text, photos and sections', 'quick-home'));
    if (can('vouchers')) qa.push(qaBtn('ticket', 'Create a voucher code', 'For the hardware shop', 'quick-voucher'));
    if (can('status')) { qa.push(qaBtn('alert', 'Report an incident', 'Shows on the status page', 'quick-incident')); qa.push(qaBtn('wrench', 'Schedule maintenance', 'Warns visitors 24 hours ahead', 'quick-maint')); }
    if (can('images')) qa.push(qaBtn('image', 'Upload images', 'Photos for any page', 'quick-media'));
    if (can('pages')) qa.push(qaBtn('sliders', 'Change a price', 'Find and replace across the site', 'quick-prices'));
    return '<div class="page-head"><div class="hello"><h1>' + esc(greet) + '</h1><p>Here is how the website and shop look right now.</p></div></div>' +
      (warns.length ? '<div class="notice notice--warn setup-warn">' + icon('alert') + '<span><strong>Setup not finished.</strong> ' + warns.map(esc).join(' ') + ' See ADMIN-GUIDE.md.</span></div>' : '') +
      '<div class="overview" style="grid-template-columns:repeat(' + Math.min(cards.length, 4) + ',minmax(0,1fr))">' + cards.join('') + '</div>' +
      '<div class="dash-grid">' +
        '<section class="card"><div class="card-head"><div><h2>Quick actions</h2><p>The jobs staff do most often.</p></div></div><div class="quick">' + qa.join('') + '</div></section>' +
        '<section class="card"><div class="card-head"><div><h2>Recent activity</h2><p>Recent published versions of the site.</p></div><a class="btn btn--ghost btn--sm" href="#history">See all</a></div>' +
          (S.history ? (S.history.length ? '<ul class="plain feed">' + S.history.slice(0, 6).map(function (x) { return '<li><span class="fi">' + esc(initials(x.who)) + '</span><p>' + esc(x.title) + '<br><span class="small muted">' + esc(x.who) + '</span></p><time>' + esc(ago(x.when)) + '</time></li>'; }).join('') + '</ul>' : '<p class="muted small">Nothing published yet.</p>') : loadingBlock()) +
        '</section>' +
      '</div>';
  }
  function initials(name) { return String(name || '?').split(/[\s.@]+/).filter(Boolean).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase(); }
  function qaBtn(ic, t, s, act) { return '<button type="button" data-action="' + act + '"><span class="qi">' + icon(ic, 18) + '</span><span><strong>' + t + '</strong><small>' + s + '</small></span></button>'; }

  /* ================= PAGES: editor ================= */
  var EDITOR_CSS = '[data-cms-e]{outline:1px dashed transparent;outline-offset:3px;border-radius:2px;cursor:text;transition:outline-color .15s}' +
    '[data-cms-e]:hover{outline-color:rgba(3,107,69,.55)}[data-cms-e]:focus{outline:2px solid #04D98B;background:rgba(4,217,139,.08)}' +
    'img[data-cms-i]{cursor:pointer}img[data-cms-i]:hover{outline:2px dashed #036B45;outline-offset:2px}.cms-sel{outline:3px solid #04D98B!important;outline-offset:2px}' +
    'main>section[hidden]{display:block!important;opacity:.38;position:relative}main>section[hidden]::before{content:"Hidden from the website";position:absolute;top:8px;left:8px;z-index:5;background:#161616;color:#fff;font:700 12px/1 system-ui,sans-serif;padding:6px 10px;border-radius:99px}' +
    '.site-header,.site-footer{pointer-events:none}.skip-link{display:none}.cms-flash{animation:cmsf 1.4s ease-out}@keyframes cmsf{0%{box-shadow:inset 0 0 0 4px #04D98B}100%{box-shadow:inset 0 0 0 4px transparent}}';
  var SKIP = { SCRIPT: 1, STYLE: 1, SVG: 1, NOSCRIPT: 1, TEMPLATE: 1, SELECT: 1, TEXTAREA: 1, INPUT: 1, BUTTON: 1, OPTION: 1, IFRAME: 1, FORM: 0 };

  function openPage(path) {
    S.ed = { path: path, loading: true, phone: S.ed ? S.ed.phone : false, tab: 'sections' };
    render();
    var d = S.drafts[path];
    var load = d ? Promise.resolve({ content: d.content, sha: d.baseSha, fromDraft: true }) : api('file', { query: { path: path } });
    load.then(function (f) {
      if (!S.ed || S.ed.path !== path) return;
      var text = f.content;
      var doc = new DOMParser().parseFromString(text, 'text/html');
      if (!doc.querySelector('main')) throw new Error('This page has no main content area, so it cannot be edited here.');
      S.ed = { path: path, text: text, sha: f.sha, doc: doc, phone: S.ed.phone, tab: 'sections', sel: null, cur: null, confirmDel: null };
      tagDoc(doc);
      S.ed.baseline = d ? d.baseline : serialize();
      S.ed.loading = false;
      render();
    }).catch(function (e) { if (S.ed && S.ed.path === path) { S.ed.loading = false; S.ed.error = e; render(); } });
  }

  function tagDoc(doc) {
    var main = doc.querySelector('main'), n = 0;
    $$(':scope > section', main).forEach(function (s) { if (!s.hasAttribute('data-cms-s')) s.setAttribute('data-cms-s', 's' + (n++) + uid()); });
    (function walk(el, inside) {
      Array.prototype.forEach.call(el.children, function (c) {
        if (SKIP[c.tagName.toUpperCase()]) return;
        var marked = inside;
        if (!inside && !c.hasAttribute('data-cms-e')) {
          var hasText = Array.prototype.some.call(c.childNodes, function (t) { return t.nodeType === 3 && t.nodeValue.trim(); });
          if (hasText) { c.setAttribute('data-cms-e', uid()); marked = true; }
        } else if (c.hasAttribute('data-cms-e')) marked = true;
        if (c.tagName === 'IMG' && !c.hasAttribute('data-cms-i')) c.setAttribute('data-cms-i', uid());
        if (c.tagName === 'A' && !c.hasAttribute('data-cms-a')) c.setAttribute('data-cms-a', uid());
        walk(c, marked);
      });
    })(main, false);
  }
  function stripCms(root) {
    $$('[data-cms-e],[data-cms-s],[data-cms-i],[data-cms-a]', root).concat([root]).forEach(function (el) {
      if (!el.removeAttribute) return;
      ['data-cms-e', 'data-cms-s', 'data-cms-i', 'data-cms-a', 'contenteditable', 'spellcheck'].forEach(function (a) { el.removeAttribute(a); });
      el.classList && el.classList.remove('cms-sel', 'cms-flash');
      if (el.getAttribute && el.getAttribute('class') === '') el.removeAttribute('class');
    });
  }
  function escAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
  /* Rebuild the page file: only <main> and a few head tags change, so the header, footer and scripts stay exactly as they were. */
  function serialize() {
    var ed = S.ed, text = ed.text;
    var main = ed.doc.querySelector('main').cloneNode(true);
    stripCms(main);
    var start = text.search(/<main[\s>]/i), end = text.lastIndexOf('</main>');
    var out = text.slice(0, start) + main.outerHTML + text.slice(end + 7);
    var title = ed.doc.title, desc = (ed.doc.querySelector('meta[name="description"]') || {}).content;
    out = out.replace(/<title>[\s\S]*?<\/title>/i, '<title>' + esc(title) + '</title>');
    if (desc != null) {
      out = out.replace(/(<meta name="description" content=")[^"]*(")/i, '$1' + escAttr(desc) + '$2');
      out = out.replace(/(<meta property="og:description" content=")[^"]*(")/i, '$1' + escAttr(desc) + '$2');
    }
    out = out.replace(/(<meta property="og:title" content=")[^"]*(")/i, '$1' + escAttr(title) + '$2');
    return out;
  }
  var dirtyT;
  function dirty(key, note, now) {
    clearTimeout(dirtyT);
    var ed = S.ed;
    var run = function () { if (S.ed !== ed) return; setDraft(ed.path, serialize(), ed.sha, ed.baseline, key, note); refreshPageList(); };
    if (now) run(); else dirtyT = setTimeout(run, 350);
  }
  function refreshPageList() { var l = $('#page-groups'); if (l) l.innerHTML = pageListHtml(); var u = $('[data-action="revert-page"]'); if (u) u.hidden = !S.drafts[S.ed.path]; }

  function sections() { return S.ed ? $$(':scope > section', S.ed.doc.querySelector('main')) : []; }
  function secName(s, i) {
    var h = s.querySelector('h1,h2,h3');
    var t = (h ? h.textContent : s.textContent).replace(/\s+/g, ' ').trim();
    if (s.querySelector('h1')) return 'Hero: ' + (t.slice(0, 60) || 'Top of page');
    return t.slice(0, 60) || 'Section ' + (i + 1);
  }

  function pageListHtml() {
    return groupedPages().map(function (g) {
      return '<h3>' + esc(g[0]) + '</h3>' + g[1].map(function (f) {
        return '<button type="button" data-action="pick-page" data-path="' + esc(f) + '" aria-current="' + (S.ed && S.ed.path === f) + '"><strong>' + esc(pageName(f)) + (S.drafts[f] ? ' <span class="edited-dot" title="Changed, not live yet"></span>' : '') + '</strong><small>' + esc(pageUrl(f)) + '</small></button>';
      }).join('');
    }).join('');
  }

  function vPages() {
    if (!S.files) { loadFiles().then(function () { if (S.view === 'pages') render(); }); return loadingBlock('Loading pages…'); }
    if (!S.ed) { openPage('index.html'); return loadingBlock('Opening the homepage…'); }
    var ed = S.ed;
    var picker = '<div class="page-picker-m field"><label for="pg-m">Page</label><select class="select" id="pg-m" data-action="pick-page-m">' + groupedPages().map(function (g) { return '<optgroup label="' + esc(g[0]) + '">' + g[1].map(function (f) { return '<option value="' + esc(f) + '"' + (f === ed.path ? ' selected' : '') + '>' + esc(pageName(f)) + (S.drafts[f] ? ' (changed)' : '') + '</option>'; }).join('') + '</optgroup>'; }).join('') + '</select></div>';
    var head = '<div class="page-head"><div><h1>Pages and layout</h1><p>Click any text on the page to change it, or click a photo to swap it. Move, hide or add sections on the left. Nothing goes live until you publish.</p></div></div>';
    var body;
    if (ed.loading) body = loadingBlock('Opening ' + pageName(ed.path) + '…');
    else if (ed.error) body = errorBlock(ed.error, 'reload-page');
    else body = editorHtml();
    return head + '<div class="pages-layout"><nav class="card page-list" aria-label="Pages">' + picker + '<div class="groups" id="page-groups">' + pageListHtml() + '</div></nav><div class="editor">' + body + '</div></div>';
  }

  function editorHtml() {
    var ed = S.ed;
    var tabs = '<div class="tabs" role="tablist">' + [['sections', 'Sections'], ['seo', 'Search and sharing']].map(function (t) { return '<button type="button" role="tab" aria-selected="' + (ed.tab === t[0]) + '" data-action="ed-tab" data-tab="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>';
    return '<div class="editor-head"><div class="stack-sm" style="gap:4px"><h2 style="font-size:1.4rem">' + esc(pageName(ed.path)) + '</h2><span class="path">www.oneplustwo.co.uk' + esc(pageUrl(ed.path)) + '</span></div>' +
      '<div class="row"><button class="btn btn--ghost btn--sm" type="button" data-action="revert-page"' + (S.drafts[ed.path] ? '' : ' hidden') + '>' + icon('restore') + 'Undo changes to this page</button>' +
      '<a class="btn btn--ghost btn--sm" href="' + esc(pageUrl(ed.path)) + '" target="_blank" rel="noopener">' + icon('ext') + 'Live page</a></div></div>' +
      '<div class="ed"><div class="ed-side">' + tabs + '<div id="ed-panel">' + sidePanelHtml() + '</div></div>' +
      '<div class="ed-canvas"><div class="ed-bar"><span class="ed-tip">Click text to edit it. Press Shift + Enter for a new line.</span><div class="seg" role="group" aria-label="Preview width"><button type="button" data-action="ed-w" data-phone="0" aria-pressed="' + !ed.phone + '">' + icon('desktop', 14) + ' Computer</button><button type="button" data-action="ed-w" data-phone="1" aria-pressed="' + !!ed.phone + '">' + icon('phone', 14) + ' Phone</button></div></div>' +
      '<div class="ed-frame' + (ed.phone ? ' phone' : '') + '"><iframe id="ed-frame" title="Editable preview of ' + esc(pageName(ed.path)) + '"></iframe></div></div></div>';
  }

  function sidePanelHtml() {
    var ed = S.ed;
    if (ed.tab === 'seo') {
      var t = ed.doc.title, dm = ed.doc.querySelector('meta[name="description"]'), d = dm ? dm.content : '';
      return '<div class="card stack">' +
        '<div class="field"><label for="seo-t">Page title</label><input class="input" id="seo-t" data-seo="title" value="' + esc(t) + '"><div class="hint"><span>Shown in Google and on the browser tab.</span><span data-count="seo-t" class="' + (t.length > 60 ? 'over' : '') + '">' + t.length + ' / 60</span></div></div>' +
        '<div class="field"><label for="seo-d">Description</label><textarea class="textarea" id="seo-d" data-seo="desc" rows="4"' + (dm ? '' : ' disabled') + '>' + esc(d) + '</textarea><div class="hint"><span>The summary under the title in Google.</span><span data-count="seo-d" class="' + (d.length > 155 ? 'over' : '') + '">' + d.length + ' / 155</span></div></div>' +
        '<div class="stack-sm"><span class="label">How it looks in Google</span><div style="display:grid;gap:2px;padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)"><span class="small muted">oneplustwo.co.uk' + esc(pageUrl(ed.path) === '/' ? '' : ' › ' + pageUrl(ed.path).slice(1)) + '</span><span id="g-title" style="color:var(--info);font-size:1.05rem;line-height:1.3">' + esc(t.length > 62 ? t.slice(0, 60) + '…' : t) + '</span><span id="g-desc" class="small muted">' + esc(d.length > 158 ? d.slice(0, 155) + '…' : d) + '</span></div></div>' +
        '<p class="small muted">The social sharing title and description update to match.</p></div>';
    }
    var sel = selPanelHtml();
    var secs = sections();
    var list = secs.map(function (s, i) {
      var id = s.getAttribute('data-cms-s'), hidden = s.hasAttribute('hidden'), hero = !!s.querySelector('h1');
      var canBg = s.classList.contains('section');
      var row = '<div class="sec-row' + (hidden ? ' is-hidden' : '') + (ed.cur === id ? ' is-current' : '') + '"><button class="sec-name" type="button" data-action="sec-go" data-id="' + id + '" title="Show this section">' + esc(secName(s, i)) + '</button>' +
        '<button class="icon-btn" type="button" data-action="sec-up" data-id="' + id + '" aria-label="Move up"' + (i === 0 ? ' disabled' : '') + '>' + icon('up') + '</button>' +
        '<button class="icon-btn" type="button" data-action="sec-down" data-id="' + id + '" aria-label="Move down"' + (i === secs.length - 1 ? ' disabled' : '') + '>' + icon('down') + '</button>' +
        '<button class="icon-btn" type="button" data-action="sec-hide" data-id="' + id + '" aria-label="' + (hidden ? 'Show' : 'Hide') + ' section"' + (hero ? ' disabled title="The top section cannot be hidden"' : ' title="' + (hidden ? 'Show on the website' : 'Hide from the website') + '"') + '>' + icon(hidden ? 'eye-off' : 'eye') + '</button></div>';
      if (ed.cur === id && (canBg || !hero)) {
        row += '<div class="stack-sm" style="padding:8px 4px 10px 10px">' +
          (canBg ? '<div class="row" style="gap:8px"><span class="small" style="font-weight:600">Background</span><div class="seg" role="group" aria-label="Background">' + [['plain', 'Plain'], ['mint', 'Mint']].map(function (b) { var on = b[0] === 'mint' ? s.classList.contains('section--mint') : !s.classList.contains('section--mint'); return '<button type="button" data-action="sec-bg" data-id="' + id + '" data-bg="' + b[0] + '" aria-pressed="' + on + '">' + b[1] + '</button>'; }).join('') + '</div></div>' : '') +
          (hero ? '' : (ed.confirmDel === id ? '<div class="row" style="gap:6px"><span class="small" style="color:var(--bad);font-weight:600">Remove this section for good?</span><button class="btn btn--danger btn--sm" type="button" data-action="sec-del-yes" data-id="' + id + '">Remove</button><button class="btn btn--ghost btn--sm" type="button" data-action="sec-del-no">Keep</button></div>' : '<button class="btn btn--ghost btn--sm" type="button" data-action="sec-del" data-id="' + id + '" style="color:var(--bad);justify-self:start">' + icon('trash') + 'Remove section</button>')) +
        '</div>';
      }
      return row;
    }).join('');
    var add = '<div class="add-sec"><strong>Add a section</strong><div class="blocks" style="grid-template-columns:repeat(2,minmax(0,1fr))">' +
      [['text-image', 'Text and photo'], ['text', 'Text only'], ['features', 'Three points'], ['cta', 'Book a demo band'], ['quote', 'Customer quote'], ['faq', 'Questions']].map(function (b) { return '<button type="button" data-action="add-sec" data-kind="' + b[0] + '"><span class="mini-skel"><i></i><i></i></span><strong style="font-size:.84rem">' + b[1] + '</strong></button>'; }).join('') +
      '</div><span class="small muted">New sections go at the bottom of the page. Use the arrows to move them.</span></div>';
    return '<div class="stack">' + sel + '<div class="sec-list">' + list + '</div>' + add + '</div>';
  }

  function selPanelHtml() {
    var ed = S.ed, sel = ed.sel;
    if (!sel) return '';
    if (sel.type === 'img') {
      var img = ed.doc.querySelector('[data-cms-i="' + sel.id + '"]'); if (!img) return '';
      var src = img.getAttribute('src') || '', alt = img.getAttribute('alt') || '';
      var imgs = (S.files.images || []).filter(function (f) { return !/\/(brands|favicon)/.test(f.path) && !/(favicon|apple-touch|icon-512|og-image|google-g)/.test(f.path); });
      return '<div class="sel-panel"><div class="row" style="justify-content:space-between"><strong>Photo</strong><button class="icon-btn" type="button" data-action="sel-close" aria-label="Close">' + icon('x') + '</button></div>' +
        '<div class="row" style="flex-wrap:nowrap"><span class="thumb"><img src="' + esc(src) + '" alt=""></span><span class="small mono" style="overflow-wrap:anywhere">' + esc(src.split('/').pop()) + '</span></div>' +
        '<label class="check"><input type="checkbox" id="sel-dec"' + (alt ? '' : ' checked') + '> Decorative only (no description needed)</label>' +
        '<div class="field"' + (alt ? '' : ' hidden') + ' id="sel-alt-f"><label for="sel-alt">Description</label><input class="input" id="sel-alt" value="' + esc(alt) + '" placeholder="For example: Sunmi D3 Pro till on a cafe counter"></div>' +
        '<div class="field"><span class="label">Swap for another image</span><div class="pick-grid">' + imgs.map(function (f) { var p = '/' + f.path; return '<button type="button" data-action="sel-img" data-src="' + esc(p) + '" aria-pressed="' + (p === src.split('?')[0]) + '" title="' + esc(f.path.split('/').pop()) + '"><img src="' + esc(p) + '" alt="" loading="lazy" data-raw="' + esc(rawUrl(f.path)) + '"></button>'; }).join('') + '</div></div>' +
        '<label class="btn btn--outline btn--sm" for="sel-up" style="justify-self:start">' + icon('upload') + 'Upload a new photo</label><input class="sr" id="sel-up" type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-action="sel-upload"></div>';
    }
    if (sel.type === 'link') {
      var a = ed.doc.querySelector('[data-cms-a="' + sel.id + '"]'); if (!a) return '';
      return '<div class="sel-panel"><div class="row" style="justify-content:space-between"><strong>Link</strong><button class="icon-btn" type="button" data-action="sel-close" aria-label="Close">' + icon('x') + '</button></div>' +
        '<p class="small">“' + esc(a.textContent.replace(/\s+/g, ' ').trim().slice(0, 60)) + '”</p>' +
        '<div class="field"><label for="sel-href">Goes to</label><input class="input mono" id="sel-href" value="' + esc(a.getAttribute('href') || '') + '" placeholder="/pricing"><div class="hint"><span>A page on this site like /pricing, or a full address starting https://</span></div></div>' +
        '<p class="form-error" id="sel-err" role="alert"></p><button class="btn btn--primary btn--sm" type="button" data-action="sel-href-save" style="justify-self:start">Update link</button></div>';
    }
    return '';
  }
  function rerenderSide() { var p = $('#ed-panel'); if (p) p.innerHTML = sidePanelHtml(); }

  /* Build the editable preview. Scripts are left out so nothing on the page runs while editing. */
  function frameHtml() {
    var c = S.ed.doc.cloneNode(true);
    $$('script', c).forEach(function (s) { s.remove(); });
    $$('*', c).forEach(function (el) { Array.prototype.slice.call(el.attributes).forEach(function (a) { if (/^on/i.test(a.name)) el.removeAttribute(a.name); }); });
    var st = c.createElement('style'); st.textContent = EDITOR_CSS; c.head.appendChild(st);
    return '<!doctype html>' + c.documentElement.outerHTML;
  }
  function afterPagesRender() {
    var f = $('#ed-frame'); if (!f || !S.ed || !S.ed.doc) return;
    loadFrame();
  }
  function loadFrame(scrollTo) {
    var f = $('#ed-frame'); if (!f) return;
    var y = 0; try { y = f.contentWindow.scrollY || 0; } catch (e) {}
    f.onload = function () { bindFrame(f); try { f.contentWindow.scrollTo(0, y); } catch (e) {} if (scrollTo) flashSection(scrollTo); };
    f.srcdoc = frameHtml();
  }
  function frameDoc() { var f = $('#ed-frame'); try { return f && f.contentDocument; } catch (e) { return null; } }
  function flashSection(id) {
    var d = frameDoc(); if (!d) return;
    var el = d.querySelector('[data-cms-s="' + id + '"]'); if (!el) return;
    el.scrollIntoView({ block: 'start' });
    el.classList.remove('cms-flash'); void el.offsetWidth; el.classList.add('cms-flash');
  }
  function bindFrame(f) {
    var d = f.contentDocument; if (!d) return;
    $$('[data-cms-e]', d).forEach(function (el) { el.setAttribute('contenteditable', 'true'); el.setAttribute('spellcheck', 'true'); });
    d.addEventListener('input', function (e) {
      var el = e.target.closest && e.target.closest('[data-cms-e]'); if (!el) return;
      var src = S.ed.doc.querySelector('[data-cms-e="' + el.getAttribute('data-cms-e') + '"]'); if (!src) return;
      src.innerHTML = el.innerHTML;
      var sec = el.closest('[data-cms-s]');
      dirty('text-' + el.getAttribute('data-cms-e'), 'Edited “' + (el.textContent.replace(/\s+/g, ' ').trim().slice(0, 40) || 'text') + '”' + (sec ? ' in ' + secName(S.ed.doc.querySelector('[data-cms-s="' + sec.getAttribute('data-cms-s') + '"]'), 0).replace(/^Hero: /, '') : ''));
    });
    d.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.closest && e.target.closest('[data-cms-e]')) { e.preventDefault(); if (e.shiftKey) d.execCommand('insertLineBreak'); }
    });
    d.addEventListener('paste', function (e) {
      if (!(e.target.closest && e.target.closest('[data-cms-e]'))) return;
      e.preventDefault(); var t = (e.clipboardData || window.clipboardData).getData('text/plain').replace(/\s*\n\s*/g, ' ');
      d.execCommand('insertText', false, t);
    });
    d.addEventListener('submit', function (e) { e.preventDefault(); }, true);
    d.addEventListener('click', function (e) {
      var t = e.target;
      var sec = t.closest && t.closest('[data-cms-s]');
      var img = t.closest && t.closest('img[data-cms-i]');
      var a = t.closest && t.closest('a');
      if (a) e.preventDefault();
      $$('.cms-sel', d).forEach(function (x) { x.classList.remove('cms-sel'); });
      if (img) { S.ed.sel = { type: 'img', id: img.getAttribute('data-cms-i') }; img.classList.add('cms-sel'); }
      else if (a && a.hasAttribute('data-cms-a')) { S.ed.sel = { type: 'link', id: a.getAttribute('data-cms-a') }; a.classList.add('cms-sel'); }
      else S.ed.sel = null;
      S.ed.cur = sec ? sec.getAttribute('data-cms-s') : S.ed.cur;
      if (S.ed.tab !== 'sections' && S.ed.sel) S.ed.tab = 'sections';
      $$('[data-action="ed-tab"]').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === S.ed.tab)); });
      rerenderSide();
    }, true);
    $$('img[data-cms-i]', d).forEach(function (img) { img.addEventListener('error', function () { var s = img.getAttribute('src') || ''; if (s.charAt(0) === '/' && !img.dataset.triedRaw) { img.dataset.triedRaw = '1'; img.src = rawUrl(s.slice(1)); } }); });
  }

  function moveSection(id, dir) {
    var secs = sections(), i = secs.findIndex(function (s) { return s.getAttribute('data-cms-s') === id; });
    var j = i + dir; if (i < 0 || j < 0 || j >= secs.length) return;
    var main = S.ed.doc.querySelector('main');
    if (dir < 0) main.insertBefore(secs[i], secs[j]); else main.insertBefore(secs[i], secs[j].nextSibling);
    S.ed.cur = id;
    dirty('order', 'Changed the order of sections', true);
    rerenderSide(); loadFrame(id);
  }

  var TEMPLATES = {
    'text-image': '<section class="section">\n  <div class="container grid grid-2">\n    <div class="stack">\n      <h2>A new heading</h2>\n      <p>Write a few short sentences about what this means for a busy venue.</p>\n      <div class="btn-row"><a class="btn btn--primary" href="/book-a-demo">Book a demo</a></div>\n    </div>\n    <div class="photo photo--illus"><img src="/assets/img/illustrations/cafe.svg" alt="" width="400" height="300" loading="lazy"></div>\n  </div>\n</section>',
    text: '<section class="section">\n  <div class="container stack">\n    <h2>A new heading</h2>\n    <p>Write a few short sentences here.</p>\n  </div>\n</section>',
    features: '<section class="section section--mint">\n  <div class="container stack stack--lg">\n    <h2>Why venues choose us</h2>\n    <div class="grid grid-3 grid--wide-gap">\n      <div class="stack stack--sm"><h3>First point</h3><p>One or two short sentences.</p></div>\n      <div class="stack stack--sm"><h3>Second point</h3><p>One or two short sentences.</p></div>\n      <div class="stack stack--sm"><h3>Third point</h3><p>One or two short sentences.</p></div>\n    </div>\n  </div>\n</section>',
    cta: '<section class="section section--flush-top">\n  <div class="container">\n    <div class="cta-band">\n      <div class="stack stack--sm"><h2>See it working for your venue</h2><p>Book a free demo with our team. It takes about 30 minutes and there\'s no obligation.</p></div>\n      <a class="btn btn--dark btn--lg" href="/book-a-demo">Book a demo</a>\n    </div>\n  </div>\n</section>',
    quote: '<section class="section">\n  <div class="container"><figure class="quote quote--dark">\n  <div class="stack">\n    <blockquote>“What the customer said about OnePlusTwo.”</blockquote>\n    <figcaption><span><span class="quote-name">Name, Owner</span><span class="quote-venue">Venue name, Town</span></span></figcaption>\n  </div>\n</figure></div>\n</section>',
    faq: '<section class="section">\n  <div class="container stack stack--lg">\n    <h2>Questions</h2>\n    <div class="stack">\n      <div class="stack stack--sm"><h3>A common question?</h3><p>A short, friendly answer.</p></div>\n      <div class="stack stack--sm"><h3>Another question?</h3><p>A short, friendly answer.</p></div>\n    </div>\n  </div>\n</section>'
  };

  /* ================= MEDIA ================= */
  function loadFiles() { return api('files').then(function (d) { S.files = d; }).catch(function (e) { toast(e.message, true); S.files = { pages: [], images: [] }; }); }
  function imgFolder(p) { var m = p.match(/^assets\/img\/([^/]+)\//); return m ? m[1] : 'other'; }
  var FOLDERS = { uploads: 'Uploaded photos', products: 'Product photos', illustrations: 'Illustrations', venues: 'Venue logos', partners: 'Partner logos', brands: 'Brand logos', other: 'Other' };
  function vMedia() {
    if (!S.files) { loadFiles().then(function () { if (S.view === 'media') render(); }); return loadingBlock('Loading images…'); }
    var groups = {};
    S.files.images.forEach(function (f) { var g = imgFolder(f.path); (groups[g] = groups[g] || []).push(f); });
    var order = ['uploads', 'products', 'illustrations', 'venues', 'partners', 'brands', 'other'].filter(function (g) { return groups[g]; });
    return '<div class="page-head"><div><h1>Images</h1><p>Every photo, illustration and logo on the website. Upload new photos here, then swap them into a page from Pages and layout.</p></div><label class="btn btn--primary" for="up-file">' + icon('upload') + 'Upload images</label><input id="up-file" class="sr" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple data-action="upload"></div>' +
      '<div class="drop" id="drop">' + icon('image', 26) + '<strong>Drag photos here to upload</strong><span class="small muted">JPG, PNG, WebP or GIF. Big photos are made smaller automatically so pages stay fast. New photos can take a minute to appear on the site.</span></div>' +
      order.map(function (g) {
        return '<section class="stack"><h2>' + esc(FOLDERS[g] || g) + ' <span class="muted small tnum">' + groups[g].length + '</span></h2><div class="media-grid">' + groups[g].map(function (f) {
          return '<button type="button" class="media" data-action="pick-media" data-path="' + esc(f.path) + '"><span class="mimg"><img src="/' + esc(f.path) + '" alt="" loading="lazy" data-raw="' + esc(rawUrl(f.path)) + '"></span><span class="mmeta"><strong>' + esc(f.path.split('/').pop()) + '</strong><small>' + (f.size ? Math.max(1, Math.round(f.size / 1024)) + ' KB' : '') + '</small></span></button>';
        }).join('') + '</div></section>';
      }).join('');
  }
  function mediaDrawer(path) {
    var f = S.files.images.find(function (x) { return x.path === path; });
    return '<div class="drawer-head"><h2 id="drawer-title">Image details</h2><button class="icon-btn" type="button" data-action="close-drawer" aria-label="Close">' + icon('x') + '</button></div>' +
      '<div class="drawer-body"><div style="background:#EEEBE2;border-radius:var(--r);aspect-ratio:4/3;max-width:100%;display:grid;place-items:center"><img src="/' + esc(path) + '" data-raw="' + esc(rawUrl(path)) + '" alt="" style="max-width:80%;max-height:85%;object-fit:contain"></div>' +
      '<div class="field"><span class="label">Address</span><span class="code-chip" style="justify-self:start;overflow-wrap:anywhere">/' + esc(path) + '<button type="button" data-action="copy" data-text="/' + esc(path) + '" aria-label="Copy address">' + icon('copy', 14) + '</button></span></div>' +
      (f && f.size ? '<div class="field"><span class="label">Size</span><span class="tnum">' + Math.max(1, Math.round(f.size / 1024)) + ' KB</span></div>' : '') +
      '<div class="field"><span class="label">Used on</span><div id="used-on">' + loadingBlock('Checking pages…') + '</div></div>' +
      '</div><div class="drawer-foot" id="media-foot"><button class="btn btn--primary" type="button" data-action="close-drawer">Done</button></div>';
  }
  function loadAllPages() {
    var pages = S.files.pages.map(function (p) { return p.path; });
    return Promise.all(pages.map(function (p) {
      if (S.drafts[p]) return Promise.resolve({ path: p, content: S.drafts[p].content, sha: S.drafts[p].baseSha, draft: true });
      if (S.pageCache[p] && S.pageCache[p].sha === (S.files.pages.find(function (x) { return x.path === p; }) || {}).sha) return Promise.resolve({ path: p, content: S.pageCache[p].content, sha: S.pageCache[p].sha });
      return api('file', { query: { path: p } }).then(function (f) { S.pageCache[p] = { content: f.content, sha: f.sha }; return { path: p, content: f.content, sha: f.sha }; });
    }));
  }
  function checkUsage(path) {
    loadAllPages().then(function (all) {
      var used = all.filter(function (p) { return p.content.indexOf('/' + path) > -1; }).map(function (p) { return p.path; });
      var box = $('#used-on'); if (!box) return;
      box.innerHTML = used.length ? '<div class="chips">' + used.map(function (u) { return '<span class="pill pill--muted" style="font-weight:600">' + esc(pageName(u)) + '</span>'; }).join('') + '</div>' : '<span class="small muted">Not used on any page.</span>';
      var foot = $('#media-foot');
      if (foot && !used.length && can('images')) foot.insertAdjacentHTML('afterbegin', '<button class="btn btn--danger" type="button" data-action="m-del" data-path="' + esc(path) + '" style="margin-right:auto">' + icon('trash') + 'Delete image</button>');
      if (foot && used.length) foot.insertAdjacentHTML('afterbegin', '<span class="small muted" style="margin-right:auto;align-self:center">In use, so it cannot be deleted.</span>');
    }).catch(function (e) { var box = $('#used-on'); if (box) box.innerHTML = errorBlock(e); });
  }
  /* Shrink big photos before upload so they stay under 3 MB and load quickly. */
  function prepareImage(file) {
    return new Promise(function (resolve, reject) {
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return reject(new Error(file.name + ' is not a JPG, PNG, WebP or GIF.'));
      var reader = new FileReader();
      reader.onload = function () {
        var dataUrl = reader.result;
        if (file.type === 'image/gif') { if (file.size > 3 * 1024 * 1024) return reject(new Error(file.name + ' is over 3 MB.')); return resolve({ name: file.name, base64: dataUrl }); }
        var img = new Image();
        img.onload = function () {
          var max = 2000, w = img.naturalWidth, h = img.naturalHeight;
          if (w <= max && h <= max && file.size <= 1.5 * 1024 * 1024) return resolve({ name: file.name, base64: dataUrl });
          var k = Math.min(1, max / Math.max(w, h)), c = document.createElement('canvas');
          c.width = Math.round(w * k); c.height = Math.round(h * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          var out = c.toDataURL('image/webp', 0.85);
          if (out.indexOf('data:image/webp') !== 0) out = c.toDataURL('image/jpeg', 0.85);
          resolve({ name: file.name.replace(/\.[^.]+$/, '') + (out.indexOf('webp') > -1 ? '.webp' : '.jpg'), base64: out });
        };
        img.onerror = function () { reject(new Error(file.name + ' could not be read.')); };
        img.src = dataUrl;
      };
      reader.onerror = function () { reject(new Error(file.name + ' could not be read.')); };
      reader.readAsDataURL(file);
    });
  }
  function uploadFiles(files) {
    var list = Array.prototype.slice.call(files);
    if (!list.length) return Promise.resolve([]);
    toast('Uploading ' + list.length + (list.length === 1 ? ' image…' : ' images…'));
    var done = [];
    return list.reduce(function (p, file) {
      return p.then(function () { return prepareImage(file).then(function (img) { return api('upload', { method: 'POST', body: img }); }).then(function (r) { done.push(r.path); }).catch(function (e) { toast(e.message, true); }); });
    }, Promise.resolve()).then(function () { return loadFiles(); }).then(function () { if (done.length) toast(done.length + (done.length === 1 ? ' image uploaded' : ' images uploaded')); return done; });
  }

  /* ================= PRICES AND DETAILS: find and replace ================= */
  var PRESETS = [['Starter price', '£49'], ['Essentials price', '£79'], ['Premium price', '£109'], ['Extra licence', '£19 a month'], ['Kiosk software', '£59 a month'], ['Phone number', '+44 24 7775 2650'], ['Email', 'hello@oneplustwo.co.uk'], ['Support', '7-day support'], ['Reply time', 'within 2 hours']];
  function vDetails() {
    var F = S.find;
    var res = '';
    if (F.loading) res = loadingBlock('Searching every page…');
    else if (F.error) res = errorBlock(F.error);
    else if (F.results) {
      var total = F.results.reduce(function (n, p) { return n + p.matches.length; }, 0);
      var picked = F.results.reduce(function (n, p) { return n + p.matches.filter(function (m) { return m.on; }).length; }, 0);
      res = total ? '<section class="card stack"><div class="card-head" style="margin:0"><div><h2>Found in ' + total + (total === 1 ? ' place' : ' places') + ' on ' + F.results.length + (F.results.length === 1 ? ' page' : ' pages') + '</h2><p>Untick any that should stay as they are.</p></div><div class="row"><button class="btn btn--ghost btn--sm" type="button" data-action="f-all" data-on="1">Tick all</button><button class="btn btn--ghost btn--sm" type="button" data-action="f-all" data-on="0">Untick all</button></div></div>' +
        F.results.map(function (p, pi) {
          return '<div class="stack-sm"><h3>' + esc(pageName(p.path)) + ' <span class="small muted mono">' + esc(pageUrl(p.path)) + '</span></h3><div>' + p.matches.map(function (m, mi) {
            return '<label class="match"><input type="checkbox" data-action="f-tick" data-p="' + pi + '" data-m="' + mi + '"' + (m.on ? ' checked' : '') + ' style="width:18px;height:18px;accent-color:var(--green-ink)"><span class="ctx">' + (m.hiddenText ? '<span class="pill pill--muted" style="margin-right:6px">Not shown on the page</span>' : '') + esc(m.before) + '<mark>' + esc(m.text) + '</mark>' + esc(m.after) + '</span></label>';
          }).join('') + '</div></div>';
        }).join('') +
        '<div class="row" style="justify-content:flex-end;border-top:1px solid var(--line);padding-top:14px"><span class="small muted" style="margin-right:auto">Replace with “' + esc(F.r) + '”</span><button class="btn btn--primary" type="button" data-action="f-apply"' + (picked && F.r !== F.q ? '' : ' disabled') + '>Replace in ' + picked + (picked === 1 ? ' place' : ' places') + '</button></div></section>'
        : '<div class="notice">' + icon('info') + '<span>“' + esc(F.q) + '” is not on any page. Check the spelling and spaces.</span></div>';
    }
    return '<div class="page-head"><div><h1>Prices and details</h1><p>Change a price, phone number or any wording everywhere it appears, in one go. You see every place first, so nothing changes by accident.</p></div></div>' +
      '<section class="card stack"><div class="field"><span class="label">Common things to change</span><div class="preset-row">' + PRESETS.map(function (p) { return '<button type="button" data-action="f-preset" data-q="' + esc(p[1]) + '">' + esc(p[0]) + ' <span class="muted">' + esc(p[1]) + '</span></button>'; }).join('') + '</div></div>' +
        '<form class="grid-2" id="find-form" novalidate><div class="field"><label for="f-q">Find</label><input class="input" id="f-q" value="' + esc(F.q) + '" placeholder="For example: £49" autocomplete="off"></div><div class="field"><label for="f-r">Replace with</label><input class="input" id="f-r" value="' + esc(F.r) + '" placeholder="For example: £55" autocomplete="off"></div></form>' +
        '<div class="row"><button class="btn btn--outline" type="button" data-action="f-search">Find on every page</button><span class="small muted">Matches capital letters exactly.</span></div>' +
        '<div class="notice">' + icon('info') + '<span>Prices customers pay in the hardware shop basket are set in the shop page\'s code, not its wording. Changing the wording here does not change what the basket charges.</span></div></section>' + res;
  }
  function htmlEsc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function runFind() {
    var F = S.find; F.q = $('#f-q').value; F.r = $('#f-r').value;
    if (!F.q.trim()) { toast('Type what you want to find first.', true); return; }
    F.loading = true; F.error = null; render();
    loadAllPages().then(function (all) {
      var needles = [F.q]; var e = htmlEsc(F.q); if (e !== F.q) needles.push(e);
      F.results = [];
      all.forEach(function (p) {
        var matches = [], c = p.content;
        needles.forEach(function (nd) {
          var i = c.indexOf(nd);
          while (i > -1) {
            if (!matches.some(function (m) { return m.index === i; })) {
              var lt = c.lastIndexOf('<', i), gt = c.lastIndexOf('>', i);
              var inTag = lt > gt;
              var inScript = /<script[^>]*>[^<]*$/i.test(c.slice(Math.max(0, i - 4000), i));
              var inHead = i < c.search(/<body[\s>]/i);
              var plain = function (s) { return s.replace(/<[^>]*>/g, ' ').replace(/<[^>]*$/, '').replace(/^[^<]*>/, '').replace(/\s+/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'"); };
              matches.push({ index: i, len: nd.length, text: F.q, before: plain(c.slice(Math.max(0, i - 90), i)).slice(-60), after: plain(c.slice(i + nd.length, i + nd.length + 90)).slice(0, 60), hiddenText: inTag || inScript || inHead, on: true });
            }
            i = c.indexOf(nd, i + nd.length);
          }
        });
        if (matches.length) { matches.sort(function (a, b) { return a.index - b.index; }); F.results.push({ path: p.path, content: c, sha: p.sha, matches: matches }); }
      });
      F.loading = false; render();
    }).catch(function (e) { F.loading = false; F.error = e; render(); });
  }
  function applyReplace() {
    var F = S.find, r = $('#f-r') ? $('#f-r').value : F.r; F.r = r;
    var changedPages = 0, places = 0;
    F.results.forEach(function (p) {
      var on = p.matches.filter(function (m) { return m.on; }); if (!on.length) return;
      var c = p.content, inHtml = function (m) { return c.slice(m.index, m.index + m.len) !== F.q; };
      on.slice().sort(function (a, b) { return b.index - a.index; }).forEach(function (m) { c = c.slice(0, m.index) + (inHtml(m) ? htmlEsc(r) : r) + c.slice(m.index + m.len); });
      var d = S.drafts[p.path];
      setDraft(p.path, c, d ? d.baseSha : p.sha, d ? d.baseline : p.content, 'replace-' + uid(), 'Replaced “' + F.q + '” with “' + r + '” (' + on.length + (on.length === 1 ? ' place)' : ' places)'));
      if (S.ed && S.ed.path === p.path) S.ed = null;
      changedPages++; places += on.length;
    });
    toast('Replaced in ' + places + (places === 1 ? ' place' : ' places') + ' on ' + changedPages + (changedPages === 1 ? ' page' : ' pages') + '. Publish to make it live.');
    F.results = null; render();
  }

  /* ================= VOUCHERS ================= */
  function vVouchers() {
    if (!S.me.config.vouchers) return '<div class="page-head"><div><h1>Voucher codes</h1></div></div>' + errorBlock(new Error('Voucher codes are not set up yet. Add VOUCHER_SECRET in Vercel (see ADMIN-GUIDE.md).'));
    if (!S.vouchers) { loadVouchers().then(function () { if (S.view === 'vouchers') render(); }).catch(function (e) { $('#view').innerHTML = errorBlock(e, 'reload-vouchers'); }); return loadingBlock('Loading voucher codes…'); }
    var counts = { all: S.vouchers.length, active: 0, scheduled: 0, paused: 0, ended: 0 };
    S.vouchers.forEach(function (v) { counts[vState(v).f]++; });
    var list = S.vouchers.filter(function (v) { return S.vFilter === 'all' || vState(v).f === S.vFilter; });
    var rows = list.map(function (v) {
      var st = vState(v), key = v.hash;
      var codeHtml = v.code ? '<span class="code-chip">' + esc(v.code) + '<button type="button" data-action="copy" data-text="' + esc(v.code) + '" aria-label="Copy ' + esc(v.code) + '">' + icon('copy', 14) + '</button></span>' : '<span class="code-chip" title="This code was saved with a different secret, so it cannot be shown.">Hidden code</span>';
      if (S.vConfirm === key) return '<tr class="confirm-row"><td colspan="5"><div class="row" style="justify-content:space-between"><span><strong>Delete ' + esc(v.code || 'this code') + '?</strong> Customers will no longer be able to use it.</span><span class="row" style="gap:6px"><button class="btn btn--danger btn--sm" type="button" data-action="v-del-yes" data-id="' + key + '">Delete code</button><button class="btn btn--ghost btn--sm" type="button" data-action="v-del-no">Keep it</button></span></div></td></tr>';
      return '<tr><td>' + codeHtml + (v.note ? '<div class="small muted" style="margin-top:4px">' + esc(v.note) + '</div>' : '') + '</td>' +
        '<td><strong>' + vLabel(v) + '</strong><div class="small muted">' + (v.min ? 'On orders over ' + money(v.min) : 'Any order') + '</div></td>' +
        '<td><span class="pill pill--' + st.k + '">' + esc(st.t) + '</span></td>' +
        '<td class="tnum">' + (v.end ? 'Until ' + fmtDate(v.end) : '<span class="muted">No end date</span>') + '</td>' +
        '<td class="actions"><label class="switch" style="display:inline-block;vertical-align:middle;margin-right:8px"><input type="checkbox" data-action="v-toggle" data-id="' + key + '" aria-label="' + (v.active ? 'Pause ' : 'Turn on ') + esc(v.code || 'code') + '"' + (v.active ? ' checked' : '') + '><span></span></label><button class="btn btn--ghost btn--sm" type="button" data-action="v-edit" data-id="' + key + '">Edit</button><button class="icon-btn" type="button" data-action="v-del" data-id="' + key + '" aria-label="Delete ' + esc(v.code || 'code') + '" style="color:var(--bad)">' + icon('trash') + '</button></td></tr>';
    }).join('');
    return '<div class="page-head"><div><h1>Voucher codes</h1><p>Discount codes customers enter at checkout on the hardware shop. Discounts come off the products before VAT. Delivery is always charged in full. Changes go live about a minute after you save.</p></div><button class="btn btn--primary" type="button" data-action="v-new">' + icon('plus') + 'New voucher code</button></div>' +
      '<div class="filters"><div class="seg" role="group" aria-label="Filter codes">' + [['all', 'All'], ['active', 'Active'], ['scheduled', 'Starting soon'], ['paused', 'Paused'], ['ended', 'Ended']].map(function (f) { return '<button type="button" data-action="v-filter" data-f="' + f[0] + '" aria-pressed="' + (S.vFilter === f[0]) + '">' + f[1] + ' <span class="tnum muted">' + counts[f[0]] + '</span></button>'; }).join('') + '</div></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Code</th><th>Discount</th><th>Status</th><th>Valid</th><th style="text-align:right">On / off</th></tr></thead><tbody>' + (rows || '<tr><td colspan="5"><div class="empty">' + icon('ticket', 28) + '<strong>' + (S.vouchers.length ? 'No codes here' : 'No voucher codes yet') + '</strong><span class="small">' + (S.vouchers.length ? 'Try another filter.' : 'Create one and customers can use it at checkout.') + '</span></div></td></tr>') + '</tbody></table></div>' +
      '<p class="small muted">The website only stores a scrambled version of each code, so nobody can read them from the site\'s files.</p>';
  }
  function voucherDrawer(v) {
    var isNew = !v;
    v = v || { code: genCode(), type: 'percent', value: 10, active: true, start: ukToday(), end: '', min: 0, note: '' };
    var val = v.type === 'percent' ? v.value : v.value / 100;
    return '<div class="drawer-head"><h2 id="drawer-title">' + (isNew ? 'New voucher code' : 'Edit ' + esc(v.code || 'code')) + '</h2><button class="icon-btn" type="button" data-action="close-drawer" aria-label="Close">' + icon('x') + '</button></div>' +
      '<form class="drawer-body" id="v-form" data-id="' + esc(v.hash || '') + '" novalidate>' +
        '<div class="field"><label for="v-code">Code</label><div class="row" style="flex-wrap:nowrap;gap:8px"><input class="input mono" id="v-code" value="' + esc(v.code || '') + '" maxlength="20" style="text-transform:uppercase;letter-spacing:.06em;font-weight:700" autocomplete="off"' + (isNew ? '' : ' readonly') + '>' + (isNew ? '<button class="btn btn--outline btn--sm" type="button" data-action="v-gen" style="min-height:42px">Make one up</button>' : '') + '</div><div class="hint"><span>' + (isNew ? 'Letters and numbers only. Customers can type it in capitals or lower case.' : 'A code cannot be renamed. Delete it and make a new one instead.') + '</span></div></div>' +
        '<div class="field"><span class="label">Type of discount</span><div class="seg" role="group" aria-label="Type of discount"><button type="button" data-action="v-type" data-t="percent" aria-pressed="' + (v.type === 'percent') + '">Percentage off</button><button type="button" data-action="v-type" data-t="fixed" aria-pressed="' + (v.type === 'fixed') + '">Amount off</button></div><input type="hidden" id="v-type" value="' + v.type + '"></div>' +
        '<div class="grid-2"><div class="field"><label for="v-value" id="v-value-l">' + (v.type === 'percent' ? 'Percentage' : 'Amount (£)') + '</label><input class="input tnum" id="v-value" type="number" min="1" step="' + (v.type === 'percent' ? '1' : '0.01') + '" value="' + val + '"></div><div class="field"><label for="v-min">Minimum spend (£)</label><input class="input tnum" id="v-min" type="number" min="0" step="1" value="' + (v.min ? v.min / 100 : '') + '" placeholder="None"><div class="hint"><span>Before VAT and delivery.</span></div></div></div>' +
        '<div class="grid-2"><div class="field"><label for="v-start">Starts</label><input class="input" id="v-start" type="date" value="' + esc(v.start) + '"></div><div class="field"><label for="v-end">Ends</label><input class="input" id="v-end" type="date" value="' + esc(v.end) + '"><div class="hint"><span>Leave empty to keep it running.</span></div></div></div>' +
        '<div class="field"><label for="v-note">Note for staff</label><input class="input" id="v-note" value="' + esc(v.note || '') + '" placeholder="For example: Christmas email campaign" maxlength="200"><div class="hint"><span>Only staff see this.</span></div></div>' +
        '<label class="check"><span class="switch"><input type="checkbox" id="v-active"' + (v.active ? ' checked' : '') + '><span></span></span>Customers can use this code</label>' +
        '<div class="voucher-preview" id="v-prev"></div>' +
        '<p class="form-error" id="v-err" role="alert"></p>' +
      '</form>' +
      '<div class="drawer-foot"><button class="btn btn--ghost" type="button" data-action="close-drawer">Cancel</button><button class="btn btn--primary" type="button" data-action="v-save">' + (isNew ? 'Create code' : 'Save changes') + '</button></div>';
  }
  function updateVPrev() {
    var box = $('#v-prev'); if (!box) return;
    var type = $('#v-type').value, raw = parseFloat($('#v-value').value) || 0, sub = 44900;
    var min = Math.round((parseFloat($('#v-min').value) || 0) * 100), ok = sub >= min;
    var disc = !ok ? 0 : (type === 'percent' ? Math.round(sub * Math.min(raw, 100) / 100) : Math.min(Math.round(raw * 100), sub));
    var net = sub - disc, vat = Math.round(net * 0.2), del = 995;
    var label = type === 'percent' ? raw + '% off' : money(Math.round(raw * 100)) + ' off';
    box.innerHTML = '<span class="label">Example basket: Sunmi D3 Mini till kit</span>' +
      '<div class="vp-line"><span>Products</span><span class="tnum">' + money2(sub) + '</span></div>' +
      '<div class="vp-line" style="color:var(--green-ink);font-weight:600"><span>Discount (' + esc(($('#v-code').value || '').toUpperCase()) + ', ' + esc(label) + ')</span><span class="tnum">' + (ok ? '−' + money2(disc) : 'Not reached') + '</span></div>' +
      '<div class="vp-line"><span>VAT (20%)</span><span class="tnum">' + money2(vat) + '</span></div>' +
      '<div class="vp-line"><span>Next day delivery</span><span class="tnum">' + money2(del) + '</span></div>' +
      '<div class="vp-line vp-total"><span>Total</span><span class="tnum">' + money2(net + vat + del) + '</span></div>' +
      (!ok ? '<span class="small muted">This basket is under the minimum spend, so the code would not apply.</span>' : '');
  }
  function saveVoucherForm(btn) {
    var id = $('#v-form').dataset.id, err = $('#v-err');
    var code = ($('#v-code').value || '').trim().toUpperCase(), type = $('#v-type').value, raw = parseFloat($('#v-value').value);
    if (!id && !/^[A-Z0-9]{3,20}$/.test(code)) { err.textContent = 'Codes need 3 to 20 letters or numbers, with no spaces.'; $('#v-code').focus(); return; }
    if (!id && S.vouchers.some(function (v) { return v.code === code; })) { err.textContent = code + ' already exists. Choose a different code.'; $('#v-code').focus(); return; }
    if (!(raw > 0) || (type === 'percent' && raw > 100)) { err.textContent = type === 'percent' ? 'Enter a percentage between 1 and 100.' : 'Enter an amount above £0.'; $('#v-value').focus(); return; }
    var start = $('#v-start').value, end = $('#v-end').value;
    if (end && start && end < start) { err.textContent = 'The end date is before the start date.'; $('#v-end').focus(); return; }
    var data = { type: type, value: type === 'percent' ? Math.round(raw) : Math.round(raw * 100), min: Math.round((parseFloat($('#v-min').value) || 0) * 100), start: start, end: end, note: $('#v-note').value.trim(), active: $('#v-active').checked };
    var list = clone(S.vouchers), msg;
    if (id) { var v = list.find(function (x) { return x.hash === id; }); Object.assign(v, data); msg = 'Edit voucher ' + (v.code || ''); }
    else { list.unshift(Object.assign({ code: code, hash: null }, data)); msg = 'Add voucher ' + code; }
    busy(btn, true);
    saveVouchers(list, msg).then(function () { closeDrawer(); render(); toast((id ? 'Saved. ' : code + ' created. ') + 'Live in the shop in about a minute.'); })
      .catch(function (e) { busy(btn, false); err.textContent = e.status === 409 ? 'Someone else changed the voucher codes just now. Close this, reload the page and try again.' : e.message; });
  }

  /* ================= STATUS ================= */
  function vStatus() {
    if (!S.status) { loadStatus().then(function () { if (S.view === 'status') render(); }).catch(function (e) { $('#view').innerHTML = errorBlock(e, 'reload-status'); }); return loadingBlock('Loading system status…'); }
    var d = S.statusDraft, o = overall(d);
    var changed = statusForSave(d) !== statusForSave(S.status);
    var active = d.incidents.filter(function (i) { return i.status !== 'resolved'; }), past = d.incidents.filter(function (i) { return i.status === 'resolved'; });
    var upcoming = d.maintenance.filter(function (m) { return m.status !== 'completed' && new Date(m.end) > Date.now(); });
    var bar = '';
    if (active.length) bar = '<div class="alertbar ' + (active[0].impact === 'major' ? 'a-major' : 'a-minor') + '">' + icon('alert') + '<span>' + esc(active[0].title) + '</span><u>View status</u></div>';
    else if (o.bar === 'a-major' || o.bar === 'a-minor') bar = '<div class="alertbar ' + o.bar + '">' + icon('alert') + '<span>' + esc(o.label) + ' on some services</span><u>View status</u></div>';
    else if (o.bar === 'a-maint') bar = '<div class="alertbar a-maint">' + icon('wrench') + '<span>' + (o.soon ? 'Planned maintenance: ' + esc(o.soon.title) + ', ' + fmtDT(o.soon.start) : 'Maintenance in progress') + '</span><u>View status</u></div>';
    var svcNames = d.components.map(function (c) { return c.name; });
    function chips(name) { return '<div class="chips">' + svcNames.map(function (n) { return '<label><input type="checkbox" name="' + name + '" value="' + esc(n) + '">' + esc(n) + '</label>'; }).join('') + '</div>'; }
    return '<div class="page-head"><div><h1>System status</h1><p>What customers see at <a href="/status" target="_blank" rel="noopener">oneplustwo.co.uk/status</a>. Status updates go live on their own, separately from other website changes, so you can post them quickly.</p></div></div>' +
      '<div class="overall" style="background:var(--' + o.key + '-bg);color:var(--' + o.key + ')"><span class="ring">' + icon(o.key === 'ok' ? 'check' : (o.key === 'info' ? 'wrench' : 'alert'), 22) + '</span><div><h2>' + esc(o.label) + '</h2><p>' + (changed ? 'Not live yet. Press "Publish status" to update the website.' : 'This is live now. Last updated ' + fmtDT(d.updated) + '.') + '</p></div></div>' +
      '<section class="card"><div class="card-head"><div><h2>Alert bar on the website</h2><p>Shown at the top of every page while something is wrong, or from 24 hours before planned maintenance.</p></div></div>' + (bar || '<div class="notice">' + icon('check') + '<span>No alert bar. Everything is running normally.</span></div>') + '</section>' +
      '<div class="dash-grid">' +
        '<section class="card"><div class="card-head"><div><h2>Services</h2><p>Set each service to how it is running right now.</p></div><button class="btn btn--ghost btn--sm" type="button" data-action="st-allok">Set all to operational</button></div><div>' +
          d.components.map(function (c, i) { var was = S.status.components[i] && S.status.components[i].status !== c.status; return '<div class="svc' + (was ? ' changed' : '') + '"><label class="svc-name" for="svc-' + i + '">' + esc(c.name) + '</label><select class="st-select st-' + esc(c.status) + '" id="svc-' + i + '" data-action="svc" data-i="' + i + '">' + Object.keys(ST).map(function (k) { return '<option value="' + k + '"' + (k === c.status ? ' selected' : '') + '>' + ST[k] + '</option>'; }).join('') + '</select></div>'; }).join('') +
        '</div></section>' +
        '<div class="stack">' +
          '<section class="card stack"><div class="card-head" style="margin:0"><div><h2>Incidents</h2><p>Tell customers what is happening and when it is fixed.</p></div>' + (S.incForm ? '' : '<button class="btn btn--primary btn--sm" type="button" data-action="inc-new">' + icon('plus') + 'Report an incident</button>') + '</div>' +
            (S.incForm ? '<form class="incident stack" id="inc-form" novalidate><h3>New incident</h3><div class="field"><label for="inc-title">What is happening?</label><input class="input" id="inc-title" placeholder="For example: Card payments slow to go through"></div>' +
              '<div class="grid-2"><div class="field"><label for="inc-impact">How serious?</label><select class="select" id="inc-impact"><option value="minor">Minor (amber)</option><option value="major">Major (red)</option></select></div><div class="field"><label for="inc-status">Stage</label><select class="select" id="inc-status"><option value="investigating">Investigating</option><option value="identified">Identified</option><option value="monitoring">Monitoring</option></select></div></div>' +
              '<div class="field"><span class="label">Affected services</span>' + chips('inc-svc') + '<div class="hint"><span>Their status changes to match how serious it is. You can adjust them after.</span></div></div>' +
              '<div class="field"><label for="inc-msg">Message for customers</label><textarea class="textarea" id="inc-msg" rows="3" placeholder="We are looking into reports of slow card payments and will update this page within 30 minutes."></textarea></div>' +
              '<p class="form-error" id="inc-err" role="alert"></p><div class="row" style="justify-content:flex-end"><button class="btn btn--ghost btn--sm" type="button" data-action="inc-cancel">Cancel</button><button class="btn btn--primary btn--sm" type="button" data-action="inc-add">Add incident</button></div></form>' : '') +
            (active.length ? active.map(incCard).join('') : (S.incForm ? '' : '<div class="notice">' + icon('check') + '<span>No open incidents.</span></div>')) +
            (past.length ? '<details><summary class="small" style="cursor:pointer;font-weight:600">Past incidents (' + past.length + ')</summary><div class="stack" style="margin-top:12px">' + past.map(incCard).join('') + '</div></details>' : '') +
          '</section>' +
          '<section class="card stack"><div class="card-head" style="margin:0"><div><h2>Planned maintenance</h2><p>Visitors see a notice from 24 hours before it starts.</p></div>' + (S.mntForm ? '' : '<button class="btn btn--outline btn--sm" type="button" data-action="mnt-new">' + icon('plus') + 'Schedule</button>') + '</div>' +
            (S.mntForm ? '<form class="incident stack" id="mnt-form" novalidate><h3>Schedule maintenance</h3><div class="field"><label for="mnt-title">Title</label><input class="input" id="mnt-title" placeholder="For example: Back office upgrade"></div>' +
              '<div class="grid-2"><div class="field"><label for="mnt-start">Starts</label><input class="input" id="mnt-start" type="datetime-local"></div><div class="field"><label for="mnt-end">Ends</label><input class="input" id="mnt-end" type="datetime-local"></div></div>' +
              '<div class="field"><span class="label">Affected services</span>' + chips('mnt-svc') + '</div><div class="field"><label for="mnt-msg">Message for customers</label><textarea class="textarea" id="mnt-msg" rows="2" placeholder="Reports may be unavailable for up to 2 hours."></textarea></div>' +
              '<p class="form-error" id="mnt-err" role="alert"></p><div class="row" style="justify-content:flex-end"><button class="btn btn--ghost btn--sm" type="button" data-action="mnt-cancel">Cancel</button><button class="btn btn--primary btn--sm" type="button" data-action="mnt-add">Add to schedule</button></div></form>' : '') +
            (upcoming.length ? upcoming.map(function (m) { return '<div class="incident"><div class="incident-head"><div><h3>' + esc(m.title) + '</h3><p class="small muted">' + fmtDT(m.start) + ' to ' + fmtDT(m.end) + '</p></div><span class="pill pill--info">Scheduled</span></div>' + (m.message ? '<p class="small">' + esc(m.message) + '</p>' : '') + '<div class="chips">' + (m.components || []).map(function (c) { return '<span class="pill pill--muted">' + esc(c) + '</span>'; }).join('') + '</div><div class="row"><button class="btn btn--ghost btn--sm" type="button" data-action="mnt-done" data-id="' + m._id + '">Mark as completed</button><button class="btn btn--ghost btn--sm" type="button" data-action="mnt-del" data-id="' + m._id + '" style="color:var(--bad)">Cancel maintenance</button></div></div>'; }).join('') : (S.mntForm ? '' : '<div class="notice">' + icon('clock') + '<span>Nothing scheduled.</span></div>')) +
          '</section>' +
        '</div>' +
      '</div>' +
      (changed ? '<div class="status-save" role="region" aria-label="Unsaved status changes"><span><strong>Status changes not live yet.</strong> Customers still see the old status.</span><span class="row" style="gap:8px"><button class="btn btn--outline btn--sm" type="button" data-action="st-discard">Discard</button><button class="btn btn--primary btn--sm" type="button" data-action="st-publish">' + icon('upload') + 'Publish status</button></span></div>' : '');
  }
  function incCard(inc) {
    var open = inc.status !== 'resolved';
    return '<div class="incident"><div class="incident-head"><div><h3>' + esc(inc.title) + '</h3><p class="small muted">' + esc((inc.components || []).join(', ')) + '</p></div><span class="row" style="gap:6px"><span class="pill pill--' + (inc.impact === 'major' ? 'bad' : 'warn') + '">' + (inc.impact === 'major' ? 'Major' : 'Minor') + '</span><span class="pill pill--' + (open ? 'info' : 'ok') + '">' + esc(INC[inc.status] || inc.status) + '</span></span></div>' +
      '<ul class="plain timeline">' + (inc.updates || []).map(function (u) { return '<li><b>' + esc(INC[u.status] || u.status) + '</b> <span class="muted small">' + fmtDT(u.time) + '</span><br>' + esc(u.message) + '</li>'; }).join('') + '</ul>' +
      (open ? (S.updFor === inc._id ? '<div class="stack-sm" style="border-top:1px solid var(--line);padding-top:12px"><div class="field"><label for="upd-st">Stage</label><select class="select" id="upd-st">' + Object.keys(INC).map(function (k) { return '<option value="' + k + '"' + (k === inc.status ? ' selected' : '') + '>' + INC[k] + '</option>'; }).join('') + '</select></div><div class="field"><label for="upd-msg">Update for customers</label><textarea class="textarea" id="upd-msg" rows="2" placeholder="We have found the cause and a fix is on the way."></textarea></div><p class="form-error" id="upd-err" role="alert"></p><div class="row" style="justify-content:flex-end"><button class="btn btn--ghost btn--sm" type="button" data-action="upd-cancel">Cancel</button><button class="btn btn--primary btn--sm" type="button" data-action="upd-add" data-id="' + inc._id + '">Add update</button></div></div>' : '<div class="row"><button class="btn btn--outline btn--sm" type="button" data-action="upd-open" data-id="' + inc._id + '">Post an update</button><button class="btn btn--primary btn--sm" type="button" data-action="inc-resolve" data-id="' + inc._id + '">' + icon('check') + 'Mark as fixed</button></div>') : '') +
    '</div>';
  }

  /* ================= HISTORY ================= */
  function vHistory() {
    if (!S.history) { api('history').then(function (d) { S.history = d.items; if (S.view === 'history') render(); }).catch(function (e) { $('#view').innerHTML = errorBlock(e, 'reload-history'); }); return loadingBlock('Loading history…'); }
    var drafts = draftList();
    return '<div class="page-head"><div><h1>Publish history</h1><p>Every publish is saved as a version of the website on GitHub, so nothing is ever lost. To undo a published change, open the version on GitHub and revert it, or ask your developer.</p></div><button class="btn btn--ghost btn--sm" type="button" data-action="reload-history">' + icon('restore') + 'Refresh</button></div>' +
      (drafts.length ? '<section class="card"><div class="card-head"><div><h2>Not live yet</h2><p>Changes saved in this browser but not on the website.</p></div><button class="btn btn--primary btn--sm" type="button" data-action="open-publish">Review and publish</button></div><ul class="plain changes">' + drafts.map(function (x) { return Object.keys(x.d.notes).map(function (k) { return '<li><span class="area">' + esc(pageName(x.path)) + '</span><span>' + esc(x.d.notes[k]) + '</span></li>'; }).join(''); }).join('') + '</ul></section>' : '') +
      '<div class="table-wrap"><table><thead><tr><th>When</th><th>Who</th><th>What changed</th><th></th></tr></thead><tbody>' + S.history.map(function (h, i) {
        return '<tr><td class="tnum" style="white-space:nowrap">' + esc(fmtDT(h.when)) + '<div class="small muted">' + esc(ago(h.when)) + '</div></td><td style="white-space:nowrap">' + esc(h.who) + (h.fromAdmin ? '' : '<div class="small muted">Code change</div>') + '</td><td>' + esc(h.title) + '</td><td class="actions">' + (i === 0 ? '<span class="pill pill--ok" style="margin-right:8px">Latest</span>' : '') + '<a class="btn btn--ghost btn--sm" href="' + esc(h.url) + '" target="_blank" rel="noopener">' + icon('ext') + 'View</a></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  /* ================= STAFF ================= */
  function vStaff() {
    var roles = [['Edit pages, text and images', 1, 1, 0, 0], ['Change prices and details', 1, 1, 0, 0], ['Manage voucher codes', 1, 0, 1, 0], ['Update system status', 1, 1, 0, 1], ['Publish changes', 1, 1, 1, 1]];
    return '<div class="page-head"><div><h1>Staff accounts</h1><p>Only people on this list can sign in, using their own work account. Their password and two-step check are handled by your work account provider.</p></div></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Person</th><th>Role</th></tr></thead><tbody>' + S.me.staff.map(function (u) {
        var you = u.email === S.me.user.email;
        return '<tr><td><div class="row" style="gap:10px;flex-wrap:nowrap"><span class="avatar" style="' + (you ? '' : 'background:var(--sunken);color:var(--ink)') + '">' + esc(initials(u.email.split('@')[0].replace(/[._-]/g, ' '))) + '</span><div style="min-width:0"><strong>' + esc(u.email) + (you ? ' <span class="small muted">(you)</span>' : '') + '</strong></div></div></td><td>' + esc(u.roleName) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<section class="card stack"><div class="card-head" style="margin:0"><div><h2>Adding or removing someone</h2><p>The list is kept in Vercel so it cannot be changed from a stolen session.</p></div></div>' +
        '<ol class="stack-sm" style="margin:0;padding-left:20px"><li>In Vercel, open the website project, then <strong>Settings</strong> and <strong>Environment Variables</strong>.</li><li>Edit <span class="mono">ADMIN_USERS</span>. Add <span class="mono">name@oneplustwo.co.uk=editor</span>, separated from the others by a comma. Roles are <span class="mono">owner</span>, <span class="mono">editor</span>, <span class="mono">shop</span> and <span class="mono">support</span>. Delete someone\'s entry to remove them.</li><li>Redeploy the site (Deployments, then the three dots on the latest one, then Redeploy). Changes apply from then.</li></ol></section>' +
      '<section class="card"><div class="card-head"><div><h2>What each role can do</h2></div></div><div class="table-wrap" style="border:0"><table class="perm"><thead><tr><th></th><th>Owner</th><th>Editor</th><th>Shop manager</th><th>Support</th></tr></thead><tbody>' + roles.map(function (r) { return '<tr><td>' + r[0] + '</td>' + r.slice(1).map(function (y) { return '<td>' + (y ? '<span class="yes" aria-label="Yes">' + icon('check') + '</span>' : '<span class="no" aria-label="No">–</span>') + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div></section>';
  }

  /* ================= PUBLISH ================= */
  function publishDrawer(conflicts) {
    var list = draftList(), n = changeCount();
    return '<div class="drawer-head"><h2 id="drawer-title">Publish changes</h2><button class="icon-btn" type="button" data-action="close-drawer" aria-label="Close">' + icon('x') + '</button></div>' +
      '<div class="drawer-body">' + (n ? '<p class="muted">These changes will go live on www.oneplustwo.co.uk about a minute after you publish.</p>' +
        (conflicts && conflicts.length ? '<div class="notice notice--warn">' + icon('alert') + '<span>Someone else published a change to ' + conflicts.map(function (c) { return '<strong>' + esc(pageName(c)) + '</strong>'; }).join(', ') + ' since you started. Undo your changes to ' + (conflicts.length === 1 ? 'that page' : 'those pages') + ' and make them again on the latest version.</span></div>' : '') +
        list.map(function (x) {
          return '<div class="stack-sm"><div class="row" style="justify-content:space-between"><h3>' + esc(pageName(x.path)) + '</h3><button class="btn btn--ghost btn--sm" type="button" data-action="drop-draft" data-path="' + esc(x.path) + '" style="color:var(--bad)">Undo</button></div><ul class="plain changes">' + Object.keys(x.d.notes).map(function (k) { return '<li><span class="area">' + esc(x.path === 'index.html' ? 'Home' : 'Page') + '</span><span>' + esc(x.d.notes[k]) + '</span></li>'; }).join('') + '</ul></div>';
        }).join('') +
        '<div class="field"><label for="pub-note">What did you change? (optional)</label><input class="input" id="pub-note" placeholder="For example: Christmas homepage" maxlength="100"><div class="hint"><span>Helps you find this version later in Publish history.</span></div></div>' +
        '<p class="form-error" id="pub-err" role="alert"></p>'
        : '<div class="empty">' + icon('check', 28) + '<strong>Everything is live</strong><span class="small">Make a change and it will show up here.</span></div>') + '</div>' +
      '<div class="drawer-foot">' + (n ? '<button class="btn btn--ghost" type="button" data-action="close-drawer">Not yet</button><button class="btn btn--primary" type="button" data-action="publish">' + icon('upload') + 'Publish ' + n + (n === 1 ? ' change' : ' changes') + '</button>' : '<button class="btn btn--primary" type="button" data-action="close-drawer">Close</button>') + '</div>';
  }
  function doPublish(btn) {
    var list = draftList(); if (!list.length) return;
    var note = ($('#pub-note') || {}).value || '';
    var pages = list.map(function (x) { return pageName(x.path); });
    var msg = note.trim() || ('Update ' + (pages.length > 3 ? pages.length + ' pages' : pages.join(', ')));
    busy(btn, true);
    api('publish', { method: 'POST', body: { message: msg, files: list.map(function (x) { return { path: x.path, content: x.d.content, baseSha: x.d.baseSha }; }) } })
      .then(function () {
        S.drafts = {}; saveDrafts(); S.ed = null; S.history = null; S.pageCache = {};
        return loadFiles();
      }).then(function () { closeDrawer(); render(); toast('Published. The website updates in about a minute.'); })
      .catch(function (e) {
        busy(btn, false);
        if (e.status === 409) { $('#drawer').innerHTML = publishDrawer(e.conflicts || []); return; }
        var er = $('#pub-err'); if (er) er.textContent = e.message;
      });
  }

  /* ================= Drawer ================= */
  var lastFocus = null;
  function openDrawer(html, after) {
    lastFocus = document.activeElement;
    var d = $('#drawer'); d.innerHTML = html; d.hidden = false;
    requestAnimationFrame(function () { d.classList.add('open'); $('#scrim').classList.add('open'); var f = d.querySelector('input:not([type=hidden]):not([readonly]),select,textarea,button'); if (f) f.focus(); });
    if (after) after();
  }
  function closeDrawer() {
    var d = $('#drawer'); d.classList.remove('open'); $('#scrim').classList.remove('open');
    setTimeout(function () { if (!d.classList.contains('open')) { d.hidden = true; d.innerHTML = ''; } }, 230);
    if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) {}
  }

  /* ================= Events ================= */
  document.addEventListener('click', function (e) {
    var nl = e.target.closest('#nav a');
    if (nl) { e.preventDefault(); go(nl.dataset.view); return; }
    var hl = e.target.closest('a[href^="#"]:not([data-action])');
    if (hl && VIEWS[hl.getAttribute('href').slice(1)]) { e.preventDefault(); go(hl.getAttribute('href').slice(1)); return; }
    var a = e.target.closest('[data-action]'); if (!a) return;
    if (a.tagName === 'SELECT' || (a.tagName === 'INPUT' && a.type !== 'button')) return;
    if (a.tagName === 'A' || a.tagName === 'BUTTON' || a.id === 'scrim') e.preventDefault();
    var act = a.dataset.action, id = a.dataset.id, ed = S.ed, sec, list;
    switch (act) {
      case 'menu': $('#app').classList.toggle('nav-open'); break;
      case 'open-publish': openDrawer(publishDrawer()); break;
      case 'close-drawer': closeDrawer(); break;
      case 'publish': doPublish(a); break;
      case 'drop-draft':
        delete S.drafts[a.dataset.path]; saveDrafts(); if (S.ed && S.ed.path === a.dataset.path) S.ed = null;
        $('#drawer').innerHTML = publishDrawer(); if (S.view !== 'dashboard') render(); else render(); break;
      case 'copy': copy(a.dataset.text); break;
      case 'quick-home': S.ed = null; go('pages'); break;
      case 'quick-voucher': go('vouchers'); if (S.vouchers) openDrawer(voucherDrawer(), updateVPrev); break;
      case 'quick-incident': S.incForm = true; go('status'); break;
      case 'quick-maint': S.mntForm = true; go('status'); break;
      case 'quick-media': go('media'); break;
      case 'quick-prices': go('details'); break;
      case 'reload-history': S.history = null; render(); break;
      case 'reload-status': S.status = null; render(); break;
      case 'reload-vouchers': S.vouchers = null; render(); break;

      /* pages */
      case 'pick-page': openPage(a.dataset.path); break;
      case 'reload-page': openPage(ed.path); break;
      case 'ed-tab': ed.tab = a.dataset.tab; $$('[data-action="ed-tab"]').forEach(function (b) { b.setAttribute('aria-selected', String(b === a)); }); rerenderSide(); break;
      case 'ed-w': ed.phone = a.dataset.phone === '1'; $('.ed-frame').classList.toggle('phone', ed.phone); $$('[data-action="ed-w"]').forEach(function (b) { b.setAttribute('aria-pressed', String(b === a)); }); break;
      case 'revert-page': delete S.drafts[ed.path]; saveDrafts(); openPage(ed.path); toast('Changes to ' + pageName(ed.path) + ' undone'); break;
      case 'sec-go': ed.cur = ed.cur === id ? null : id; ed.confirmDel = null; rerenderSide(); flashSection(id); break;
      case 'sec-up': moveSection(id, -1); break;
      case 'sec-down': moveSection(id, 1); break;
      case 'sec-hide':
        sec = ed.doc.querySelector('[data-cms-s="' + id + '"]');
        if (sec.hasAttribute('hidden')) sec.removeAttribute('hidden'); else sec.setAttribute('hidden', '');
        ed.cur = id; dirty('hide-' + id, (sec.hasAttribute('hidden') ? 'Hid' : 'Showed') + ' “' + secName(sec, 0).replace(/^Hero: /, '') + '”', true); rerenderSide(); loadFrame(id); break;
      case 'sec-bg':
        sec = ed.doc.querySelector('[data-cms-s="' + id + '"]'); sec.classList.toggle('section--mint', a.dataset.bg === 'mint');
        dirty('bg-' + id, 'Changed the background of “' + secName(sec, 0) + '”', true); rerenderSide(); loadFrame(id); break;
      case 'sec-del': ed.confirmDel = id; rerenderSide(); break;
      case 'sec-del-no': ed.confirmDel = null; rerenderSide(); break;
      case 'sec-del-yes':
        sec = ed.doc.querySelector('[data-cms-s="' + id + '"]'); var nm = secName(sec, 0); sec.remove(); ed.confirmDel = null; ed.cur = null; ed.sel = null;
        dirty('del-' + id, 'Removed “' + nm + '”', true); rerenderSide(); loadFrame(); toast('Section removed'); break;
      case 'add-sec':
        var tmp = ed.doc.createElement('div'); tmp.innerHTML = TEMPLATES[a.dataset.kind];
        var ns = tmp.firstElementChild; ed.doc.querySelector('main').appendChild(ed.doc.createTextNode('\n')); ed.doc.querySelector('main').appendChild(ns);
        tagDoc(ed.doc); var nid = ns.getAttribute('data-cms-s'); ed.cur = nid;
        dirty('add-' + nid, 'Added a “' + a.querySelector('strong').textContent + '” section', true); rerenderSide(); loadFrame(nid); break;
      case 'sel-close': ed.sel = null; var fd = frameDoc(); if (fd) $$('.cms-sel', fd).forEach(function (x) { x.classList.remove('cms-sel'); }); rerenderSide(); break;
      case 'sel-img': setImage(a.dataset.src); break;
      case 'sel-href-save':
        var href = $('#sel-href').value.trim();
        if (!/^(\/|#|https:\/\/|http:\/\/|mailto:|tel:)/.test(href)) { $('#sel-err').textContent = 'Start with / for a page on this site, or https:// for another website.'; return; }
        var sa = ed.doc.querySelector('[data-cms-a="' + ed.sel.id + '"]'); sa.setAttribute('href', href);
        var fa = frameDoc() && frameDoc().querySelector('[data-cms-a="' + ed.sel.id + '"]'); if (fa) fa.setAttribute('href', href);
        dirty('href-' + ed.sel.id, 'Changed where “' + sa.textContent.replace(/\s+/g, ' ').trim().slice(0, 30) + '” links to', true); toast('Link updated'); break;

      /* media */
      case 'pick-media': openDrawer(mediaDrawer(a.dataset.path)); checkUsage(a.dataset.path); break;
      case 'm-del':
        busy(a, true);
        api('remove-image', { method: 'POST', body: { path: a.dataset.path } }).then(loadFiles).then(function () { closeDrawer(); render(); toast('Image deleted'); }).catch(function (er) { busy(a, false); toast(er.message, true); }); break;

      /* find and replace */
      case 'f-preset': $('#f-q').value = a.dataset.q; S.find.q = a.dataset.q; $('#f-r').focus(); break;
      case 'f-search': runFind(); break;
      case 'f-all': S.find.results.forEach(function (p) { p.matches.forEach(function (m) { m.on = a.dataset.on === '1'; }); }); S.find.r = $('#f-r').value; render(); break;
      case 'f-apply': applyReplace(); break;

      /* vouchers */
      case 'v-new': openDrawer(voucherDrawer(), updateVPrev); break;
      case 'v-edit': openDrawer(voucherDrawer(S.vouchers.find(function (v) { return v.hash === id; })), updateVPrev); break;
      case 'v-gen': $('#v-code').value = genCode(); updateVPrev(); break;
      case 'v-type':
        $('#v-type').value = a.dataset.t; $$('[data-action="v-type"]').forEach(function (b) { b.setAttribute('aria-pressed', String(b === a)); });
        $('#v-value-l').textContent = a.dataset.t === 'percent' ? 'Percentage' : 'Amount (£)'; $('#v-value').step = a.dataset.t === 'percent' ? '1' : '0.01'; $('#v-value').value = a.dataset.t === 'percent' ? 10 : 25; updateVPrev(); break;
      case 'v-save': saveVoucherForm(a); break;
      case 'v-filter': S.vFilter = a.dataset.f; render(); break;
      case 'v-del': S.vConfirm = id; render(); break;
      case 'v-del-no': S.vConfirm = null; render(); break;
      case 'v-del-yes':
        var dv = S.vouchers.find(function (v) { return v.hash === id; }); busy(a, true);
        saveVouchers(S.vouchers.filter(function (v) { return v.hash !== id; }), 'Delete voucher ' + (dv.code || '')).then(function () { S.vConfirm = null; render(); toast((dv.code || 'Code') + ' deleted'); }).catch(function (er) { busy(a, false); toast(er.message, true); }); break;

      /* status */
      case 'st-allok': S.statusDraft.components.forEach(function (c) { c.status = 'operational'; }); render(); break;
      case 'st-discard': S.statusDraft = clone(S.status); S.incForm = S.mntForm = false; S.updFor = null; render(); toast('Status changes discarded'); break;
      case 'st-publish':
        var draft = clone(S.statusDraft); draft.updated = nowIso(); busy(a, true);
        api('publish', { method: 'POST', body: { message: 'System status: ' + overall(draft).label.toLowerCase(), files: [{ path: 'assets/data/status.json', content: statusForSave(draft), baseSha: S.statusSha }] } })
          .then(function () { return loadStatus(); }).then(function () { S.history = null; render(); toast('Status page updated. Live in about a minute.'); })
          .catch(function (er) { busy(a, false); toast(er.status === 409 ? 'Someone else updated the status just now. Discard your changes and try again.' : er.message, true); }); break;
      case 'inc-new': S.incForm = true; render(); setTimeout(function () { $('#inc-title').focus(); }, 0); break;
      case 'inc-cancel': S.incForm = false; render(); break;
      case 'inc-add':
        var title = $('#inc-title').value.trim(), msg = $('#inc-msg').value.trim(), svcs = $$('input[name="inc-svc"]:checked').map(function (x) { return x.value; });
        if (!title) { $('#inc-err').textContent = 'Say what is happening, in a few words.'; $('#inc-title').focus(); return; }
        if (!svcs.length) { $('#inc-err').textContent = 'Choose at least one affected service.'; return; }
        if (!msg) { $('#inc-err').textContent = 'Write a short message for customers.'; $('#inc-msg').focus(); return; }
        var impact = $('#inc-impact').value, ist = $('#inc-status').value;
        S.statusDraft.incidents.unshift({ _id: uid(), title: title, status: ist, impact: impact, components: svcs, updates: [{ time: nowIso(), status: ist, message: msg }] });
        S.statusDraft.components.forEach(function (c) { if (svcs.indexOf(c.name) > -1) c.status = impact === 'major' ? 'major_outage' : 'degraded'; });
        S.incForm = false; render(); toast('Incident added. Press Publish status to show it.'); break;
      case 'upd-open': S.updFor = id; render(); setTimeout(function () { $('#upd-msg').focus(); }, 0); break;
      case 'upd-cancel': S.updFor = null; render(); break;
      case 'upd-add':
        var um = $('#upd-msg').value.trim(); if (!um) { $('#upd-err').textContent = 'Write a short update for customers.'; $('#upd-msg').focus(); return; }
        var inc = S.statusDraft.incidents.find(function (x) { return x._id === id; }), us = $('#upd-st').value;
        inc.updates.unshift({ time: nowIso(), status: us, message: um }); inc.status = us;
        if (us === 'resolved') S.statusDraft.components.forEach(function (c) { if (inc.components.indexOf(c.name) > -1) c.status = 'operational'; });
        S.updFor = null; render(); break;
      case 'inc-resolve':
        var ri = S.statusDraft.incidents.find(function (x) { return x._id === id; });
        ri.status = 'resolved'; ri.updates.unshift({ time: nowIso(), status: 'resolved', message: 'This is now fixed and everything is working normally. Thanks for your patience.' });
        S.statusDraft.components.forEach(function (c) { if (ri.components.indexOf(c.name) > -1) c.status = 'operational'; });
        render(); toast('Marked as fixed. Press Publish status to show it.'); break;
      case 'mnt-new': S.mntForm = true; render(); setTimeout(function () { $('#mnt-title').focus(); }, 0); break;
      case 'mnt-cancel': S.mntForm = false; render(); break;
      case 'mnt-add':
        var mt = $('#mnt-title').value.trim(), ms = $('#mnt-start').value, me = $('#mnt-end').value, msv = $$('input[name="mnt-svc"]:checked').map(function (x) { return x.value; });
        if (!mt) { $('#mnt-err').textContent = 'Give the maintenance a title.'; $('#mnt-title').focus(); return; }
        if (!ms || !me) { $('#mnt-err').textContent = 'Choose a start and end time.'; return; }
        if (me <= ms) { $('#mnt-err').textContent = 'The end time must be after the start time.'; return; }
        if (!msv.length) { $('#mnt-err').textContent = 'Choose at least one affected service.'; return; }
        var iso = function (v) { var d = new Date(v), off = -d.getTimezoneOffset(), p = function (n) { return String(Math.abs(n)).padStart(2, '0'); }; return v + ':00' + (off >= 0 ? '+' : '-') + p(Math.floor(Math.abs(off) / 60)) + ':' + p(Math.abs(off) % 60); };
        S.statusDraft.maintenance.push({ _id: uid(), title: mt, status: 'scheduled', start: iso(ms), end: iso(me), components: msv, message: $('#mnt-msg').value.trim() });
        S.mntForm = false; render(); toast('Maintenance added. Press Publish status to show it.'); break;
      case 'mnt-done': S.statusDraft.maintenance.find(function (x) { return x._id === id; }).status = 'completed'; render(); break;
      case 'mnt-del': S.statusDraft.maintenance = S.statusDraft.maintenance.filter(function (x) { return x._id !== id; }); render(); break;
    }
  });

  function setImage(src) {
    var ed = S.ed, img = ed.doc.querySelector('[data-cms-i="' + ed.sel.id + '"]'); if (!img) return;
    img.setAttribute('src', src); img.removeAttribute('srcset');
    var fi = frameDoc() && frameDoc().querySelector('[data-cms-i="' + ed.sel.id + '"]');
    if (fi) {
      fi.removeAttribute('srcset'); fi.dataset.triedRaw = '';
      fi.onload = function () { if (fi.naturalWidth && img.hasAttribute('width')) { img.setAttribute('width', fi.naturalWidth); img.setAttribute('height', fi.naturalHeight); dirty('img-' + ed.sel.id, 'Swapped a photo for ' + src.split('/').pop(), true); } };
      fi.src = src;
    }
    dirty('img-' + ed.sel.id, 'Swapped a photo for ' + src.split('/').pop(), true);
    rerenderSide();
  }

  document.addEventListener('change', function (e) {
    var t = e.target, act = t.dataset.action;
    if (act === 'pick-page-m') { openPage(t.value); return; }
    if (act === 'svc') { S.statusDraft.components[+t.dataset.i].status = t.value; render(); var el = $('#svc-' + t.dataset.i); if (el) el.focus(); return; }
    if (act === 'v-toggle') {
      var list = clone(S.vouchers), v = list.find(function (x) { return x.hash === t.dataset.id; }); v.active = t.checked; t.disabled = true;
      saveVouchers(list, (v.active ? 'Turn on voucher ' : 'Pause voucher ') + (v.code || '')).then(function () { render(); toast((v.code || 'Code') + (v.active ? ' turned on' : ' paused') + '. Live in about a minute.'); }).catch(function (er) { t.checked = !t.checked; t.disabled = false; toast(er.message, true); });
      return;
    }
    if (act === 'upload') { uploadFiles(t.files).then(function () { if (S.view === 'media') render(); }); t.value = ''; return; }
    if (act === 'sel-upload') { var f = t.files; uploadFiles(f).then(function (paths) { if (paths[0] && S.ed && S.ed.sel) setImage('/' + paths[0]); }); t.value = ''; return; }
    if (t.id === 'sel-dec') {
      $('#sel-alt-f').hidden = t.checked;
      if (t.checked) setAlt(''); else $('#sel-alt').focus();
      return;
    }
    if (t.dataset.action === 'f-tick') { S.find.results[+t.dataset.p].matches[+t.dataset.m].on = t.checked; S.find.r = $('#f-r').value; render(); return; }
  });
  function setAlt(v) {
    var ed = S.ed, img = ed.doc.querySelector('[data-cms-i="' + ed.sel.id + '"]'); if (!img) return;
    img.setAttribute('alt', v);
    var fi = frameDoc() && frameDoc().querySelector('[data-cms-i="' + ed.sel.id + '"]'); if (fi) fi.setAttribute('alt', v);
    dirty('alt-' + ed.sel.id, v ? 'Described a photo as “' + v.slice(0, 40) + '”' : 'Marked a photo as decorative');
  }

  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.id === 'sel-alt') { setAlt(t.value.trim()); return; }
    if (t.dataset.seo && S.ed) {
      var ed = S.ed, max = t.dataset.seo === 'title' ? 60 : 155;
      if (t.dataset.seo === 'title') { ed.doc.title = t.value; $('#g-title').textContent = t.value.length > 62 ? t.value.slice(0, 60) + '…' : t.value; }
      else { ed.doc.querySelector('meta[name="description"]').setAttribute('content', t.value); $('#g-desc').textContent = t.value.length > 158 ? t.value.slice(0, 155) + '…' : t.value; }
      var c = $('[data-count="' + t.id + '"]'); c.textContent = t.value.length + ' / ' + max; c.className = t.value.length > max ? 'over' : '';
      dirty('seo-' + t.dataset.seo, t.dataset.seo === 'title' ? 'Changed the page title' : 'Changed the Google description');
      return;
    }
    if (t.closest('#v-form')) { if (t.id === 'v-code') { var pos = t.selectionStart; t.value = t.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); try { t.setSelectionRange(pos, pos); } catch (x) {} } $('#v-err').textContent = ''; updateVPrev(); }
    if (t.closest('#inc-form')) $('#inc-err').textContent = '';
    if (t.closest('#mnt-form')) $('#mnt-err').textContent = '';
  });
  document.addEventListener('submit', function (e) { if (e.target.id === 'find-form') { e.preventDefault(); runFind(); } else if (e.target.closest('#view, #drawer')) e.preventDefault(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { if ($('#drawer').classList.contains('open')) closeDrawer(); else $('#app').classList.remove('nav-open'); }
    if (e.key === 'Enter' && (e.target.id === 'f-q' || e.target.id === 'f-r')) { e.preventDefault(); runFind(); }
  });
  /* Newly uploaded images take a minute to reach the live site, so show them from GitHub until then. */
  document.addEventListener('error', function (e) { var t = e.target; if (t.tagName === 'IMG' && t.dataset.raw && t.src !== t.dataset.raw) t.src = t.dataset.raw; }, true);
  document.addEventListener('dragover', function (e) { var d = e.target.closest && e.target.closest('#drop'); if (d) { e.preventDefault(); d.classList.add('over-zone'); } });
  document.addEventListener('dragleave', function (e) { var d = e.target.closest && e.target.closest('#drop'); if (d) d.classList.remove('over-zone'); });
  document.addEventListener('drop', function (e) { var d = e.target.closest && e.target.closest('#drop'); if (d && e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); d.classList.remove('over-zone'); uploadFiles(e.dataTransfer.files).then(function () { if (S.view === 'media') render(); }); } });
  window.addEventListener('hashchange', function () { var h = location.hash.slice(1); if (VIEWS[h] && h !== S.view) go(h); });
  window.addEventListener('beforeunload', function () { clearTimeout(dirtyT); if (S.ed && S.ed.doc) { try { var c = serialize(); if (c !== S.ed.baseline || S.drafts[S.ed.path]) { var d = S.drafts[S.ed.path] || { baseSha: S.ed.sha, baseline: S.ed.baseline, notes: { edit: 'Edited ' + pageName(S.ed.path) } }; d.content = c; if (c !== d.baseline) { S.drafts[S.ed.path] = d; localStorage.setItem(DRAFT_KEY(), JSON.stringify(S.drafts)); } } } catch (x) {} } });

  /* ================= Start ================= */
  api('me').then(function (me) {
    S.me = me;
    loadDrafts();
    $('#me-name').textContent = me.user.name; $('#me-email').textContent = me.user.email; $('#me-initials').textContent = initials(me.user.name);
    $$('[data-perm]').forEach(function (el) { el.hidden = !me.user.perms[el.dataset.perm]; });
    go(location.hash.slice(1) || 'dashboard');
    if (can('status')) loadStatus().catch(function () {});
  }).catch(function (e) {
    if (e.message !== 'Signed out') $('#view').innerHTML = errorBlock(e);
  });
})();
