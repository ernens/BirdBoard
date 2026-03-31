#!/usr/bin/env python3
"""Generate before/after spectrograms for audio filter preview.

Usage: filter_preview.py <wav_path> <json_config>
Outputs JSON: {"before": "data:image/png;base64,...", "after": "data:image/png;base64,..."}
"""
import base64
import io
import json
import sys

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from scipy.signal import stft, butter, sosfilt


def make_spectrogram_png(samples, sr, title="", width=4.0, height=1.8):
    """Generate a spectrogram PNG as bytes."""
    f, t, Zxx = stft(samples, fs=sr, nperseg=1024, noverlap=768)
    mag = np.abs(Zxx)
    mag_db = 20 * np.log10(mag + 1e-10)
    vmin = max(mag_db.max() - 80, -100)

    fig, ax = plt.subplots(1, 1, figsize=(width, height))
    ax.pcolormesh(t, f, mag_db, shading="gouraud", cmap="inferno",
                  vmin=vmin, vmax=mag_db.max())
    ax.set_ylim(0, min(sr / 2, 15000))
    ax.set_ylabel("Hz", fontsize=7)
    ax.set_xlabel("s", fontsize=7)
    ax.tick_params(labelsize=6)
    if title:
        ax.set_title(title, fontsize=8, pad=2)
    fig.tight_layout(pad=0.3)

    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=120, bbox_inches="tight")
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

    before_png = make_spectrogram_png(raw, sr, "Before")
    filtered = apply_filters(raw, sr, config)
    after_png = make_spectrogram_png(filtered, sr, "After")

    result = {
        "before": "data:image/png;base64," + base64.b64encode(before_png).decode(),
        "after": "data:image/png;base64," + base64.b64encode(after_png).decode(),
    }
    sys.stdout.write(json.dumps(result))


if __name__ == "__main__":
    main()
