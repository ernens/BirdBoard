# 🐦 Birdash

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js)](https://nodejs.org)
[![Vue 3](https://img.shields.io/badge/Vue.js-3-4FC08D?logo=vue.js)](https://vuejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Modernes ornithologisches Dashboard fur [BirdNET-Pi](https://github.com/Nachtzuster/BirdNET-Pi).
Vue 3 (CDN) Frontend mit Node.js Backend, mehrsprachig (FR/EN/NL/DE + 36 Sprachen fur Artnamen).

> [English](README.md) · [Français](README.fr.md) · [Nederlands](README.nl.md) · [Contributing](CONTRIBUTING.md)

## Screenshots

| Ubersicht | Artensteckbrief |
|:-:|:-:|
| ![Dashboard](screenshots/dashboard.png) | ![Species](screenshots/species.png) |

| Aufnahmen | Erkennungen |
|:-:|:-:|
| ![Recordings](screenshots/recordings.png) | ![Detections](screenshots/detections.png) |

| Biodiversitat | Seltenheiten |
|:-:|:-:|
| ![Biodiversity](screenshots/biodiversity.png) | ![Rarities](screenshots/rarities.png) |

| Spektrogramm | Statistiken |
|:-:|:-:|
| ![Spectrogram](screenshots/spectrogram.png) | ![Stats](screenshots/stats.png) |

## Funktionen

- 📊 Echtzeit-Ubersicht mit 6 KPIs (Erkennungen, Arten, Konfidenz, Gesamt, letzte Stunde, seltene Arten) und Diagrammen (heutige Aktivitat + 7-Tage-Trend mit Trendlinie)
- 🎙️ Erkennungsfeed mit integriertem Audioplayer
- 🦜 Detaillierte Artenkarten mit Fotokarussell (iNaturalist + Wikipedia)
- 🧬 Taxonomische Informationen, IUCN-Schutzstatus, Flugelspannweite
- 🗓️ Biodiversitatsmatrix (Stunden x Arten)
- 💎 Seltene Arten und Warnungen
- 📈 Statistiken und Ranglisten
- 🎵 Audio-Spektrogramm mit DSP-Rauschunterdruckung
- 🏆 Beste Aufnahmen mit einheitlichen Fotos und Player
- 🖥️ Systemstatus (CPU, RAM, Festplatte, Temperatur)
- 🔬 Erweiterte Analysen
- ⚡ Service Worker fur Offline-Caching
- ♿ Barrierefreiheit (WCAG AA, Tastaturnavigation, Skip-Link)
- 🎨 5 moderne Themes (Forest, Night, Paper, Ocean, Dusk)
- 🌍 4 Oberflachensprachen (FR / EN / NL / DE) + Artnamen automatisch in 36 Sprachen ubersetzt uber BirdNET-Labels
- 🐦 Automatische Ubersetzung der Artnamen basierend auf der gewahlten Sprache (BirdNET l18n-Labeldateien)

## Voraussetzungen

- BirdNET-Pi aktiv (`~/BirdNET-Pi/scripts/birds.db` vorhanden)
- Node.js >= 18 (`node --version`)
- Caddy (siehe Abschnitt Caddy-Konfiguration unten)

## Installation

```bash
# 1. Repository klonen
cd ~
git clone https://github.com/ernens/Birdash.git birdash

# 2. Abhangigkeiten installieren
cd ~/birdash
npm install

# 3. Lokale Konfiguration
cp birdash-local.example.js birdash-local.js
nano birdash-local.js

# 4. Server testen
node bird-server.js
# -> [BIRDASH] API gestartet auf http://127.0.0.1:7474

# 5. Tests ausfuhren
npm test

# 6. Systemd-Dienst installieren
sudo cp birdash-api.service /etc/systemd/system/
sudo systemctl edit birdash-api
#    [Service]
#    Environment=EBIRD_API_KEY=ihr_schlussel
#    Environment=BW_STATION_ID=ihre_station
sudo systemctl daemon-reload
sudo systemctl enable birdash-api
sudo systemctl start birdash-api
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
        root * /home/{USER}/birdash
        file_server
    }
}
```

Ersetzen Sie `{USER}` durch Ihren Systembenutzernamen.

```bash
caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## Umgebungsvariablen

| Variable | Standard | Beschreibung |
|----------|----------|--------------|
| `BIRDASH_PORT` | `7474` | API-Server-Port |
| `BIRDASH_DB` | `~/BirdNET-Pi/scripts/birds.db` | Pfad zur SQLite-Datenbank |
| `EBIRD_API_KEY` | — | eBird API-Schlussel (optional) |
| `BW_STATION_ID` | — | BirdWeather Stations-ID (optional) |

## Sicherheit

- 🛡️ Rate Limiting: 120 Anfragen/Min pro IP
- 🔒 Strikte SQL-Validierung (nur Lesen, keine Multi-Statements)
- 🔐 Sicherheitsheader (X-Content-Type-Options, X-Frame-Options, Referrer-Policy)
- 🌐 CORS auf konfigurierte Origins beschrankt
- ✅ SRI (Subresource Integrity) fur CDN-Scripts
- 🧹 XSS-Schutz (HTML-Escaping)
- 🙈 SQL-Fehlerdetails in API-Antworten maskiert

## Mitwirken

Beitrage sind willkommen! Siehe den [Beitragsleitfaden](CONTRIBUTING.md).

## Aktualisierung

```bash
cd ~/birdash
git pull
npm install
sudo systemctl restart birdash-api
```

## Lizenz

[MIT](LICENSE) © ernens
