#!/usr/bin/env python3
"""range_filter_cli.py — preview the BirdNET MData range filter.

Loads the BirdNET MData TFLite model, asks it which species are expected
at a given location during a given week with a given threshold, and
prints the result as JSON.

Used by `GET /api/range-filter/preview` so the user can SEE what the
slider in Settings → Detection actually does — instead of just trusting
a magic 0.03 number.

Usage:
  range_filter_cli.py --lat 49.7 --lon 5.74 --week 16 --threshold 0.03 \\
                      --models-dir ./models \\
                      [--mdata-version 2] [--lang fr]

JSON output:
  {
    "week": 16,
    "threshold": 0.03,
    "lat": 49.7, "lon": 5.74,
    "model_version": 2,
    "species_count": 247,
    "species": [
      {"sci": "Turdus merula", "com": "Merle noir"},
      ...
    ]
  }
"""

import argparse
import json
import os
import sys

# Reuse the existing wrappers from engine.py — keeps a single source of
# truth for the MData model loading / inference path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from engine import MDataModel, load_labels, load_language


def parse_args():
    p = argparse.ArgumentParser(description="BirdNET range filter preview")
    p.add_argument("--lat", type=float, required=True)
    p.add_argument("--lon", type=float, required=True)
    p.add_argument("--week", type=int, required=True, help="ISO week 1-48 (BirdNET MData uses 48-week year)")
    p.add_argument("--threshold", type=float, default=0.03)
    p.add_argument("--models-dir", required=True)
    p.add_argument("--mdata-version", type=int, default=2, choices=[1, 2])
    p.add_argument("--lang", default="fr")
    return p.parse_args()


def main():
    args = parse_args()

    mdata_name = ("BirdNET_GLOBAL_6K_V2.4_MData_Model_FP16"
                  if args.mdata_version == 1
                  else "BirdNET_GLOBAL_6K_V2.4_MData_Model_V2_FP16")
    mdata_path = os.path.join(args.models_dir, f"{mdata_name}.tflite")
    if not os.path.exists(mdata_path):
        print(json.dumps({
            "error": "mdata_model_missing",
            "path": mdata_path,
        }))
        sys.exit(2)

    # The MData model uses BirdNET V2.4 labels — same naming.
    birdnet_name = "BirdNET_GLOBAL_6K_V2.4_Model_FP16"
    labels = load_labels(birdnet_name, args.models_dir)

    # Common-name lookup (best-effort — falls back to en if requested lang
    # isn't available).
    try:
        names = load_language(args.lang, args.models_dir)
    except FileNotFoundError:
        try:
            names = load_language("en", args.models_dir)
        except FileNotFoundError:
            names = {}

    mdata = MDataModel(mdata_path, args.threshold)
    species_sci = mdata.get_species_list(labels, args.lat, args.lon, args.week)

    species = [{"sci": sci, "com": names.get(sci, sci)} for sci in species_sci]

    out = {
        "week": args.week,
        "threshold": args.threshold,
        "lat": args.lat,
        "lon": args.lon,
        "model_version": args.mdata_version,
        "lang": args.lang,
        "species_count": len(species),
        "species": species,
    }
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        # Always emit valid JSON so the Node caller can parse the failure
        print(json.dumps({"error": "exception", "message": str(e)}))
        sys.exit(1)
