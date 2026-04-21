# Changelog

All notable changes to BirdStation are documented here.

## [1.35.0] — 2026-04-21

### Setup wizard — first-run onboarding modal

A 7-step modal guides new users (and existing ones via Settings → Station) through the essential configuration without forcing them to read pages of doc. Fully hardware-aware — detects the Pi model, RAM, sound cards, disks, and internet connectivity, then proposes adapted defaults the user can override.

**Backend** (`server/routes/setup.js`):
- `GET /api/setup/status` — `{ needed, completed_at, gaps }`. Setup is considered "needed" when no `config/setup-completed.json` flag exists, or `lat/lon=0/0`, or no audio device is configured.
- `GET /api/setup/hardware-profile` — Pi model + tag (pi3/pi4/pi5/other), total RAM, detected sound cards (USB-flagged for recommendation), block devices (external USB drives flagged), live Open-Meteo probe for internet status, plus computed model recommendations (Pi 5 + ≥4 GB → BirdNET FP16 + Perch FP16 dual; Pi 4 + ≥4 GB → + Perch INT8 dual; Pi 3 → BirdNET FP16 single).
- `POST /api/setup/complete` — applies all 5 categories of choices (location, audio, model, filters, integrations) in batch, writes `config/setup-completed.json` atomically. **Does not restart any service** — config goes to disk, the engine picks up changes at the user's next manual restart. Ongoing detections are not interrupted.

**Frontend** (`public/js/bird-setup-wizard.js`):
- 7 steps: Welcome → Location → Audio source → Detection model → Pre-filters → Integrations → Recap.
- Hardware-aware defaults seeded into every step from `/api/setup/hardware-profile` + current `birdnet.conf` values pre-loaded so re-runs aren't destructive.
- Per-step "Pourquoi ce réglage ?" expandable explanations educate new users.
- Audio step lists detected devices with USB/built-in badges and a "Recommended" pill on the auto-pick.
- Model step offers two simple choices (Single BirdNET vs Dual BirdNET+Perch) with hardware recommendation surfaced + "Advanced choices" expander revealing the full model picker.
- Pre-filters step exposes YAMNet privacy + dog-bark filters with GDPR-friendly defaults.
- Integrations step covers BirdWeather station ID + Apprise URLs (one per line), MQTT skipped (too complex for a wizard).
- Recap step shows all configured choices + clear note that nothing restarts automatically.
- Auto-trigger on overview.html mount when status is "needed" and not dismissed in this browser session.
- Re-run from Settings → Station → "Lancer l'assistant" — pre-loads current values, can be closed without applying.

**i18n**: ~80 new keys × 4 languages (fr, en, de, nl).

**Smoke**: bumped `scripts/smoke.mjs` `page.goto` timeout from 20 s to 45 s — pages now load more JS (weather chips, wizard) and the old timeout was tripping on `recordings.html`.

**SW v140**. Tests 155/155, smoke 35/35 green.

## [1.34.0] — 2026-04-21

### Custom weather search on weather.html (Phase B reimagined)

Phase B was originally planned as filters in detections.html, but the bird-vs-weather questions surface naturally on the weather page itself. New "Recherche par conditions" card lets ornithologists answer ad-hoc questions in seconds — no need to leave to a separate filter panel.

Backend:
- Extended `/api/weather/species-by-condition` with `hour_min`, `hour_max`, `date_from`, `date_to` (added to the existing temp/precip/wind/codes/conf params). All filters AND'd together, all optional.
- New `/api/weather/match-summary` endpoint — returns just `{detections, species}` totals for the live header counter, avoiding a row transfer just to count. Same filter shape as species-by-condition, parsed via a shared `parseWeatherFilters()` helper.

Frontend (weather.html):
- New card with 6 filter rows: temperature, precipitation, wind (range sliders), hour of day, date range, and conditions (8-checkbox WMO buckets). Each row has its own on/off toggle so an empty filter means "no constraint" rather than relying on default magic numbers.
- 4 quick presets at the top: **Grand froid** (-15…0°C), **Pluie soutenue** (≥2mm/h), **Aube dégagée** (5-9h, clear sky), **Pluie/Orage** (rain or storm codes). Click → form auto-fills.
- Live update with 300ms debounce + sequence-number race protection (older queries discarded if a newer one starts).
- Results: top 20 matching species with rank, common name, sci name, detection count, avg confidence. Click row → species page.
- Live header: `12,348 detections · 47 species` updates as you slide.
- URL params persistence via `history.replaceState` — every filter change updates the URL so links stay shareable. **Lien** button copies the current URL to clipboard.
- **CSV** export of matching species.
- 12 new i18n labels × 4 languages.

Architecture: shared `parseWeatherFilters()` keeps backend filter parsing in one place. Frontend `buildQuery()` mirrors it for URL/API serialization. Adding a new filter dimension means changing one place on each side.

This obsoletes the originally-planned phase B (filters in detections.html) — both would solve the same use cases but with a worse focus (per-detection rather than per-species).

## [1.33.0] — 2026-04-21

### Weather analytics: leaderboards, heatmap, per-species profile (Phase C)

Now that every detection has weather context, you can answer ornithological questions like "which species are still active when it's sub-zero?" or "what sings during heavy rain?" directly from the dashboard.

**4 new backend endpoints** (all JOIN active_detections × weather_hourly):

- `GET /api/weather/condition-summary?conf=0.7` — global counts of detections + distinct species per WMO category (clear, partly_cloudy, cloudy, fog, drizzle, rain, snow, storm).
- `GET /api/weather/species-by-condition?temp_min=&temp_max=&codes=&precip_min=&wind_min=&conf=&limit=` — top species matching arbitrary AND-combined weather predicates.
- `GET /api/weather/species-heatmap?top=30&bin_size=5&bin_min=-15&bin_max=35` — dense matrix: top-N species × temperature bins, suitable for heatmap rendering.
- `GET /api/weather/species-profile?species=` — per-species distribution across weather conditions + temp histogram + summary stats (avg/min/max temp, avg wind, % during precip).

**weather.html — 2 new sections:**

- **Activité par conditions météo** — 4 leaderboards in a responsive grid: cold tolerance (<0°C), storm singers (codes 95-99), heavy rain (≥5mm/h), strong wind (≥30km/h). Each shows top 10 species with click-through to species page.
- **Heatmap espèce × température** — top 30 species × temp bins from -15°C to +35°C in 5°C steps. Color gradient pale-green → green → amber → red-orange shows activity intensity. Sticky first column for horizontal scroll.

**species.html — new "Profil météo" panel:**

- 4 KPI cards: avg temperature, temp range (min…max), avg wind, % of detections during precipitation.
- Horizontal bar distribution across weather conditions (clear/cloudy/rain/etc.).
- Temperature histogram (10 bins from -15°C to +35°C).
- Hidden when the species has no detections with weather data.

