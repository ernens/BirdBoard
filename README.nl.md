# 🐦 BirdStation

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Modern vogeldetectie-dashboard en engine voor Raspberry Pi 5. Zelfstandige dual-model architectuur met BirdNET V2.4 + Perch V2. Aanpasbare stationnaam en branding.

> [English](README.md) | [Francais](README.fr.md) | [Deutsch](README.de.md)

## Schermafbeeldingen

<details>
<summary><b>Live</b> — Dashboard · Vandaag · Spectrogram</summary>

<p align="center">
  <img src="screenshots/dashboard.png"   width="240" alt="Dashboard">
  <img src="screenshots/today.png"       width="240" alt="Vandaag">
  <img src="screenshots/spectrogram.png" width="240" alt="Spectrogram">
</p>
</details>

<details>
<summary><b>Geschiedenis</b> — Kalender · Tijdlijn · Detecties · Validatie</summary>

<p align="center">
  <img src="screenshots/calendar.png"   width="240" alt="Kalender">
  <img src="screenshots/timeline.png"   width="240" alt="Tijdlijn">
  <img src="screenshots/detections.png" width="240" alt="Detecties">
  <img src="screenshots/review.png"     width="240" alt="Validatie">
</p>
</details>

<details>
<summary><b>Soorten</b> — Soort · Opnames · Galerij · Zeldzaamheden</summary>

<p align="center">
  <img src="screenshots/species.png"    width="240" alt="Soort">
  <img src="screenshots/recordings.png" width="240" alt="Opnames">
  <img src="screenshots/rarities.png"   width="240" alt="Zeldzaamheden">
</p>
</details>

<details>
<summary><b>Inzichten</b> — Weer · Statistieken · Analyses · Biodiversiteit · Fenologie</summary>

<p align="center">
  <img src="screenshots/weather.png"      width="240" alt="Weer">
  <img src="screenshots/stats.png"        width="240" alt="Statistieken">
  <img src="screenshots/analyses.png"     width="240" alt="Analyses">
  <img src="screenshots/biodiversity.png" width="240" alt="Biodiversiteit">
  <img src="screenshots/phenology.png"    width="240" alt="Fenologie">
</p>
</details>

<details>
<summary><b>Station</b> — Systeemstatus, instellingen &amp; terminal</summary>

<p align="center">
  <img src="screenshots/system.png"          width="240" alt="Systeemstatus">
  <img src="screenshots/system-model.png"    width="240" alt="Modelmonitor">
  <img src="screenshots/system-data.png"     width="240" alt="Systeemgegevens">
  <img src="screenshots/system-external.png" width="240" alt="Extern">
</p>
<p align="center">
  <img src="screenshots/settings-detection.png" width="240" alt="Detectie">
  <img src="screenshots/settings-audio.png"     width="240" alt="Audio">
  <img src="screenshots/settings-notif.png"     width="240" alt="Notificaties">
  <img src="screenshots/settings-station.png"   width="240" alt="Station">
</p>
<p align="center">
  <img src="screenshots/settings-services.png" width="240" alt="Services">
  <img src="screenshots/settings-species.png"  width="240" alt="Soorten">
  <img src="screenshots/settings-backup.png"   width="240" alt="Back-up">
  <img src="screenshots/settings-terminal.png" width="240" alt="Terminal">
</p>
</details>

## Architectuur

> **[Volledige architectuurdocumentatie →](ARCHITECTURE.nl.md)** — technische referentie: audio-pipeline, databaseschema, prestaties en meer.

## Kenmerken

