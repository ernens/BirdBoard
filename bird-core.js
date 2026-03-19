/**
 * bird-core.js — Utilitaires partagés BIRDASH
 * Dépend de : bird-config.js, bird-i18n.js
 */

// ── Requêtes API ────────────────────────────────────────────────────────────

async function birdQuery(sql, params = []) {
  const res = await fetch(`${BIRD_CONFIG.apiUrl}/query`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ sql, params }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  // Transforme en tableau d'objets
  return data.rows.map(row => {
    const obj = {};
    data.columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });
}

// ── Formatage ────────────────────────────────────────────────────────────────

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function fmtConf(val) {
  if (val == null) return '—';
  return (parseFloat(val) * 100).toFixed(1) + '%';
}

function fmtTime(timeStr) {
  if (!timeStr) return '—';
  return timeStr.substring(0, 5); // HH:MM
}

function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDateStr(d);
}

function freshnessLabel(dateStr, timeStr) {
  if (!dateStr || !timeStr) return '—';
  const last = new Date(`${dateStr}T${timeStr}`);
  const diffMs = Date.now() - last.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60)   return t('minutes_ago', { n: diffMin });
  if (diffMin < 1440) return t('hours_ago',   { n: Math.floor(diffMin / 60) });
  return t('days_ago', { n: Math.floor(diffMin / 1440) });
}

// ── Audio ────────────────────────────────────────────────────────────────────

let _currentAudio = null;

function buildAudioUrl(fileName) {
  return getAudioUrl(fileName); // défini dans bird-config.js
}

function toggleAudio(fileName, btnEl) {
  const url = buildAudioUrl(fileName);
  if (!url) return;

  // Si on clique sur le bouton actif → pause
  if (_currentAudio && btnEl.classList.contains('playing')) {
    _currentAudio.pause();
    _currentAudio = null;
    document.querySelectorAll('.play-btn.playing').forEach(b => b.classList.remove('playing'));
    return;
  }

  // Stoppe l'audio précédent
  if (_currentAudio) {
    _currentAudio.pause();
    document.querySelectorAll('.play-btn.playing').forEach(b => b.classList.remove('playing'));
  }

  const audio = new Audio(url);
  _currentAudio = audio;
  btnEl.classList.add('playing');

  audio.play().catch(err => {
    console.error('[BIRDASH] Audio error:', err);
    btnEl.classList.remove('playing');
  });

  audio.addEventListener('ended', () => {
    btnEl.classList.remove('playing');
    _currentAudio = null;
  });
}

// ── Liens externes ────────────────────────────────────────────────────────────

function buildSpeciesLinks(comName, sciName) {
  const sci = encodeURIComponent(sciName || '');
  const com = encodeURIComponent(comName || '');
  const sciWiki = (sciName || '').replace(/ /g, '_');
  return {
    xenocanto:   { url: `https://xeno-canto.org/explore?query=${sci}`,
                   label: 'Xeno-canto', icon: '🎵' },
    ebird:       { url: `https://ebird.org/search?q=${sci}`,
                   label: 'eBird', icon: '🌍' },
    wikipedia:   { url: `https://fr.wikipedia.org/wiki/${sciWiki}`,
                   label: 'Wikipédia', icon: '📖' },
    inaturalist: { url: `https://www.inaturalist.org/taxa/search?q=${sci}`,
                   label: 'iNaturalist', icon: '🔬' },
    observation: { url: `https://observation.be/species/default.aspx?name=${com}`,
                   label: 'Observation.be', icon: '🐦' },
    avibase:     { url: `https://avibase.bsc-eoc.org/search.jsp?query=${sci}`,
                   label: 'Avibase', icon: '📋' },
  };
}

// Fetche l'image Wikipedia pour une espèce
async function fetchSpeciesImage(sciName) {
  if (!sciName) return null;
  const title = sciName.replace(/ /g, '_');
  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.thumbnail?.source || null;
  } catch { return null; }
}

// ── Navigation ────────────────────────────────────────────────────────────────

function getUrlParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function navigateTo(page, params = {}) {
  const qs = new URLSearchParams(params).toString();
  window.location.href = `${page}${qs ? '?' + qs : ''}`;
}

// ── Rendu communs ─────────────────────────────────────────────────────────────

