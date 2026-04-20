# 🐦 BirdStation

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Modernes Vogelerkennungs-Dashboard und Engine fur Raspberry Pi 5. Eigenstandige Dual-Modell-Architektur mit BirdNET V2.4 + Perch V2. Anpassbarer Stationsname und Branding.

> [English](README.md) | [Francais](README.fr.md) | [Nederlands](README.nl.md)

## Screenshots

<details>
<summary><b>Live</b> — Dashboard · Heute · Spektrogramm</summary>

<p align="center">
  <img src="screenshots/dashboard.png"   width="240" alt="Dashboard">
  <img src="screenshots/today.png"       width="240" alt="Heute">
  <img src="screenshots/spectrogram.png" width="240" alt="Spektrogramm">
</p>
</details>

<details>
<summary><b>Verlauf</b> — Kalender · Timeline · Erkennungen · Prüfung</summary>

<p align="center">
  <img src="screenshots/calendar.png"   width="240" alt="Kalender">
  <img src="screenshots/timeline.png"   width="240" alt="Timeline">
  <img src="screenshots/detections.png" width="240" alt="Erkennungen">
  <img src="screenshots/review.png"     width="240" alt="Prüfung">
</p>
</details>

<details>
<summary><b>Arten</b> — Art · Aufnahmen · Galerie · Seltenheiten</summary>

<p align="center">
  <img src="screenshots/species.png"    width="240" alt="Art">
  <img src="screenshots/recordings.png" width="240" alt="Aufnahmen">
  <img src="screenshots/rarities.png"   width="240" alt="Seltenheiten">
</p>
</details>

<details>
<summary><b>Auswertungen</b> — Wetter · Statistiken · Analysen · Biodiversität · Phänologie</summary>

<p align="center">
  <img src="screenshots/weather.png"      width="240" alt="Wetter">
  <img src="screenshots/stats.png"        width="240" alt="Statistiken">
  <img src="screenshots/analyses.png"     width="240" alt="Analysen">
  <img src="screenshots/biodiversity.png" width="240" alt="Biodiversität">
  <img src="screenshots/phenology.png"    width="240" alt="Phänologie">
</p>
</details>

<details>
<summary><b>Station</b> — Systemzustand, Einstellungen &amp; Terminal</summary>

<p align="center">
  <img src="screenshots/system.png"          width="240" alt="Systemzustand">
  <img src="screenshots/system-model.png"    width="240" alt="Modellmonitor">
  <img src="screenshots/system-data.png"     width="240" alt="Systemdaten">
  <img src="screenshots/system-external.png" width="240" alt="Extern">
</p>
<p align="center">
  <img src="screenshots/settings-detection.png" width="240" alt="Erkennung">
  <img src="screenshots/settings-audio.png"     width="240" alt="Audio">
  <img src="screenshots/settings-notif.png"     width="240" alt="Benachrichtigungen">
  <img src="screenshots/settings-station.png"   width="240" alt="Station">
</p>
<p align="center">
  <img src="screenshots/settings-services.png" width="240" alt="Dienste">
  <img src="screenshots/settings-species.png"  width="240" alt="Arten">
  <img src="screenshots/settings-backup.png"   width="240" alt="Backup">
  <img src="screenshots/settings-terminal.png" width="240" alt="Terminal">
</p>
</details>

## Architektur

> **[Vollständige Architekturdokumentation →](ARCHITECTURE.de.md)** — technische Referenz: Audio-Pipeline, Datenbankschema, Performance und mehr.

## Funktionen

