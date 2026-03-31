# 🐦 Birdash

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Modern vogeldetectie-dashboard en engine voor Raspberry Pi 5. Zelfstandige dual-model architectuur met BirdNET V2.4 + Perch V2.

> [English](README.md) | [Francais](README.fr.md) | [Deutsch](README.de.md)

## Kenmerken

- 🤖 **Dual-model inferentie** — BirdNET V2.4 + Perch V2 INT8 parallel
- 🎵 **Live spectrogram** — real-time audio met vogelnamen
- 🔍 **Detectie review** — auto-flagging + bulk acties
- 🤖 **Model vergelijking** — zij-aan-zij analyse
- 🎙️ **Audio configuratie** — apparaat, profielen, kalibratie
- 🎚️ **Adaptieve normalisatie** — automatische softwaregain, clippingbescherming, observatiemodus
- 🔇 **Audiofilters** — hoogdoorlaat + laagdoorlaat (bandpass), spectrale ruisonderdrukking, RMS-normalisatie
- 🔔 **Slimme meldingen** — alleen zeldzame soorten (ntfy.sh)
- 📡 **BirdWeather** — automatische upload
- 💻 **Web terminal** — bash in browser, ondersteunt Claude Code
- 💾 **Backup** — NFS/SMB/SFTP/S3/GDrive/WebDAV
- 🌍 4 UI-talen (FR/EN/NL/DE) + 36 talen voor soortnamen

## Gekwantiseerd model

**[ernensbjorn/perch-v2-int8-tflite](https://huggingface.co/ernensbjorn/perch-v2-int8-tflite)** op HuggingFace

## Installatie

```bash
cd ~
git clone https://github.com/ernens/birdash.git
cd birdash
chmod +x install.sh
./install.sh
```

Het installatiescript regelt alles automatisch. Bewerk daarna:
1. `/etc/birdnet/birdnet.conf` — coordinaten, taal
2. `engine/config.toml` — station, BirdWeather, ntfy
3. `public/js/birdash-local.js` — locatie, eBird API key

Start de services:
```bash
sudo systemctl enable --now birdengine-recording birdengine birdash caddy ttyd
```

Dashboard: `http://jouw-pi.local/birds/`

## Tests

```bash
npm test                    # 40 Node.js tests
cd engine && ../engine/venv/bin/python -m unittest test_engine -v  # 13 Python tests
```

## Licentie

[MIT](LICENSE)

## Licentie

[MIT](LICENSE)
