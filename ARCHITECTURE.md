# BirdStation Architecture

> [Français](ARCHITECTURE.fr.md) | [Deutsch](ARCHITECTURE.de.md) | [Nederlands](ARCHITECTURE.nl.md)

Deep technical reference for the BirdStation (birdash) system — a standalone bird detection dashboard and engine for Raspberry Pi.

---

## 1. System Overview

### High-Level Architecture

```
                          ┌─────────────────────────────────────────────┐
                          │              Raspberry Pi 5 + SSD           │
                          │                                             │
  USB Mic ──┐             │  ┌──────────────────────────────────────┐   │
            │             │  │        BirdEngine (Python)           │   │
            ▼             │  │                                      │   │
  ┌──────────────┐        │  │  record.sh (arecord → 45s WAV)      │   │
  │ ALSA dsnoop  │───WAV──│──│  engine.py:                         │   │
  │ (shared mic) │        │  │    ├─ Adaptive Gain                 │   │
  └──────────────┘        │  │    ├─ Highpass / Lowpass filters     │   │
                          │  │    ├─ Noise Profile / Auto Denoise  │   │
        ┌─────────────────│──│    ├─ RMS Normalize                 │   │
        │                 │  │    ├─ BirdNET V2.4  (~2s/file)      │   │
        │                 │  │    ├─ Perch V2 FP16 (~2s/file)      │   │
        │                 │  │    ├─ MP3 extraction + spectrograms │   │
        │                 │  │    ├─ BirdWeather upload             │   │
        │                 │  │    └─ ntfy.sh notifications          │   │
        │                 │  └──────────────┬───────────────────────┘   │
        │                 │                 │ INSERT INTO detections    │
        │                 │                 ▼                           │
        │                 │  ┌──────────────────────────────────────┐   │
        │                 │  │          SQLite (birds.db)           │   │
        │                 │  │  detections | daily_stats | ...      │   │
        │                 │  │  birdash.db → validations            │   │
        │                 │  │  taxonomy.db → species_taxonomy      │   │
        │                 │  └──────────────┬───────────────────────┘   │
        │                 │                 │ better-sqlite3            │
        │                 │                 ▼                           │
        │                 │  ┌──────────────────────────────────────┐   │
        │  PCM/MP3 stream │  │       Birdash (Node.js :7474)       │   │
        │  ◄──────────────│──│  HTTP API, SSE, worker threads      │   │
        │                 │  │  15 route modules, 11 lib modules   │   │
        │                 │  └──────────────┬───────────────────────┘   │
        │                 │                 │                           │
        │                 │  ┌──────────────┴───────────────────────┐   │
 Browser ◄────────────────│──│    Caddy (reverse proxy :80)         │   │
                          │  │    /birds/api/ → :7474               │   │
                          │  │    /birds/     → static files        │   │
                          │  │    /terminal/  → ttyd :7681          │   │
                          │  └──────────────────────────────────────┘   │
                          │                                             │
                          │  ┌──────────────────────────────────────┐   │
                          │  │    ttyd (web terminal :7681)         │   │
                          │  │    Full bash in browser              │   │
                          │  └──────────────────────────────────────┘   │
                          └─────────────────────────────────────────────┘
```

### Component Summary

| Component | Technology | Role |
|-----------|-----------|------|
| **BirdEngine** | Python 3 + TFLite | Audio recording, filtering, dual-model inference, post-processing |
| **Birdash** | Node.js 18+ + better-sqlite3 | REST API, SSE streaming, worker threads, pre-aggregation |
| **Frontend** | Vue 3 (vendored, no build step) | 19-page SPA-like dashboard with Chart.js |
| **Caddy** | Go reverse proxy | HTTPS termination, static files, proxying to API and ttyd |
| **ttyd** | C terminal emulator | Web-based shell access |
| **SQLite** | 3 databases | `birds.db` (detections), `birdash.db` (validations), `taxonomy.db` (eBird taxonomy) |

### Systemd Services

| Service | Unit | Description |
|---------|------|-------------|
| Recording | `birdengine-recording.service` | Continuous `arecord` capturing 45s WAV files |
| Engine | `birdengine.service` | Watchdog-based inference pipeline |
| Dashboard | `birdash.service` | Node.js API server on port 7474 |
| Terminal | `ttyd.service` | Web terminal on port 7681 |
| Proxy | `caddy.service` | Reverse proxy on port 80 |

All services use `KillMode=process` for clean shutdown.

---

## 2. Audio Processing Pipeline

### Full Pipeline

