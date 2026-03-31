# BirdEngine — Detection Engine Documentation

## Architecture

BirdEngine is a Python-based bird vocalization detection engine designed for Raspberry Pi 5. It runs two ML models in parallel (dual-model), records audio locally, and integrates with BirdWeather, ntfy.sh notifications, and remote database sync.

```
USB Audio Interface
      │
      ▼
birdengine-recording.service (arecord → WAV 45s)
      │
      ▼ (watchdog detects new .wav files)
      │
engine.py ─── BirdEngine class
      │
      ├── Primary model (synchronous, fast)
      │   └── BirdNET V2.4 (~2s/file)
      │
      ├── Secondary model (background thread)
      │   └── Perch V2 INT8 (~12s/file)
      │
      └── Post-processing (async thread per file)
          ├── Write to local SQLite DB
          ├── Sync detections to remote DB (SSH)
          ├── Extract MP3 clip + spectrogram PNG
          ├── Upload to BirdWeather API
          └── Send smart notifications (ntfy.sh)
```

## Model Scoring — Critical Design Decisions

### BirdNET V2.4 (Sigmoid Scoring)

BirdNET outputs raw logits that are transformed via sigmoid:

```python
probs = 1.0 / (1.0 + np.exp(-sensitivity * logits))
```

This is a **multi-label** approach:
- Each species gets an **independent** score between 0 and 1
- Multiple species can have high scores simultaneously
- Score interpretation: 0.95 = high confidence, 0.70 = plausible, 0.20 = unlikely
- **Threshold: 0.65** (configurable via `birdnet_confidence`)

### Perch V2 (Bird-Only Softmax Scoring)

Perch V2 outputs logits for ~14,795 classes (birds + frogs + insects + mammals). Our implementation applies a **bird-only softmax**:

```python
# Step 1: Filter to bird species BEFORE softmax
bird_logits = logits[bird_indices]  # 10,340 bird species

# Step 2: Temperature-scaled softmax on birds only
scaled = (bird_logits - max(bird_logits)) / temperature
probs = exp(scaled) / sum(exp(scaled))
```

**Why bird-only softmax matters:**

With the original all-class softmax (14,795 classes), probability mass was diluted across insects, frogs, and mammals. A bird with strong logits would still get a low softmax score because thousands of non-bird classes shared the probability distribution.

| Approach | Typical top-1 score | Usable threshold |
|---|---|---|
| All-class softmax (original) | 20-30% | ~0.08-0.15 |
| **Bird-only softmax (current)** | **70-95%** | **0.15** |

The bird-only approach gives scores that are:
- More interpretable (a score of 0.72 means "72% probability among all birds")
- Higher and more discriminative
- Compatible with a reasonable threshold

### Decision Logic

For each audio chunk, the engine applies model-specific decision rules:

**BirdNET:**
```
if sigmoid_score >= 0.65 → accept detection
```

**Perch:**
```
if softmax_score >= 0.15 AND (top1_score - top2_score) >= 0.05 → accept
```

The **margin check** (top1 - top2 >= 0.05) rejects ambiguous predictions where the model hesitates between similar species. This is important because softmax scores are **competitive** — a strong detection should clearly dominate.

Example of a good Perch detection:
```
Merle noir:     0.42  ← accepted (margin = 0.33)
Grive musicienne: 0.09
Pouillot véloce:  0.04
```

Example of an ambiguous detection (rejected):
```
Merle noir:     0.14  ← rejected (margin = 0.01)
Grive musicienne: 0.13
Pouillot véloce:  0.11
```

## Temperature Parameter

The Perch softmax uses a temperature parameter derived from the sensitivity setting:

```python
temperature = max(0.25, 2.0 - sensitivity)
```

| Sensitivity | Temperature | Effect |
|---|---|---|
| 0.5 | 1.50 | Softer distribution, fewer detections |
| 1.0 | 1.00 | Neutral |
| 1.3 | 0.70 | Sharper, more detections (recommended) |
| 1.5 | 0.50 | Very sharp, most sensitive |

