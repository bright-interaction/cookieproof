(function () {
  'use strict';
  if (window.__ceLoaderInit) return;
  window.__ceLoaderInit = true;

  var ALLOWED_CSS_VARS = [
    '--cc-bg', '--cc-bg-secondary', '--cc-text', '--cc-text-secondary', '--cc-border',
    '--cc-btn-primary-bg', '--cc-btn-primary-text', '--cc-btn-secondary-bg', '--cc-btn-secondary-text',
    '--cc-btn-reject-bg', '--cc-btn-reject-text', '--cc-toggle-on', '--cc-toggle-off',
    '--cc-overlay', '--cc-radius', '--cc-radius-sm', '--cc-font', '--cc-z-index',
    '--cc-max-width', '--cc-shadow'
  ];
  var VALID_METHODS = ['accept-all', 'reject-all', 'custom', 'gpc', 'dns', 'do-not-sell'];
  var POISONED = { '__proto__': 1, 'constructor': 1, 'prototype': 1 };
  var CONSENT_KEY = 'ce_consent';
  var SIGNALS_KEY = 'ce_signals';
  var EXPIRY_MS = 365 * 864e5;

  // --- Immediate GCM default-denied stub (Race Condition protection) ---
  // Must fire BEFORE any Google tag script to ensure consent-by-default is "denied".
  // This monkey-patches window.dataLayer and window.gtag at the earliest possible moment
  // so that even if GA/GTM scripts execute before the loader finishes init, they see "denied".
  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag !== 'function') { window.gtag = function () { window.dataLayer.push(arguments); }; }
  window.gtag('consent', 'default', {
    ad_storage: 'denied', analytics_storage: 'denied',
    ad_user_data: 'denied', ad_personalization: 'denied',
    functionality_storage: 'denied', personalization_storage: 'denied',
    security_storage: 'granted', wait_for_update: 2500
  });

  var script = document.currentScript;
  if (!script) return;
  var domain = script.getAttribute('data-domain');
  if (!domain) { console.error('[cookieproof] loader: missing data-domain'); return; }

  var src = script.src;
  var baseUrl = src.substring(0, src.lastIndexOf('/'));
  var configUrl = baseUrl + '/api/config/' + encodeURIComponent(domain);
  var umdUrl = baseUrl + '/dist/cookieproof.umd.js';
  var _obs = null;
  var _activated = {};

  function beacon(t, m) {
    try { navigator.sendBeacon && navigator.sendBeacon(baseUrl + '/api/telemetry', new Blob([JSON.stringify({ d: domain, t: t, m: (m || '').slice(0, 200), u: location.href.slice(0, 200) })], { type: 'application/json' })); } catch (e) {}
  }

  // --- Consent ---

  function readConsent() {
    try {
      var raw = localStorage.getItem(CONSENT_KEY);
      if (!raw) raw = readCookie(CONSENT_KEY);
      if (!raw) return null;
      var p = JSON.parse(raw);
      return validConsent(p) ? p : null;
    } catch (e) { return null; }
  }

  function readCookie(n) {
    var pfx = n + '=', cs = document.cookie.split(';');
    for (var i = 0; i < cs.length; i++) {
      var c = cs[i].trim();
      if (c.indexOf(pfx) === 0) { try { return decodeURIComponent(c.substring(pfx.length)); } catch (e) { return null; } }
    }
    return null;
  }

  function validConsent(o) {
    if (!o || typeof o !== 'object') return false;
    if (typeof o.version !== 'number' || !isFinite(o.version) || o.version <= 0) return false;
    if (typeof o.timestamp !== 'number' || !isFinite(o.timestamp) || o.timestamp < 0 || o.timestamp > Date.now() + 864e5) return false;
    if (typeof o.method !== 'string' || VALID_METHODS.indexOf(o.method) === -1) return false;
    var c = o.categories;
    if (!c || typeof c !== 'object' || Array.isArray(c)) return false;
    for (var k in c) { if (!Object.prototype.hasOwnProperty.call(c, k)) continue; if (POISONED[k] || typeof c[k] !== 'boolean') return false; }
    return true;
  }

  // --- Safe URL ---

  function safe(url) {
    var t = url.replace(/^[\s\u200B\u00AD\uFEFF\u200C\u200D]+/, '').toLowerCase();
    return t.indexOf('https://') === 0 || t.indexOf('http://') === 0 || t.indexOf('//') === 0;
  }

  // --- Element activation ---

  var _nonce;
  function nonce() {
    if (_nonce === undefined) { var m = document.querySelector('meta[name="csp-nonce"]'); _nonce = m ? m.getAttribute('content') : null; }
    return _nonce;
  }

  function activateEl(el) {
    if (el.tagName === 'SCRIPT' && el.type === 'text/plain') {
      var cat = el.getAttribute('data-consent') || '';
      var key = cat + '::' + (el.src || el.textContent || '').slice(0, 200);
      if (_activated[key]) return;
      if (el.src && !safe(el.src)) return;
      _activated[key] = true;
      var r = document.createElement('script');
      for (var i = 0; i < el.attributes.length; i++) {
        var a = el.attributes[i];
        if (a.name === 'type' || a.name === 'data-original-type' || a.name === 'data-consent' || a.name.indexOf('on') === 0) continue;
        r.setAttribute(a.name, a.value);
      }
      var ot = el.getAttribute('data-original-type') || el.getAttribute('data-type');
      r.type = ot === 'module' ? 'module' : 'text/javascript';
      if (nonce()) r.nonce = nonce();
      if (el.textContent && !el.src) r.textContent = el.textContent;
      el.parentNode.replaceChild(r, el);
    } else if (el.tagName === 'IFRAME' && el.hasAttribute('data-src')) {
      var s = el.getAttribute('data-src');
      if (s && safe(s)) { el.src = s; el.removeAttribute('data-src'); var ph = el.parentElement && el.parentElement.querySelector('[data-consent-placeholder]'); if (ph) ph.remove(); el.style.removeProperty('display'); }
    } else if (el.tagName === 'IMG' && el.hasAttribute('data-src')) {
      var is = el.getAttribute('data-src');
      if (is && safe(is)) { el.src = is; el.removeAttribute('data-src'); }
    } else if (el.tagName === 'LINK' && el.hasAttribute('data-href')) {
      var h = el.getAttribute('data-href');
      if (h && safe(h)) { el.href = h; el.removeAttribute('data-href'); }
    }
  }

  function cssEsc(v) {
    return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(v) : v.replace(/[\0\n\r\f"\\[\]]/g, function (c) { return c === '\0' ? '\uFFFD' : '\\' + c; });
  }

  function activateCat(cat) {
    var sel = '[data-consent="' + cssEsc(cat) + '"]';
    var els = document.querySelectorAll('script[type="text/plain"]' + sel + ', iframe' + sel + '[data-src], img' + sel + '[data-src], link' + sel + '[data-href]');
    for (var i = 0; i < els.length; i++) activateEl(els[i]);
  }

  // --- MutationObserver ---

  function startObs(cats) {
    if (typeof MutationObserver === 'undefined' || _obs) return;
    _obs = new MutationObserver(function (ms) {
      for (var i = 0; i < ms.length; i++) {
        var nodes = ms[i].addedNodes;
        for (var j = 0; j < nodes.length; j++) {
          var n = nodes[j];
          if (n.nodeType !== 1) continue;
          var c = n.getAttribute && n.getAttribute('data-consent');
          if (c && cats[c]) activateEl(n);
        }
      }
    });
    _obs.observe(document.documentElement, { childList: true, subtree: true });
  }

  function stopObs() { if (_obs) { _obs.disconnect(); _obs = null; } }

  // --- GCM ---

  function pushGcm() {
    // Default-denied is already set at the top of the IIFE (immediate stub).
    // Here we only need to push the consent 'update' with saved signals.
    try {
      var raw = localStorage.getItem(SIGNALS_KEY);
      if (!raw) return;
      var sig = JSON.parse(raw);
      if (!sig || typeof sig !== 'object') return;
      for (var k in sig) { if (Object.prototype.hasOwnProperty.call(sig, k) && sig[k] !== 'granted' && sig[k] !== 'denied') return; }
      window.gtag('consent', 'update', sig);
    } catch (e) {}
  }

  // --- Floating trigger ---

  function trigger(pos, fn) {
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', 'Cookie preferences');
    b.setAttribute('aria-hidden', 'true');
    b.setAttribute('tabindex', '-1');
    b.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="width:20px;height:20px"><path d="M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3zm-1 14h2v2h-2v-2zm0-8h2v6h-2V8z"/></svg>';
    b.style.cssText = 'position:fixed;bottom:16px;' + (pos === 'left' ? 'left' : 'right') + ':16px;z-index:2147483645;width:44px;height:44px;border-radius:50%;border:none;background:rgba(0,0,0,.7);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.3);transition:opacity .2s;opacity:.7';
    b.onmouseenter = function () { b.style.opacity = '1'; };
    b.onmouseleave = function () { b.style.opacity = '.7'; };
    b.addEventListener('click', fn);
    document.body.appendChild(b);
    return b;
  }

  // --- CLS skeleton (position:fixed, no layout shift) ---

  function showSkeleton() {
    var sk = document.createElement('div');
    sk.id = '__cb_skeleton';
    sk.setAttribute('aria-hidden', 'true');
    sk.style.cssText = 'position:fixed;z-index:2147483646;bottom:16px;left:50%;transform:translateX(-50%);width:calc(100% - 32px);max-width:640px;background:rgba(255,255,255,.97);border:1px solid #e5e7eb;border-radius:12px;padding:24px;box-shadow:0 8px 32px rgba(0,0,0,.12)';
    sk.innerHTML = '<div style="height:18px;width:40%;background:#e5e7eb;border-radius:4px;margin-bottom:12px"></div><div style="height:14px;width:90%;background:#f3f4f6;border-radius:4px;margin-bottom:8px"></div><div style="height:14px;width:70%;background:#f3f4f6;border-radius:4px;margin-bottom:20px"></div><div style="display:flex;gap:8px"><div style="flex:1;height:44px;background:#e5e7eb;border-radius:8px"></div><div style="flex:1;height:44px;background:#e5e7eb;border-radius:8px"></div><div style="flex:1;height:44px;background:#f3f4f6;border-radius:8px"></div></div>';
    document.body.appendChild(sk);
  }

  function removeSkeleton() {
    var sk = document.getElementById('__cb_skeleton');
    if (sk) sk.remove();
  }

  // --- UMD + element ---

  function loadUmd(data) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = umdUrl;
      if (data.integrity) { s.integrity = data.integrity; s.crossOrigin = 'anonymous'; }
      s.onload = function () { res(data); };
      s.onerror = function () { rej(new Error('UMD script failed to load')); };
      document.head.appendChild(s);
    });
  }

  function mkElement(data) {
    var cfg = data.config, cv = data.cssVars, el = document.createElement('cookie-consent');
    if (cv && typeof cv === 'object') {
      var st = '';
      for (var p in cv) {
        if (!Object.prototype.hasOwnProperty.call(cv, p) || ALLOWED_CSS_VARS.indexOf(p) === -1) continue;
        var v = String(cv[p]).replace(/[;\r\n\\]/g, '').replace(/url\s*\(/gi, '').replace(/expression\s*\(/gi, '').replace(/javascript\s*:/gi, '').replace(/image-set\s*\(/gi, '').replace(/image\s*\(/gi, '').replace(/cross-fade\s*\(/gi, '');
        if (/[a-zA-Z][\w-]*\s*\(/.test(v) && !/^[^()]*(?:(?:rgba?|hsla?|calc|min|max|clamp|var)\([^)]*\)[^()]*)*$/.test(v)) continue;
        st += p + ':' + v + ';';
      }
      if (st) el.setAttribute('style', st);
    }
    document.body.appendChild(el);
    if (el.configure) el.configure(cfg);
    else customElements.whenDefined('cookie-consent').then(function () { el.configure(cfg); });
    return el;
  }

  // --- Init paths ---

  function fullInit(pre) {
    // Show skeleton banner immediately to prevent CLS flash
    if (document.body) showSkeleton();

    // Block all non-essential scripts IMMEDIATELY until UMD loads and ScriptGate takes over.
    // No delay — every millisecond without an observer is a window for tracking to slip through.
    startObs({});

    var p = pre ? Promise.resolve(pre) : fetch(configUrl).then(function (r) { if (!r.ok) throw new Error('Config fetch failed: ' + r.status); return r.json(); });
    p.then(loadUmd).then(function (data) {
      stopObs();
      removeSkeleton();
      return mkElement(data);
    }).catch(function (e) {
      // Observer already running in blocking mode (empty cats) — leave it active
      removeSkeleton();
      console.error('[cookieproof] loader error:', e.message);
      beacon(e.message && e.message.indexOf('Config') === 0 ? 'config_fetch_error' : e.message && e.message.indexOf('UMD') === 0 ? 'umd_load_error' : 'init_error', e.message);
    });
  }

  function lightInit(consent) {
    fetch(configUrl).then(function (r) { if (!r.ok) throw new Error('Config fetch failed: ' + r.status); return r.json(); }).then(function (data) {
      var cfg = data.config || {}, rev = cfg.revision || 1;
      if (consent.version !== rev) {
        // Re-consent needed — block all non-essential scripts while UMD loads
        startObs({});
        return loadUmd(data).then(function (d) { stopObs(); mkElement(d); });
      }

      var cats = consent.categories;
      if (cfg.gcmEnabled !== false) pushGcm();
      for (var c in cats) { if (Object.prototype.hasOwnProperty.call(cats, c) && cats[c] === true) activateCat(c); }
      startObs(cats);

      if (cfg.floatingTrigger !== false) {
        var btn = trigger(typeof cfg.floatingTrigger === 'string' ? cfg.floatingTrigger : 'right', function () {
          btn.style.pointerEvents = 'none'; btn.style.opacity = '.4';
          stopObs();
          loadUmd(data).then(function (d) {
            btn.remove();
            var el = mkElement(d);
            customElements.whenDefined('cookie-consent').then(function () {
              var n = 0, wait = function () { if (el.showPreferences && el.initialized !== false) el.showPreferences(); else if (n++ < 20) setTimeout(wait, 50); };
              setTimeout(wait, 50);
            });
          }).catch(function (e) { console.error('[cookieproof] loader error:', e.message); beacon('umd_load_error', e.message); startObs(cats); btn.style.pointerEvents = ''; btn.style.opacity = '.7'; });
        });
      }

      try { document.dispatchEvent(new CustomEvent('consent:init', { detail: { consent: consent }, bubbles: true, composed: true })); } catch (e) {}
    }).catch(function (e) { console.error('[cookieproof] config check failed, loading full bundle'); beacon('config_fetch_error', e.message); fullInit(); });
  }

  // --- Entry ---

  function start() {
    var c = readConsent();
    if (!c || Date.now() - c.timestamp > EXPIRY_MS) { fullInit(); return; }
    lightInit(c);
  }

  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
