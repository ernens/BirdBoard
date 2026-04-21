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
        │                 │  │    ├─ BirdNET V2.4  (~1.5s/file)    │   │
        │                 │  │    ├─ Perch V2 (~0.7s on Pi 5)      │   │
        │                 │  │    ├─ MP3 extraction + spectrograms │   │
        │                 │  │    └─ BirdWeather upload             │   │
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
        │                 │  │  Notification watcher → Apprise     │   │
        │                 │  │  MQTT publisher → broker (HA-ready) │   │
        │                 │  │  Prometheus /metrics scrape target  │   │
        │                 │  │  Cookie auth (off/protected/public) │   │
        │                 │  │  17 route modules, 15 lib modules   │   │
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
│     └─ Perch V2 inference (secondary, variant per Pi)│
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
| BirdNET V2.4 | ~50 MB | ~1.5s/file | CC-BY-NC-SA 4.0 |
| Perch V2 (FP32/FP16/INT8) | 105-409 MB | 0.3-0.8s/file | Apache 2.0 |

Model variants adapted to hardware: FP32 on Pi 5, FP16 on Pi 4, INT8 on Pi 3.

Audio is split into 3-second overlapping chunks for BirdNET and 5-second chunks for Perch (`split_signal`).

**Cross-confirmation.** Perch's softmax mis-fires on low-frequency ambient noise (wind, vehicle rumble) which it maps to large birds (geese, herons, ravens). To kill this class of false positive without losing Perch-only strengths, `dual_confirm_enabled=true` requires:

- **Perch score ≥ `perch_standalone_confidence`** (default 0.85) — accepted alone, or
- **BirdNET raw score ≥ `birdnet_echo_confidence`** (default 0.15) for the same `sci_name` on any 3 s chunk overlapping the Perch 5 s chunk by ≥ 1 s.

BirdNET detections are never filtered by this rule. The echo uses BirdNET's **raw per-chunk predictions** (top-20, pre-threshold) — so a weak 0.15 echo is enough to confirm a Perch hit between 0.50 and 0.85. All three thresholds are adjustable in the Settings → Detection UI.

Also: opt-in **eBird range filter for Perch** (`RANGE_FILTER_PERCH_EBIRD=1`) drops species absent from `config/ebird-frequency.json` (Perch has no MData equivalent for geographic filtering).

#### 8. Post-Processing (async, non-blocking)

- MP3 extraction of detection clips
- Spectrogram PNG generation
- SQLite INSERT of detections
- BirdWeather upload (if configured)

> **Note:** Notifications are no longer in the engine. They are handled by the Node.js notification watcher (see below).

---

### Push Notifications (notification-watcher.js)

File: `server/lib/notification-watcher.js`

Polls the detections DB every 30 seconds and sends push notifications via **Apprise** (100+ services: ntfy, Telegram, Discord, Slack, email, etc.) with species photo attached.

**5 configurable rules** (same toggles in Settings → Notifications):

| Rule | Trigger | Priority |
|------|---------|----------|
| Rare species | Total count ≤ threshold | High |
| First of season | Absent ≥ N days | High |
| New species ever | First all-time detection | Urgent |
| First of the day | Each new species today | Low |
| Favorite species | Favorite detected (first of day) | Normal |

- 5-minute cooldown per species
- Species count + last-seen cache loaded from DB at startup
- Favorites loaded from birdash.db
- Species photo downloaded from `/api/photo` and attached via `--attach`
- Station name prefix in title: `[Heinsch] Merle noir — Première du jour` (from SITE_NAME, falls back to hostname)
- Reads config from birdnet.conf (same toggles as UI)

---

### MQTT Publisher (mqtt-publisher.js)

File: `server/lib/mqtt-publisher.js`

Opt-in publisher (`MQTT_ENABLED=1` in `birdnet.conf`) that pushes each new detection to an MQTT broker. Aimed primarily at the Home Assistant / Node-RED / domotic crowd. Same poll-the-DB pattern as the notification watcher (15s interval, no engine changes required).

**Topics** (configurable prefix, default `birdash`, station slug derived from `SITE_NAME`):

| Topic | Retention | Payload | Purpose |
|-------|-----------|---------|---------|
| `<prefix>/<station>/status` | retained, LWT | `online` / `offline` | Home Assistant availability tracking |
| `<prefix>/<station>/detection` | configurable | JSON per detection | Per-event automations |
| `<prefix>/<station>/last_species` | retained | JSON of latest detection | Ready-to-use HA sensor |
| `<prefix>/<station>/test` | non-retained | JSON test payload | Triggered by `POST /api/mqtt/test` |
| `homeassistant/sensor/birdash_<station>/...` | retained | HA discovery JSON | If `MQTT_HASS_DISCOVERY=1` |

