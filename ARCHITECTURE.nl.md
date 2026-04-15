# BirdStation Architectuur

> [English](ARCHITECTURE.md) | [Français](ARCHITECTURE.fr.md) | [Deutsch](ARCHITECTURE.de.md)

Uitgebreide technische referentie van het BirdStation-systeem (birdash) — een zelfstandig vogeldetectie-dashboard en engine voor Raspberry Pi.

> Dit document wordt om technische consistentie in het Engels onderhouden. De volledige versie vindt u in [ARCHITECTURE.md](ARCHITECTURE.md).

## Samenvatting

```
Raspberry Pi 5 + SSD
├── USB Audio-interface (microfoon)
│     ↓
├── BirdEngine (Python)
│   ├── Opnamedienst (arecord → WAV 45s)
│   ├── Audio-pipeline: Adaptieve versterking → Hoogdoorlaat → Laagdoorlaat
│   │   → Geluidsprofiel-subtractie → RMS-normalisatie
│   ├── BirdNET V2.4 (primair, ~2s/bestand)
│   ├── Perch V2 FP16 (secundair, ~2s/bestand)
│   ├── MP3-extractie + spectrogrammen
│   └── BirdWeather-upload
│
├── Birdash (Node.js)
│   ├── Dashboard-API (poort 7474)
│   ├── Live spectrogram (PCM + MP3-stream)
│   ├── Pushmeldingen via Apprise (100+ diensten)
│   ├── Worker-thread voor What's New (niet-blokkerend)
│   ├── Community-telemetrie (Supabase, opt-in)
│   └── Bugrapportage (GitHub Issues)
│
├── Caddy (reverse proxy :80)
├── ttyd (webterminal)
└── SQLite (1M+ detecties)
```

### Belangrijkste componenten

| Component | Technologie | Rol |
|-----------|------------|-----|
| **BirdEngine** | Python 3 + TFLite | Audio-opname, filtering, dual-model inferentie |
| **Birdash** | Node.js + better-sqlite3 | REST-API, 18 Vue 3-pagina's, cache, aggregaten |
| **Caddy** | Go | Reverse proxy HTTPS, gzip, statische bestanden |
| **SQLite** | C | Detecties, validaties, taxonomie |
| **Supabase** | PostgreSQL | Community-netwerk (opt-in telemetrie) |

### Audio-pipeline

```
🎤 Microfoon → Adaptieve versterking → Hoogdoorlaat → Laagdoorlaat → Geluidsprofiel / Auto-denoise → RMS → 🐦 BirdNET + Perch
```

### Dashboard-pagina's (18)

| Sectie | Pagina's |
|--------|----------|
| Home | Overzicht, Vandaag |
| Live | Bird Flow, Live Board, Spectrogram, Logboek |
| Geschiedenis | Kalender (maandraster), Tijdlijn, Detecties, Review |
| Soorten | Soortenkaarten, Opnamen (Bibliotheek + Beste), Zeldzaamheden, Favorieten |
| Indicatoren | Weer, Statistieken + Diversiteit (tabs), Analyses, Fenologie, Vergelijking |
| Station | Instellingen (9 tabbladen), Systeem |

→ **[Volledige technische documentatie lezen (EN)](ARCHITECTURE.md)**
