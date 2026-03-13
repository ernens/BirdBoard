/**
 * bird-config.js — Configuration centrale PIBIRD
 * Modifier ce fichier selon ton installation
 */

const BIRD_CONFIG = {
  // URLs API (relatives — proxifiées par Caddy)
  apiUrl:   '/birds/api',
  audioUrl: '/birds/audio',

  // Paramètres analyse
  defaultConfidence: 0.7,    // seuil affiché par défaut (0–1)
  topSpeciesCount:   10,      // nb espèces dans les classements
  recentDays:        30,      // fenêtre "récent" en jours
  rarityThreshold:   10,      // < N détections = espèce rare
  pageSize:          50,      // détections par page

  // Localisation (Bruxelles)
  location: {
    lat:  50.85,
    lon:  4.35,
    name: 'Bruxelles'
  },

  // Langue par défaut ('fr' | 'en' | 'nl')
  defaultLang: 'fr',

  // Navigation — ordre des pages dans le menu
  pages: [
    { id: 'index',        icon: '🦅', file: 'index.html'        },
    { id: 'today',        icon: '🌅', file: 'today.html'        },
    { id: 'spectrogram',  icon: '📡', file: 'spectrogram.html'  },
    { id: 'recordings',   icon: '🏆', file: 'recordings.html'   },
    { id: 'detections',   icon: '🎧', file: 'detections.html'   },
    { id: 'species',      icon: '🦜', file: 'species.html'      },
    { id: 'biodiversity', icon: '🌿', file: 'biodiversity.html' },
    { id: 'rarities',      icon: '💎', file: 'rarities.html'      },
    { id: 'stats',        icon: '📊', file: 'stats.html'        },
    { id: 'analyses',     icon: '🔬', file: 'analyses.html'     },
    { id: 'system',      icon: '⚙️',  file: 'system.html'      },
  ],

  // Couleurs pour Chart.js (palette naturelle)
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
  return `${BIRD_CONFIG.audioUrl}/By_Date/${date}/${species}/${encodeURIComponent(fileName)}`;
}
