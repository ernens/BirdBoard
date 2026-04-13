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

  const _lang  = ref(localStorage.getItem('birdash_lang')  || 'fr');
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

  // ── Global site identity (shared across all useNav calls) ────────────────
  const _siteName  = ref('BirdStation');
  const _brandName = ref('BirdStation');
  let _siteIdentityLoaded = false;

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
        const pageTitle = document.title.replace(/^[^—]+—/, _siteName.value + ' —');
        if (pageTitle !== document.title) document.title = pageTitle;
      }
      if (conf.SITE_BRAND) _brandName.value = conf.SITE_BRAND;
    }).catch(() => {});
  }

  // Update site identity (called from settings page after save)
  function updateSiteIdentity(name, brand) {
    if (name != null) {
      _siteName.value = name;
      const pageTitle = document.title.replace(/^[^—]+—/, name + ' —');
      if (pageTitle !== document.title) document.title = pageTitle;
    }
    if (brand != null) _brandName.value = brand;
  }

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
    return { navItems, navSections, siteName: _siteName, brandName: _brandName };
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
    'BirdNET-Go_classifier_20250916':               'BirdNET-Go',
  };

  const PibirdShell = {
    props: {
      page:  { type: String, default: '' },
      title: { type: String, default: '' },
    },
    setup(props) {
      const { lang, t, setLang, langs } = useI18n();
      const { theme, themes, setTheme } = useTheme();
      const { navItems, navSections, siteName, brandName } = useNav(props.page);
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
      const updateProgress = ref(null);   // {state, step, detail, newCommit?}
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

      // Banner visibility: only when there's an update AND no snooze active.
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

      async function applyUpdate() {
        if (updateApplying.value) return;
        updateApplying.value = true;
        updateProgress.value = { state: 'starting', step: 'request', detail: '...' };
        try {
          const r = await fetch(`${BIRD_CONFIG.apiUrl}/apply-update`, {
            method: 'POST', headers: BIRDASH.authHeaders(),
          });
          const d = await r.json().catch(() => ({}));
          if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
        } catch (e) {
          updateProgress.value = { state: 'failed', step: 'request', detail: e.message };
          updateApplying.value = false;
          return;
        }
        // Poll progress every 1.5s. Tolerate network errors during the
        // birdash restart that the update script triggers mid-flight.
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
                // Bypass the 5-min server cache so the modal doesn't
                // keep showing the "update available" state we just
                // installed. The fresh status will report hasUpdate=false.
                await fetchUpdateStatus(true);
              }
            }
          } catch (e) {
            consecutiveErrors++;
            // Up to ~30s of network errors are tolerated (birdash restart
            // is the most common cause).
            if (consecutiveErrors > 20) {
              clearInterval(_updatePollTimer); _updatePollTimer = null;
              updateProgress.value = { state: 'failed', step: 'poll', detail: 'Lost contact with backend' };
            } else {
              updateProgress.value = { state: 'restarting', step: 'restart', detail: 'Backend redémarre…' };
            }
          }
        }, 1500);
      }

      function reloadAfterUpdate() {
        location.reload();
      }

      // Map the raw step/state from update-progress.json (written by
      // update.sh in English) to user-facing i18n keys. The shell script
      // doesn't have access to the i18n system, so we translate here.
      function progressLabel(progress) {
        if (!progress) return t('update_starting');
        const { state, step, detail, newCommit } = progress;
        if (state === 'done') {
          return newCommit
            ? t('update_done_version', { v: newCommit })
            : t('update_done');
        }
        if (state === 'failed') return t('update_failed');
        if (state === 'restarting') return t('update_restarting');
        // Map known step keywords from update.sh info() calls.
        const stepMap = {
          'starting':              'update_step_starting',
          'request':               'update_step_starting',
          'Fetching origin/main':  'update_step_fetching',
          'Updating':              'update_step_downloading',
          'Running migrations':    'update_step_migrating',
          'Installing Node dependencies': 'update_step_npm',
          'Restarting birdash':    'update_restarting',
          'Restarting birdengine': 'update_restarting',
          'complete':              'update_done',
          'up-to-date':            'update_already_uptodate',
        };
        // Try exact match first, then prefix match
        const key = stepMap[step] || Object.entries(stepMap).find(([k]) => step && step.startsWith(k))?.[1];
        return key ? t(key) : (step || t('update_starting'));
      }

      // Allow the user to dismiss a stuck "in-flight" progress state
      // (e.g. backend died mid-apply, or polling timed out). Resets the
      // local apply tracking without touching server state.
      function dismissUpdateProgress() {
        if (_updatePollTimer) { clearInterval(_updatePollTimer); _updatePollTimer = null; }
        updateApplying.value = false;
        updateProgress.value = null;
        updateModalOpen.value = false;
      }

      // Group commits by conventional-commit type for the modal display.
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
      return { lang, t, setLang, langs, theme, themes, setTheme, navItems, navSections, openSection, hoverSection, navSectionClick, navGo, siteName, langOpen, themeOpen, currentLang, currentTheme, modelName, currentPage, reviewCount, searchQuery, searchOpen, searchExpanded, searchHighlight, searchResults, onSearchInput, selectSearchResult, onSearchKeydown, closeSearch, toggleMobileSearch, bellOpen, bellCritical, bellWarning, bellBirds, bellUnseen, bellUnseenCritical, bellUnseenWarning, bellUnseenBirds, bellSeverity, toggleBell, bellItemClick, toasts, brandName, refreshReviewCount, drawerOpen, toggleDrawer, drawerNavClick, updateInfo, updateModalOpen, openUpdateModal, closeUpdateModal, showUpdateBanner, deferUpdate, skipUpdate, applyUpdate, updateApplying, updateProgress, updateGroupedChanges, reloadAfterUpdate, dismissUpdateProgress, appVersion, progressLabel, bugReportOpen, bugReportForm, bugReportEnabled, openBugReport, closeBugReport, submitBugReport };
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
  <a href="#birdash-main" class="skip-link">Aller au contenu</a>
  <header class="app-header" role="banner">
    <div class="header-brand">
      <img src="img/robin-logo.svg" class="brand-logo" :alt="brandName">
      <div class="brand-text">
        <span class="brand-name">{{brandName}}</span>
        <span class="brand-sub">{{siteName}} <span v-if="appVersion" class="brand-version">v{{appVersion}}</span></span>
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
      <!-- Bug report button -->
      <button v-if="bugReportEnabled" class="hdr-bug-btn" @click="openBugReport" :title="t('bug_report_title')">
        <bird-icon name="bug" :size="16"></bird-icon>
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
        {{t('update_banner_new_version')}} v{{updateInfo.latestVersion || updateInfo.latestShort}}
      </span>
      <button class="update-banner-btn" @click="openUpdateModal">{{t('update_banner_view')}}</button>
    </div>
    <h1 v-if="title" class="sr-only">{{title}}</h1>
    <slot></slot>
  </main>
  <spectro-modal></spectro-modal>
  <!-- Update modal -->
  <div v-if="updateModalOpen" class="update-modal-backdrop" @click.self="closeUpdateModal">
    <div class="update-modal">
      <div class="update-modal-hdr">
        <div>
          <div class="update-modal-title">{{t('update_title')}}</div>
          <div class="update-modal-version">
            v{{updateInfo.currentVersion || updateInfo.currentShort}} → <strong>v{{updateInfo.latestVersion || updateInfo.latestShort}}</strong>
          </div>
        </div>
        <button class="update-modal-close" @click="closeUpdateModal" aria-label="Close"><bird-icon name="x" :size="16"></bird-icon></button>
      </div>
      <div class="update-modal-body">
        <!-- Apply progress -->
        <div v-if="updateApplying || updateProgress" class="update-progress-box">
          <div class="update-progress-state">
            <span v-if="updateProgress && updateProgress.state === 'done'"><bird-icon name="check-circle" :size="16" style="color:var(--accent);"></bird-icon></span>
            <span v-else-if="updateProgress && updateProgress.state === 'failed'"><bird-icon name="alert-circle" :size="16" style="color:var(--danger);"></bird-icon></span>
            <span v-else class="update-progress-spinner"></span>
            {{progressLabel(updateProgress)}}
          </div>
          <button v-if="updateProgress && updateProgress.state === 'done'"
                  class="update-btn-primary" @click="reloadAfterUpdate" style="margin-top:.8rem;">
            {{t('update_reload')}}
          </button>
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
      <div class="update-modal-footer" v-if="!updateApplying && !(updateProgress && updateProgress.state === 'done')">
        <button class="update-btn-secondary" @click="skipUpdate" :disabled="updateApplying">{{t('update_skip')}}</button>
        <button class="update-btn-secondary" @click="deferUpdate(1)" :disabled="updateApplying">{{t('update_defer')}}</button>
        <button class="update-btn-primary" @click="applyUpdate" :disabled="updateApplying" style="margin-left:auto;">{{t('update_install')}}</button>
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

  // ── Composant SpectroModal ──────────────────────────────────────────────
  // Full-screen spectrogram modal with audio playback, filters, and progress.
  // Opened via BIRDASH.openSpectroModal({ fileName, speciesName, ... })
  const SpectroModal = {
    setup() {
      const { t } = useI18n();
      const modal = _spectroModal;
      const loading = ref(false);
      const isPlaying = ref(false);
      const progress = ref(0);
      const currentTime = ref('0:00');
      const duration = ref('0:00');
      const filters = Vue.reactive({ gain: 0, highpass: 0, lowpass: 0 });
      const gainOpts = [0, 5, 10, 15, 20];
      const hpOpts = [0, 200, 500, 1000, 2000];
      const lpOpts = [0, 3000, 6000, 9000, 12000];

      const canvas = ref(null);
      let audioCtx = null;
      let sourceNode = null;
      let gainNode = null;
      let hpNode = null;
      let lpNode = null;
      let audioBuf = null;
      let startedAt = 0;
      let pausedAt = 0;
      let rafId = null;
      let pcmData = null;
      let sampleRate = 0;

      // Loop selection
      const loopStart = ref(null); // 0-1 fraction
      const loopEnd = ref(null);
      const loopActive = ref(false);
      let _dragging = false;
      let _dragStart = 0;

      const audioUrl = computed(() => modal.fileName ? U.buildAudioUrl(modal.fileName) : '');
      const downloadName = computed(() => modal.fileName || 'audio.wav');

      function fmtSec(s) {
        if (!s || !isFinite(s)) return '0:00';
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return m + ':' + String(sec).padStart(2, '0');
      }

      async function loadAudio() {
        if (!modal.fileName) return;
        const url = audioUrl.value;
        if (!url) return;
        loading.value = true;
        try {
          const resp = await fetch(url);
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          const arrBuf = await resp.arrayBuffer();
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          audioBuf = await ctx.decodeAudioData(arrBuf);
          sampleRate = audioBuf.sampleRate;
          pcmData = audioBuf.getChannelData(0);
          duration.value = fmtSec(audioBuf.duration);
          await ctx.close();
          // Render spectrogram
          if (canvas.value) {
            U.renderSpectrogram(pcmData, sampleRate, canvas.value, { fftSize: 1024, maxHz: 12000 });
          }
        } catch (e) {
          console.warn('SpectroModal: load error', e);
        }
        loading.value = false;
      }

      function buildFilterChain() {
        if (!audioCtx) return;
        // Disconnect old nodes
        if (hpNode) try { hpNode.disconnect(); } catch(e) {}
        if (lpNode) try { lpNode.disconnect(); } catch(e) {}
        if (gainNode) try { gainNode.disconnect(); } catch(e) {}

        gainNode = audioCtx.createGain();
        gainNode.gain.value = Math.pow(10, filters.gain / 20);

        hpNode = audioCtx.createBiquadFilter();
        hpNode.type = 'highpass';
        hpNode.frequency.value = filters.highpass || 0;

        lpNode = audioCtx.createBiquadFilter();
        lpNode.type = 'lowpass';
        lpNode.frequency.value = filters.lowpass || audioCtx.sampleRate / 2;

        // Chain: source -> hp -> lp -> gain -> destination
        if (sourceNode) {
          sourceNode.disconnect();
          sourceNode.connect(hpNode);
        }
        hpNode.connect(lpNode);
        lpNode.connect(gainNode);
        gainNode.connect(audioCtx.destination);
      }

      function togglePlay() {
        if (isPlaying.value) {
          stopPlay();
        } else {
          startPlay();
        }
      }

      function startPlay() {
        if (!audioBuf) return;
        if (!audioCtx || audioCtx.state === 'closed') {
          audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        sourceNode = audioCtx.createBufferSource();
        sourceNode.buffer = audioBuf;
        sourceNode.loop = loopActive.value;
        if (loopActive.value && loopStart.value != null && loopEnd.value != null) {
          sourceNode.loopStart = loopStart.value * audioBuf.duration;
          sourceNode.loopEnd = loopEnd.value * audioBuf.duration;
        }
        buildFilterChain();
        sourceNode.connect(hpNode);

        let offset = pausedAt;
        if (loopActive.value && loopStart.value != null) {
          const ls = loopStart.value * audioBuf.duration;
          const le = loopEnd.value * audioBuf.duration;
          if (offset < ls || offset >= le) offset = ls;
        }
        sourceNode.start(0, offset);
        startedAt = audioCtx.currentTime - offset;
        isPlaying.value = true;

        sourceNode.onended = () => {
          if (isPlaying.value) {
            isPlaying.value = false;
            pausedAt = 0;
            progress.value = 0;
            currentTime.value = '0:00';
            cancelAnimationFrame(rafId);
          }
        };

        updateProgress();
      }

      function stopPlay() {
        if (sourceNode) {
          try { sourceNode.stop(); } catch(e) {}
          sourceNode = null;
        }
        if (audioCtx) {
          pausedAt = audioCtx.currentTime - startedAt;
        }
        isPlaying.value = false;
        cancelAnimationFrame(rafId);
      }

      function updateProgress() {
        if (!isPlaying.value || !audioCtx || !audioBuf) return;
        const elapsed = audioCtx.currentTime - startedAt;
        const dur = audioBuf.duration;
        progress.value = Math.min(100, (elapsed / dur) * 100);
        currentTime.value = fmtSec(elapsed);
        rafId = requestAnimationFrame(updateProgress);
      }

      function seek(e) {
        if (!audioBuf) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const seekTime = pct * audioBuf.duration;
        const wasPlaying = isPlaying.value;
        if (wasPlaying) {
          try { sourceNode.stop(); } catch(e2) {}
          sourceNode = null;
          isPlaying.value = false;
          cancelAnimationFrame(rafId);
        }
        pausedAt = seekTime;
        progress.value = pct * 100;
        currentTime.value = fmtSec(seekTime);
        if (wasPlaying) startPlay();
      }

      function setFilter(key, val) {
        filters[key] = val;
        if (isPlaying.value && audioCtx) {
          if (key === 'gain' && gainNode) {
            gainNode.gain.value = Math.pow(10, val / 20);
          } else if (key === 'highpass' && hpNode) {
            hpNode.frequency.value = val || 0;
          } else if (key === 'lowpass' && lpNode) {
            lpNode.frequency.value = val || audioCtx.sampleRate / 2;
          }
        }
      }

      // Loop selection via drag on canvas
      function onCanvasMousedown(e) {
        if (!audioBuf) return;
        const rect = e.currentTarget.getBoundingClientRect();
        _dragStart = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        _dragging = true;
        loopStart.value = _dragStart;
        loopEnd.value = _dragStart;
        loopActive.value = false;
      }

      function onCanvasMousemove(e) {
        if (!_dragging || !audioBuf) return;
        const rect = canvas.value.getBoundingClientRect();
        const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        loopStart.value = Math.min(_dragStart, pos);
        loopEnd.value = Math.max(_dragStart, pos);
      }

      function onCanvasMouseup(e) {
        if (!_dragging) return;
        _dragging = false;
        if (loopEnd.value - loopStart.value < 0.02) {
          // Too small = click, treat as seek
          loopStart.value = null; loopEnd.value = null; loopActive.value = false;
          seek(e);
          return;
        }
        loopActive.value = true;
        // Restart playback in loop
        const wasPlaying = isPlaying.value;
        if (wasPlaying) stopPlay();
        pausedAt = loopStart.value * audioBuf.duration;
        if (wasPlaying) startPlay();
      }

      function clearLoop() {
        loopStart.value = null; loopEnd.value = null; loopActive.value = false;
        if (isPlaying.value && sourceNode) {
          sourceNode.loop = false;
        }
      }

      function close() {
      if (_spectroFocusTrap) { _spectroFocusTrap(); _spectroFocusTrap = null; }
        cleanup();
        closeSpectroModal();
      }

      function cleanup() {
        if (sourceNode) { try { sourceNode.stop(); } catch(e) {} sourceNode = null; }
        if (audioCtx && audioCtx.state !== 'closed') { audioCtx.close().catch(() => {}); }
        audioCtx = null; audioBuf = null; pcmData = null;
        isPlaying.value = false;
        progress.value = 0;
        currentTime.value = '0:00';
        duration.value = '0:00';
        pausedAt = 0;
        filters.gain = 0; filters.highpass = 0; filters.lowpass = 0;
        loopStart.value = null; loopEnd.value = null; loopActive.value = false;
        cancelAnimationFrame(rafId);
      }

      function onKeydown(e) {
        if (!modal.open) return;
        if (e.key === 'Escape') { close(); e.preventDefault(); }
        if (e.key === ' ' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
          togglePlay(); e.preventDefault();
        }
      }

      // Watch modal open state
      watch(() => modal.open, (val) => {
        if (val) {
          pausedAt = 0;
          nextTick(() => { loadAudio(); });
          document.addEventListener('keydown', onKeydown);
        } else {
          cleanup();
          document.removeEventListener('keydown', onKeydown);
        }
      });

      onUnmounted(() => {
        cleanup();
        document.removeEventListener('keydown', onKeydown);
      });

      return {
        modal, loading, isPlaying, progress, currentTime, duration,
        filters, gainOpts, hpOpts, lpOpts,
        canvas, audioUrl, downloadName,
        loopStart, loopEnd, loopActive,
        togglePlay, seek, setFilter, close, t,
        onCanvasMousedown, onCanvasMousemove, onCanvasMouseup, clearLoop
      };
    },
    template: `
<div v-if="modal.open" class="spectro-modal-overlay" @click.self="close" @keydown.escape="close" role="dialog" aria-modal="true" :aria-label="modal.speciesName">
  <div class="spectro-modal">
    <div class="spectro-modal-header">
      <div>
        <div class="spectro-modal-species">{{modal.speciesName}}</div>
        <div class="spectro-modal-sci">{{modal.sciName}}</div>
        <div class="spectro-modal-meta">
          <span v-if="modal.confidence" class="conf-badge" :class="modal.confidence>=0.8?'conf-high':'conf-mid'">
            {{Math.round(modal.confidence*100)}}%
          </span>
          <span v-if="modal.date">{{modal.date}}</span>
          <span v-if="modal.time">{{modal.time}}</span>
        </div>
      </div>
      <button class="spectro-modal-close" @click="close" aria-label="Close">&times;</button>
    </div>
    <div class="spectro-modal-canvas-wrap" style="position:relative;user-select:none;"
         @mousedown="onCanvasMousedown" @mousemove="onCanvasMousemove" @mouseup="onCanvasMouseup">
      <canvas ref="canvas" :width="800" :height="200"></canvas>
      <div v-if="loading" class="spectro-modal-loading">Loading...</div>
      <div v-if="isPlaying" class="spectro-cursor" :style="{left: progress+'%'}"></div>
      <div v-if="loopStart != null && loopEnd != null && loopEnd > loopStart"
           class="spectro-loop-zone"
           :style="{left: (loopStart*100)+'%', width: ((loopEnd-loopStart)*100)+'%'}"></div>
      <div class="spectro-freq-labels">
        <span>12kHz</span><span>9</span><span>6</span><span>3</span><span>0</span>
      </div>
    </div>
    <div class="spectro-modal-controls">
      <button class="play-big" :class="{playing: isPlaying}" @click="togglePlay" :aria-label="isPlaying ? 'Pause' : 'Play'">
        {{isPlaying ? '\u23F9' : '\u25B6'}}
      </button>
      <div class="audio-progress-wrap">
        <div class="audio-progress-bar" @click="seek">
          <div class="audio-progress-fill" :style="{width: progress+'%'}"></div>
        </div>
        <div class="audio-time">{{currentTime}} / {{duration}}</div>
      </div>
      <button v-if="loopActive" class="spectro-loop-btn" @click="clearLoop" title="Clear loop">🔁 ✕</button>
      <a :href="audioUrl" :download="downloadName" class="spectro-modal-dl" title="Download">\u2B07</a>
    </div>
    <div class="spectro-modal-filters">
      <div style="font-size:.72rem;color:var(--text-muted,#7a8a9e);margin-bottom:.4rem;padding:0 .2rem;">
        {{t('spectro_filters_hint')}}
      </div>
      <div class="spectro-modal-filter-group">
        <span class="rstb-flabel"><bird-icon name="volume-2" :size="12"></bird-icon> {{t('spectro_gain')}}</span>
        <div class="stb-pills">
          <button v-for="g in gainOpts" :key="g" class="stb-pill stb-pill-sm"
                  :class="{'stb-pill-active': filters.gain===g}"
                  @click="setFilter('gain',g)">{{g===0?'Off':'+'+g+'dB'}}</button>
        </div>
      </div>
      <div class="spectro-modal-filter-group">
        <span class="rstb-flabel"><bird-icon name="arrow-up" :size="12"></bird-icon> {{t('spectro_highpass')}}</span>
        <div class="stb-pills">
          <button v-for="h in hpOpts" :key="h" class="stb-pill stb-pill-sm"
                  :class="{'stb-pill-active': filters.highpass===h}"
                  @click="setFilter('highpass',h)">{{h===0?'Off':h>=1000?(h/1000)+'kHz':h+'Hz'}}</button>
        </div>
      </div>
      <div class="spectro-modal-filter-group">
        <span class="rstb-flabel"><bird-icon name="arrow-down" :size="12"></bird-icon> {{t('spectro_lowpass')}}</span>
        <div class="stb-pills">
          <button v-for="l in lpOpts" :key="l" class="stb-pill stb-pill-sm"
                  :class="{'stb-pill-active': filters.lowpass===l}"
                  @click="setFilter('lowpass',l)">{{l===0?'Off':l>=1000?(l/1000)+'kHz':l+'Hz'}}</button>
        </div>
      </div>
    </div>
  </div>
</div>`
  };

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
    app.component('spectro-modal', SpectroModal);
    app.component('filter-period', FilterPeriod);
    app.component('filter-confidence', FilterConfidence);
    app.component('filter-species', FilterSpecies);
    return app;
  }

  // ── Export global ─────────────────────────────────────────────────────────
  window.BIRDASH = {
    // Vue composables
    useI18n, useTheme, useNav, useChart, useAudio, useAudioPlayer, useFavorites, useSpeciesNames, useToast, updateSiteIdentity, exportChart,
    // Filter composables
    useFilterPeriod, useFilterConfidence, useFilterSpecies, buildWhereClause,
    // Vue components
    PibirdShell, BirdIcon, registerComponents, MODEL_LABELS, vSwipe,
    // Wrapper with reactive lang injection (calls BIRDASH_UTILS under the hood)
    buildSpeciesLinks,
    // Re-exports from BIRDASH_UTILS for backward compatibility
    // (pages destructure these from BIRDASH, so they must remain available)
    birdQuery:        U.birdQuery,
    escHtml:          U.escHtml,
    safeHtml:         U.safeHtml,
    authHeaders:      U.authHeaders,
    fmtDate:          U.fmtDate,
    fmtTime:          U.fmtTime,
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