Lower temperature = sharper probability distribution = higher top-1 scores = more detections above threshold.

## Geographic Filter (MData Model)

Both BirdNET and Perch use a geographic species filter via BirdNET's MData model:

```python
species_list = model.get_species_list(latitude, longitude, week)
```

The MData model predicts which species are likely present at a given location and week of the year. Detections of species not in this list are filtered out, reducing false positives from geographically impossible species.

Two MData model versions are available:
- **V1** (`BirdNET_GLOBAL_6K_V2.4_MData_Model_FP16`) — original
- **V2** (`BirdNET_GLOBAL_6K_V2.4_MData_Model_V2_FP16`) — improved (recommended)

## Dual-Model Pipeline

### Why Two Models?

| | BirdNET V2.4 | Perch V2 INT8 |
|---|---|---|
| Speed | **~2s** per file | ~12s per file |
| Species | 6,500 | 10,340 (birds only) |
| Scoring | Sigmoid (independent) | Softmax (competitive) |
| Strengths | Fast, well-tested, good for common species | More species, better for rare/quiet birds |

Running both models on every audio file maximizes detection coverage. BirdNET catches common species quickly, while Perch finds additional species that BirdNET misses.

### Threading Model

```
Main thread          Secondary thread       Post-processing threads
     │                      │                        │
     ├── read WAV           │                        │
     ├── BirdNET inference  │                        │
     ├── move to processed/ │                        │
     ├── queue to secondary ├── Perch inference      │
     ├── spawn post-proc ───┤                   ├── sync DB
     │   (non-blocking)     ├── spawn post-proc ├── extract MP3
     ├── next WAV...        │   (non-blocking)  ├── BirdWeather
     │                      ├── next WAV...     ├── notifications
```

Post-processing (DB sync, MP3 extraction, BirdWeather upload, notifications) runs in **daemon threads** to avoid blocking the inference pipeline. This keeps BirdNET at ~2s/file even when there are many detections.

## Audio Processing

### Recording

Audio is captured via `arecord` using the ALSA `dsnoop` device for shared access:

```bash
arecord -D birdash -f S16_LE -c 2 -r 48000 -t wav --max-file-time 45
```

- Format: 16-bit signed LE, stereo, 48 kHz
- Duration: 45 seconds per file
- Stereo is converted to mono in engine.py before inference

### Resampling

BirdNET expects 48 kHz, Perch expects 32 kHz. The engine reads at native 48 kHz and resamples for Perch using `resampy` (Kaiser filter).

### Chunk Splitting

Audio is split into overlapping chunks for inference:

| Model | Chunk duration | Overlap | Chunks per 45s file |
|---|---|---|---|
| BirdNET | 3.0s | 0.5s | 18 |
| Perch | 5.0s | 0.5s | 10 |

Short chunks (< 1.5s) at the end are discarded. Chunks shorter than the full duration are zero-padded.

## Perch V2 INT8 Quantization

The quantized model was created using TFLite Calibrator with dynamic range quantization:

```python
calib = calibrator.Calibrator(model_content)
calib._feed_tensors(representative_dataset, False)
quantized = calib._calibrator.QuantizeModel(
    np.dtype("float32").num,  # input type
    np.dtype("float32").num,  # output type
    True,                     # allow_float
    "TFLITE_BUILTINS"         # operator set
)
```

This is a **weight dequantization** approach (float32 → int8 → float32 in weights), not a full integer quantization. Benefits:
- ~30% faster inference on ARM64 (better cache utilization)
- Same file format compatibility (TFLite FP32 input/output)
- < 0.5% accuracy loss on tested species

