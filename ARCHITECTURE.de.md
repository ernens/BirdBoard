# BirdStation Architektur

> [English](ARCHITECTURE.md) | [Français](ARCHITECTURE.fr.md) | [Nederlands](ARCHITECTURE.nl.md)

Umfassende technische Referenz des BirdStation-Systems (birdash) — ein eigenständiges Vogelerkennungs-Dashboard und Engine für Raspberry Pi.

> Dieses Dokument wird aus Gründen der technischen Konsistenz auf Englisch gepflegt. Die vollständige Version finden Sie in [ARCHITECTURE.md](ARCHITECTURE.md).

## Zusammenfassung

```
Raspberry Pi 5 + SSD
├── USB-Audio-Interface (Mikrofon)
│     ↓
├── BirdEngine (Python)
│   ├── Aufnahmedienst (arecord → WAV 45s)
│   ├── Audio-Pipeline: Adaptive Verstärkung → Hochpass → Tiefpass
│   │   → Geräuschprofil-Subtraktion → RMS-Normalisierung
│   ├── BirdNET V2.4 (primär, ~2s/Datei)
│   ├── Perch V2 FP16 (sekundär, ~2s/Datei)
│   ├── MP3-Extraktion + Spektrogramme
│   └── BirdWeather-Upload
│
├── Birdash (Node.js)
│   ├── Dashboard-API (Port 7474)
│   ├── Live-Spektrogramm (PCM + MP3-Stream)
│   ├── Push-Benachrichtigungen via Apprise (100+ Dienste)
│   ├── Worker-Thread für What's New (nicht-blockierend)
│   ├── Community-Telemetrie (Supabase, Opt-in)
│   └── Bug-Meldung (GitHub Issues)
│
├── Caddy (Reverse-Proxy :80)
├── ttyd (Web-Terminal)
└── SQLite (1M+ Erkennungen)
```

### Schlüsselkomponenten

| Komponente | Technologie | Rolle |
|-----------|------------|------|
| **BirdEngine** | Python 3 + TFLite | Audioaufnahme, Filterung, Dual-Model-Inferenz |
| **Birdash** | Node.js + better-sqlite3 | REST-API, 18 Vue-3-Seiten, Cache, Aggregate |
| **Caddy** | Go | Reverse-Proxy HTTPS, Gzip, statische Dateien |
| **SQLite** | C | Erkennung, Validierung, Taxonomie |
| **Supabase** | PostgreSQL | Community-Netzwerk (Opt-in-Telemetrie) |

### Audio-Pipeline

```
🎤 Mikrofon → Adaptive Verstärkung → Hochpass → Tiefpass → Geräuschprofil / Auto-Denoise → RMS → 🐦 BirdNET + Perch
```

### Dashboard-Seiten (18)

| Bereich | Seiten |
|---------|--------|
| Startseite | Übersicht, Heute |
| Live | Bird Flow, Live Board, Spektrogramm, Protokoll |
| Verlauf | Kalender (Monatsraster), Timeline, Erkennungen, Überprüfung |
| Arten | Artenkarten, Aufnahmen (Bibliothek + Beste), Seltenheiten, Favoriten |
| Indikatoren | Wetter, Statistiken + Diversität (Tabs), Analysen, Phänologie, Vergleich |
| Station | Einstellungen (9 Tabs), System |

→ **[Vollständige technische Dokumentation lesen (EN)](ARCHITECTURE.md)**