- <img src="docs/icons/cpu.svg" width="16" align="top" alt=""> **Dual-model inferentie** — BirdNET V2.4 + Perch V2 parallel
- <img src="docs/icons/sunrise.svg" width="16" align="top" alt=""> **Timeline** — volledig scherm met drag-to-zoom, uniforme dichtheidsslider, SVG-iconen, filter-badges met knippermarkering
- <img src="docs/icons/calendar-days.svg" width="16" align="top" alt=""> **Kalender** — uniforme dagweergave met timeline + soortenlijst + audiospeler
- <img src="docs/icons/cloud-sun.svg" width="16" align="top" alt=""> **Weer** — correlatieanalyse (Pearson r), prognose, soorten per omstandigheden
- <img src="docs/icons/music.svg" width="16" align="top" alt=""> **Live spectrogram** — real-time audio met vogelnamen
- <img src="docs/icons/search.svg" width="16" align="top" alt=""> **Review** — auto-flagging, spectrogram-modal met filters en loop-selectie, verwijderen met voorbeeldweergave
- <img src="docs/icons/star.svg" width="16" align="top" alt=""> **Favorieten** — speciale pagina met KPIs, zoeken, sorteren; harttoggle op alle soortenlijsten
- <img src="docs/icons/pencil.svg" width="16" align="top" alt=""> **Notities** per soort en per detectie
- <img src="docs/icons/bird.svg" width="16" align="top" alt=""> **Soortkaarten** — fenologiekalender, jaarlijkse vergelijking, PNG-export
- <img src="docs/icons/monitor.svg" width="16" align="top" alt=""> **Mobiel** — navigatiebalk onderaan, veeggebaren, globale zoekfunctie (soort + datum)
- <img src="docs/icons/bell.svg" width="16" align="top" alt=""> **Meldingen** — ntfy.sh + in-app belletje
- <img src="docs/icons/zap.svg" width="16" align="top" alt=""> **MQTT** — publiceert elke detectie naar een MQTT-broker (Mosquitto, Home Assistant…) met Home Assistant auto-discovery
- <img src="docs/icons/bar-chart-3.svg" width="16" align="top" alt=""> **Prometheus `/metrics`** — scrape-doel voor Prometheus / Grafana / VictoriaMetrics met detectie-, systeem- en feature-metrieken
- <img src="docs/icons/list.svg" width="16" align="top" alt=""> **Live log** — realtime dashboard (SSE) met kleurgecodeerde categorieën, filters, KPIs
- <img src="docs/icons/terminal.svg" width="16" align="top" alt=""> **Web terminal** — bash in browser
- <img src="docs/icons/save.svg" width="16" align="top" alt=""> **Backup** — NFS/SMB/SFTP/S3/GDrive/WebDAV
- <img src="docs/icons/image.svg" width="16" align="top" alt=""> **Fotobeheer** — blokkeren/vervangen, standaardfoto per soort
- <img src="docs/icons/flag.svg" width="16" align="top" alt=""> **Aanpasbare branding** — stationnaam en header configureerbaar via instellingen
- <img src="docs/icons/globe.svg" width="16" align="top" alt=""> **Soortnaamvertaling** — vogelnamen in gekozen taal op alle pagina's
- <img src="docs/icons/globe.svg" width="16" align="top" alt=""> 4 UI-talen (FR/EN/NL/DE) + 36 talen voor soortnamen
- <img src="docs/icons/sparkles.svg" width="16" align="top" alt=""> **11 thema's** — 7 donker (Forest, Night, Ocean, Dusk, Solar Dark, Nord, High Contrast AAA), 3 licht (Paper, Sepia, Solar Light), plus een **Auto**-modus die de OS-instelling volgt. Mini-paginavoorbeelden in de kiezer, vloeiende overgangen, volledig token-gebaseerd ontwerpsysteem (zie [`docs/THEMES.md`](docs/THEMES.md))

## Geoptimaliseerde Perch V2 Modellen

3 geoptimaliseerde varianten van Google Perch V2 (FP32, FP16, INT8) voor Raspberry Pi:

**[ernensbjorn/perch-v2-int8-tflite](https://huggingface.co/ernensbjorn/perch-v2-int8-tflite)** op HuggingFace

## Installatie

```bash
curl -sSL https://raw.githubusercontent.com/ernens/birdash/main/bootstrap.sh | bash
```

Het installatiescript regelt alles automatisch: systeempakketten, Caddy, ttyd, databases, Perch V2 + BirdNET V2.4 modellen, automatische GPS-detectie, ALSA dsnoop configuratie, systemd-services.

Dashboard: `http://jouw-pi.local/birds/`

## Updaten

Een rode banner verschijnt automatisch als er updates beschikbaar zijn. Klik **Bekijken** → **Nu installeren**. Of via SSH:

```bash
ssh user@jouw-pi.local 'bash ~/birdash/scripts/update.sh'
```

## Tests

```bash
npm test                    # 134 Node.js-tests
cd engine && ../engine/venv/bin/python -m unittest test_engine -v  # 13 Python tests
```

## Licentie

[MIT](LICENSE)
