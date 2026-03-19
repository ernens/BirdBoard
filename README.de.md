# 🐦 Birdash

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js)](https://nodejs.org)
[![Vue 3](https://img.shields.io/badge/Vue.js-3-4FC08D?logo=vue.js)](https://vuejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Modernes ornithologisches Dashboard für [Nachtzuster/BirdNET-Pi](https://github.com/Nachtzuster/BirdNET-Pi).
Vue 3 (CDN) Frontend mit Node.js Backend, mehrsprachig (FR/EN/NL/DE + 36 Sprachen für Artnamen).

> **Birdash ist kein Fork** — es ist ein eigenständiges Ersatz-Dashboard für die native Weboberfläche von BirdNET-Pi.

> [English](README.md) · [Français](README.fr.md) · [Nederlands](README.nl.md) · [Contributing](CONTRIBUTING.md)

## Screenshots

| Übersicht | Artensteckbrief |
|:-:|:-:|
| ![Dashboard](screenshots/dashboard.png) | ![Species](screenshots/species.png) |

| Aufnahmen | Erkennungen |
|:-:|:-:|
| ![Recordings](screenshots/recordings.png) | ![Detections](screenshots/detections.png) |

| Biodiversität | Seltenheiten |
|:-:|:-:|
| ![Biodiversity](screenshots/biodiversity.png) | ![Rarities](screenshots/rarities.png) |

| Spektrogramm | Statistiken |
|:-:|:-:|
| ![Spectrogram](screenshots/spectrogram.png) | ![Stats](screenshots/stats.png) |

## Funktionen

- 📊 Echtzeit-Übersicht mit 6 KPIs und Diagrammen (heutige Aktivität + 7-Tage-Trend mit Trendlinie)
- 🎙️ Erkennungsfeed mit integriertem Audioplayer
- 🦜 Detaillierte Artenkarten mit Fotokarussell (iNaturalist + Wikipedia)
- 🧬 Taxonomische Informationen, IUCN-Schutzstatus, Flügelspannweite
- 🗓️ Biodiversitätsmatrix (Stunden × Arten)
- 💎 Seltene Arten und Warnungen
- 📈 Statistiken und Ranglisten
- 🎵 Audio-Spektrogramm mit DSP-Rauschunterdrückung
- 🏆 Beste Aufnahmen mit einheitlichen Fotos und Player
- 🖥️ Systemstatus (CPU, RAM, Festplatte, Temperatur)
- 🔬 Erweiterte Analysen
- 🔧 **Einstellungsseite** — Modellauswahl, Analyseparameter, Dienstverwaltung
- 🤖 **Perch v2-Unterstützung** — Google DeepMind-Modell (15.000 Arten) neben BirdNET V2.4
- ⚡ Service Worker für Offline-Caching
- ♿ Barrierefreiheit (WCAG AA, Tastaturnavigation, Skip-Link)
- 🎨 5 moderne Themes (Forest, Night, Paper, Ocean, Dusk)
- 🌍 4 Oberflächensprachen (FR / EN / NL / DE) + Artnamen automatisch in 36 Sprachen übersetzt über BirdNET-Labels

## Getestet mit

| BirdNET-Pi | Hardware | Status |
|------------|----------|--------|
| [Nachtzuster/BirdNET-Pi](https://github.com/Nachtzuster/BirdNET-Pi) | Raspberry Pi 4/5 | ✅ Getestet |

## Voraussetzungen

- [Nachtzuster/BirdNET-Pi](https://github.com/Nachtzuster/BirdNET-Pi) aktiv (`~/BirdNET-Pi/scripts/birds.db` vorhanden)
- Node.js >= 18 (`node --version`)
- Caddy (siehe Abschnitt Caddy-Konfiguration unten)

## Installation

```bash
# 1. Repository klonen
cd ~
git clone https://github.com/ernens/birdash.git
cd birdash

# 2. Abhängigkeiten installieren
npm install

# 3. Lokale Konfiguration
cp config/birdash-local.example.js public/js/birdash-local.js
nano public/js/birdash-local.js

# 4. Server testen
node server/server.js
# -> [BIRDASH] API gestartet auf http://127.0.0.1:7474

# 5. Tests ausführen
npm test

# 6. Systemd-Dienst installieren
sudo cp config/birdash.service /etc/systemd/system/
sudo systemctl edit birdash
#    [Service]
#    Environment=EBIRD_API_KEY=ihr_schlüssel
#    Environment=BW_STATION_ID=ihre_station
sudo systemctl daemon-reload
sudo systemctl enable birdash
sudo systemctl start birdash
```

## Caddy-Konfiguration

Birdash verwendet Caddy als Reverse Proxy, um die API, Audiodateien
und statische Seiten unter einem einzigen `/birds/`-Pfad bereitzustellen.

```
IHR_HOSTNAME {
    encode zstd gzip

    handle /birds/api/* {
        uri strip_prefix /birds
        reverse_proxy 127.0.0.1:7474
    }

    handle /birds/audio/* {
        uri strip_prefix /birds/audio
        root * /home/{USER}/BirdSongs/Extracted
        file_server
    }

    handle /birds* {
        uri strip_prefix /birds
        root * /home/{USER}/birdash/public
        file_server
    }
}
```

Ersetzen Sie `{USER}` durch Ihren Systembenutzernamen.

```bash
caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## Projektstruktur

```
birdash/
├── server/
│   └── server.js              # Node.js HTTP-Backend (API + SQLite)
├── tests/
│   └── server.test.js         # Backend-Tests
├── public/                    # Statische Dateien, bereitgestellt von Caddy
│   ├── *.html                 # 13 Seiten (Dashboard, Arten, Einstellungen...)
│   ├── js/                    # Client-seitiges JavaScript
│   │   ├── bird-config.js     # Zentrale Konfiguration
│   │   ├── bird-core.js       # Gemeinsame Hilfsfunktionen
│   │   ├── bird-vue-core.js   # Vue 3-Composables (Shell, Themes)
│   │   └── bird-i18n.js       # i18n-Engine
│   ├── css/                   # Stylesheets + 5 Themes
│   ├── i18n/                  # Übersetzungsdateien (fr/en/nl)
│   ├── img/                   # SVG-Assets
│   └── sw.js                  # Service Worker (Offline-Cache)
├── config/
│   ├── birdash.service        # systemd-Dienst
│   └── birdash-local.example.js  # Lokale Konfigurationsvorlage
├── screenshots/
├── CONTRIBUTING.md
├── LICENSE
├── package.json
├── README.md                  # English (Standard)
├── README.fr.md               # Français
├── README.nl.md               # Nederlands
└── README.de.md               # Deutsch
```

## Umgebungsvariablen

| Variable | Standard | Beschreibung |
|----------|----------|--------------|
| `BIRDASH_PORT` | `7474` | API-Server-Port |
| `BIRDASH_DB` | `~/BirdNET-Pi/scripts/birds.db` | Pfad zur SQLite-Datenbank |
| `EBIRD_API_KEY` | — | eBird API-Schlüssel (optional) |
| `BW_STATION_ID` | — | BirdWeather Stations-ID (optional) |

## Sicherheit

- 🛡️ Rate Limiting: 120 Anfragen/Min pro IP
- 🔒 Strikte SQL-Validierung (nur Lesen, keine Multi-Statements)
- 🔐 Sicherheitsheader (X-Content-Type-Options, X-Frame-Options, Referrer-Policy)
- 🌐 CORS auf konfigurierte Origins beschränkt
- ✅ SRI (Subresource Integrity) für CDN-Scripts
- 🧹 XSS-Schutz (HTML-Escaping)
- 🙈 SQL-Fehlerdetails in API-Antworten maskiert

## Mitwirken

Beiträge sind willkommen! Siehe den [Beitragsleitfaden](CONTRIBUTING.md).

## Aktualisierung

```bash
cd ~/birdash
git pull
npm install
sudo systemctl restart birdash
```

## Lizenz

[MIT](LICENSE) © ernens