Published at: [ernensbjorn/perch-v2-int8-tflite](https://huggingface.co/ernensbjorn/perch-v2-int8-tflite)

## BirdWeather Integration

For each file with detections, the engine:

1. Converts WAV to FLAC (smaller for upload)
2. POSTs the soundscape to `app.birdweather.com/api/v1/stations/{id}/soundscapes`
3. For each detection, POSTs to `app.birdweather.com/api/v1/stations/{id}/detections`

Both primary and secondary model detections are uploaded separately.

## Smart Notifications

The notification system reads rules from `/etc/birdnet/birdnet.conf`:

| Rule | Priority | Typical volume |
|---|---|---|
| Rare species (< N total detections) | High | 0-2/day |
| First of season (absent > 30 days) | High | 0-5/day |
| New species (never seen) | Urgent | ~0/day |
| First of day (each species once) | Low | ~50/day (noisy) |

Species counts and last-seen dates are cached from the SQLite database at startup. The cache is updated with each detection, avoiding repeated DB queries.

## Configuration Reference

### config.toml

```toml
[station]
name = "My Station"
latitude = 49.6967
longitude = 5.7445
language = "fr"

[audio]
source = "local"              # "local" or "rsync"
incoming_dir = "~/birdash/engine/audio/incoming"
processed_dir = "~/birdash/engine/audio/processed"

[detection]
model = "BirdNET_GLOBAL_6K_V2.4_Model_FP16"
secondary_model = "Perch_v2_int8"
birdnet_confidence = 0.65     # sigmoid threshold for BirdNET
perch_confidence = 0.15       # softmax threshold for Perch
perch_min_margin = 0.05       # min top1-top2 gap for Perch
sensitivity = 1.3             # affects temperature (Perch) and sigmoid (BirdNET)
overlap = 0.5                 # chunk overlap in seconds
sf_thresh = 0.03              # geographic filter threshold
mdata_version = 2             # MData model version (1 or 2)

[notifications]
ntfy_url = "https://ntfy.sh/my-topic"
notify_new_species_daily = true
cooldown_seconds = 300

[birdweather]
station_id = "my_station_id"
enabled = true

[output]
local_db = "~/birdash/data/birds.db"
sync_to_biloute = false
```

### /etc/birdnet/birdnet.conf (shared with birdash UI)

```ini
MODEL=BirdNET_GLOBAL_6K_V2.4_Model_FP16
DUAL_MODEL_ENABLED=1
SECONDARY_MODEL=Perch_v2_int8
SENSITIVITY=1.3
CONFIDENCE=0.7
NOTIFY_ENABLED=1
NOTIFY_RARE_SPECIES=1
NOTIFY_RARE_THRESHOLD=10
NOTIFY_FIRST_SEASON=1
NOTIFY_SEASON_DAYS=30
AUDIO_RETENTION_DAYS=90
```

BirdEngine reads `MODEL`, `DUAL_MODEL_ENABLED`, and `SECONDARY_MODEL` from birdnet.conf every ~5 minutes for hot-reload. Other detection parameters come from config.toml.

## File Structure

```
engine/
├── engine.py                  # Main engine (1100+ lines)
├── config.toml                # Local configuration (not in git)
├── config.toml.example        # Template for new installations
├── record.sh                  # Audio capture via arecord
├── purge_audio.sh             # Disk space management (cron daily)
├── quantize_perch_mac.py      # Quantization script (run on Mac/x86)
├── birdengine.service         # systemd service
├── birdengine-recording.service
├── ttyd.service               # Web terminal
├── venv/                      # Python virtual environment (not in git)
├── audio/
│   ├── incoming/              # New WAV files from recording
│   └── processed/             # Analyzed WAV files (auto-purged after 1h)
└── models/                    # TFLite models (not in git)
    ├── BirdNET_GLOBAL_6K_V2.4_Model_FP16.tflite
    ├── BirdNET_GLOBAL_6K_V2.4_Model_FP16_Labels.txt
    ├── BirdNET_GLOBAL_6K_V2.4_MData_Model_V2_FP16.tflite
    ├── Perch_v2_int8.tflite
    ├── Perch_v2_int8_Labels.txt
    ├── Perch_v2_int8_bird_indices.json
    └── l18n/                  # Species name translations (36 languages)
```
