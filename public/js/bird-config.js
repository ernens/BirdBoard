/**
 * bird-config.js — Configuration centrale BIRDASH
 * Modifier ce fichier selon ton installation
 * Les surcharges locales vont dans birdash-local.js (non versionné)
 */

// Charger la config locale si elle existe (birdash-local.js)
const _local = (function() {
  try {
    if (typeof require !== 'undefined') {
      // Node.js (bird-server.js)
      return require('./birdash-local.js');
    }
  } catch(e) {}
  // Browser : BIRDASH_LOCAL doit être chargé avant bird-config.js
  return (typeof BIRDASH_LOCAL !== 'undefined') ? BIRDASH_LOCAL : {};
})();

const BIRD_CONFIG = {
  // URLs API (relatives — proxifiées par Caddy)
  apiUrl:   '/birds/api',
  audioUrl: '/birds/audio',

  // Optional API token for write operations (set in birdash-local.js)
  apiToken: _local.apiToken ?? '',

  // Paramètres analyse (surchargeables via birdash-local.js)
  defaultConfidence: _local.defaultConfidence ?? 0.7,
  topSpeciesCount:   10,
  recentDays:        30,
  rarityThreshold:   _local.rarityThreshold ?? 10,
  pageSize:          50,

  // Localisation (surchargeables via birdash-local.js)
  location: {
    lat:     (_local.location && _local.location.lat)     ?? 50.85,
    lon:     (_local.location && _local.location.lon)     ?? 4.35,
    name:    (_local.location && _local.location.name)    ?? 'Bruxelles',
    country: (_local.location && _local.location.country) ?? 'BE',
    region:  (_local.location && _local.location.region)  ?? 'BE',
  },

  // Nom du site affiché dans le header
  siteName: _local.siteName ?? (_local.location && _local.location.name) ?? 'Bruxelles',

  // Langue par défaut
  defaultLang: 'fr',

  // Navigation (grouped by user intent)
  nav: [
    { section: 'nav_sec_home', icon: '🏠', items: [
      { id: 'dashboard',   icon: '⚡', file: 'dashboard.html'   },
      { id: 'overview',     icon: '📊', file: 'overview.html'     },
      { id: 'today',        icon: '📅', file: 'today.html'        },
      { id: 'recent',       icon: '🕐', file: 'recent.html'       },
    ]},
    { section: 'nav_sec_realtime', icon: '🔴', items: [
      { id: 'spectrogram',  icon: '📡', file: 'spectrogram.html'  },
      { id: 'log',          icon: '📋', file: 'log.html'          },
    ]},
    { section: 'nav_sec_history', icon: '🗓️', items: [
      { id: 'calendar',     icon: '📆', file: 'calendar.html'     },
      { id: 'timeline',     icon: '🌅', file: 'timeline.html'     },
      { id: 'detections',   icon: '📋', file: 'detections.html'   },
      { id: 'review',       icon: '✅', file: 'review.html'       },
    ]},
    { section: 'nav_sec_species', icon: '🦜', items: [
      { id: 'species',      icon: '🔍', file: 'species.html'      },
      { id: 'rarities',     icon: '💎', file: 'rarities.html'     },
      { id: 'gallery',      icon: '🏆', file: 'gallery.html'      },
      { id: 'recordings',   icon: '🎵', file: 'recordings.html'   },
      { id: 'favorites',    icon: '⭐', file: 'favorites.html'    },
    ]},
    { section: 'nav_sec_indicators', icon: '📈', items: [
      { id: 'weather',      icon: '🌦️', file: 'weather.html'     },
      { id: 'stats',        icon: '📈', file: 'stats.html'        },
      { id: 'analyses',     icon: '🔬', file: 'analyses.html'     },
      { id: 'biodiversity', icon: '🌿', file: 'biodiversity.html' },
      { id: 'models',       icon: '🤖', file: 'models.html'       },
    ]},
    { section: 'nav_sec_system', icon: '⚙️', items: [
      { id: 'settings',     icon: '⚙️', file: 'settings.html'    },
      { id: 'system',       icon: '🖥️', file: 'system.html'      },
    ]},
  ],
  // Flat pages array (built from nav sections)
  get pages() {
    return this.nav.flatMap(s => s.items);
  },

  // Couleurs Chart.js
  chartColors: [
    '#5a9e3a', '#c8a84b', '#4a7eb5', '#a85c3a', '#7a5e9e',
    '#3a9e7a', '#9e3a5a', '#7a9e3a', '#c8664b', '#4ab5a8',
  ],
};

// Reconstruction du chemin audio à partir du File_Name
// Format disque : By_Date/{date}/{species}/{filename}
// Exemple : "Pie_bavarde-94-2023-09-18-birdnet-17:42:21.mp3"
//        → "/birds/audio/By_Date/2023-09-18/Pie_bavarde/Pie_bavarde-94-..."
function getAudioUrl(fileName) {
  if (!fileName) return null;
  // Extrait l'espèce (tout avant le -score-) et la date
  const m = fileName.match(/^(.+?)-\d+-(\d{4}-\d{2}-\d{2})-/);
  if (!m) return null;
  const species = m[1];  // 'Pie_bavarde', 'Martin-pêcheur_dEurope'
  const date    = m[2];  // '2023-09-18'
  return `${BIRD_CONFIG.audioUrl}/By_Date/${encodeURIComponent(date)}/${encodeURIComponent(species)}/${encodeURIComponent(fileName)}`;
}
