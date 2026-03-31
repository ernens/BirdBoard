# 🐦 Birdash

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Modernes Vogelerkennungs-Dashboard und Engine fur Raspberry Pi 5. Eigenstandige Dual-Modell-Architektur mit BirdNET V2.4 + Perch V2.

> [English](README.md) | [Francais](README.fr.md) | [Nederlands](README.nl.md)

## Funktionen

- 🤖 **Dual-Modell-Inferenz** — BirdNET V2.4 + Perch V2 INT8 parallel
- 🎵 **Live-Spektrogramm** — Echtzeit-Audio mit Vogelnamen
- 🔍 **Erkennungsuberprufung** — Auto-Flagging + Massenaktionen
- 🤖 **Modellvergleich** — Seite-an-Seite-Analyse
- 🎙️ **Audiokonfiguration** — Gerat, Profile, Kalibrierung
- 🎚️ **Adaptive Normalisierung** — automatischer Software-Gain, Clipping-Schutz, Beobachtermodus
- 🔇 **Audiofilter** — Hochpass + Tiefpass (Bandpass), spektrale Rauschunterdruckung, RMS-Normalisierung
- 🔔 **Intelligente Benachrichtigungen** — nur seltene Arten (ntfy.sh)
- 📡 **BirdWeather** — automatischer Upload
- 💻 **Web-Terminal** — Bash im Browser, unterstutzt Claude Code
- 💾 **Backup** — NFS/SMB/SFTP/S3/GDrive/WebDAV
- 🌍 4 UI-Sprachen (FR/EN/NL/DE) + 36 Sprachen fur Artnamen

## Quantisiertes Modell

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
npm test                    # 40 Node.js Tests
cd engine && ../engine/venv/bin/python -m unittest test_engine -v  # 13 Python Tests
```

## Lizenz

[MIT](LICENSE)

## Lizenz

[MIT](LICENSE)
