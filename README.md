# 🐦 BirdStation

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js)](https://nodejs.org)
[![Vue 3](https://img.shields.io/badge/Vue.js-3-4FC08D?logo=vue.js)](https://vuejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Modern bird detection dashboard and engine for Raspberry Pi 5. Standalone dual-model architecture with BirdNET V2.4 + Perch V2. Customizable station name and branding.

> [Francais](README.fr.md) | [Nederlands](README.nl.md) | [Deutsch](README.de.md) | [Contributing](CONTRIBUTING.md)

## Screenshots

### Live
| Dashboard | Today | Spectrogram |
|:-:|:-:|:-:|
| ![Dashboard](screenshots/index.png) | ![Today](screenshots/today.png) | ![Spectrogram](screenshots/spectrogram.png) |

### History
| Calendar | Timeline | Detections | Review |
|:-:|:-:|:-:|:-:|
| ![Calendar](screenshots/calendar.png) | ![Timeline](screenshots/timeline.png) | ![Detections](screenshots/detections.png) | ![Review](screenshots/review.png) |

### Species
| Species | Recordings | Gallery | Rarities |
|:-:|:-:|:-:|:-:|
| ![Species](screenshots/species.png) | ![Recordings](screenshots/recordings.png) | ![Gallery](screenshots/gallery-best.png) | ![Rarities](screenshots/rarities.png) |

### Insights
| Weather | Statistics | Analyses | Biodiversity |
|:-:|:-:|:-:|:-:|
| ![Weather](screenshots/weather.png) | ![Stats](screenshots/stats.png) | ![Analyses](screenshots/analyses.png) | ![Biodiversity](screenshots/biodiversity.png) |

### Station
| System Health | Model Monitor | System Data | External |
|:-:|:-:|:-:|:-:|
| ![System](screenshots/system.png) | ![Model](screenshots/system-model.png) | ![Data](screenshots/system-data.png) | ![External](screenshots/system-external.png) |

| Detection | Audio | Notifications | Station |
|:-:|:-:|:-:|:-:|
| ![Detection](screenshots/settings-detection.png) | ![Audio](screenshots/settings-audio.png) | ![Notifications](screenshots/settings-notif.png) | ![Station](screenshots/settings-station.png) |

| Services | Species | Backup | Terminal |
|:-:|:-:|:-:|:-:|
| ![Services](screenshots/settings-services.png) | ![Species](screenshots/settings-species.png) | ![Backup](screenshots/settings-backup.png) | ![Terminal](screenshots/settings-terminal.png) |

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
- 🤖 **Dual-model inference** — BirdNET V2.4 (fast, ~2s) + Perch V2 (precise, ~2s) in parallel
- 🎙️ **Local recording** — any USB audio interface via ALSA with configurable gain
- 🎚️ **Adaptive noise normalization** — automatic software gain based on ambient noise, with clip guard, activity hold, and observer mode
- 🔇 **Audio filters** — configurable highpass + lowpass (bandpass), spectral noise reduction (stationary gating), RMS normalization
- 📡 **BirdWeather** — automatic upload of soundscapes + detections
- 🔔 **Smart notifications** — ntfy.sh alerts for rare species, first-of-season, new species, favorites (not every sparrow)
- ⚡ **Async post-processing** — MP3 extraction, spectrogram generation, DB sync don't block inference

### Dashboard (22 pages)

**Home**
- ⚡ **Bird Flow** — animated pipeline landing page showing live audio levels (SSE), dual-model inference with per-model species + confidence, detection flow with animated connectors, today's KPIs, key events feed, recent species gallery
- 📊 **Overview** — dashboard with KPIs, weather widget, quick links, morning summary, "What's New" alerts
- 🕐 **Recent activity** — latest detections across all species
- 🎵 **Live spectrogram** — real-time audio from mic with bird name overlay
- 📅 **Today** — species list with audio player, spectrograms, gain/highpass/lowpass filters, new species filter
- 🌐 **Species name translation** — bird names displayed in the user's chosen language across all pages

**History**
- 📆 **Calendar** — unified day-by-day view with timeline visualization, species list, audio player
- 🌅 **Timeline** — full-page interactive timeline with drag-to-zoom, unified bird density slider (0-100%), SVG sunrise/sunset/moon icons, type filter badges with blink highlight, confidence-mapped vertical layout
- 📋 **Detections** — full filterable table with favorites, new species filter, per-detection delete, CSV/eBird export
- ✅ **Review** — auto-flagged detections with spectro modal, bulk confirm/reject/delete with preview, purge rejected

**Species**
- 🦜 Species cards with photos (iNaturalist + Wikipedia), IUCN status, favorites (SQLite-backed), personal notes (per-species and per-detection), phenology calendar (12-month dot map), year-over-year monthly comparison, chart PNG export, Web Share API
- ⭐ **Favorites** — dedicated page with KPIs, search, sort; heart toggle on all species lists
- 💎 Rare species tracking
- 🏆 Best recordings gallery with audio library tab

**Analysis**
- 🌦️ **Weather** — dedicated page with correlation analysis (Pearson r), tomorrow's forecast, species by weather conditions
- 📈 Statistics and rankings with model comparison tab
- 🔬 Advanced analyses (polar charts, heatmaps, time series, narrative)
- 🧬 Biodiversity — Shannon index, taxonomy breakdown, phenology
- 📅 **Phenology calendar** — observed annual cycle per species (presence/abundance/hourly modes), inferred phases (active period, peak abundance, dawn chorus, migrant detection), 53-week ribbon visualization

**Station**
- 📋 **Live log** — real-time streaming dashboard (SSE) with color-coded categories, filters, KPIs (detections/BirdWeather/errors), pause/resume, auto-scroll

**Navigation**
- 6 intent-based sections: Home, Live, History, Species, Indicators, Station
- Mobile bottom nav (4 quick links + hamburger drawer with all 22 pages)
- Global species+date search, notification bell, review badge counter
- Keyboard shortcuts on 5 pages, swipe gestures on species photos
- Toast notifications for API errors
- Cross-navigation between settings and system pages

### Detection Review
- 🔍 **Auto-flagging** — nocturnal birds by day, out-of-season migrants, low confidence isolates, non-European species
- ✅ **Bulk actions** — confirm/reject/delete by rule, per-selection, or purge all rejected
- 🎵 Full spectrogram modal with gain/highpass/lowpass filters and loop selection for manual verification
- 🗑️ **Permanent deletion** — preview modal listing what will be deleted (DB + audio files), with result report

### Audio Configuration
- 🎙️ Auto-detection of USB audio devices with one-click selection
- 🎚️ **Adaptive gain** — noise floor estimation, clip guard, activity hold, observer/apply modes
- 🔇 **Bandpass + denoise** — lowpass filter (4-15 kHz), spectral gating (noisereduce), all toggleable per profile
- 👁️ **Filter preview** — before/after spectrograms from live mic to visualize filter effects
- 🎛️ 6 environment profiles (garden, forest, roadside, urban, night, test)
- ⚖️ Inter-channel calibration wizard for dual EM272 microphones
- 📊 Real-time VU meters via SSE

### Settings & System
- 🔧 Full settings UI — models, analysis parameters, notifications, audio, backup
- 🖥️ System health — CPU, RAM, disk, temperature, services
- 💻 **Web terminal** — full bash in browser, supports Claude Code
- 💾 **Backup** — NFS/SMB/SFTP/S3/GDrive/WebDAV with scheduling
- 🎨 5 themes (Forest, Night, Paper, Ocean, Dusk)
- 📷 **Photo management** — ban/replace photos, set preferred photo per species
- 🏷️ **Customizable branding** — configurable station name and header brand via settings
- 🌍 4 UI languages (FR/EN/NL/DE) + 36 languages for species names

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
| SBC | Raspberry Pi 5 (8GB) |
| Storage | NVMe SSD (500GB+) |
| Audio | Any USB audio interface (e.g., RODE AI-Micro, Focusrite Scarlett, Behringer UMC) |
| Network | Ethernet or WiFi |

## Prerequisites

- Raspberry Pi 5 (4 or 8 GB) with Raspberry Pi OS 64-bit (Bookworm/Trixie)
- Internet connection (for initial setup and model download)
- USB audio interface + microphone(s)

All other dependencies are installed automatically by the installer.

## Installation

```bash
# 1. Clone and install (everything is automated)
cd ~
git clone https://github.com/ernens/birdash.git
cd birdash
chmod +x install.sh
./install.sh

# 2. Edit your station location
sudo nano /etc/birdnet/birdnet.conf    # Set LATITUDE, LONGITUDE, DATABASE_LANG
nano engine/config.toml                # Station name, BirdWeather ID, ntfy URL
nano public/js/birdash-local.js        # Location for eBird integration

# 3. Start all services
sudo systemctl enable --now birdengine-recording birdengine birdash caddy ttyd
```

The installer handles everything: system packages, Caddy, ttyd, databases, models, services, and cron jobs. See `install.sh` for details.

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
| 6 | Configuration files (birdnet.conf, engine config, ALSA, Caddy) |
| 7 | Model download (Perch V2 FP16 from HuggingFace) |
| 8 | Systemd services (engine, recording, dashboard, terminal) |
| 9 | Caddy reverse proxy |
| 10 | Cron jobs (audio cleanup) |

> **Note:** BirdNET V2.4 model must be copied manually due to its CC-NC-SA license.
> Download from [BirdNET-Analyzer](https://github.com/kahst/BirdNET-Analyzer).

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
│   ├── index.html                 # Redirect to dashboard.html
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
│   ├── stats.html                 # Statistics + model comparison tab
│   ├── analyses.html              # Per-species deep analysis
│   ├── biodiversity.html          # Shannon index, taxonomy, phenology
│   ├── phenology.html              # Observed phenology calendar (per species)
│   ├── spectrogram.html           # Live spectrogram + clip playback
│   ├── settings.html              # Full settings (9 tabs)
│   ├── system.html                # System health + terminal
│   ├── log.html                   # Live log dashboard (SSE)
│   ├── overview.html               # Dashboard overview + weather widget
│   ├── recent.html                 # Recent activity
│   ├── recordings.html             # Best recordings
│   ├── models.html                 # Model comparison
│   ├── rarities.html               # Rare species tracker
│   ├── js/
│   │   ├── bird-config.js         # Navigation, API config
│   │   ├── bird-queries.js        # Shared SQL query library (56 queries)
│   │   ├── bird-icons.js          # Lucide icon set (98 SVG icons)
│   │   ├── bird-shared.js         # Utilities, DSP, favorites, notes API
│   │   ├── bird-vue-core.js       # Vue composables, i18n (4 langs), shell
│   │   └── bird-timeline.js       # Timeline rendering (sky, stars, markers)
│   ├── i18n/                      # Translation files (fr/en/de/nl.json)
│   ├── css/                       # Styles + 5 themes
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

- Rate limiting: 120 req/min per IP
- Strict SQL validation (read-only, parameterized)
- Centralized SQL query library (`bird-queries.js`) — 56 parameterized queries with automatic confidence filtering
- Lucide icon system (`bird-icons.js` + `<bird-icon>` component) — 98 modern SVG icons replacing emojis across the UI
- Security headers (CSP, X-Frame-Options, Referrer-Policy)
- CORS restricted to localhost
- SRI on CDN scripts

## License

[MIT](LICENSE)