13 new i18n labels per language (fr, en, de, nl). Backend queries use the existing `vdb` ATTACH (no schema changes). Architecture validated: lookup at query time over the `(date, hour)` PK index keeps queries under 1s on the Pi 5 even on 1M+ detections.

Phase C of three (badges → analytics → filters); next will be filterable views in detections.html.

## [1.32.0] — 2026-04-21

### Weather chips on detection lists (Phase A of weather audit)

The weather context that landed in 1.31.x is now visible everywhere a detection appears, not just inside the spectrogram modal.

New pieces:
- `GET /api/weather/range?from=YYYY-MM-DD&to=YYYY-MM-DD` returns all hourly snapshots in the range as a single response — a page with N detections gets weather for all of them in 1 round-trip instead of N.
- `BIRDASH.weatherCache` (Map) + `BIRDASH.loadWeatherRange(from, to)` — global in-memory cache with 5-minute TTL per range key, request deduplication for parallel callers, and silent degradation on network failures.
- New `<weather-chip :date :time :detailed>` Vue component, registered globally via the patched `BIRDASH.registerComponents`. Reads from the cache, renders nothing if the lookup misses. The `detailed` prop adds precip and wind when meaningful.
- Loaded into 23 pages via the same script-tag pattern as the spectro modal.

Pages now showing weather chips:
- `today.html` — chip next to the player meta
- `overview.html` — detailed chip (with precip + wind) on the featured-detection card
- `recordings.html` — chip on each recording row
- `rarities.html` — chip on each recent-rare-detection card
- `review.html` — chip on each flagged-detection meta line
- `favorites.html` — chip showing weather at the last detection of each favorite species

Pages still using their own fetch (no change): the spectro modal continues to fetch via `/api/weather/at` since it has no range context.

Phase A of three: badges everywhere → analytics → filters (per the ornithology roadmap).

## [1.31.1] — 2026-04-21

### Weather backfill via Open-Meteo archive API

The initial 1.31.0 release only backfilled 7 days, so detections older than a week showed no weather chip. The watcher now also runs a one-shot historical backfill via `archive-api.open-meteo.com` from the oldest detection in the DB up to ~6 days ago (the archive cutoff), chunked 1 year per request to keep responses sane. Hourly polling continues to cover the recent past.

On bird.local: 22,728 snapshots backfilled spanning Sept 2023 → April 2026 (~2.5 years of detection history) in three archive calls + one polite 500ms pause between chunks.

## [1.31.0] — 2026-04-21

### Per-detection weather context

Each new detection is now tagged with the weather conditions it was recorded in (temperature, humidity, wind, precipitation, cloud cover, pressure, weather code). Click any detection to open the spectrogram modal and see a compact weather chip next to the date/time — at a glance you know if the bird was singing in clear morning sun or under steady rain.

How it works:
- New `weather_hourly` table in `birdash.db` stores hourly snapshots indexed by `(date, hour)`.
- Background worker (`server/lib/weather-watcher.js`) backfills the past 7 days on startup, then polls Open-Meteo every hour for the last 24h. Free tier, no API key needed (~24 requests/day vs the 10K daily quota).
- New endpoint `GET /api/weather/at?date=YYYY-MM-DD&time=HH:MM:SS` resolves the timestamp to its hour and returns the snapshot, or 404 if the moment isn't yet covered (typical for very recent detections before the next hourly poll).
- Spectrogram modal: weather chip with WMO-code icon (☀ ⛅ ☁ 🌫 🌧 ❄ ⚡), temp in °C, plus precip and wind shown only when meaningful (precip > 0, wind ≥ 5 km/h).
- 8 new i18n labels per language (clear, partly cloudy, overcast, fog, drizzle, rain, snow, storm).

Idea inspired by audit of competitor projects in the Pi-based BirdNET dashboard space — first of three feature catch-ups (weather → setup wizard → multi-source audio).

## [1.30.1] — 2026-04-21

### Quality pass: CI, smoke filters, service-worker fixes

Round of housekeeping — no user-visible behaviour change, but the test harness, smoke tool, and offline cache are all tighter.

- **GitHub Actions CI** (`.github/workflows/ci.yml`) — `npm ci && npm test` on every push + PR to `main`. Catches silent regressions before they reach a Pi.
- **Test harness** — `npm test` now runs every `tests/*.test.js` file, not just `server.test.js`. The `safe-config` concurrency suite was never running before. Added `describe.skip` gates so integration suites that need Pi-only state (real `birdnet.conf`, `~/birdengine/models`, ALSA, etc.) self-skip on CI runners — the same `npm test` command works in both environments. Removed 4 zombie tests that referenced endpoints deleted in earlier refactors (`/api/detection-rules` GET/POST, `/api/detections-by-taxonomy`, `/api/photo-cache-stats`) — 155/155 green on Pi, ~140 green on CI (rest auto-skipped with reason).
- **`scripts/smoke.mjs`** — added `HTTP 502` / `HTTP 504` to console-error ignore list. These wrapper strings come from `birdQuery` when Caddy cancels the upstream during a navigation, not from actual backend failures. Smoke now reports 35/35 pages clean.
- **`public/sw.js`** — two real bugs fixed in the service worker:
  - Species photo cache was **unreachable**: the `/birds/api/photo` cache-first branch sat *after* a blanket `/birds/api/` early-return, so it never executed. Moved the photo check above the early-return — bird photos now genuinely cache in the service worker.
  - Removed unused `staleWhileRevalidate` helper (dead code).
  - Cache bumped to `v130`.

## [1.30.0] — 2026-04-20

### Bundled real BirdNET FP16 model — FP16 selection is no longer a lie

`download_birdnet.sh` only ever downloaded the FP32 model and created a `BirdNET_GLOBAL_6K_V2.4_Model_FP16.tflite → FP32.tflite` symlink for engine name compatibility. So users picking "FP16" in the Settings model picker were silently running FP32 inference (50 MB binary instead of 26 MB, no smaller-RAM / faster-load benefit).

Now:
- The real FP16 model (~26 MB) is bundled in `engine/models/` (gitignore exception, same pattern as `yamnet.tflite`)
- `download_birdnet.sh` prefers the bundled binary, falls back to the symlink only if the file is missing (older clones)
- `update.sh` syncs the FP16 to legacy `~/birdengine/models/` install layouts on every update — replaces an existing symlink properly via `cp --remove-destination` (without it, `cp -f` would follow the symlink and overwrite FP32)
- mickey, biloute, and any future install pick this up automatically through the in-app update flow — no SSH push, no model re-download

Real-world impact: FP16 is ~50 % smaller on disk and loads faster, with identical inference accuracy. The speed gain on inference itself is modest on Pi 3 / 4 ARM (XNNPACK still upcasts internally) but the smaller RAM footprint matters when several models share a 1 GB Pi 3.

## [1.29.3] — 2026-04-20

### Fix: 0-byte MP3 clips left behind by ffmpeg crashes (esp. Pi 3 / SD card)

