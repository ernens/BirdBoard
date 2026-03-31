# 🐦 Birdash

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js)](https://nodejs.org)
[![Vue 3](https://img.shields.io/badge/Vue.js-3-4FC08D?logo=vue.js)](https://vuejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Modern bird detection dashboard and engine for Raspberry Pi 5. Standalone dual-model architecture with BirdNET V2.4 + Perch V2.

> [Francais](README.fr.md) | [Nederlands](README.nl.md) | [Deutsch](README.de.md) | [Contributing](CONTRIBUTING.md)

## Screenshots

| Dashboard | Species Detail |
|:-:|:-:|
| ![Dashboard](screenshots/dashboard.png) | ![Species](screenshots/species.png) |

| Recordings | Detections |
|:-:|:-:|
| ![Recordings](screenshots/recordings.png) | ![Detections](screenshots/detections.png) |

| Spectrogram | Statistics |
|:-:|:-:|
| ![Spectrogram](screenshots/spectrogram.png) | ![Stats](screenshots/stats.png) |

## Architecture

```
Raspberry Pi 5 + SSD
├── USB Audio Interface
│     ↓
├── BirdEngine (Python)
│   ├── Recording service (arecord → WAV 45s)
│   ├── BirdNET V2.4    (~2s/file, primary)
│   ├── Perch V2 INT8   (~12s/file, secondary)
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
- 🤖 **Dual-model inference** — BirdNET V2.4 (fast, ~2s) + Perch V2 INT8 (precise, ~12s) in parallel
- 🎙️ **Local recording** — any USB audio interface via ALSA with configurable gain
- 🎚️ **Adaptive noise normalization** — automatic software gain based on ambient noise, with clip guard, activity hold, and observer mode
- 🔇 **Audio filters** — configurable highpass + lowpass (bandpass), spectral noise reduction (stationary gating), RMS normalization
- 📡 **BirdWeather** — automatic upload of soundscapes + detections
- 🔔 **Smart notifications** — ntfy.sh alerts for rare species, first-of-season, new species (not every sparrow)
- ⚡ **Async post-processing** — MP3 extraction, spectrogram generation, DB sync don't block inference

### Dashboard
- 📊 Real-time overview with KPIs, charts, morning summary
- 🎵 **Live spectrogram** — real-time audio from mic with bird name overlay
- 🎧 Detection feed with integrated audio playback
- 🦜 Species cards with photos (iNaturalist + Wikipedia), IUCN status
- 🧬 Biodiversity matrix, Shannon index, taxonomy breakdown
- 💎 Rare species tracking
- 📈 Statistics and rankings
- 🏆 Best recordings gallery
- 🔬 Advanced analyses (polar charts, heatmaps, time series)

### Model Comparison
- 🤖 **Side-by-side** — detections per model, species coverage, confidence
- 📊 **Daily chart** — detection trends per model over time
- 🎯 **Exclusive species** — what each model catches that the other misses
- 📋 **Overlap table** — shared species with detection ratio

### Detection Review
- 🔍 **Auto-flagging** — nocturnal birds by day, out-of-season migrants, low confidence isolates, non-European species
- ✅ **Bulk actions** — confirm/reject by rule ("reject all owls detected during daytime")
- 🎵 Audio playback per detection for manual verification

### Audio Configuration
- 🎙️ Auto-detection of USB audio devices with one-click selection
- 🎚️ **Adaptive gain** — noise floor estimation, clip guard, activity hold, observer/apply modes
- 🔇 **Bandpass + denoise** — lowpass filter (4-15 kHz), spectral gating (noisereduce), all toggleable per profile
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

## Quantized Model

We publish the first **Perch V2 INT8** quantized model for edge deployment:

**[ernensbjorn/perch-v2-int8-tflite](https://huggingface.co/ernensbjorn/perch-v2-int8-tflite)** on HuggingFace

~30% faster on Raspberry Pi 5 with identical species coverage (14,795 classes).

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
| 7 | Model download (Perch V2 INT8 from HuggingFace) |
| 8 | Systemd services (engine, recording, dashboard, terminal) |
| 9 | Caddy reverse proxy |
| 10 | Cron jobs (audio cleanup) |

> **Note:** BirdNET V2.4 model must be copied manually due to its CC-NC-SA license.
> Download from [BirdNET-Analyzer](https://github.com/kahst/BirdNET-Analyzer).

## Tests

```bash
# Node.js backend tests (40 tests)
npm test

# Python engine tests (13 tests)
cd engine && ../engine/venv/bin/python -m unittest test_engine -v
```

## Project Structure

```
birdash/
├── server/
│   └── server.js                  # Node.js API backend (~3500 lines)
├── public/                        # Static frontend (Vue 3 CDN)
│   ├── index.html                 # Dashboard overview
│   ├── spectrogram.html           # Live spectrogram + clip playback
│   ├── models.html                # Model comparison
│   ├── review.html                # Detection review + auto-flagging
│   ├── settings.html              # Full settings (6 tabs)
│   ├── system.html                # System health + terminal
│   ├── *.html                     # 9 more pages
│   ├── js/                        # Config, shared utils, Vue composables
│   ├── css/                       # Styles + 5 themes
│   └── sw.js                      # Service Worker (offline cache)
├── engine/                        # BirdEngine (Python detection engine)
│   ├── engine.py                  # Dual-model inference (~1100 lines)
│   ├── config.toml                # Engine configuration
│   ├── record.sh                  # Audio capture (arecord)
│   ├── purge_audio.sh             # Disk space management
│   ├── quantize_perch_mac.py      # Perch V2 INT8 quantization script
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
