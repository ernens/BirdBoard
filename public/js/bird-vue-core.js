/**
 * bird-vue-core.js — Vue 3 composables & components for BIRDASH
 *
 * Depends on: Vue 3 (CDN global), bird-config.js, bird-shared.js (BIRDASH_UTILS)
 *
 * Pure utility functions have been extracted to bird-shared.js.
 * This file contains only Vue-specific code: composables, components,
 * inline translations, and Service Worker registration.
 *
 * Expose via window.BIRDASH :
 *   useI18n(), useTheme(), useNav(), useChart(), useAudio(), useSpeciesNames()
 *   PibirdShell, BirdImg, registerComponents()
 *   + re-exports of BIRDASH_UTILS for backward compatibility
 */

;(function (Vue, BIRD_CONFIG, U) {
  'use strict';

  // ── Service Worker ────────────────────────────────────────────────────────
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('[SW] registration failed:', e.message));
  }

  // ── Global fetch interceptor: 401 → redirect to login ───────────────────
  // When AUTH_MODE is on, any API endpoint that requires auth answers 401.
  // Wrap fetch so the user lands on the login page instead of seeing an
  // empty card with a console error. Skip auth endpoints themselves
  // (status/login/logout) so the login form doesn't loop on itself.
  (function installAuthInterceptor() {
    if (window._birdashFetchWrapped) return;
    window._birdashFetchWrapped = true;
    const _origFetch = window.fetch.bind(window);
    const onLogin = /\/login\.html(\?|$)/.test(location.pathname);
    window.fetch = async function(input, init) {
      const res = await _origFetch(input, init);
      if (res.status === 401 && !onLogin) {
        const url = (typeof input === 'string') ? input : (input && input.url) || '';
        // Don't redirect on auth probe endpoints — they're allowed to return
        // 401 informationally without triggering navigation.
        if (!/\/api\/auth\/(login|logout|status)\b/.test(url)) {
          const here = location.pathname + location.search + location.hash;
          location.href = `login.html?redirect=${encodeURIComponent(here)}`;
        }
      }
      return res;
    };
  })();

  const { ref, computed, watch, onUnmounted, onMounted, nextTick, reactive } = Vue;

  // ── Spectrogram Modal — global reactive state ───────────────────────────
  const _spectroModal = Vue.reactive({
    open: false,
    fileName: '',
    speciesName: '',
    sciName: '',
    confidence: 0,
    date: '',
    time: ''
  });

  let _spectroFocusTrap = null;
    function openSpectroModal(opts) {
    Object.assign(_spectroModal, { open: true, ...opts });
  }
  function closeSpectroModal() {
    _spectroModal.open = false;
  }

  // ── i18n: all four languages loaded async from /i18n/*.json ──
  // Single source of truth — public/i18n/fr.json is now authoritative
  // for French (it used to live duplicated inline here, which caused
  // perpetual drift between the inline copy and the JSON file). The
  // empty bootstrap dict here is just so t() doesn't crash before the
  // fetch resolves; pages should await BIRDASH.i18nReady before
  // mounting Vue if they need translations on first paint.
  const _TRANSLATIONS = { fr: {}, en: {}, de: {}, nl: {} };
  const _AVAILABLE_LANGS = ['fr', 'en', 'de', 'nl'];

  const _i18nLoaded = (async () => {
    const base = (window.BIRD_CONFIG && window.BIRD_CONFIG.baseUrl) || '/birds';
    const results = await Promise.all(
      _AVAILABLE_LANGS.map(lang =>
        fetch(`${base}/i18n/${lang}.json`).then(r => r.json()).catch(e => {
          console.warn(`[i18n] Failed to load ${lang}:`, e.message);
          return null;
        })
      )
    );
    _AVAILABLE_LANGS.forEach((lang, i) => {
      if (results[i]) _TRANSLATIONS[lang] = results[i];
    });
  })();

  // ── Singletons réactifs (partagés dans toute l'app) ───────────────────────
  // Un seul ref par page — Vue garantit que tous les composables qui y accèdent
  // voient le même changement et réagissent de façon coordonnée.
  // Migrate old keys (birdash-theme → birdash_theme)
  if (localStorage.getItem('birdash-theme') && !localStorage.getItem('birdash_theme')) {
    localStorage.setItem('birdash_theme', localStorage.getItem('birdash-theme'));
    localStorage.removeItem('birdash-theme');
  }

  // First-visit lang: honour the browser's preference (navigator.language)
  // if it matches a supported lang, else fall back to French. Persisted
  // explicit choices in localStorage always win.
  function _detectInitialLang() {
    const stored = localStorage.getItem('birdash_lang');
    if (stored && _AVAILABLE_LANGS.includes(stored)) return stored;
    const langs = (navigator.languages && navigator.languages.length)
      ? navigator.languages : [navigator.language || ''];
    for (const l of langs) {
      const code = (l || '').toLowerCase().split('-')[0];
      if (_AVAILABLE_LANGS.includes(code)) return code;
    }
    return 'fr';
  }
  const _lang  = ref(_detectInitialLang());
  const _theme = ref(localStorage.getItem('birdash_theme') || 'forest');

  // Appliquer le thème et la langue immédiatement au chargement
  document.documentElement.setAttribute('data-theme', _theme.value);
  document.documentElement.lang = _lang.value;

  // ── useI18n ───────────────────────────────────────────────────────────────
  function useI18n() {
    /**
     * t(key, vars) — traduit une clé.
     * C'est une fonction régulière qui lit `_lang.value` — Vue détecte cette
     * dépendance dans tout `computed()` ou expression de template qui l'appelle.
     * Aucun addEventListener('langchange') nécessaire.
     */
    function t(key, vars = {}) {
      const dict = _TRANSLATIONS[_lang.value] || _TRANSLATIONS['fr'];
      const fb   = _TRANSLATIONS['fr'];
      let val = dict[key] !== undefined ? dict[key]
              : fb[key]   !== undefined ? fb[key]
              : key;
      if (Array.isArray(val)) return val;
      if (typeof val === 'string' && Object.keys(vars).length) {
        Object.entries(vars).forEach(([k, v]) => {
          val = val.replace(new RegExp('\\{' + k + '\\}', 'g'), v);
        });
      }
      return val;
    }

    function setLang(code) {
      if (!_TRANSLATIONS[code]) return;
      _lang.value = code;
      localStorage.setItem('birdash_lang', code);
      document.documentElement.lang = code;
      _applyPageTitle();
    }

    const langs = _AVAILABLE_LANGS.filter(code => _TRANSLATIONS[code]).map(code => ({
      code,
      label: _TRANSLATIONS[code]._meta.label,
      flag:  _TRANSLATIONS[code]._meta.flag,
    }));

    return { lang: _lang, t, setLang, langs };
  }

  // ── useTheme ──────────────────────────────────────────────────────────────
  const THEMES = [
    { id:'auto',        label:'Auto',         colors:['#0f1418','#faf8f4'] },
    { id:'forest',      label:'Forest',       colors:['#34d399','#0f1418'] },
    { id:'night',       label:'Night',        colors:['#a78bfa','#0e1018'] },
    { id:'paper',       label:'Paper',        colors:['#0d9488','#faf8f4'] },
    { id:'ocean',       label:'Ocean',        colors:['#22d3ee','#0a1220'] },
    { id:'dusk',        label:'Dusk',         colors:['#f472b6','#161218'] },
    { id:'sepia',       label:'Sepia',        colors:['#8b5a2b','#f5ecd9'] },
    { id:'colonial',    label:'Colonial',     colors:['#7a1e14','#e5d6b0'] },
    { id:'jungle',      label:'Jungle',       colors:['#3fb886','#0a1612'] },
    { id:'lab',         label:'Lab',          colors:['#0f5b6b','#ffffff'] },
    { id:'solar-light', label:'Solar Light',  colors:['#2aa198','#fdf6e3'] },
    { id:'solar-dark',  label:'Solar Dark',   colors:['#2aa198','#002b36'] },
    { id:'nord',        label:'Nord',         colors:['#88c0d0','#2e3440'] },
    { id:'hicontrast',  label:'High Contrast',colors:['#00ff88','#000000'] },
  ];

  function useTheme() {
    function setTheme(id) {
      _theme.value = id;
      localStorage.setItem('birdash_theme', id);
      document.documentElement.setAttribute('data-theme', id);
    }
    return { theme: _theme, themes: THEMES, setTheme };
  }

  // ── Format / locale / units preferences ───────────────────────────────────
  // Reactive prefs — changes flow through templates via Vue's Proxy tracking.
  // "auto" = derive from navigator.language.
  const _units      = ref(localStorage.getItem('birdash_units')       || 'auto'); // auto|metric|imperial
  const _timeFormat = ref(localStorage.getItem('birdash_time_format') || 'auto'); // auto|24h|12h
  const _dateFormat = ref(localStorage.getItem('birdash_date_format') || 'auto'); // auto|dmy|mdy|iso
  const _weekStart  = ref(localStorage.getItem('birdash_week_start')  || 'auto'); // auto|monday|sunday

  // Countries that still use US customary units day-to-day.
  const _IMPERIAL_REGIONS = new Set(['US', 'LR', 'MM']);

  function _region() {
    try { return new Intl.Locale(navigator.language || 'en-US').region || ''; } catch { return ''; }
  }
  function autoUnits()      { return _IMPERIAL_REGIONS.has(_region()) ? 'imperial' : 'metric'; }
  function autoTimeFormat() {
    try {
      const cycles = new Intl.Locale(navigator.language || 'en-US').hourCycles || [];
      if (cycles[0]) return cycles[0].startsWith('h1') && cycles[0] !== 'h23' ? '12h' : '24h';
    } catch {}
    return autoUnits() === 'imperial' ? '12h' : '24h';
  }
  function autoDateFormat() {
    const r = _region();
    if (r === 'US') return 'mdy';
    if (['CA','CN','JP','KR','TW','HK','SE'].includes(r)) return 'iso';
    return 'dmy';
  }
  function autoWeekStart() {
    const r = _region();
    return (r === 'US' || r === 'CA' || r === 'JP' || r === 'IL') ? 'sunday' : 'monday';
  }

  const effUnits      = computed(() => _units.value      === 'auto' ? autoUnits()      : _units.value);
  const effTimeFormat = computed(() => _timeFormat.value === 'auto' ? autoTimeFormat() : _timeFormat.value);
  const effDateFormat = computed(() => _dateFormat.value === 'auto' ? autoDateFormat() : _dateFormat.value);
  const effWeekStart  = computed(() => _weekStart.value  === 'auto' ? autoWeekStart()  : _weekStart.value);

  function _activeLang() {
    return localStorage.getItem('birdash_lang') || (navigator.language || 'en').slice(0, 2);
  }

  // Formatters — tolerant to null / NaN / strings-that-parse.
  function fmtTemp(celsius) {
    const c = Number(celsius);
    if (!Number.isFinite(c)) return '—';
    return effUnits.value === 'imperial'
      ? Math.round(c * 9 / 5 + 32) + '°F'
      : Math.round(c) + '°C';
  }
  function fmtWind(kmh) {
    const v = Number(kmh);
    if (!Number.isFinite(v)) return '—';
    return effUnits.value === 'imperial'
      ? Math.round(v / 1.60934) + ' mph'
      : Math.round(v) + ' km/h';
  }
  function fmtPressure(hpa) {
    const v = Number(hpa);
    if (!Number.isFinite(v)) return '—';
    return effUnits.value === 'imperial'
      ? (v * 0.02953).toFixed(2) + ' inHg'
      : Math.round(v) + ' hPa';
  }
  function fmtSize(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n < 0) return '—';
    const lang = _activeLang();
    const units = (lang === 'fr')
      ? ['o', 'Ko', 'Mo', 'Go', 'To']
      : ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0, val = n;
    while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
    const digits = i === 0 ? 0 : (val < 10 ? 1 : 0);
    return new Intl.NumberFormat(lang, { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(val) + ' ' + units[i];
  }
  // Backward-compatible: accepts Date, ISO "YYYY-MM-DD...", or "HH:MM[:SS]" string.
  function fmtTime(val) {
    if (val == null || val === '') return '\u2014';
    let h, m;
    if (val instanceof Date) {
      h = val.getHours(); m = val.getMinutes();
    } else if (typeof val === 'string' && /^\d{1,2}:\d{2}/.test(val)) {
      [h, m] = val.split(':').map(Number);
    } else {
      const d = new Date(val);
      if (isNaN(d)) return '\u2014';
      h = d.getHours(); m = d.getMinutes();
    }
    if (!Number.isFinite(h) || !Number.isFinite(m)) return '\u2014';
    if (effTimeFormat.value === '12h') {
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12 = h % 12 || 12;
      return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
    }
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  }

  // Backward-compatible: accepts Date, plain "YYYY-MM-DD" string, or timestamp.
  // Default short form honours the user's date-format preference (dmy/mdy/iso).
  // Pass { style:'long' } or { style:'medium' } for the localised word form.
  function fmtDate(val, opts) {
    opts = opts || {};
    if (val == null || val === '') return '\u2014';
    let d;
    if (val instanceof Date) {
      d = val;
    } else if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) {
      const [y, m, day] = val.slice(0, 10).split('-').map(Number);
      d = new Date(y, m - 1, day);
    } else {
      d = new Date(val);
    }
    if (isNaN(d)) return '\u2014';
    const lang = _activeLang();
    if (opts.style === 'long') {
      return d.toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    }
    if (opts.style === 'medium') {
      return d.toLocaleDateString(lang, { day: 'numeric', month: 'long', year: 'numeric' });
    }
    const y   = d.getFullYear();
    const mm  = String(d.getMonth() + 1).padStart(2, '0');
    const dd  = String(d.getDate()).padStart(2, '0');
    const f   = effDateFormat.value;
    if (f === 'iso') return `${y}-${mm}-${dd}`;
    if (f === 'mdy') return `${mm}/${dd}/${y}`;
    return `${dd}/${mm}/${y}`; // dmy (default)
  }
  function fmtDateTime(date) {
    return fmtDate(date) + ' ' + fmtTime(date);
  }
  function fmtNumber(n, digits) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    const d = digits == null ? 0 : digits;
    return new Intl.NumberFormat(_activeLang(), {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    }).format(v);
  }
  function fmtPercent(n, digits) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return fmtNumber(v, digits == null ? 0 : digits) + '%';
  }
  function firstDayOfWeek() {
    return effWeekStart.value === 'sunday' ? 0 : 1;
  }
  function unitLabel(kind) {
    const imp = effUnits.value === 'imperial';
    if (kind === 'temp')     return imp ? '°F'   : '°C';
    if (kind === 'wind')     return imp ? 'mph'  : 'km/h';
    if (kind === 'pressure') return imp ? 'inHg' : 'hPa';
    if (kind === 'precip')   return 'mm';
    return '';
  }

  function _persistPref(key, val) {
    if (val === 'auto' || val == null || val === '') localStorage.removeItem(key);
    else localStorage.setItem(key, val);
  }
  // Watchers keep localStorage in sync for both v-model bindings and programmatic setters.
  watch(_units,      v => _persistPref('birdash_units',       v));
  watch(_timeFormat, v => _persistPref('birdash_time_format', v));
  watch(_dateFormat, v => _persistPref('birdash_date_format', v));
  watch(_weekStart,  v => _persistPref('birdash_week_start',  v));

  function setUnits(v)      { _units.value      = v; }
  function setTimeFormat(v) { _timeFormat.value = v; }
  function setDateFormat(v) { _dateFormat.value = v; }
  function setWeekStart(v)  { _weekStart.value  = v; }

  function useFormat() {
    return {
      units: _units, timeFormat: _timeFormat, dateFormat: _dateFormat, weekStart: _weekStart,
      effUnits, effTimeFormat, effDateFormat, effWeekStart,
      fmtTemp, fmtWind, fmtPressure, fmtSize, fmtTime, fmtDate, fmtDateTime, fmtNumber, fmtPercent,
      firstDayOfWeek, unitLabel,
      setUnits, setTimeFormat, setDateFormat, setWeekStart,
      autoUnits, autoTimeFormat, autoDateFormat, autoWeekStart,
    };
  }

  // Global alias for vanilla-JS call sites (charts, non-Vue helpers).
  window.BirdFmt = useFormat();

  // ── Global site identity (shared across all useNav calls) ────────────────
  const _siteName  = ref('BirdStation');
  const _brandName = ref('BirdStation');
  const _siteElev  = ref(null);
  const _siteCoords = ref('');  // formatted "49.6970° N / 5.7452° E"
  let _siteIdentityLoaded = false;

  function _formatCoords(lat, lon) {
    const a = Number(lat), b = Number(lon);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return '';
    const ns = a >= 0 ? 'N' : 'S';
    const ew = b >= 0 ? 'E' : 'W';
    return `${Math.abs(a).toFixed(4)}° ${ns} / ${Math.abs(b).toFixed(4)}° ${ew}`;
  }

  function _loadSiteIdentity() {
    if (_siteIdentityLoaded) return;
    _siteIdentityLoaded = true;
    // Init from config
    _siteName.value = BIRD_CONFIG.siteName || (BIRD_CONFIG.location && BIRD_CONFIG.location.name) || 'BirdStation';
    _brandName.value = BIRD_CONFIG.brandName || 'BirdStation';
    // Override from API
    fetch(BIRD_CONFIG.apiUrl + '/settings').then(r => r.ok ? r.json() : {}).then(conf => {
      if (conf.SITE_NAME) {
        _siteName.value = conf.SITE_NAME;
        _applyPageTitle();
      }
      if (conf.SITE_BRAND) _brandName.value = conf.SITE_BRAND;
      if (conf.ELEVATION != null && conf.ELEVATION !== '') {
        const n = Number(conf.ELEVATION);
        if (Number.isFinite(n)) _siteElev.value = Math.round(n);
      }
      _siteCoords.value = _formatCoords(conf.LATITUDE, conf.LONGITUDE);
    }).catch(() => {});
  }

  // Update site identity (called from settings page after save)
  function updateSiteIdentity(name, brand) {
    if (name != null) {
      _siteName.value = name;
      _applyPageTitle();
    }
    if (brand != null) _brandName.value = brand;
  }

  // ── Page title localisation ──────────────────────────────────────────────
  // Map URL filename → i18n key. Pages omitted here keep their static
  // <title> (test pages, redirects, anything not user-facing). The site
  // name prefix is _siteName (settable by the user); the suffix is the
  // localised page label.
  const _PAGE_TITLE_KEYS = {
    'analyses':         'page_title_analyses',
    'biodiversity':     'page_title_biodiversity',
    'calendar':         'page_title_calendar',
    'compare':          'page_title_compare',
    'comparison':       'page_title_comparison',
    'dashboard':        'page_title_dashboard',
    'dashboard-kiosk':  'page_title_dashboard_kiosk',
    'detections':       'page_title_detections',
    'favorites':        'page_title_favorites',
    'gallery':          'page_title_gallery',
    'liveboard':        'page_title_liveboard',
    'log':              'page_title_log',
    'login':            'page_title_login',
    'models':           'page_title_models',
    'overview':         'page_title_overview',
    'phenology':        'page_title_phenology',
    'purge':            'page_title_purge',
    'quality':          'page_title_quality',
    'rarities':         'page_title_rarities',
    'recent':           'page_title_recent',
    'recordings':       'page_title_recordings',
    'review':           'page_title_review',
    'settings':         'page_title_settings',
    'species':          'page_title_species',
    'spectrogram':      'page_title_spectrogram',
    'stats':            'page_title_stats',
    'system':           'page_title_system',
    'timeline':         'page_title_timeline',
    'today':            'page_title_today',
    'weather':          'page_title_weather',
  };
  function _applyPageTitle() {
    const m = (location.pathname || '').match(/\/([^\/]+?)\.html?$/i);
    const slug = m ? m[1].toLowerCase() : '';
    const key = _PAGE_TITLE_KEYS[slug];
    if (!key) return;  // unknown page — leave the static <title> alone
    const dict = _TRANSLATIONS[_lang.value] || _TRANSLATIONS['fr'];
    const fb   = _TRANSLATIONS['fr'];
    const suffix = (dict[key] !== undefined ? dict[key] : (fb[key] !== undefined ? fb[key] : '')) || '';
    if (!suffix) return;  // i18n not loaded yet
    document.title = `${_siteName.value || 'BirdStation'} — ${suffix}`;
  }
  // Apply once the i18n dicts have loaded.
  _i18nLoaded.then(_applyPageTitle);

  // ── useNav ────────────────────────────────────────────────────────────────
  const NAV_KEYS = {
    dashboard:    'nav_dashboard',
    overview:     'nav_overview',
    today:        'nav_today',
    calendar:     'nav_calendar',
    timeline:     'tl_title',
    recent:       'nav_recent',
    detections:   'nav_detections',
    species:      'nav_species',
    biodiversity: 'nav_biodiversity',
    rarities:     'nav_rarities',
    stats:        'nav_stats',
    analyses:     'nav_analyses',
    models:       'nav_models',
    review:       'nav_review',
    gallery:      'nav_gallery',
    spectrogram:  'nav_spectrogram',
    recordings:   'nav_recordings',
    settings:     'nav_settings',
    system:       'nav_system',
    phenology:    'nav_phenology',
    comparison:   'nav_comparison',
    favorites:    'nav_favorites',
    weather:      'nav_weather',
    log:          'nav_log',
    purge:        'nav_purge',
    quality:      'nav_quality',
    liveboard:    'nav_liveboard',
    dashboard_kiosk: 'nav_dashboard_kiosk',
    network:      'nav_network',
  };

  function useNav(pageId) {
    const { t } = useI18n();
    const navSections = computed(() =>
      (BIRD_CONFIG.nav || []).map(sec => ({
        section: t(sec.section),
        icon: sec.icon || '',
        items: sec.items.map(p => ({
          ...p,
          label:  t(NAV_KEYS[p.id] || p.id),
          active: p.id === pageId,
        })),
      }))
    );
    // Flat list for backwards compat
    const navItems = computed(() => navSections.value.flatMap(s => s.items));
    _loadSiteIdentity();
    return { navItems, navSections, siteName: _siteName, brandName: _brandName, siteElev: _siteElev, siteCoords: _siteCoords };
  }

  // ── useChart ──────────────────────────────────────────────────────────────
  /**
   * Wrapper Chart.js avec gestion automatique du destroy.
   * Usage dans setup() :
   *   const { mountChart } = useChart();
   *   watch(data, () => mountChart(canvasRef, config));
   */
  function useChart() {
    let _instance = null;

    function mountChart(canvasRef, configFn) {
      if (!canvasRef.value) return;
      if (_instance) { _instance.destroy(); _instance = null; }
      const ctx = canvasRef.value.getContext('2d');
      _instance = new Chart(ctx, configFn());
    }

    // Cleanup auto si le composant est démonté
    onUnmounted(() => { if (_instance) { _instance.destroy(); _instance = null; } });

    return { mountChart };
  }

  /** Export a canvas chart as PNG download. */
  function exportChart(canvasRef, filename) {
    const canvas = canvasRef.value || canvasRef;
    if (!canvas || !canvas.toDataURL) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = (filename || 'chart') + '.png';
    a.click();
  }

  // ── Utility references from bird-shared.js (BIRDASH_UTILS) ──────────────
  // Pure utility functions are defined in bird-shared.js and accessed via U.
  // Wrappers below provide backward compatibility and inject reactive state
  // (e.g. current language) where needed.

  // buildSpeciesLinks wrapper: auto-injects current reactive language
  function buildSpeciesLinks(comName, sciName) {
    return U.buildSpeciesLinks(comName, sciName, _lang.value);
  }

  // ── useToast ────────────────────────────────────────────────────────────
  const _toasts = ref([]);
  let _toastId = 0;

  function useToast() {
    function show(msg, type = 'error', duration = 4000) {
      const id = ++_toastId;
      _toasts.value.push({ id, msg, type });
      setTimeout(() => {
        _toasts.value = _toasts.value.filter(t => t.id !== id);
      }, duration);
    }
    // Listen for global error events
    if (typeof window !== 'undefined') {
      window.addEventListener('birdash:error', (e) => {
        show(e.detail || 'Unknown error', 'error');
      });
      window.addEventListener('birdash:success', (e) => {
        show(e.detail || 'OK', 'success', 2500);
      });
    }
    return { toasts: _toasts, showToast: show };
  }

  // ── useFavorites ────────────────────────────────────────────────────────
  function useFavorites() {
    const favorites = ref(U.getFavorites());

    // Load from DB on first use
    U.loadFavorites().then(() => { favorites.value = U.getFavorites(); });

    async function toggle(comName, sciName) {
      await U.toggleFavorite(comName, sciName);
      favorites.value = U.getFavorites();
    }

    function isFav(comName) {
      return favorites.value.includes(comName);
    }

    return { favorites, toggleFavorite: toggle, isFavorite: isFav };
  }

  // ── useAudio ──────────────────────────────────────────────────────────────
  function useAudio() {
    let _current = null;
    const playingFile = ref(null);

    function toggleAudio(fileName) {
      const url = U.buildAudioUrl(fileName);
      if (!url) return;

      if (_current && playingFile.value === fileName) {
        _current.pause();
        _current = null;
        playingFile.value = null;
        return;
      }

      if (_current) { _current.pause(); _current = null; }

      const audio = new Audio(url);
      _current = audio;
      playingFile.value = fileName;

      audio.play().catch(() => { playingFile.value = null; _current = null; });
      audio.addEventListener('ended', () => { playingFile.value = null; _current = null; });
    }

    onUnmounted(() => { if (_current) { _current.pause(); _current = null; } });

    return { playingFile, toggleAudio };
  }


  // ── useAudioPlayer ──────────────────────────────────────────────────────
  // Shared audio player composable for spectrogram pages.
  // Options: { filters: false } — set true to enable Web Audio gain/HP/LP.
  function useAudioPlayer(opts = {}) {
    let _audio = null, _rafId = null;
    const isPlaying        = ref(false);
    const audioProgress    = ref(0);
    const audioCurrentTime = ref(0);
    const audioDuration    = ref(0);

    // Filter support (opt-in)
    const filters = opts.filters ? Vue.reactive({ gain: 0, highpass: 0, lowpass: 0 }) : null;
    let _audioCtx = null, _sourceNode = null, _gainNode = null, _hpNode = null, _lpNode = null;

    function _buildFilterChain() {
      if (!_audioCtx || !_audio || _sourceNode) return;
      _sourceNode = _audioCtx.createMediaElementSource(_audio);
      _gainNode = _audioCtx.createGain();
      _gainNode.gain.value = Math.pow(10, (filters?.gain || 0) / 20);
      _hpNode = _audioCtx.createBiquadFilter();
      _hpNode.type = 'highpass'; _hpNode.frequency.value = filters?.highpass || 0;
      _lpNode = _audioCtx.createBiquadFilter();
      _lpNode.type = 'lowpass'; _lpNode.frequency.value = filters?.lowpass || (_audioCtx.sampleRate / 2);
      _sourceNode.connect(_hpNode); _hpNode.connect(_lpNode); _lpNode.connect(_gainNode); _gainNode.connect(_audioCtx.destination);
    }

    function setFilter(key, val) {
      if (!filters) return;
      filters[key] = val;
      if (_gainNode && key === 'gain') _gainNode.gain.value = Math.pow(10, val / 20);
      if (_hpNode && key === 'highpass') _hpNode.frequency.value = val || 0;
      if (_lpNode && key === 'lowpass') _lpNode.frequency.value = val || (_audioCtx ? _audioCtx.sampleRate / 2 : 22050);
    }

    function _startRaf() {
      if (_rafId) return;
      function tick() {
        if (_audio && !_audio.paused && _audio.duration) {
          audioCurrentTime.value = _audio.currentTime;
          audioProgress.value    = _audio.currentTime / _audio.duration;
          _rafId = requestAnimationFrame(tick);
        } else { _rafId = null; }
      }
      _rafId = requestAnimationFrame(tick);
    }
    function _stopRaf() { if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; } }

    function play(url) {
      if (!url) return;
      if (_audio && isPlaying.value)  { _audio.pause(); return; }
      if (_audio && !isPlaying.value) { _audio.play().catch(()=>{}); return; }
      if (filters) {
        if (!_audioCtx || _audioCtx.state === 'closed') {
          _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        _sourceNode = null;
      }
      _audio = new Audio(url);
      if (filters) { _audio.crossOrigin = 'anonymous'; _buildFilterChain(); }
      _audio.addEventListener('play',  () => { isPlaying.value = true; audioDuration.value = _audio.duration || 0; _startRaf(); });
      _audio.addEventListener('pause', () => { isPlaying.value = false; _stopRaf(); });
      _audio.addEventListener('ended', () => { isPlaying.value = false; audioProgress.value = 0; audioCurrentTime.value = 0; _stopRaf(); });
      _audio.addEventListener('loadedmetadata', () => { audioDuration.value = _audio.duration || 0; });
      _audio.play().catch(() => {});
    }

    function stop() {
      _stopRaf();
      if (_audio) { _audio.pause(); _audio = null; }
      _sourceNode = null;
      isPlaying.value = false; audioProgress.value = 0;
      audioCurrentTime.value = 0; audioDuration.value = 0;
    }

    function seekFraction(fraction) {
      if (_audio && _audio.duration) _audio.currentTime = fraction * _audio.duration;
    }
    function seekFromEvent(e) {
      if (!_audio || !_audio.duration) return;
      const rect = e.currentTarget.getBoundingClientRect();
      _audio.currentTime = ((e.clientX - rect.left) / rect.width) * _audio.duration;
    }

    function fmtDuration(s) {
      if (!s) return '0:00';
      return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
    }

    onUnmounted(() => { stop(); if (_audioCtx) { try { _audioCtx.close(); } catch{} _audioCtx = null; } });

    const result = { isPlaying, audioProgress, audioCurrentTime, audioDuration, play, stop, seekFraction, seekFromEvent, fmtDuration };
    if (filters) { result.filters = filters; result.setFilter = setFilter; }
    return result;
  }

  // ── Species name translation (BirdNET labels) ───────────────────────────
  // Shared cache: { 'fr': { 'Pica pica': 'Pie bavarde' }, 'en': { ... } }
  const _spNamesCache = {};   // lang → { sci → comName }
  const _spNamesLoading = {}; // lang → Promise

  /**
   * Load species name mapping for a given language.
   * Uses BirdNET l18n label files served via /api/species-names?lang=xx
   * Returns the mapping object { sciName: translatedComName }
   */
  async function _loadSpNames(lang) {
    if (_spNamesCache[lang]) return _spNamesCache[lang];
    if (_spNamesLoading[lang]) return _spNamesLoading[lang];

    _spNamesLoading[lang] = (async () => {
      try {
        const res = await fetch(`${BIRD_CONFIG.apiUrl}/species-names?lang=${lang}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        _spNamesCache[lang] = await res.json();
      } catch(e) {
        console.warn(`[spNames] Failed to load ${lang}:`, e.message);
        _spNamesCache[lang] = {};
      }
      delete _spNamesLoading[lang];
      return _spNamesCache[lang];
    })();

    return _spNamesLoading[lang];
  }

  /**
   * useSpeciesNames() — composable for translated species names.
   *
   * Returns:
   *   spName(comName, sciName) — returns the translated common name
   *   spNamesReady            — ref(bool) true when names are loaded
   *
   * Auto-reloads when the language changes.
   */
  function useSpeciesNames() {
    const spNamesReady = ref(false);
    const _names = ref({});

    async function reload(lang) {
      spNamesReady.value = false;
      _names.value = await _loadSpNames(lang);
      spNamesReady.value = true;
    }

    // Load immediately + watch lang changes
    reload(_lang.value);
    watch(_lang, (newLang) => reload(newLang));

    /**
     * Translate a species name.
     * @param {string} comName - Original Com_Name from the database
     * @param {string} sciName - Sci_Name (used as lookup key)
     * @returns {string} Translated name, or original comName as fallback
     */
    function spName(comName, sciName) {
      if (!sciName || !_names.value) return comName || '';
      return _names.value[sciName] || comName || sciName;
    }

    return { spName, spNamesReady };
  }

  // ── Filter composables ───────────────────────────────────────────────────
  // Reusable, standardised filter logic for all pages.

  /**
   * useFilterPeriod — date range + quick-period buttons.
   * @param {Object} opts
   * @param {string}   opts.default       - initial period key ('1d','7d','30d','90d','6m','1y','all')
   * @param {string[]} opts.buttons       - which quick buttons to show (default all 7)
   * @param {Function} opts.onChange       - called after any change
   */
  function useFilterPeriod(opts = {}) {
    const { t } = useI18n();
    const defaultPeriod = opts.default || '7d';
    const btnKeys = opts.buttons || ['1d','7d','30d','90d','1y','all'];

    const period   = ref(defaultPeriod);
    const dateFrom = ref('');
    const dateTo   = ref('');

    const PERIOD_LABELS = { '1d':'quick_1d','7d':'quick_7d','30d':'quick_30d','90d':'quick_90d',
      '1m':'quick_1m','3m':'quick_3m','6m':'quick_6m','1y':'quick_1y','all':'quick_all' };
    const PERIOD_DAYS = { '1d':0,'7d':6,'30d':29,'1m':29,'90d':89,'3m':89,'6m':179,'1y':364,'all':null };

    function periodToDates(key) {
      const today = U.localDateStr();
      if (key === 'all') return { from: '1900-01-01', to: today };
      const days = PERIOD_DAYS[key];
      return { from: days != null ? U.daysAgo(days) : '', to: today };
    }

    function setPeriod(key) {
      period.value = key;
      const d = periodToDates(key);
      dateFrom.value = d.from;
      dateTo.value   = d.to;
      if (opts.onChange) opts.onChange();
    }

    function setCustomRange(from, to) {
      period.value   = 'custom';
      dateFrom.value = from;
      dateTo.value   = to;
      if (opts.onChange) opts.onChange();
    }

    const quickButtons = computed(() =>
      btnKeys.map(key => ({
        key,
        label: t(PERIOD_LABELS[key] || key),
        active: period.value === key
      }))
    );

    // Initialise dates from default period
    const init = periodToDates(defaultPeriod);
    dateFrom.value = init.from;
    dateTo.value   = init.to;

    return { period, dateFrom, dateTo, quickButtons, setPeriod, setCustomRange };
  }

  /**
   * useFilterConfidence — slider + editable percentage.
   * @param {Object} opts
   * @param {number} opts.default  - initial value 0-1 (default: BIRD_CONFIG.defaultConfidence)
   * @param {Function} opts.onChange
   */
  function useFilterConfidence(opts = {}) {
    const confidence  = ref(opts.default != null ? opts.default : BIRD_CONFIG.defaultConfidence);
    const confEditing = ref(false);
    const confEditVal = ref(Math.round(confidence.value * 100));
    const confInput   = ref(null); // template ref

    function startEdit() {
      confEditVal.value = Math.round(confidence.value * 100);
      confEditing.value = true;
      nextTick(() => { if (confInput.value) { confInput.value.select(); } });
    }
    function commitEdit() {
      let v = parseInt(confEditVal.value, 10);
      if (isNaN(v)) v = 0;
      v = Math.max(0, Math.min(100, v));
      confidence.value  = v / 100;
      confEditing.value = false;
      if (opts.onChange) opts.onChange();
    }

    return { confidence, confEditing, confEditVal, confInput, startEdit, commitEdit };
  }

  /**
   * useFilterSpecies — multi-select or search-only species filter.
   * @param {Object} opts
   * @param {import('vue').Ref} opts.source  - ref to [{name, sci, count}]
   * @param {Function} opts.spName           - translation function (comName, sciName) → string
   * @param {Function} opts.onChange
   */
  function useFilterSpecies(opts = {}) {
    const selectedSpecies = ref([]);
    const speciesSearch   = ref('');

    const filteredList = computed(() => {
      const src = opts.source ? opts.source.value : [];
      const q = speciesSearch.value.toLowerCase();
      if (!q) return src;
      const spN = opts.spName || ((n) => n);
      return src.filter(s =>
        spN(s.name, s.sci).toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q)
      );
    });

    const allSelected = computed(() =>
      opts.source && opts.source.value.length > 0 &&
      selectedSpecies.value.length === opts.source.value.length
    );

    function toggleAll() {
      if (allSelected.value) {
        selectedSpecies.value = [];
      } else {
        selectedSpecies.value = (opts.source ? opts.source.value : []).map(s => s.name);
      }
      if (opts.onChange) opts.onChange();
    }

    function toggleSpecies(name) {
      const idx = selectedSpecies.value.indexOf(name);
      if (idx >= 0) selectedSpecies.value.splice(idx, 1);
      else selectedSpecies.value.push(name);
      if (opts.onChange) opts.onChange();
    }

    function removeSpecies(name) {
      const idx = selectedSpecies.value.indexOf(name);
      if (idx >= 0) selectedSpecies.value.splice(idx, 1);
      if (opts.onChange) opts.onChange();
    }

    return { selectedSpecies, speciesSearch, filteredList, allSelected, toggleAll, toggleSpecies, removeSpecies };
  }

  /**
   * buildWhereClause — shared SQL WHERE builder.
   * @param {Object} filters
   * @param {string[]} filters.species    - Com_Name list (empty = no filter)
   * @param {string}   filters.dateFrom
   * @param {string}   filters.dateTo
   * @param {number}   filters.confidence - 0-1
   * @param {string[]} filters.extraWhere - additional raw clauses
   * @param {any[]}    filters.extraParams
   * @returns {{ where: string, params: any[] }}
   */
  function buildWhereClause(filters = {}) {
    const clauses = ['1=1'];
    const params  = [];
    if (filters.species && filters.species.length) {
      if (filters.species.length === 1) {
        clauses.push('Com_Name = ?'); params.push(filters.species[0]);
      } else {
        clauses.push('Com_Name IN (' + filters.species.map(() => '?').join(',') + ')');
        params.push(...filters.species);
      }
    }
    if (filters.dateFrom) { clauses.push('Date >= ?'); params.push(filters.dateFrom); }
    if (filters.dateTo)   { clauses.push('Date <= ?'); params.push(filters.dateTo); }
    { const c = filters.confidence > 0 ? filters.confidence : (filters.noConfidenceDefault ? 0 : BIRD_CONFIG.defaultConfidence); if (c > 0) { clauses.push('Confidence >= ?'); params.push(c); } }
    if (filters.extraWhere) {
      for (let i = 0; i < filters.extraWhere.length; i++) {
        clauses.push(filters.extraWhere[i]);
      }
    }
    if (filters.extraParams) params.push(...filters.extraParams);
    return { where: clauses.join(' AND '), params };
  }

  // ── Composant PibirdShell ─────────────────────────────────────────────────
  // Encapsule le header, la navigation, les switchers thème/langue et le <main>.
  // Usage : <birdash-shell page="species"> … contenu … </birdash-shell>
  // ── Model display names ────────────────────────────────────────────────
  const MODEL_LABELS = {
    'BirdNET_GLOBAL_6K_V2.4_Model_FP16':           'BirdNET V2.4',
    'BirdNET_GLOBAL_6K_V2.4_Model_FP32':           'BirdNET V2.4',
    'BirdNET_GLOBAL_6K_V2.4_MData_Model_FP16':     'BirdNET V2.4 MData',
    'BirdNET_GLOBAL_6K_V2.4_MData_Model_V2_FP16':  'BirdNET V2.4 MData V2',
    'BirdNET_6K_GLOBAL_MODEL':                      'BirdNET V1',
    'Perch_v2':                                     'Perch V2',
    'Perch_v2_int8':                                'Perch V2 INT8',
    'perch_v2_original':                            'Perch V2 FP32',
    'perch_v2_fp16':                                'Perch V2 FP16',
    'perch_v2_dynint8':                             'Perch V2 INT8',
  };

  const PibirdShell = {
    props: {
      page:  { type: String, default: '' },
      title: { type: String, default: '' },
    },
    setup(props) {
      const { lang, t, setLang, langs } = useI18n();
      const { theme, themes, setTheme } = useTheme();
      const { navItems, navSections, siteName, brandName, siteElev, siteCoords } = useNav(props.page);
      const { toasts } = useToast();
      // Open the section containing the current page by default
      const openSection = ref(-1); // dropdown closed by default
      const hoverSection = ref(-1);
      function navSectionClick(si) {
        if (openSection.value === si) { openSection.value = -1; return; }
        openSection.value = si;
      }
      function navGo(file) { window.location.href = file; }
      // Close dropdown when clicking outside
      if (typeof document !== 'undefined') {
        document.addEventListener('click', (e) => {
          if (!e.target.closest('.nav-section-wrap')) openSection.value = -1;
        });
        document.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') openSection.value = -1;
        });
      }
      const { spName, spNamesReady }    = useSpeciesNames();
      const langOpen = ref(false);
      const themeOpen = ref(false);
      const currentLang = computed(() => langs.find(l => l.code === lang.value) || langs[0]);
      const currentTheme = computed(() => themes.find(th => th.id === theme.value) || themes[0]);
      // App version shown in the header sub-brand. Fetched once from
      // /api/update-status (which calls git describe). Updated when the
      // user applies an update via the dashboard.
      const appVersion = ref('');
      fetch(`${BIRD_CONFIG.apiUrl}/update-status`).then(r => r.json()).then(d => {
        if (d && d.currentVersion) appVersion.value = d.currentVersion;
      }).catch(() => {});
      window.addEventListener('birdash:settings-changed', () => {
        fetch(`${BIRD_CONFIG.apiUrl}/update-status?refresh=1`).then(r => r.json()).then(d => {
          if (d && d.currentVersion) appVersion.value = d.currentVersion;
        }).catch(() => {});
      });

      const modelName = ref('');
      function refreshModelBadge() {
        fetch(`${BIRD_CONFIG.apiUrl}/settings`).then(r => r.json()).then(conf => {
          const raw = conf.MODEL || '';
          const primary = MODEL_LABELS[raw] || raw.replace(/_/g, ' ');
          if (conf.DUAL_MODEL_ENABLED === '1' && conf.SECONDARY_MODEL) {
            const sec = MODEL_LABELS[conf.SECONDARY_MODEL] || conf.SECONDARY_MODEL.replace(/_/g, ' ');
            modelName.value = primary + ' + ' + sec;
          } else {
            modelName.value = primary;
          }
        }).catch(() => {});
      }
      refreshModelBadge();
      // Re-fetch when settings.html saves (model change, site name, etc.)
      window.addEventListener('birdash:settings-changed', refreshModelBadge);

      // ── Global search bar ──────────────────────────────────────────────
      const searchQuery = ref('');
      const searchOpen = ref(false);
      const searchExpanded = ref(false);
      const searchHighlight = ref(-1);
      const searchInputRef = ref(null);
      const dbSpecies = ref([]);

      // Load species list from DB once
      U.birdQuery('SELECT DISTINCT Com_Name, Sci_Name FROM detections ORDER BY Com_Name')
        .then(rows => { dbSpecies.value = rows; })
        .catch(() => {});

      // Parse date from search query (e.g. "3 avril", "03/04", "2026-04-03")
      const _months = {
        jan:1,fev:2,fév:2,feb:2,mar:3,avr:4,apr:4,mai:5,may:5,jun:6,juin:6,jul:7,juil:7,
        aug:8,aou:8,aoû:8,sep:9,oct:10,nov:11,dec:12,déc:12
      };
      function _parseDate(q) {
        // YYYY-MM-DD
        let m = q.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
        // DD/MM or DD/MM/YYYY
        m = q.match(/(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?/);
        if (m) { const y = m[3] ? (m[3].length===2 ? '20'+m[3] : m[3]) : new Date().getFullYear(); return `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`; }
        // "3 avril" or "avril 3"
        m = q.match(/(\d{1,2})\s+([a-zéûô]+)/i) || q.match(/([a-zéûô]+)\s+(\d{1,2})/i);
        if (m) {
          const day = m[1].match(/\d/) ? m[1] : m[2];
          const mon = m[1].match(/\d/) ? m[2] : m[1];
          const mk = mon.toLowerCase().substring(0,3);
          if (_months[mk]) return `${new Date().getFullYear()}-${String(_months[mk]).padStart(2,'0')}-${day.padStart(2,'0')}`;
        }
        return null;
      }

      const searchResults = computed(() => {
        const q = (searchQuery.value || '').trim().toLowerCase();
        if (!q) return [];
        const results = [];

        // Check for date in query
        const parsedDate = _parseDate(q);
        if (parsedDate) {
          const dateLabel = new Date(parsedDate+'T12:00:00').toLocaleDateString(_lang.value, {weekday:'long',day:'numeric',month:'long'});
          results.push({ type:'date', date: parsedDate, displayName: '📆 ' + dateLabel, comName: '' });
        }

        // Species search (filter out date tokens)
        const speciesQ = parsedDate ? q.replace(/\d{4}-\d{2}-\d{2}|\d{1,2}[\/.\s]\d{1,2}([\/.\s]\d{2,4})?|\d{1,2}\s+[a-zéûô]+|[a-zéûô]+\s+\d{1,2}/gi, '').trim() : q;
        const seen = new Set();
        for (const row of dbSpecies.value) {
          const com = row.Com_Name || '';
          const sci = row.Sci_Name || '';
          const translated = spName(com, sci);
          const sq = speciesQ || q;
          if (translated.toLowerCase().includes(sq) || com.toLowerCase().includes(sq) || sci.toLowerCase().includes(sq)) {
            const key = sci || com;
            if (!seen.has(key)) {
              seen.add(key);
              const r = { type:'species', comName: com, sciName: sci, displayName: translated };
              if (parsedDate) { r.type = 'species+date'; r.date = parsedDate; r.displayName += ' 📆'; }
              results.push(r);
              if (results.length >= 8) break;
            }
          }
        }
        return results;
      });

      function onSearchInput() {
        searchOpen.value = searchQuery.value.trim().length > 0;
        searchHighlight.value = -1;
      }

      function selectSearchResult(result) {
        if (result.type === 'date') {
          window.location.href = 'calendar.html?date=' + result.date;
        } else if (result.type === 'species+date') {
          window.location.href = 'calendar.html?date=' + result.date + '&species=' + encodeURIComponent(result.comName);
        } else {
          window.location.href = 'species.html?species=' + encodeURIComponent(result.comName);
        }
      }

      function onSearchKeydown(e) {
        const results = searchResults.value;
        if (e.key === 'Escape') {
          searchOpen.value = false;
          searchQuery.value = '';
          searchExpanded.value = false;
          e.target.blur();
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          searchHighlight.value = Math.min(searchHighlight.value + 1, results.length - 1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          searchHighlight.value = Math.max(searchHighlight.value - 1, -1);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (searchHighlight.value >= 0 && searchHighlight.value < results.length) {
            selectSearchResult(results[searchHighlight.value]);
          } else if (results.length === 1) {
            selectSearchResult(results[0]);
          }
        }
      }

      function closeSearch() {
        searchOpen.value = false;
        searchExpanded.value = false;
        searchQuery.value = '';
        searchHighlight.value = -1;
      }

      function toggleMobileSearch() {
        searchExpanded.value = !searchExpanded.value;
        if (searchExpanded.value) {
          nextTick(() => {
            const inp = document.querySelector('.gSearch-input');
            if (inp) inp.focus();
          });
        } else {
          closeSearch();
        }
      }

      // ── Unified notification bell (3 severity levels) ──────────────
      const bellOpen = ref(false);
      const bellCritical = ref([]);
      const bellWarning = ref([]);
      const bellBirds = ref([]);

      // Track seen state via content hash — detects when items change even
      // if the count stays the same (e.g. "19 to review" → "25 to review")
      const bellSeenHash = ref({
        critical: localStorage.getItem('birdash_bell_hash_critical') || '',
        warning:  localStorage.getItem('birdash_bell_hash_warning')  || '',
        birds:    localStorage.getItem('birdash_bell_hash_birds')    || '',
      });
      function _bellHash(items) {
        return items.map(i => (i.text || '') + (i.sub || '')).join('|');
      }
      const bellUnseenCritical = computed(() => bellCritical.value.length > 0 && _bellHash(bellCritical.value) !== bellSeenHash.value.critical ? bellCritical.value.length : 0);
      const bellUnseenWarning  = computed(() => bellWarning.value.length  > 0 && _bellHash(bellWarning.value)  !== bellSeenHash.value.warning  ? bellWarning.value.length  : 0);
      const bellUnseenBirds    = computed(() => bellBirds.value.length    > 0 && _bellHash(bellBirds.value)    !== bellSeenHash.value.birds    ? bellBirds.value.length    : 0);
      const bellUnseen = computed(() => bellUnseenCritical.value + bellUnseenWarning.value + bellUnseenBirds.value);

      // Highest severity present (for badge color)
      const bellSeverity = computed(() => {
        if (bellUnseenCritical.value > 0 || bellCritical.value.length > 0) return 'critical';
        if (bellUnseenWarning.value > 0  || bellWarning.value.length > 0)  return 'warning';
        if (bellBirds.value.length > 0) return 'birds';
        return 'none';
      });

      // ── Source 1: birds (whats-new) — green ─────────────────────────
      function loadBirdsAlerts() {
        fetch(`${BIRD_CONFIG.apiUrl}/whats-new`).then(r => r.json()).then(d => {
          const items = [];
          const icons = { out_of_season: 'alert-triangle', activity_spike: 'trending-up', species_return: 'refresh-cw', first_of_year: 'sparkles', species_streak: 'calendar', seasonal_peak: 'sprout' };
          const allCards = [...(d.alerts || []), ...(d.phenology || [])];
          for (const card of allCards) {
            if (!card.active || !card.data?.species) continue;
            const icon = icons[card.type] || 'bell';
            const label = t('wn_card_' + card.type) || card.type;
            for (const sp of card.data.species) {
              const name = sp.commonName || sp.comName || '';
              const sci  = sp.sciName || '';
              let sub = label;
              if (sp.absentDays) sub += ' (' + sp.absentDays + 'j)';
              if (sp.streakDays) sub += ' (' + sp.streakDays + 'j)';
              if (sp.count) sub += ' (' + sp.count + ')';
              items.push({ icon, text: spName(name, sci) || name, sub, href: 'species.html?species=' + encodeURIComponent(name) });
            }
          }
          bellBirds.value = items.slice(0, 12);
        }).catch(() => {});
      }
      loadBirdsAlerts();

      // ── Source 2: critical alerts (update + system) ─────────────────
      function refreshCritical() {
        const items = [];
        // Update available
        if (updateInfo.value && updateInfo.value.hasUpdate && !updateInfo.value.snoozed) {
          items.push({
            icon: 'arrow-up-circle',
            text: t('bell_update_available'),
            sub: 'v' + (updateInfo.value.latestVersion || updateInfo.value.latestShort),
            click: 'openUpdateModal',
          });
        }
        // Pipeline blocked: backlog > 20 AND lag > 5min
        fetch(`${BIRD_CONFIG.apiUrl}/analysis-status`).then(r => r.json()).then(d => {
          if (d.backlog > 20 && d.lagSecs > 300) {
            items.push({
              icon: 'alert-circle',
              text: t('bell_pipeline_blocked'),
              sub: d.backlog + ' fichiers · ' + Math.floor(d.lagSecs/60) + ' min',
              href: 'system.html',
            });
          }
          bellCritical.value = items;
        }).catch(() => { bellCritical.value = items; });
      }

      // ── Source 3: warnings (review queue + backlog/lag) ─────────────
      function refreshWarning() {
        const items = [];
        const today = U.localDateStr();
        const weekAgo = U.daysAgo(6); // last 7 days, matching review.html default
        // Review queue (same date range + limit as review.html)
        fetch(`${BIRD_CONFIG.apiUrl}/flagged-detections?dateFrom=${weekAgo}&dateTo=${today}&limit=2000`)
          .then(r => r.json()).then(d => {
            const unreviewed = (d.flagged || []).filter(f => f.validation === 'unreviewed').length;
            if (unreviewed > 0) {
              items.push({
                icon: 'check-circle',
                text: unreviewed + ' ' + t('bell_review_pending'),
                sub: t('bell_review_sub'),
                href: 'review.html',
              });
            }
            // Then check backlog/lag
            return fetch(`${BIRD_CONFIG.apiUrl}/analysis-status`);
          })
          .then(r => r.json())
          .then(d => {
            if ((d.backlog > 5 && d.backlog <= 20) || (d.lagSecs > 60 && d.lagSecs <= 300)) {
              items.push({
                icon: 'clock',
                text: t('bell_pipeline_slow'),
                sub: d.backlog + ' fichiers · ' + (d.lagSecs < 60 ? d.lagSecs + 's' : Math.floor(d.lagSecs/60) + 'min'),
                href: 'system.html',
              });
            }
            bellWarning.value = items;
          }).catch(() => { bellWarning.value = items; });
      }

      function refreshAllAlerts() {
        refreshCritical();
        refreshWarning();
      }
      // Initial + periodic refresh
      setTimeout(refreshAllAlerts, 1500);
      setInterval(refreshAllAlerts, 5 * 60 * 1000); // 5 min
      setInterval(loadBirdsAlerts, 10 * 60 * 1000); // 10 min

      function toggleBell() {
        bellOpen.value = !bellOpen.value;
        if (bellOpen.value) {
          // Mark all as seen by storing content hash
          bellSeenHash.value = {
            critical: _bellHash(bellCritical.value),
            warning:  _bellHash(bellWarning.value),
            birds:    _bellHash(bellBirds.value),
          };
          localStorage.setItem('birdash_bell_hash_critical', bellSeenHash.value.critical);
          localStorage.setItem('birdash_bell_hash_warning',  bellSeenHash.value.warning);
          localStorage.setItem('birdash_bell_hash_birds',    bellSeenHash.value.birds);
        }
      }
      function bellItemClick(item) {
        if (item.click === 'openUpdateModal') { openUpdateModal(); bellOpen.value = false; }
        else if (item.href) window.location.href = item.href;
      }

      const currentPage = props.page;

      // ── Update detection (git-based, server-side snooze) ─────────────
      // Polls /api/update-status which compares the locally checked-out
      // commit to git ls-remote origin/main and returns categorized
      // commit metadata. Snooze (defer / skip) lives server-side in
      // config/update-state.json so it's consistent across browsers.
      const updateInfo = ref({
        currentShort: '', latestShort: '',
        hasUpdate: false, snoozed: false,
        commitsBehind: 0, changes: [],
      });
      const updateModalOpen = ref(false);
      const updateApplying = ref(false);
      const updateProgress = ref(null);   // {state, step, detail, newCommit?, previousCommit?}
      const updateLog = ref('');           // tail of config/update.log on failure
      const updateShowLog = ref(false);    // toggle log visibility
      let _updatePollTimer = null;

      async function fetchUpdateStatus(force) {
        try {
          const url = `${BIRD_CONFIG.apiUrl}/update-status` + (force ? '?refresh=1' : '');
          const r = await fetch(url);
          const d = await r.json();
          if (d && !d.error) updateInfo.value = d;
        } catch {}
      }
      fetchUpdateStatus();

      const showUpdateBanner = computed(() =>
        updateInfo.value.hasUpdate && !updateInfo.value.snoozed && !updateApplying.value
      );

      function openUpdateModal() { updateModalOpen.value = true; }
      function closeUpdateModal() { updateModalOpen.value = false; }

      async function _snoozeUpdate(action, days) {
        try {
          const r = await fetch(`${BIRD_CONFIG.apiUrl}/update-snooze`, {
            method: 'POST', headers: BIRDASH.authHeaders(),
            body: JSON.stringify({ action, days }),
          });
          const d = await r.json().catch(() => ({}));
          if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
          await fetchUpdateStatus();
          updateModalOpen.value = false;
        } catch (e) {
          console.error('snooze:', e);
        }
      }
      function deferUpdate(days) { return _snoozeUpdate('defer', days || 1); }
      function skipUpdate()      { return _snoozeUpdate('skip'); }

      // Shared progress polling — used by apply, force-update, and rollback.
      function _startProgressPoll() {
        let consecutiveErrors = 0;
        _updatePollTimer = setInterval(async () => {
          try {
            const r = await fetch(`${BIRD_CONFIG.apiUrl}/update-status?progress=1`);
            const d = await r.json();
            consecutiveErrors = 0;
            updateProgress.value = d;
            if (d.state === 'done' || d.state === 'failed') {
              clearInterval(_updatePollTimer); _updatePollTimer = null;
              if (d.state === 'done') {
                await fetchUpdateStatus(true);
                // Auto-reload after 2s so the user gets the new code.
                // The old JS is still in memory — any UI shown here is
                // from the pre-update code. A brief "success" flash then
                // reload ensures the user sees the new version.
                setTimeout(() => location.reload(), 2000);
              } else {
                _fetchUpdateLog();
              }
            }
          } catch (e) {
            consecutiveErrors++;
            // Tolerate up to ~60s of network errors (birdash restart)
            if (consecutiveErrors > 40) {
              clearInterval(_updatePollTimer); _updatePollTimer = null;
              updateProgress.value = { state: 'failed', step: 'poll', detail: 'Lost contact with backend' };
              _fetchUpdateLog();
            } else {
              updateProgress.value = { state: 'restarting', step: 'restart', detail: 'Backend redémarre…' };
            }
          }
        }, 1500);
      }

      async function _fetchUpdateLog() {
        try {
          const r = await fetch(`${BIRD_CONFIG.apiUrl}/update-log`);
          if (r.ok) updateLog.value = await r.text();
        } catch {}
      }

      async function applyUpdate(force) {
        if (updateApplying.value) return;
        updateApplying.value = true;
        updateLog.value = '';
        updateShowLog.value = false;
        updateProgress.value = { state: 'starting', step: 'request', detail: '...' };
        try {
          const r = await fetch(`${BIRD_CONFIG.apiUrl}/apply-update`, {
            method: 'POST', headers: BIRDASH.authHeaders(),
            body: JSON.stringify({ force: !!force }),
          });
          const d = await r.json().catch(() => ({}));
          if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
        } catch (e) {
          updateProgress.value = { state: 'failed', step: 'request', detail: e.message };
          updateApplying.value = false;
          return;
        }
        _startProgressPoll();
      }

      function forceUpdate() { return applyUpdate(true); }

      async function rollbackUpdate() {
        const prev = updateProgress.value && updateProgress.value.previousCommit;
        if (!prev || updateApplying.value) return;
        updateApplying.value = true;
        updateLog.value = '';
        updateShowLog.value = false;
        updateProgress.value = { state: 'starting', step: 'rollback', detail: '...' };
        try {
          const r = await fetch(`${BIRD_CONFIG.apiUrl}/rollback-update`, {
            method: 'POST', headers: BIRDASH.authHeaders(),
            body: JSON.stringify({ commit: prev }),
          });
          const d = await r.json().catch(() => ({}));
          if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
        } catch (e) {
          updateProgress.value = { state: 'failed', step: 'rollback', detail: e.message };
          updateApplying.value = false;
          return;
        }
        _startProgressPoll();
      }

      // Can we offer rollback? Only if we know the previous commit.
      const canRollback = computed(() => {
        const p = updateProgress.value;
        return p && p.previousCommit && (p.state === 'failed' || p.state === 'done');
      });

      function reloadAfterUpdate() {
        location.reload();
      }

      function progressLabel(progress) {
        if (!progress) return t('update_starting');
        const { state, step, detail, newCommit } = progress;
        if (state === 'done') {
          return newCommit
            ? t('update_done_version', { v: newCommit })
            : t('update_done');
        }
        if (state === 'failed') return detail || t('update_failed');
        if (state === 'restarting') return t('update_restarting');
        const stepMap = {
          'starting':              'update_step_starting',
          'request':               'update_step_starting',
          'rollback':              'update_step_rollback',
          'Fetching origin/main':  'update_step_fetching',
          'Updating':              'update_step_downloading',
          'Rolling back to':       'update_step_rollback',
          'Running migrations':    'update_step_migrating',
          'Installing Node dependencies': 'update_step_npm',
          'Syncing Python dependencies':  'update_step_pip',
          'Restarting birdash':    'update_restarting',
          'Restarting birdengine': 'update_restarting',
          'complete':              'update_done',
          'up-to-date':            'update_already_uptodate',
        };
        const key = stepMap[step] || Object.entries(stepMap).find(([k]) => step && step.startsWith(k))?.[1];
        return key ? t(key) : (step || t('update_starting'));
      }

      function dismissUpdateProgress() {
        if (_updatePollTimer) { clearInterval(_updatePollTimer); _updatePollTimer = null; }
        updateApplying.value = false;
        updateProgress.value = null;
        updateLog.value = '';
        updateShowLog.value = false;
        updateModalOpen.value = false;
      }

      const updateGroupedChanges = computed(() => {
        const groups = {
          feat: { icon: 'sparkles', label: t('update_cat_feat'), commits: [] },
          fix:  { icon: 'wrench',   label: t('update_cat_fix'),  commits: [] },
          perf: { icon: 'zap',      label: t('update_cat_perf'), commits: [] },
          refactor: { icon: 'settings', label: t('update_cat_refactor'), commits: [] },
          docs: { icon: 'file-text', label: t('update_cat_docs'), commits: [] },
          test: { icon: 'check-circle', label: t('update_cat_test'), commits: [] },
          chore:{ icon: 'archive',  label: t('update_cat_chore'), commits: [] },
          other:{ icon: 'plus',     label: t('update_cat_other'), commits: [] },
        };
        for (const c of (updateInfo.value.changes || [])) {
          const key = groups[c.type] ? c.type : 'other';
          groups[key].commits.push(c);
        }
        return Object.values(groups).filter(g => g.commits.length > 0);
      });

      // Review badge count
      const reviewCount = ref(0);
      function refreshReviewCount() {
        fetch(`${BIRD_CONFIG.apiUrl}/flagged-detections?dateFrom=${U.daysAgo(6)}&dateTo=${U.localDateStr()}&limit=2000`)
          .then(r => r.json()).then(d => {
            reviewCount.value = (d.flagged || []).filter(f => f.validation === 'unreviewed').length;
          }).catch(() => {});
      }
      refreshReviewCount();
      window.addEventListener('birdash:review-changed', refreshReviewCount);

      // Bug report
      const bugReportOpen = ref(false);
      const bugReportForm = reactive({ title: '', description: '', attachLogs: false, sending: false, sent: false, error: '', issueUrl: '' });
      const bugReportEnabled = ref(false);
      fetch(`${BIRD_CONFIG.apiUrl}/bug-report/status`).then(r => r.json()).then(d => { bugReportEnabled.value = d.enabled; }).catch(() => {});

      // BirdWeather status — drives the header button visibility + URL.
      // Live from birdnet.conf (no restart needed when the user updates
      // BIRDWEATHER_ID in Settings → Station).
      const birdweatherStationId = ref('');
      fetch(`${BIRD_CONFIG.apiUrl}/birdweather/status`).then(r => r.json())
        .then(d => { birdweatherStationId.value = d.stationId || ''; })
        .catch(() => {});

      // ── Auth status (for header badge + login/logout button) ─────────
      const authStatus = reactive({ mode: 'off', authenticated: false, user: null, configured: false, canWrite: true });
      async function refreshAuthStatus() {
        try {
          const r = await fetch(`${BIRD_CONFIG.apiUrl}/auth/status`);
          if (!r.ok) return;
          const d = await r.json();
          Object.assign(authStatus, d);
        } catch {}
      }
      refreshAuthStatus();
      async function logout() {
        try { await fetch(`${BIRD_CONFIG.apiUrl}/auth/logout`, { method: 'POST' }); } catch {}
        location.reload();
      }
      function gotoLogin() {
        const here = location.pathname + location.search + location.hash;
        location.href = `login.html?redirect=${encodeURIComponent(here)}`;
      }
      function openBugReport() {
        bugReportForm.title = '';
        bugReportForm.description = '';
        bugReportForm.attachLogs = false;
        bugReportForm.sending = false;
        bugReportForm.sent = false;
        bugReportForm.error = '';
        bugReportForm.issueUrl = '';
        bugReportOpen.value = true;
      }
      function closeBugReport() { bugReportOpen.value = false; }
      async function submitBugReport() {
        bugReportForm.sending = true;
        bugReportForm.error = '';
        try {
          const systemInfo = {
            version: appVersion.value,
            browser: navigator.userAgent,
            page: currentPage,
            url: location.href,
            screen: screen.width + 'x' + screen.height,
            lang: lang.value,
            theme: theme.value
          };
          // Fetch logs if checkbox is checked
          let logs = '';
          if (bugReportForm.attachLogs) {
            try {
              const lr = await fetch(`${BIRD_CONFIG.apiUrl}/system/logs-export`);
              if (lr.ok) logs = await lr.text();
            } catch {}
          }
          const res = await fetch(`${BIRD_CONFIG.apiUrl}/bug-report`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: bugReportForm.title, description: bugReportForm.description, systemInfo, logs })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to submit bug report');
          bugReportForm.sent = true;
          bugReportForm.issueUrl = data.issueUrl || '';
        } catch (e) {
          bugReportForm.error = e.message || 'Failed to submit bug report';
        } finally {
          bugReportForm.sending = false;
        }
      }

      const drawerOpen = ref(false);
      function toggleDrawer() { drawerOpen.value = !drawerOpen.value; }
      function drawerNavClick(si) { navSectionClick(si); }

      // ── Power management (restart-service / reboot / shutdown) ─────
      // Lives at the shell level so the power icon in the header can
      // open the modal from any page, not just settings.
      const power = Vue.reactive({
        modalOpen: false,
        step: 'choose',
        selected: null,
        countdown: 0,
        countdownMax: 5,
        sliderValue: 0,
        probed: false,
        available: { sudoReady: false },
        stationName: '',
        _timer: null,
        iconFor(a) { return a === 'restart-service' ? 'rotate-cw' : a === 'reboot' ? 'refresh-cw' : 'power'; },
        async open() {
          this.modalOpen = true;
          this.step = 'choose';
          this.selected = null;
          this.sliderValue = 0;
          try {
            const r = await fetch(`${BIRD_CONFIG.apiUrl}/power`);
            if (r.ok) this.available = await r.json();
          } catch { this.available = { sudoReady: false }; }
          this.probed = true;
          // Pull the station name from settings if it's cached, so the
          // modal header can say "Biloute" / "Mickey" instead of the
          // generic brand.
          try {
            const cfg = await fetch(`${BIRD_CONFIG.apiUrl}/settings`).then(r => r.json()).catch(() => null);
            this.stationName = (cfg && (cfg.SITE_NAME || cfg.SITE_BRAND)) || '';
          } catch { this.stationName = ''; }
        },
        close() { this._clearTimer(); this.modalOpen = false; },
        _clearTimer() { if (this._timer) { clearInterval(this._timer); this._timer = null; } },
        selectAction(action) {
          this.selected = action;
          if (action === 'shutdown') { this.step = 'confirm-slide'; this.sliderValue = 0; return; }
          this.step = 'confirm';
          this.countdownMax = action === 'restart-service' ? 5 : 10;
          this.countdown = this.countdownMax;
          this._timer = setInterval(() => {
            this.countdown -= 1;
            if (this.countdown <= 0) { this._clearTimer(); this.apply(); }
          }, 1000);
        },
        // Custom pointer-driven slider. Native <input type=range> with
        // opacity:0 is unreliable — the hit area collapses to the thumb,
        // which users can't see. This grabs the whole track.
        sliderDragging: false,
        _sliderHasMoved: false,
        _sliderStartX: 0,
        _sliderTrackEl: null,
        _onPointerMove: null,
        _onPointerUp: null,
        sliderBegin(ev) {
          ev.preventDefault();
          const track = ev.currentTarget;
          this._sliderTrackEl = track;
          this.sliderDragging = true;
          this._sliderHasMoved = false;
          this._sliderStartX = ev.clientX;
          track.setPointerCapture && track.setPointerCapture(ev.pointerId);
          // Don't jump to pointer on initial down — only on drag.
          this._onPointerMove = (e) => this.sliderUpdate(e);
          this._onPointerUp   = (e) => this.sliderEnd(e);
          track.addEventListener('pointermove', this._onPointerMove);
          track.addEventListener('pointerup',   this._onPointerUp);
          track.addEventListener('pointercancel', this._onPointerUp);
        },
        sliderUpdate(ev) {
          if (!this.sliderDragging || !this._sliderTrackEl) return;
          if (Math.abs(ev.clientX - this._sliderStartX) > 3) this._sliderHasMoved = true;
          const rect = this._sliderTrackEl.getBoundingClientRect();
          // Map thumb center to pointer, clamped so the thumb stays inside
          // the track (48px wide + 4px left/right padding = 52px reserve).
          const travel = rect.width - 52;
          const thumbLeft = Math.max(0, Math.min(travel, ev.clientX - rect.left - 24 - 4));
          this.sliderValue = travel > 0 ? (thumbLeft / travel) * 100 : 0;
        },
        sliderEnd(ev) {
          if (!this.sliderDragging) return;
          this.sliderDragging = false;
          const track = this._sliderTrackEl;
          if (track) {
            track.removeEventListener('pointermove', this._onPointerMove);
            track.removeEventListener('pointerup',   this._onPointerUp);
            track.removeEventListener('pointercancel', this._onPointerUp);
            try { track.releasePointerCapture && track.releasePointerCapture(ev.pointerId); } catch {}
          }
          this._sliderTrackEl = null;
          // Only fire if user actually dragged AND made it to the threshold.
          // This prevents a single tap near the right edge from shutting
          // the station down by accident.
          if (this._sliderHasMoved && this.sliderValue >= 95) { this.apply(); return; }
          const start = this.sliderValue;
          const t0 = performance.now();
          const tick = (now) => {
            const p = Math.min((now - t0) / 220, 1);
            this.sliderValue = start * (1 - p);
            if (p < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        },
        cancel() { this._clearTimer(); this.step = 'choose'; this.sliderValue = 0; },
        async apply() {
          this.step = 'applying';
          try {
            await fetch(`${BIRD_CONFIG.apiUrl}/power`, {
              method: 'POST', headers: BIRDASH.authHeaders(),
              body: JSON.stringify({ action: this.selected }),
            });
          } catch { /* request may be cut short by the very action we triggered */ }
          this._pollHealth();
        },
        _pollHealth() {
          const started = Date.now();
          const MAX_MS = 180000;
          let sawOffline = false;
          const poll = async () => {
            if (!this.modalOpen) return;
            if (Date.now() - started > MAX_MS) return;
            let online;
            try { const r = await fetch(`${BIRD_CONFIG.apiUrl}/health`, { cache: 'no-store' }); online = r.ok; }
            catch { online = false; }
            if (!online) {
              if (!sawOffline) { sawOffline = true; this.step = 'offline'; }
            } else if (sawOffline && this.selected !== 'shutdown') {
              this.step = 'back';
              return;
            }
            setTimeout(poll, 2000);
          };
          setTimeout(poll, 1500);
        },
        reload() { window.location.reload(); },
      });

      // Expose openPower so child pages (e.g. the Settings → Station
      // 'Manage power' button) can trigger the shell-level modal.
      if (window.BIRDASH) window.BIRDASH.openPower = () => power.open();
      return { lang, t, setLang, langs, theme, themes, setTheme, navItems, navSections, openSection, hoverSection, navSectionClick, navGo, siteName, siteElev, siteCoords, langOpen, themeOpen, currentLang, currentTheme, modelName, currentPage, reviewCount, searchQuery, searchOpen, searchExpanded, searchHighlight, searchResults, onSearchInput, selectSearchResult, onSearchKeydown, closeSearch, toggleMobileSearch, bellOpen, bellCritical, bellWarning, bellBirds, bellUnseen, bellUnseenCritical, bellUnseenWarning, bellUnseenBirds, bellSeverity, toggleBell, bellItemClick, toasts, brandName, refreshReviewCount, drawerOpen, toggleDrawer, drawerNavClick, updateInfo, updateModalOpen, openUpdateModal, closeUpdateModal, showUpdateBanner, deferUpdate, skipUpdate, applyUpdate, forceUpdate, rollbackUpdate, canRollback, updateApplying, updateProgress, updateLog, updateShowLog, updateGroupedChanges, reloadAfterUpdate, dismissUpdateProgress, appVersion, progressLabel, bugReportOpen, bugReportForm, bugReportEnabled, openBugReport, closeBugReport, submitBugReport, power, authStatus, logout, gotoLogin, birdweatherStationId };
    },
    directives: {
      'click-outside': {
        mounted(el, binding) {
          el._clickOutside = e => { if (!el.contains(e.target)) binding.value(); };
          document.addEventListener('click', el._clickOutside);
        },
        unmounted(el) { document.removeEventListener('click', el._clickOutside); }
      }
    },
    template: `
<div class="app-shell">
  <a href="#birdash-main" class="skip-link">{{t('header_skip_to_content')}}</a>
  <header class="app-header" role="banner">
    <div class="header-brand">
      <img src="img/robin-logo.svg" class="brand-logo" :alt="brandName">
      <div class="brand-text">
        <span class="brand-name">{{brandName}}</span>
        <span class="brand-sub">{{t('header_subtitle')}} · {{siteName}}<span v-if="siteCoords"> · {{siteCoords}}</span><span v-if="siteElev != null"> · {{t('header_alt')}} {{siteElev}} m</span><span v-if="appVersion" class="brand-version"> · v{{appVersion}}</span></span>
      </div>
    </div>
    <div class="header-right">
      <a v-if="modelName" class="brand-model" href="settings.html#detection" title="Detection settings">{{modelName}}</a>
      <!-- Global species search -->
      <div class="gSearch" :class="{ expanded: searchExpanded }" v-click-outside="closeSearch">
        <button class="gSearch-icon-btn" @click="toggleMobileSearch" aria-label="Search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </button>
        <div class="gSearch-field">
          <svg class="gSearch-lens" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input class="gSearch-input" type="text"
                 :placeholder="t('search_placeholder')"
                 v-model="searchQuery"
                 @input="onSearchInput"
                 @keydown="onSearchKeydown"
                 @focus="searchOpen = searchQuery.trim().length > 0"
                 autocomplete="off" spellcheck="false">
          <button v-if="searchQuery" class="gSearch-clear" @click="searchQuery='';searchOpen=false;searchHighlight=-1" aria-label="Clear">&times;</button>
        </div>
        <div class="gSearch-dropdown" v-show="searchOpen && searchResults.length">
          <button v-for="(r, i) in searchResults" :key="r.sciName||r.comName"
                  class="gSearch-result" :class="{ highlighted: i === searchHighlight }"
                  @mousedown.prevent="selectSearchResult(r)"
                  @mouseenter="searchHighlight = i">
            <span class="gSearch-rname">{{ r.displayName }}</span>
            <span class="gSearch-rsci">{{ r.sciName }}</span>
          </button>
        </div>
      </div>
      <!-- Auth indicator: visitor pill + login button OR username + logout (only when AUTH_MODE != off) -->
      <div v-if="authStatus.mode !== 'off'" class="hdr-auth" style="display:flex;align-items:center;gap:.4rem;">
        <span v-if="authStatus.authenticated" :title="t('auth_logged_in_as', {user: authStatus.user})"
              style="display:inline-flex;align-items:center;gap:.3rem;padding:.18rem .5rem;border-radius:10px;background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.3);color:var(--accent);font-size:.7rem;">
          <bird-icon name="user-check" :size="11"></bird-icon>{{authStatus.user}}
        </span>
        <span v-else style="display:inline-flex;align-items:center;gap:.3rem;padding:.18rem .5rem;border-radius:10px;background:var(--bg-deep);border:1px solid var(--border);color:var(--text-muted);font-size:.7rem;">
          <bird-icon name="eye" :size="11"></bird-icon>{{t('auth_anonymous')}}
        </span>
        <button v-if="authStatus.authenticated" class="hdr-bug-btn" @click="logout" :title="t('auth_logout')">
          <bird-icon name="log-out" :size="16"></bird-icon>
        </button>
        <button v-else class="hdr-bug-btn" @click="gotoLogin" :title="t('auth_sign_in')">
          <bird-icon name="log-in" :size="16"></bird-icon>
        </button>
      </div>
      <!-- BirdWeather: open this station on app.birdweather.com (new tab) -->
      <a v-if="birdweatherStationId" class="hdr-bug-btn"
         :href="'https://app.birdweather.com/stations/' + birdweatherStationId"
         target="_blank" rel="noopener noreferrer"
         :title="t('header_birdweather_open') + ' (#' + birdweatherStationId + ')'">
        <bird-icon name="radio" :size="16"></bird-icon>
      </a>
      <!-- Bug report button -->
      <button v-if="bugReportEnabled" class="hdr-bug-btn" @click="openBugReport" :title="t('bug_report_title')">
        <bird-icon name="bug" :size="16"></bird-icon>
      </button>
      <!-- Power button — opens the same shell-level power modal -->
      <button class="hdr-power-btn" @click="power.open()" :title="t('power_title')">
        <bird-icon name="power" :size="16"></bird-icon>
      </button>
      <!-- Notification bell (unified, 3 severities) -->
      <div class="hdr-bell" v-click-outside="()=>bellOpen=false">
        <button class="bell-btn" @click="toggleBell" :aria-label="t('notifications')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          <span v-if="bellUnseen > 0" class="bell-badge" :class="'sev-' + bellSeverity">{{bellUnseen}}</span>
        </button>
        <div class="bell-panel" v-show="bellOpen">
          <div v-if="bellCritical.length === 0 && bellWarning.length === 0 && bellBirds.length === 0" style="padding:1rem;text-align:center;opacity:.5;font-size:.8rem;">
            {{t('wn_empty')}}
          </div>
          <!-- Critical -->
          <div v-if="bellCritical.length > 0" class="bell-section bell-sec-critical">
            <div class="bell-section-hdr"><span class="bell-sec-dot"></span>{{t('bell_critical')}}</div>
            <div v-for="(item, i) in bellCritical" :key="'c'+i" class="bell-item bell-item-critical" @click="bellItemClick(item)">
              <span class="bell-icon"><bird-icon :name="item.icon" :size="14"></bird-icon></span>
              <div class="bell-text">
                <div class="bell-name">{{item.text}}</div>
                <div class="bell-sub">{{item.sub}}</div>
              </div>
            </div>
          </div>
          <!-- Warning -->
          <div v-if="bellWarning.length > 0" class="bell-section bell-sec-warning">
            <div class="bell-section-hdr"><span class="bell-sec-dot"></span>{{t('bell_warning')}}</div>
            <div v-for="(item, i) in bellWarning" :key="'w'+i" class="bell-item bell-item-warning" @click="bellItemClick(item)">
              <span class="bell-icon"><bird-icon :name="item.icon" :size="14"></bird-icon></span>
              <div class="bell-text">
                <div class="bell-name">{{item.text}}</div>
                <div class="bell-sub">{{item.sub}}</div>
              </div>
            </div>
          </div>
          <!-- Birds -->
          <div v-if="bellBirds.length > 0" class="bell-section bell-sec-birds">
            <div class="bell-section-hdr"><span class="bell-sec-dot"></span>{{t('bell_birds')}}</div>
            <a v-for="(item, i) in bellBirds" :key="'b'+i" :href="item.href" class="bell-item bell-item-birds">
              <span class="bell-icon"><bird-icon :name="item.icon" :size="14"></bird-icon></span>
              <div class="bell-text">
                <div class="bell-name">{{item.text}}</div>
                <div class="bell-sub">{{item.sub}}</div>
              </div>
            </a>
          </div>
        </div>
      </div>
      <div class="header-dropdowns">
        <div class="hdr-dropdown" :class="{open:themeOpen}" v-click-outside="()=>themeOpen=false">
          <button class="hdr-toggle" @click="themeOpen=!themeOpen" :aria-expanded="themeOpen">
            <span class="theme-dot" :data-t="theme"></span>
            <span class="hdr-label">{{currentTheme.label}}</span>
            <svg class="hdr-chevron" width="10" height="6" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>
          </button>
          <div class="hdr-menu" v-show="themeOpen">
            <button v-for="th in themes" :key="th.id" class="hdr-option"
                    :class="{active:theme===th.id}"
                    @click="setTheme(th.id);themeOpen=false">
              <span class="theme-dot" :data-t="th.id"></span>
              <span class="hdr-option-label">{{th.label}}</span>
              <span class="hdr-check" v-if="theme===th.id">✓</span>
            </button>
          </div>
        </div>
        <div class="hdr-dropdown" :class="{open:langOpen}" v-click-outside="()=>langOpen=false">
          <button class="hdr-toggle lang-toggle" @click="langOpen=!langOpen" :aria-expanded="langOpen">
            <bird-icon name="globe" :size="15"></bird-icon>
            <span class="lang-code">{{lang.toUpperCase()}}</span>
            <svg class="hdr-chevron" width="10" height="6" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>
          </button>
          <div class="hdr-menu" v-show="langOpen">
            <button v-for="l in langs" :key="l.code" class="hdr-option"
                    :class="{active:lang===l.code}"
                    @click="setLang(l.code);langOpen=false">
              <span class="lang-code" style="width:28px;text-align:center;">{{l.code.toUpperCase()}}</span>
              <span class="hdr-option-label">{{l.label}}</span>
              <span class="hdr-check" v-if="lang===l.code">✓</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </header>
  <nav class="app-nav" aria-label="Navigation principale">
    <div class="nav-sections">
      <div v-for="(sec, si) in navSections" :key="si" class="nav-section-wrap"
           @mouseenter="hoverSection=si" @mouseleave="hoverSection=-1">
        <button class="nav-section-btn"
                :class="{active: openSection === si, 'has-active-page': sec.items.some(p => p.active)}"
                @click="navSectionClick(si)">
          <span class="nav-section-icon"><bird-icon :name="sec.icon" :size="16" ></bird-icon></span>
          {{sec.section}}
          <svg class="nav-chevron" :class="{open: openSection===si}" width="8" height="5" viewBox="0 0 8 5"><path d="M1 1l3 3 3-3" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round"/></svg>
        </button>
        <div v-show="openSection === si" class="nav-dropdown" @click.stop>
          <button v-for="p in sec.items" :key="p.id"
             class="nav-link" :class="{active:p.active}"
             @click="navGo(p.file)">
            <span class="nav-icon" aria-hidden="true"><bird-icon :name="p.icon" :size="16" ></bird-icon></span>
            <span class="nav-label">{{p.label}}</span>
            <span v-if="p.id==='review' && reviewCount > 0" class="nav-badge">{{reviewCount}}</span>
          </button>
        </div>
      </div>
    </div>
  </nav>
  <main id="birdash-main" class="app-main" role="main">
    <!-- Update available banner — discreet, non-blocking -->
    <div v-if="showUpdateBanner" class="update-banner">
      <span class="update-banner-icon"><bird-icon name="arrow-up-circle" :size="16"></bird-icon></span>
      <span class="update-banner-text">
        <template v-if="updateInfo.currentVersion && updateInfo.latestVersion && updateInfo.currentVersion === updateInfo.latestVersion">
          {{updateInfo.commitsBehind || 0}} {{(updateInfo.commitsBehind || 0) === 1 ? t('update_banner_singular') : t('update_banner_plural')}}
        </template>
        <template v-else>
          {{t('update_banner_new_version')}} v{{updateInfo.latestVersion || updateInfo.latestShort}}
        </template>
      </span>
      <button class="update-banner-btn" @click="openUpdateModal">{{t('update_banner_view')}}</button>
    </div>
    <h1 v-if="title" class="sr-only">{{title}}</h1>
    <slot></slot>
  </main>
  <spectro-modal></spectro-modal>
  <setup-wizard></setup-wizard>
  <!-- Update modal -->
  <div v-if="updateModalOpen" class="update-modal-backdrop" @click.self="closeUpdateModal">
    <div class="update-modal">
      <div class="update-modal-hdr">
        <div>
          <div class="update-modal-title">{{t('update_title')}}</div>
          <div class="update-modal-version">
            <template v-if="updateInfo.currentVersion && updateInfo.latestVersion && updateInfo.currentVersion === updateInfo.latestVersion">
              v{{updateInfo.currentVersion}} · <strong>{{updateInfo.commitsBehind || 0}} {{(updateInfo.commitsBehind || 0) === 1 ? t('update_banner_singular') : t('update_banner_plural')}}</strong>
            </template>
            <template v-else>
              v{{updateInfo.currentVersion || updateInfo.currentShort}} → <strong>v{{updateInfo.latestVersion || updateInfo.latestShort}}</strong>
            </template>
          </div>
        </div>
        <button class="update-modal-close" @click="closeUpdateModal" aria-label="Close"><bird-icon name="x" :size="16"></bird-icon></button>
      </div>
      <div class="update-modal-body">
        <!-- Apply/rollback progress -->
        <div v-if="updateApplying || updateProgress" class="update-progress-box">
          <div class="update-progress-state">
            <span v-if="updateProgress && updateProgress.state === 'done'"><bird-icon name="check-circle" :size="16" style="color:var(--accent);"></bird-icon></span>
            <span v-else-if="updateProgress && updateProgress.state === 'failed'"><bird-icon name="alert-circle" :size="16" style="color:var(--danger);"></bird-icon></span>
            <span v-else class="update-progress-spinner"></span>
            {{progressLabel(updateProgress)}}
          </div>
          <!-- Success actions -->
          <div v-if="updateProgress && updateProgress.state === 'done'" style="margin-top:.8rem;">
            <div style="color:var(--accent);font-size:.85rem;margin-bottom:.7rem;">
              <bird-icon name="check-circle" :size="14" style="vertical-align:-2px;"></bird-icon> {{t('update_success_msg')}}
            </div>
            <div style="display:flex;gap:.5rem;flex-wrap:wrap;justify-content:space-between;align-items:center;">
              <button v-if="canRollback" class="update-btn-secondary" @click="rollbackUpdate" style="font-size:.8rem;">
                <bird-icon name="rotate-ccw" :size="14"></bird-icon> {{t('update_rollback')}}
              </button>
              <div v-else></div>
              <button class="update-btn-primary" @click="reloadAfterUpdate">{{t('update_reload')}}</button>
            </div>
          </div>
          <!-- Failure actions -->
          <div v-if="updateProgress && updateProgress.state === 'failed'" style="margin-top:.8rem;">
            <div v-if="updateProgress.detail" class="update-error-detail">{{updateProgress.detail}}</div>
            <div style="display:flex;gap:.5rem;margin-top:.6rem;flex-wrap:wrap;">
              <button v-if="canRollback" class="update-btn-danger" @click="rollbackUpdate">
                <bird-icon name="rotate-ccw" :size="14"></bird-icon> {{t('update_rollback')}}
              </button>
              <button class="update-btn-secondary" @click="forceUpdate" style="font-size:.8rem;">
                <bird-icon name="alert-triangle" :size="14"></bird-icon> {{t('update_force')}}
              </button>
              <button class="update-btn-secondary" @click="dismissUpdateProgress" style="font-size:.8rem;">{{t('update_dismiss')}}</button>
            </div>
            <div v-if="updateLog" style="margin-top:.6rem;">
              <button class="update-log-toggle" @click="updateShowLog = !updateShowLog">
                <bird-icon :name="updateShowLog ? 'chevron-down' : 'chevron-right'" :size="12"></bird-icon> {{t('update_show_log')}}
              </button>
              <pre v-if="updateShowLog" class="update-log-pre">{{updateLog}}</pre>
            </div>
          </div>
        </div>
        <!-- Release notes (categorized commits) -->
        <div v-else>
          <div v-if="!updateGroupedChanges.length" style="opacity:.7;font-size:.85rem;">
            {{t('update_no_notes')}}
          </div>
          <div v-for="g in updateGroupedChanges" :key="g.label" class="update-changes-group">
            <div class="update-changes-label"><bird-icon :name="g.icon" :size="14"></bird-icon> {{g.label}}</div>
            <ul class="update-changes-list">
              <li v-for="c in g.commits" :key="c.hash">
                <span v-if="c.scope" class="update-changes-scope">{{c.scope}}:</span>
                {{c.subject}}
                <code class="update-changes-hash">{{c.short}}</code>
              </li>
            </ul>
          </div>
        </div>
      </div>
      <div class="update-modal-footer" v-if="!updateApplying && !updateProgress">
        <button class="update-btn-secondary" @click="skipUpdate">{{t('update_skip')}}</button>
        <button class="update-btn-secondary" @click="deferUpdate(1)">{{t('update_defer')}}</button>
        <button class="update-btn-primary" @click="applyUpdate" style="margin-left:auto;">{{t('update_install')}}</button>
      </div>
    </div>
  </div>
  <!-- Bug report modal -->
  <div v-if="bugReportOpen" class="update-modal-backdrop" @click.self="closeBugReport">
    <div class="update-modal" style="max-width:480px;">
      <div class="update-modal-hdr">
        <div class="update-modal-title"><bird-icon name="bug" :size="16" style="color:var(--danger);"></bird-icon> {{t('bug_report_title')}}</div>
        <button class="update-modal-close" @click="closeBugReport" aria-label="Close"><bird-icon name="x" :size="16"></bird-icon></button>
      </div>
      <div class="update-modal-body">
        <div v-if="bugReportForm.sent" style="text-align:center;padding:1rem 0;">
          <bird-icon name="check-circle" :size="32" style="color:var(--accent);"></bird-icon>
          <p style="margin:.8rem 0 .4rem;font-weight:600;">{{t('bug_report_submitted')}}</p>
          <p v-if="bugReportForm.issueUrl" style="font-size:.85rem;">
            <a :href="bugReportForm.issueUrl" target="_blank" rel="noopener" style="color:var(--accent);">{{t('bug_report_view_github')}}</a>
          </p>
          <button class="update-btn-secondary" @click="closeBugReport" style="margin-top:1rem;">OK</button>
        </div>
        <form v-else @submit.prevent="submitBugReport" style="display:flex;flex-direction:column;gap:.8rem;">
          <div v-if="bugReportForm.error" style="padding:.5rem .8rem;border-radius:6px;background:var(--danger,#e53935);color:#fff;font-size:.82rem;">
            {{bugReportForm.error}}
          </div>
          <label style="font-size:.82rem;font-weight:600;">{{t('bug_report_label_title')}}
            <input v-model="bugReportForm.title" type="text" required :placeholder="t('bug_report_ph_title')"
                   style="display:block;width:100%;margin-top:.3rem;padding:.45rem .6rem;border:1px solid var(--border,#333);border-radius:6px;background:var(--bg-card,#1a1a2e);color:inherit;font-size:.85rem;">
          </label>
          <label style="font-size:.82rem;font-weight:600;">{{t('bug_report_label_desc')}}
            <textarea v-model="bugReportForm.description" rows="5" required :placeholder="t('bug_report_ph_desc')"
                      style="display:block;width:100%;margin-top:.3rem;padding:.45rem .6rem;border:1px solid var(--border,#333);border-radius:6px;background:var(--bg-card,#1a1a2e);color:inherit;font-size:.85rem;resize:vertical;"></textarea>
          </label>
          <p style="font-size:.75rem;opacity:.6;">{{t('bug_report_auto_info')}}</p>
          <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;font-size:.82rem;">
            <input type="checkbox" v-model="bugReportForm.attachLogs">
            <bird-icon name="clipboard" :size="14" style="opacity:.6;"></bird-icon>
            {{t('bug_report_attach_logs')}}
          </label>
          <div style="display:flex;justify-content:flex-end;gap:.5rem;">
            <button type="button" class="update-btn-secondary" @click="closeBugReport" :disabled="bugReportForm.sending">{{t('bug_report_cancel')}}</button>
            <button type="submit" class="update-btn-primary" :disabled="bugReportForm.sending || !bugReportForm.title.trim()">
              <span v-if="bugReportForm.sending">{{t('bug_report_sending')}}</span>
              <span v-else>{{t('bug_report_submit')}}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
  <div v-if="toasts.length" style="position:fixed;bottom:5rem;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:.4rem;max-width:90vw;">
    <div v-for="t in toasts" :key="t.id" :style="{padding:'.5rem 1rem',borderRadius:'8px',fontSize:'.82rem',boxShadow:'0 2px 12px rgba(0,0,0,.3)',color:'#fff',background:t.type==='error'?'var(--danger,#e53935)':t.type==='success'?'var(--accent,#4caf50)':'var(--warning,#ff9800)'}">{{t.msg}}</div>
  </div>
  <nav class="mobile-bottom-nav" aria-label="Mobile navigation">
    <a href="overview.html" class="mob-nav-item" :class="{active: currentPage==='overview'}"><span class="mob-nav-icon"><bird-icon name="home" :size="20" ></bird-icon></span>{{t('nav_overview')}}</a>
    <a href="today.html" class="mob-nav-item" :class="{active: currentPage==='today'}"><span class="mob-nav-icon"><bird-icon name="calendar-days" :size="20" ></bird-icon></span>{{t('nav_today')}}</a>
    <a href="species.html" class="mob-nav-item" :class="{active: currentPage==='species'}"><span class="mob-nav-icon"><bird-icon name="bird" :size="20" ></bird-icon></span>{{t('nav_species')}}</a>
    <a href="stats.html" class="mob-nav-item" :class="{active: currentPage==='stats'}"><span class="mob-nav-icon"><bird-icon name="trending-up" :size="20"></bird-icon></span>{{t('nav_stats')}}</a>
    <button class="mob-nav-item" :class="{active: drawerOpen}" @click="toggleDrawer"><span class="mob-nav-icon"><bird-icon name="menu" :size="20" ></bird-icon></span>{{t('nav_more')}}</button>
  </nav>
  <transition name="drawer">
    <div v-if="drawerOpen" class="mob-drawer-overlay" @click.self="drawerOpen=false">
      <nav class="mob-drawer" aria-label="Full navigation">
        <div class="mob-drawer-header">
          <span class="mob-drawer-brand">{{brandName}}</span>
          <button class="mob-drawer-close" @click="drawerOpen=false" aria-label="Close">✕</button>
        </div>
        <div v-for="(sec, si) in navSections" :key="si" class="mob-drawer-section">
          <button class="mob-drawer-sec-btn" @click="drawerNavClick(si)">
            <span><bird-icon :name="sec.icon" :size="16" ></bird-icon> {{sec.section}}</span>
            <svg :class="{rotated: openSection===si}" width="10" height="6" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>
          </button>
          <div v-if="openSection===si" class="mob-drawer-pages">
            <a v-for="p in sec.items" :key="p.id" :href="p.file"
               class="mob-drawer-link" :class="{active: p.active}">
              <span><bird-icon :name="p.icon" :size="16" ></bird-icon> {{p.label}}</span>
              <span v-if="p.id==='review' && reviewCount > 0" class="nav-badge">{{reviewCount}}</span>
            </a>
          </div>
        </div>
      </nav>
    </div>
  </transition>

  <!-- Power modal — reachable from the header power icon on every page -->
  <transition name="pw-fade">
    <div v-if="power.modalOpen" class="pw-backdrop" @click.self="power.step === 'choose' && power.close()">
      <div class="pw-modal" role="dialog" aria-modal="true">
        <button v-if="power.step === 'choose'" class="pw-close" @click="power.close()" :aria-label="t('power_cancel')">
          <bird-icon name="x" :size="16"></bird-icon>
        </button>

        <div v-if="power.step === 'choose'" class="pw-step">
          <div class="pw-station">{{power.stationName || brandName}}</div>
          <div class="pw-prompt">{{t('power_prompt')}}</div>
          <div class="pw-tiles">
            <button class="pw-tile pw-tile-svc" @click="power.selectAction('restart-service')">
              <div class="pw-tile-icon"><bird-icon name="rotate-cw" :size="32"></bird-icon></div>
              <div class="pw-tile-label">{{t('power_restart_svc')}}</div>
              <div class="pw-tile-dur">~5 s</div>
            </button>
            <button class="pw-tile pw-tile-reboot" :disabled="!power.available.sudoReady"
                    :title="!power.available.sudoReady ? t('power_sudo_required') : ''"
                    @click="power.selectAction('reboot')">
              <div class="pw-tile-icon"><bird-icon name="refresh-cw" :size="32"></bird-icon></div>
              <div class="pw-tile-label">{{t('power_reboot')}}</div>
              <div class="pw-tile-dur">~45 s</div>
            </button>
            <button class="pw-tile pw-tile-shutdown" :disabled="!power.available.sudoReady"
                    :title="!power.available.sudoReady ? t('power_sudo_required') : ''"
                    @click="power.selectAction('shutdown')">
              <div class="pw-tile-icon"><bird-icon name="power" :size="32"></bird-icon></div>
              <div class="pw-tile-label">{{t('power_shutdown')}}</div>
              <div class="pw-tile-dur">{{t('power_permanent')}}</div>
            </button>
          </div>
        </div>

        <div v-else-if="power.step === 'confirm'" class="pw-step pw-step-confirm">
          <div class="pw-confirm-icon" :class="'pw-ci-' + power.selected">
            <bird-icon :name="power.iconFor(power.selected)" :size="48"></bird-icon>
          </div>
          <div class="pw-confirm-title">{{t('power_action_' + power.selected)}}</div>
          <div class="pw-confirm-sub">{{t('power_executing_in').replace('{s}', power.countdown)}}</div>
          <div class="pw-progress">
            <div class="pw-progress-bar" :style="{width: ((power.countdownMax - power.countdown) / power.countdownMax * 100) + '%'}"></div>
          </div>
          <button class="pw-btn pw-btn-cancel" @click="power.cancel()">{{t('power_cancel')}}</button>
        </div>

        <div v-else-if="power.step === 'confirm-slide'" class="pw-step pw-step-confirm">
          <div class="pw-confirm-icon pw-ci-shutdown"><bird-icon name="power" :size="48"></bird-icon></div>
          <div class="pw-confirm-title">{{t('power_action_shutdown')}}</div>
          <div class="pw-confirm-sub">{{t('power_slide_hint')}}</div>
          <div class="pw-slider-track" @pointerdown="power.sliderBegin($event)">
            <div class="pw-slider-fill" :style="{width: power.sliderValue + '%'}"></div>
            <div class="pw-slider-thumb" :style="{left: 'calc(4px + (100% - 52px) * ' + (power.sliderValue / 100) + ')'}">
              <bird-icon name="power" :size="18"></bird-icon>
            </div>
            <div class="pw-slider-label" :class="{dim: power.sliderValue > 40}">{{t('power_slide_label')}}</div>
          </div>
          <button class="pw-btn pw-btn-cancel" @click="power.cancel()">{{t('power_cancel')}}</button>
        </div>

        <div v-else-if="power.step === 'applying' || power.step === 'offline'" class="pw-step pw-step-applying">
          <div class="pw-spinner"><div></div><div></div><div></div></div>
          <div class="pw-applying-title">
            {{power.step === 'offline' ? t('power_offline_title') : t('power_applying_title')}}
          </div>
          <div class="pw-applying-sub">
            {{power.step === 'offline'
              ? (power.selected === 'shutdown' ? t('power_offline_shutdown') : t('power_offline_rebooting'))
              : t('power_applying_sub')}}
          </div>
        </div>

        <div v-else-if="power.step === 'back'" class="pw-step pw-step-back">
          <div class="pw-back-check"><bird-icon name="check-circle" :size="56"></bird-icon></div>
          <div class="pw-back-title">{{t('power_back_title')}}</div>
          <div class="pw-applying-sub">{{t('power_back_sub')}}</div>
          <button class="pw-btn pw-btn-primary" @click="power.reload()">{{t('power_reload')}}</button>
        </div>
      </div>
    </div>
  </transition>
</div>`
  };

  // ── Composant BirdIcon ───────────────────────────────────────────────────
  // Inline SVG icon (Lucide). Pulls path data from window.BIRDASH_ICONS.
  // Usage: <bird-icon name="calendar-days" ></bird-icon>
  //        <bird-icon name="bird" :size="24" ></bird-icon>
  // Render function: parses the icon SVG string into a real DOM SVG node,
  // then sets it as innerHTML of a span. The browser parses inside a <span>
  // context but the SVG element still becomes a real SVGElement because the
  // span gets replaced with actual DOM after mount.
  // Cleanest: use a template ref + onMounted to inject innerHTML directly.
  const BirdIcon = {
    props: {
      name: { type: String, required: true },
      size: { type: [Number, String], default: 18 },
    },
    setup(props) {
      const wrapRef = ref(null);
      function render() {
        if (!wrapRef.value) return;
        const icons = window.BIRDASH_ICONS || {};
        const inner = icons[props.name] || '';
        if (!inner) { wrapRef.value.innerHTML = ''; return; }
        const sz = props.size || 18;
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + sz + '" height="' + sz +
                    '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
                    ' stroke-linecap="round" stroke-linejoin="round" class="bird-icon" data-icon="' +
                    props.name + '">' + inner + '</svg>';
        wrapRef.value.innerHTML = svg;
      }
      onMounted(render);
      watch(() => [props.name, props.size], render);
      return { wrapRef };
    },
    template: `<span ref="wrapRef" class="bird-icon-wrap"></span>`
  };

  // ── Composant BirdImg ────────────────────────────────────────────────────
  // Image avec animation de chargement (3 dots wave).
  // Usage : <bird-img :src="url" :alt="text" class="my-class" />
  //         :src should be "/birds/api/photo?sci=Pica+pica" (server handles caching)
  const BirdImg = {
    props: {
      src:   { type: String, default: '' },
      alt:   { type: String, default: '' },
    },
    emits: ['refreshed'],
    setup(props, { emit }) {
      const loaded = ref(false);
      const errored = ref(false);
      const refreshing = ref(false);
      const imgSrc = ref(props.src);
      // Reset on src change
      watch(() => props.src, (v) => { loaded.value = false; errored.value = false; imgSrc.value = v; });
      function onLoad() { loaded.value = true; }
      function onError() { loaded.value = true; errored.value = true; }
      async function refreshPhoto() {
        if (refreshing.value || !props.src) return;
        // Extract sci name from URL (/api/photo?sci=X)
        const m = props.src.match(/[?&]sci=([^&]+)/);
        if (!m) return;
        const sci = decodeURIComponent(m[1]);
        refreshing.value = true;
        try {
          await fetch(BIRD_CONFIG.apiUrl + '/photo?sci=' + encodeURIComponent(sci), {
            method: 'DELETE', headers: U.authHeaders(),
          });
          // Force reload with cache-bust
          loaded.value = false;
          errored.value = false;
          imgSrc.value = props.src + (props.src.includes('?') ? '&' : '?') + '_t=' + Date.now();
          emit('refreshed');
        } catch(e) {}
        refreshing.value = false;
      }
      return { loaded, errored, refreshing, imgSrc, onLoad, onError, refreshPhoto };
    },
    template: `
      <div class="img-wrap">
        <div class="img-loader" :class="{ hidden: loaded }">
          <span></span><span></span><span></span>
        </div>
        <img v-if="imgSrc && !errored"
             :src="imgSrc" :alt="alt"
             :class="{ loaded: loaded }"
             @load="onLoad" @error="onError"
             loading="lazy">
        <div v-if="errored" style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:2rem;color:var(--text-faint);">🦜</div>
        <button v-if="loaded && !errored && imgSrc"
                class="img-refresh-btn" @click.stop="refreshPhoto"
                :disabled="refreshing" title="Refresh photo" aria-label="Refresh photo"><bird-icon name="refresh-cw" :size="14"></bird-icon></button>
      </div>
    `
  };

  // ── SpectroModal — extracted to bird-spectro-modal.js ──────────────────
  // Loaded separately, registers as BIRDASH._SpectroModal
  // ── Filter UI components ──────────────────────────────────────────────────

  const FilterPeriod = {
    props: {
      period:       { type: String, default: '' },
      quickButtons: { type: Array,  default: () => [] },
      dateFrom:     { type: String, default: '' },
      dateTo:       { type: String, default: '' },
    },
    emits: ['set-period', 'set-custom'],
    setup(props, { emit }) {
      const { t } = useI18n();
      return { t, props, emit };
    },
    template: `
<div class="bf-period">
  <div class="bf-period-btns">
    <button v-for="b in quickButtons" :key="b.key"
            class="bf-period-btn" :class="{active: b.active}"
            @click="$emit('set-period', b.key)">{{b.label}}</button>
  </div>
  <div v-if="period==='custom'" class="bf-period-custom">
    <input type="date" class="bf-date-input" :value="dateFrom"
           @change="$emit('set-custom', $event.target.value, dateTo)">
    <span class="bf-date-sep">→</span>
    <input type="date" class="bf-date-input" :value="dateTo"
           @change="$emit('set-custom', dateFrom, $event.target.value)">
  </div>
</div>`
  };

  const FilterConfidence = {
    props: {
      confidence:  { type: Number, default: 0.7 },
      confEditing: { type: Boolean, default: false },
      confEditVal: { type: Number, default: 70 },
    },
    emits: ['update:confidence', 'start-edit', 'commit-edit', 'update:confEditVal'],
    setup(props, { emit }) {
      const { t } = useI18n();
      function onSlider(e) { emit('update:confidence', parseFloat(e.target.value)); }
      return { t, onSlider };
    },
    template: `
<div class="bf-confidence">
  <div class="bf-conf-row">
    <input type="range" class="bf-conf-slider" min="0" max="1" step="0.05"
           :value="confidence" @input="onSlider($event)"
           :aria-label="t('avg_confidence')">
    <span v-if="!confEditing" class="bf-conf-pct" @click="$emit('start-edit')"
          :title="t('click_to_edit')">{{Math.round(confidence*100)}}%</span>
    <input v-else type="number" class="bf-conf-edit" min="0" max="100"
           :value="confEditVal"
           @input="$emit('update:confEditVal', parseInt($event.target.value)||0)"
           @keydown.enter="$emit('commit-edit')"
           @blur="$emit('commit-edit')"
           ref="confInput">
  </div>
</div>`
  };

  const FilterSpecies = {
    props: {
      source:         { type: Array,   default: () => [] },
      selectedSpecies:{ type: Array,   default: () => [] },
      filteredList:   { type: Array,   default: () => [] },
      speciesSearch:  { type: String,  default: '' },
      allSelected:    { type: Boolean, default: false },
      spName:         { type: Function, default: (n) => n },
    },
    emits: ['toggle-species', 'toggle-all', 'update:speciesSearch'],
    setup(props, { emit }) {
      const { t } = useI18n();
      return { t };
    },
    template: `
<div class="bf-species">
  <input class="bf-sp-search" type="search"
         :placeholder="'🔍 '+t('filter_species_ph')"
         :value="speciesSearch"
         @input="$emit('update:speciesSearch', $event.target.value)">
  <div class="bf-sp-actions">
    <button class="bf-sp-toggle-btn" :class="{active: allSelected}"
            @click="$emit('toggle-all')">
      {{allSelected ? t('deselect_all') : t('select_all')+' ('+source.length+')'}}
    </button>
  </div>
  <div class="bf-sp-list">
    <div v-for="sp in filteredList" :key="sp.name"
         class="bf-sp-item" :class="{selected: selectedSpecies.includes(sp.name)}"
         @click="$emit('toggle-species', sp.name)">
      <div class="bf-sp-check">{{selectedSpecies.includes(sp.name)?'✓':''}}</div>
      <span class="bf-sp-name" :title="sp.name">{{spName(sp.name, sp.sci)}}</span>
      <span class="bf-sp-count">{{sp.count}}</span>
    </div>
  </div>
</div>`
  };

  // ── Swipe directive ──────────────────────────────────────────────────────
  // Usage: v-swipe="{ left: fn, right: fn }"
  const vSwipe = {
    mounted(el, binding) {
      let sx = 0, sy = 0;
      el.addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
      el.addEventListener('touchend', e => {
        const dx = e.changedTouches[0].clientX - sx;
        const dy = e.changedTouches[0].clientY - sy;
        if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx)) return;
        const fns = binding.value || {};
        if (dx < 0 && fns.left) fns.left();
        if (dx > 0 && fns.right) fns.right();
      }, { passive: true });
    }
  };

  // Enregistre les composants globaux sur une instance d'app Vue
  function registerComponents(app) {
    app.directive('swipe', vSwipe);
    app.component('birdash-shell', PibirdShell);
    app.component('bird-icon', BirdIcon);
    app.component('bird-img', BirdImg);
    if (window.BIRDASH && window.BIRDASH._SpectroModal) app.component('spectro-modal', window.BIRDASH._SpectroModal);
    app.component('filter-period', FilterPeriod);
    app.component('filter-confidence', FilterConfidence);
    app.component('filter-species', FilterSpecies);
    // Inject format helpers into every template so pages can use
    // {{fmtTemp(x)}} / {{fmtWind(x)}} / {{fmtSize(b)}} directly — reactive
    // because each helper reads effUnits/effTimeFormat/… at call time and
    // template renders are tracked effects.
    Object.assign(app.config.globalProperties, {
      fmtTemp, fmtWind, fmtPressure, fmtSize,
      fmtNumber, fmtPercent, fmtDate, fmtTime, fmtDateTime,
      unitLabel, firstDayOfWeek,
    });
    return app;
  }

  // ── Export global ─────────────────────────────────────────────────────────
  window.BIRDASH = {
    // Vue composables
    useI18n, useTheme, useNav, useChart, useAudio, useAudioPlayer, useFavorites, useSpeciesNames, useToast, useFormat, updateSiteIdentity, exportChart,
    // Filter composables
    useFilterPeriod, useFilterConfidence, useFilterSpecies, buildWhereClause,
    // Vue components
    PibirdShell, BirdIcon, registerComponents, MODEL_LABELS, vSwipe,
    // (_spectroModal is also exported below alongside open/closeSpectroModal —
    // keep that grouping, drop the duplicate here.)
    // Wrapper with reactive lang injection (calls BIRDASH_UTILS under the hood)
    buildSpeciesLinks,
    // Re-exports from BIRDASH_UTILS for backward compatibility
    // (pages destructure these from BIRDASH, so they must remain available)
    birdQuery:        U.birdQuery,
    escHtml:          U.escHtml,
    safeHtml:         U.safeHtml,
    authHeaders:      U.authHeaders,
    // fmtDate / fmtTime — upgraded to reactive, locale-aware versions (see
    // useFormat above). Backward-compatible signatures: accept "YYYY-MM-DD"
    // and "HH:MM[:SS]" strings just like the originals in bird-shared.js.
    fmtDate,
    fmtTime,
    fmtConf:          U.fmtConf,
    localDateStr:     U.localDateStr,
    daysAgo:          U.daysAgo,
    freshnessLabel:   U.freshnessLabel,
    buildAudioUrl:    U.buildAudioUrl,
    fetchSpeciesImage:U.fetchSpeciesImage,
    photoUrl: U.photoUrl,
    getUrlParam:      U.getUrlParam,
    navigateTo:       U.navigateTo,
    chartDefaults:    U.chartDefaults,
    spinnerHTML:      U.spinnerHTML,
    shortModel:       U.shortModel,
    quickPlaySpecies: U.quickPlaySpecies,
    // DSP
    fftInPlace:          U.fftInPlace,
    buildColorLUT:       U.buildColorLUT,
    COLOR_LUT:           U.COLOR_LUT,
    renderSpectrogram:   U.renderSpectrogram,
    drawSpectrogramFromPcm: U.drawSpectrogramFromPcm,
    fetchAndDecodeAudio: U.fetchAndDecodeAudio,
    highpassIIR:         U.highpassIIR,
    spectralSubtract:    U.spectralSubtract,
    cleanAudioPipeline:  U.cleanAudioPipeline,
    encodeWav:           U.encodeWav,
    // Spectrogram modal
    openSpectroModal: openSpectroModal,
    closeSpectroModal: closeSpectroModal,
    _spectroModal: _spectroModal,
    // Direct access to translations
    TRANSLATIONS: _TRANSLATIONS,
    ready: _i18nLoaded,
  };

})(Vue, BIRD_CONFIG, window.BIRDASH_UTILS);