```
USB Mic
  │
  ▼
arecord (ALSA dsnoop)          engine/record.sh
  │  S16_LE, 48kHz, 45s
  ▼
WAV file → engine/audio/incoming/
  │
  ▼
┌─────────────────────────────────────────────────────┐
│                  engine.py                           │
│                                                     │
│  1. Read audio (resample to model rate if needed)   │
│  2. Adaptive Gain (from birdash API)                │
│  3. Highpass filter (Butterworth 4th order)          │
│  4. Lowpass filter (Butterworth 4th order)           │
│  5. Noise Profile subtraction  OR  Auto Denoise     │
│  6. RMS Normalize                                   │
│  7. Split into 3s overlapping chunks                │
│  8. ┌─ BirdNET V2.4 inference (primary)             │
│     └─ Perch V2 FP16 inference (secondary)          │
│  9. Merge results → INSERT INTO detections          │
│ 10. Async: MP3 extraction, spectrogram, BirdWeather │
└─────────────────────────────────────────────────────┘
```

### Pipeline Stages

#### 1. Recording (`engine/record.sh`)

Continuous recording via `arecord` using ALSA `dsnoop` (shared mic access). Configuration read from `config/audio_config.json`:

- **Device**: auto-detected USB audio interface (`device_id`)
- **Format**: S16_LE (16-bit signed little-endian)
- **Channels**: configurable (default 2, mono conversion in engine)
- **Sample rate**: configurable (default 48000 Hz)
- **Duration**: 45 seconds per file

#### 2. Adaptive Gain (`apply_adaptive_gain`)

Software gain based on ambient noise floor estimation. Fetched from the birdash API (`/api/audio/adaptive-gain`). Configuration in `config/adaptive_gain.json`:

- **Noise floor estimation**: running average of quiet periods
- **Clip guard**: prevents digital clipping from over-amplification
- **Activity hold**: maintains gain during bird vocalization
- **Observer mode**: monitors levels without applying gain (for calibration)
- **Apply mode**: actively adjusts gain in real-time

Returns `(gained_samples, gain_db)`. If disabled or in observer mode, returns samples unchanged.

#### 3. Highpass Filter

4th-order Butterworth highpass via `scipy.signal`. Removes low-frequency noise (traffic rumble, wind, HVAC).

- **Configurable**: `highpass_enabled`, `highpass_cutoff_hz` (50-300 Hz range)
- **Default cutoff**: 100 Hz

#### 4. Lowpass Filter

4th-order Butterworth lowpass via `scipy.signal`. Removes high-frequency noise above bird vocalization range.

- **Configurable**: `lowpass_enabled`, `lowpass_cutoff_hz` (4000-15000 Hz range)
- **Default cutoff**: 10000 Hz

#### 5. Noise Reduction (two modes, mutually exclusive)

**Noise Profile Subtraction** (preferred when configured):
- User records 5 seconds of ambient noise (highway, HVAC, etc.)
- Profile stored as `config/noise_profile.wav`
- Uses `noisereduce` library with `y_noise` parameter for targeted spectral subtraction
- `prop_decrease` controls strength (0.0-1.0, default 0.5)
- `stationary=True`, `n_fft=1024`, `hop_length=256`
- Falls back to auto-denoise on error

**Auto Denoise** (fallback):
- Stationary spectral gating via `noisereduce` without a reference noise profile
- Same FFT parameters, estimates noise profile from the signal itself

#### 6. RMS Normalization

Normalizes audio to a target RMS level for consistent model input.

- **Configurable**: `rms_normalize`, `rms_target` (default 0.05)
- Skipped if signal RMS is near zero (silence)

#### 7. Dual-Model Inference

Both models run on every file. Results are merged into `detections` with a `Model` column:

| Model | Size | Speed (Pi 5) | License |
|-------|------|-------------|---------|
| BirdNET V2.4 | ~50 MB | ~2s/file | CC-BY-NC-SA 4.0 |
| Perch V2 FP16 | 205 MB | ~2s/file | Apache 2.0 |

Model variants adapted to hardware: FP32 on Pi 5, FP16 on Pi 4, INT8 on Pi 3.

Audio is split into 3-second overlapping chunks (`split_signal`) before inference.

#### 8. Post-Processing (async, non-blocking)

- MP3 extraction of detection clips
- Spectrogram PNG generation
- SQLite INSERT of detections
- BirdWeather upload (if configured)
- ntfy.sh notifications for rare/new/favorite species

---

## 3. Backend Architecture (Node.js)

### server.js — HTTP Server

File: `server/server.js` (272 lines)

Plain `http.createServer` (no Express). Listens on `127.0.0.1:7474`, proxied by Caddy.