function renderNav(activePage) {
  const nav = document.getElementById('main-nav');
  if (!nav) return;

  const navKeys = {
    'index':        'nav_overview',
    'detections':   'nav_detections',
    'especes':      'nav_species',
    'biodiversite': 'nav_biodiversity',
    'rarites':      'nav_rarities',
    'stats':        'nav_stats',
    'analyses':     'nav_analyses',
    'systeme':      'nav_system',
  };

  nav.innerHTML = BIRD_CONFIG.pages.map(p => {
    const label = t(navKeys[p.id] || p.id);
    const active = p.id === activePage ? 'active' : '';
    return `<a href="${p.file}" class="nav-link ${active}" title="${label}">
      <span class="nav-icon">${p.icon}</span>
      <span class="nav-label">${label}</span>
    </a>`;
  }).join('');
}

function renderLangSwitcher() {
  const el = document.getElementById('lang-switcher');
  if (!el) return;
  const current = getLang();
  el.innerHTML = getAvailableLangs().map(({ code, label, flag }) =>
    `<button class="lang-btn ${code === current ? 'active' : ''}"
             data-lang="${code}"
             title="${label}"
             onclick="setLang('${code}')">${flag ? flag + ' ' : ''}${code.toUpperCase()}</button>`
  ).join('');
}

// ── Système de thèmes ─────────────────────────────────────────────────────────

const THEMES = [
  { id: 'forest', label: 'Forêt'  },
  { id: 'night',  label: 'Nuit'   },
  { id: 'paper',  label: 'Papier' },
  { id: 'ocean',  label: 'Océan'  },
  { id: 'dusk',   label: 'Dusk'   },
];

function getTheme() {
  return localStorage.getItem('birdash-theme') || 'forest';
}

function setTheme(id) {
  localStorage.setItem('birdash-theme', id);
  document.documentElement.setAttribute('data-theme', id);
  // Met à jour l'état actif des boutons
  document.querySelectorAll('.theme-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.t === id);
    b.title = THEMES.find(t => t.id === b.dataset.t)?.label || b.dataset.t;
  });
}

function renderThemeSwitcher() {
  const el = document.getElementById('theme-switcher');
  if (!el) return;
  const current = getTheme();
  el.innerHTML = THEMES.map(th =>
    `<button class="theme-btn ${th.id === current ? 'active' : ''}"
             data-t="${th.id}"
             title="${th.label}"
             onclick="setTheme('${th.id}')"></button>`
  ).join('');
}

// ── Init commune ──────────────────────────────────────────────────────────────

function initPage(pageId) {
  const NAV_KEYS = {
    'index': 'nav_overview', 'detections': 'nav_detections',
    'especes': 'nav_species', 'biodiversite': 'nav_biodiversity',
    'rarites': 'nav_rarities', 'stats': 'nav_stats',
    'systeme': 'nav_system', 'analyses': 'nav_analyses',
  };

  // Thème
  document.documentElement.setAttribute('data-theme', getTheme());

  // Render composants header
  renderNav(pageId);
  renderLangSwitcher();
  renderThemeSwitcher();

  // Initialiser tous les data-i18n du DOM
  initI18nDOM();

  // Titre de la page
  const titleEl = document.getElementById('page-title');
  if (titleEl) titleEl.textContent = t(NAV_KEYS[pageId] || pageId);

  // Ré-render sur changement de langue
  document.addEventListener('langchange', () => {
    renderNav(pageId);
    renderLangSwitcher();
    initI18nDOM();
    if (titleEl) titleEl.textContent = t(NAV_KEYS[pageId] || pageId);
  });
}

// ── Chart.js helpers ──────────────────────────────────────────────────────────

function chartDefaults() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: '#7a9b7d', font: { family: 'Lora' } } },
      tooltip: {
        backgroundColor: '#131f14',
        borderColor: '#2d4a2f',
        borderWidth: 1,
        titleColor: '#e8f0e9',
        bodyColor: '#7a9b7d',
      }
    },
    scales: {
      x: { ticks: { color: '#7a9b7d' }, grid: { color: '#1a2b1c' } },
      y: { ticks: { color: '#7a9b7d' }, grid: { color: '#1a2b1c' } },
    }
  };
}

// Spinner HTML
function spinnerHTML() {
  return `<div class="spinner"><div></div><div></div><div></div></div>`;
}

// Affiche une erreur dans un conteneur
function showError(containerId, msg) {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = `<div class="error-msg">⚠ ${msg}</div>`;
}
