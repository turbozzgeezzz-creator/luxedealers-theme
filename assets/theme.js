/* LuxeDealers theme script. No dependencies, no build step.
   Sections: utilities, motion (reveals, parallax, header), drawers, search,
   slideshow, rails, tabs, lookbook, product form and gallery, cart,
   quick view, collection filters, wishlist and recently viewed,
   newsletter popup and offers, localization, small extras. */
(function () {
  'use strict';

  var L = window.Luxe || {};
  var doc = document;
  var root = doc.documentElement;
  var reduceMotion = root.getAttribute('data-motion') === 'off' ||
    (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ---------- Utilities ---------- */
  function $(sel, ctx) { return (ctx || doc).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); }
  function on(el, ev, fn, opts) { if (el) el.addEventListener(ev, fn, opts); }
  function debounce(fn, wait) { var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, wait); }; }
  function parseHTML(html) { return new DOMParser().parseFromString(html, 'text/html'); }
  function announce(msg) { var el = $('#A11yStatus'); if (el) { el.textContent = ''; setTimeout(function () { el.textContent = msg; }, 60); } }
  function storeGet(key, fallback) { try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } }
  function storeSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
  function fetchJSON(url, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, opts.headers || {});
    return fetch(url, opts).then(function (r) {
      return r.json().then(function (data) { if (!r.ok) { var err = new Error(data.description || data.message || 'Request failed'); err.data = data; throw err; } return data; });
    });
  }
  function formatMoney(cents) {
    var fmt = L.moneyFormat || '${{amount}}';
    cents = typeof cents === 'string' ? cents.replace('.', '') : cents;
    function fmtNum(n, dec, th, decSep) {
      n = (n / 100).toFixed(dec);
      var parts = n.split('.');
      return parts[0].replace(/(\d)(?=(\d\d\d)+(?!\d))/g, '$1' + th) + (parts[1] ? decSep + parts[1] : '');
    }
    return fmt.replace(/\{\{\s*(\w+)\s*\}\}/, function (m, key) {
      switch (key) {
        case 'amount_no_decimals': return fmtNum(cents, 0, ',', '.');
        case 'amount_with_comma_separator': return fmtNum(cents, 2, '.', ',');
        case 'amount_no_decimals_with_comma_separator': return fmtNum(cents, 0, '.', ',');
        case 'amount_with_apostrophe_separator': return fmtNum(cents, 2, "'", '.');
        default: return fmtNum(cents, 2, ',', '.');
      }
    });
  }
  var lastFocus = null;
  function trapFocus(container, e) {
    if (e.key !== 'Tab') return;
    var f = $$('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])', container).filter(function (el) { return el.offsetParent !== null; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  var locks = 0;
  function lockScroll() { if (locks++ === 0) { root.style.overflow = 'hidden'; } }
  function unlockScroll() { if (--locks <= 0) { locks = 0; root.style.overflow = ''; } }

  var toastTimer;
  function toast(msg) {
    var t = $('.toast');
    if (!t) { t = doc.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); doc.body.appendChild(t); }
    t.textContent = msg;
    requestAnimationFrame(function () { t.classList.add('is-visible'); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('is-visible'); }, 2800);
  }

  /* ---------- Motion: reveals ---------- */
  function prepareSplit(ctx) {
    $$('[data-split]', ctx).forEach(function (el) {
      if (el.dataset.splitDone) return;
      el.dataset.splitDone = '1';
      var lines = el.innerHTML.split(/<br\s*\/?>/i);
      el.innerHTML = lines.map(function (line, i) { return '<span class="split-line" style="--l:' + i + '"><span>' + line.trim() + '</span></span>'; }).join('');
    });
  }
  var revealObserver = ('IntersectionObserver' in window) ? new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) { en.target.classList.add('is-in'); revealObserver.unobserve(en.target); }
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }) : null;
  function initReveals(ctx) {
    prepareSplit(ctx);
    $$('[data-stagger]', ctx).forEach(function (wrap) {
      $$(':scope > *', wrap).forEach(function (child, i) {
        if (!child.hasAttribute('data-reveal')) child.setAttribute('data-reveal', wrap.dataset.stagger || '');
        child.style.setProperty('--i', i % 8);
      });
    });
    var els = $$('[data-reveal]:not(.is-in), [data-split]:not(.is-in)', ctx);
    if (!revealObserver || reduceMotion) { els.forEach(function (el) { el.classList.add('is-in'); }); return; }
    els.forEach(function (el) { revealObserver.observe(el); });
  }

  /* ---------- Motion: parallax ---------- */
  var parallaxEls = [];
  function collectParallax() { parallaxEls = reduceMotion ? [] : $$('[data-parallax]'); }
  function updateParallax() {
    var vh = window.innerHeight;
    parallaxEls.forEach(function (el) {
      var r = el.parentElement.getBoundingClientRect();
      if (r.bottom < -100 || r.top > vh + 100) return;
      var p = ((r.top + r.height / 2) - vh / 2) / (vh / 2 + r.height / 2);
      el.style.setProperty('--py', Math.max(-1, Math.min(1, p)).toFixed(3));
    });
  }

  /* ---------- Header ---------- */
  var headerWrap = $('.header-wrapper');
  function measureHeader() { if (headerWrap && !headerWrap.classList.contains('is-scrolled')) root.style.setProperty('--header-total', headerWrap.offsetHeight + 'px'); }
  measureHeader();
  on(window, 'resize', debounce(measureHeader, 150));
  var toTop = $('.to-top');
  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      var y = window.scrollY;
      var max = doc.documentElement.scrollHeight - window.innerHeight;
      var prog = max > 0 ? y / max : 0;
      if (headerWrap) {
        headerWrap.classList.toggle('is-scrolled', y > 40);
        headerWrap.style.setProperty('--progress', prog.toFixed(4));
      }
      if (toTop) { toTop.classList.toggle('is-visible', y > window.innerHeight * 1.2); toTop.style.setProperty('--progress', prog.toFixed(4)); }
      updateParallax();
      ticking = false;
    });
  }
  on(window, 'scroll', onScroll, { passive: true });
  on(window, 'resize', debounce(onScroll, 100));
  on(toTop, 'click', function () { window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }); });

  // Mega menu: hover opens via CSS; this adds click/keyboard support on touch.
  $$('.nav-item[data-has-mega]').forEach(function (item) {
    var link = $('.nav-link', item);
    on(link, 'click', function (e) {
      if (window.matchMedia('(hover: hover)').matches) return;
      if (!item.classList.contains('is-open')) { e.preventDefault(); $$('.nav-item.is-open').forEach(function (o) { o.classList.remove('is-open'); }); item.classList.add('is-open'); link.setAttribute('aria-expanded', 'true'); }
    });
    on(item, 'mouseenter', function () { link.setAttribute('aria-expanded', 'true'); headerWrap && headerWrap.classList.add('is-open'); });
    on(item, 'mouseleave', function () { link.setAttribute('aria-expanded', 'false'); item.classList.remove('is-open'); headerWrap && headerWrap.classList.remove('is-open'); });
    on(item, 'focusin', function () { headerWrap && headerWrap.classList.add('is-open'); });
    on(item, 'focusout', function (e) { if (!item.contains(e.relatedTarget)) { item.classList.remove('is-open'); link.setAttribute('aria-expanded', 'false'); headerWrap && headerWrap.classList.remove('is-open'); } });
    $$('.mega__links li', item).forEach(function (li, i) { li.style.setProperty('--i', i % 12); });
  });
  on(doc, 'keydown', function (e) { if (e.key === 'Escape') $$('.nav-item.is-open').forEach(function (o) { o.classList.remove('is-open'); }); });

  /* ---------- Announcement rotator ---------- */
  $$('[data-rotator]').forEach(function (wrap) {
    var msgs = $$('.announcement__msg', wrap);
    if (msgs.length < 2) { if (msgs[0]) msgs[0].classList.add('is-active'); return; }
    var i = 0, delay = (parseInt(wrap.dataset.rotator, 10) || 5) * 1000;
    msgs[0].classList.add('is-active');
    var paused = false;
    on(wrap, 'mouseenter', function () { paused = true; });
    on(wrap, 'mouseleave', function () { paused = false; });
    setInterval(function () {
      if (paused || doc.hidden) return;
      var cur = msgs[i]; i = (i + 1) % msgs.length; var next = msgs[i];
      cur.classList.remove('is-active'); cur.classList.add('is-leaving');
      next.classList.remove('is-leaving'); next.classList.add('is-active');
      setTimeout(function () { cur.classList.remove('is-leaving'); }, 900);
    }, delay);
  });

  /* ---------- Drawers ---------- */
  function openDrawer(id, trigger) {
    var d = doc.getElementById(id);
    if (!d || d.classList.contains('is-open')) return;
    lastFocus = trigger || doc.activeElement;
    d.classList.add('is-open');
    d.setAttribute('aria-hidden', 'false');
    $$('.drawer__body > *', d).forEach(function (c, i) { c.style.setProperty('--i', Math.min(i, 8)); });
    lockScroll();
    var focusTarget = $('[data-autofocus]', d) || $('.drawer__panel, .search-overlay__panel, .popup__card', d);
    setTimeout(function () { focusTarget && focusTarget.focus({ preventScroll: true }); }, 80);
    $$('[data-drawer-open="' + id + '"]').forEach(function (b) { b.setAttribute('aria-expanded', 'true'); });
  }
  function closeDrawer(d) {
    if (!d || !d.classList.contains('is-open')) return;
    d.classList.remove('is-open');
    d.setAttribute('aria-hidden', 'true');
    unlockScroll();
    $$('[data-drawer-open="' + d.id + '"]').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }
  on(doc, 'click', function (e) {
    var opener = e.target.closest('[data-drawer-open]');
    if (opener) { e.preventDefault(); openDrawer(opener.getAttribute('data-drawer-open'), opener); return; }
    var closer = e.target.closest('[data-drawer-close]');
    if (closer) { e.preventDefault(); closeDrawer(closer.closest('.drawer, .search-overlay, .popup')); }
  });
  on(doc, 'keydown', function (e) {
    var open = $$('.drawer.is-open, .search-overlay.is-open, .popup.is-open').pop();
    if (!open) return;
    if (e.key === 'Escape') closeDrawer(open);
    else trapFocus(open, e);
  });

  /* ---------- Predictive search ---------- */
  (function () {
    var wrap = $('#SearchOverlay');
    if (!wrap) return;
    var input = $('input[type="search"]', wrap);
    var results = $('[data-predictive]', wrap);
    var defaults = $('[data-search-defaults]', wrap);
    var ctrl;
    var run = debounce(function () {
      var q = input.value.trim();
      if (q.length < 2) { results.innerHTML = ''; results.hidden = true; if (defaults) defaults.hidden = false; return; }
      if (ctrl) ctrl.abort();
      ctrl = 'AbortController' in window ? new AbortController() : null;
      fetch(L.routes.predictiveSearch + '?q=' + encodeURIComponent(q) + '&resources[type]=product,collection,query,article&resources[limit]=8&section_id=predictive-search', ctrl ? { signal: ctrl.signal } : {})
        .then(function (r) { return r.text(); })
        .then(function (html) {
          var d = parseHTML(html);
          var content = $('#predictive-search-results', d);
          results.innerHTML = content ? content.innerHTML : '';
          results.hidden = false;
          if (defaults) defaults.hidden = true;
          initReveals(results);
        }).catch(function () {});
    }, 220);
    on(input, 'input', run);
  })();

  /* ---------- Hero slideshow ---------- */
  $$('[data-slideshow]').forEach(function (hero) {
    var slides = $$('.hero__slide', hero);
    var dots = $$('.hero__dot', hero);
    var pauseBtn = $('[data-slideshow-pause]', hero);
    var autoplay = hero.dataset.autoplay === 'true' && slides.length > 1 && !reduceMotion;
    var speed = (parseInt(hero.dataset.speed, 10) || 7) * 1000;
    hero.style.setProperty('--autoplay', (speed / 1000) + 's');
    var index = 0, timer = null, paused = false;
    function playVideo(slide, play) { $$('video', slide).forEach(function (v) { if (play) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } else v.pause(); }); }
    function go(n, user) {
      if (n === index && slides[n].classList.contains('is-active')) return;
      slides[index].classList.remove('is-active'); slides[index].setAttribute('aria-hidden', 'true'); playVideo(slides[index], false);
      if (dots[index]) { dots[index].classList.remove('is-active'); dots[index].removeAttribute('aria-current'); }
      index = (n + slides.length) % slides.length;
      var s = slides[index];
      s.classList.add('is-active'); s.removeAttribute('aria-hidden'); playVideo(s, true);
      $$('.split-line', s).forEach(function (l) { l.classList.remove('is-in'); void l.offsetWidth; l.classList.add('is-in'); });
      if (dots[index]) { var d = dots[index]; d.classList.remove('is-active'); void d.offsetWidth; d.classList.add('is-active'); d.setAttribute('aria-current', 'true'); }
      if (user) restart();
    }
    function restart() { clearInterval(timer); if (autoplay && !paused) timer = setInterval(function () { go(index + 1); }, speed); }
    dots.forEach(function (d, i) { on(d, 'click', function () { go(i, true); }); });
    on(pauseBtn, 'click', function () {
      paused = !paused; hero.classList.toggle('is-paused', paused);
      pauseBtn.setAttribute('aria-label', paused ? pauseBtn.dataset.playLabel : pauseBtn.dataset.pauseLabel);
      pauseBtn.querySelector('[data-icon-pause]').hidden = paused; pauseBtn.querySelector('[data-icon-play]').hidden = !paused;
      if (paused) clearInterval(timer); else restart();
    });
    on(hero, 'mouseenter', function () { if (autoplay && !paused) { clearInterval(timer); hero.classList.add('is-paused'); } });
    on(hero, 'mouseleave', function () { if (autoplay && !paused) { hero.classList.remove('is-paused'); restart(); } });
    var x0 = null;
    on(hero, 'touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    on(hero, 'touchend', function (e) { if (x0 === null) return; var dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) go(index + (dx < 0 ? 1 : -1), true); x0 = null; });
    on(doc, 'visibilitychange', function () { if (doc.hidden) clearInterval(timer); else restart(); });
    slides.forEach(function (s, i) { if (i) s.setAttribute('aria-hidden', 'true'); });
    if (slides[0]) { slides[0].classList.add('is-active'); playVideo(slides[0], true); }
    if (dots[0]) dots[0].classList.add('is-active');
    requestAnimationFrame(function () { $$('.split-line', slides[0]).forEach(function (l) { l.classList.add('is-in'); }); });
    restart();
  });

  /* ---------- Rails ---------- */
  function initRails(ctx) {
    $$('[data-rail]', ctx).forEach(function (rail) {
      if (rail.dataset.railReady) return;
      rail.dataset.railReady = '1';
      var track = $('.rail__track', rail);
      var prev = $('[data-rail-prev]', rail.closest('section') || rail);
      var next = $('[data-rail-next]', rail.closest('section') || rail);
      var bar = $('.rail__progress span', rail);
      if (!track) return;
      function step() { var c = track.firstElementChild; return c ? c.getBoundingClientRect().width + parseFloat(getComputedStyle(track).columnGap || 0) : track.clientWidth; }
      function update() {
        if (!visible()) return;
        var max = track.scrollWidth - track.clientWidth;
        if (prev) prev.disabled = track.scrollLeft <= 2;
        if (next) next.disabled = track.scrollLeft >= max - 2;
        if (bar) {
          var w = max > 0 ? track.clientWidth / track.scrollWidth : 1;
          bar.style.setProperty('--w', (w * 100) + '%');
          bar.style.setProperty('--x', (max > 0 ? (track.scrollLeft / max) * ((1 - w) / w) * 100 : 0) + '%');
        }
      }
      function visible() { return !rail.closest('[hidden]'); }
      on(prev, 'click', function () { if (visible()) track.scrollBy({ left: -step(), behavior: 'smooth' }); });
      on(next, 'click', function () { if (visible()) track.scrollBy({ left: step(), behavior: 'smooth' }); });
      on(track, 'scroll', debounce(update, 30), { passive: true });
      on(window, 'resize', debounce(update, 150));
      update();
    });
  }

  /* ---------- Tabs ---------- */
  $$('[data-tabs]').forEach(function (wrap) {
    var tabs = $$('[role="tab"]', wrap);
    function select(tab) {
      tabs.forEach(function (t) {
        var sel = t === tab;
        t.setAttribute('aria-selected', sel ? 'true' : 'false');
        t.tabIndex = sel ? 0 : -1;
        var panel = doc.getElementById(t.getAttribute('aria-controls'));
        if (panel) { panel.hidden = !sel; if (sel) { initRails(panel); initReveals(panel); } }
      });
    }
    tabs.forEach(function (t, i) {
      on(t, 'click', function () { select(t); });
      on(t, 'keydown', function (e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); var n = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]; n.focus(); select(n); }
      });
    });
  });

  /* ---------- Lookbook hotspots ---------- */
  $$('[data-lookbook]').forEach(function (lb) {
    var spots = $$('.hotspot', lb), items = $$('.look-item', lb);
    function activate(n) {
      spots.forEach(function (s, i) { s.classList.toggle('is-active', i === n); var b = $('button', s); if (b) b.setAttribute('aria-pressed', i === n ? 'true' : 'false'); });
      items.forEach(function (it, i) { it.classList.toggle('is-active', i === n); });
    }
    spots.forEach(function (s, i) { on($('button', s), 'click', function () { activate(i); if (items[i] && window.innerWidth < 990) items[i].scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' }); }); on(s, 'mouseenter', function () { activate(i); }); });
    items.forEach(function (it, i) { on(it, 'mouseenter', function () { activate(i); }); on(it, 'focusin', function () { activate(i); }); });
    if (spots.length) activate(0);
  });

  /* ---------- Cart ---------- */
  var cartDrawer = function () { return doc.getElementById('CartDrawer'); };
  function cartSections() {
    var ids = ['cart-drawer', 'cart-count'];
    if ($('#main-cart')) ids.push($('#main-cart').dataset.sectionId);
    return ids;
  }
  function renderSections(sections) {
    if (!sections) return;
    if (sections['cart-drawer']) {
      var d = parseHTML(sections['cart-drawer']);
      var fresh = $('[data-cart-drawer-inner]', d), cur = $('[data-cart-drawer-inner]');
      if (fresh && cur) cur.innerHTML = fresh.innerHTML;
    }
    if (sections['cart-count']) {
      var c = parseHTML(sections['cart-count']);
      var n = $('[data-cart-count-value]', c);
      var count = n ? parseInt(n.textContent, 10) || 0 : 0;
      $$('[data-cart-count]').forEach(function (el) {
        el.textContent = count; el.hidden = count === 0;
        el.classList.remove('is-bump'); void el.offsetWidth; el.classList.add('is-bump');
      });
    }
    var main = $('#main-cart');
    if (main && sections[main.dataset.sectionId]) {
      var m = parseHTML(sections[main.dataset.sectionId]);
      var freshMain = $('#main-cart', m);
      if (freshMain) main.innerHTML = freshMain.innerHTML;
    }
  }
  function addToCart(items, btn) {
    if (btn) { btn.classList.add('is-loading'); btn.setAttribute('aria-busy', 'true'); }
    return fetchJSON(L.routes.cartAdd, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items, sections: cartSections(), sections_url: window.location.pathname })
    }).then(function (res) {
      if (L.cartType === 'page' && !$('#main-cart')) { window.location.href = L.routes.cart; return res; }
      renderSections(res.sections);
      var open = $$('.popup.is-open'); open.forEach(closeDrawer);
      openDrawer('CartDrawer', btn);
      announce(L.strings.added);
      return res;
    }).catch(function (err) {
      toast((err.data && (err.data.description || err.data.message)) || err.message);
      throw err;
    }).finally(function () { if (btn) { btn.classList.remove('is-loading'); btn.removeAttribute('aria-busy'); } });
  }
  function changeLine(key, qty, lineEl) {
    if (lineEl) lineEl.classList.add('is-removing');
    return fetchJSON(L.routes.cartChange, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: key, quantity: qty, sections: cartSections(), sections_url: window.location.pathname })
    }).then(function (res) { renderSections(res.sections); })
      .catch(function (err) { if (lineEl) lineEl.classList.remove('is-removing'); toast((err.data && err.data.description) || err.message); });
  }
  on(doc, 'click', function (e) {
    var rm = e.target.closest('[data-line-remove]');
    if (rm) { e.preventDefault(); changeLine(rm.dataset.lineRemove, 0, rm.closest('.cart-line')); return; }
    var qb = e.target.closest('[data-qty-step]');
    if (qb) {
      var box = qb.closest('.qty'), input = $('input', box);
      var v = Math.max(parseInt(input.min || 0, 10), (parseInt(input.value, 10) || 0) + parseInt(qb.dataset.qtyStep, 10));
      input.value = v;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  on(doc, 'change', debounce(function (e) {
    var input = e.target.closest('[data-line-qty]');
    if (input) changeLine(input.dataset.lineQty, parseInt(input.value, 10) || 0, input.closest('.cart-line'));
  }, 350));
  on(doc, 'change', debounce(function (e) {
    var note = e.target.closest('[data-cart-note]');
    if (note) fetchJSON(L.routes.cartUpdate, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: note.value }) }).catch(function () {});
  }, 400));
  // Upsell / quick add buttons with a single variant id.
  on(doc, 'click', function (e) {
    var b = e.target.closest('[data-add-variant]');
    if (!b) return;
    e.preventDefault();
    addToCart([{ id: parseInt(b.dataset.addVariant, 10), quantity: 1 }], b).catch(function () {});
  });

  /* ---------- Product form and variants ---------- */
  function initProduct(ctx) {
    $$('[data-product]', ctx).forEach(function (wrap) {
      if (wrap.dataset.productReady) return;
      wrap.dataset.productReady = '1';
      var dataEl = $('[data-product-json]', wrap);
      if (!dataEl) return;
      var data = JSON.parse(dataEl.textContent);
      var form = $('form[data-product-form]', wrap);
      var idInput = form && $('input[name="id"]', form);
      var addBtn = form && $('[data-add-button]', form);
      var addLabel = addBtn && $('[data-add-label]', addBtn);
      var priceEl = $('[data-price]', wrap);
      var stockEl = $('[data-stock]', wrap);
      var skuEl = $('[data-sku]', wrap);
      var optionLabels = $$('[data-option-label]', wrap);
      var gallery = $('[data-gallery]', wrap);
      var sticky = doc.querySelector('[data-sticky-atc]');
      var updateUrl = wrap.dataset.updateUrl === 'true';

      function currentOptions() {
        return $$('fieldset[data-option-index]', wrap).map(function (fs) {
          var c = $('input:checked', fs); return c ? c.value : null;
        });
      }
      function findVariant(opts) {
        return data.variants.find(function (v) { return v.options.every(function (o, i) { return o === opts[i]; }); });
      }
      function markAvailability(opts) {
        $$('fieldset[data-option-index]', wrap).forEach(function (fs) {
          var idx = parseInt(fs.dataset.optionIndex, 10);
          $$('input', fs).forEach(function (inp) {
            var test = opts.slice(); test[idx] = inp.value;
            var match = data.variants.find(function (v) { return v.options.every(function (o, i) { return o === test[i]; }) && v.available; });
            var lbl = inp.nextElementSibling;
            if (lbl) lbl.classList.toggle('is-unavailable', !match);
          });
        });
      }
      function update() {
        var opts = currentOptions();
        optionLabels.forEach(function (l, i) { l.textContent = opts[i] || ''; });
        var v = findVariant(opts);
        markAvailability(opts);
        if (!v) {
          if (addBtn) { addBtn.disabled = true; addLabel.textContent = L.strings.unavailable; }
          if (stockEl) { stockEl.hidden = true; }
          return;
        }
        if (idInput) { idInput.value = v.id; idInput.dispatchEvent(new Event('change', { bubbles: true })); }
        if (addBtn) { addBtn.disabled = !v.available; addLabel.textContent = v.available ? L.strings.addToBag : L.strings.soldOut; }
        if (priceEl) {
          var html = '<span class="price__current">' + formatMoney(v.price) + '</span>';
          if (v.compare_at_price > v.price) html = '<span class="price__current">' + formatMoney(v.price) + '</span><s class="price__compare">' + formatMoney(v.compare_at_price) + '</s>';
          priceEl.innerHTML = html;
          priceEl.classList.toggle('price--sale', v.compare_at_price > v.price);
        }
        if (skuEl) { skuEl.textContent = v.sku || ''; skuEl.parentElement.hidden = !v.sku; }
        if (stockEl) {
          var inv = data.inventory && data.inventory[v.id];
          var threshold = parseInt(stockEl.dataset.threshold, 10) || 0;
          stockEl.hidden = false;
          stockEl.className = 'stock';
          if (!v.available) { stockEl.classList.add('stock--out'); stockEl.textContent = stockEl.dataset.out; }
          else if (inv && inv.managed && inv.qty > 0 && threshold > 0 && inv.qty <= threshold) { stockEl.classList.add('stock--low'); stockEl.textContent = stockEl.dataset.low.replace('[count]', inv.qty); }
          else if (inv && inv.managed && inv.qty <= 0 && inv.policy === 'continue') { stockEl.classList.add('stock--low'); stockEl.textContent = stockEl.dataset.backorder; }
          else { stockEl.textContent = stockEl.dataset.in; }
        }
        if (v.featured_media && gallery) { gallery.dispatchEvent(new CustomEvent('gallery:go', { detail: v.featured_media.id })); }
        if (updateUrl) { var url = new URL(window.location.href); url.searchParams.set('variant', v.id); history.replaceState({}, '', url.toString()); }
        if (sticky) { var sb = $('[data-add-button]', sticky); if (sb) { sb.disabled = !v.available; $('[data-add-label]', sb).textContent = v.available ? L.strings.addToBag : L.strings.soldOut; } var sp = $('[data-price]', sticky); if (sp && priceEl) sp.innerHTML = priceEl.innerHTML; }
      }
      on(wrap, 'change', function (e) { if (e.target.closest('fieldset[data-option-index]')) update(); });
      if ($$('fieldset[data-option-index]', wrap).length) markAvailability(currentOptions());

      if (form) on(form, 'submit', function (e) {
        e.preventDefault();
        var fd = new FormData(form);
        var item = { id: parseInt(fd.get('id'), 10), quantity: parseInt(fd.get('quantity') || '1', 10) };
        var props = {};
        fd.forEach(function (val, key) { var m = key.match(/^properties\[(.+)\]$/); if (m && val) props[m[1]] = val; });
        if (Object.keys(props).length) item.properties = props;
        addToCart([item], addBtn).catch(function () {});
      });

      if (sticky && addBtn && 'IntersectionObserver' in window) {
        new IntersectionObserver(function (en) { sticky.classList.toggle('is-visible', !en[0].isIntersecting && en[0].boundingClientRect.top < 0); }).observe(addBtn);
        on($('[data-add-button]', sticky), 'click', function (e) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : addBtn.click(); });
      }
      initGallery(wrap);
    });
  }

  /* ---------- Gallery: swipe, dots, hover zoom, lightbox ---------- */
  function initGallery(ctx) {
    $$('[data-gallery]', ctx).forEach(function (g) {
      if (g.dataset.galleryReady) return;
      g.dataset.galleryReady = '1';
      var track = $('.gallery__main', g);
      var slides = $$('.gallery__slide', g);
      var dots = $$('.gallery__dot', g);
      var count = $('[data-gallery-count]', g);
      function setActive(i) {
        dots.forEach(function (d, n) { d.setAttribute('aria-current', n === i ? 'true' : 'false'); });
        if (count) count.textContent = (i + 1) + ' / ' + slides.length;
      }
      on(track, 'scroll', debounce(function () { setActive(Math.round(track.scrollLeft / track.clientWidth)); }, 50), { passive: true });
      dots.forEach(function (d, i) { on(d, 'click', function () { track.scrollTo({ left: i * track.clientWidth, behavior: 'smooth' }); }); });
      on(g, 'gallery:go', function (e) {
        var idx = slides.findIndex(function (s) { return s.dataset.mediaId == e.detail; });
        if (idx < 0) return;
        if (getComputedStyle(track).gridAutoFlow.indexOf('column') === 0) track.scrollTo({ left: idx * track.clientWidth, behavior: reduceMotion ? 'auto' : 'smooth' });
        else if (idx > 0) slides[idx].scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
        setActive(idx);
      });
      // Hover zoom on desktop: the image follows the pointer.
      if (window.matchMedia('(hover: hover) and (min-width: 990px)').matches && g.dataset.zoom === 'true') {
        slides.forEach(function (s) {
          var img = $('img', s);
          if (!img) return;
          on(s, 'mousemove', function (e) { var r = s.getBoundingClientRect(); img.style.transformOrigin = ((e.clientX - r.left) / r.width * 100) + '% ' + ((e.clientY - r.top) / r.height * 100) + '%'; });
          on(s, 'mouseenter', function () { s.classList.add('is-zooming'); });
          on(s, 'mouseleave', function () { s.classList.remove('is-zooming'); });
        });
      }
      var lb = $('[data-lightbox]', g);
      if (lb) {
        slides.forEach(function (s, i) {
          on(s, 'click', function (e) {
            if (e.target.closest('video, model-viewer, iframe, button')) return;
            lb.classList.add('is-open'); lockScroll();
            var lbTrack = $('.lightbox__track', lb);
            requestAnimationFrame(function () { lbTrack.scrollLeft = i * lbTrack.clientWidth; $('.lightbox__close', lb).focus(); });
          });
        });
        on($('.lightbox__close', lb), 'click', function () { lb.classList.remove('is-open'); unlockScroll(); });
        on(lb, 'keydown', function (e) { if (e.key === 'Escape') { lb.classList.remove('is-open'); unlockScroll(); } });
      }
    });
  }

  /* ---------- Quick view ---------- */
  on(doc, 'click', function (e) {
    var b = e.target.closest('[data-quick-view]');
    if (!b) return;
    e.preventDefault();
    var modal = doc.getElementById('QuickView');
    if (!modal) return;
    var body = $('[data-quick-view-body]', modal);
    body.innerHTML = '<div class="quick-view__loading"><span class="btn btn--outline is-loading" aria-hidden="true">.</span></div>';
    openDrawer('QuickView', b);
    fetch(b.dataset.quickView + (b.dataset.quickView.indexOf('?') > -1 ? '&' : '?') + 'section_id=quick-view-product')
      .then(function (r) { return r.text(); })
      .then(function (html) {
        var d = parseHTML(html);
        var inner = $('[data-quick-view-content]', d);
        body.innerHTML = inner ? inner.innerHTML : '';
        initProduct(body);
        initReveals(body);
        var first = $('select, input, button', body); if (first) first.focus({ preventScroll: true });
      });
  });

  /* ---------- Collection filters, sort and load more ---------- */
  (function () {
    var root_ = $('[data-collection]');
    if (!root_) return;
    var sectionId = root_.dataset.sectionId;
    function render(url, push) {
      var grid = $('[data-collection-grid]');
      if (grid) grid.classList.add('is-loading');
      var u = new URL(url, window.location.origin);
      u.searchParams.set('section_id', sectionId);
      fetch(u.toString()).then(function (r) { return r.text(); }).then(function (html) {
        var d = parseHTML(html);
        ['[data-collection-grid]', '[data-facets]', '[data-active-filters]', '[data-product-count]', '[data-load-more]', '[data-facets-mobile]'].forEach(function (sel) {
          var fresh = $(sel, d); $$(sel).forEach(function (cur) { if (fresh) cur.innerHTML = fresh.innerHTML; });
        });
        u.searchParams.delete('section_id');
        if (push) history.pushState({ facets: true }, '', u.toString());
        initReveals(); initWishButtons();
      }).finally(function () { var g = $('[data-collection-grid]'); if (g) g.classList.remove('is-loading'); });
    }
    function formUrl(form) {
      var fd = new FormData(form), params = new URLSearchParams();
      fd.forEach(function (v, k) { if (v !== '') params.append(k, v); });
      var sort = $('[data-sort]'); if (sort && sort.value) params.set('sort_by', sort.value);
      return window.location.pathname + '?' + params.toString();
    }
    on(doc, 'change', debounce(function (e) {
      var f = e.target.closest('form[data-facet-form]');
      if (f) { render(formUrl(f), true); return; }
      if (e.target.matches('[data-sort]')) {
        var url = new URL(window.location.href); url.searchParams.set('sort_by', e.target.value); url.searchParams.delete('page');
        render(url.pathname + url.search, true);
      }
    }, 300));
    on(doc, 'submit', function (e) { var f = e.target.closest('form[data-facet-form]'); if (f) { e.preventDefault(); render(formUrl(f), true); } });
    on(doc, 'click', function (e) {
      var a = e.target.closest('[data-facet-link]');
      if (a) { e.preventDefault(); render(a.getAttribute('href'), true); return; }
      var gs = e.target.closest('[data-grid-cols]');
      if (gs) {
        $$('[data-grid-cols]').forEach(function (b) { b.setAttribute('aria-pressed', b === gs ? 'true' : 'false'); });
        var g = $('.product-grid', $('[data-collection-grid]'));
        if (g) g.classList.toggle('product-grid--4', gs.dataset.gridCols === '4');
        storeSet('luxe:grid', gs.dataset.gridCols);
      }
    });
    on(window, 'popstate', function (e) { if (e.state && e.state.facets) render(window.location.href, false); });

    // Infinite load: fetch the next page when the sentinel scrolls into view.
    function initLoadMore() {
      var btn = $('[data-load-more] a[data-next]');
      if (!btn || !('IntersectionObserver' in window)) return;
      var io = new IntersectionObserver(function (en) {
        if (!en[0].isIntersecting) return;
        io.disconnect();
        btn.classList.add('is-loading');
        var u = new URL(btn.href, window.location.origin); u.searchParams.set('section_id', sectionId);
        fetch(u.toString()).then(function (r) { return r.text(); }).then(function (html) {
          var d = parseHTML(html);
          var grid = $('[data-collection-grid] .product-grid'), freshGrid = $('[data-collection-grid] .product-grid', d);
          if (grid && freshGrid) $$(':scope > *', freshGrid).forEach(function (c) { grid.appendChild(c); });
          var lm = $('[data-load-more]'), freshLm = $('[data-load-more]', d);
          if (lm) lm.innerHTML = freshLm ? freshLm.innerHTML : '';
          initReveals(); initWishButtons(); initLoadMore();
        });
      }, { rootMargin: '400px' });
      io.observe(btn);
    }
    initLoadMore();
    var saved = storeGet('luxe:grid', null);
    if (saved === '4') { var b4 = $('[data-grid-cols="4"]'); if (b4) b4.click(); }
  })();

  /* ---------- Wishlist (stored on the shopper's device) ---------- */
  var WISH = 'luxe:wishlist';
  function wishList() { return storeGet(WISH, []); }
  function initWishButtons(ctx) {
    var list = wishList();
    $$('[data-wish]', ctx).forEach(function (b) { b.setAttribute('aria-pressed', list.indexOf(b.dataset.wish) > -1 ? 'true' : 'false'); });
    $$('[data-wish-count]').forEach(function (el) { el.textContent = list.length; el.hidden = list.length === 0; });
  }
  on(doc, 'click', function (e) {
    var b = e.target.closest('[data-wish]');
    if (!b) return;
    e.preventDefault();
    var list = wishList(), h = b.dataset.wish, i = list.indexOf(h);
    if (i > -1) list.splice(i, 1); else list.unshift(h);
    storeSet(WISH, list.slice(0, 60));
    initWishButtons();
    toast(i > -1 ? b.dataset.removedText || 'Removed from wishlist' : b.dataset.addedText || 'Saved to wishlist');
    if (L.mail && L.mail.endpoint && i === -1) beacon({ type: 'wishlist', handle: h });
  });
  function renderHandles(container, handles, emptyEl) {
    if (!container) return;
    if (!handles.length) { if (emptyEl) emptyEl.hidden = false; container.closest('[data-handle-section]') && (container.closest('[data-handle-section]').hidden = !emptyEl); return; }
    Promise.all(handles.map(function (h) {
      return fetch(L.routes.root.replace(/\/$/, '') + '/products/' + encodeURIComponent(h) + '?view=card').then(function (r) { return r.ok ? r.text() : ''; }).catch(function () { return ''; });
    })).then(function (htmls) {
      var html = htmls.filter(Boolean).join('');
      if (!html) { if (emptyEl) emptyEl.hidden = false; return; }
      container.innerHTML = html;
      var sec = container.closest('[data-handle-section]'); if (sec) sec.hidden = false;
      initReveals(container); initWishButtons(container); initRails(sec || container); window.dispatchEvent(new Event('resize'));
    });
  }
  $$('[data-wishlist-grid]').forEach(function (g) { renderHandles(g, wishList(), $('[data-wishlist-empty]')); });

  /* ---------- Recently viewed ---------- */
  var RV = 'luxe:viewed';
  var current = $('[data-product-handle]');
  if (current) {
    var h = current.dataset.productHandle, rv = storeGet(RV, []).filter(function (x) { return x !== h; });
    rv.unshift(h); storeSet(RV, rv.slice(0, 16));
    if (L.mail && L.mail.endpoint) beacon({ type: 'view', handle: h });
  }
  $$('[data-recently-viewed]').forEach(function (g) {
    var exclude = current ? current.dataset.productHandle : null;
    var limit = parseInt(g.dataset.limit, 10) || 8;
    renderHandles(g, storeGet(RV, []).filter(function (x) { return x !== exclude; }).slice(0, limit), null);
  });

  /* ---------- Product recommendations ---------- */
  $$('[data-recommendations]').forEach(function (el) {
    fetch(el.dataset.url).then(function (r) { return r.text(); }).then(function (html) {
      var d = parseHTML(html);
      var sec = $('.shopify-section section', d) || $('section', d);
      if (!sec) return;
      el.replaceWith(sec);
      initReveals(sec); initRails(sec); initWishButtons(sec);
    }).catch(function () {});
  });

  /* ---------- LuxeMail beacon (only when an endpoint is configured) ---------- */
  function beacon(body) {
    if (!L.mail || !L.mail.endpoint) return;
    try {
      var id = storeGet('luxe:cid', null);
      if (!id) { id = Math.random().toString(36).slice(2) + Date.now().toString(36); storeSet('luxe:cid', id); }
      body.cid = id; body.page = window.location.pathname;
      if (L.mail.email) body.email = L.mail.email;
      var blob = new Blob([JSON.stringify(body)], { type: 'text/plain' });
      if (navigator.sendBeacon) navigator.sendBeacon(L.mail.endpoint.replace(/\/$/, '') + '/t', blob);
    } catch (e) {}
  }

  /* ---------- Newsletter: consent, popup and welcome offer ---------- */
  on(doc, 'submit', function (e) {
    var f = e.target.closest('form[data-newsletter]');
    if (!f) return;
    var consent = $('input[data-consent]', f);
    if (consent && !consent.checked) {
      e.preventDefault();
      var msg = $('[data-consent-error]', f); if (msg) msg.hidden = false;
      consent.focus();
      return;
    }
    storeSet('luxe:popup', { done: true, at: Date.now() });
    var email = $('input[type="email"]', f);
    if (email) beacon({ type: 'signup', email: email.value, consent: consent ? consent.closest('label').textContent.trim() : 'form', source: f.dataset.newsletter });
  });
  on(doc, 'click', function (e) {
    var c = e.target.closest('[data-copy]');
    if (!c) return;
    e.preventDefault();
    var text = c.dataset.copy;
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { toast(L.strings.copied); }).catch(function () {
      var t = doc.createElement('textarea'); t.value = text; doc.body.appendChild(t); t.select(); try { doc.execCommand('copy'); toast(L.strings.copied); } catch (err) {} t.remove();
    });
  });

  (function () {
    var popup = doc.getElementById('NewsletterPopup');
    if (!popup) return;
    if (window.location.search.indexOf('customer_posted=true') > -1 && window.location.hash.indexOf('PopupForm') > -1) { openDrawer('NewsletterPopup'); return; }
    var state = storeGet('luxe:popup', null);
    var days = parseInt(popup.dataset.repeatDays, 10) || 0;
    if (state && (state.done || !days || Date.now() - state.at < days * 864e5)) return;
    if (popup.dataset.hideForMarketing === 'true') return;
    var shown = false;
    function show() {
      if (shown || $('.drawer.is-open, .popup.is-open, .search-overlay.is-open')) return;
      shown = true; openDrawer('NewsletterPopup');
      storeSet('luxe:popup', { done: false, at: Date.now() });
    }
    var delay = (parseInt(popup.dataset.delay, 10) || 10) * 1000;
    if (popup.dataset.trigger === 'exit' && window.matchMedia('(hover: hover)').matches) {
      on(doc, 'mouseout', function (e) { if (!e.relatedTarget && e.clientY < 10) show(); });
    } else {
      setTimeout(show, delay);
    }
    $$('[data-drawer-close]', popup).forEach(function (b) { on(b, 'click', function () { if (!days) storeSet('luxe:popup', { done: true, at: Date.now() }); }); });
  })();
  on(doc, 'click', function (e) { var b = e.target.closest('[data-open-popup]'); if (b) { e.preventDefault(); openDrawer('NewsletterPopup', b); } });

  /* ---------- Localization dropdowns ---------- */
  $$('[data-localization]').forEach(function (wrap) {
    var btn = $('.localization__btn', wrap), list = $('.localization__list', wrap), input = $('input[data-loc-input]', wrap), form = wrap.closest('form');
    on(btn, 'click', function () { var open = btn.getAttribute('aria-expanded') === 'true'; btn.setAttribute('aria-expanded', open ? 'false' : 'true'); list.hidden = open; if (!open) { var cur = $('[aria-current="true"]', list) || $('button', list); cur && cur.focus(); } });
    $$('button', list).forEach(function (b) { on(b, 'click', function () { input.value = b.dataset.value; form.submit(); }); });
    on(wrap, 'keydown', function (e) {
      if (e.key === 'Escape') { btn.setAttribute('aria-expanded', 'false'); list.hidden = true; btn.focus(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { var bs = $$('button', list), i = bs.indexOf(doc.activeElement); if (i > -1 || e.key === 'ArrowDown') { e.preventDefault(); var n = bs[(i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length]; n && n.focus(); } }
    });
    on(doc, 'click', function (e) { if (!wrap.contains(e.target)) { btn.setAttribute('aria-expanded', 'false'); list.hidden = true; } });
  });

  /* ---------- Section editor support ---------- */
  on(doc, 'shopify:section:load', function (e) { initReveals(e.target); initRails(e.target); initProduct(e.target); initWishButtons(e.target); collectParallax(); $$('[data-reveal], [data-split]', e.target).forEach(function (el) { el.classList.add('is-in'); }); });
  on(doc, 'shopify:block:select', function (e) {
    var slide = e.target.closest('.hero__slide');
    if (slide) { var hero = slide.closest('[data-slideshow]'); var dots = $$('.hero__dot', hero); var idx = $$('.hero__slide', hero).indexOf(slide); if (dots[idx]) dots[idx].click(); }
  });

  /* ---------- Init ---------- */
  initReveals();
  initRails();
  initProduct();
  initWishButtons();
  collectParallax();
  onScroll();
})();
