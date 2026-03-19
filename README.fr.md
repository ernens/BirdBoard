# 🐦 Birdash

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js)](https://nodejs.org)
[![Vue 3](https://img.shields.io/badge/Vue.js-3-4FC08D?logo=vue.js)](https://vuejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Dashboard ornithologique moderne pour [Nachtzuster/BirdNET-Pi](https://github.com/Nachtzuster/BirdNET-Pi).
Interface Vue 3 (CDN) avec backend Node.js, multilingue (FR/EN/NL/DE + 36 langues pour les noms d'espèces).

> **Birdash n'est pas un fork** — c'est un dashboard de remplacement pour l'interface web native de BirdNET-Pi.

> [English](README.md) · [Nederlands](README.nl.md) · [Deutsch](README.de.md) · [Contributing](CONTRIBUTING.md)

## Captures d'écran

| Vue d'ensemble | Fiche espèce |
|:-:|:-:|
| ![Dashboard](screenshots/dashboard.png) | ![Species](screenshots/species.png) |

| Enregistrements | Détections |
|:-:|:-:|
| ![Recordings](screenshots/recordings.png) | ![Detections](screenshots/detections.png) |

| Biodiversité | Raretés |
|:-:|:-:|
| ![Biodiversity](screenshots/biodiversity.png) | ![Rarities](screenshots/rarities.png) |

| Spectrogramme | Statistiques |
|:-:|:-:|
| ![Spectrogram](screenshots/spectrogram.png) | ![Stats](screenshots/stats.png) |

## Fonctionnalités

- 📊 Vue d'ensemble temps réel avec 6 KPIs et graphiques (activité du jour + tendance 7 jours avec trendline)
- 🎙️ Feed des détections avec lecture audio intégrée
- 🦜 Fiches espèces détaillées avec carrousel photos (iNaturalist + Wikipedia)
- 🧬 Infos taxonomiques, statut de conservation IUCN, envergure
- 🗓️ Matrice biodiversité (heures x espèces)
- 💎 Espèces rares et alertes
- 📈 Statistiques et classements
- 🎵 Spectrogramme audio avec nettoyage DSP
- 🏆 Meilleurs enregistrements avec photos uniformes et lecteur
- 🖥️ État du système (CPU, RAM, disque, température)
- 🔬 Analyses avancées
- 🔧 **Page réglages** — sélecteur de modèle, paramètres d'analyse, gestion des services
- 🤖 **Support Perch v2** — modèle Google DeepMind (15 000 espèces) en plus de BirdNET V2.4
- ⚡ Service Worker pour cache offline
- ♿ Accessibilité (WCAG AA, navigation clavier, skip-link)
- 🎨 5 thèmes modernes (Forest, Night, Paper, Ocean, Dusk)
- 🌍 4 langues d'interface (FR / EN / NL / DE) + noms d'espèces traduits automatiquement dans 36 langues via les labels BirdNET

## Testé avec

| BirdNET-Pi | Matériel | Statut |
|------------|----------|--------|
| [Nachtzuster/BirdNET-Pi](https://github.com/Nachtzuster/BirdNET-Pi) | Raspberry Pi 4/5 | ✅ Testé |

## Prérequis

- [Nachtzuster/BirdNET-Pi](https://github.com/Nachtzuster/BirdNET-Pi) en fonctionnement (`~/BirdNET-Pi/scripts/birds.db` présent)
- Node.js >= 18 (`node --version`)
- Caddy (voir section Configuration Caddy ci-dessous)

## Installation

```bash
# 1. Cloner le dépôt
cd ~
git clone https://github.com/ernens/birdash.git
cd birdash

# 2. Installer les dépendances
npm install

# 3. Configuration locale
cp config/birdash-local.example.js public/js/birdash-local.js
nano public/js/birdash-local.js

# 4. Tester le serveur
node server/server.js
# -> [BIRDASH] API démarrée sur http://127.0.0.1:7474
# Test : curl http://127.0.0.1:7474/api/health

# 5. Lancer les tests
npm test

# 6. Installer le service systemd
sudo cp config/birdash.service /etc/systemd/system/
sudo systemctl edit birdash
#    [Service]
#    Environment=EBIRD_API_KEY=votre_clé
#    Environment=BW_STATION_ID=votre_station
sudo systemctl daemon-reload
sudo systemctl enable birdash
sudo systemctl start birdash
```

## Configuration Caddy

Birdash utilise Caddy comme reverse proxy pour servir l'API, les fichiers
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

Éditez `/etc/caddy/Caddyfile` et ajoutez le bloc Birdash :

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
        uri strip_prefix /birds
        root * /home/{USER}/birdash/public
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

# Lancer les tests backend
npm test

# Ouvrir le dashboard
# http://VOTRE_HOSTNAME/birds/
```

## Structure du projet

```
birdash/
├── server/
│   └── server.js              # Backend Node.js (API HTTP + SQLite)
├── tests/
│   └── server.test.js         # Tests backend
├── public/                    # Fichiers statiques servis par Caddy
│   ├── *.html                 # 13 pages (dashboard, espèces, réglages...)
│   ├── js/                    # JavaScript client
│   │   ├── bird-config.js     # Configuration centralisée
│   │   ├── bird-core.js       # Utilitaires partagés
│   │   ├── bird-vue-core.js   # Composables Vue 3 (shell, thèmes)
│   │   └── bird-i18n.js       # Moteur i18n
│   ├── css/                   # Feuilles de styles + 5 thèmes
│   ├── i18n/                  # Fichiers de traduction (fr/en/nl)
│   ├── img/                   # Assets SVG
│   └── sw.js                  # Service Worker (cache offline)
├── config/
│   ├── birdash.service        # Service systemd
│   └── birdash-local.example.js  # Template config locale
├── screenshots/
├── CONTRIBUTING.md
├── LICENSE
├── package.json
├── README.md                  # English (défaut GitHub)
├── README.fr.md               # Français
├── README.nl.md               # Nederlands
└── README.de.md               # Deutsch
```

## Variables d'environnement

| Variable | Défaut | Description |
|----------|--------|-------------|
| `BIRDASH_PORT` | `7474` | Port du serveur API |
| `BIRDASH_DB` | `~/BirdNET-Pi/scripts/birds.db` | Chemin vers la base SQLite |
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
cd ~/birdash
git pull
npm install
sudo systemctl restart birdash
```

## Licence

[MIT](LICENSE) © ernens