**Detection payload**:
```json
{
  "station": "Heinsch",
  "timestamp": "2026-04-20T13:31:04",
  "common_name": "Moineau domestique",
  "scientific_name": "Passer domesticus",
  "confidence": 0.8075,
  "model": "perch_v2_original",
  "file": "Moineau_domestique-81-...mp3"
}
```

**Connection management**:
- Reconnect with exponential backoff (2s → 60s, capped)
- Transport-affecting setting changes (`broker`, `port`, `username`, `password`, `tls`) trigger a clean disconnect + reconnect on the next poll tick
- LWT publishes `offline` to `status` if the TCP connection drops without a clean disconnect
- Graceful shutdown publishes `offline` explicitly

**Home Assistant auto-discovery** publishes two sensors per station under a single device:
- `Last species` — value template extracts `common_name` from the retained `last_species` topic; full payload available as JSON attributes
- `Last confidence` — value template multiplies confidence by 100, unit `%`

The Test button in Settings → Notifications calls `POST /api/mqtt/test`, which connects with a one-shot client, publishes a synthetic message to `<prefix>/<station>/test`, and reports the broker result back to the UI without leaving a long-lived connection behind.

### Authentication (auth.js)

File: `server/lib/auth.js` + `server/routes/auth.js` + `public/login.html`

Opt-in, single-user. Three modes set via `AUTH_MODE` in `birdnet.conf`:

| Mode | Behaviour |
|------|-----------|
| `off` (default) | No authentication. LAN-trust. `BIRDASH_API_TOKEN` Bearer still works for write endpoints (back-compat). |
| `protected` | Every API call (except `/api/auth/{login,logout,status}`) requires a valid session cookie OR Bearer token. Static files stay public; the front-end redirects to `/login.html` on 401. |
| `public-read` | GET endpoints are public except a small sensitive allowlist (`/api/settings`, `/api/logs`, `/api/apprise`, `/api/alert-*`, `/api/backup*`, `/api/audio/{devices,profiles}`). All `POST`/`DELETE` require auth. **The "show your station to friends" mode.** |

**Cookie format**: `base64url(JSON({user, exp})) "." base64url(HMAC-SHA256)`.

- Cookie name: `birdash_session`, `Path=/`, `HttpOnly`, `SameSite=Lax`, `Max-Age = AUTH_SESSION_HOURS * 3600` (default 168 = 7 days)
- `AUTH_SECRET` (32 random hex bytes) is auto-generated on first use and persisted to `birdnet.conf`. Rotate it to invalidate every existing cookie at once.
- Verification is constant-time (`crypto.timingSafeEqual`).

**Why HMAC cookies and not a sessions table**:
- One user, no multi-device session management to write
- No DB migration, no cleanup cron
- Revocation = rotate the secret

**Why the gate is synchronous**:
The HTTP request handler attaches a body-size limiter via `req.on('data')` at the top of every request. Inserting an `await` between that listener and the route handler's own `data` listener loses POST body chunks (the size limiter has already consumed them by the time the route attaches its listener). So `auth.js` keeps an in-memory `_cachedConfig` mirror of the AUTH_* settings — refreshed on startup and after every settings POST that touches an AUTH_* key — and the gate is fully synchronous. Cookie HMAC verify is sync (no IO); only password verification (bcrypt) is async, and that's only inside the `/login` route.

**Brute-force protection**:
- 5 login attempts per IP per 60 s window (in-memory map, periodic cleanup at 5000 entries)
- Successful login resets the counter
- Constant-time username comparison so a wrong username can't be distinguished from a wrong password

**Bearer compatibility**:
The pre-existing `BIRDASH_API_TOKEN` env var still works. When the gate sees `Authorization: Bearer <token>` and the token matches, it sets `req.user = '__bearer__'` so the request proceeds. This means cron/scripted automation keeps working unchanged when you turn on AUTH_MODE.

**Front-end integration**:
- `public/login.html` — sober Vue page using the active theme tokens, station-aware branding (SITE_NAME / SITE_BRAND), redirect-back via `?redirect=...`, falls back to `overview.html`
- Header pill in `bird-vue-core.js` shell — green "user-check + username + logout" when signed in, gray "eye + visitor" + login button otherwise. Hidden entirely when `AUTH_MODE=off`.
- Global `fetch` interceptor wraps `window.fetch` and redirects to `/login.html?redirect=<current>` on any 401 from a non-auth endpoint.

