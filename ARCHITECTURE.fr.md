# Architecture BirdStation

> [English](ARCHITECTURE.md) | [Deutsch](ARCHITECTURE.de.md) | [Nederlands](ARCHITECTURE.nl.md)

Référence technique complète du système BirdStation (birdash) — dashboard et moteur de détection d'oiseaux autonome pour Raspberry Pi.

> Ce document est maintenu en anglais pour des raisons de cohérence technique. La version complète se trouve dans [ARCHITECTURE.md](ARCHITECTURE.md).

## Résumé

```
Raspberry Pi 5 + SSD
├── Interface Audio USB (microphone)
│     ↓
├── BirdEngine (Python)
│   ├── Service d'enregistrement (arecord → WAV 45s)
│   ├── Pipeline audio : Gain adaptatif → Passe-haut → Passe-bas
│   │   → Soustraction de profil bruit → Normalisation RMS
│   ├── BirdNET V2.4 (primaire, ~2s/fichier)
│   ├── Perch V2 FP16 (secondaire, ~2s/fichier)
│   ├── Extraction MP3 + spectrogrammes
│   └── Notifications intelligentes (ntfy.sh)
│
├── Birdash (Node.js)
│   ├── API Dashboard (port 7474)
│   ├── Spectrogramme en direct (PCM + flux MP3)
│   ├── Worker thread pour What's New (non-bloquant)
│   ├── Télémétrie communautaire (Supabase, opt-in)
│   └── Signalement de bugs (GitHub Issues)
│
├── Caddy (reverse proxy :80)
├── ttyd (terminal web)
└── SQLite (1M+ détections)
```

### Composants clés

| Composant | Technologie | Rôle |
|-----------|------------|------|
| **BirdEngine** | Python 3 + TFLite | Enregistrement audio, filtrage, inférence dual-model |
| **Birdash** | Node.js + better-sqlite3 | API REST, 19 pages Vue 3, cache, agrégats |
| **Caddy** | Go | Reverse proxy HTTPS, gzip, fichiers statiques |
| **SQLite** | C | Stockage détections, validations, taxonomie |
| **Supabase** | PostgreSQL | Réseau communautaire (télémétrie opt-in) |

### Pipeline audio

```
🎤 Mic → Gain adaptatif → Passe-haut → Passe-bas → Profil bruit / Dénoise auto → RMS → 🐦 BirdNET + Perch
```

Chaque étape est configurable et peut être activée/désactivée indépendamment via **Réglages → Audio**.

### Pages du dashboard (19)

| Section | Pages |
|---------|-------|
| Accueil | Vue d'ensemble, Aujourd'hui |
| En direct | Bird Flow, Spectrogramme, Journal |
| Historique | Calendrier, Timeline, Détections, Révision |
| Espèces | Fiches, Galerie, Favoris, Raretés, Enregistrements |
| Indicateurs | Météo, Statistiques, Analyses, Biodiversité, Phénologie, Comparaison |
| Station | Réglages (9 onglets), Système |

### Performance

- **Worker thread** pour les calculs lourds (What's New : 10 requêtes SQL → thread séparé)
- **Cache proactif** : rafraîchissement toutes les 5 min en arrière-plan
- **Tables pré-agrégées** : daily_stats, monthly_stats, species_stats, hourly_stats
- **JS vendorisé** : Vue.js + Chart.js servis localement (pas de CDN)

→ **[Lire la documentation technique complète (EN)](ARCHITECTURE.md)**
