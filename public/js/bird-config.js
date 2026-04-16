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
      { id: 'overview',     icon: 'layout-dashboard', file: 'overview.html'     },
      { id: 'today',        icon: 'calendar-days', file: 'today.html'        },
    ]},
    { section: 'nav_sec_realtime', icon: 'circle-dot', items: [
      { id: 'dashboard',   icon: 'zap', file: 'dashboard.html'   },
      { id: 'liveboard',   icon: 'monitor', file: 'liveboard.html'  },
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
      { id: 'recordings',   icon: 'music', file: 'recordings.html'   },
      { id: 'favorites',    icon: 'star', file: 'favorites.html'    },
    ]},
    { section: 'nav_sec_indicators', icon: 'trending-up', items: [
      { id: 'weather',      icon: 'cloud-sun', file: 'weather.html'     },
      { id: 'stats',        icon: 'trending-up', file: 'stats.html'        },
      { id: 'analyses',     icon: 'microscope', file: 'analyses.html'     },
      { id: 'models',       icon: 'cpu', file: 'stats.html?tab=models' },
      { id: 'comparison',   icon: 'git-compare', file: 'comparison.html'  },
      { id: 'compare',      icon: 'split', file: 'compare.html'      },
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

