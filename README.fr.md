# 🐦 Birdash

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js)](https://nodejs.org)
[![Vue 3](https://img.shields.io/badge/Vue.js-3-4FC08D?logo=vue.js)](https://vuejs.org)

Dashboard et moteur de detection d'oiseaux pour Raspberry Pi 5. Architecture dual-modele autonome avec BirdNET V2.4 + Perch V2.

> [English](README.md) | [Nederlands](README.nl.md) | [Deutsch](README.de.md)

## Architecture

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
- 🤖 **Inference dual-modele** — BirdNET V2.4 (rapide, ~2s) + Perch V2 (precis, ~2s) en parallele
- 🎙️ **Enregistrement local** — interface USB via ALSA avec gain configurable
- 🎚️ **Normalisation adaptative** — gain logiciel automatique selon le bruit ambiant, protection clipping, gel activite, mode observateur
- 🔇 **Filtres audio** — passe-haut + passe-bas (bandpass), reduction de bruit spectrale (gating stationnaire), normalisation RMS
- 📡 **BirdWeather** — upload automatique des paysages sonores + detections
- 🔔 **Notifications intelligentes** — alertes ntfy.sh pour especes rares, premiere de saison, nouvelle espece (pas chaque moineau)
- ⚡ **Post-traitement async** — extraction MP3, spectrogrammes, sync DB ne bloquent pas l'inference

### Dashboard
- 📊 Vue d'ensemble avec KPIs, graphiques, resume matinal
- 🌅 **Timeline** — timeline interactive avec gradient de ciel, marqueurs lever/coucher de soleil SVG, zoom par clic sur la barre de densite, disposition verticale par confiance, details enrichis en zoom profond, clustering d'evenements
- 🎵 **Spectrogramme live** — audio en temps reel du micro avec noms d'oiseaux
- 🎧 Fil de detections avec lecture audio integree et filtres gain/passe-haut/passe-bas
- 🦜 Fiches especes avec photos, statut UICN, favoris (SQLite), notes personnelles, phenologie calendaire, comparaison annee/annee, export PNG
- 🧬 Matrice biodiversite, indice de Shannon, taxonomie
- 💎 Suivi des especes rares
- 📈 Statistiques et classements avec onglet comparaison de modeles
- 🏆 Galerie des meilleures captures avec bibliotheque audio
- 🔬 Analyses avancees (diagrammes polaires, heatmaps, series temporelles)
- 🌦️ **Meteo** — page dediee avec correlation meteo/activite, prevision J+1, especes par conditions
- 📆 **Calendrier** — vue unifiee timeline + especes + lecteur audio par date
- 🌅 **Timeline pleine page** — zoom par glisser, slider densite unifie, badges filtres avec clignotement

### Navigation
- 5 sections (En direct, Historique, Especes, Analyses, Station)
- Barre de navigation mobile, recherche globale espece+date, cloche notifications, badge "A valider"

### Revue des detections
- 🔍 **Auto-flagging** — especes nocturnes de jour, migrateurs hors saison, confiance faible isolee, especes non-europeennes
- ✅ **Actions en masse** — confirmer/rejeter/supprimer par regle ou par selection avec apercu
- 🎵 Spectrogramme complet avec filtres et selection de boucle pour verification manuelle
- 🗑️ **Suppression definitive** — apercu avant suppression (DB + fichiers audio), rapport de resultat

### Configuration audio
- 🎙️ Detection automatique des peripheriques USB audio
- 🎚️ **Gain adaptatif** — estimation bruit de fond, protection clipping, mode observateur/application
- 🔇 **Bandpass + debruitage** — filtre passe-bas (4-15 kHz), reduction spectrale (noisereduce), activable par profil
- 👁️ **Previsualisation filtres** — spectrogrammes avant/apres depuis le micro pour visualiser l'effet des filtres
- 🎛️ 6 profils d'environnement (jardin, foret, bord de route, ville, nuit, test)
- ⚖️ Assistant de calibration inter-canaux pour micros EM272
- 📊 VU-metres en temps reel via SSE

### Reglages et systeme
- 🔧 Interface complete — modeles, parametres d'analyse, notifications, audio, sauvegarde
- 🖥️ Sante systeme — CPU, RAM, disque, temperature, services
- 💻 **Terminal web** — bash complet dans le navigateur, supporte Claude Code
- 💾 **Sauvegarde** — NFS/SMB/SFTP/S3/GDrive/WebDAV avec planification
- 🎨 5 themes (Foret, Nuit, Papier, Ocean, Crepuscule)
- 🌍 4 langues UI (FR/EN/NL/DE) + 36 langues pour les noms d'especes

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

```bash
cd ~
git clone https://github.com/ernens/birdash.git
cd birdash
chmod +x install.sh
./install.sh
```

L'installateur gere tout automatiquement : paquets systeme, Caddy, ttyd, bases de donnees, modeles, services et cron. Editez ensuite :

1. `/etc/birdnet/birdnet.conf` — coordonnees, langue
2. `engine/config.toml` — station, BirdWeather, ntfy
3. `public/js/birdash-local.js` — localisation, cle eBird

Demarrez les services :
```bash
sudo systemctl enable --now birdengine-recording birdengine birdash caddy ttyd
```

Dashboard : `http://votre-pi.local/birds/`

> Le modele BirdNET V2.4 doit etre copie manuellement (licence CC-NC-SA).

## Tests

```bash
npm test                    # 40 tests Node.js
cd engine && ../engine/venv/bin/python -m unittest test_engine -v  # 13 tests Python
```

## Licence

[MIT](LICENSE)