**Middleware chain** (applied to every request):
1. **Body size limit**: 1 MB max for POST requests
2. **Security headers**: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`
3. **CORS**: restricted to localhost by default (configurable via `BIRDASH_CORS_ORIGINS`)
4. **CSP**: Content-Security-Policy on non-API routes
5. **Rate limiting**: 300 requests/minute per IP (sliding window, 5-min bucket cleanup)
6. **Auth**: optional Bearer token via `BIRDASH_API_TOKEN` environment variable

**SQL validation** (for the `/api/query` endpoint):
- Only `SELECT`, `PRAGMA`, `WITH` statements allowed
- Forbidden: `DROP`, `DELETE`, `INSERT`, `UPDATE`, `CREATE`, `ALTER`, `ATTACH`, `DETACH`
- No semicolons (prevents statement chaining)
- Max 4000 characters

**Route delegation**: each route module exports a `handle(req, res, pathname, ctx)` function. The first module to return `true` claims the request.

### Route Files

Directory: `server/routes/`

| File | Purpose | Key Endpoints |
|------|---------|--------------|
| `audio.js` | Audio devices, adaptive gain, PCM/MP3 streaming, VU meters (SSE) | `/api/audio/devices`, `/api/audio/adaptive-gain`, `/api/audio/stream`, `/api/audio/vu` |
| `backup.js` | Backup configuration, scheduling, export | `/api/backup/config`, `/api/backup/run`, `/api/backup/history` |
| `bug-report.js` | In-app bug reporting via GitHub Issues API | `/api/bug-report` |
| `comparison.js` | Station comparison features | `/api/comparison/*` |
| `data.js` | Favorites, notes, photo preferences, raw SQL query | `/api/favorites`, `/api/notes`, `/api/photo-pref`, `/api/query` |
| `detections.js` | Detections CRUD, validations, auto-flagging, CSV/eBird export | `/api/detections`, `/api/validate`, `/api/flag`, `/api/export` |
| `external.js` | BirdWeather, eBird, weather API proxies | `/api/birdweather/*`, `/api/ebird/*`, `/api/weather` |
| `photos.js` | Photo resolution/caching (iNaturalist, Wikipedia), species name translation | `/api/photo`, `/api/species-names` |
| `settings.js` | Settings CRUD, Apprise notifications, alerts config, log streaming (SSE) | `/api/settings`, `/api/apprise`, `/api/alerts`, `/api/logs` |
| `system.js` | Service management, health metrics, hardware info, model management | `/api/services`, `/api/health`, `/api/models` |
| `telemetry.js` | Opt-in telemetry registration and status | `/api/telemetry/register`, `/api/telemetry/status` |
| `timeline.js` | Timeline data with SunCalc astronomy (sunrise/sunset/moon) | `/api/timeline` |
| `updates.js` | Update status checking, update execution | `/api/update-status`, `/api/update` |
| `whats-new.js` | Daily overview cards (delegates to worker thread) | `/api/whats-new` |

### Library Modules

Directory: `server/lib/`

| File | Purpose |
|------|---------|
| `aggregates.js` | Pre-aggregated statistics tables (daily, monthly, species, hourly). Full rebuild on startup, incremental refresh every 5 min. |
| `alerts.js` | Background alert monitoring (temperature, disk, service health). 60s check interval, 10-min cooldown per alert type. Multi-language alert messages. |
| `config.js` | `birdnet.conf` parser/writer, settings validators, `execCmd` helper, `ALLOWED_SERVICES` whitelist. |
| `db.js` | Database bootstrap: opens `birds.db` (read + write connections), `birdash.db`, `taxonomy.db`. Creates tables, indexes, views. Exports all DB handles. |
| `ebird-frequency.js` | eBird regional frequency data for rarity determination. Replaces naive "3 local observations" heuristic. |
| `local-date.js` | Locale-aware date string helper (`localDateStr()`). Used by aggregates for timezone-correct "today". |
| `result-cache.js` | In-memory TTL cache for expensive GET endpoints. `get(key)`, `set(key, data, ttl)`, `clearAll()` on any mutation. |
| `safe-config.js` | Mutex-protected read-modify-write for config files. Per-file Promise-chain locking, deep clone before mutation, validation, atomic write (tmp + rename). ETag support for optimistic concurrency (409 Conflict). |
| `telemetry.js` | Supabase telemetry: station registration (UUID, GPS, hardware), daily reports (top species, rare species), 6-hour heartbeat cycle. |
| `weekly-report.js` | Weekly summary generation (species, detections, highlights). Sent via Apprise. Checked hourly, fires on Sunday evening. |
| `whats-new-worker.js` | Worker thread script: runs 10 heavy SQLite queries in isolation. Computes alerts (out-of-season, activity spikes, species return), phenology (first-of-year, streaks, seasonal peaks), context (dawn chorus, acoustic quality, species richness, moon phase). |

### Worker Thread Architecture

The "What's New" feature uses Node.js `worker_threads` to avoid blocking the event loop:

```
Main Thread (server.js)                    Worker Thread (whats-new-worker.js)
     │                                          │
     │  new Worker(workerPath, {workerData})     │
     │──────────────────────────────────────────►│
     │                                          │
     │                                     Opens own DB connections
     │                                     (cannot share handles)
     │                                          │
     │                                     ATTACHes birdash.db
     │                                     Creates active_detections VIEW
     │                                          │
     │                                     Runs 10 heavy queries:
     │                                       - out_of_season
     │                                       - activity_spike
     │                                       - species_return
     │                                       - first_of_year
     │                                       - species_streak
     │                                       - seasonal_peak
     │                                       - dawn_chorus
     │                                       - acoustic_quality
     │                                       - species_richness
     │                                       - moon_phase
     │                                          │
     │  parentPort.postMessage({type:'result'})  │
     │◄──────────────────────────────────────────│
     │                                          │
     │  Cache result (5 min TTL)                │
     │  Proactive refresh timer                 │
```

The worker opens its own `better-sqlite3` connections (thread-safety requirement), creates the same `active_detections` VIEW, and communicates results via `postMessage`.

### Startup Sequence

1. Open database connections (`db.js`)
2. Start alert monitoring (`alerts.js`)
3. Refresh eBird taxonomy (if <1000 species cached)
4. Load eBird regional frequency data
5. Smart aggregate rebuild: full if empty/stale, `refreshToday()` otherwise
6. Start telemetry daily cron (if opted in)
7. Start weekly report hourly check
8. Listen on `127.0.0.1:7474`

---

## 4. Database Schema

### birds.db — Main Detection Database

Path: `~/birdash/data/birds.db`

Opened twice: `db` (readonly) for queries, `dbWrite` for mutations. Both use WAL mode with 5000ms busy timeout.

#### `detections` table

```sql
CREATE TABLE detections (
  Date       DATE,
  Time       TIME,
  Sci_Name   VARCHAR(100) NOT NULL,
  Com_Name   VARCHAR(100) NOT NULL,
  Confidence FLOAT,
  Lat        FLOAT,
  Lon        FLOAT,
  Cutoff     FLOAT,
  Week       INT,
  Sens       FLOAT,
  Overlap    FLOAT,
  File_Name  VARCHAR(100) NOT NULL,
  Model      VARCHAR(50)
);
```

Schema is compatible with BirdNET-Pi for migration. The `Model` column distinguishes BirdNET vs Perch detections.

#### Indexes on `detections`

```sql
CREATE INDEX idx_date_time ON detections(Date, Time DESC);
CREATE INDEX idx_com_name  ON detections(Com_Name);
CREATE INDEX idx_sci_name  ON detections(Sci_Name);
CREATE INDEX idx_date_com  ON detections(Date, Com_Name);
CREATE INDEX idx_date_conf ON detections(Date, Confidence);
```

#### `favorites` table

```sql
CREATE TABLE favorites (
  com_name  TEXT PRIMARY KEY,
  sci_name  TEXT,
  added_at  TEXT DEFAULT (datetime('now'))
);
```

#### `notes` table

```sql
CREATE TABLE notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  com_name   TEXT NOT NULL,
  sci_name   TEXT,
  date       TEXT,
  time       TEXT,
  note       TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
-- Indexes: idx_notes_species(com_name), idx_notes_date(com_name, date)
```

#### `photo_preferences` table

```sql
CREATE TABLE photo_preferences (
  sci_name      TEXT NOT NULL PRIMARY KEY,
  preferred_idx INTEGER DEFAULT 0,
  banned_urls   TEXT DEFAULT '[]',
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### Pre-Aggregated Statistics Tables

Created by `server/lib/aggregates.js`. Replace expensive `COUNT/GROUP BY` on 1M+ rows.

**`daily_stats`** — per species per day:
```sql
CREATE TABLE daily_stats (
  date       TEXT NOT NULL,
  sci_name   TEXT NOT NULL,
  com_name   TEXT NOT NULL,
  count      INTEGER DEFAULT 0,    -- all detections >= 0.5 confidence
  count_07   INTEGER DEFAULT 0,    -- detections >= 0.7 confidence
  avg_conf   REAL DEFAULT 0,
  max_conf   REAL DEFAULT 0,
  first_time TEXT,
  last_time  TEXT,
  PRIMARY KEY (date, sci_name)
);
-- Indexes: idx_ds_date(date), idx_ds_sci(sci_name)
```

**`monthly_stats`** — per species per month:
```sql
CREATE TABLE monthly_stats (
  year_month TEXT NOT NULL,          -- 'YYYY-MM'
  sci_name   TEXT NOT NULL,
  com_name   TEXT NOT NULL,
  count      INTEGER DEFAULT 0,
  count_07   INTEGER DEFAULT 0,
  avg_conf   REAL DEFAULT 0,
  day_count  INTEGER DEFAULT 0,     -- distinct days seen
  PRIMARY KEY (year_month, sci_name)
);
```

**`species_stats`** — lifetime per species:
```sql
CREATE TABLE species_stats (
  sci_name    TEXT PRIMARY KEY,
  com_name    TEXT NOT NULL,
  total_count INTEGER DEFAULT 0,
  count_07    INTEGER DEFAULT 0,
  first_date  TEXT,
  last_date   TEXT,
  avg_conf    REAL DEFAULT 0,
  day_count   INTEGER DEFAULT 0
);
```

**`hourly_stats`** — per species per hour per day:
```sql
CREATE TABLE hourly_stats (
  date     TEXT NOT NULL,
  hour     INTEGER NOT NULL,
  sci_name TEXT NOT NULL,
  com_name TEXT NOT NULL,
  count    INTEGER DEFAULT 0,
  count_07 INTEGER DEFAULT 0,
  max_conf REAL DEFAULT 0,
  PRIMARY KEY (date, hour, sci_name)
);
-- Index: idx_hs_date(date)
```

**Noise floor filter**: all aggregates use `WHERE Confidence >= 0.5` to exclude obvious junk. The `count_07` column provides the default-confidence count (>= 0.7) for user-facing totals.

**Refresh strategy**:
- **Startup**: full rebuild if tables empty or sentinel file `.rebuild-aggregates` exists; otherwise `refreshToday()` only (~200ms vs ~14s)
- **Periodic**: `refreshToday()` every 5 minutes (today + current month + affected species)
- **Midnight**: full rebuild when date changes (checked hourly)

### birdash.db — Validation Database

Path: `~/birdash/birdash.db`

Separate database to keep validation state independent from the detection data (which may come from BirdNET-Pi).

#### `validations` table

```sql
CREATE TABLE validations (
  date       TEXT,
  time       TEXT,
  sci_name   TEXT,
  status     TEXT DEFAULT 'unreviewed',   -- 'confirmed', 'rejected', 'unreviewed'
  notes      TEXT DEFAULT '',
  updated_at TEXT,
  PRIMARY KEY (date, time, sci_name)
);
```

### `active_detections` VIEW

Created as a `TEMP VIEW` by attaching `birdash.db` as `vdb`:

```sql
CREATE TEMP VIEW active_detections AS
  SELECT d.* FROM detections d
  WHERE NOT EXISTS (
    SELECT 1 FROM vdb.validations v
    WHERE v.date = d.Date AND v.time = d.Time
      AND v.sci_name = d.Sci_Name AND v.status = 'rejected'
  );
```

This VIEW is used by all aggregate queries and most display queries. When `birdash.db` is missing (fresh install, test environment), a pass-through fallback is created: `SELECT * FROM detections`.

**Design rationale**: raw `detections` table is used for full-table scans (statistics, exports). The VIEW is used for date-filtered queries where the `NOT EXISTS` cost is negligible.

### taxonomy.db — eBird Taxonomy

Path: `~/birdash/config/taxonomy.db`

#### `species_taxonomy` table

```sql
CREATE TABLE species_taxonomy (
  sci_name    TEXT PRIMARY KEY,
  order_name  TEXT,
  family_sci  TEXT,
  family_com  TEXT,
  ebird_code  TEXT,
  taxon_order REAL
);
-- Indexes: idx_tax_order(order_name), idx_tax_family(family_sci)
```

#### `family_translations` table

```sql
CREATE TABLE family_translations (
  family_sci TEXT NOT NULL,
  locale     TEXT NOT NULL,
  family_com TEXT,
  PRIMARY KEY (family_sci, locale)
);
```

Populated from eBird CSV taxonomy (~16,000 species). Cached locally at `config/ebird-taxonomy.csv` (30-day TTL). Includes synonym mapping for BirdNET names that differ from eBird taxonomy.

---

## 5. Frontend Architecture (Vue 3)

### No Build Step

The frontend uses **vendored** Vue 3 and Chart.js loaded directly in the browser. No webpack, Vite, or any bundler. Each page is a standalone `.html` file that loads shared modules via `<script>` tags.

```
public/
├── js/
│   ├── vue.global.prod.min.js       # Vue 3 runtime (vendored)
│   ├── chart.umd.min.js             # Chart.js (vendored)
│   ├── bird-config.js               # Navigation, API config, defaults
│   ├── bird-shared.js               # Utilities, DSP, favorites, notes API
│   ├── bird-queries.js              # 38 parameterized SQL queries
│   ├── bird-icons.js                # 98 Lucide SVG icons + <bird-icon> component
│   ├── bird-vue-core.js             # Vue composables, i18n, shell component
│   └── bird-timeline.js             # Timeline rendering (sky, stars, markers)
├── i18n/                            # Translation files
│   ├── en.json
│   ├── fr.json
│   ├── de.json
│   └── nl.json
├── css/                             # Stylesheets + 11 theme files
├── settings/                        # Lazy-loaded settings tab fragments
└── sw.js                            # Service Worker (offline cache)
```

### Shared Modules

**`bird-config.js`** — Central configuration:
- API URL construction (relative paths, proxied by Caddy)
- Default analysis parameters (confidence 0.7, rarity threshold, page size)
- Location defaults (overridable via `birdash-local.js`)
- Navigation structure: 6 sections (Home, Live, History, Species, Indicators, Station)
- Chart.js color palette

**`bird-shared.js`** — Utility library:
- API fetch helpers
- DSP functions for audio visualization
- Favorites and notes CRUD
- Date/time formatting
- Species name utilities

**`bird-queries.js`** — Centralized SQL query library:
- 38 parameterized queries
- Automatic confidence filtering
- Used by all pages for data fetching via `/api/query`

**`bird-icons.js`** — Icon system:
- 98 Lucide SVG icons
- `<bird-icon>` Vue component for declarative usage
- Replaces emoji throughout the UI

**`bird-vue-core.js`** — Vue infrastructure:
- Composables for common patterns
- i18n system (4 UI languages)
- Shell component (`birdash-shell`)

**`bird-timeline.js`** — Timeline visualization:
- Sky gradient rendering
- Star field generation
- Detection marker placement
- Sunrise/sunset/moon overlays

### Shell Component (`birdash-shell`)

The shell wraps every page and provides:

- **Navigation**: 6 intent-based sections in sidebar, mobile bottom nav (4 quick links + hamburger drawer)
- **Global search**: species + date search across all data
- **Notification bell**: review badge counter
- **Update banner**: red banner when new version available (click to view release notes)
- **Bug report button**: red bug icon in header, submits to GitHub Issues
- **Spectrogram modal**: full-screen spectrogram viewer with gain/highpass/lowpass filters, loop selection
- **Theme switcher**: mini page previews, smooth cross-fade

### Pages (19 + redirects)

| Page | File | Section |
|------|------|---------|
| Overview | `overview.html` | Home |
| Today | `today.html` | Home |
| Bird Flow | `dashboard.html` | Live |
| Spectrogram | `spectrogram.html` | Live |
| Live Log | `log.html` | Live |
| Calendar | `calendar.html` | History |
| Timeline | `timeline.html` | History |
| Detections | `detections.html` | History |
| Review | `review.html` | History |
| Species | `species.html` | Species |
| Rarities | `rarities.html` | Species |
| Gallery | `gallery.html` | Species |
| Recordings | `recordings.html` | Species |
| Favorites | `favorites.html` | Species |
| Weather | `weather.html` | Indicators |
| Statistics | `stats.html` | Indicators |
| Analyses | `analyses.html` | Indicators |
| Biodiversity | `biodiversity.html` | Indicators |
| Phenology | `phenology.html` | Indicators |
| Comparison | `comparison.html` | Indicators |
| Settings | `settings.html` | Station |
| System | `system.html` | Station |

Redirects: `index.html` -> `overview.html`, `recent.html` -> `calendar.html`, `models.html` -> `stats.html?tab=models`

### Internationalization (i18n)

- **4 UI languages**: French, English, German, Dutch (`public/i18n/*.json`)
- **36 species name languages**: bird names displayed in user's chosen language across all pages
- **Auto-download**: if BirdNET label files (`l18n/labels_XX.json`) are missing, `/api/species-names` auto-downloads from the BirdNET-Analyzer GitHub repo and caches locally
- Default language: French (`defaultLang: 'fr'` in `bird-config.js`)

### Themes (11)

7 dark themes: Forest, Night, Ocean, Dusk, Solar Dark, Nord, High Contrast AAA
3 light themes: Paper, Sepia, Solar Light
1 auto mode: follows OS `prefers-color-scheme`

Token-driven design system documented in `docs/THEMES.md`.

---

## 6. Performance Architecture

### Problem Statement

The primary database can contain 1M+ detection rows. Naive `COUNT/GROUP BY` queries take seconds and block the Node.js event loop (better-sqlite3 is synchronous).

### Strategy Overview

```
┌──────────────────────────────────────────────────────────┐
│                  Performance Layers                       │
│                                                          │
│  1. Worker Thread        → whats-new off main thread     │
│  2. Pre-aggregated tables → daily/monthly/species/hourly │
│  3. Result cache          → cleared on mutations         │
│  4. Proactive refresh     → 5-min timer for aggregates   │
│  5. VIEW strategy         → raw vs active_detections     │
│  6. Vendored JS           → no CDN latency               │
└──────────────────────────────────────────────────────────┘
```

### Worker Thread for Whats-New

The Overview page's "What's New" section runs 10 heavy queries. These are offloaded to `whats-new-worker.js` in a `worker_threads` Worker so the main event loop stays responsive. The worker opens its own DB connections, computes all cards, and sends the result back via `postMessage`.

### Proactive Cache (5-min Refresh Timer)

`aggregates.js` runs `refreshToday()` every 5 minutes. This incrementally updates today's `daily_stats`, current month's `monthly_stats`, affected `species_stats`, and today's `hourly_stats`. Cost: ~200ms (vs ~14s for full rebuild).

### Result Cache (Cleared on Mutations)

`result-cache.js` provides an in-memory key-value cache with TTL:

```javascript
resultCache.set('whats-new', data, 5 * 60 * 1000);  // 5 min TTL
resultCache.clearAll();  // after any mutation (delete, validate, etc.)
```

Every mutation handler calls `clearAll()` to prevent stale data.

### Pre-Aggregated Statistics Tables

Four materialized tables replace expensive live queries:

| Table | Grain | Key Use Cases |
|-------|-------|--------------|
| `daily_stats` | species/day | Calendar, today's species, overview KPIs |
| `monthly_stats` | species/month | Statistics, year-over-year comparison |
| `species_stats` | species/lifetime | Species cards, rankings, records |
| `hourly_stats` | species/hour/day | Hourly activity charts, timeline density |

Each table has both `count` (>= 0.5 confidence) and `count_07` (>= 0.7 confidence) columns. Downstream queries use `count_07` for user-facing totals.

### Raw Table vs VIEW Strategy

- **`detections` (raw table)**: used for full-table scans (statistics, exports, aggregation rebuilds) where the `NOT EXISTS` overhead on every row is wasteful
- **`active_detections` (VIEW)**: used for date-filtered queries (today, calendar, timeline) where the small number of rows makes the `NOT EXISTS` check negligible

### Startup Optimization

Full aggregate rebuild (~14s on 1M rows) blocks the event loop. Smart startup logic:
- If aggregate tables are empty or sentinel file exists: full rebuild (migration, first boot)
- Otherwise: `refreshToday()` only (~200ms), no event-loop block
- Sentinel file `config/.rebuild-aggregates` created by migrations that alter schema

### Vendored JavaScript

Vue 3 and Chart.js are vendored locally in `public/js/`. No CDN requests means:
- Zero external latency on page load
- Works offline (with Service Worker)
- No dependency on third-party availability

---

## 7. Community Network

### Architecture

```
BirdStation A ──┐
BirdStation B ──┼──► Supabase (PostgreSQL) ──► GitHub Pages (live map)
BirdStation C ──┘         │
                          ├── stations table (registration)
                          └── daily_reports table (summaries)
```

### Supabase Telemetry (Opt-In)

File: `server/lib/telemetry.js`

Fully opt-in. Nothing is sent until the user explicitly enables it from Settings.

**Registration** (`/api/telemetry/register`):
- Generates a UUID (`crypto.randomUUID()`)
- Sends: station name, GPS, hardware model, OS, version, country (reverse geocoded via Nominatim)
- Upserts into Supabase `stations` table

**Daily Reports** (automatic, every 6 hours):
- Yesterday's detection count and species count
- Top 10 species
- Rare species (<=3 detections, only after 30+ days of data)
- Station heartbeat with version, hardware, total stats
- Upserts into Supabase `daily_reports` table

**Security**: uses Supabase public anon key with RLS (row-level security). Insert-only from client perspective.

### Live Station Map

Hosted on GitHub Pages at `https://ernens.github.io/birdash-network/`. Reads the Supabase `stations` table to display all registered stations on an interactive dark-themed map.

### Bug Reporting

File: `server/routes/bug-report.js`

Users can submit bugs directly from the dashboard header (red bug icon). The report is created as a GitHub Issue via the GitHub Issues API, using a built-in fine-grained PAT (Issues:Write only).

Features:
- Title + description form in a modal
- System info auto-collected (version, browser, page, screen, lang, theme)
- **"Attach recent logs" checkbox** — fetches `/api/system/logs-export` (last hour of journalctl from birdash, birdengine, birdengine-recording) and includes in the issue body as a collapsible `<details>` block (truncated to 5KB)
- System info + logs in collapsible sections to keep the issue body clean

---

## 8. Update System

### Version Scheme

Versions are computed from git: `git describe --tags --always`. Example: tag `v1.5.0` + 48 commits = `v1.5.48`.

### Update Detection

Endpoint: `/api/update-status`

Compares `git rev-parse HEAD` against `git ls-remote origin main`. Result cached for 1 minute.

### In-App Update Flow

1. Red banner appears on every page when a new version is available (e.g., `v1.5.30 -> v1.5.48`)
2. Click **View** to see categorized release notes in a modal
3. Three options:
   - **Install now**: runs `scripts/update.sh`, shows progress
   - **Later (24h)**: snoozes banner
   - **Skip these updates**: hides until a newer version exists
4. Snooze state stored server-side in `config/update-state.json` (persistent across browsers)

### update.sh Script

Path: `scripts/update.sh`

Execution steps:
1. `git pull origin main`
2. Run migrations from `scripts/migrations/` (idempotent)
3. `npm install` (if `package.json` changed)
4. Selective service restart (`systemctl restart birdash`, engine if needed)

### Migrations System

Path: `scripts/migrations/`

Numbered shell scripts run in order after each `git pull`:

| Migration | Purpose |
|-----------|---------|
| `001-asoundrc-dsnoop-plug.sh` | ALSA dsnoop configuration |
| `002-birdash-killmode-process.sh` | Systemd KillMode fix |
| `003-normalize-model-names.sh` | Normalize Model column values |
| `004-daily-stats-filtered-count.sh` | Add `count_07` column to aggregates |
| `005-hourly-stats-rebuild.sh` | Add `hourly_stats` table |
| `006-caddy-api-timeout.sh` | Increase Caddy API timeout |

Each migration is idempotent (safe to re-run). Migration `004` creates the `.rebuild-aggregates` sentinel to force a full aggregate rebuild on next startup.

---

## 9. Configuration Files

All configuration files live in `~/birdash/config/` unless otherwise noted.

### birdnet.conf

Path: varies (parsed by `server/lib/config.js`)

BirdNET-Pi compatible configuration. Key parameters:
- `LATITUDE`, `LONGITUDE` — station GPS coordinates
- `MODEL` — detection model path
- `CONFIDENCE` — minimum confidence threshold
- Parsed and written by `parseBirdnetConf()` / `writeBirdnetConf()`

### audio_config.json

Path: `config/audio_config.json`

Audio device and filter configuration:

```json
{
  "device_id": "plughw:CARD=Micro,DEV=0",
  "input_channels": 2,
  "capture_sample_rate": 48000,
  "highpass_enabled": true,
  "highpass_cutoff_hz": 100,
  "lowpass_enabled": true,
  "lowpass_cutoff_hz": 10000,
  "denoise_enabled": false,
  "denoise_strength": 0.5,
  "noise_profile_enabled": false,
  "noise_profile_path": "config/noise_profile.wav",
  "rms_normalize": false,
  "rms_target": 0.05
}
```

### audio_profiles.json

Path: `config/audio_profiles.json`

6 built-in environment profiles + custom profiles. Each profile pre-sets filter parameters for a specific environment:

| Profile | Use Case |
|---------|----------|
| Garden | Default suburban setup |
| Forest | Quiet woodland, minimal filtering |
| Roadside | Heavy highpass to cut traffic |
| Urban | Aggressive filtering for city noise |
| Night | Optimized for nocturnal species |
| Test | All filters disabled for debugging |

### adaptive_gain.json

Path: `config/adaptive_gain.json`

Adaptive software gain configuration:
- Noise floor estimation parameters
- Clip guard threshold
- Activity hold duration
- Observer vs apply mode toggle

### detection_rules.json

Path: `config/detection_rules.json`

Auto-flagging rules for the Review page:
- Nocturnal birds detected during daytime
- Out-of-season migrants (species-month mapping)
- Low-confidence isolated detections
- Non-European species (geographic filtering)

### telemetry.json

Path: `config/telemetry.json`

Telemetry opt-in state:

```json
{
  "enabled": false,
  "stationId": null,
  "stationName": "",
  "optInDate": null
}
```

### birdash-local.js

Path: `config/birdash-local.example.js` (template)
Runtime: `public/js/birdash-local.js` (not versioned)

Local overrides for `bird-config.js`:
- `apiToken` — Bearer token for write API access
- `defaultConfidence` — override default confidence threshold
- `rarityThreshold` — override rarity detection threshold
- `location` — GPS coordinates, region, country
- `siteName` — custom station name in header
- `ebirdApiKey` — eBird API key
- `birdweatherStationId` — BirdWeather station ID

Loaded both server-side (by `db.js` via `require()`) and client-side (as global `BIRDASH_LOCAL` before `bird-config.js`).

### Other Configuration Files

| File | Purpose |
|------|---------|
| `config/apprise.txt` | Notification URLs for Apprise (ntfy.sh, Pushover, etc.) |
| `config/backup.json` | Backup target configuration (NFS/SMB/SFTP/S3/GDrive/WebDAV) |
| `config/stations.json` | Multi-station comparison configuration |
| `config/ebird-frequency.json` | Cached eBird regional frequency data |
| `config/weekly-reports.json` | Weekly report tracking state |
| `config/noise_profile.wav` | Recorded ambient noise for spectral subtraction |
| `engine/config.toml` | Engine-specific TOML configuration |
