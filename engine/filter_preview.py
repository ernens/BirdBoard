#!/usr/bin/env python3
"""Generate before/after spectrograms for audio filter preview.

Usage: filter_preview.py <wav_path> <json_config>
Outputs JSON: {"before": "data:image/png;base64,...", "after": "data:image/png;base64,..."}

Uses the same plasma colormap and percentile normalization as the JS frontend.
"""
import base64
import io
import json
import sys

import numpy as np
import matplotlib
matplotlib.use("Agg")
from matplotlib.colors import LinearSegmentedColormap
import matplotlib.pyplot as plt
from scipy.signal import stft, butter, sosfilt

# ── Plasma colormap matching bird-shared.js buildColorLUT() ──────────────
_PLASMA_STOPS = [
    (0.00, (0, 0, 0)),
    (0.10, (20, 0, 50)),
    (0.25, (80, 0, 100)),
    (0.42, (180, 20, 80)),
    (0.58, (230, 70, 20)),
    (0.75, (255, 155, 0)),
    (0.90, (255, 230, 70)),
    (1.00, (255, 255, 255)),
]

_CMAP = LinearSegmentedColormap.from_list("birdash_plasma", [
    (pos, (r / 255, g / 255, b / 255)) for pos, (r, g, b) in _PLASMA_STOPS
], N=256)

MAX_HZ = 12000


def make_spectrogram_png(samples, sr, title="", width=480, height=216):
    """Generate a spectrogram PNG as bytes using percentile normalization.

    Renders pixel-by-pixel with imshow (matching JS canvas rendering).
    """
    f, t, Zxx = stft(samples, fs=sr, nperseg=1024, noverlap=768)
    mag_db = 20 * np.log10(np.abs(Zxx) + 1e-10)

    # Limit to MAX_HZ
    max_bin = int(MAX_HZ / (sr / 2) * len(f))
    mag_db = mag_db[:max_bin, :]

    # Percentile normalization (matching JS: 5th-99.5th)
    flat = mag_db.ravel().copy()
    flat.sort()
    vmin = flat[int(len(flat) * 0.05)]
    vmax = flat[int(len(flat) * 0.995)]
    if vmax <= vmin:
        vmax = vmin + 1

    # Flip vertically so low freq is at bottom (origin='lower' in imshow)
    dpi = 96
    fig_w = width / dpi
    fig_h = height / dpi
    fig, ax = plt.subplots(1, 1, figsize=(fig_w, fig_h), dpi=dpi)
    ax.imshow(mag_db, aspect="auto", origin="lower", cmap=_CMAP,
              vmin=vmin, vmax=vmax, interpolation="nearest",
              extent=[0, t[-1], 0, MAX_HZ / 1000])
    ax.set_ylabel("kHz", fontsize=7)
    ax.set_xlabel("s", fontsize=7)
    ax.tick_params(labelsize=6)
    if title:
        ax.set_title(title, fontsize=8, pad=2)
    fig.tight_layout(pad=0.3)

    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=dpi)
    plt.close(fig)
    buf.seek(0)
    return buf.read()


def apply_filters(samples, sr, config):
    """Apply audio filters — same logic as engine.py apply_filters()."""
    sig = samples

    if config.get("highpass_enabled", False):
        cutoff = config.get("highpass_cutoff_hz", 100)
        sos = butter(4, cutoff, btype="high", fs=sr, output="sos")
        sig = sosfilt(sos, sig).astype(np.float32)

    if config.get("lowpass_enabled", False):
        cutoff = config.get("lowpass_cutoff_hz", 10000)
        sos = butter(4, cutoff, btype="low", fs=sr, output="sos")
        sig = sosfilt(sos, sig).astype(np.float32)

    if config.get("denoise_enabled", False):
        strength = config.get("denoise_strength", 0.5)
        try:
            import noisereduce as nr
            sig = nr.reduce_noise(
                y=sig, sr=sr,
                prop_decrease=strength,
                stationary=True,
                n_fft=1024,
                hop_length=256,
            ).astype(np.float32)
        except ImportError:
            pass

    if config.get("rms_normalize", False):
        target = config.get("rms_target", 0.05)
        rms = np.sqrt(np.mean(sig ** 2))
        if rms > 1e-6:
            sig = (sig * (target / rms)).astype(np.float32)

    return sig


def main():
    wav_path = sys.argv[1]
    config = json.loads(sys.argv[2])

    import soundfile as sf
    raw, sr = sf.read(wav_path, dtype="float32", always_2d=False)
    if raw.ndim > 1:
        raw = raw.mean(axis=1)

    filtered = apply_filters(raw, sr, config)

    before_png = make_spectrogram_png(raw, sr, "Before")
    after_png = make_spectrogram_png(filtered, sr, "After")

    result = {
        "before": "data:image/png;base64," + base64.b64encode(before_png).decode(),
        "after": "data:image/png;base64," + base64.b64encode(after_png).decode(),
    }
    sys.stdout.write(json.dumps(result))


if __name__ == "__main__":
    main()
