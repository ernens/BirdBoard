# 🐦 Birdash

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Modern vogeldetectie-dashboard en engine voor Raspberry Pi 5. Zelfstandige dual-model architectuur met BirdNET V2.4 + Perch V2.

> [English](README.md) | [Francais](README.fr.md) | [Deutsch](README.de.md)

## Kenmerken

- 🤖 **Dual-model inferentie** — BirdNET V2.4 + Perch V2 parallel
- 🌅 **Timeline** — volledig scherm met drag-to-zoom, uniforme dichtheidsslider, SVG-iconen, filter-badges met knippermarkering
- 📆 **Kalender** — uniforme dagweergave met timeline + soortenlijst + audiospeler
- 🌦️ **Weer** — correlatieanalyse (Pearson r), prognose, soorten per omstandigheden
- 🎵 **Live spectrogram** — real-time audio met vogelnamen
- 🔍 **Review** — auto-flagging, spectrogram-modal met filters en loop-selectie, verwijderen met voorbeeldweergave
- ⭐ **Favorieten** (SQLite) + 📝 **Notities** per soort en per detectie
- 🦜 **Soortkaarten** — fenologiekalender, jaarlijkse vergelijking, PNG-export
- 📱 **Mobiel** — navigatiebalk onderaan, veeggebaren, globale zoekfunctie (soort + datum)
- 🔔 **Meldingen** — ntfy.sh + in-app belletje
- 💻 **Web terminal** — bash in browser
- 💾 **Backup** — NFS/SMB/SFTP/S3/GDrive/WebDAV
- 🌍 4 UI-talen (FR/EN/NL/DE) + 36 talen voor soortnamen

## Geoptimaliseerde Perch V2 Modellen

3 geoptimaliseerde varianten van Google Perch V2 (FP32, FP16, INT8) voor Raspberry Pi:

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
npm test                    # 46 Node.js-tests
cd engine && ../engine/venv/bin/python -m unittest test_engine -v  # 13 Python tests
```

## Licentie

[MIT](LICENSE)
