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
    { section: 'nav_sec_home', icon: 'home', items: [
      { id: 'dashboard',   icon: 'zap', file: 'dashboard.html'   },
      { id: 'overview',     icon: 'layout-dashboard', file: 'overview.html'     },
      { id: 'today',        icon: 'calendar-days', file: 'today.html'        },
    ]},
    { section: 'nav_sec_realtime', icon: 'circle-dot', items: [
      { id: 'spectrogram',  icon: 'radio', file: 'spectrogram.html'  },
      { id: 'log',          icon: 'scroll-text', file: 'log.html'          },
    ]},
    { section: 'nav_sec_history', icon: 'history', items: [
      { id: 'calendar',     icon: 'calendar', file: 'calendar.html'     },
      { id: 'timeline',     icon: 'sunrise', file: 'timeline.html'     },
      { id: 'detections',   icon: 'list', file: 'detections.html'   },
      { id: 'review',       icon: 'check-circle', file: 'review.html'       },
    ]},
    { section: 'nav_sec_species', icon: 'bird', items: [
      { id: 'species',      icon: 'search', file: 'species.html'      },
      { id: 'rarities',     icon: 'gem', file: 'rarities.html'     },
      { id: 'gallery',      icon: 'trophy', file: 'gallery.html'      },
      { id: 'recordings',   icon: 'music', file: 'recordings.html'   },
      { id: 'favorites',    icon: 'star', file: 'favorites.html'    },
    ]},
    { section: 'nav_sec_indicators', icon: 'trending-up', items: [
      { id: 'weather',      icon: 'cloud-sun', file: 'weather.html'     },
      { id: 'stats',        icon: 'trending-up', file: 'stats.html'        },
      { id: 'analyses',     icon: 'microscope', file: 'analyses.html'     },
      { id: 'biodiversity', icon: 'leaf', file: 'biodiversity.html' },
      { id: 'models',       icon: 'cpu', file: 'models.html'       },
      { id: 'phenology',    icon: 'calendar-days', file: 'phenology.html'    },
    ]},
    { section: 'nav_sec_system', icon: 'settings', items: [
      { id: 'settings',     icon: 'settings', file: 'settings.html'    },
      { id: 'system',       icon: 'monitor', file: 'system.html'      },
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
