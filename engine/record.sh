#!/bin/bash
# BirdEngine recording — captures WAV files from the configured audio device
# Device is read from audio_config.json (set via Settings → Audio)

BIRDASH_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$BIRDASH_DIR/config/audio_config.json"
RECORDING_LENGTH=45
OUTPUT_DIR="$BIRDASH_DIR/engine/audio/incoming"

# Read device from audio_config.json
if [ -f "$CONFIG" ]; then
    DEVICE=$(python3 -c "import json; print(json.load(open('$CONFIG')).get('device_id','default'))" 2>/dev/null)
    CHANNELS=$(python3 -c "import json; print(json.load(open('$CONFIG')).get('input_channels', 2))" 2>/dev/null)
    SAMPLE_RATE=$(python3 -c "import json; print(json.load(open('$CONFIG')).get('capture_sample_rate', 48000))" 2>/dev/null)
fi

# Fallback to defaults
DEVICE=${DEVICE:-default}
CHANNELS=${CHANNELS:-2}
SAMPLE_RATE=${SAMPLE_RATE:-48000}

mkdir -p "$OUTPUT_DIR"

echo "[record] Device: $DEVICE"
echo "[record] Channels: $CHANNELS, Rate: ${SAMPLE_RATE}Hz, Length: ${RECORDING_LENGTH}s"
echo "[record] Output: $OUTPUT_DIR"

exec arecord \
  -D "$DEVICE" \
  -f S16_LE \
  -c "$CHANNELS" \
  -r "$SAMPLE_RATE" \
  -t wav \
  --max-file-time "$RECORDING_LENGTH" \
  --use-strftime \
  "$OUTPUT_DIR/%F-birdnet-%H:%M:%S.wav"
