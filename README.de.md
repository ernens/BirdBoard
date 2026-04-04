# 🐦 Birdash

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Modernes Vogelerkennungs-Dashboard und Engine fur Raspberry Pi 5. Eigenstandige Dual-Modell-Architektur mit BirdNET V2.4 + Perch V2.

> [English](README.md) | [Francais](README.fr.md) | [Nederlands](README.nl.md)

## Funktionen

- 🤖 **Dual-Modell-Inferenz** — BirdNET V2.4 + Perch V2 parallel
- 🌅 **Timeline** — Ganzseitige Timeline mit Drag-to-Zoom, einheitlicher Dichte-Slider, SVG-Icons, Filter-Badges mit Blink
- 📆 **Kalender** — Vereinigte Tagesansicht mit Timeline + Artenliste + Audioplayer
- 🌦️ **Wetter** — Korrelationsanalyse (Pearson r), Prognose, Arten nach Bedingungen
- 🎵 **Live-Spektrogramm** — Echtzeit-Audio mit Vogelnamen
- 🔍 **Uberprufung** — Auto-Flagging, Spektrogramm-Modal mit Filtern und Loop-Auswahl, Loschen mit Vorschau
- ⭐ **Favoriten** (SQLite) + 📝 **Notizen** pro Art und pro Erkennung
- 🦜 **Artenkarten** — Phonologie-Kalender, Jahresvergleich, PNG-Export
- 📱 **Mobil** — Bottom-Navigation, Touch-Gesten, globale Suche (Art + Datum)
- 🔔 **Benachrichtigungen** — ntfy.sh + In-App-Glocke
- 💻 **Web-Terminal** — Bash im Browser
- 💾 **Backup** — NFS/SMB/SFTP/S3/GDrive/WebDAV
- 🌍 4 UI-Sprachen (FR/EN/NL/DE) + 36 Sprachen fur Artnamen

## Optimierte Perch V2 Modelle

3 optimierte Varianten von Google Perch V2 (FP32, FP16, INT8) fur Raspberry Pi:

**[ernensbjorn/perch-v2-int8-tflite](https://huggingface.co/ernensbjorn/perch-v2-int8-tflite)** auf HuggingFace

## Installation

```bash
cd ~
git clone https://github.com/ernens/birdash.git
cd birdash
chmod +x install.sh
./install.sh
```

Das Installationsskript erledigt alles automatisch. Bearbeiten Sie danach:
1. `/etc/birdnet/birdnet.conf` — Koordinaten, Sprache
2. `engine/config.toml` — Station, BirdWeather, ntfy
3. `public/js/birdash-local.js` — Standort, eBird API Key

Dienste starten:
```bash
sudo systemctl enable --now birdengine-recording birdengine birdash caddy ttyd
```

Dashboard: `http://ihr-pi.local/birds/`

## Tests

```bash
npm test                    # 46 Node.js Tests
cd engine && ../engine/venv/bin/python -m unittest test_engine -v  # 13 Python Tests
```

## Lizenz

[MIT](LICENSE)
