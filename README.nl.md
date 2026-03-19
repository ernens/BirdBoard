# 🐦 Birdash

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js)](https://nodejs.org)
[![Vue 3](https://img.shields.io/badge/Vue.js-3-4FC08D?logo=vue.js)](https://vuejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Modern ornithologisch dashboard voor [BirdNET-Pi](https://github.com/Nachtzuster/BirdNET-Pi).
Vue 3 (CDN) frontend met Node.js backend, meertalig (FR/EN/NL/DE + 36 talen voor soortnamen).

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

- 📊 Realtime overzicht met 6 KPI's (detecties, soorten, betrouwbaarheid, totaal, laatste uur, zeldzame soorten) en grafieken (activiteit vandaag + 7-dagentrend met trendlijn)
- 🎙️ Detectiefeed met geintegreerde audiospeler
- 🦜 Gedetailleerde soortkaarten met fotocarrousel (iNaturalist + Wikipedia)
- 🧬 Taxonomische info, IUCN-beschermingsstatus, spanwijdte
- 🗓️ Biodiversiteitsmatrix (uren x soorten)
- 💎 Zeldzame soorten en waarschuwingen
- 📈 Statistieken en ranglijsten
- 🎵 Audiospectrogram met DSP-ruisonderdrukking
- 🏆 Beste opnames met uniforme foto's en speler
- 🖥️ Systeemstatus (CPU, RAM, schijf, temperatuur)
- 🔬 Geavanceerde analyses
- ⚡ Service Worker voor offline caching
- ♿ Toegankelijkheid (WCAG AA, toetsenbordnavigatie, skip-link)
- 🎨 5 moderne thema's (Forest, Night, Paper, Ocean, Dusk)
- 🌍 4 interfacetalen (FR / EN / NL / DE) + soortnamen automatisch vertaald in 36 talen via BirdNET-labels
- 🐦 Automatische vertaling van soortnamen op basis van de gekozen taal (BirdNET l18n-labelbestanden)

## Vereisten

- BirdNET-Pi actief (`~/BirdNET-Pi/scripts/birds.db` aanwezig)
- Node.js >= 18 (`node --version`)
- Caddy (zie sectie Caddy-configuratie hieronder)

## Installatie

```bash
# 1. Repository klonen
cd ~
git clone https://github.com/ernens/Birdash.git birdash

# 2. Afhankelijkheden installeren
cd ~/birdash
npm install

# 3. Lokale configuratie
cp birdash-local.example.js birdash-local.js
nano birdash-local.js

# 4. Server testen
node bird-server.js
# -> [BIRDASH] API gestart op http://127.0.0.1:7474

# 5. Tests uitvoeren
npm test

# 6. Systemd-service installeren
sudo cp birdash-api.service /etc/systemd/system/
sudo systemctl edit birdash-api
#    [Service]
#    Environment=EBIRD_API_KEY=uw_sleutel
#    Environment=BW_STATION_ID=uw_station
sudo systemctl daemon-reload
sudo systemctl enable birdash-api
sudo systemctl start birdash-api
```

## Caddy-configuratie

Birdash gebruikt Caddy als reverse proxy om de API, audiobestanden
en statische pagina's onder een enkel `/birds/`-pad te serveren.

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
        root * /home/{USER}/birdash
        file_server
    }
}
```

Vervang `{USER}` door uw systeemgebruikersnaam.

```bash
caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
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
sudo systemctl restart birdash-api
```

## Licentie

[MIT](LICENSE) © ernens
