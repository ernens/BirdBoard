/**
 * bird-shared.js — Pure utility functions for BIRDASH (no Vue dependency)
 *
 * Depends on: bird-config.js (BIRD_CONFIG must be loaded first)
 * Exposes: window.BIRDASH_UTILS = { ... }
 *
 * These functions are framework-agnostic and can be used by any page,
 * whether it uses Vue, vanilla JS, or another framework.
 */

;(function (BIRD_CONFIG) {
  'use strict';

  // ── API Query ────────────────────────────────────────────────────────────

  // ── Global API error tracking ──────────────────────────────────────────
  let _apiFailCount = 0;
  let _apiBannerShown = false;

  function _showApiBanner() {
    if (_apiBannerShown) return;
    _apiBannerShown = true;
    const el = document.createElement('div');
    el.className = 'api-error-banner';
    el.innerHTML = '<span>API unavailable</span><button onclick="this.parentElement.remove()">✕</button>';
    document.body.prepend(el);
  }

  function _clearApiBanner() {
    _apiFailCount = 0;
    if (_apiBannerShown) {
      const el = document.querySelector('.api-error-banner');
      if (el) el.remove();
      _apiBannerShown = false;
    }
  }

  async function birdQuery(sql, params = []) {
    const res = await fetch(`${BIRD_CONFIG.apiUrl}/query`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ sql, params }),
    });
    if (!res.ok) { _apiFailCount++; if (_apiFailCount >= 3) _showApiBanner(); const err = new Error(`HTTP ${res.status}`); if (res.status !== 429) window.dispatchEvent(new CustomEvent('birdash:error', { detail: 'API error: ' + res.status })); throw err; }
    _clearApiBanner();
    const data = await res.json();
    if (data.error) { window.dispatchEvent(new CustomEvent('birdash:error', { detail: data.error })); throw new Error(data.error); }
    return data.rows.map(row => {
      const obj = {};
      data.columns.forEach((col, i) => { obj[col] = row[i]; });
      return obj;
    });
  }

  // ── Authenticated fetch (for write operations) ──────────────────────────
  // Automatically adds Authorization header if BIRD_CONFIG.apiToken is set.
  function authHeaders() {
    const h = { 'Content-Type': 'application/json' };
    if (BIRD_CONFIG.apiToken) h['Authorization'] = `Bearer ${BIRD_CONFIG.apiToken}`;
    return h;
  }

  // ── Formatting ───────────────────────────────────────────────────────────

  function fmtDate(dateStr) {
    if (!dateStr) return '\u2014';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  }

  function fmtTime(timeStr) {
    if (!timeStr) return '\u2014';
    return timeStr.substring(0, 5);
  }

  function fmtConf(val) {
    if (val == null) return '\u2014';
    return (parseFloat(val) * 100).toFixed(1) + '%';
  }

  function localDateStr(d) {
    if (!(d instanceof Date)) d = new Date();
    const y   = d.getFullYear();
    const m   = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return localDateStr(d);
  }

  /**
   * freshnessLabel — human-readable time elapsed since a date/time.
   * @param {string} dateStr - Date string (YYYY-MM-DD)
   * @param {string} timeStr - Time string (HH:MM:SS)
   * @param {function} t - Translation function (key, vars) => string
   */
  function freshnessLabel(dateStr, timeStr, t) {
    if (!dateStr || !timeStr) return '\u2014';
    const last    = new Date(`${dateStr}T${timeStr}`);
    const diffMs  = Date.now() - last.getTime();
    const diffMin = Math.max(0, Math.floor(diffMs / 60000));
    if (diffMin < 60)   return t('minutes_ago', { n: diffMin });
    if (diffMin < 1440) return t('hours_ago',   { n: Math.floor(diffMin / 60) });
    return t('days_ago', { n: Math.floor(diffMin / 1440) });
  }

  // ── Navigation ───────────────────────────────────────────────────────────

  function getUrlParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  function navigateTo(page, params) {
    if (!params) params = {};
    const qs = new URLSearchParams(params).toString();
    window.location.href = `${page}${qs ? '?' + qs : ''}`;
  }

  // ── Audio ────────────────────────────────────────────────────────────────

  function buildAudioUrl(fileName) {
    if (!fileName) return null;
    const m = fileName.match(/^(.+?)-\d+-(\d{4}-\d{2}-\d{2})-/);
    if (!m) return null;
    return `${BIRD_CONFIG.audioUrl}/By_Date/${encodeURIComponent(m[2])}/${encodeURIComponent(m[1])}/${encodeURIComponent(fileName)}`;
  }

  // ── Species links ────────────────────────────────────────────────────────

  /**
   * buildSpeciesLinks — external reference links for a species.
   * @param {string} comName - Common name
   * @param {string} sciName - Scientific name
   * @param {string} lang - Language code for Wikipedia (e.g. 'fr', 'en', 'nl', 'de')
   */
  // ── Confirm dialog (replaces native confirm()) ─────────────────────────
  function confirmDialog(message, { okLabel = 'OK', cancelLabel, danger = false } = {}) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'tl-popup-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5);';
      const box = document.createElement('div');
      box.style.cssText = 'background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius,.6rem);padding:1.2rem 1.5rem;max-width:400px;width:90vw;box-shadow:0 4px 20px rgba(0,0,0,.3);';
      box.setAttribute('role', 'alertdialog');
      box.setAttribute('aria-modal', 'true');
      const msg = document.createElement('div');
      msg.style.cssText = 'font-size:.9rem;margin-bottom:1rem;line-height:1.4;white-space:pre-line;';
      msg.textContent = message;
      const btns = document.createElement('div');
      btns.style.cssText = 'display:flex;gap:.5rem;justify-content:flex-end;';
      const cancel = document.createElement('button');
      cancel.textContent = cancelLabel || 'Annuler';
      cancel.style.cssText = 'padding:.4rem 1rem;border-radius:.3rem;border:1px solid var(--border);background:var(--bg-card2);color:var(--text-muted);cursor:pointer;font-size:.82rem;';
      const ok = document.createElement('button');
      ok.textContent = okLabel;
      ok.style.cssText = 'padding:.4rem 1rem;border-radius:.3rem;border:none;color:#fff;cursor:pointer;font-size:.82rem;font-weight:600;background:' + (danger ? '#e53e3e' : 'var(--accent)') + ';';
      btns.append(cancel, ok);
      box.append(msg, btns);
      overlay.append(box);
      document.body.append(overlay);
      ok.focus();
      function cleanup(result) { overlay.remove(); resolve(result); }
      ok.addEventListener('click', () => cleanup(true));
      cancel.addEventListener('click', () => cleanup(false));
      overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(false); });
      overlay.addEventListener('keydown', e => { if (e.key === 'Escape') cleanup(false); });
    });
  }

  // ── Focus trap for modals (A11Y) ──────────────────────────────────────
  function trapFocus(el) {
    const focusable = el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    first.focus();
    function handler(e) {
      if (e.key !== 'Tab') return;
      if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last.focus(); } }
      else { if (document.activeElement === last) { e.preventDefault(); first.focus(); } }
    }
    el.addEventListener('keydown', handler);
    return () => el.removeEventListener('keydown', handler);
  }

  function buildSpeciesLinks(comName, sciName, lang) {
    const sci     = encodeURIComponent(sciName || '');
    const sciWiki = (sciName || '').replace(/ /g, '_');
    var wikiLang  = 'fr';
    if (lang === 'nl') wikiLang = 'nl';
    else if (lang === 'de') wikiLang = 'de';
    else if (lang === 'en') wikiLang = 'en';
    else if (lang === 'fr') wikiLang = 'fr';
    else if (lang) wikiLang = lang;
  return {
      xenocanto:   { url: 'https://xeno-canto.org/explore?query=' + sci,           label: 'Xeno-canto',  icon: '\uD83C\uDFB5' },
      ebird:       { url: 'https://ebird.org/search?q=' + sci,                     label: 'eBird',        icon: '\uD83C\uDF0D' },
      wikipedia:   { url: 'https://' + wikiLang + '.wikipedia.org/wiki/' + sciWiki, label: 'Wikipedia',    icon: '\uD83D\uDCD6' },
      inaturalist: { url: 'https://www.inaturalist.org/taxa/search?q=' + sci,       label: 'iNaturalist',  icon: '\uD83D\uDD2C' },
      avibase:     { url: 'https://avibase.bsc-eoc.org/search.jsp?query=' + sci,    label: 'Avibase',      icon: '\uD83D\uDCCB' },
    };
  }

  // ── Species image ────────────────────────────────────────────────────────

  async function fetchSpeciesImage(sciName, lang) {
    if (!sciName) return null;
    var wikiLang = (lang && lang !== 'en') ? lang : 'en';
    var title = sciName.replace(/ /g, '_');
    try {
      // Try user's language first
      var res = await fetch(
        'https://' + wikiLang + '.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title)
      );
      if (res.ok) {
        var data = await res.json();
        if (data.thumbnail && data.thumbnail.source) return data.thumbnail.source.replace(/\/(\d+)px-/, '/150px-');
      }
      // Fallback to English if no image in user's language
      if (wikiLang !== 'en') {
        var res2 = await fetch(
          'https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title)
        );
        if (res2.ok) {
          var data2 = await res2.json();
          var u = (data2.thumbnail && data2.thumbnail.source) || null;
          return u ? u.replace(/\/(\d+)px-/, '/150px-') : null;
        }
      }
      return null;
    } catch(e) { return null; }
  }

  // ── Photo URL helper ─────────────────────────────────────────────────────
  // Single source of truth: server /api/photo handles caching + resolution.
  // No more client-side iNaturalist/Wikipedia fallbacks or localStorage cache.

  function photoUrl(sciName) {
    if (!sciName) return null;
    return BIRD_CONFIG.apiUrl + '/photo?sci=' + encodeURIComponent(sciName);
  }



  // ── Chart.js defaults ──────────────────────────────────────────────────

  function chartDefaults() {
    var cs     = getComputedStyle(document.documentElement);
    var txtC   = cs.getPropertyValue('--text-muted').trim()  || '#7a8a8e';
    var gridC  = (cs.getPropertyValue('--border').trim()     || '#243030') + '40';
    var accent = cs.getPropertyValue('--accent').trim()      || '#34d399';
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: txtC, usePointStyle: true, pointStyle: 'circle', boxWidth: 6 } },
        tooltip: {
          backgroundColor: cs.getPropertyValue('--bg-card').trim() || '#151b20',
          borderColor: accent + '40', borderWidth: 1,
          titleColor: '#fff', bodyColor: txtC,
        },
      },
      scales: {
        x: { ticks: { color: txtC }, grid: { color: gridC, lineWidth: 0.5 }, border: { display: false } },
        y: { ticks: { color: txtC }, grid: { color: gridC, lineWidth: 0.5 }, border: { display: false } },
      },
    };
  }

  // ── HTML escape (anti-XSS) ───────────────────────────────────────────

  function escHtml(str) {
    if (typeof str !== 'string') return String(str == null ? '' : str);
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── HTML sanitizer (for v-html) ─────────────────────────────────────
  // Uses DOMPurify if available, otherwise falls back to a strict whitelist
  // approach that strips anything not explicitly allowed.

  const _SAFE_TAGS = new Set([
    'p','br','strong','b','em','i','u','span','div',
    'table','thead','tbody','tfoot','tr','th','td','caption',
    'ul','ol','li','a','h1','h2','h3','h4','h5','h6',
    'img','svg','path','line','rect','circle','text',
  ]);
  const _SAFE_ATTRS = new Set([
    'style','class','title','href','target','rel','colspan','rowspan',
    'width','height','alt','src','loading','d','viewBox','stroke',
    'stroke-width','fill','cx','cy','r','x','y','x1','y1','x2','y2',
    'data-species',
  ]);

  function safeHtml(html) {
    if (!html) return '';
    // Prefer DOMPurify if loaded
    if (typeof DOMPurify !== 'undefined') {
      return DOMPurify.sanitize(html, {
        ALLOWED_TAGS: [..._SAFE_TAGS],
        ALLOWED_ATTR: [..._SAFE_ATTRS],
        ALLOW_DATA_ATTR: false,
      });
    }
    // Fallback: parse and whitelist via DOM
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      _sanitizeNode(doc.body);
      return doc.body.innerHTML;
    } catch(e) {
      return escHtml(html);
    }
  }

  function _sanitizeNode(node) {
    const children = [...node.childNodes];
    for (const child of children) {
      if (child.nodeType === 3) continue; // text node — safe
      if (child.nodeType !== 1) { child.remove(); continue; } // remove comments etc
      if (!_SAFE_TAGS.has(child.tagName.toLowerCase())) {
        child.remove();
        continue;
      }
      // Strip disallowed attributes
      for (const attr of [...child.attributes]) {
        if (!_SAFE_ATTRS.has(attr.name.toLowerCase())) {
          child.removeAttribute(attr.name);
        }
      }
      _sanitizeNode(child);
    }
  }

  // ── Model short labels ───────────────────────────────────────────────

  const _MODEL_SHORT = {
    'BirdNET_GLOBAL_6K_V2.4_Model_FP16': 'BirdNET',
    'BirdNET_6K_GLOBAL_MODEL':           'BirdNET v1',
    'Perch_v2':                          'Perch',
    'BirdNET-Go_classifier_20250916':    'BN-Go',
  };

  function shortModel(m) {
    if (!m) return '';
    return _MODEL_SHORT[m] || m.replace(/_/g, ' ');
  }

  // ── Spinner HTML ─────────────────────────────────────────────────────

  function spinnerHTML() {
    return '<div class="spinner"><div></div><div></div><div></div></div>';
  }

  // ── Taxonomy helper (shared across all pages) ──────────────────────────
  let _taxonomyCache = null;
  let _taxonomyCacheLang = null;

  const _TAXONOMY_CACHE_VER = 2; // Bump to invalidate sessionStorage

  async function loadTaxonomy(lang) {
    lang = lang || '';
    if (_taxonomyCache && _taxonomyCacheLang === lang) return _taxonomyCache;
    // Clean up legacy/stale cache keys
    try {
      sessionStorage.removeItem('birdash-taxonomy');
      const staleKeys = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith('birdash-taxonomy-') && !k.endsWith('-v' + _TAXONOMY_CACHE_VER))
          staleKeys.push(k);
      }
      staleKeys.forEach(k => sessionStorage.removeItem(k));
    } catch(e) {}
    // Try sessionStorage (keyed by lang + version)
    const cacheKey = `birdash-taxonomy-${lang || 'en'}-v${_TAXONOMY_CACHE_VER}`;
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) { _taxonomyCache = JSON.parse(cached); _taxonomyCacheLang = lang; return _taxonomyCache; }
    } catch(e) {}
    // Fetch from API
    try {
      const langParam = lang ? `?lang=${lang}` : '';
      const res = await fetch(`${BIRD_CONFIG.apiUrl}/taxonomy${langParam}`);
      const data = await res.json();
      if (data.species) {
        _taxonomyCache = data;
        _taxonomyCacheLang = lang;
        try { sessionStorage.setItem(cacheKey, JSON.stringify(data)); } catch(e) {}
        return data;
      }
    } catch(e) { console.warn('Could not load taxonomy:', e); }
    return { species: [], orders: {}, families: {} };
  }

  // Lookup taxonomy for a scientific name
  function getTaxonomy(sciName) {
    if (!_taxonomyCache) return null;
    return _taxonomyCache.species.find(s => s.sciName === sciName) || null;
  }

  // ── Quick play species (best detection audio) ──────────────────────────

  async function quickPlaySpecies(comName) {
    const rows = await birdQuery(
      "SELECT File_Name FROM detections WHERE Com_Name=? AND File_Name IS NOT NULL ORDER BY Confidence DESC LIMIT 1",
      [comName]
    );
    if (!rows.length) return null;
    var url = buildAudioUrl(rows[0].File_Name);
    if (!url) return null;
    // Use a shared audio element
    if (!window._birdashQuickAudio) window._birdashQuickAudio = new Audio();
    var audio = window._birdashQuickAudio;
    if (audio.src === url && !audio.paused) { audio.pause(); return audio; }
    audio.src = url;
    audio.play();
    return audio;
  }

  // ── Ecological Guilds ───────────────────────────────────────────────
  const ECOLOGICAL_GUILDS = {
    raptors:          { icon: '\uD83E\uDD85', orders: ['Accipitriformes', 'Falconiformes', 'Strigiformes'] },
    waterbirds:       { icon: '\uD83E\uDD86', orders: ['Anseriformes', 'Podicipediformes', 'Pelecaniformes', 'Charadriiformes', 'Gruiformes', 'Gaviiformes', 'Suliformes'] },
    woodpeckers:      { icon: '\uD83E\uDEB6', orders: ['Piciformes'] },
    passerines_forest:{ icon: '\uD83C\uDF32', families: ['Paridae', 'Sittidae', 'Certhiidae', 'Regulidae', 'Troglodytidae'] },
    passerines_open:  { icon: '\uD83C\uDF3E', families: ['Alaudidae', 'Motacillidae', 'Emberizidae', 'Fringillidae'] },
    thrushes_chats:   { icon: '\uD83D\uDC26', families: ['Turdidae', 'Muscicapidae'] },
    warblers:         { icon: '\uD83C\uDFB5', families: ['Sylviidae', 'Phylloscopidae', 'Acrocephalidae'] },
    corvids:          { icon: '\u2B1B',        families: ['Corvidae'] },
    swifts_swallows:  { icon: '\u2708\uFE0F',  families: ['Apodidae', 'Hirundinidae'] },
    pigeons_doves:    { icon: '\uD83D\uDD4A\uFE0F', orders: ['Columbiformes'] },
    other:            { icon: '\uD83D\uDC24' }
  };

  function getSpeciesGuild(order, family) {
    for (const [key, guild] of Object.entries(ECOLOGICAL_GUILDS)) {
      if (key === 'other') continue;
      if (guild.orders && guild.orders.includes(order)) return key;
      if (guild.families && guild.families.includes(family)) return key;
    }
    return 'other';
  }

  // ── Species frequency ranges (kHz) for spectrogram overlay ──────────

  const SPECIES_FREQ_RANGES = {
    // Common European species — frequency ranges in kHz (approximate)
    'Turdus merula': { min: 1.5, max: 6.5, label: 'Blackbird' },
    'Erithacus rubecula': { min: 2, max: 8, label: 'Robin' },
    'Parus major': { min: 3, max: 8, label: 'Great Tit' },
    'Cyanistes caeruleus': { min: 4, max: 10, label: 'Blue Tit' },
    'Phylloscopus collybita': { min: 3, max: 7, label: 'Chiffchaff' },
    'Sylvia atricapilla': { min: 2, max: 7, label: 'Blackcap' },
    'Fringilla coelebs': { min: 2, max: 8, label: 'Chaffinch' },
    'Pica pica': { min: 1, max: 5, label: 'Magpie' },
    'Columba palumbus': { min: 0.3, max: 1.5, label: 'Wood Pigeon' },
    'Strix aluco': { min: 0.5, max: 4, label: 'Tawny Owl' },
    'Dendrocopos major': { min: 1, max: 8, label: 'Great Spotted Woodpecker' },
    'Garrulus glandarius': { min: 1.5, max: 6, label: 'Jay' },
    'Troglodytes troglodytes': { min: 3, max: 10, label: 'Wren' },
    'Sitta europaea': { min: 2, max: 8, label: 'Nuthatch' },
    'Corvus corone': { min: 0.5, max: 3, label: 'Carrion Crow' },
    'Sturnus vulgaris': { min: 1, max: 8, label: 'Starling' },
    'Passer domesticus': { min: 2, max: 6, label: 'House Sparrow' },
    'Carduelis carduelis': { min: 3, max: 9, label: 'Goldfinch' },
    'Aegithalos caudatus': { min: 5, max: 10, label: 'Long-tailed Tit' },
    'Certhia brachydactyla': { min: 4, max: 9, label: 'Short-toed Treecreeper' },
  };

  // ── Favorites (DB-backed, localStorage fallback) ───────────────────────

  let _favCache = null; // [{com_name, sci_name, added_at}]
  const _FAV_KEY = 'birdash_favorites';

  let _favLoading = null;
  async function loadFavorites() {
    if (_favLoading) return _favLoading;
    _favLoading = (async () => {
      try {
        const res = await fetch(BIRD_CONFIG.apiUrl + '/favorites');
        if (res.ok) {
          _favCache = await res.json();
          localStorage.setItem(_FAV_KEY, JSON.stringify(_favCache.map(f => f.com_name)));
          return _favCache;
        }
      } catch(e) {}
      try { _favCache = (JSON.parse(localStorage.getItem(_FAV_KEY)) || []).map(n => ({ com_name: n })); }
      catch { _favCache = []; }
      return _favCache;
    })();
    const result = await _favLoading;
    _favLoading = null;
    return result;
  }

  function getFavorites() {
    if (_favCache) return _favCache.map(f => f.com_name);
    try { return JSON.parse(localStorage.getItem(_FAV_KEY)) || []; }
    catch { return []; }
  }

  function isFavorite(comName) {
    return getFavorites().includes(comName);
  }

  async function toggleFavorite(comName, sciName) {
    const isNowFav = !isFavorite(comName);
    try {
      const res = await fetch(BIRD_CONFIG.apiUrl + '/favorites', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ action: isNowFav ? 'add' : 'remove', com_name: comName, sci_name: sciName || '' }),
      });
      if (res.ok) {
        const data = await res.json();
        _favCache = data.favorites;
        localStorage.setItem(_FAV_KEY, JSON.stringify(_favCache.map(f => f.com_name)));
        return isNowFav;
      }
    } catch(e) {}
    // Fallback: toggle in localStorage
    const favs = getFavorites();
    if (isNowFav) favs.push(comName); else favs.splice(favs.indexOf(comName), 1);
    localStorage.setItem(_FAV_KEY, JSON.stringify(favs));
    _favCache = favs.map(n => ({ com_name: n }));
    return isNowFav;
  }

  // ── FFT & Spectrogram helpers (shared across pages) ────────────────────

  /**
   * Cooley-Tukey in-place FFT.
   * @param {Float32Array} re — real part (length must be power of 2)
   * @param {Float32Array} im — imaginary part (same length)
   */
  function fftInPlace(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [re[i],re[j]]=[re[j],re[i]]; [im[i],im[j]]=[im[j],im[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const wc = Math.cos(-Math.PI/half), ws = Math.sin(-Math.PI/half);
      for (let i = 0; i < n; i += len) {
        let wR = 1, wI = 0;
        for (let k = 0; k < half; k++) {
          const uR=re[i+k],uI=im[i+k],vR=re[i+k+half]*wR-im[i+k+half]*wI,vI=re[i+k+half]*wI+im[i+k+half]*wR;
          re[i+k]=uR+vR; im[i+k]=uI+vI; re[i+k+half]=uR-vR; im[i+k+half]=uI-vI;
          const nwR=wR*wc-wI*ws; wI=wR*ws+wI*wc; wR=nwR;
        }
      }
    }
  }

  /**
   * Build a 256-entry plasma colormap LUT (Uint8Array of 256*3 bytes).
   */
  function buildColorLUT() {
    const lut = new Uint8Array(256*3);
    const stops = [
      [0,[0,0,0]],[0.1,[20,0,50]],[0.25,[80,0,100]],
      [0.42,[180,20,80]],[0.58,[230,70,20]],[0.75,[255,155,0]],
      [0.90,[255,230,70]],[1.0,[255,255,255]],
    ];
    for (let i = 0; i < 256; i++) {
      const v = i/255; let s = 0;
      while (s < stops.length-2 && stops[s+1][0] <= v) s++;
      const [v0,c0]=stops[s],[v1,c1]=stops[s+1];
      const t = Math.min(1,(v-v0)/(v1-v0+1e-9));
      lut[i*3]=Math.round(c0[0]+t*(c1[0]-c0[0]));
      lut[i*3+1]=Math.round(c0[1]+t*(c1[1]-c0[1]));
      lut[i*3+2]=Math.round(c0[2]+t*(c1[2]-c0[2]));
    }
    return lut;
  }

  /** Singleton color LUT (built once). */
  const _COLOR_LUT = buildColorLUT();

  /**
   * Render a spectrogram onto a canvas from raw PCM data.
   * @param {Float32Array} pcm — mono audio samples
   * @param {number} sr — sample rate
   * @param {HTMLCanvasElement} canvas — target canvas
   * @param {object} [opts] — { fftSize:512, hopSize:128, maxHz:12000 }
   */
  function renderSpectrogram(pcm, sr, canvas, opts) {
    opts = opts || {};
    const FFT  = opts.fftSize || 512;
    const HOP  = opts.hopSize || (FFT / 4);
    const HALF = FFT / 2;
    const maxHz  = opts.maxHz || 12000;
    const maxBin = Math.min(HALF, Math.floor(maxHz / sr * FFT));
    const hann   = new Float32Array(FFT);
    for (let i = 0; i < FFT; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FFT - 1));

    const frames = [];
    for (let off = 0; off + FFT <= pcm.length; off += HOP) {
      const re = new Float32Array(FFT), im = new Float32Array(FFT);
      for (let i = 0; i < FFT; i++) re[i] = pcm[off + i] * hann[i];
      fftInPlace(re, im);
      const mag = new Float32Array(maxBin);
      for (let i = 1; i < maxBin; i++)
        mag[i] = 20 * Math.log10(Math.sqrt(re[i] * re[i] + im[i] * im[i]) / HALF + 1e-9);
      frames.push(mag);
    }
    if (frames.length === 0) return;

    const all = []; frames.forEach(f => f.forEach(v => all.push(v))); all.sort((a, b) => a - b);
    const lo  = all[Math.floor(all.length * 0.05)] || -80;
    const hi  = all[Math.floor(all.length * 0.995)] || -10;
    const rng = hi - lo || 1;

    const W = canvas.width, H = canvas.height;
    canvas.width = W; // clear
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(W, H);
    const d   = img.data;
    const lut = _COLOR_LUT;
    for (let px = 0; px < W; px++) {
      const frame = frames[Math.min(Math.floor(px / W * frames.length), frames.length - 1)];
      for (let py = 0; py < H; py++) {
        const bin = Math.floor((H - 1 - py) / H * maxBin);
        const v   = Math.max(0, Math.min(1, (frame[bin] - lo) / rng));
        const ci  = Math.min(255, Math.floor(v * 255)) * 3;
        const pi  = (py * W + px) * 4;
        d[pi] = lut[ci]; d[pi + 1] = lut[ci + 1]; d[pi + 2] = lut[ci + 2]; d[pi + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // ── DSP Pipeline ────────────────────────────────────────────────────────

  /** Fetch + decode audio URL to PCM. */
  async function fetchAndDecodeAudio(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const arrBuf = await resp.arrayBuffer();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const buf = await ctx.decodeAudioData(arrBuf);
    await ctx.close();
    return { pcm: buf.getChannelData(0).slice(), sr: buf.sampleRate, duration: buf.duration };
  }

  /** Highpass IIR 1st order — removes wind/traffic below cutHz. */
  function highpassIIR(pcm, sr, cutHz) {
    cutHz = cutHz || 850;
    const alpha = 1 / (1 + 2 * Math.PI * cutHz / sr);
    const out = new Float32Array(pcm.length);
    out[0] = pcm[0];
    for (let i = 1; i < pcm.length; i++) out[i] = alpha * (out[i-1] + pcm[i] - pcm[i-1]);
    return out;
  }

  /** Spectral subtraction with OLA reconstruction (phase-preserving). */
  function spectralSubtract(pcm, strength) {
    strength = strength ?? 0.8;
    const FFT = 512, HOP = 128, HALF = FFT / 2;
    const hann = new Float32Array(FFT);
    for (let i = 0; i < FFT; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FFT - 1));
    // Pass 1 — analyse
    const frames = [];
    for (let off = 0; off + FFT <= pcm.length; off += HOP) {
      const re = new Float32Array(FFT), im = new Float32Array(FFT);
      let energy = 0;
      for (let i = 0; i < FFT; i++) { re[i] = pcm[off + i] * hann[i]; energy += re[i] * re[i]; }
      fftInPlace(re, im);
      frames.push({ re, im, energy, off });
    }
    // Noise estimation (quietest 15%)
    const byEnergy = [...frames].sort((a, b) => a.energy - b.energy);
    const nCount = Math.max(2, Math.floor(frames.length * 0.15));
    const noiseMag = new Float32Array(HALF);
    for (let fi = 0; fi < nCount; fi++) {
      const { re, im } = byEnergy[fi];
      for (let k = 0; k < HALF; k++) noiseMag[k] += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    }
    for (let k = 0; k < HALF; k++) noiseMag[k] /= nCount;
    // Pass 2 — spectral modification + IFFT + OLA
    const out = new Float32Array(pcm.length), norm = new Float32Array(pcm.length);
    for (const { re, im, off } of frames) {
      for (let k = 0; k < HALF; k++) {
        const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
        const scale = mag > 1e-12 ? Math.max(mag - strength * noiseMag[k], 0.05 * mag) / mag : 0;
        re[k] *= scale; im[k] *= scale;
      }
      for (let k = 1; k < HALF; k++) { re[FFT - k] = re[k]; im[FFT - k] = -im[k]; }
      re[HALF] = 0; im[HALF] = 0;
      for (let k = 0; k < FFT; k++) im[k] = -im[k];
      fftInPlace(re, im);
      for (let i = 0; i < FFT; i++) {
        const n = off + i;
        if (n < out.length) { const w = hann[i]; out[n] += (re[i] / FFT) * w; norm[n] += w * w; }
      }
    }
    for (let i = 0; i < out.length; i++) if (norm[i] > 1e-10) out[i] /= norm[i];
    return out;
  }

  /** Full cleanup pipeline: highpass → spectral subtraction. */
  function cleanAudioPipeline(pcm, sr, strength) {
    return spectralSubtract(highpassIIR(pcm, sr, 850), strength);
  }

  /** Encode Float32 PCM → WAV mono 16-bit Blob. */
  function encodeWav(pcm, sr) {
    const ds = pcm.length * 2, buf = new ArrayBuffer(44 + ds), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + ds, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, ds, true);
    for (let i = 0; i < pcm.length; i++)
      v.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(pcm[i] * 32767))), true);
    return new Blob([buf], { type: 'audio/wav' });
  }

  // ── Export ─────────────────────────────────────────────────────────────

  window.BIRDASH_UTILS = {
    birdQuery: birdQuery,
    fmtDate: fmtDate,
    fmtTime: fmtTime,
    fmtConf: fmtConf,
    localDateStr: localDateStr,
    daysAgo: daysAgo,
    freshnessLabel: freshnessLabel,
    getUrlParam: getUrlParam,
    navigateTo: navigateTo,
    buildAudioUrl: buildAudioUrl,
    buildSpeciesLinks: buildSpeciesLinks,
    fetchSpeciesImage: fetchSpeciesImage,
    photoUrl: photoUrl,
    chartDefaults: chartDefaults,
    escHtml: escHtml,
    safeHtml: safeHtml,
    authHeaders: authHeaders,
    spinnerHTML: spinnerHTML,
    trapFocus: trapFocus,
    confirmDialog: confirmDialog,
    shortModel: shortModel,
    loadTaxonomy: loadTaxonomy,
    getTaxonomy: getTaxonomy,
    quickPlaySpecies: quickPlaySpecies,
    ECOLOGICAL_GUILDS: ECOLOGICAL_GUILDS,
    getSpeciesGuild: getSpeciesGuild,
    SPECIES_FREQ_RANGES: SPECIES_FREQ_RANGES,
    loadFavorites: loadFavorites,
    getFavorites: getFavorites,
    isFavorite: isFavorite,
    toggleFavorite: toggleFavorite,
    fftInPlace: fftInPlace,
    buildColorLUT: buildColorLUT,
    COLOR_LUT: _COLOR_LUT,
    renderSpectrogram: renderSpectrogram,
    drawSpectrogramFromPcm: renderSpectrogram,
    fetchAndDecodeAudio: fetchAndDecodeAudio,
    highpassIIR: highpassIIR,
    spectralSubtract: spectralSubtract,
    cleanAudioPipeline: cleanAudioPipeline,
    encodeWav: encodeWav,
  };

})(BIRD_CONFIG);
