# 🐦 BirdBoard

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js)](https://nodejs.org)
[![Vue 3](https://img.shields.io/badge/Vue.js-3-4FC08D?logo=vue.js)](https://vuejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Dashboard ornithologique moderne pour [BirdNET-Pi](https://github.com/mcguirepr89/BirdNET-Pi).
Interface Vue 3 (CDN) avec backend Node.js, multilingue (FR/EN/NL/DE + 36 langues pour les noms d'espèces).

> [English version](README.en.md) · [Contributing](CONTRIBUTING.md)

## Screenshots

| Vue d'ensemble | Fiche espèce |
|:-:|:-:|
| ![Dashboard](screenshots/dashboard.png) | ![Species](screenshots/species.png) |

| Enregistrements | Détections |
|:-:|:-:|
| ![Recordings](screenshots/recordings.png) | ![Detections](screenshots/detections.png) |

| Biodiversité | Rarités |
|:-:|:-:|
| ![Biodiversity](screenshots/biodiversity.png) | ![Rarities](screenshots/rarities.png) |

| Spectrogramme | Statistiques |
|:-:|:-:|
| ![Spectrogram](screenshots/spectrogram.png) | ![Stats](screenshots/stats.png) |

## Fonctionnalités

- 📊 Vue d'ensemble avec 6 KPIs (détections, espèces, confiance, total, dernière heure, espèces rares) et graphiques temps réel (activité aujourd'hui + 7 jours avec trendline)
- 🎙️ Feed des détections avec lecture audio intégrée
- 🦜 Fiches espèces détaillées avec carrousel photos (iNaturalist + Wikipedia)
- 🧬 Infos taxonomiques, statut de conservation (IUCN), envergure
- 🗓️ Matrice biodiversité (heures × espèces)
- 💎 Espèces rares et alertes
- 📈 Statistiques et classements
- 🎵 Spectrogramme audio avec nettoyage DSP
- 🏆 Meilleurs enregistrements avec photos uniformes et lecteur
- 🖥️ État du système (CPU, RAM, disque, température)
- 🔬 Analyses avancées
- ⚡ Service Worker pour cache offline
- ♿ Accessibilité (WCAG AA, navigation clavier, skip-link)
- 🎨 5 thèmes modernes (Forest, Night, Paper, Ocean, Dusk)
- 🌍 4 langues d'interface (FR / EN / NL / DE) + noms d'espèces traduits automatiquement dans 36 langues via les labels BirdNET
- 🐦 Traduction automatique des noms d'espèces selon la langue choisie (fichiers BirdNET l18n)

## Prérequis

- BirdNET-Pi en fonctionnement (`~/BirdNET-Pi/scripts/birds.db` présent)
- Node.js >= 18 (`node --version`)
- Caddy (voir section Configuration Caddy ci-dessous)

## Installation

```bash
# 1. Cloner le dépôt
cd ~
git clone https://github.com/ernens/BirdBoard.git pibird

# 2. Installer les dépendances
cd ~/pibird
npm install

# 3. Configuration locale
#    Copier le template et renseigner vos paramètres
cp pibird-local.example.js pibird-local.js
nano pibird-local.js

# 4. Tester le serveur manuellement
node bird-server.js
# -> [PIBIRD] API démarrée sur http://127.0.0.1:7474
# Test : curl http://127.0.0.1:7474/api/health

# 5. Lancer les tests
npm test

# 6. Installer le service systemd
sudo cp pibird-api.service /etc/systemd/system/
#    Ajouter vos clés API dans un override systemd :
sudo systemctl edit pibird-api
#    [Service]
#    Environment=EBIRD_API_KEY=votre_clé
#    Environment=BW_STATION_ID=votre_station
sudo systemctl daemon-reload
sudo systemctl enable pibird-api
sudo systemctl start pibird-api
```

## Configuration Caddy

BirdBoard utilise Caddy comme reverse proxy pour servir l'API, les fichiers
audio et les pages statiques sous un même chemin `/birds/`.

### 1. Installer Caddy (si pas déjà installé)

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
```

### 2. Configurer le Caddyfile

Éditez `/etc/caddy/Caddyfile` et ajoutez le bloc BirdBoard :

```
VOTRE_HOSTNAME {
    encode zstd gzip

    # API : proxy vers le backend Node.js
    handle /birds/api/* {
        uri strip_prefix /birds
        reverse_proxy 127.0.0.1:7474
    }

    # Audio : fichiers audio extraits par BirdNET-Pi
    handle /birds/audio/* {
        uri strip_prefix /birds/audio
        root * /home/{USER}/BirdSongs/Extracted
        file_server
    }

    # Pages statiques du dashboard
    handle /birds* {
        root * /home/{USER}/pibird
        file_server
    }
}
```

Remplacez `{USER}` par votre nom d'utilisateur système.

### 3. Appliquer

```bash
caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## Vérification

```bash
# Tester l'API
curl http://127.0.0.1:7474/api/health

# Lancer les tests backend (19 tests)
npm test

# Ouvrir le dashboard
# http://VOTRE_HOSTNAME/birds/
```

## Structure du projet

```
BirdBoard/
├── bird-server.js           # Backend Node.js (API HTTP + SQLite)
├── bird-server.test.js      # Tests backend (19 tests)
├── bird-config.js           # Configuration centrale
├── bird-vue-core.js         # Composables Vue 3 (PibirdShell, i18n, thèmes)
├── bird-styles.css          # Styles globaux + 5 thèmes
├── bird-pages.css           # Styles spécifiques par page
├── sw.js                    # Service Worker (cache offline)
├── pibird-local.example.js  # Template config locale
├── pibird-api.service       # Service systemd
├── index.html               # Dashboard principal
├── species.html             # Fiche espèce (carrousel, stats, charts)
├── recordings.html          # Meilleurs enregistrements
├── detections.html          # Journal des détections
├── biodiversity.html        # Matrice biodiversité
├── rarities.html            # Espèces rares
├── stats.html               # Statistiques
├── analyses.html            # Analyses avancées
├── spectrogram.html         # Spectrogramme audio
├── today.html               # Détections du jour
├── recent.html              # Détections récentes
├── system.html              # État du système
├── screenshots/             # Captures d'écran
├── CONTRIBUTING.md          # Guide de contribution
└── LICENSE                  # Licence MIT
```

## Variables d'environnement

| Variable | Défaut | Description |
|----------|--------|-------------|
| `PIBIRD_PORT` | `7474` | Port du serveur API |
| `PIBIRD_DB` | `~/BirdNET-Pi/scripts/birds.db` | Chemin vers la base SQLite |
| `EBIRD_API_KEY` | — | Clé API eBird (optionnelle) |
| `BW_STATION_ID` | — | ID station BirdWeather (optionnelle) |

## Sécurité

- 🛡️ Rate limiting : 120 requêtes/min par IP
- 🔒 Validation SQL stricte (lecture seule, pas de multi-requêtes)
- 🔐 Headers de sécurité (X-Content-Type-Options, X-Frame-Options, Referrer-Policy)
- 🌐 CORS restreint aux origines configurées
- ✅ SRI (Subresource Integrity) sur les scripts CDN
- 🧹 Protection XSS (échappement HTML)
- 🙈 Masquage des erreurs SQL dans les réponses API

## Contribuer

Les contributions sont les bienvenues ! Consultez le [guide de contribution](CONTRIBUTING.md).

## Mise à jour

```bash
cd ~/pibird
git pull
npm install
sudo systemctl restart pibird-api
```

## Licence

[MIT](LICENSE) © ernens
