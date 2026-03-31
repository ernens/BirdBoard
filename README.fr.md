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
│   ├── Perch V2 INT8   (~12s/fichier, secondaire)
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
- 🤖 **Inference dual-modele** — BirdNET V2.4 (rapide, ~2s) + Perch V2 INT8 (precis, ~12s) en parallele
- 🎙️ **Enregistrement local** — interface USB via ALSA avec gain configurable
- 🎚️ **Normalisation adaptative** — gain logiciel automatique selon le bruit ambiant, protection clipping, gel activite, mode observateur
- 🔇 **Filtres audio** — passe-haut + passe-bas (bandpass), reduction de bruit spectrale (gating stationnaire), normalisation RMS
- 📡 **BirdWeather** — upload automatique des paysages sonores + detections
- 🔔 **Notifications intelligentes** — alertes ntfy.sh pour especes rares, premiere de saison, nouvelle espece (pas chaque moineau)
- ⚡ **Post-traitement async** — extraction MP3, spectrogrammes, sync DB ne bloquent pas l'inference

### Dashboard
- 📊 Vue d'ensemble avec KPIs, graphiques, resume matinal
- 🎵 **Spectrogramme live** — audio en temps reel du micro avec noms d'oiseaux
- 🎧 Fil de detections avec lecture audio integree
- 🦜 Fiches especes avec photos (iNaturalist + Wikipedia), statut UICN
- 🧬 Matrice biodiversite, indice de Shannon, taxonomie
- 💎 Suivi des especes rares
- 📈 Statistiques et classements
- 🏆 Galerie des meilleurs enregistrements
- 🔬 Analyses avancees (diagrammes polaires, heatmaps, series temporelles)

### Comparaison de modeles
- 🤖 **Cote a cote** — detections par modele, couverture d'especes, confiance
- 📊 **Graphique journalier** — tendances de detection par modele
- 🎯 **Especes exclusives** — ce que chaque modele detecte que l'autre rate
- 📋 **Tableau de recouvrement** — especes communes avec ratio de detection

### Revue des detections
- 🔍 **Auto-flagging** — especes nocturnes de jour, migrateurs hors saison, confiance faible isolee, especes non-europeennes
- ✅ **Actions en masse** — confirmer/rejeter par regle
- 🎵 Lecture audio par detection pour verification manuelle

### Configuration audio
- 🎙️ Detection automatique des peripheriques USB audio
- 🎚️ **Gain adaptatif** — estimation bruit de fond, protection clipping, mode observateur/application
- 🔇 **Bandpass + debruitage** — filtre passe-bas (4-15 kHz), reduction spectrale (noisereduce), activable par profil
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

## Modele quantifie

Nous publions le premier modele **Perch V2 INT8** quantifie pour le deploiement edge :

**[ernensbjorn/perch-v2-int8-tflite](https://huggingface.co/ernensbjorn/perch-v2-int8-tflite)** sur HuggingFace

~30% plus rapide sur Raspberry Pi 5 avec couverture identique (14 795 classes).

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
