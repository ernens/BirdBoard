# 🐦 BirdStation

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js)](https://nodejs.org)
[![Vue 3](https://img.shields.io/badge/Vue.js-3-4FC08D?logo=vue.js)](https://vuejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Modern bird detection dashboard and engine for Raspberry Pi 5. Standalone dual-model architecture with BirdNET V2.4 + Perch V2. Community network with live station map. Customizable station name and branding.

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
<summary><b>Live</b> — Dashboard · Spectrogram · Log · Live Board</summary>

<p align="center">
  <img src="screenshots/dashboard.png"   width="240" alt="Dashboard">
  <img src="screenshots/spectrogram.png" width="240" alt="Spectrogram">
  <img src="screenshots/log.png"         width="240" alt="Live log">
  <img src="screenshots/liveboard.png"   width="240" alt="Live Board">
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
<summary><b>Species</b> — Species · Recordings · Rarities · Favorites</summary>

<p align="center">
  <img src="screenshots/species.png"    width="240" alt="Species">
  <img src="screenshots/recordings.png" width="240" alt="Recordings">
  <img src="screenshots/rarities.png"   width="240" alt="Rarities">
  <img src="screenshots/favorites.png"  width="240" alt="Favorites">
</p>
</details>

<details>
<summary><b>Indicators</b> — Weather · Statistics · Models · Analyses · Biodiversity · Phenology · Seasons · Compare</summary>

<p align="center">
  <img src="screenshots/weather.png"      width="240" alt="Weather">
  <img src="screenshots/stats.png"        width="240" alt="Statistics">
  <img src="screenshots/system-model.png" width="240" alt="Models">
  <img src="screenshots/analyses.png"     width="240" alt="Analyses">
  <img src="screenshots/biodiversity.png" width="240" alt="Biodiversity">
  <img src="screenshots/phenology.png"    width="240" alt="Phenology">
  <img src="screenshots/comparison.png"   width="240" alt="Seasons">
  <img src="screenshots/compare.png"      width="240" alt="Compare 2 species">
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

> **[Full architecture documentation →](ARCHITECTURE.md)** — deep technical reference covering audio pipeline, database schema, performance, and more.

```
Raspberry Pi 5 + SSD
├── USB Audio Interface
│     ↓
├── BirdEngine (Python)
│   ├── Recording service (arecord → WAV 45s)
│   ├── Audio pipeline: Adaptive Gain → Highpass → Lowpass
│   │   → Noise Profile Subtraction → RMS Normalize
│   ├── BirdNET V2.4    (~1.5s/file, primary)
│   ├── Perch V2         (~0.7s/file on Pi 5, secondary)
│   ├── MP3 extraction + spectrograms
│   └── BirdWeather upload
│
├── Birdash (Node.js)
│   ├── Dashboard API (port 7474)
│   ├── Live spectrogram (PCM + MP3 stream)
│   ├── Push notifications via Apprise (100+ services)
│   ├── Detection review + auto-flagging
│   ├── Telemetry (opt-in Supabase)
│   └── In-app bug reporting (GitHub Issues)
│
├── Caddy (reverse proxy :80)
├── ttyd (web terminal)
└── SQLite (1M+ detections)
```

## Features

### Detection Engine (BirdEngine)
- <img src="docs/icons/cpu.svg" width="16" align="top" alt=""> **Dual-model inference** — BirdNET V2.4 (~1.5s/file) + Perch V2 (~0.7s/file on Pi 5) in parallel. Model variant auto-selected per Pi: FP32 on Pi 5, FP16 on Pi 4, INT8 on Pi 3
- <img src="docs/icons/mic.svg" width="16" align="top" alt=""> **Local recording** — any USB audio interface via ALSA with configurable gain
- <img src="docs/icons/sliders-horizontal.svg" width="16" align="top" alt=""> **Adaptive noise normalization** — automatic software gain based on ambient noise, with clip guard, activity hold, and observer mode
- <img src="docs/icons/volume-x.svg" width="16" align="top" alt=""> **Audio filters** — configurable highpass + lowpass (bandpass), spectral noise reduction (stationary gating), RMS normalization
- <img src="docs/icons/radio.svg" width="16" align="top" alt=""> **BirdWeather** — automatic upload of soundscapes + detections
- <img src="docs/icons/bell.svg" width="16" align="top" alt=""> **Smart push notifications** — via Apprise (ntfy, Telegram, Discord, Slack, email, 100+ services) with species photo attached, station name prefix (`[Heinsch] Merle noir`). 5 configurable rules: rare species, first-of-season, new species, first-of-day, favorites
- <img src="docs/icons/zap.svg" width="16" align="top" alt=""> **MQTT publisher** — opt-in, publishes each detection to any MQTT broker (Mosquitto, EMQX, HiveMQ…) on `<prefix>/<station>/detection`, with a retained `last_species` topic and LWT online/offline status. Optional **Home Assistant auto-discovery** creates `Last species` + `Last confidence` sensor entities automatically. Configurable QoS, retain, TLS, username/password, minimum confidence — one-click Test from Settings
- <img src="docs/icons/bar-chart-3.svg" width="16" align="top" alt=""> **Prometheus `/metrics` endpoint** — scrape `http://your-pi.local/birds/metrics` from Prometheus / Grafana / VictoriaMetrics. Custom gauges (detections total/today/last-hour, distinct species, last-detection age, DB size), system gauges (CPU temp, usage, RAM, disk, fan RPM, uptime), feature toggles, and standard Node.js process metrics. Refreshed lazily on each scrape
- <img src="docs/icons/mic.svg" width="16" align="top" alt=""> **Live sound-level monitor (Leq / peak)** — RMS and peak in dBFS computed per recording, exposed on `/metrics` (`birdash_sound_leq_dbfs`, `_peak_dbfs`, `_leq_1h_avg_dbfs`) and displayed as a live card in Settings → Audio with a 60-point sparkline. Useful for spotting wind, traffic, a dead mic, or silent overnight hours. Uncalibrated (trend-tracking, not SPL). Optional Apprise alerts when the average Leq drops below `-90 dBFS` for 15 min (silent mic) or stays above `-5 dBFS` (clipping)
- <img src="docs/icons/lock.svg" width="16" align="top" alt=""> **Auth & access control** — opt-in cookie sessions (single user, bcrypt). Three modes: `off` (LAN-trust, default), `protected` (login for everything), and **`public-read`** (everyone can browse detections, species and stats — login required only to change settings or access sensitive data). HMAC-signed cookies, no DB sessions to manage. Bearer token (`BIRDASH_API_TOKEN`) still works in parallel for cron/automation. Login attempts rate-limited 5/min/IP. See **[Expose on the internet](#expose-on-the-internet)** below
- <img src="docs/icons/globe.svg" width="16" align="top" alt=""> **Range filter — geographic** — BirdNET MData filter (already active, configurable via `SF_THRESH`) now shows the **live list of species expected at your location for the current week** (Settings → Detection). Plus opt-in **eBird filter for Perch** that drops Perch detections absent from the local eBird "recently observed" map — Perch has no built-in geographic model and otherwise reports tropical species in temperate zones
- <img src="docs/icons/shield.svg" width="16" align="top" alt=""> **Pre-analysis filters (YAMNet)** — opt-in **privacy filter** (drops detections + optionally deletes the WAV when human voice is detected, RGPD-friendly default) and **dog bark filter** (drops detections + cooldown window when bark / howl / growl is detected — stops the cascade of false positives dogs trigger). Powered by Google's YAMNet (AudioSet, 521 audio classes, 4 MB TFLite, bundled). One model, two filters, ~30 ms added latency per recording on Pi 5
- <img src="docs/icons/bird.svg" width="16" align="top" alt=""> **Weekly editorial digest** — Monday 8am, 5 curated lines via Apprise: numbers + delta vs N-1, highlight (rare > first-of-year > notable), best moment, phenology shift, top 3 species. Opt-in, optional tag routing
- <img src="docs/icons/zap.svg" width="16" align="top" alt=""> **Async post-processing** — MP3 extraction, spectrogram generation, DB sync don't block inference

### Dashboard (20 pages)

**Home**
- <img src="docs/icons/bar-chart-3.svg" width="16" align="top" alt=""> **Overview** (landing page) — 6 KPIs (incl. first-detection time), "What's New" alerts, weather context, hourly activity. Featured-detection card with two tabs: **Last detection** (station-alive signal) and **Best of today** (highest-confidence pick of the day)
- <img src="docs/icons/calendar.svg" width="16" align="top" alt=""> **Today** — species list with sort (count / first heard / max conf / new first) and separated count/confidence pills. Per-species **interpretive summary** (single deterministic status: needs review / single weak / isolated burst / repeated high-confidence / mostly dawn active / present all day). Spectrogram with **expected frequency band overlay** (~95 species, toggleable). Audio player with gain/HP/LP filters. Direct deep-link to **Review** with species + date pre-filtered
- <img src="docs/icons/globe.svg" width="16" align="top" alt=""> **Species name translation** — bird names displayed in the user's chosen language across all pages

**Live**
- <img src="docs/icons/zap.svg" width="16" align="top" alt=""> **Bird Flow** — animated pipeline showing live audio levels (SSE), dual-model inference with per-model species + confidence, detection flow with animated connectors, today's KPIs, key events feed
- <img src="docs/icons/music.svg" width="16" align="top" alt=""> **Live spectrogram** — real-time audio from mic with bird name overlay
- <img src="docs/icons/scroll-text.svg" width="16" align="top" alt=""> **Live log** — real-time streaming dashboard (SSE) with color-coded categories, KPIs, pause/resume
- <img src="docs/icons/monitor.svg" width="16" align="top" alt=""> **Live Board** — full-screen kiosk display for a dedicated screen: large species photo, KPIs, today's species list, weather, auto-refresh 30s, discreet back button

**History**
- <img src="docs/icons/calendar-days.svg" width="16" align="top" alt=""> **Calendar** — monthly grid with per-day species count, detection count, activity heatmap, new species badges (★) and rare species badges (◆). Click a cell with badges to see a popover with species photos and names. Click any day to open the detail view
- <img src="docs/icons/sunrise.svg" width="16" align="top" alt=""> **Timeline** — full-page interactive timeline with drag-to-zoom, unified bird density slider (0-100%), SVG sunrise/sunset/moon icons, type filter badges with blink highlight, confidence-mapped vertical layout
- <img src="docs/icons/list.svg" width="16" align="top" alt=""> **Detections** — full filterable table with favorites, new species filter, per-detection delete, CSV/eBird export
- <img src="docs/icons/check-circle.svg" width="16" align="top" alt=""> **Review** — auto-flagged detections with spectro modal, bulk confirm/reject/delete with preview, purge rejected

**Species**
- <img src="docs/icons/bird.svg" width="16" align="top" alt=""> Species cards with photos (iNaturalist + Wikipedia), IUCN status, favorites (SQLite-backed), personal notes (per-species and per-detection), phenology calendar (12-month dot map), year-over-year monthly comparison, chart PNG export, Web Share API
- <img src="docs/icons/star.svg" width="16" align="top" alt=""> **Favorites** — dedicated page with KPIs, search, sort; heart toggle on all species lists
- <img src="docs/icons/gem.svg" width="16" align="top" alt=""> **Rarities** — full-width clickable KPI cards, filterable table (seen once / new this year), detailed species list with photos and confidence badges
- <img src="docs/icons/music.svg" width="16" align="top" alt=""> **Recordings** — unified audio library with two tabs: "Library" (all recordings, sortable/filterable) and "Best" (top recordings grouped by species)

**Indicators**
- <img src="docs/icons/cloud-sun.svg" width="16" align="top" alt=""> **Weather** — dedicated page with correlation analysis (Pearson r), tomorrow's forecast, species by weather conditions
- <img src="docs/icons/trending-up.svg" width="16" align="top" alt=""> **Statistics** — rankings, records, distributions, annual evolution; integrated **Models** tab for dual-model comparison (daily chart, exclusive species, overlap analysis)
- <img src="docs/icons/microscope.svg" width="16" align="top" alt=""> Advanced analyses (polar charts, heatmaps, time series, narrative)
- <img src="docs/icons/dna.svg" width="16" align="top" alt=""> Biodiversity — Shannon index, adaptive richness chart, taxonomy heatmap
- <img src="docs/icons/calendar.svg" width="16" align="top" alt=""> **Phenology calendar** — observed annual cycle per species (presence/abundance/hourly modes), inferred phases (active period, peak abundance, dawn chorus, migrant detection), 53-week ribbon visualization, species suggestions on empty state
- <img src="docs/icons/sunrise.svg" width="16" align="top" alt=""> **Seasons** — seasonal ornithological report (spring/summer/autumn/winter). Migratory arrivals with date comparison vs previous year (earlier/later), departures, season-exclusive species, multi-year evolution chart, best days, top species with year-over-year delta
- <img src="docs/icons/git-compare.svg" width="16" align="top" alt=""> **Compare** — side-by-side disambiguation of 2 species. Identity cards, deterministic verdict (not enough data / possible model confusion / strong seasonal separation / distinct profiles), 24h activity overlay, weekly phenology overlay, confidence histogram, reliability badge. Hardcoded "often confused" pairs (Chiffchaff/Willow Warbler, Marsh/Willow Tit…)

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
- <img src="docs/icons/volume-x.svg" width="16" align="top" alt=""> **Bandpass + denoise** — highpass (50-300 Hz), lowpass (4-15 kHz), spectral gating (noisereduce), all toggleable per profile
- <img src="docs/icons/mic.svg" width="16" align="top" alt=""> **Ambient noise profile** — record 5s of background noise (highway, HVAC), used for targeted spectral subtraction via noisereduce `y_noise` — more effective than auto-denoise for constant noise sources
- <img src="docs/icons/eye.svg" width="16" align="top" alt=""> **Filter preview** — before/after spectrograms from live mic to visualize the effect of each filter including the noise profile
- <img src="docs/icons/zap.svg" width="16" align="top" alt=""> **Audio pipeline** — Mic → Adaptive Gain → Highpass → Lowpass → Noise Profile (or auto denoise) → RMS Normalize → BirdNET + Perch — visual pipeline diagram in Settings
- <img src="docs/icons/sliders-horizontal.svg" width="16" align="top" alt=""> 6 environment profiles (garden, forest, roadside, urban, night, test)
- <img src="docs/icons/scale.svg" width="16" align="top" alt=""> Inter-channel calibration wizard for dual EM272 microphones
- <img src="docs/icons/bar-chart-3.svg" width="16" align="top" alt=""> Real-time VU meters via SSE

### Community Network
- <img src="docs/icons/radio.svg" width="16" align="top" alt=""> **BirdStation Network** — opt-in community of stations sharing daily detection summaries via Supabase
- <img src="docs/icons/map-pin.svg" width="16" align="top" alt=""> **[Live station map](https://ernens.github.io/birdash-network/)** — all registered stations on an interactive dark-themed map
- <img src="docs/icons/bug.svg" width="16" align="top" alt=""> **In-app bug reporting** — submit issues directly to GitHub from the dashboard header, with optional log attachment (last hour of service logs included in the issue)

### Settings & System
- <img src="docs/icons/wrench.svg" width="16" align="top" alt=""> Full settings UI — models (one-click BirdNET download with license acceptance), analysis parameters, notifications, audio, backup
- <img src="docs/icons/map-pin.svg" width="16" align="top" alt=""> **Interactive GPS map** — Leaflet/OpenStreetMap widget in station settings with click-to-set, drag marker, and geolocation button
- <img src="docs/icons/monitor.svg" width="16" align="top" alt=""> System health — CPU, RAM, disk, temperature, services
- <img src="docs/icons/terminal.svg" width="16" align="top" alt=""> **Web terminal** — full bash in browser, supports Claude Code
- <img src="docs/icons/save.svg" width="16" align="top" alt=""> **Backup** — NFS/SMB/SFTP/S3/GDrive/WebDAV with scheduling
- <img src="docs/icons/sparkles.svg" width="16" align="top" alt=""> **12 themes** — 7 dark (Forest, Night, Ocean, Dusk, Solar Dark, Nord, High Contrast AAA), 4 light (Paper, Sepia, Solar Light, Colonial), plus an **Auto** mode that follows the OS `prefers-color-scheme`. Mini page previews in the picker, smooth cross-fade between themes, fully token-driven (design system documented in [`docs/THEMES.md`](docs/THEMES.md))
- <img src="docs/icons/image.svg" width="16" align="top" alt=""> **Photo management** — ban/replace photos, set preferred photo per species
- <img src="docs/icons/flag.svg" width="16" align="top" alt=""> **Customizable branding** — configurable station name and header brand via settings
- <img src="docs/icons/globe.svg" width="16" align="top" alt=""> 4 UI languages (FR/EN/NL/DE) + 36 languages for species names
- <img src="docs/icons/scale.svg" width="16" align="top" alt=""> **Locale-aware units & formats** — auto-detected from browser locale (°C/°F, km/h/mph, 12h/24h, DMY/MDY/ISO dates, Mon/Sun week start), overridable in Settings → Station

## Optimized Perch V2 Models

We publish **3 optimized Perch V2 TFLite models** for edge deployment, converted from the official Google SavedModel:

**[ernensbjorn/perch-v2-int8-tflite](https://huggingface.co/ernensbjorn/perch-v2-int8-tflite)** on HuggingFace

| Model | Size | Latency (Pi 5) | Top-1 | Top-5 | Best for |
|-------|------|---------------|-------|-------|----------|
| `perch_v2_original.tflite` | 409 MB | 435 ms | baseline | baseline | **Pi 5** (default) |
| `perch_v2_fp16.tflite` | 205 MB | 384 ms | 100% | 99% | **Pi 4** (default) |
| `perch_v2_dynint8.tflite` | 105 MB | 299 ms | 93% | 90% | **Pi 3** (default) |

Benchmarked on Raspberry Pi 5 (8 GB, Cortex-A76 @ 2.4 GHz), 20 real bird recordings from 20 species, 5 runs each, 4 threads. The installer auto-selects the optimal variant for your Pi model.

## Hardware

| Component | Recommended |
|-----------|-------------|
| SBC | Raspberry Pi 5 (8GB) recommended — also works on Pi 4 (4GB+) and Pi 3 (1GB, INT8 models only) |
| Storage | NVMe SSD (500GB+) |
| Audio | Any USB audio interface (e.g., RODE AI-Micro, Focusrite Scarlett, Behringer UMC, UGreen 30724) + microphone |
| Network | Ethernet or WiFi |

## Expose on the internet

By default birdash trusts the LAN — anyone on `192.168.x.x` can change settings. To safely show your station to friends or embed it in a public site:

1. **Enable auth.** In **Settings → Station → Security**, pick a mode:
   - **`Public read-only`** ⭐ — visitors can browse detections, species, stats, audio. Login required to change settings, edit detections, or see logs. **Recommended for public sharing.**
   - **`Protected`** — login required for everything.

   Set a username + password (8 chars min, bcrypt-hashed in `birdnet.conf`). Login attempts are rate-limited 5/min/IP.

2. **Reverse-tunnel with Cloudflare** (no port-forwarding, free TLS, hides your home IP):

   ```bash
   # On your Pi
   curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb -o cloudflared.deb
   sudo dpkg -i cloudflared.deb

   # Login + create a tunnel
   cloudflared tunnel login
   cloudflared tunnel create birdash
   cloudflared tunnel route dns birdash birds.example.com

   # /etc/cloudflared/config.yml
   tunnel: <UUID-from-create>
   credentials-file: /root/.cloudflared/<UUID>.json
   ingress:
     - hostname: birds.example.com
       service: http://localhost:80
     - service: http_status:404

   sudo cloudflared service install
   sudo systemctl restart cloudflared
   ```

   Your station is now reachable at `https://birds.example.com/birds/` with end-to-end TLS, no open ports on your router, and Cloudflare in front of any abuse.

3. **Don't forget the Bearer token.** If you also use `BIRDASH_API_TOKEN` for cron/automation, that still works in parallel — set the `Authorization: Bearer <token>` header instead of logging in.

Alternatives: Tailscale Funnel, ngrok, plain port-forward + Caddy with Let's Encrypt — birdash doesn't care which transport you use as long as something terminates TLS in front of it.

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

### In-app update (recommended)

When a new version is available, a red banner appears at the top of every page with the real semver version (e.g. `v1.7.0 → v1.7.3`). Click **View** to see categorized release notes, then:

- **Install now** — applies the update, restarts services with health-check, auto-reloads the page
- **Later (24h)** — snoozes the banner for 24 hours
- **Skip these updates** — hides until a newer version is published

On failure:
- **Roll back** — reverts to the previous version (appears when `previousCommit` is known)
- **Force update** — forces the update even with diverged history or dirty files
- **Show log** — expandable log viewer for debugging

On success: a confirmation message is shown, and the page auto-reloads after 2 seconds.

### Remote update via SSH

```bash
ssh user@yourpi.local 'bash ~/birdash/scripts/update.sh'
```

### Fan-out to multiple stations

```bash
for h in mickey donald papier; do
  ssh "$h.local" 'bash ~/birdash/scripts/update.sh'
done
```

### Versioning (semver)

BirdStation follows [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`

| Bump | When | Example |
|------|------|---------|
| PATCH | Bug fix, polish, CSS tweak | 1.7.0 → 1.7.1 |
| MINOR | New feature, screen refonte | 1.7.3 → 1.8.0 |
| MAJOR | Breaking change, DB migration | 1.8.0 → 2.0.0 |

Version source of truth: `package.json`. Bump before pushing:

```bash
bash scripts/bump.sh patch    # bug fix
bash scripts/bump.sh minor    # new feature
bash scripts/bump.sh major    # breaking change
bash scripts/bump.sh          # auto from last commit (feat:→minor, else→patch)
```

### How it works

- `/api/update-status` compares local `git rev-parse HEAD` against `git ls-remote origin main` (1-minute cache)
- `latestVersion` is fetched from the remote `package.json` via GitHub Contents API (real version, no guessing)
- `update.sh` runs: git fetch → merge → npm/pip install (fatal on failure) → migrations → health-check restart
- `rollback.sh` reverts to a known commit: `git reset --hard` → npm install → health-check restart
- All update output is logged to `config/update.log`
- Stale "running" states auto-expire after 10 minutes
- Snooze state stored server-side in `config/update-state.json` (persistent across browsers)
- `BIRDASH_SKIP_BIRDNET=1` skips BirdNET download during install if desired

## What the Installer Does

| Step | Action |
|------|--------|
| 1 | System packages (Node.js, Python, ffmpeg, alsa, sqlite3, Caddy, ttyd) |
| 2 | Node.js dependencies |
| 3 | Python venv + ML dependencies (ai-edge-litert, numpy, soundfile, resampy, scipy, noisereduce) |
| 4 | Directory structure (audio, models, BirdSongs) |
| 5 | Database bootstrap (birds.db + birdash.db with full schema) |
| 6 | GeoIP auto-detection (latitude, longitude, language from [ipapi.co](https://ipapi.co)) |
| 7 | Configuration files (birdnet.conf with Pi-aware defaults, engine config, ALSA dsnoop for shared mic access) |
| 8 | Model download — Perch V2 from HuggingFace (auto: FP32 on Pi 5, FP16 on Pi 4, INT8 on Pi 3) |
| 9 | Systemd services with `KillMode=process` (engine, recording, dashboard, terminal) |
| 10 | Caddy reverse proxy |
| 11 | BirdNET V2.4 download via birdnetlib (CC-BY-NC-SA 4.0) + l18n species labels (38 languages) |
| 12 | Enable dual-model (BirdNET primary + Perch secondary), start all services |

> **Note:** BirdNET V2.4 download can be skipped with `BIRDASH_SKIP_BIRDNET=1` and installed later from the dashboard: **Settings → Detection → Download BirdNET V2.4**.

## Tests

```bash
# Node.js backend tests (160 tests including cross-page coherence)
npm test

# Python engine tests (13 tests)
cd engine && ../engine/venv/bin/python -m unittest test_engine -v

# Smoke test — loads every page in a headless browser, captures pageerror
# + console.error + 5xx, exits non-zero on any failure. Catches the
# silent regressions screenshot-only runs miss (broken JS, missing icons,
# pages that fail to mount).
npm run smoke                       # local
npm run smoke http://biloute.local  # against any Pi station

# Refresh README screenshots (Paper theme, EN, 1440x900)
npm run screenshots
```

## Project Structure

```
birdash/
├── server/
│   ├── server.js                  # HTTP server, middleware, route delegations (271 lines)
│   ├── lib/
│   │   ├── adaptive-gain.js       # Adaptive software gain algorithm
│   │   ├── alerts.js              # System alert monitoring (temp, disk, RAM)
│   │   ├── alert-i18n.js          # Alert message translations (4 langs)
│   │   ├── config.js              # BirdNET config, settings validators, exec helper
│   │   ├── db.js                  # Database bootstrap, tables, taxonomy
│   │   ├── notification-watcher.js # Push notifications (polls DB, sends via Apprise)
│   │   ├── result-cache.js        # Proactive result cache for heavy queries
│   │   ├── safe-config.js         # Atomic JSON config read/write with mutex
│   │   ├── telemetry.js           # Telemetry: anonymous pings + community network
│   │   └── whats-new-worker.js    # Worker thread for heavy computation
│   └── routes/
│       ├── audio.js               # Audio devices, streaming, profiles, monitoring
│       ├── backup.js              # Backup config, scheduling, export
│       ├── bug-report.js          # In-app bug reporting (GitHub Issues)
│       ├── comparison.js          # Seasonal report (spring/summer/autumn/winter)
│       ├── data.js                # Favorites, notes, photo-pref, query
│       ├── detections.js          # Detections, validations, flagging
│       ├── external.js            # BirdWeather, eBird, weather APIs
│       ├── photos.js              # Photo resolution/caching, species names
│       ├── settings.js            # Settings, apprise, alerts, logs SSE
│       ├── system.js              # Services, health, hardware, models
│       ├── telemetry.js           # Telemetry routes (register, anonymous pings toggle)
│       ├── timeline.js            # Timeline with SunCalc astronomy
│       ├── updates.js             # Update system: status, apply, rollback, force, log
│       └── whats-new.js           # Daily overview cards
├── public/                        # Static frontend (Vue 3 (vendored))
│   ├── index.html                 # Redirect to overview.html
│   ├── overview.html               # Landing page — KPIs, bird of the day, weather
│   ├── dashboard.html              # Bird Flow — live pipeline visualization
│   ├── today.html                 # Today's detections with audio filters
│   ├── calendar.html              # Monthly calendar with new/rare species badges + popover
│   ├── timeline.html              # Full-page timeline with drag-to-zoom
│   ├── detections.html            # Filterable detection table
│   ├── review.html                # Detection review + bulk actions
│   ├── species.html               # Species cards + favorites + notes
│   ├── gallery.html               # Redirect → recordings.html
│   ├── favorites.html             # Favorites with stats + management
│   ├── weather.html               # Weather/activity correlation
│   ├── stats.html                 # Statistics + integrated Models tab
│   ├── analyses.html              # Per-species deep analysis
│   ├── biodiversity.html          # Shannon index, adaptive richness chart
│   ├── phenology.html             # Observed phenology calendar (per species)
│   ├── comparison.html            # Seasonal report (migratory arrivals, departures, evolution)
│   ├── compare.html               # Compare 2 species (disambiguation: identity, verdict, 24h, phenology, confidence)
│   ├── spectrogram.html           # Live spectrogram + clip playback
│   ├── settings.html              # Full settings (9 tabs)
│   ├── system.html                # System health + terminal
│   ├── liveboard.html              # Live Board — kiosk display mode
│   ├── log.html                   # Live log dashboard (SSE)
│   ├── recordings.html            # Audio library with photos
│   ├── rarities.html              # Rare species tracker
│   ├── recent.html                # Redirect to calendar.html
│   ├── models.html                # Redirect to stats.html?tab=models
│   ├── js/
│   │   ├── bird-config.js         # Navigation, API config
│   │   ├── bird-queries.js        # Shared SQL query library (38 queries)
│   │   ├── bird-icons.js          # Lucide icon set (98 SVG icons)
│   │   ├── bird-shared.js         # Utilities, DSP, favorites, notes API
│   │   ├── bird-vue-core.js       # Vue composables, i18n (4 langs), shell
│   │   ├── bird-spectro-modal.js # SpectroModal component (extracted)
│   │   ├── bird-timeline.js       # Timeline rendering (sky, stars, markers)
│   │   ├── vue.global.prod.min.js # Vue 3 (vendored)
│   │   ├── chart.umd.min.js      # Chart.js (vendored)
│   │   └── echarts.min.js        # ECharts (vendored)
│   ├── i18n/                      # Translation files (fr/en/de/nl.json)
│   ├── css/                       # Styles + 12 themes (see docs/THEMES.md)
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
│   ├── update.sh                  # Update: git pull, deps, migrations, health-check restart
│   ├── rollback.sh                # Rollback: git reset --hard, deps, restart
│   ├── bump.sh                    # Semver bump (patch/minor/major/auto)
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
- Centralized SQL query library (`bird-queries.js`) — 38 parameterized queries with automatic confidence filtering
- Lucide icon system (`bird-icons.js` + `<bird-icon>` component) — 100+ modern SVG icons, theme-aware form controls (`accent-color`)
- Security headers (CSP, X-Frame-Options, Referrer-Policy)
- CORS restricted to localhost
- Worker threads for heavy computation (event-loop non-blocking)
- Auto-download of species translation labels when missing (BirdNET GitHub fallback)

## Telemetry & Privacy

BirdStation has two independent telemetry layers:

**Anonymous usage pings** (opt-out) — enabled by default, disableable in Settings → Station:
- Sends a monthly ping with: `version`, `Pi model`, `OS`, `country`
- **No** GPS, UUID, station name, IP, or any personal data
- Install and update events also recorded (same anonymous data)
- Helps us track adoption and which platforms to prioritize
- Disable anytime in Settings → Station → "Anonymous usage statistics"

**Community network** (opt-in) — disabled by default:
- Registers your station on the [live map](https://ernens.github.io/birdash-network/) with GPS + station name
- Sends daily detection summaries (top species, rare species)
- Enable in Settings → Station → "Join the network"

Both layers use Supabase with a public anon key (write-only RLS). No data is collected until the service starts, and anonymous pings can be fully disabled.

## Community

- **[Live Station Map](https://ernens.github.io/birdash-network/)** — see all registered BirdStation installations worldwide
- **[Report a bug](https://github.com/ernens/birdash/issues)** — or use the in-app bug report button (red bug icon in header)
- **[Discussions](https://github.com/ernens/birdash/discussions)** — questions, ideas, show your setup

## License

[MIT](LICENSE)
