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

  async function birdQuery(sql, params = []) {
    const res = await fetch(`${BIRD_CONFIG.apiUrl}/query`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ sql, params }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data.rows.map(row => {
      const obj = {};
      data.columns.forEach((col, i) => { obj[col] = row[i]; });
      return obj;
    });
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
    return `${BIRD_CONFIG.audioUrl}/By_Date/${m[2]}/${m[1]}/${encodeURIComponent(fileName)}`;
  }

  // ── Species links ────────────────────────────────────────────────────────

  /**
   * buildSpeciesLinks — external reference links for a species.
   * @param {string} comName - Common name
   * @param {string} sciName - Scientific name
   * @param {string} lang - Language code for Wikipedia (e.g. 'fr', 'en', 'nl', 'de')
   */
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

  // ── Cached photo (localStorage + API + fallbacks) ────────────────────────

  var PHOTO_TTL       = 30 * 24 * 3600 * 1000;
  var PHOTO_LS_PREFIX = 'birdash_photo_';

  async function fetchCachedPhoto(sciName) {
    if (!sciName) return null;

    // 1. localStorage — check TTL
    var lsKey = PHOTO_LS_PREFIX + sciName.replace(/[^a-zA-Z0-9]/g, '_');
    try {
      var cached = JSON.parse(localStorage.getItem(lsKey));
      if (cached && cached.url && (Date.now() - cached.ts < PHOTO_TTL)) {
        return cached.url;
      }
    } catch(e) {}

    var url = null;

    // 2. /api/photo (server disk cache)
    try {
      var apiUrl = BIRD_CONFIG.apiUrl + '/photo?sci=' + encodeURIComponent(sciName);
      var res = await fetch(apiUrl);
      if (res.ok) url = apiUrl;
    } catch(e) {}

    // 3. iNaturalist direct (if server unavailable)
    if (!url) {
      try {
        var tn  = encodeURIComponent(sciName);
        var res2 = await fetch(
          'https://api.inaturalist.org/v1/taxa?taxon_name=' + tn + '&rank=species&per_page=3'
        );
        if (res2.ok) {
          var data  = await res2.json();
          var taxon = null;
          if (data.results) {
            for (var i = 0; i < data.results.length; i++) {
              if (data.results[i].name.toLowerCase() === sciName.toLowerCase()) {
                taxon = data.results[i];
                break;
              }
            }
          }
          if (taxon && taxon.default_photo) {
            url = taxon.default_photo.square_url
               || taxon.default_photo.medium_url
               || taxon.default_photo.url
               || null;
          }
        }
      } catch(e) {}
    }

    // 4. Wikipedia direct
    if (!url) {
      try {
        var title = sciName.replace(/ /g, '_');
        var res3  = await fetch(
          'https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title)
        );
        if (res3.ok) {
          var wData = await res3.json();
          url = (wData.thumbnail && wData.thumbnail.source) || null;
          // Reduce Wikipedia thumbnail to 150px for performance
          if (url) url = url.replace(/\/(\d+)px-/, '/150px-');
        }
      } catch(e) {}
    }

    // Store in localStorage (even null — avoids re-fetching)
    try {
      localStorage.setItem(lsKey, JSON.stringify({ url: url, ts: Date.now() }));
    } catch(e) {}

    return url;
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
    'onclick',  // needed for biodiversity matrix navigation
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
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith('birdash-taxonomy-') && !k.endsWith('-v' + _TAXONOMY_CACHE_VER))
          sessionStorage.removeItem(k);
      }
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
    fetchCachedPhoto: fetchCachedPhoto,
    chartDefaults: chartDefaults,
    escHtml: escHtml,
    safeHtml: safeHtml,
    spinnerHTML: spinnerHTML,
    shortModel: shortModel,
    loadTaxonomy: loadTaxonomy,
    getTaxonomy: getTaxonomy,
  };

})(BIRD_CONFIG);