### Prometheus Metrics (metrics.js)

File: `server/lib/metrics.js` + `server/routes/metrics.js`

Standard Prometheus exposition format on `GET /metrics` (and `/api/metrics` for consistency with the rest of birdash). Built on `prom-client`; no auth (the server already binds to `127.0.0.1`, gate via Caddy if exposing publicly).

**Custom gauges**:
- `birdash_detections_total` / `_today` / `_last_hour`
- `birdash_species_today` / `_30d`
- `birdash_last_detection_age_seconds` (alert when station goes silent)
- `birdash_db_size_bytes`
- `birdash_cpu_temp_celsius` / `_usage_percent`
- `birdash_memory_used_bytes` / `_total_bytes`
- `birdash_disk_used_bytes` / `_total_bytes`
- `birdash_fan_rpm`
- `birdash_system_uptime_seconds`
- `birdash_feature_enabled{feature="mqtt|notifications|dual_model|birdweather|weekly_digest"}`
- `birdash_version_info{version="x.y.z"}` (always 1 — useful for `count by (version)`)
- `birdash_sound_leq_dbfs` / `_peak_dbfs` / `_leq_1h_avg_dbfs` / `_last_reading_age_seconds` — per-chunk acoustic telemetry, dBFS, uncalibrated (trend-tracking; see "Sound-level monitor" below)

**Default Node.js process metrics** (eventloop lag, GC, heap, RSS, file descriptors, …) under the `birdash_node_` prefix from `prom-client`'s `collectDefaultMetrics`.

**Refresh strategy**: gauges are refreshed lazily on each scrape rather than via a background timer. The DB refresh runs ~5 indexed `COUNT()` aggregates against a 1M-row table — sub-millisecond — and the system reads (`/proc/meminfo`, `/proc/loadavg`, `df`, thermal zone) cost a few hundred microseconds. Total scrape latency stays well under 50 ms even on Pi 3, so the standard 30-60s Prometheus scrape interval is fine.

**Suggested Prometheus scrape config**:
```yaml
scrape_configs:
  - job_name: birdash
    static_configs:
      - targets: ['bird.local:80']
    metrics_path: /birds/metrics
    scrape_interval: 30s
```

### Sound-level monitor

The Python engine writes one reading per processed WAV into `config/sound_level.json` via `compute_sound_level()` + `record_sound_level()` helpers in `engine.py`. Values are computed on the *raw* signal before adaptive gain / filters, so the metric reflects the microphone's actual capture, not the post-processed chain.

Schema:
```json
{
  "current": { "ts": 1776697630.75, "leq": -38.7, "peak": -27.3, "dur": 45.0, "file": "…wav" },
  "buffer":  [ { "ts": …, "leq": …, "peak": …, "dur": … }, … up to 120 entries ]
}
```

Writes use atomic replace (`…tmp` + `os.replace`) so Node never sees a partial read.

- **Prometheus**: `server/lib/metrics.js` reads the JSON on each scrape, publishes 4 gauges incl. an energy-average 1 h Leq (`10·log10(mean(10^(leq/10)))` over entries ≥ cutoff).
- **API**: `GET /api/sound-level` returns `{available, current, avg_1h_dbfs, age_seconds, buffer}` for UI widgets.
- **UI**: Settings → Audio shows a live card (Leq, peak, 1 h avg, 60-point sparkline, age indicator) refreshed every 5 s while the tab is active.

Values are **dBFS, not SPL** — they track relative loudness trends, not calibrated pressure levels. A calibrated reference would require a known source + a per-mic correction offset, which birdash intentionally doesn't attempt.

### Weather subsystem

