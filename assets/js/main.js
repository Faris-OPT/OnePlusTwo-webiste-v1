/* OnePlusTwo website scripts */
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
})();
