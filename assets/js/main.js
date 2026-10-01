/* OnePlusTwo website scripts */

/* ---------- Site settings ----------
   Paste IDs here to switch services on. They only load for visitors who allow them in the cookie banner.
   gaId:    Google Analytics 4 measurement ID, for example 'G-ABC123XYZ9'
   tawkSrc: tawk.to embed address from the widget code, for example 'https://embed.tawk.to/1234abcd/1abc234' */
var OPT_CONFIG = {
  /* Formspree form for hardware orders. Create a form whose emails go to accounts@oneplustwo.co.uk,
     turn on its autoresponse with the Viva payment link, and paste its ID here (the part after /f/). */
  orderFormId: 'xrpbvovl',
  gaId: '',
  tawkSrc: 'https://embed.tawk.to/67a89ba1825083258e127105/1ijl9vrnr'
};
(function () {
  'use strict';

  /* ---------- Mobile menu ---------- */
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('main-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      toggle.setAttribute('aria-label', open ? 'Open menu' : 'Close menu');
      nav.classList.toggle('is-open', !open);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('is-open')) {
        nav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'Open menu');
        toggle.focus();
      }
    });
  }

  /* ---------- Enquiry form (Formspree) ---------- */
  var form = document.getElementById('enquiry-form');
  if (form) {
    var status = form.querySelector('.form-status');
    var submitBtn = form.querySelector('button[type="submit"]');

    var messages = {
      valueMissing: 'Please fill in this field.',
      typeMismatch: 'Please enter a valid email address.'
    };

    function showFieldError(input) {
      var error = document.getElementById(input.id + '-error');
      if (!error) return;
      if (input.validity.valid) {
        input.removeAttribute('aria-invalid');
        error.textContent = '';
      } else {
        input.setAttribute('aria-invalid', 'true');
        error.textContent = input.validity.valueMissing ? messages.valueMissing : messages.typeMismatch;
      }
    }

    form.querySelectorAll('input[required], textarea[required], input[type="email"]').forEach(function (input) {
      input.addEventListener('blur', function () { if (input.value) showFieldError(input); });
      input.addEventListener('input', function () { if (input.getAttribute('aria-invalid')) showFieldError(input); });
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      status.textContent = '';
      status.classList.remove('form-status--error');

      var firstInvalid = null;
      form.querySelectorAll('input, textarea, select').forEach(function (input) {
        if (input.name === '_gotcha') return;
        showFieldError(input);
        if (!input.validity.valid && !firstInvalid) firstInvalid = input;
      });
      if (firstInvalid) {
        status.textContent = 'Please check the highlighted fields.';
        status.classList.add('form-status--error');
        firstInvalid.focus();
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending…';

      fetch(form.action, {
        method: 'POST',
        body: new FormData(form),
        headers: { Accept: 'application/json' }
      })
        .then(function (response) {
          if (response.ok) {
            var success = document.getElementById('enquiry-success');
            form.hidden = true;
            success.hidden = false;
            success.focus();
            return;
          }
          return response.json().then(function (data) {
            var msg = data && data.errors ? data.errors.map(function (err) { return err.message; }).join(' ') : '';
            throw new Error(msg);
          });
        })
        .catch(function (err) {
          status.textContent = (err && err.message ? err.message + ' ' : '') +
            'Sorry, your enquiry didn\u2019t send. Please try again, or call us on +44 24 7775 2650.';
          status.classList.add('form-status--error');
        })
        .finally(function () {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Send enquiry';
        });
    });
  }

  /* ---------- Blog category filter ---------- */
  var filters = document.querySelectorAll('[data-filter]');
  if (filters.length) {
    var posts = document.querySelectorAll('[data-category]');
    filters.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var cat = btn.getAttribute('data-filter');
        filters.forEach(function (b) { b.setAttribute('aria-pressed', String(b === btn)); });
        posts.forEach(function (post) {
          post.hidden = !(cat === 'all' || post.getAttribute('data-category') === cat);
        });
      });
    });
  }

  /* ---------- Option pickers (e.g. kiosk installation, screen size) ---------- */
  document.querySelectorAll('[data-picker]').forEach(function (picker) {
    var tabs = Array.prototype.slice.call(picker.querySelectorAll('[role="tab"]'));
    function select(tab, focus) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
      });
      if (focus) tab.focus();
    }
    tabs.forEach(function (tab, i) {
      tab.addEventListener('click', function () { select(tab, false); });
      tab.addEventListener('keydown', function (e) {
        var next = null;
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
        if (e.key === 'Home') next = tabs[0];
        if (e.key === 'End') next = tabs[tabs.length - 1];
        if (next) { e.preventDefault(); select(next, true); }
      });
    });
  });

  /* ---------- Timeline scroll animation (Why us?) ---------- */
  var timeline = document.querySelector('[data-timeline]');
  if (timeline) {
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var progress = timeline.querySelector('.timeline-progress');
    var milestones = Array.prototype.slice.call(timeline.querySelectorAll('.milestone'));

    if (reduce || !('IntersectionObserver' in window)) {
      progress.style.height = '100%';
      milestones.forEach(function (m) { m.classList.add('is-visible', 'is-reached'); });
    } else {
      timeline.classList.add('is-animated');
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) { entry.target.classList.add('is-visible'); io.unobserve(entry.target); }
        });
      }, { rootMargin: '0px 0px -12% 0px', threshold: 0.15 });
      milestones.forEach(function (m) { io.observe(m); });

      var ticking = false;
      var update = function () {
        ticking = false;
        var rect = timeline.getBoundingClientRect();
        var marker = window.innerHeight * 0.6;
        var filled = Math.max(0, Math.min(rect.height, marker - rect.top));
        progress.style.height = filled + 'px';
        milestones.forEach(function (m) {
          var dot = m.querySelector('.milestone-dot').getBoundingClientRect();
          m.classList.toggle('is-reached', dot.top + dot.height / 2 <= marker);
        });
      };
      window.addEventListener('scroll', function () {
        if (!ticking) { ticking = true; window.requestAnimationFrame(update); }
      }, { passive: true });
      window.addEventListener('resize', update);
      update();
    }
  }

  /* ---------- Seasonal content (homepage) ----------
     Halloween wording shows January to October, Christmas wording in November and December. */
  var seasonal = document.querySelectorAll('[data-season]');
  if (seasonal.length) {
    var month = new Date().getMonth(); // 0 = January, 10 = November
    var season = month >= 10 ? 'christmas' : 'halloween';
    seasonal.forEach(function (el) { el.hidden = el.getAttribute('data-season') !== season; });
  }

  /* ---------- Cookie consent ---------- */
  var CONSENT_KEY = 'opt-cookie-consent';
  var CATEGORIES = [
    { key: 'analytics', label: 'Analytics', desc: 'Google Analytics, to understand how the site is used.' },
    { key: 'chat', label: 'Live chat', desc: 'tawk.to, so you can chat with our team.' },
    { key: 'booking', label: 'Demo booking', desc: 'Calendly, which runs our booking calendar.' }
  ];

  function readConsent() {
    try { var c = JSON.parse(localStorage.getItem(CONSENT_KEY)); return c && c.v === 1 ? c : null; } catch (e) { return null; }
  }
  function writeConsent(c) {
    c.v = 1; c.date = new Date().toISOString();
    try { localStorage.setItem(CONSENT_KEY, JSON.stringify(c)); } catch (e) {}
  }

  var loaded = {};
  function loadScript(src, attrs) {
    var el = document.createElement('script');
    el.async = true; el.src = src;
    if (attrs) Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    document.body.appendChild(el);
  }
  function loadAnalytics() {
    if (loaded.analytics || !OPT_CONFIG.gaId) return;
    loaded.analytics = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', OPT_CONFIG.gaId);
    loadScript('https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(OPT_CONFIG.gaId));
  }
  function loadChat() {
    if (loaded.chat || !OPT_CONFIG.tawkSrc) return;
    loaded.chat = true;
    window.Tawk_API = window.Tawk_API || {};
    window.Tawk_LoadStart = new Date();
    loadScript(OPT_CONFIG.tawkSrc, { charset: 'UTF-8', crossorigin: '*' });
  }
  var calWidget = document.querySelector('[data-calendly-url]');
  var calGate = document.querySelector('[data-calendly-gate]');
  function loadBooking() {
    if (loaded.booking || !calWidget) return;
    loaded.booking = true;
    if (calGate) calGate.hidden = true;
    calWidget.hidden = false;
    calWidget.setAttribute('data-url', calWidget.getAttribute('data-calendly-url'));
    loadScript('https://assets.calendly.com/assets/external/widget.js');
  }
  function applyConsent(c) {
    if (c && c.analytics) loadAnalytics();
    if (c && c.chat) loadChat();
    if (c && c.booking) { loadBooking(); }
    else if (calWidget && calGate) { calWidget.hidden = true; calGate.hidden = false; }
  }
  function clearAnalyticsCookies() {
    document.cookie.split(';').forEach(function (part) {
      var name = part.split('=')[0].trim();
      if (/^_ga/.test(name)) {
        var host = location.hostname.replace(/^www\./, '');
        ['', '; domain=.' + host, '; domain=' + location.hostname].forEach(function (d) {
          document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' + d;
        });
      }
    });
  }

  var banner = null;
  function buildBanner() {
    banner = document.createElement('div');
    banner.className = 'cookie-banner';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Cookie choices');
    var opts = CATEGORIES.map(function (cat) {
      return '<label class="cookie-option"><input type="checkbox" name="' + cat.key + '"><span><strong>' + cat.label + '</strong> ' + cat.desc + '</span></label>';
    }).join('');
    banner.innerHTML =
      '<div class="cookie-inner">' +
        '<h2 class="cookie-title" tabindex="-1">Cookies on this website</h2>' +
        '<p>We\u2019d like to use cookies for live chat, our booking calendar and to understand how the site is used. You can accept them all, reject them or choose which to allow. <a href="/privacy-policy#cookies">More about cookies</a></p>' +
        '<fieldset class="cookie-options" hidden><legend class="visually-hidden">Choose cookies</legend>' + opts + '</fieldset>' +
        '<div class="cookie-actions">' +
          '<button type="button" class="btn btn--dark" data-consent="accept">Accept all</button>' +
          '<button type="button" class="btn btn--dark" data-consent="reject">Reject all</button>' +
          '<button type="button" class="btn btn--outline" data-consent="choose">Choose cookies</button>' +
          '<button type="button" class="btn btn--primary" data-consent="save" hidden>Save my choices</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(banner);
    banner.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-consent]');
      if (!btn) return;
      var action = btn.getAttribute('data-consent');
      if (action === 'choose') { openOptions(); return; }
      var next = { analytics: false, chat: false, booking: false };
      if (action === 'accept') next = { analytics: true, chat: true, booking: true };
      if (action === 'save') CATEGORIES.forEach(function (cat) { next[cat.key] = banner.querySelector('input[name="' + cat.key + '"]').checked; });
      saveChoice(next);
    });
  }
  function openOptions() {
    var c = readConsent() || {};
    CATEGORIES.forEach(function (cat) { banner.querySelector('input[name="' + cat.key + '"]').checked = !!c[cat.key]; });
    banner.querySelector('.cookie-options').hidden = false;
    banner.querySelector('[data-consent="choose"]').hidden = true;
    banner.querySelector('[data-consent="save"]').hidden = false;
  }
  function showBanner(withOptions) {
    if (!banner) buildBanner();
    banner.hidden = false;
    if (withOptions) openOptions();
    banner.querySelector('.cookie-title').focus();
  }
  function saveChoice(next) {
    var prev = readConsent() || {};
    writeConsent(next);
    banner.hidden = true;
    if (!next.analytics) clearAnalyticsCookies();
    var turnedOff = (prev.analytics && !next.analytics) || (prev.chat && !next.chat) || (prev.booking && !next.booking);
    if (turnedOff) { window.location.reload(); return; }
    applyConsent(next);
  }

  var stored = readConsent();
  applyConsent(stored);
  if (!stored) showBanner(false);
  document.querySelectorAll('[data-cookie-settings]').forEach(function (el) {
    el.addEventListener('click', function () { showBanner(true); });
  });
  document.querySelectorAll('[data-calendly-load]').forEach(function (el) {
    el.addEventListener('click', function () {
      var c = readConsent() || { analytics: false, chat: false };
      c.booking = true; writeConsent(c); loadBooking();
    });
  });

  /* ---------- Product option switches (Hardware page) ---------- */
  document.querySelectorAll('[data-variants]').forEach(function (card) {
    var img = card.querySelector('.till-img img');
    var btns = card.querySelectorAll('.variant-btn');
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        btns.forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        img.src = b.getAttribute('data-src');
        img.alt = b.getAttribute('data-alt');
      });
    });
  });

  /* ---------- Hardware shop: basket and checkout ---------- */
  var shop = document.querySelector('[data-basket-items]');
  if (shop) {
    var BASKET_KEY = 'opt-basket';
    var DELIVERY = 465; // pence, flat price including VAT
    var VAT_RATE = 0.2;
    var money = function (p) { return '£' + (p / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var load = function () { try { return JSON.parse(localStorage.getItem(BASKET_KEY)) || []; } catch (e) { return []; } };
    var save = function (b) { try { localStorage.setItem(BASKET_KEY, JSON.stringify(b)); } catch (e) {} };
    var basket = load();
    var statusEl = document.querySelector('[data-basket-status]');
    var totalsEl = document.querySelector('[data-basket-totals]');
    var checkoutLink = document.querySelector('[data-checkout-link]');
    var checkout = document.querySelector('[data-checkout]');
    var review = document.querySelector('[data-order-review]');

    function totals() {
      var sub = basket.reduce(function (t, i) { return t + i.price * i.qty; }, 0);
      var del = basket.length ? DELIVERY : 0;
      var vat = Math.round(sub * VAT_RATE); // VAT on products only; delivery is a flat £4.65
      return { sub: sub, del: del, vat: vat, total: sub + del + vat };
    }
    function label(i) { return i.name + (i.option ? ' (' + i.option + ')' : ''); }
    function render() {
      if (!basket.length) {
        shop.innerHTML = '<p class="small">Your basket is empty.</p>';
        totalsEl.hidden = true; checkoutLink.hidden = true; checkout.hidden = true;
        return;
      }
      shop.innerHTML = basket.map(function (i, idx) {
        return '<div class="basket-row"><div><strong>' + label(i) + '</strong><span class="small">' + money(i.price) + ' + VAT each</span></div>' +
          '<div class="basket-row-actions"><label class="visually-hidden" for="bq' + idx + '">Quantity of ' + label(i) + '</label>' +
          '<input id="bq' + idx + '" class="basket-qty" type="number" min="1" max="20" value="' + i.qty + '" data-idx="' + idx + '">' +
          '<button type="button" class="link-remove" data-remove="' + idx + '" aria-label="Remove ' + label(i) + '">Remove</button></div></div>';
      }).join('');
      var t = totals();
      totalsEl.querySelector('[data-t="sub"]').textContent = money(t.sub);
      totalsEl.querySelector('[data-t="del"]').textContent = money(t.del);
      totalsEl.querySelector('[data-t="vat"]').textContent = money(t.vat);
      totalsEl.querySelector('[data-t="total"]').textContent = money(t.total);
      totalsEl.hidden = false; checkoutLink.hidden = false; checkout.hidden = false;
      review.innerHTML = '<h3>Order summary</h3><ul>' + basket.map(function (i) { return '<li>' + i.qty + ' × ' + label(i) + '<span>' + money(i.price * i.qty) + '</span></li>'; }).join('') +
        '<li>VAT (20%)<span>' + money(t.vat) + '</span></li><li>Next day delivery<span>' + money(t.del) + '</span></li><li class="order-review-total">Total<span>' + money(t.total) + '</span></li></ul>';
    }
    function announce(msg) { statusEl.textContent = msg; }

    document.querySelectorAll('[data-product]').forEach(function (card) {
      var qty = card.querySelector('.qty-input');
      card.querySelectorAll('.qty-btn').forEach(function (b) {
        b.addEventListener('click', function () {
          qty.value = Math.min(20, Math.max(1, (parseInt(qty.value, 10) || 1) + parseInt(b.getAttribute('data-qty'), 10)));
        });
      });
      card.querySelector('[data-add]').addEventListener('click', function () {
        var opt = card.querySelector('[data-option]');
        var item = { id: card.getAttribute('data-product'), name: card.getAttribute('data-name'), price: parseInt(card.getAttribute('data-price'), 10),
          option: opt ? opt.value : '', qty: Math.min(20, Math.max(1, parseInt(qty.value, 10) || 1)) };
        var existing = basket.filter(function (i) { return i.id === item.id && i.option === item.option; })[0];
        if (existing) existing.qty = Math.min(20, existing.qty + item.qty); else basket.push(item);
        save(basket); render();
        announce(item.qty + ' × ' + label(item) + ' added to your basket.');
        var btnAdd = card.querySelector('[data-add]');
        btnAdd.textContent = 'Added ✓';
        setTimeout(function () { btnAdd.textContent = 'Add to basket'; }, 1600);
      });
    });
    shop.addEventListener('change', function (e) {
      if (e.target.classList.contains('basket-qty')) {
        var i = basket[parseInt(e.target.getAttribute('data-idx'), 10)];
        i.qty = Math.min(20, Math.max(1, parseInt(e.target.value, 10) || 1));
        save(basket); render();
      }
    });
    shop.addEventListener('click', function (e) {
      var r = e.target.closest('[data-remove]');
      if (r) { var removed = basket.splice(parseInt(r.getAttribute('data-remove'), 10), 1)[0]; save(basket); render(); announce(label(removed) + ' removed from your basket.'); }
    });
    render();

    var orderForm = document.getElementById('order-form');
    orderForm.action = 'https://formspree.io/f/' + OPT_CONFIG.orderFormId;
    var oStatus = orderForm.querySelector('.form-status');
    var oBtn = orderForm.querySelector('button[type="submit"]');
    function fieldError(input) {
      var err = document.getElementById(input.id + '-error');
      if (!err) return;
      if (input.validity.valid) { input.removeAttribute('aria-invalid'); err.textContent = ''; }
      else { input.setAttribute('aria-invalid', 'true'); err.textContent = input.type === 'checkbox' ? 'Please tick this box to continue.' : (input.validity.valueMissing ? 'Please fill in this field.' : 'Please check this field.'); }
    }
    orderForm.addEventListener('submit', function (e) {
      e.preventDefault();
      oStatus.textContent = ''; oStatus.classList.remove('form-status--error');
      if (!basket.length) { oStatus.textContent = 'Your basket is empty.'; oStatus.classList.add('form-status--error'); return; }
      var firstBad = null;
      orderForm.querySelectorAll('input, textarea').forEach(function (inp) {
        if (inp.name === '_gotcha' || inp.type === 'hidden' || inp.type === 'radio') return;
        fieldError(inp); if (!inp.validity.valid && !firstBad) firstBad = inp;
      });
      if (firstBad) { oStatus.textContent = 'Please check the highlighted fields.'; oStatus.classList.add('form-status--error'); firstBad.focus(); return; }
      var t = totals();
      var d = new Date();
      var ref = 'OPT-' + String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
      var data = new FormData(orderForm);
      data.set('_subject', 'New hardware order ' + ref + ' (' + money(t.total) + ')');
      data.append('order_reference', ref);
      data.append('items', basket.map(function (i) { return i.qty + ' x ' + label(i) + ' @ ' + money(i.price) + ' = ' + money(i.price * i.qty); }).join('\n'));
      data.append('subtotal_ex_vat', money(t.sub));
      data.append('delivery', money(t.del));
      data.append('vat', money(t.vat));
      data.append('total_inc_vat', money(t.total));
      data.append('payment_link', 'https://pay.vivawallet.com/epos-anytime');
      oBtn.disabled = true; oBtn.textContent = 'Placing order…';
      fetch(orderForm.action, { method: 'POST', body: data, headers: { Accept: 'application/json' } })
        .then(function (res) {
          if (!res.ok) return res.json().then(function (j) { throw new Error(j && j.errors ? j.errors.map(function (x) { return x.message; }).join(' ') : ''); });
          var ok = document.getElementById('order-success');
          ok.querySelector('[data-ref]').textContent = ref;
          ok.querySelector('[data-total]').textContent = money(t.total) + ' including VAT';
          orderForm.hidden = true; ok.hidden = false; ok.focus();
          basket = []; save(basket);
          shop.innerHTML = '<p class="small">Your basket is empty.</p>'; totalsEl.hidden = true; checkoutLink.hidden = true;
        })
        .catch(function (err) {
          oStatus.textContent = (err && err.message ? err.message + ' ' : '') + 'Sorry, your order didn\u2019t go through. Please try again, or call us on +44 24 7775 2650.';
          oStatus.classList.add('form-status--error');
        })
        .finally(function () { oBtn.disabled = false; oBtn.textContent = 'Place order'; });
    });
  }
})();