Per-detection weather context is provided by the `weather-watcher` background worker (`server/lib/weather-watcher.js`) and surfaced through 6 endpoints + a global Vue chip component. The whole pipeline is JOIN-at-query-time: weather snapshots live in `birdash.db` (not BirdNET-Pi's `birds.db`), keyed by `(date, hour)` — never denormalized into individual detection rows. Storage overhead is ~22 K rows for 2.5 years vs ~1 M detections (~0.02 %). If Open-Meteo backfills or corrects values, all detections pick up the change automatically.

**Source**: [Open-Meteo](https://open-meteo.com/) — free for non-commercial use, no API key, no rate-limit headaches at our usage (~24 forecast requests/day, 1 archive call at startup).

**Schema** (in `birdash.db`):

```sql
CREATE TABLE weather_hourly (
  date          TEXT NOT NULL,         -- YYYY-MM-DD (local time)
  hour          INTEGER NOT NULL,       -- 0..23 (local time)
  temp_c        REAL,                   -- temperature 2 m
  humidity_pct  REAL,
  wind_kmh      REAL,
  wind_dir_deg  INTEGER,
  precip_mm     REAL,
  cloud_pct     REAL,
  pressure_hpa  REAL,
  weather_code  INTEGER,                -- WMO code (0=clear, 95-99=storm, etc.)
  fetched_at    INTEGER NOT NULL,       -- epoch seconds
  PRIMARY KEY(date, hour)
);
```

The `(date, hour)` PK doubles as the join index — each lookup is `O(log 22 K)` ≈ 15 comparisons.

**Worker lifecycle** (`weather-watcher.js`):

1. **On start**: forecast API call with `past_days=7` to refresh the recent week.
2. **On start (async, +5 s)**: archive backfill — checks the oldest detection in `birds.db` vs the oldest snapshot in `weather_hourly`; if there's a gap, fetches `archive-api.open-meteo.com/v1/archive` chunked 1 year per request with a 500 ms politeness pause between chunks. Result on bird.local: 22 728 snapshots covering 2023-09-18 → 2026-04-21 in 3 calls.
3. **Every hour**: forecast API call with `past_days=2` to UPSERT recent hours (also catches Open-Meteo's own backfill corrections).

Silent skip when `LATITUDE` / `LONGITUDE` are missing from `birdnet.conf`, or the API is unreachable — detections still flow, weather chips just won't render until the next successful poll.

**The standard JOIN clause** (used by every analytics endpoint):

```sql
JOIN vdb.weather_hourly w
  ON w.date = d.Date
 AND w.hour = CAST(SUBSTR(d.Time, 1, 2) AS INT)
```

`vdb` is the `birdash.db` connection ATTACHed onto the read-only `birds.db` connection at startup (same mechanism as the `active_detections` view).

**API endpoints** (all in `server/routes/external.js`):

| Endpoint | Purpose | Used by |
|----------|---------|---------|
| `GET /api/weather` | Daily aggregates (max/min temp, precip, wind) for the chart on weather.html | weather page 30-day chart (legacy) |
| `GET /api/weather/at?date=&time=` | Single hourly snapshot for one detection | spectro modal |
| `GET /api/weather/range?from=&to=` | All hourly snapshots in a date range | weather chips on detection-list pages |
| `GET /api/weather/condition-summary?conf=` | Counts per WMO category (clear/cloudy/rain/etc.) | (analytics, optional) |
| `GET /api/weather/species-by-condition?temp_min/max=&codes=&precip_min/max=&wind_min/max=&hour_min/max=&date_from/to=&conf=&limit=` | Top species matching arbitrary AND-combined weather predicates | leaderboards + custom-search card |
| `GET /api/weather/species-heatmap?top=30&bin_size=5&bin_min=-15&bin_max=35` | Cross-tab matrix (species × temp bins) | heatmap card |
| `GET /api/weather/species-profile?species=` | Per-species condition + temp distribution + summary stats | species page weather profile |
| `GET /api/weather/match-summary?…` | Same filter shape as species-by-condition, returns just `{detections, species}` totals | live counter on custom-search card |

A shared `parseWeatherFilters(params)` helper inside `external.js` keeps `species-by-condition` and `match-summary` in sync — adding a new filter dimension means one change in the helper, both endpoints get it.

**Frontend integration** (`public/js/bird-weather-chip.js`):

- **Cache**: `BIRDASH.weatherCache` (Map keyed by `${date}|${hour}`) populated via `BIRDASH.loadWeatherRange(from, to)`. 5-min TTL per range key + request deduplication (a second call for the same range while the first is in flight returns the same promise).
- **Component**: `<weather-chip :date :time :detailed>` reads from the cache, renders nothing if the lookup misses (silent degradation, not a fallback fetch). Pass `:detailed="true"` for a chip with precip + wind in addition to icon + temp. Registered globally via a monkey-patched `BIRDASH.registerComponents`.
- **Pages with chips**: today, overview (detailed), recordings, rarities, review, favorites — each calls `BIRDASH.loadWeatherRange(...)` once with its visible date range so a list of N detections costs 1 round-trip, not N.

**Custom-search card** (weather.html, phase B): 6 filter rows (temp/precip/wind/hour ranges + WMO conditions checkboxes + date range), each with its own on/off toggle so empty filters mean "no constraint" (no magic-default surprise). 4 quick presets (Hard freeze / Sustained rain / Clear dawn / Rain-storm). Live update with 300 ms debounce + sequence-number race protection. URL-params persistence via `history.replaceState` so links stay shareable. CSV export of matching species.

### Setup wizard

A 7-step modal that walks new users through the essential configuration on first launch and is re-runnable from Settings → Station. Hardware-aware: detects the Pi model, RAM, sound cards, disks, and internet connectivity, then proposes adapted defaults the user can override.

**Backend** (`server/routes/setup.js`):

| Endpoint | Purpose |
|----------|---------|
| `GET /api/setup/status` | `{needed, completed_at, gaps}` — `needed=true` when no `config/setup-completed.json`, lat/lon=0/0, or no audio device |
| `GET /api/setup/hardware-profile` | Pi model + tag (pi3/pi4/pi5/other), RAM, audio devices (USB-flagged), disks (external-flagged), internet probe, plus computed model recommendations |
| `POST /api/setup/complete` | Applies all 5 categories of choices in batch (location, audio device, model + dual flag, YAMNet filters, BirdWeather + Apprise URLs); writes `setup-completed.json` atomically. **Does not restart any service** — config goes to disk, the user manually restarts when ready |

Hardware-driven model recommendations:
- Pi 5 + ≥4 GB → BirdNET FP16 + Perch FP16 (dual)
- Pi 4 + ≥4 GB → BirdNET FP16 + Perch INT8 (dual)
- Pi 3 → BirdNET FP16 (single, no Perch)

**Frontend** (`public/js/bird-setup-wizard.js`):

- Single shared reactive state on `BIRDASH._setupWizardState` so the same instance is reachable from any page (the modal sits in the `birdash-shell` template, rendered on all 23 pages).
- 7 steps: Welcome → Location → Audio source → Detection model → Pre-filters → Integrations → Recap. Each step has a "Pourquoi ce réglage ?" expandable explainer for new-user education.
- Auto-trigger on `overview.html` mount when `status.needed` is true and not dismissed in this browser session (sessionStorage flag).
- `BIRDASH.openSetupWizard()` is the public entry point — used by the auto-trigger and by the Settings re-run button.

The "no service restart" choice is deliberate: applying via the wizard while detections are running must not interrupt them. The user gets a clear note on the Recap step and decides when to restart.

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
| `audio.js` (+ `audio/` subdir, 8 modules) | Thin dispatcher delegating to `audio/_helpers`, `streaming`, `devices`, `profiles`, `calibration`, `monitoring`, `adaptive_gain`, `noise_profile`. Refactored from a single 1094-line file in v1.36 — each sub-module fits in one screen | `/api/audio/devices`, `/api/audio/adaptive-gain`, `/api/audio-stream`, `/api/audio/monitor`, `/api/audio/profiles`, `/api/audio/calibration/*`, `/api/audio/noise-profile/*`, `/api/audio/boost`, `/api/audio/test`, `/api/audio/filter-preview`, `/api/live-stream`, `/api/live-pcm` |
| `setup.js` | Setup wizard backend (status detection, hardware profile, batch-apply). Does not restart services — caller decides when | `/api/setup/status`, `/api/setup/hardware-profile`, `/api/setup/complete` |
| `backup.js` | Backup configuration, scheduling, export | `/api/backup/config`, `/api/backup/run`, `/api/backup/history` |
| `bug-report.js` | In-app bug reporting via GitHub Issues API | `/api/bug-report` |
| `comparison.js` | Seasonal report: arrivals, departures, evolution | `/api/seasons/report` |
| `data.js` | Favorites, notes, photo preferences, raw SQL query | `/api/favorites`, `/api/notes`, `/api/photo-pref`, `/api/query` |
| `detections.js` | Detections CRUD, validations, auto-flagging, CSV/eBird export | `/api/detections`, `/api/validate`, `/api/flag`, `/api/export` |
| `external.js` | BirdWeather, eBird, weather API proxies | `/api/birdweather/*`, `/api/ebird/*`, `/api/weather` |
| `photos.js` | Photo resolution/caching (iNaturalist, Wikipedia), species name translation | `/api/photo`, `/api/species-names` |
| `settings.js` | Settings CRUD, Apprise notifications, MQTT test, alerts config, log streaming (SSE) | `/api/settings`, `/api/apprise`, `/api/mqtt/test`, `/api/alerts`, `/api/logs` |
| `metrics.js` | Prometheus scrape endpoint (text exposition format) | `/metrics`, `/api/metrics` |
| `auth.js` | Login / logout / status / set-password (single-user cookie sessions) | `/api/auth/login`, `/api/auth/logout`, `/api/auth/status`, `/api/auth/set-password` |
| `system.js` | Service management, health metrics, hardware info, model management | `/api/services`, `/api/health`, `/api/models` |
| `telemetry.js` | Telemetry: registration, anonymous pings toggle | `/api/telemetry/register`, `/api/telemetry/status`, `/api/telemetry/anonymous-pings` |
| `timeline.js` | Timeline data with SunCalc astronomy (sunrise/sunset/moon) | `/api/timeline` |
| `updates.js` | Update system: status, apply, rollback, force, log | `/api/update-status`, `/api/apply-update`, `/api/rollback-update`, `/api/update-snooze`, `/api/update-log` |
| `whats-new.js` | Daily overview cards (delegates to worker thread) | `/api/whats-new` |

### Library Modules

Directory: `server/lib/`

| File | Purpose |
|------|---------|
| `aggregates.js` | Pre-aggregated statistics tables (daily, monthly, species, hourly). Full rebuild on startup, incremental refresh every 5 min. |
| `adaptive-gain.js` | Adaptive software gain algorithm: noise floor estimation, clip guard, activity hold. Extracted from audio.js for testability. |
| `alerts.js` | Background alert monitoring (temperature, disk, service health). 60s check interval, 10-min cooldown per alert type. |
| `alert-i18n.js` | Alert message translations (4 languages). Extracted from alerts.js for separation of concerns. |
| `config.js` | `birdnet.conf` parser/writer, settings validators, `execCmd` helper, `readJsonFile`, `APPRISE_BIN`, `ALLOWED_SERVICES`. |
| `db.js` | Database bootstrap: opens `birds.db` (read + write connections), `birdash.db`, `taxonomy.db`. Creates tables, indexes, views. Exports all DB handles. |
| `ebird-frequency.js` | eBird regional frequency data for rarity determination. Replaces naive "3 local observations" heuristic. |
| `local-date.js` | Locale-aware date string helper (`localDateStr()`). Used by aggregates for timezone-correct "today". |
| `notification-watcher.js` | Polls detections DB every 30s, applies 5 notification rules, sends via Apprise with species photo. Replaces engine-side ntfy.sh. |
| `weather-watcher.js` | Hourly Open-Meteo poll into `weather_hourly` table + one-shot archive backfill on startup (covers full detection history). Powers per-detection weather chips and the analytics endpoints. See *Weather subsystem* in §2. |
| `result-cache.js` | In-memory TTL cache for expensive GET endpoints. `get(key)`, `set(key, data, ttl)`, `clearAll()` on any mutation. |
| `safe-config.js` | Mutex-protected read-modify-write for config files. Per-file Promise-chain locking, deep clone before mutation, validation, atomic write (tmp + rename). ETag support for optimistic concurrency (409 Conflict). |
| `telemetry.js` | Supabase telemetry: station registration (UUID, GPS, hardware), daily reports (top species, rare species), 6-hour heartbeat cycle. |
| `weekly-digest.js` | Editorial weekly digest sent via Apprise every Monday 08:00 local. 5 curated lines (numbers, highlight by priority rare>first-of-year>notable, best moment, phenology shift, top 3). Idempotent via `config/digest.json` (lastSentAt). Replaces the legacy weekly-report data dump. |
| `whats-new-worker.js` | Worker thread script: runs 10 heavy SQLite queries in isolation. Computes alerts (out-of-season, activity spikes, species return), phenology (first-of-year, streaks, seasonal peaks), context (dawn chorus, acoustic quality, species richness, moon phase). |
| `mqtt-publisher.js` | Opt-in MQTT publisher (`MQTT_ENABLED=1`). Polls detections DB every 15s, publishes JSON per detection on `<prefix>/<station>/detection`, retained `last_species`, LWT `status`. Optional Home Assistant auto-discovery (`MQTT_HASS_DISCOVERY=1`) creates Last species + Last confidence sensor entities. Reconnect with exponential backoff (2s → 60s); disconnects + reconnects when broker/credentials change. |
| `metrics.js` | Prometheus exposition. Custom gauges (detections total/today/last-hour, species today/30d, last-detection age, DB size), system gauges (CPU temp/usage, RAM, disk, fan, uptime), feature toggles, version info. Default Node.js process metrics under `birdash_node_` prefix. Refreshed lazily on each scrape — no background timer. |
| `auth.js` | Single-user cookie sessions. HMAC-SHA256-signed cookies (no DB session table), bcrypt password hashing, three modes (`off` / `protected` / `public-read`), synchronous gate that runs before route delegation, login-attempt rate limiter (5/min/IP). `AUTH_SECRET` auto-generated on first use. Bearer token (`BIRDASH_API_TOKEN`) accepted in parallel for cron/automation. |

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

#### `weather_hourly` table

```sql
CREATE TABLE weather_hourly (
  date          TEXT NOT NULL,         -- YYYY-MM-DD (local time)
  hour          INTEGER NOT NULL,       -- 0..23 (local time)
  temp_c        REAL,
  humidity_pct  REAL,
  wind_kmh      REAL,
  wind_dir_deg  INTEGER,
  precip_mm     REAL,
  cloud_pct     REAL,
  pressure_hpa  REAL,
  weather_code  INTEGER,                -- WMO code via Open-Meteo
  fetched_at    INTEGER NOT NULL,
  PRIMARY KEY (date, hour)
);
```

Populated by the `weather-watcher` worker (see *Weather subsystem* in §2). Joined to detections at query time via `vdb.weather_hourly` ATTACHed onto the read DB. Storage cost is ~22 K rows for 2.5 years (~0.02 % of typical detection volume); queries are fast because every JOIN hits the PK index.

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
│   ├── bird-queries.js              # 55+ parameterized SQL queries (incl. analyses)
│   ├── bird-icons.js                # 98 Lucide SVG icons + <bird-icon> component
│   ├── bird-vue-core.js             # Vue composables, i18n, shell component (1846 lines)
│   ├── bird-spectro-modal.js        # SpectroModal component (extracted, 390 lines)
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

### Pages (20 + redirects)

| Page | File | Section |
|------|------|---------|
| Overview | `overview.html` | Home |
| Today | `today.html` | Home |
| Bird Flow | `dashboard.html` | Live |
| Spectrogram | `spectrogram.html` | Live |
| Live Board | `liveboard.html` | Live |
| Live Log | `log.html` | Live |
| Calendar | `calendar.html` | History |
| Timeline | `timeline.html` | History |
| Detections | `detections.html` | History |
| Review | `review.html` | History |
| Species | `species.html` | Species |
| Rarities | `rarities.html` | Species |
| Recordings | `recordings.html` | Species |
| Favorites | `favorites.html` | Species |
| Weather | `weather.html` | Indicators |
| Statistics | `stats.html` | Indicators |
| Analyses | `analyses.html` | Indicators |
| Biodiversity | `biodiversity.html` | Indicators |
| Phenology | `phenology.html` | Indicators |
| Seasons | `comparison.html` | Indicators |
| Compare | `compare.html` | Indicators |
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

`result-cache.js` is the **single centralized cache** for all expensive endpoints. Previously there were 3 separate caches (`_cache`, `_queryCache`, `resultCache`) — now consolidated into one.

```javascript
resultCache.set('whats-new', data, 5 * 60 * 1000);  // 5 min TTL
resultCache.get('whats-new');                         // null if expired
resultCache.clearAll();  // after any mutation (delete, validate, etc.)
```

Every mutation handler calls `clearAll()` to prevent stale data. Query results, taxonomy lookups, model comparisons, and rare-today data all share this single cache.

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

### Telemetry — Two Independent Layers

File: `server/lib/telemetry.js`

#### 1. Anonymous Usage Pings (opt-out)

Lightweight adoption tracking. Enabled by default, disableable in Settings → Station.

**Data sent**: `{event, version, hardware, os, country}` — no UUID, no GPS, no station name.

| Event | When | Source |
|-------|------|--------|
| `install` | Once, at bootstrap | `bootstrap.sh` (curl) |
| `update` | After each successful update | `update.sh` (curl) |
| `alive` | Monthly, at startup | `telemetry.js` (throttled to 30 days) |

Stored in Supabase `pings` table (write-only RLS, anon key cannot read).
Toggle: `config/telemetry.json` → `anonymousPings: false`.

#### 2. Community Network (opt-in)

Full station registration. Nothing sent until the user explicitly enables it from Settings.

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

Follows [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

Source of truth: `package.json`. Bumped before each push via `scripts/bump.sh`:
- `bump.sh patch` — bug fix, polish (1.7.0 → 1.7.1)
- `bump.sh minor` — new feature/screen (1.7.3 → 1.8.0)
- `bump.sh major` — breaking change (1.8.0 → 2.0.0)
- `bump.sh` (no arg) — auto from last commit (`feat:` → minor, else → patch)

### Update Detection

Endpoint: `GET /api/update-status`

1. Compares `git rev-parse HEAD` against `git ls-remote origin main` (1-minute cache)
2. Fetches `latestVersion` from remote `package.json` via GitHub Contents API
3. Fetches commit list via GitHub Compare API for categorized release notes

### In-App Update Flow

1. Red banner appears on every page when a new version is available (e.g., `v1.7.0 → v1.8.0`)
2. Click **View** to see release notes grouped by type (feat, fix, perf, etc.)
3. Options:
   - **Install now** — runs `scripts/update.sh`, polls progress via `?progress=1`
   - **Later (24h)** — snoozes banner (server-side in `config/update-state.json`)
   - **Skip these updates** — hides until a newer version exists
4. On success: confirmation message, auto-reload after 2s
5. On failure: error detail, expandable log, plus:
   - **Roll back** — reverts to `previousCommit` via `scripts/rollback.sh`
   - **Force update** — retries with `--force` (resets diverged history)
   - **Dismiss** — closes the modal

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/update-status` | GET | Check for updates (cached 1min). `?progress=1` for live progress. `?refresh=1` to bypass cache |
| `/api/apply-update` | POST | Start update. Body: `{force: true}` for force mode |
| `/api/rollback-update` | POST | Rollback. Body: `{commit: "abc123..."}` |
| `/api/update-snooze` | POST | Snooze. Body: `{action: "defer"|"skip"|"clear", days?: 1}` |
| `/api/update-log` | GET | Returns last 200 lines of `config/update.log` |

### update.sh Script

Path: `scripts/update.sh [--write-status PATH] [--force]`

Execution steps:
1. Handle uncommitted changes (auto-reset `package-lock.json` if only dirty file)
2. `git fetch --tags origin main` + fast-forward merge (or `--force` → `git reset --hard`)
3. `npm install` if `package.json` changed (**fatal** on failure — won't restart with missing deps)
4. `pip install -r requirements.txt` if changed (**fatal** on failure)
5. Run migrations from `scripts/migrations/` (idempotent, non-fatal)
6. Restart birdash with **health-check** (`/api/health` polled for 15s, not just `systemctl is-active`)
7. Restart birdengine (**fatal** if it fails to start — detection would be broken)
8. Write final status with `previousCommit` for rollback

All output logged to `config/update.log`. Progress written atomically to `config/update-progress.json` (tmp + mv). Stale "running" states auto-expire after 10 minutes.

### rollback.sh Script

Path: `scripts/rollback.sh <commit-sha> [--write-status PATH]`

1. `git reset --hard <commit>`
2. `npm install` (re-sync dependencies to match rolled-back code)
3. Restart birdash + birdengine with health-check

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
| `007-pip-sync.sh` | Sync Python dependencies from `requirements.txt` |

Each migration is idempotent (safe to re-run). Migration `004` creates the `.rebuild-aggregates` sentinel to force a full aggregate rebuild on next startup.

---

## 9. Configuration Files

All configuration files live in `~/birdash/config/` unless otherwise noted.

### birdnet.conf

Path: varies (parsed by `server/lib/config.js`)

BirdNET-Pi compatible configuration. Key parameters:
- `LATITUDE`, `LONGITUDE` — station GPS coordinates (also mirrored to `engine/config.toml` on save so the detection engine stays in sync)
- `ELEVATION` — station altitude in metres, shown in the header; not used by the detection engine
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

Telemetry state (both layers):

```json
{
  "enabled": false,
  "stationId": null,
  "stationName": "",
  "optInDate": null,
  "anonymousPings": true,
  "lastAlivePing": "2026-04-15T12:00:00.000Z",
  "country": "Belgium"
}
```

- `enabled` / `stationId` / `stationName` / `optInDate` — community network (opt-in)
- `anonymousPings` — anonymous usage pings (opt-out, default `true`)
- `lastAlivePing` — timestamp of last monthly alive ping (throttle)
- `country` — cached from GeoIP (used for anonymous pings)

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
| `config/digest.json` | Weekly digest idempotency state (lastSentAt) |
| `config/noise_profile.wav` | Recorded ambient noise for spectral subtraction |
| `engine/config.toml` | Engine-specific TOML configuration |
