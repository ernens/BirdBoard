# 🐦 BirdStation

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js)](https://nodejs.org)
[![Vue 3](https://img.shields.io/badge/Vue.js-3-4FC08D?logo=vue.js)](https://vuejs.org)

Dashboard et moteur de detection d'oiseaux pour Raspberry Pi 5. Architecture dual-modele autonome avec BirdNET V2.4 + Perch V2. Nom de station et branding personnalisables.

> [English](README.md) | [Nederlands](README.nl.md) | [Deutsch](README.de.md)

## Captures d'écran

<details>
<summary><b>En direct</b> — Tableau de bord · Aujourd'hui · Spectrogramme</summary>

<p align="center">
  <img src="screenshots/dashboard.png"   width="240" alt="Tableau de bord">
  <img src="screenshots/today.png"       width="240" alt="Aujourd'hui">
  <img src="screenshots/spectrogram.png" width="240" alt="Spectrogramme">
</p>
</details>

<details>
<summary><b>Historique</b> — Calendrier · Timeline · Détections · Validation</summary>

<p align="center">
  <img src="screenshots/calendar.png"   width="240" alt="Calendrier">
  <img src="screenshots/timeline.png"   width="240" alt="Timeline">
  <img src="screenshots/detections.png" width="240" alt="Détections">
  <img src="screenshots/review.png"     width="240" alt="Validation">
</p>
</details>

<details>
<summary><b>Espèces</b> — Espèce · Enregistrements · Galerie · Raretés</summary>

<p align="center">
  <img src="screenshots/species.png"    width="240" alt="Espèce">
  <img src="screenshots/recordings.png" width="240" alt="Enregistrements">
  <img src="screenshots/rarities.png"   width="240" alt="Raretés">
</p>
</details>

<details>
<summary><b>Indicateurs</b> — Météo · Statistiques · Analyses · Biodiversité · Phénologie</summary>

<p align="center">
  <img src="screenshots/weather.png"      width="240" alt="Météo">
  <img src="screenshots/stats.png"        width="240" alt="Statistiques">
  <img src="screenshots/analyses.png"     width="240" alt="Analyses">
  <img src="screenshots/biodiversity.png" width="240" alt="Biodiversité">
  <img src="screenshots/phenology.png"    width="240" alt="Phénologie">
</p>
</details>

<details>
<summary><b>Station</b> — Santé système, réglages &amp; terminal</summary>

<p align="center">
  <img src="screenshots/system.png"          width="240" alt="Santé système">
  <img src="screenshots/system-model.png"    width="240" alt="Moniteur des modèles">
  <img src="screenshots/system-data.png"     width="240" alt="Données système">
  <img src="screenshots/system-external.png" width="240" alt="Externe">
</p>
<p align="center">
  <img src="screenshots/settings-detection.png" width="240" alt="Détection">
  <img src="screenshots/settings-audio.png"     width="240" alt="Audio">
  <img src="screenshots/settings-notif.png"     width="240" alt="Notifications">
  <img src="screenshots/settings-station.png"   width="240" alt="Station">
</p>
<p align="center">
  <img src="screenshots/settings-services.png" width="240" alt="Services">
  <img src="screenshots/settings-species.png"  width="240" alt="Espèces">
  <img src="screenshots/settings-backup.png"   width="240" alt="Sauvegarde">
  <img src="screenshots/settings-terminal.png" width="240" alt="Terminal">
</p>
</details>

## Architecture

> **[Documentation complète de l'architecture →](ARCHITECTURE.fr.md)** — référence technique détaillée : pipeline audio, base de données, performance, et plus.

```
Raspberry Pi 5 + SSD
├── Interface audio USB
│     ↓
├── BirdEngine (Python)
│   ├── Enregistrement (arecord → WAV 45s)
│   ├── BirdNET V2.4    (~2s/fichier, primaire)
│   ├── Perch V2 FP16   (~2s/fichier, secondaire)
│   ├── Extraction MP3 + spectrogrammes
│   ├── Upload BirdWeather
│   └── Notifications intelligentes (ntfy.sh)
│
├── Birdash (Node.js)
│   ├── API Dashboard (port 7474)
│   ├── Spectrogramme live (flux PCM + MP3)
│   ├── Module configuration audio
│   ├── Revue des detections + auto-flagging
│   └── Comparaison de modeles
│
├── Caddy (reverse proxy :80)
├── ttyd (terminal web)
└── SQLite (1M+ detections)
```

## Fonctionnalites

### Moteur de detection (BirdEngine)
- <img src="docs/icons/cpu.svg" width="16" align="top" alt=""> **Inference dual-modele** — BirdNET V2.4 (rapide, ~2s) + Perch V2 (precis, ~2s) en parallele
- <img src="docs/icons/mic.svg" width="16" align="top" alt=""> **Enregistrement local** — interface USB via ALSA avec gain configurable
- <img src="docs/icons/sliders-horizontal.svg" width="16" align="top" alt=""> **Normalisation adaptative** — gain logiciel automatique selon le bruit ambiant, protection clipping, gel activite, mode observateur
- <img src="docs/icons/volume-x.svg" width="16" align="top" alt=""> **Filtres audio** — passe-haut + passe-bas (bandpass), reduction de bruit spectrale (gating stationnaire), normalisation RMS
- <img src="docs/icons/radio.svg" width="16" align="top" alt=""> **BirdWeather** — upload automatique des paysages sonores + detections
- <img src="docs/icons/bell.svg" width="16" align="top" alt=""> **Notifications intelligentes** — alertes ntfy.sh pour especes rares, premiere de saison, nouvelle espece, favoris (pas chaque moineau)
- <img src="docs/icons/zap.svg" width="16" align="top" alt=""> **MQTT** — publication de chaque detection sur un broker MQTT (Mosquitto, EMQX, HiveMQ…) avec topic `<prefix>/<station>/detection`, topic `last_species` retenu et statut online/offline (LWT). Auto-discovery Home Assistant en option : entites `Last species` + `Last confidence` creees automatiquement
- <img src="docs/icons/bar-chart-3.svg" width="16" align="top" alt=""> **Endpoint Prometheus `/metrics`** — cible de scrape pour Prometheus / Grafana / VictoriaMetrics. Compteurs detections (total/jour/heure), especes, age derniere detection, taille DB, CPU temp, RAM, disque, ventilateur, uptime, toggles features, plus metriques process Node.js standard
- <img src="docs/icons/mic.svg" width="16" align="top" alt=""> **Niveau sonore en direct (Leq / crete)** — RMS et crete en dBFS calcules a chaque enregistrement, exposes sur `/metrics` et affiches en direct dans Reglages > Audio avec sparkline 60 points. Utile pour reperer vent, trafic, micro HS ou nuits silencieuses. Non calibre (tendance, pas SPL absolu)
- <img src="docs/icons/lock.svg" width="16" align="top" alt=""> **Authentification & controle d'acces** — opt-in, mono-utilisateur, bcrypt. 3 modes : `off` (LAN de confiance, par defaut), `protected` (login requis pour tout), **`public-read`** (le public consulte detections/especes/stats, login requis uniquement pour modifier la config). Cookies HMAC signes, pas de table de sessions a gerer. Bearer token toujours actif en parallele pour cron/automation. Tentatives de connexion limitees a 5/min/IP. Voir le mini-guide Cloudflare Tunnel dans le README anglais
- <img src="docs/icons/zap.svg" width="16" align="top" alt=""> **Post-traitement async** — extraction MP3, spectrogrammes, sync DB ne bloquent pas l'inference

### Dashboard
- <img src="docs/icons/bar-chart-3.svg" width="16" align="top" alt=""> Vue d'ensemble avec KPIs, graphiques, resume matinal
- <img src="docs/icons/sunrise.svg" width="16" align="top" alt=""> **Timeline** — timeline interactive avec gradient de ciel, marqueurs lever/coucher de soleil SVG, zoom par clic sur la barre de densite, disposition verticale par confiance, details enrichis en zoom profond, clustering d'evenements
- <img src="docs/icons/music.svg" width="16" align="top" alt=""> **Spectrogramme live** — audio en temps reel du micro avec noms d'oiseaux
- <img src="docs/icons/headphones.svg" width="16" align="top" alt=""> Fil de detections avec lecture audio integree et filtres gain/passe-haut/passe-bas
- <img src="docs/icons/bird.svg" width="16" align="top" alt=""> Fiches especes avec photos, statut UICN, favoris (SQLite), notes personnelles, phenologie calendaire, comparaison annee/annee, export PNG
- <img src="docs/icons/dna.svg" width="16" align="top" alt=""> Matrice biodiversite, indice de Shannon, taxonomie
- <img src="docs/icons/star.svg" width="16" align="top" alt=""> **Favoris** — page dediee avec KPIs, recherche, tri ; toggle coeur sur toutes les listes d'especes
- <img src="docs/icons/gem.svg" width="16" align="top" alt=""> Suivi des especes rares
- <img src="docs/icons/trending-up.svg" width="16" align="top" alt=""> Statistiques et classements avec onglet comparaison de modeles
- <img src="docs/icons/trophy.svg" width="16" align="top" alt=""> Galerie des meilleures captures avec bibliotheque audio
- <img src="docs/icons/microscope.svg" width="16" align="top" alt=""> Analyses avancees (diagrammes polaires, heatmaps, series temporelles)
- <img src="docs/icons/cloud-sun.svg" width="16" align="top" alt=""> **Meteo** — page dediee avec correlation meteo/activite, prevision J+1, especes par conditions
- <img src="docs/icons/calendar-days.svg" width="16" align="top" alt=""> **Calendrier** — vue unifiee timeline + especes + lecteur audio par date
- <img src="docs/icons/sunrise.svg" width="16" align="top" alt=""> **Timeline pleine page** — zoom par glisser, slider densite unifie, badges filtres avec clignotement

### Station
- <img src="docs/icons/list.svg" width="16" align="top" alt=""> **Log live** — dashboard temps reel (SSE) avec categories colorees, filtres, KPIs (detections/BirdWeather/erreurs), pause/reprise, auto-scroll

### Navigation
- 5 sections (En direct, Historique, Especes, Analyses, Station)
- Barre de navigation mobile, recherche globale espece+date, cloche notifications, badge "A valider"

### Revue des detections
- <img src="docs/icons/search.svg" width="16" align="top" alt=""> **Auto-flagging** — especes nocturnes de jour, migrateurs hors saison, confiance faible isolee, especes non-europeennes
- <img src="docs/icons/check-circle.svg" width="16" align="top" alt=""> **Actions en masse** — confirmer/rejeter/supprimer par regle ou par selection avec apercu
- <img src="docs/icons/music.svg" width="16" align="top" alt=""> Spectrogramme complet avec filtres et selection de boucle pour verification manuelle
- <img src="docs/icons/trash-2.svg" width="16" align="top" alt=""> **Suppression definitive** — apercu avant suppression (DB + fichiers audio), rapport de resultat

### Configuration audio
- <img src="docs/icons/mic.svg" width="16" align="top" alt=""> Detection automatique des peripheriques USB audio
- <img src="docs/icons/sliders-horizontal.svg" width="16" align="top" alt=""> **Gain adaptatif** — estimation bruit de fond, protection clipping, mode observateur/application
- <img src="docs/icons/volume-x.svg" width="16" align="top" alt=""> **Bandpass + debruitage** — filtre passe-bas (4-15 kHz), reduction spectrale (noisereduce), activable par profil
- <img src="docs/icons/eye.svg" width="16" align="top" alt=""> **Previsualisation filtres** — spectrogrammes avant/apres depuis le micro pour visualiser l'effet des filtres
- <img src="docs/icons/sliders-horizontal.svg" width="16" align="top" alt=""> 6 profils d'environnement (jardin, foret, bord de route, ville, nuit, test)
- <img src="docs/icons/scale.svg" width="16" align="top" alt=""> Assistant de calibration inter-canaux pour micros EM272
- <img src="docs/icons/bar-chart-3.svg" width="16" align="top" alt=""> VU-metres en temps reel via SSE

### Reglages et systeme
- <img src="docs/icons/wrench.svg" width="16" align="top" alt=""> Interface complete — modeles, parametres d'analyse, notifications, audio, sauvegarde
- <img src="docs/icons/monitor.svg" width="16" align="top" alt=""> Sante systeme — CPU, RAM, disque, temperature, services
- <img src="docs/icons/terminal.svg" width="16" align="top" alt=""> **Terminal web** — bash complet dans le navigateur, supporte Claude Code
- <img src="docs/icons/save.svg" width="16" align="top" alt=""> **Sauvegarde** — NFS/SMB/SFTP/S3/GDrive/WebDAV avec planification
- <img src="docs/icons/sparkles.svg" width="16" align="top" alt=""> **11 themes** — 7 sombres (Foret, Nuit, Ocean, Crepuscule, Solar Dark, Nord, High Contrast AAA), 3 clairs (Papier, Sepia, Solar Light), plus un mode **Auto** qui suit le `prefers-color-scheme` du systeme. Mini-apercus de page dans le selecteur, fondu doux entre themes, systeme de design entierement par tokens (voir [`docs/THEMES.md`](docs/THEMES.md))
- <img src="docs/icons/image.svg" width="16" align="top" alt=""> **Gestion des photos** — bannir/remplacer, definir la photo preferee par espece
- <img src="docs/icons/flag.svg" width="16" align="top" alt=""> **Branding personnalisable** — nom de station et en-tete configurables dans les reglages
- <img src="docs/icons/globe.svg" width="16" align="top" alt=""> **Traduction des noms d'especes** — noms affiches dans la langue choisie sur toutes les pages
- <img src="docs/icons/globe.svg" width="16" align="top" alt=""> 4 langues UI (FR/EN/NL/DE) + 36 langues pour les noms d'especes

## Modeles Perch V2 optimises

Nous publions **3 variantes optimisees de Perch V2** converties depuis le SavedModel officiel Google :

**[ernensbjorn/perch-v2-int8-tflite](https://huggingface.co/ernensbjorn/perch-v2-int8-tflite)** sur HuggingFace

| Modele | Taille | Vitesse (Pi 5) | Qualite | Ideal pour |
|--------|--------|----------------|---------|------------|
| `perch_v2_original.tflite` | 409 MB | 435 ms | reference | Reference |
| `perch_v2_fp16.tflite` | 205 MB | 384 ms | top-1 100% | **Pi 5** |
| `perch_v2_dynint8.tflite` | 105 MB | 299 ms | top-1 93% | **Pi 4** |

Benchmark sur 20 enregistrements reels de 20 especes, 4 threads.

## Materiel

| Composant | Recommande |
|-----------|------------|
| SBC | Raspberry Pi 5 (8 Go) |
| Stockage | SSD NVMe (500 Go+) |
| Audio | Interface USB (ex: RODE AI-Micro, Focusrite Scarlett, Behringer UMC) |
| Reseau | Ethernet ou WiFi |

## Installation

### Installation en une commande (recommandé)

```bash
curl -sSL https://raw.githubusercontent.com/ernens/birdash/main/bootstrap.sh | bash
```

L'installateur gère tout automatiquement : paquets système, Caddy, ttyd, bases de données, modèles Perch V2 + BirdNET V2.4, détection GPS automatique (via ipapi.co), configuration ALSA avec dsnoop, services systemd et cron. Le dashboard est accessible dès la fin de l'installation.

Dashboard : `http://votre-pi.local/birds/`

Pour sauter le téléchargement de BirdNET (licence CC-BY-NC-SA 4.0) :
```bash
curl -sSL https://raw.githubusercontent.com/ernens/birdash/main/bootstrap.sh | BIRDASH_SKIP_BIRDNET=1 bash
```

## Mise à jour

Un bandeau rouge apparaît automatiquement quand une mise à jour est disponible. Cliquez **Voir** puis **Installer maintenant**. Ou via SSH :

```bash
ssh user@votre-pi.local 'bash ~/birdash/scripts/update.sh'
```

## Tests

```bash
npm test                    # 160 tests Node.js
cd engine && ../engine/venv/bin/python -m unittest test_engine -v  # 13 tests Python
```

## Licence

[MIT](LICENSE)