- <img src="docs/icons/cpu.svg" width="16" align="top" alt=""> **Dual-Modell-Inferenz** — BirdNET V2.4 + Perch V2 parallel
- <img src="docs/icons/sunrise.svg" width="16" align="top" alt=""> **Timeline** — Ganzseitige Timeline mit Drag-to-Zoom, einheitlicher Dichte-Slider, SVG-Icons, Filter-Badges mit Blink
- <img src="docs/icons/calendar-days.svg" width="16" align="top" alt=""> **Kalender** — Vereinigte Tagesansicht mit Timeline + Artenliste + Audioplayer
- <img src="docs/icons/cloud-sun.svg" width="16" align="top" alt=""> **Wetter** — Korrelationsanalyse (Pearson r), Prognose, Arten nach Bedingungen
- <img src="docs/icons/music.svg" width="16" align="top" alt=""> **Live-Spektrogramm** — Echtzeit-Audio mit Vogelnamen
- <img src="docs/icons/search.svg" width="16" align="top" alt=""> **Uberprufung** — Auto-Flagging, Spektrogramm-Modal mit Filtern und Loop-Auswahl, Loschen mit Vorschau
- <img src="docs/icons/star.svg" width="16" align="top" alt=""> **Favoriten** — eigene Seite mit KPIs, Suche, Sortierung; Herz-Toggle auf allen Artenlisten
- <img src="docs/icons/pencil.svg" width="16" align="top" alt=""> **Notizen** pro Art und pro Erkennung
- <img src="docs/icons/bird.svg" width="16" align="top" alt=""> **Artenkarten** — Phonologie-Kalender, Jahresvergleich, PNG-Export
- <img src="docs/icons/monitor.svg" width="16" align="top" alt=""> **Mobil** — Bottom-Navigation, Touch-Gesten, globale Suche (Art + Datum)
- <img src="docs/icons/bell.svg" width="16" align="top" alt=""> **Benachrichtigungen** — ntfy.sh + In-App-Glocke
- <img src="docs/icons/zap.svg" width="16" align="top" alt=""> **MQTT** — veroffentlicht jede Erkennung an einen MQTT-Broker (Mosquitto, Home Assistant…) mit Home-Assistant-Auto-Discovery
- <img src="docs/icons/bar-chart-3.svg" width="16" align="top" alt=""> **Prometheus `/metrics`** — Scrape-Ziel fur Prometheus / Grafana / VictoriaMetrics mit Erkennungs-, System- und Feature-Metriken
- <img src="docs/icons/list.svg" width="16" align="top" alt=""> **Live-Log** — Echtzeit-Dashboard (SSE) mit farbcodierten Kategorien, Filtern, KPIs
- <img src="docs/icons/terminal.svg" width="16" align="top" alt=""> **Web-Terminal** — Bash im Browser
- <img src="docs/icons/save.svg" width="16" align="top" alt=""> **Backup** — NFS/SMB/SFTP/S3/GDrive/WebDAV
- <img src="docs/icons/image.svg" width="16" align="top" alt=""> **Fotoverwaltung** — Sperren/Ersetzen, Standardfoto pro Art
- <img src="docs/icons/flag.svg" width="16" align="top" alt=""> **Anpassbares Branding** — Stationsname und Header uber Einstellungen konfigurierbar
- <img src="docs/icons/globe.svg" width="16" align="top" alt=""> **Artnamenubersetzung** — Vogelnamen in gewahlter Sprache auf allen Seiten
- <img src="docs/icons/globe.svg" width="16" align="top" alt=""> 4 UI-Sprachen (FR/EN/NL/DE) + 36 Sprachen fur Artnamen
- <img src="docs/icons/sparkles.svg" width="16" align="top" alt=""> **11 Themes** — 7 dunkel (Forest, Night, Ocean, Dusk, Solar Dark, Nord, High Contrast AAA), 3 hell (Paper, Sepia, Solar Light), plus ein **Auto**-Modus, der `prefers-color-scheme` des Betriebssystems folgt. Mini-Seitenvorschauen im Theme-Picker, fließende Übergänge, vollständig token-basiertes Designsystem (siehe [`docs/THEMES.md`](docs/THEMES.md))

## Optimierte Perch V2 Modelle

3 optimierte Varianten von Google Perch V2 (FP32, FP16, INT8) fur Raspberry Pi:

**[ernensbjorn/perch-v2-int8-tflite](https://huggingface.co/ernensbjorn/perch-v2-int8-tflite)** auf HuggingFace

## Installation

```bash
curl -sSL https://raw.githubusercontent.com/ernens/birdash/main/bootstrap.sh | bash
```

Das Installationsskript erledigt alles automatisch: Systempakete, Caddy, ttyd, Datenbanken, Perch V2 + BirdNET V2.4 Modelle, automatische GPS-Erkennung, ALSA dsnoop Konfiguration, systemd-Dienste.

Dashboard: `http://ihr-pi.local/birds/`

## Aktualisierung

Ein rotes Banner erscheint automatisch bei verfügbaren Updates. Klicken Sie **Anzeigen** → **Jetzt installieren**. Oder via SSH:

```bash
ssh user@ihr-pi.local 'bash ~/birdash/scripts/update.sh'
```

## Tests

```bash
npm test                    # 134 Node.js Tests
cd engine && ../engine/venv/bin/python -m unittest test_engine -v  # 13 Python Tests
```

## Lizenz

[MIT](LICENSE)