The dashboard would show "Erreur de décodage audio" for some detections forever. Root cause: `extract_clip` runs ffmpeg as a subprocess, and on resource-constrained hosts (Pi 3 + SD card, OOM killer, broken pipe) ffmpeg can crash *after* opening the output file but *before* writing any data — leaving a 0-byte MP3 (and sometimes a 0-byte spectrogram PNG) on disk. The error was logged but the empty file persisted: every dashboard click on that detection then re-tried the decode and failed.

Surfaced on mickey.local (Pi 3, SD-card-only): `Content-Length: 0` on the served MP3.

Two-part fix in `engine.py`:
- `extract_clip` now (a) deletes any 0-byte output on ffmpeg failure, (b) verifies a non-zero file size after a "successful" return — some failure modes return 0 but write nothing, (c) cleans up after `subprocess.TimeoutExpired` too (logged as likely SD-card I/O saturation).
- New `_sweep_empty_clips()` runs once at engine startup, walking `~/BirdSongs/Extracted/By_Date/` and removing any 0-byte `*.mp3` / `*.png` files. Bird discovered 24 historical leftovers on first deploy.

mickey will pick this up on its next in-app update — no SSH push.

## [1.29.2] — 2026-04-20

### Bug-hunt sweep across today's work

Two regressions surfaced when auditing today's changes end-to-end:

- **`sqlite3.OperationalError: database is locked`** in the Perch worker. Cause: Python's default `sqlite3.connect` uses a 5 s timeout, same as Node's `busy_timeout`. When birdash's writer (aggregates rebuild, alert queries) holds the lock for >5 s during a Perch insert, the engine raises and the in-flight detections lose their MP3 clips. Fix: `sqlite3.connect(timeout=30)` + `PRAGMA busy_timeout=30000` so the engine is the patient party.

- **`birdengine-recording` restarts on every Save click.** The 1.29.1 hook fired whenever `RECORDING_LENGTH` was in the validated payload — but the settings UI re-sends the full key set on every save. Each click caused a 5–7 s gap in audio capture even when the value hadn't changed. Fix: snapshot the previous value via `parseBirdnetConf()` before writing, only restart if `prev !== new`.

Both fixes verified live: 0 DB locks since deployment, sound-level monitor still flowing, settings save no longer interrupts recording.

## [1.29.1] — 2026-04-20

### YAMNet pre-filter UX polish + recording length actually configurable

- **Privacy filter description** no longer hard-codes "30 s" — it now correctly says "the audio clip" without claiming a fixed duration. The chunk length is whatever the user has set for `RECORDING_LENGTH` (default 45 s).
- **(i) help buttons** on the Privacy and Dog filter cards in Settings → Detection → Filtres de pré-analyse. Each opens the standard help modal with full explanation of: what the filter does, how the threshold works (with 0.30 / 0.50 / 0.70 examples), what the cooldown / delete-WAV options imply, and recommended values.
- **`RECORDING_LENGTH` is now actually applied**. The setting and validator existed since forever, but `record.sh` hard-coded `RECORDING_LENGTH=45` and ignored `birdnet.conf`. Now `record.sh` reads the conf value (with fallback to 45 s), and changing it via the UI restarts `birdengine-recording` automatically so the new chunk length takes effect on the next recording cycle.
- `update.sh` extended to sync `record.sh` to `$HOME/birdengine/` for legacy install layouts (preserves executable bit).
- 4-language i18n (FR/EN/DE/NL) for the help modal content.

## [1.29.0] — 2026-04-20

### Sound-level alerts (mic dead / clipping)

Closes the loop on the Leq monitor added in 1.28.0 — the station now notifies via Apprise when the audio input goes abnormal.

- **Silent microphone**: energy-average Leq ≤ `-90 dBFS` (default) sustained for 15 min (default) → Apprise notification. Catches an unplugged USB mic, a muted card, a failed cable, or a boom stand that fell into a foam pad overnight.
- **Clipping / overdriven**: energy-average Leq ≥ `-5 dBFS` (default) sustained for 15 min → Apprise notification. Catches overdriven input: wrong gain after a calibration, mic moved next to a fan, electrical interference.
- All three values are configurable in Settings → Notifications → Alertes système.
- Skips when no recent data (< 60 % of window covered or last reading > window old) — avoids a false "silent" spam at engine restart. The existing `svc_birdengine` alert already covers engine-down.
- Uses the standard 10 min same-type cooldown; Apprise config / tags shared with all other system alerts.
- i18n for all 4 message strings (titles + bodies) in EN / FR / DE / NL.

Also fixed an import bug in `alerts.js` that silently broke *every* system alert: `fs`, `fsp`, and `BIRDNET_CONF` were referenced but never required. Every check threw a caught ReferenceError and returned. Adding explicit imports at the top of the file brings back temperature, disk, RAM, backlog, and no-detection alerts.

New config keys in `birdnet.conf`:
- `BIRDASH_ALERT_ON_SOUND` (0/1, default 1)
- `BIRDASH_ALERT_SOUND_LOW_DBFS` (default -90)
- `BIRDASH_ALERT_SOUND_HIGH_DBFS` (default -5)
- `BIRDASH_ALERT_SOUND_SUSTAINED_MIN` (default 15)

## [1.28.2] — 2026-04-20

### Fix: missing MP3 clips for Perch detections after engine restart

"Erreur de décodage audio" on the spectrogram modal. Cause: post-processing for the secondary model (Perch) was spawned as a daemon thread but — unlike the primary model — was not tracked in `self._post_threads`. So when the engine received SIGTERM (update, restart, settings reload), the shutdown handler only waited for primary-model post-processing and exited while Perch's `extract_clip` was still running, killing the daemon thread mid-ffmpeg. Perch detections were already written to the DB, but the MP3 clips were never produced → the dashboard showed the detection but the spectrogram modal reported a decode error.

Fix: track secondary post-threads in `_post_threads` as well (guarded by a new `_post_lock` since primary and secondary workers both append). Shutdown join timeout bumped from 10 s to 30 s to give room for ffmpeg + spectrogram generation on files with many detections.

Existing orphan references (detections in the DB whose MP3 was lost to this bug before the fix) remain. They're rare — expect a sprinkle per engine restart prior to 1.28.2. The dashboard degrades gracefully (error overlay in the modal), no other functional impact.

## [1.28.1] — 2026-04-20

### Fix: engine was analyzing only ~2 s out of every 45 s recording

The Sound-level monitor added in 1.28.0 surfaced a long-standing bug. `WavHandler.on_created` fired the moment arecord opened a new WAV file — *while it was still being written*. The "wait for stable size" loop in `process_file` (5 × 0.3 s = 1.5 s of waiting) gave up before the file was complete, so `sf.read()` only saw the first ~2 seconds. BirdNET / Perch then ran inference on that 2-second slice and shutil.move'd the (still being written by arecord) file to processed/ — where it grew to its full 45 s after the move, but inference had already happened.

