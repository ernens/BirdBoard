# 🐦 Birdash

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js)](https://nodejs.org)
[![Vue 3](https://img.shields.io/badge/Vue.js-3-4FC08D?logo=vue.js)](https://vuejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Modern bird detection dashboard and engine for Raspberry Pi 5. Standalone dual-model architecture with BirdNET V2.4 + Perch V2.

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
- 🔔 **Smart notifications** — ntfy.sh alerts for rare species, first-of-season, new species (not every sparrow)
- ⚡ **Async post-processing** — MP3 extraction, spectrogram generation, DB sync don't block inference

### Dashboard (14 pages)

**Real-time**
- 📊 Dashboard overview with KPIs, weather widget, quick links, morning summary, "What's New" alerts
- 🎵 **Live spectrogram** — real-time audio from mic with bird name overlay
- 📅 **Today** — species list with audio player, spectrograms, gain/highpass/lowpass filters, new species filter

**History**
- 📆 **Calendar** — unified day-by-day view with timeline visualization, species list, audio player
- 🌅 **Timeline** — full-page interactive timeline with drag-to-zoom, unified bird density slider (0-100%), SVG sunrise/sunset/moon icons, type filter badges with blink highlight, confidence-mapped vertical layout
- 📋 **Detections** — full filterable table with favorites, new species filter, per-detection delete, CSV/eBird export
- ✅ **Review** — auto-flagged detections with spectro modal, bulk confirm/reject/delete with preview, purge rejected

**Species**
- 🦜 Species cards with photos (iNaturalist + Wikipedia), IUCN status, favorites (SQLite-backed), personal notes (per-species and per-detection), phenology calendar (12-month dot map), year-over-year monthly comparison, chart PNG export, Web Share API
- 💎 Rare species tracking
- 🏆 Best recordings gallery with audio library tab

**Analysis**
- 🌦️ **Weather** — dedicated page with correlation analysis (Pearson r), tomorrow's forecast, species by weather conditions
- 📈 Statistics and rankings with model comparison tab
- 🔬 Advanced analyses (polar charts, heatmaps, time series, narrative)
- 🧬 Biodiversity — Shannon index, taxonomy breakdown, phenology

**Navigation**
- 5 intent-based sections: Live, History, Species, Insights, Station
- Mobile bottom nav bar, global species+date search, notification bell, review badge counter
- Keyboard shortcuts on 5 pages, swipe gestures on species photos

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
# Node.js backend tests (46 tests)
npm test

# Python engine tests (13 tests)
cd engine && ../engine/venv/bin/python -m unittest test_engine -v
```

## Project Structure

```
birdash/
├── server/
│   └── server.js                  # Node.js API backend (~4700 lines)
├── public/                        # Static frontend (Vue 3 CDN)
│   ├── index.html                 # Dashboard overview + weather widget
│   ├── today.html                 # Today's detections with audio filters
│   ├── calendar.html              # Calendar (timeline + species + audio)
│   ├── timeline.html              # Full-page timeline with drag-to-zoom
│   ├── detections.html            # Filterable detection table
│   ├── review.html                # Detection review + bulk actions
│   ├── species.html               # Species cards + favorites + notes
│   ├── gallery.html               # Best recordings + audio library
│   ├── weather.html               # Weather/activity correlation
│   ├── stats.html                 # Statistics + model comparison tab
│   ├── analyses.html              # Per-species deep analysis
│   ├── biodiversity.html          # Shannon index, taxonomy, phenology
│   ├── spectrogram.html           # Live spectrogram + clip playback
│   ├── settings.html              # Full settings (9 tabs)
│   ├── system.html                # System health + terminal
│   ├── js/
│   │   ├── bird-config.js         # Navigation, API config
│   │   ├── bird-shared.js         # Utilities, DSP, favorites, notes API
│   │   ├── bird-vue-core.js       # Vue composables, i18n (4 langs), shell
│   │   └── bird-timeline.js       # Timeline rendering (sky, stars, markers)
│   ├── css/                       # Styles + 5 themes
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
- Security headers (CSP, X-Frame-Options, Referrer-Policy)
- CORS restricted to localhost
- SRI on CDN scripts

## License

[MIT](LICENSE)
