# 🐦 BirdStation

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js)](https://nodejs.org)
[![Vue 3](https://img.shields.io/badge/Vue.js-3-4FC08D?logo=vue.js)](https://vuejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Modern bird detection dashboard and engine for Raspberry Pi 5. Standalone dual-model architecture with BirdNET V2.4 + Perch V2. Customizable station name and branding.

> [Francais](README.fr.md) | [Nederlands](README.nl.md) | [Deutsch](README.de.md) | [Contributing](CONTRIBUTING.md)

## Screenshots

<details>
<summary><b>Home</b> — Overview · Today</summary>

<p align="center">
  <img src="screenshots/overview.png"    width="360" alt="Overview">
  <img src="screenshots/today.png"       width="360" alt="Today">
</p>
</details>

<details>
<summary><b>Live</b> — Dashboard · Spectrogram · Log</summary>

<p align="center">
  <img src="screenshots/dashboard.png"   width="240" alt="Dashboard">
  <img src="screenshots/spectrogram.png" width="240" alt="Spectrogram">
  <img src="screenshots/log.png"         width="240" alt="Live log">
</p>
</details>

<details>
<summary><b>History</b> — Calendar · Timeline · Detections · Review</summary>

<p align="center">
  <img src="screenshots/calendar.png"   width="240" alt="Calendar">
  <img src="screenshots/timeline.png"   width="240" alt="Timeline">
  <img src="screenshots/detections.png" width="240" alt="Detections">
  <img src="screenshots/review.png"     width="240" alt="Review">
</p>
</details>

<details>
<summary><b>Species</b> — Species · Recordings · Gallery · Rarities · Favorites</summary>

<p align="center">
  <img src="screenshots/species.png"    width="240" alt="Species">
  <img src="screenshots/recordings.png" width="240" alt="Recordings">
  <img src="screenshots/gallery.png"    width="240" alt="Gallery">
  <img src="screenshots/rarities.png"   width="240" alt="Rarities">
  <img src="screenshots/favorites.png"  width="240" alt="Favorites">
</p>
</details>

<details>
<summary><b>Indicators</b> — Weather · Statistics · Models · Analyses · Biodiversity · Phenology</summary>

<p align="center">
  <img src="screenshots/weather.png"      width="240" alt="Weather">
  <img src="screenshots/stats.png"        width="240" alt="Statistics">
  <img src="screenshots/models.png"       width="240" alt="Models">
  <img src="screenshots/analyses.png"     width="240" alt="Analyses">
  <img src="screenshots/biodiversity.png" width="240" alt="Biodiversity">
  <img src="screenshots/phenology.png"    width="240" alt="Phenology">
</p>
</details>

<details>
<summary><b>Station</b> — System health, settings &amp; terminal</summary>

<p align="center">
  <img src="screenshots/system.png"          width="240" alt="System health">
  <img src="screenshots/system-model.png"    width="240" alt="Model monitor">
  <img src="screenshots/system-data.png"     width="240" alt="System data">
  <img src="screenshots/system-external.png" width="240" alt="External">
</p>
<p align="center">
  <img src="screenshots/settings-detection.png" width="240" alt="Detection">
  <img src="screenshots/settings-audio.png"     width="240" alt="Audio">
  <img src="screenshots/settings-notif.png"     width="240" alt="Notifications">
  <img src="screenshots/settings-station.png"   width="240" alt="Station">
</p>
<p align="center">
  <img src="screenshots/settings-services.png" width="240" alt="Services">
  <img src="screenshots/settings-species.png"  width="240" alt="Species">
  <img src="screenshots/settings-backup.png"   width="240" alt="Backup">
  <img src="screenshots/settings-terminal.png" width="240" alt="Terminal">
</p>
</details>

## Architecture

```
Raspberry Pi 5 + SSD
├── USB Audio Interface
│     ↓
├── BirdEngine (Python)
│   ├── Recording service (arecord → WAV 45s)
│   ├── BirdNET V2.4    (~2s/file, primary)
│   ├── Perch V2 FP16   (~2s/file, secondary)
│   ├── MP3 extraction + spectrograms
│   ├── BirdWeather upload
│   └── Smart notifications (ntfy.sh)
│
├── Birdash (Node.js)
│   ├── Dashboard API (port 7474)
│   ├── Live spectrogram (PCM + MP3 stream)
│   ├── Audio config module
│   ├── Detection review + auto-flagging
│   └── Model comparison
│
├── Caddy (reverse proxy :80)
├── ttyd (web terminal)
└── SQLite (1M+ detections)
```

## Features

### Detection Engine (BirdEngine)
- <img src="docs/icons/cpu.svg" width="16" align="top" alt=""> **Dual-model inference** — BirdNET V2.4 (fast, ~2s) + Perch V2 (precise, ~2s) in parallel
- <img src="docs/icons/mic.svg" width="16" align="top" alt=""> **Local recording** — any USB audio interface via ALSA with configurable gain
- <img src="docs/icons/sliders-horizontal.svg" width="16" align="top" alt=""> **Adaptive noise normalization** — automatic software gain based on ambient noise, with clip guard, activity hold, and observer mode
- <img src="docs/icons/volume-x.svg" width="16" align="top" alt=""> **Audio filters** — configurable highpass + lowpass (bandpass), spectral noise reduction (stationary gating), RMS normalization
- <img src="docs/icons/radio.svg" width="16" align="top" alt=""> **BirdWeather** — automatic upload of soundscapes + detections
- <img src="docs/icons/bell.svg" width="16" align="top" alt=""> **Smart notifications** — ntfy.sh alerts for rare species, first-of-season, new species, favorites (not every sparrow)
- <img src="docs/icons/zap.svg" width="16" align="top" alt=""> **Async post-processing** — MP3 extraction, spectrogram generation, DB sync don't block inference

### Dashboard (20 pages)

**Home**
- <img src="docs/icons/bar-chart-3.svg" width="16" align="top" alt=""> **Overview** (landing page) — 6 KPIs, bird of the day, weather context, hourly activity, "What's New" alerts, latest detections
- <img src="docs/icons/calendar.svg" width="16" align="top" alt=""> **Today** — species list with audio player, spectrograms, gain/highpass/lowpass filters, new species filter
- <img src="docs/icons/globe.svg" width="16" align="top" alt=""> **Species name translation** — bird names displayed in the user's chosen language across all pages

**Live**
- <img src="docs/icons/zap.svg" width="16" align="top" alt=""> **Bird Flow** — animated pipeline showing live audio levels (SSE), dual-model inference with per-model species + confidence, detection flow with animated connectors, today's KPIs, key events feed
- <img src="docs/icons/music.svg" width="16" align="top" alt=""> **Live spectrogram** — real-time audio from mic with bird name overlay
- <img src="docs/icons/scroll-text.svg" width="16" align="top" alt=""> **Live log** — real-time streaming dashboard (SSE) with color-coded categories, KPIs, pause/resume

**History**
- <img src="docs/icons/calendar-days.svg" width="16" align="top" alt=""> **Calendar** — unified day-by-day view with timeline visualization, species list, audio player
- <img src="docs/icons/sunrise.svg" width="16" align="top" alt=""> **Timeline** — full-page interactive timeline with drag-to-zoom, unified bird density slider (0-100%), SVG sunrise/sunset/moon icons, type filter badges with blink highlight, confidence-mapped vertical layout
- <img src="docs/icons/list.svg" width="16" align="top" alt=""> **Detections** — full filterable table with favorites, new species filter, per-detection delete, CSV/eBird export
- <img src="docs/icons/check-circle.svg" width="16" align="top" alt=""> **Review** — auto-flagged detections with spectro modal, bulk confirm/reject/delete with preview, purge rejected

**Species**
- <img src="docs/icons/bird.svg" width="16" align="top" alt=""> Species cards with photos (iNaturalist + Wikipedia), IUCN status, favorites (SQLite-backed), personal notes (per-species and per-detection), phenology calendar (12-month dot map), year-over-year monthly comparison, chart PNG export, Web Share API
- <img src="docs/icons/star.svg" width="16" align="top" alt=""> **Favorites** — dedicated page with KPIs, search, sort; heart toggle on all species lists
- <img src="docs/icons/gem.svg" width="16" align="top" alt=""> Rare species tracking
- <img src="docs/icons/trophy.svg" width="16" align="top" alt=""> Best recordings gallery with audio library tab

**Indicators**
- <img src="docs/icons/cloud-sun.svg" width="16" align="top" alt=""> **Weather** — dedicated page with correlation analysis (Pearson r), tomorrow's forecast, species by weather conditions
- <img src="docs/icons/trending-up.svg" width="16" align="top" alt=""> **Statistics** — rankings, records, distributions, annual evolution; integrated **Models** tab for dual-model comparison (daily chart, exclusive species, overlap analysis)
- <img src="docs/icons/microscope.svg" width="16" align="top" alt=""> Advanced analyses (polar charts, heatmaps, time series, narrative)
- <img src="docs/icons/dna.svg" width="16" align="top" alt=""> Biodiversity — Shannon index, adaptive richness chart, taxonomy heatmap
- <img src="docs/icons/calendar.svg" width="16" align="top" alt=""> **Phenology calendar** — observed annual cycle per species (presence/abundance/hourly modes), inferred phases (active period, peak abundance, dawn chorus, migrant detection), 53-week ribbon visualization, species suggestions on empty state

**Navigation**
- 6 intent-based sections: Home, Live, History, Species, Indicators, Station
- Mobile bottom nav (4 quick links + hamburger drawer with all 20 pages)
- Global species+date search, notification bell, review badge counter
- Keyboard shortcuts on 5 pages, swipe gestures on species photos
- Skeleton loading states for data-heavy pages
- Cross-navigation between settings and system pages

### Detection Review
- <img src="docs/icons/search.svg" width="16" align="top" alt=""> **Auto-flagging** — nocturnal birds by day, out-of-season migrants, low confidence isolates, non-European species
- <img src="docs/icons/check-circle.svg" width="16" align="top" alt=""> **Bulk actions** — confirm/reject/delete by rule, per-selection, or purge all rejected
- <img src="docs/icons/music.svg" width="16" align="top" alt=""> Full spectrogram modal with gain/highpass/lowpass filters and loop selection for manual verification
- <img src="docs/icons/trash-2.svg" width="16" align="top" alt=""> **Permanent deletion** — preview modal listing what will be deleted (DB + audio files), with result report

### Audio Configuration
- <img src="docs/icons/mic.svg" width="16" align="top" alt=""> Auto-detection of USB audio devices with one-click selection
- <img src="docs/icons/sliders-horizontal.svg" width="16" align="top" alt=""> **Adaptive gain** — noise floor estimation, clip guard, activity hold, observer/apply modes
- <img src="docs/icons/volume-x.svg" width="16" align="top" alt=""> **Bandpass + denoise** — lowpass filter (4-15 kHz), spectral gating (noisereduce), all toggleable per profile
- <img src="docs/icons/eye.svg" width="16" align="top" alt=""> **Filter preview** — before/after spectrograms from live mic to visualize filter effects
- <img src="docs/icons/sliders-horizontal.svg" width="16" align="top" alt=""> 6 environment profiles (garden, forest, roadside, urban, night, test)
- <img src="docs/icons/scale.svg" width="16" align="top" alt=""> Inter-channel calibration wizard for dual EM272 microphones
- <img src="docs/icons/bar-chart-3.svg" width="16" align="top" alt=""> Real-time VU meters via SSE

### Settings & System
- <img src="docs/icons/wrench.svg" width="16" align="top" alt=""> Full settings UI — models (one-click BirdNET download with license acceptance), analysis parameters, notifications, audio, backup
- <img src="docs/icons/map-pin.svg" width="16" align="top" alt=""> **Interactive GPS map** — Leaflet/OpenStreetMap widget in station settings with click-to-set, drag marker, and geolocation button
- <img src="docs/icons/monitor.svg" width="16" align="top" alt=""> System health — CPU, RAM, disk, temperature, services
- <img src="docs/icons/terminal.svg" width="16" align="top" alt=""> **Web terminal** — full bash in browser, supports Claude Code
- <img src="docs/icons/save.svg" width="16" align="top" alt=""> **Backup** — NFS/SMB/SFTP/S3/GDrive/WebDAV with scheduling
- <img src="docs/icons/sparkles.svg" width="16" align="top" alt=""> **11 themes** — 7 dark (Forest, Night, Ocean, Dusk, Solar Dark, Nord, High Contrast AAA), 3 light (Paper, Sepia, Solar Light), plus an **Auto** mode that follows the OS `prefers-color-scheme`. Mini page previews in the picker, smooth cross-fade between themes, fully token-driven (design system documented in [`docs/THEMES.md`](docs/THEMES.md))
- <img src="docs/icons/image.svg" width="16" align="top" alt=""> **Photo management** — ban/replace photos, set preferred photo per species
- <img src="docs/icons/flag.svg" width="16" align="top" alt=""> **Customizable branding** — configurable station name and header brand via settings
- <img src="docs/icons/globe.svg" width="16" align="top" alt=""> 4 UI languages (FR/EN/NL/DE) + 36 languages for species names

## Optimized Perch V2 Models

We publish **3 optimized Perch V2 TFLite models** for edge deployment, converted from the official Google SavedModel:

**[ernensbjorn/perch-v2-int8-tflite](https://huggingface.co/ernensbjorn/perch-v2-int8-tflite)** on HuggingFace

| Model | Size | Speed (Pi 5) | Quality | Best for |
|-------|------|-------------|---------|----------|
| `perch_v2_original.tflite` | 409 MB | 435 ms | baseline | Reference |
| `perch_v2_fp16.tflite` | 205 MB | 384 ms | top-1 100% | **Pi 5** |
| `perch_v2_dynint8.tflite` | 105 MB | 299 ms | top-1 93% | **Pi 4** |

Benchmarked on 20 real bird recordings from 20 species, 4 threads.

## Hardware

| Component | Recommended |
|-----------|-------------|
| SBC | Raspberry Pi 5 (8GB) recommended — also works on Pi 4 (4GB+) and Pi 3 (1GB, INT8 models only) |
| Storage | NVMe SSD (500GB+) |
| Audio | Any USB audio interface (e.g., RODE AI-Micro, Focusrite Scarlett, Behringer UMC, UGreen 30724) + microphone |
| Network | Ethernet or WiFi |

## Prerequisites

- Raspberry Pi 3/4/5 with Raspberry Pi OS 64-bit (Bookworm/Trixie) — Pi 5 recommended for dual-model
- Internet connection (for initial setup and model download)
- USB audio interface + microphone(s)
  - Lavalier (clip-on) microphones with **TRRS** plug need a **TRRS→TRS adapter** for standard USB sound cards
  - The installer auto-configures ALSA with a software gain boost for low-sensitivity USB mics

All other dependencies are installed automatically by the installer.

## Installation

### One-line install (recommended)

```bash
curl -sSL https://raw.githubusercontent.com/ernens/birdash/main/bootstrap.sh | bash
```

That's it. The bootstrap installs git if needed, clones the repo into `~/birdash`, runs `install.sh` non-interactively, downloads the BirdNET V2.4 model, enables dual-model detection (BirdNET + Perch), and starts all services. When it finishes, open the dashboard URL printed at the end and tweak GPS/audio from **Settings**.

BirdNET V2.4 is under **CC-BY-NC-SA 4.0** (non-commercial use — see the [BirdNET-Analyzer repo](https://github.com/kahst/BirdNET-Analyzer)). To skip the BirdNET download and use Perch-only:

```bash
curl -sSL https://raw.githubusercontent.com/ernens/birdash/main/bootstrap.sh | BIRDASH_SKIP_BIRDNET=1 bash
```

### Manual install

```bash
# 1. Clone and install
cd ~
git clone https://github.com/ernens/birdash.git
cd birdash
chmod +x install.sh
./install.sh                # interactive
# or: ./install.sh --yes    # non-interactive

# 2. Start all services
sudo systemctl enable --now birdengine-recording birdengine birdash caddy ttyd

# 3. Open the dashboard and configure
#    → Settings → Station: set GPS coordinates via interactive map
#    → Settings → Detection: download BirdNET V2.4 (one-click)
#    → Settings → Audio: select your USB audio device
```

The installer handles everything: system packages, Caddy, ttyd, databases, Perch V2 models (auto-downloaded from HuggingFace, variant adapted to your Pi model), services, and cron jobs. BirdNET V2.4 is installed via the dashboard (CC-NC-SA license acceptance required).

Your dashboard will be available at `http://yourpi.local/birds/`



## Updating

Birdash checks for new releases on GitHub once per day. When a new version is available, an update badge appears in the header.

### Manual update

```bash
cd ~/birdash
git pull
npm install
sudo systemctl restart birdash
```

If the engine or models changed:

```bash
sudo systemctl restart birdengine birdengine-recording
```

### How update detection works

- Backend route `/api/version-check` polls `api.github.com/repos/ernens/birdash/releases/latest` once per 24 hours
- Result is cached server-side, no GitHub call on each page load
- Frontend reads the cached result and shows a badge in the header if a newer version is available
- Click the badge to see release notes; "Dismiss" hides the badge until the next release

### Backup before updating

```bash
~/birdash/scripts/backup.sh
```

## What the Installer Does

| Step | Action |
|------|--------|
| 1 | System packages (Node.js, Python, ffmpeg, alsa, sqlite3, Caddy, ttyd) |
| 2 | Node.js dependencies |
| 3 | Python venv + ML dependencies (ai-edge-litert, numpy, soundfile, resampy, scipy, noisereduce) |
| 4 | Directory structure (audio, models, BirdSongs) |
| 5 | Database bootstrap (birds.db + birdash.db with full schema) |
| 6 | Configuration files (birdnet.conf with Pi-aware dual-model defaults, engine config, Caddy) |
| 7 | Model download — Perch V2 from HuggingFace (INT8 on Pi 3, + FP16/FP32 on Pi 4/5) |
| 8 | Systemd services (engine, recording, dashboard, terminal) |
| 9 | Caddy reverse proxy |
| 10 | Cron jobs (audio cleanup) |

> **Note:** BirdNET V2.4 (CC-NC-SA license) can be installed directly from the dashboard:
> **Settings → Detection → Download BirdNET V2.4**. The download button fetches models
> from the official [birdnetlib](https://pypi.org/project/birdnetlib/) package. You must
> accept the CC-NC-SA 4.0 license (non-commercial use only).

## Tests

```bash
# Node.js backend tests (134 tests)
npm test

# Python engine tests (13 tests)
cd engine && ../engine/venv/bin/python -m unittest test_engine -v
```

## Project Structure

```
birdash/
├── server/
│   ├── server.js                  # HTTP server, middleware, route delegations (208 lines)
│   ├── lib/
│   │   ├── alerts.js              # Alert monitoring system
│   │   ├── config.js              # BirdNET config, settings validators, exec helper
│   │   └── db.js                  # Database bootstrap, tables, taxonomy
│   └── routes/
│       ├── audio.js               # Audio devices, adaptive gain, streaming
│       ├── backup.js              # Backup config, scheduling, export
│       ├── data.js                # Favorites, notes, photo-pref, query
│       ├── detections.js          # Detections, validations, flagging
│       ├── external.js            # BirdWeather, eBird, weather APIs
│       ├── photos.js              # Photo resolution/caching, species names
│       ├── settings.js            # Settings, apprise, alerts, logs SSE
│       ├── system.js              # Services, health, hardware, models
│       ├── timeline.js            # Timeline with SunCalc astronomy
│       └── whats-new.js           # Daily overview cards
├── public/                        # Static frontend (Vue 3 CDN)
│   ├── index.html                 # Redirect to overview.html
│   ├── overview.html               # Landing page — KPIs, bird of the day, weather
│   ├── dashboard.html              # Bird Flow — live pipeline visualization
│   ├── today.html                 # Today's detections with audio filters
│   ├── calendar.html              # Calendar (timeline + species + audio)
│   ├── timeline.html              # Full-page timeline with drag-to-zoom
│   ├── detections.html            # Filterable detection table
│   ├── review.html                # Detection review + bulk actions
│   ├── species.html               # Species cards + favorites + notes
│   ├── gallery.html               # Best recordings + audio library
│   ├── favorites.html             # Favorites with stats + management
│   ├── weather.html               # Weather/activity correlation
│   ├── stats.html                 # Statistics + integrated Models tab
│   ├── analyses.html              # Per-species deep analysis
│   ├── biodiversity.html          # Shannon index, adaptive richness chart
│   ├── phenology.html             # Observed phenology calendar (per species)
│   ├── spectrogram.html           # Live spectrogram + clip playback
│   ├── settings.html              # Full settings (9 tabs)
│   ├── system.html                # System health + terminal
│   ├── log.html                   # Live log dashboard (SSE)
│   ├── recordings.html            # Audio library with photos
│   ├── rarities.html              # Rare species tracker
│   ├── recent.html                # Redirect to calendar.html
│   ├── models.html                # Redirect to stats.html?tab=models
│   ├── js/
│   │   ├── bird-config.js         # Navigation, API config
│   │   ├── bird-queries.js        # Shared SQL query library (56 queries)
│   │   ├── bird-icons.js          # Lucide icon set (98 SVG icons)
│   │   ├── bird-shared.js         # Utilities, DSP, favorites, notes API
│   │   ├── bird-vue-core.js       # Vue composables, i18n (4 langs), shell
│   │   └── bird-timeline.js       # Timeline rendering (sky, stars, markers)
│   ├── i18n/                      # Translation files (fr/en/de/nl.json)
│   ├── css/                       # Styles + 11 themes (see docs/THEMES.md)
│   ├── settings/                  # Lazy-loaded settings tab fragments
│   └── sw.js                      # Service Worker (offline cache)
├── engine/                        # BirdEngine (Python detection engine)
│   ├── engine.py                  # Dual-model inference (~1100 lines)
│   ├── config.toml                # Engine configuration
│   ├── record.sh                  # Audio capture (arecord)
│   ├── purge_audio.sh             # Disk space management
│   ├── convert_from_saved_model.py # Perch V2 optimization script
│   ├── birdengine.service         # systemd: detection engine
│   ├── birdengine-recording.service # systemd: audio capture
│   ├── ttyd.service               # systemd: web terminal
│   └── models/                    # TFLite models (not in git)
├── config/
│   ├── birdash.service            # systemd: dashboard
│   ├── audio_config.json          # Audio device config
│   ├── audio_profiles.json        # 6 environment profiles
│   ├── detection_rules.json       # Auto-flagging rules
│   └── birdash-local.example.js   # Local config template
├── scripts/
│   └── backup.sh                  # Incremental backup (rsync)
├── tests/
│   └── server.test.js             # Backend tests
├── README.md                      # English
├── README.fr.md                   # Francais
├── README.nl.md                   # Nederlands
└── README.de.md                   # Deutsch
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BIRDASH_PORT` | `7474` | API server port |
| `BIRDASH_DB` | `~/birdash/data/birds.db` | SQLite database path |
| `EBIRD_API_KEY` | — | eBird API key (optional) |
| `BW_STATION_ID` | — | BirdWeather station ID (optional) |

## Security

- Rate limiting: 300 req/min per IP
- Strict SQL validation (read-only, parameterized)
- Centralized SQL query library (`bird-queries.js`) — 56 parameterized queries with automatic confidence filtering
- Lucide icon system (`bird-icons.js` + `<bird-icon>` component) — 98 modern SVG icons replacing emojis across the UI
- Security headers (CSP, X-Frame-Options, Referrer-Policy)
- CORS restricted to localhost
- SRI on CDN scripts

## License

[MIT](LICENSE)