Effect: ~95 % of every 45 s recording was never analyzed. Bird calls in seconds 2-45 of any file were silently dropped before they ever reached the model.

Fix: rotate-on-rotation. When on_created fires for file N+1, file N is *guaranteed* complete (arecord just closed it before opening N+1). `WavHandler` now keeps one "pending" path and processes the *previous* file on every rotation. Startup scan defers the most recent file if its mtime is < 3 s old (probably mid-write).

The wait-for-stable-size loop in `process_file` is simplified to a single 0.5 s sanity check (for the rsync multi-Pi case where atomicity isn't guaranteed).

You should see more detections per file going forward, especially for sparse-but-loud events that were falling in the dropped 43 seconds. No setting to change.

## [1.28.0] — 2026-04-20

### Live sound-level monitor (Leq / peak in dBFS)

Adds per-chunk acoustic health telemetry so you can spot wind, traffic, a dead mic, or silent overnight hours at a glance.

- New `compute_sound_level()` + `record_sound_level()` helpers in `engine.py` — RMS and peak in dBFS, computed on the raw signal before adaptive gain or filters (reflects what the microphone actually captured)
- Rolling ring buffer written to `config/sound_level.json` (last 120 readings ≈ 90 min at 45 s/chunk), atomic replace to avoid partial reads
- New Prometheus gauges in `server/lib/metrics.js`: `birdash_sound_leq_dbfs`, `_peak_dbfs`, `_leq_1h_avg_dbfs` (energy-average), `_last_reading_age_seconds`
- New `GET /api/sound-level` route serving `current + avg_1h + buffer` for the UI
- New "Niveau sonore (en direct)" card at the top of Settings → Audio: big Leq readout, peak, 1 h average, live sparkline (60 last points), auto-refresh every 5 s while the tab is open
- i18n keys in 4 languages, note about dBFS being uncalibrated (trend-tracking, not SPL)

Overhead: a few µs per WAV (numpy vectorized RMS on ~2 M samples). Runs unconditionally — no setting to toggle, no measurable cost.

## [1.27.0] — 2026-04-20

### Privacy filter + dog bark filter (YAMNet pre-analysis)

Two new opt-in filters that run BEFORE BirdNET / Perch inference, powered by Google's YAMNet (AudioSet, 521 audio classes, 4 MB TFLite). One model, two use cases:

- **Privacy filter (RGPD-friendly)**: human voice in the recording → drop the entire detection pass. By default the WAV file is also deleted from disk so no recording of the human ever leaves the station. Toggle in Settings → Detection → "Filtres de pré-analyse" with adjustable threshold.
- **Dog bark filter**: bark / howl / growl detected → drop the recording AND start a configurable cooldown (default 15 s) during which no detections are recorded. Stops the cascade of false positives that dogs trigger across consecutive recording windows.

Implementation:
- New `engine/yamnet_filter.py` wrapper — loads the TFLite model once, exposes `analyze(samples, sr)` returning `(voice_score, dog_score, top_label, top_score)` over 3 non-overlapping 0.975 s windows (max-aggregation per class)
- New `engine/models/yamnet.tflite` (4 MB, Apache 2.0, sourced from Google's MediaPipe public bucket) and `yamnet_class_map.csv` (521 labels)
- `engine.py` runs YAMNet on the raw audio BEFORE adaptive gain / filters / inference, so we classify what the user actually recorded
- ~30 ms added latency per file on Pi 5 — negligible vs the ~1.5 s BirdNET inference
- New validators in `config.js`: `PRIVACY_FILTER_{ENABLED,THRESHOLD,DELETE_AUDIO}`, `DOG_FILTER_{ENABLED,THRESHOLD,COOLDOWN_SEC}`
- New "Filtres de pré-analyse" card in Settings → Detection — sliders, toggles, RGPD warning, latency hint, all in 4 languages
- `update.sh` syncs `yamnet_filter.py` + the model files to `$HOME/birdengine/` for legacy install layouts

## [1.26.0] — 2026-04-20

### Range Filter — visibility for BirdNET, new eBird filter for Perch

The BirdNET MData range filter was already there (engine.py uses `species_list` from the MData TFLite to drop out-of-region predictions, configurable via `SF_THRESH`), but the user couldn't see what it was doing. Perch had no equivalent at all.

**Part A — visibility (BirdNET MData)**:
- New `engine/range_filter_cli.py` — standalone Python that loads MData TFLite for given lat/lon/week/threshold and prints the expected species list as JSON
- New `GET /api/range-filter/preview?week=N&threshold=T` route — runs the CLI, caches 5 min by (lat, lon, week, threshold, lang)
- Settings → Detection → **Range Filter** card: live count "✓ 156 species expected here in week 16" + collapsible full list (sci + com names), refreshes when you move the SF_THRESH slider (debounced 500ms)
- Existing `SF_THRESH` slider preserved with the same range/step — UI just got a brain

**Part B — eBird filter for Perch**:
- New opt-in flag `RANGE_FILTER_PERCH_EBIRD=0/1` in `birdnet.conf`. When enabled, engine.py loads `config/ebird-frequency.json` (already maintained by birdash) at startup and drops Perch predictions whose `sci_name` isn't in the local eBird "recent observations" set. Stops Perch from reporting tropical species in Belgium.
- mtime-based reload of the eBird map so engine picks up daily refreshes without restart
- Fail-open: no eBird data → no filtering (better than silently dropping every Perch detection)
- New "Filtre eBird pour Perch" card in Settings → Detection with the toggle and a warning when no eBird API key is set
- New validator `RANGE_FILTER_PERCH_EBIRD` in config.js

**Update.sh fix**:
- Engine `.py` files are now rsynced to `$HOME/birdengine/` on update if the systemd service points there (legacy install layout). Prevents the "git pull but the engine still runs the old code" trap.

## [1.25.1] — 2026-04-20

### Auth fixes — no more lockout, login page text resolved
- **Fail-safe**: if `AUTH_MODE` is set to `protected` or `public-read` but no credentials are configured (no username + password hash), the gate now degrades to `off` and logs a warning. Picking a protected mode without setting a password used to be an instant permanent lockout — you couldn't reach Settings to unset it. Fixed.
- **Login page i18n**: the page used `BIRDASH.t` and `BIRDASH.i18nReady` which don't exist. Switched to `useI18n()` (the proper composable) and `BIRDASH.ready` (the actual promise name), so labels render translated instead of showing raw `auth_login_title` / `auth_username` keys.
- Service worker bumped to `birdash-v123` to flush the broken cached `login.html`.

## [1.25.0] — 2026-04-20

### Auth & access control (opt-in, single-user, three modes)

The killer feature for actually exposing your station to the internet — show your birds to friends without giving them admin rights.

- **Three access modes** in Settings → Station → Security:
  - `off` (default, unchanged) — LAN-trust, no auth, current behavior
  - `protected` — login required for everything
  - **`public-read`** — visitors can browse detections, species, stats and audio anonymously; login required only to change settings or access sensitive data (`/api/settings`, `/api/logs`, `/api/backup*`, `/api/audio/devices`, `/api/audio/profiles`)
- New **sober login page** (`/birds/login.html`) — fully integrated with the active theme, shows station name + brand, rotating-key icons, redirect-back parameter
- **Header indicator** on every page (when AUTH_MODE != off): green pill with username + logout button when signed in, gray "visitor (read-only)" pill + login button otherwise
- **HMAC-signed session cookies** (no DB session table to manage). Secret auto-generated on first use into `AUTH_SECRET`, rotate it to invalidate every cookie. Configurable session duration via `AUTH_SESSION_HOURS` (default 7 days)
- **bcrypt** password hashing (10 rounds) via the pure-JS `bcryptjs` (no native build dance on Pi 3)
- **Login attempts rate-limited** 5/min/IP with constant-time username comparison so a wrong username can't be distinguished from a wrong password
- **`BIRDASH_API_TOKEN` (Bearer) still works** in parallel for cron / scripted automation — useful when you want both browser auth and machine auth on the same station
- **Global fetch interceptor** in `bird-vue-core.js` — any 401 from a non-auth endpoint triggers an automatic redirect to `/login.html?redirect=<current>`, so users land on the form instead of an empty page
- **Settings card** in Station tab: 3-mode picker with descriptions, username + password (set/change with current-password verification), link to the Cloudflare Tunnel mini-guide in the README
- New `/api/auth/{login,logout,status,set-password}` endpoints
- Cloudflare Tunnel mini-guide in the README — the no-port-forward, free-TLS path to a public station

## [1.24.0] — 2026-04-20

### Prometheus metrics endpoint
- New `GET /metrics` (and `/api/metrics`) serves Prometheus exposition format — point Grafana / Prometheus / VictoriaMetrics at `http://your-pi.local/birds/metrics` and you have a scrape target
- Custom gauges: `birdash_detections_total`, `birdash_detections_today`, `birdash_detections_last_hour`, `birdash_species_today`, `birdash_species_30d`, `birdash_last_detection_age_seconds`, `birdash_db_size_bytes`
- System gauges: `birdash_cpu_temp_celsius`, `birdash_cpu_usage_percent`, `birdash_memory_{used,total}_bytes`, `birdash_disk_{used,total}_bytes`, `birdash_fan_rpm`, `birdash_system_uptime_seconds`
- Feature toggles: `birdash_feature_enabled{feature="mqtt|notifications|dual_model|birdweather|weekly_digest"}`
- Standard Node.js process metrics (`birdash_node_process_*`, `birdash_node_nodejs_eventloop_lag_seconds`, GC, heap) under the `birdash_node_` prefix
- All gauges refreshed lazily on each scrape (sub-millisecond) — no background timer
- `birdash_version_info{version="x.y.z"}` always 1, useful for `count(birdash_version_info) by (version)` style queries
- New `prom-client` npm dependency (~50 KB)

## [1.23.0] — 2026-04-20

### MQTT publisher (Home Assistant ready)
- New **MQTT card** in Settings → Notifications: broker host, port, optional username/password, topic prefix, QoS (0/1/2), retain flag, TLS toggle, minimum confidence slider, Home Assistant auto-discovery toggle, and a one-click Test button
- New backend module `server/lib/mqtt-publisher.js` polls the detections DB every 15 s and publishes one JSON message per detection to `<prefix>/<station>/detection`
- Retained `<prefix>/<station>/last_species` topic gives Home Assistant a ready-to-use sensor for the most recent bird without any template work
- Last Will & Testament publishes `<prefix>/<station>/status` = `online`/`offline` so HA shows the station as unavailable when birdash is down
- Optional **HA MQTT discovery** auto-creates two sensor entities (`Last species` + `Last confidence %`) under a `BirdStation <name>` device — drag-and-drop into any dashboard
- Reconnect with exponential backoff (2 s → 60 s) and clean disconnect on settings change
- New `POST /api/mqtt/test` endpoint connects, publishes a synthetic message to `<prefix>/<station>/test`, disconnects, returns the broker result
- `mqtt` npm dependency added — installer picks it up automatically on update via `npm install`
- Service worker bumped to `birdash-v121` so the new i18n keys load on first reload

## [1.22.2] — 2026-04-19

### Station tab layout polish
- Location card becomes a flex column — the map grows vertically to fill the remaining space instead of staying fixed at 240 px, eliminating the empty gap between the coordinate row and the card bottom
- Right column card gap reduced from 1 rem to .6 rem so Language / BirdWeather / eBird sit closer together

## [1.22.1] — 2026-04-19

### Fixes to the Region & units card
- Prefs now reach the Station tab: the refs (`unitsPref`, `timeFormatPref`, `dateFormatPref`, `weekStartPref` + matching `eff*` computeds) were added to the root `settingsCtx` provide, not just the root return — the async child component renders `settings/station.html` via `inject('settingsCtx')`, so the selectors were binding to `undefined` and appeared empty
- Labels wrap above each selector instead of inline — `.set-label` is a `<span>` inline by default; added `display:block;margin-bottom:.3rem` so the four selects stack vertically like the rest of the form
- New hint under the card title clarifies that region prefs apply immediately (they persist to `localStorage`, not `birdnet.conf`, so Save stays inactive) — new i18n key `set_region_instant` in fr/en/de/nl

### Station tab layout
- eBird card moved from a separate row below the grid into the right column beneath BirdWeather
- eBird uses `flex:1` + `margin-top:auto` on the "Get API key" link so its bottom aligns with the Location card on the left (map grows to match the taller right column)

## [1.22.0] — 2026-04-18

### Locale-aware units & formats
- New **"Région & unités"** card in Settings → Station with four preferences:
  - **Unit system** (auto / metric / imperial) — auto-detected from `navigator.language` (US / LR / MM → imperial, rest → metric)
  - **Time format** (auto / 24h / 12h)
  - **Date format** (auto / DD/MM/YYYY / MM/DD/YYYY / ISO)
  - **First day of week** (auto / Monday / Sunday) — drives the calendar grid and the weekly aggregation in `bird-queries.js`
- Prefs persist in `localStorage` (client-side, per-viewer) like `theme` / `lang`; `auto` clears the key
- Reactive: changing a preference updates every template that calls `fmtTemp()` / `fmtWind()` / `fmtSize()` / `fmtDate()` / `fmtTime()` without a reload
- New `useFormat()` composable (inlined in `bird-vue-core.js`) exposes: `fmtTemp`, `fmtWind`, `fmtPressure`, `fmtSize`, `fmtDate`, `fmtTime`, `fmtDateTime`, `fmtNumber`, `fmtPercent`, `firstDayOfWeek`, `unitLabel`
- `registerComponents(app)` now injects all formatters into `app.config.globalProperties` — pages can `{{fmtTemp(x)}}` directly without touching their `setup()`
- `fmtDate` / `fmtTime` backward-compatible with the previous string signatures from `bird-shared.js` (the re-exports on `BIRDASH.*` now point at the locale-aware versions)
- Weather (°C / km/h), overview kiosk strip, liveboard, dashboard-kiosk, system health temp, file-size displays in Settings & System, and the Calendar week layout all migrated
- Weather `weather_best` / `weather_best_full` i18n keys de-unitized — callers pass pre-formatted strings via `fmtTemp` / `fmtWind`
- Imperial unit deductions in weather chart convert `°C → °F` and `km/h → mph` at render; axis titles + tooltip labels follow `unitLabel('temp')` / `unitLabel('wind')`

### Header
- "Nom du site" (`SITE_NAME`) now drives the sub-line instead of the hardcoded `Heinsch (BE)` (replacement of brand-name → site-name after user correction)

### Deferred
- Notification threshold inputs in `settings/notif.html` still hardcode `°C` for the value label — threshold is always stored in Celsius, the display unit mismatch is minor and the conversion needs a round-trip proxy that's out of scope for this pass
- `recordings.html`, `settings/audio.html`, `spectro-test.html` keep their local `KB / MB` math (low traffic, self-contained)

## [1.21.4] — 2026-04-18

### Header station identity
- Richer identity line in the header: `Poste bioacoustique · Heinsch (BE) · 49.6700° N / 5.8267° E · Alt. 280 m · v1.21.4`
- Altitude rendered dynamically from new `ELEVATION` setting (hidden when unset)

### New setting: `ELEVATION`
- New field in **Settings → Station** next to latitude/longitude
- Stored in `birdnet.conf` (validated server-side, range −500 to 9000 m)
- i18n in fr/en/de/nl (`set_elevation`) + help-text with link to topographic-map.com
- Not used by the detection engine — display-only; mirrors the lat/lon sync pattern minus the `config.toml` side

### Colonial theme (1.21.0 → 1.21.3)
- New `data-theme="colonial"` — 1930 field-notebook carnet aesthetic (IM Fell English typography, paper-grain cards, moss/ochre/rust/berry accents)
- Theme-dot swatch in the picker uses 3 earth bands + a tiny red stamp dot so the preview reflects the palette
- Body background: aged parchment (not dark wood) — legible contrast preserved
- Nav / header / button contrast: `--bg-deep` raised to paper-3 and primary-button text forced to paper so button labels stay readable on moss

### Kiosk (1.20.8)
- `dashboard-kiosk.html` widens the "Dernières observations" pool from 80 → 500 rows so confidence-filtered dedupe reliably surfaces ~10+ species

### Config sync (1.20.7)
- `writeBirdnetConf` now mirrors `LATITUDE` / `LONGITUDE` to `engine/config.toml` alongside the existing `MODEL` / `CONFIDENCE` sync, keeping the detection engine aligned with the dashboard settings

## [1.5.50] — 2026-04-12

### One-line install
- `curl -sSL .../bootstrap.sh | bash` — fully automated, zero-touch installation
- GeoIP auto-detection of latitude, longitude, and language (via ipapi.co)
- BirdNET V2.4 auto-downloaded during install (CC-BY-NC-SA 4.0 license shown)
- Perch V2 model variant auto-selected per Pi hardware (INT8/FP16/FP32)
- ALSA dsnoop for shared microphone access (recording + dashboard preview simultaneously)

### In-app updates
- Red banner with version number when updates are available (e.g. v1.5.30 → v1.5.48)
- One-click **Install now** with live progress and categorized release notes
- **Later (24h)** / **Skip** snooze options (server-side, persistent across browsers)
- `scripts/update.sh` with auto-migrations, selective service restarts, conflict resolution

### Species sharing
- Share modal with photo + pre-formatted message (🐦 + stats + Birdash promo)
- 7 targets: clipboard (text + image), native share API (with photo on mobile), SMS, WhatsApp, X, Mastodon, Email
- Localized share text in FR/EN/DE/NL with hashtags

### Data integrity (4-round QA audit)
- **safe-config.js** — centralized per-file mutex + atomic write for all 13 config files
- **active_detections VIEW** — rejected detections excluded from all statistics via SQLite ATTACH + TEMP VIEW
- **Confidence filter** applied uniformly to all 70+ queries (was missing in 7 species/overview queries)
- **Aggregates count_07** column — per-detection filtered count replaces the flawed avg_conf proxy (closed 28% gap)
- **UTC→local date fix** — `server/lib/local-date.js` canonical helper replaces 8 toISOString() bugs
- **Cache invalidation** after every mutation (delete, validate, favorite toggle)
- **160 automated tests** including 5 cross-page coherence invariants

### Rarity (eBird-based)
- Species rarity from eBird regional observations (30 days, 25 km radius)
- Conservative fallback: local heuristic only after 30+ days of data
- Fresh installs show 0 rare species (not every species flagged as rare)

### Metric honesty
- Weather correlation: weak r values (|r| < 0.2) hidden, permanent "association ≠ causation" caveat, minimum n≥10
- Confidence: tooltip warning that BirdNET (sigmoid) and Perch (softmax) scores are not directly comparable
- Tooltips on "Rare" (eBird contextual), "Activity" (detection count, not diversity), "Top species" (by volume)

### i18n consolidation
- Single source of truth: inline FR dict moved to `fr.json` (loaded at runtime like en/de/nl)
- `scripts/check-i18n.js` — drift prevention tool (coverage gaps + orphaned t() calls)
- 1155 keys × 4 languages, all aligned
- Legacy `bird-i18n.js` deleted

### Phenology picker
- Custom dropdown with search filter, detection count per species, sorted by frequency
- Species below confidence threshold excluded from picker

### Moon phase
- Standard 8-emoji Unicode set (🌑→🌘) on timeline canvas + header badge

### Model names
- Migration 003: normalized `Perch_v2` → `perch_v2_original`, `Perch_v2_int8` → `perch_v2_dynint8`
- `BirdNET_GLOBAL_6K_V2.4_Model_FP32` added to MODEL_LABELS
- Auto-swap secondary model when it collides with the changed primary

### Settings reliability
- Model badge refreshes on save (no page reload needed)
- `config/adaptive_gain.json` untracked (runtime state, was blocking git pull)

## [1.2.0] — 2026-04-07

### New Pages
- **Phenology calendar** (`phenology.html`) — observed phenology per species
  - 3 view modes: Presence / Abundance / Hourly activity
  - 53-week ribbon visualization filling card width
  - Inferred phases from local detections only:
    - Active period (first → last week with detections)
    - Peak abundance (top quartile weeks)
    - Dawn chorus dominance (>70% detections in 4-8h)
    - First / last observation dates
    - Migrant probability (continuous absence > 4 weeks)
    - Resident probability (≥40 active weeks)
  - Honest disclaimer: phases inferred from station data, not biological reference
  - Accessible via Indicators nav section + species page action card
  - URL parameter `?species=X` for direct linking
  - 5 new SQL queries in `bird-queries.js`

### Lucide Icon System
- New `bird-icons.js` (98 Lucide SVG icons, ISC license)
- New `<bird-icon name="..." :size="18">` Vue component
  - Inline SVG via template ref + onMounted innerHTML (proper SVG namespace)
  - Color via `currentColor`, size via prop
- Migrated 280+ emoji icons to Lucide across all 23 pages:
  - Main navigation (6 sections, 24 items)
  - Mobile bottom nav + drawer
  - Settings tabs (10) + System tabs (6) + backup destinations (5)
  - Dashboard Bird Flow (KPIs, quick nav, zones)
  - Action cards (Phenology + Deep Analysis on species.html)
  - Phenology phase cards
- Kept as emoji intentionally:
  - Unicode symbols ✓ ✕ ✗ ★ ☆ ⚠ ⚙
  - Moon phases 🌕🌑🌒…🌘 (timeline astronomical)
  - Weather emojis ☀🌦🌧💨🌬 (color-coded, semantic)
  - 🍓 Raspberry Pi indicator

### Unified Notification Bell
- Single notification center grouped by severity (replaces separate update button)
  - 🔴 **Critical**: GitHub update available, pipeline blocked (backlog > 20 + lag > 5 min)
  - 🟠 **Warning**: review queue pending, pipeline slow (backlog > 5 or lag > 60s)
  - 🟢 **Birds**: existing /api/whats-new alerts (out_of_season, activity_spike,
    species_return, first_of_year, species_streak, seasonal_peak)
- Bell badge color reflects highest severity present
- Number = total unseen across all categories
- "Seen" state tracked per category in localStorage
- Auto-refresh: critical/warning every 5 min, birds every 10 min
- Items grouped in 3 collapsible sections with colored left border

### Update Notification System
- New `/api/version-check` route — polls GitHub Releases once per 24h
- Server-side cache (1 GitHub call per Pi per day, no rate limit issues)
- Update modal in header with formatted release notes (markdown → HTML)
- "How to update" guide with manual git pull commands
- Dismissed version stored in localStorage

### Action Cards (species page)
- 🔬 Deep Analysis and 📅 Phenology buttons promoted from ext-link list to
  prominent action cards inside the species info panel
- Card layout: large icon, title, sub-text, hover lift, arrow indicator
- Distinct visual identity from external links (Wikipedia, eBird, etc.)

### SQL Query Library Expansion
- 5 new phenology queries: `phenologyYears`, `phenologyWeekly`,
  `phenologyHourlyByWeek`, `phenologyFirstLast`, `phenologyMultiYear`
- Total: 56 centralized queries (was 51)
- All apply `BIRD_CONFIG.defaultConfidence` automatically

### Bug Fixes
- **Critical**: `<bird-icon />` self-closing broke text rendering — Vue 3 only
  supports self-closing in pre-compiled SFC templates, not DOM templates parsed
  by the browser. Following content was eaten as a child of the component.
  Fixed 152 occurrences across 31 files.
- Latest detection now picks max confidence across both AI models (BirdNET +
  Perch) using SQLite bare-column MAX trick
- Bell + nav badge undercount: `flagged-detections` was queried with limit=1
  which only processed 1 detection. Now uses last 7 days + limit=2000 (matches
  review.html default)
- eBird notable observations broken after server modularization: `EBIRD_API_KEY`
  / `EBIRD_REGION` / `BW_STATION_ID` weren't in route context
- BirdWeather events now show species name + confidence (tracked from SSE
  species lines that were filtered out before reaching the parser)
- Settings save: `birdnet.conf` cache (60s TTL) wasn't invalidated after write
- CSS variable `--card-bg` doesn't exist (correct name is `--bg-card`) — bell
  panel and dashboard zones were transparent
- Per-model species in dashboard: regex was matching timestamp brackets
  (`[11:50:35]`) instead of model name brackets (`[perch_v2_original]`)
- Phenology calendar now fills full card width (CSS grid + aspect-ratio)
- Inline phenology calendar removed from species.html (replaced by dedicated
  phenology.html page)
- Detection card photo enlarged (120 → 170px) with confidence ring (38 → 46px)
- Inference time `⚡` icon centered in dual AI cards
- Pipeline + Dual AI: removed BN/P2 text icons, replaced with top accent bar
  + colored model name (BirdNET blue / Perch teal)
- Removed all biloute references (old Pi4 retired) — engine.py, config.toml,
  backup.js: -209 lines of dead code
- Dashboard model labels now use shared `BIRDASH.MODEL_LABELS` (consistent
  variant names: Perch V2 FP32, FP16, INT8)
- Pipeline progress bar centered on dot row instead of crossing through dots
- Connector arrows between Mic/Engine/Detection removed (zones now share
  continuous borders)

### i18n
- 28+ new keys per language (FR/EN/DE/NL) for phenology, bell, update modal,
  action cards

## [1.1.0] — 2026-04-06

### Bird Flow — Live Pipeline Dashboard
- **New landing page** (`dashboard.html`) showing the detection pipeline in real-time
- Flow corridor layout: Mic → Engine → Detection with animated pulse connectors
- **Live audio levels** via SSE `/api/audio/monitor` with breathing glow
- **Dual AI cores** — BirdNET (blue) + Perch V2 (teal) with distinct visual identity
  - Per-model species name + confidence updated live from SSE logs
  - Consensus/divergence indicator when both models detect
- **Pipeline stages** — 4-stage animated flow (Listen → Record → Analyze → Store)
  with progress bar driven by real backend events
- **Latest detection card** with 130px photo, confidence ring, entrance animation
- **Recent species strip** — today's top 8 species with thumbnails
- **Key events feed** — curated from SSE logs, humanized messages
  - BirdWeather events show species + confidence
  - Technical log messages translated to readable French/English
- **KPIs** — detections today, unique species, review queue, system health
- **System status panel** — backlog, lag, sensitivity, recording length
- index.html now redirects to dashboard.html

### UX/UI Audit & Navigation Overhaul
- **6 navigation sections** (was 5): Home, Live, History, Species, Indicators, Station
- **22 pages in nav** (was 18): reintegrated recent, models, recordings (were orphaned)
- **Mobile drawer** — hamburger button opens bottom sheet with all sections/pages
- **Fixed 5 missing NAV_KEYS** — overview, calendar, favorites, weather, log were showing raw key names
- **Fixed mobile nav labels** — weather.html was labeled "Analyses" instead of "Météo"
- **Differentiated nav_timeline/nav_calendar** — were both "Calendrier" in French
- **Homogenized 9 page titles** — 9 English `<title>` tags translated to French
- **Cross-navigation** between settings and system pages (link tabs)

### SQL Query Library
- **`bird-queries.js`** — 51 centralized SQL queries covering all pages
  - Automatic confidence filtering via `BIRD_CONFIG.defaultConfidence`
  - `Q.buildWhere()` helper for parameterized WHERE clauses (replaces inline SQL string building)
  - Fixes SQL injection risk in stats.html (dates were inlined in SQL)
  - 27 queries migrated across 10 pages; 16 pages include the script
  - Organized by domain: general, dashboard, species, detections, temporal, overview, stats, biodiversity, analyses, gallery, rarities
- **Confidence filter harmonized** — dashboard was counting all detections (27 species) while other pages filtered at 70% (16 species); now consistent
- **Settings save fix** — birdnet.conf cache (60s TTL) was not invalidated after write; settings appeared to not save

### Bug Fixes
- **Rate limiting** — reduced dashboard polling from ~18 to ~8 req/min, debounced SSE-triggered refreshes
- **Perch V2 inference time** — regex was case-sensitive, never matched lowercase `perch_v2`
- **SSE log categorization** — API messages (`GET /api/flagged-detections`) were miscategorized as "detection"
- **Vue reactivity** — `Object.assign` instead of full ref replacement prevents data flickering
- **Species persistence** — model cards keep last detected species (dimmed) instead of clearing every 45s

### i18n
- 60+ new translation keys across FR/EN/DE/NL for dashboard, events, model status, navigation

## [1.0.1] — 2026-04-05

### Architecture
- **Server modularization** — server.js split from 5759 to 208 lines (-96%)
  - 11 route modules in `server/routes/` (audio, backup, data, detections, external, photos, settings, system, timeline, whats-new)
  - 3 library modules in `server/lib/` (alerts, config, db)
  - Route modules use `handle(req, res, pathname, ctx)` pattern with dependency injection
- All 141 tests pass unchanged

### Performance
- **i18n extraction** — translations moved from inline JS to `/i18n/*.json` (4 files, loaded async)
  - `bird-vue-core.js`: 218 KB → 62 KB (-72%)
  - Pages await `BIRDASH.ready` before mounting
- **SW cache v100** — precache updated with i18n files

### Code quality
- **`useAudioPlayer()` composable** — shared audio player with rAF progress, seeking, optional Web Audio filters
  - Migrated calendar, recent, today pages — removes ~150 lines of duplicated code
- **Lazy-loaded settings tabs** — settings.html split into 9 tab fragments (2872→1594 lines, -45%)
  - Tabs loaded on first activation via `defineAsyncComponent` + fetch
  - `provide`/`inject` shares reactive state, `keep-alive` caches DOM
- **SEC-05** — Service Worker registration errors now logged instead of silently swallowed

## [1.0.0] — 2026-04-04

First public release. Complete bird detection dashboard for Raspberry Pi.

### Dashboard (15 pages)

**New pages**
- **Calendar** — unified day-by-day view merging timeline + species list + audio player
- **Weather** — dedicated weather/activity correlation page with Pearson r, tomorrow's forecast, species by conditions
- **Log live** — real-time streaming log dashboard (SSE) with color-coded categories, filters, KPIs
- **Favorites** — dedicated page with KPIs, search, sort; heart toggle on all species lists

**Timeline (full-page)**
- Drag-to-zoom on density bar and sky canvas (infinite zoom, min 15 minutes)
- Unified bird density slider (0-100%) replacing separate controls
- SVG sunrise/sunset icons, emoji moon phases with illumination %
- Filter badges with count + blink highlight (10 pulses, opacity only)
- Clusters always expanded into individual markers (no more three-dot bubbles)
- Labels repositioned for high-confidence birds near top
- Zoom preserved when changing density slider
- No flash/spinner when changing slider

**Review**
- Full spectrogram modal with gain/highpass/lowpass filters and loop selection
- Select + delete permanently (DB + audio files) with preview modal and result report
- Purge all rejected with preview
- Badge counter in nav showing pending review count

**Species**
- Favorites system (SQLite-backed with API)
- Personal notes per species and per detection (SQLite)
- Phenology calendar (12-month dot map)
- Year-over-year monthly comparison chart
- Chart PNG export on all 5 charts
- Web Share API with HTTP fallback
- "Deep analysis" link to analyses page
- Swipe gestures on photo carousel

**Today**
- Gain/highpass/lowpass audio filters on spectrogram
- New species filter (clickable KPI + badge)
- URL parameter support (?species=X)

**Detections**
- Per-detection delete button
- New species and favorites filters

**Gallery**
- Tabs: Best catches + Audio library (absorbs recordings)
- New species badge and favorites toggle
- Improved card header (count + max confidence)

### Navigation restructured
- 5 intent-based sections: Live, History, Species, Insights, Station
- Mobile bottom nav bar (< 768px)
- Quick links bar on homepage with weather widget
- Global search supports dates ("3 avril", "03/04", "merle 3 avril")
- Notification bell with unseen count from /api/whats-new
- Review badge counter

### Architecture
- DSP code consolidated into bird-shared.js (-765 lines from 6 HTML files)
- Timeline rendering extracted to bird-timeline.js
- index.html reduced from 72KB to 56KB
- Favorites and notes migrated from localStorage to SQLite with API
- localStorage keys normalized to underscore format with auto-migration
- Service worker cache versioning (v1 → v92)

### Bug fixes
- SRI integrity on Vue CDN (index/timeline)
- authHeaders() in BirdImg (was ReferenceError)
- buildAudioUrl: encode all path segments (accents caused 404s)
- UTC→localDateStr for timeline dates
- Review page: apiBase→apiUrl (was undefined, page completely broken)
- Review badge: total now counts flagged items, not pre-filter rows
- firstday/nocturnal/best/firstyear events no longer absorbed by clusters (priority 1)
- "See this day" routes to calendar for past dates, today for current
- Share button works on HTTP (fallback to execCommand/prompt)
- sessionStorage cleanup: no more mutation during iteration
- onclick removed from safeHtml whitelist (XSS prevention)
- BIRDWEATHER_ID redacted from /api/settings response
- loadFavorites race condition fixed with promise lock
- navSectionClick no longer auto-navigates to first page

### i18n
- All new features translated in FR/EN/DE/NL
- Timeline density labels, filter types, log dashboard labels
- Settings tabs, backup steps, review workflow labels

### API
- `GET/POST /api/favorites` — list/add/remove favorites
- `GET/POST/DELETE /api/notes` — species and per-detection notes
- `GET /api/logs` — SSE stream from journalctl (3 services)
- `GET /api/timeline` — accepts `minConf` and `maxEvents` parameters
- `GET /api/weather` — now includes 2-day forecast
- `DELETE /api/detections` — returns deletion report with file list
- OG meta tags on all 18 HTML pages

### Documentation
- README.md (EN), README.fr.md (FR), README.de.md (DE), README.nl.md (NL) updated
- All screenshots section restructured by navigation sections

---

## [0.1.0] — 2026-03-19

Initial commit. Dashboard with basic detection display, species pages, recordings, statistics, biodiversity analysis, live spectrogram, model comparison, settings, system health.
