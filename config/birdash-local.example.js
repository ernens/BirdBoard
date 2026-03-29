/**
 * birdash-local.js — Configuration locale BIRDASH
 * ─────────────────────────────────────────────
 * Ce fichier contient les paramètres spécifiques à ton installation.
 * Il N'est PAS versionné (ajouté à .gitignore).
 *
 * Copier ce fichier sur le Pi :
 *   cp birdash-local.example.js birdash-local.js
 * et remplir les valeurs ci-dessous.
 */

const BIRDASH_LOCAL = {

  // ── Localisation ──────────────────────────────────────────────────
  location: {
    name: 'My Location',      // Affiché dans l'en-tête
    lat:   48.8566,            // Latitude (ex: 48.8566 pour Paris)
    lon:   2.3522,             // Longitude (ex: 2.3522 pour Paris)
    country: 'FR',             // Code pays ISO 3166-1 alpha-2 (pour eBird)
    region:  'FR',             // Code région eBird (ex: BE, BE-BRU, FR-75…)
  },

  // ── Clés API externes ─────────────────────────────────────────────
  // Préférer les variables d'environnement : EBIRD_API_KEY, BW_STATION_ID
  // eBird API — clé gratuite sur https://ebird.org/api/keygen
  ebirdApiKey: process.env.EBIRD_API_KEY || 'YOUR_EBIRD_API_KEY',

  // BirdWeather — ID de ta station (visible dans l'URL app.birdweather.com/stations/XXXX)
  birdweatherStationId: process.env.BW_STATION_ID || '',

  // ── Paramètres analyse ────────────────────────────────────────────
  defaultConfidence: 0.7,   // Seuil de confiance par défaut (0–1)
  rarityThreshold:   10,    // Espèce rare si < N détections au total

  // ── Nom du site (affiché dans le header) ─────────────────────────
  siteName: 'My Station',

};

// Ne pas modifier — chargé par bird-config.js et bird-server.js
if (typeof module !== 'undefined') module.exports = BIRDASH_LOCAL;
