# Changelog

All notable changes to BirdStation are documented here.

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
