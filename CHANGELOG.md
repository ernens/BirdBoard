# Changelog

All notable changes to BirdStation are documented here.

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
