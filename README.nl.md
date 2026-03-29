# 🐦 Birdash

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js)](https://nodejs.org)
[![Vue 3](https://img.shields.io/badge/Vue.js-3-4FC08D?logo=vue.js)](https://vuejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Modern ornithologisch dashboard voor [Nachtzuster/BirdNET-Pi](https://github.com/Nachtzuster/BirdNET-Pi).
Vue 3 (CDN) frontend met Node.js backend, meertalig (FR/EN/NL/DE + 36 talen voor soortnamen).

> **Birdash is geen fork** — het is een standalone vervangingsdashboard voor de native webinterface van BirdNET-Pi.

> [English](README.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Contributing](CONTRIBUTING.md)

## Screenshots

| Overzicht | Soortfiche |
|:-:|:-:|
| ![Dashboard](screenshots/dashboard.png) | ![Species](screenshots/species.png) |

| Opnames | Detecties |
|:-:|:-:|
| ![Recordings](screenshots/recordings.png) | ![Detections](screenshots/detections.png) |

| Biodiversiteit | Zeldzaamheden |
|:-:|:-:|
| ![Biodiversity](screenshots/biodiversity.png) | ![Rarities](screenshots/rarities.png) |

| Spectrogram | Statistieken |
|:-:|:-:|
| ![Spectrogram](screenshots/spectrogram.png) | ![Stats](screenshots/stats.png) |

## Functies

- 📊 Realtime overzicht met 6 KPI's en grafieken (activiteit vandaag + 7-dagentrend met trendlijn)
- 🎙️ Detectiefeed met geïntegreerde audiospeler
- 🦜 Gedetailleerde soortkaarten met fotocarrousel (iNaturalist + Wikipedia)
- 🧬 Taxonomische info, IUCN-beschermingsstatus, spanwijdte
- 🗓️ Biodiversiteitsmatrix (uren × soorten)
- 💎 Zeldzame soorten en waarschuwingen
- 📈 Statistieken en ranglijsten
- 🎵 Audiospectrogram met DSP-ruisonderdrukking
- 🏆 Beste opnames met uniforme foto's en speler
- 🖥️ Systeemstatus (CPU, RAM, schijf, temperatuur)
- 🔬 Geavanceerde analyses
- 🔧 **Instellingenpagina** — modelselector, analyseparameters, servicesbeheer, ⓘ helptips bij elke parameter
- 🤖 **Perch v2-ondersteuning** — Google Research-model (10.340 vogelsoorten) met temperatuur-softmax, vogel-only filter en MData-geofilter
- 🔄 **Modelvergelijking** — zij-aan-zij periodevergelijking met gewonnen/verloren soorten, tabel per soort, nachtelijke monitoring
- 🏷️ **Modeltracking** — elke detectie registreert welk AI-model het identificeerde (weergegeven op alle pagina's)
- 🗑️ **Detectiebeheer** — individuele detecties of alle detecties van een soort verwijderen (met naambevestiging)
- 💾 **Back-upbeheer** — multi-bestemming backup (USB/Lokaal, SMB/CIFS, NFS, SFTP, Amazon S3, Google Drive, WebDAV) met inhoudsselectie (DB, audio, configuratie), planning (handmatig/dagelijks/wekelijks), live voortgangsbalk, pauze/hervatten/stoppen, schijfruimtebewaking en automatische detectie van legacy-scripts
- ⚡ Service Worker voor offline caching
- ♿ Toegankelijkheid (WCAG AA, toetsenbordnavigatie, skip-link)
- 🎨 5 moderne thema's (Forest, Night, Paper, Ocean, Dusk)
- 🌍 4 interfacetalen (FR / EN / NL / DE) + soortnamen automatisch vertaald in 36 talen via BirdNET-labels

## Getest met

| BirdNET-Pi | Hardware | Status |
|------------|----------|--------|
| [Nachtzuster/BirdNET-Pi](https://github.com/Nachtzuster/BirdNET-Pi) | Raspberry Pi 4/5 | ✅ Getest |

## Vereisten

- [Nachtzuster/BirdNET-Pi](https://github.com/Nachtzuster/BirdNET-Pi) actief (`~/BirdNET-Pi/scripts/birds.db` aanwezig)
- Node.js >= 18 (`node --version`)
- Caddy (zie sectie Caddy-configuratie hieronder)

## Installatie

```bash
# 1. Repository klonen
cd ~
git clone https://github.com/ernens/birdash.git
cd birdash

# 2. Afhankelijkheden installeren
npm install

# 3. Lokale configuratie
cp config/birdash-local.example.js public/js/birdash-local.js
nano public/js/birdash-local.js

# 4. Server testen
node server/server.js
# -> [BIRDASH] API gestart op http://127.0.0.1:7474

# 5. Tests uitvoeren
npm test

# 6. Systemd-service installeren
sudo cp config/birdash.service /etc/systemd/system/
sudo systemctl edit birdash
#    [Service]
#    Environment=EBIRD_API_KEY=uw_sleutel
#    Environment=BW_STATION_ID=uw_station
sudo systemctl daemon-reload
sudo systemctl enable birdash
sudo systemctl start birdash
```

## Caddy-configuratie

Birdash gebruikt Caddy als reverse proxy om de API, audiobestanden
en statische pagina's onder één `/birds/`-pad te serveren.

```
UW_HOSTNAME {
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

Vervang `{USER}` door uw systeemgebruikersnaam.

```bash
caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## Projectstructuur

```
birdash/
├── server/
│   └── server.js              # Node.js HTTP-backend (API + SQLite)
├── tests/
│   └── server.test.js         # Backend-tests
├── public/                    # Statische bestanden geserveerd door Caddy
│   ├── *.html                 # 13 pagina's (dashboard, soorten, instellingen...)
│   ├── js/                    # Client-side JavaScript
│   │   ├── bird-config.js     # Centrale configuratie
│   │   ├── bird-core.js       # Gedeelde hulpfuncties
│   │   ├── bird-vue-core.js   # Vue 3-composables (shell, thema's)
│   │   └── bird-i18n.js       # i18n-engine
│   ├── css/                   # Stylesheets + 5 thema's
│   ├── i18n/                  # Vertalingsbestanden (fr/en/nl)
│   ├── img/                   # SVG-assets
│   └── sw.js                  # Service Worker (offline cache)
├── scripts/
│   └── backup.sh              # Back-upscript (rsync incrementeel)
├── config/
│   ├── birdash.service        # systemd-service
│   ├── birdash-local.example.js  # Lokaal configuratiesjabloon
│   └── backup.json            # Back-upconfiguratie
├── screenshots/
├── CONTRIBUTING.md
├── LICENSE
├── package.json
├── README.md                  # English (standaard)
├── README.fr.md               # Français
├── README.nl.md               # Nederlands
└── README.de.md               # Deutsch
```

## Omgevingsvariabelen

| Variabele | Standaard | Beschrijving |
|-----------|-----------|--------------|
| `BIRDASH_PORT` | `7474` | API-serverpoort |
| `BIRDASH_DB` | `~/BirdNET-Pi/scripts/birds.db` | Pad naar SQLite-database |
| `EBIRD_API_KEY` | — | eBird API-sleutel (optioneel) |
| `BW_STATION_ID` | — | BirdWeather station-ID (optioneel) |

## Beveiliging

- 🛡️ Rate limiting: 120 verzoeken/min per IP
- 🔒 Strikte SQL-validatie (alleen lezen, geen multi-statements)
- 🔐 Beveiligingsheaders (X-Content-Type-Options, X-Frame-Options, Referrer-Policy)
- 🌐 CORS beperkt tot geconfigureerde origins
- ✅ SRI (Subresource Integrity) op CDN-scripts
- 🧹 XSS-bescherming (HTML-escaping)
- 🙈 SQL-foutdetails verborgen in API-antwoorden

## Bijdragen

Bijdragen zijn welkom! Zie de [bijdragegids](CONTRIBUTING.md).

## Bijwerken

```bash
cd ~/birdash
git pull
npm install
sudo systemctl restart birdash
```

## Licentie

[MIT](LICENSE) © ernens
