#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# download_birdnet.sh — Fetch BirdNET V2.4 models + l18n species labels
#
# Usage:
#   download_birdnet.sh <models_dir>
#
# Source: birdnetlib pip package (bundles the official TFLite models) and
# BirdNET-Analyzer GitHub repo (species label translations).
#
# License note:
#   BirdNET V2.4 is distributed under CC-BY-NC-SA 4.0 (non-commercial use).
#   See https://github.com/kahst/BirdNET-Analyzer for full terms.
#
# Idempotent: exits 0 without re-downloading if FP32 model already present.
# ══════════════════════════════════════════════════════════════════════════

set -e

MODELS_DIR="${1:-}"
if [ -z "$MODELS_DIR" ]; then
    echo "Usage: $0 <models_dir>" >&2
    exit 2
fi

FP32="$MODELS_DIR/BirdNET_GLOBAL_6K_V2.4_Model_FP32.tflite"
L18N_DIR="$MODELS_DIR/l18n"

# Already installed?
if [ -f "$FP32" ] && [ "$(stat -c %s "$FP32" 2>/dev/null || echo 0)" -gt 1000000 ] \
   && [ -f "$L18N_DIR/labels_en.json" ]; then
    echo "✓ BirdNET already installed at $MODELS_DIR"
    exit 0
fi

mkdir -p "$MODELS_DIR" "$L18N_DIR"

echo "▶ Creating temporary venv for birdnetlib..."
VENV_DIR="$(mktemp -d -t birdnet-dl-XXXXXX)"
trap 'rm -rf "$VENV_DIR"' EXIT

python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/pip" install --quiet --disable-pip-version-check birdnetlib

SITE_PKG="$("$VENV_DIR/bin/python3" -c 'import birdnetlib, os; print(os.path.dirname(birdnetlib.__file__))')"
ANALYZER_DIR="$SITE_PKG/models/analyzer"

if [ ! -f "$ANALYZER_DIR/BirdNET_GLOBAL_6K_V2.4_Model_FP32.tflite" ]; then
    echo "✗ birdnetlib did not bundle the expected TFLite models" >&2
    exit 1
fi

echo "▶ Copying BirdNET V2.4 models..."
cp "$ANALYZER_DIR/BirdNET_GLOBAL_6K_V2.4_Model_FP32.tflite"         "$MODELS_DIR/"
cp "$ANALYZER_DIR/BirdNET_GLOBAL_6K_V2.4_MData_Model_V2_FP16.tflite" "$MODELS_DIR/"
cp "$ANALYZER_DIR/BirdNET_GLOBAL_6K_V2.4_Labels.txt" \
   "$MODELS_DIR/BirdNET_GLOBAL_6K_V2.4_Model_FP16_Labels.txt"

# FP16 symlink for engine compatibility
ln -sf "BirdNET_GLOBAL_6K_V2.4_Model_FP32.tflite" \
       "$MODELS_DIR/BirdNET_GLOBAL_6K_V2.4_Model_FP16.tflite"

echo "▶ Downloading l18n species label translations..."
"$VENV_DIR/bin/python3" - "$L18N_DIR" <<'PY'
import sys, os, json, urllib.request
out_dir = sys.argv[1]
langs = ['af','ar','bg','ca','cs','da','de','el','en_uk','en_us','es','et',
         'fi','fr','gl','he','hr','hu','id','is','it','ja','ko','lt','lv',
         'nl','no','pl','pt_br','pt','ro','ru','sk','sl','sr','sv','th',
         'tr','uk','zh']
base = ('https://raw.githubusercontent.com/birdnet-team/BirdNET-Analyzer/'
        'main/birdnet_analyzer/labels/V2.4/'
        'BirdNET_GLOBAL_6K_V2.4_Labels_{}.txt')
ok = 0
for lang in langs:
    try:
        data = urllib.request.urlopen(base.format(lang), timeout=20).read().decode('utf-8')
        d = {}
        for line in data.strip().split('\n'):
            parts = line.split('_', 1)
            if len(parts) == 2:
                d[parts[0]] = parts[1]
        fname = 'labels_' + lang.replace('_', '-') + '.json'
        with open(os.path.join(out_dir, fname), 'w', encoding='utf-8') as f:
            json.dump(d, f, ensure_ascii=False, indent=2)
        ok += 1
    except Exception as e:
        print(f'  ! {lang}: {e}', file=sys.stderr)
print(f'  → {ok}/{len(langs)} label files downloaded')
PY

# Ensure labels_en.json exists (engine default) — fall back to en-us or en-uk
if [ ! -f "$L18N_DIR/labels_en.json" ]; then
    if   [ -f "$L18N_DIR/labels_en-us.json" ]; then
        cp "$L18N_DIR/labels_en-us.json" "$L18N_DIR/labels_en.json"
    elif [ -f "$L18N_DIR/labels_en-uk.json" ]; then
        cp "$L18N_DIR/labels_en-uk.json" "$L18N_DIR/labels_en.json"
    fi
fi

echo "✓ BirdNET V2.4 installed at $MODELS_DIR"
