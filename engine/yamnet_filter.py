"""yamnet_filter.py — YAMNet-powered privacy + dog-bark pre-filter.

YAMNet (Google, AudioSet) classifies 521 audio events at 16 kHz.
We use it to drop bird-detection chunks that contain:
  • human voice (Privacy filter, RGPD-friendly — optionally also deletes
    the WAV/MP3 file so no recording of the human leaves the station)
  • dog barks / howls (false-positive killer)

The model takes a single 0.975 s window (15 600 samples @ 16 kHz) and
returns 521 class scores. For our 3 s detection chunks we run YAMNet on
3 non-overlapping windows and take the MAX score per class — one second
of speech anywhere in the window is enough to flag the whole chunk.

Both filters share one model load (~30 ms inference per window on Pi 5).
"""

import csv
import os

import numpy as np

from engine import create_interpreter   # reuse the engine's TFLite loader

YAMNET_SR = 16000
YAMNET_WINDOW = 15600  # samples = 0.975 s


# AudioSet class indices we care about (from yamnet_class_map.csv).
# Hard-coded so we don't have to scan the CSV at hot-path time.
HUMAN_VOICE_INDICES = {
    0,    # Speech
    1,    # Child speech, kid speaking
    2,    # Conversation
    3,    # Narration, monologue
    6,    # Shout
    9,    # Yell
    12,   # Whispering
}

DOG_INDICES = {
    70,   # Bark
    71,   # Yip
    72,   # Howl
    74,   # Growling
    75,   # Whimper (dog)
}


class YAMNetFilter:
    def __init__(self, model_path, labels_path=None):
        self.interpreter = create_interpreter(model_path)
        inp = self.interpreter.get_input_details()[0]
        out = self.interpreter.get_output_details()[0]
        self._input_idx = inp["index"]
        self._output_idx = out["index"]
        # Cache the labels for diagnostic logs (which class triggered)
        self.labels = self._load_labels(labels_path) if labels_path else None

    @staticmethod
    def _load_labels(path):
        try:
            with open(path) as f:
                reader = csv.reader(f)
                next(reader, None)   # header
                return [row[2] for row in reader if len(row) >= 3]
        except Exception:
            return None

    def _resample_to_16k(self, samples, sr):
        """Resample ndarray to 16 kHz. Uses resampy when available
        (best quality for downsampling 48 → 16 kHz), else linear fallback."""
        if sr == YAMNET_SR:
            return samples.astype(np.float32, copy=False)
        try:
            import resampy
            return resampy.resample(samples, sr, YAMNET_SR).astype(np.float32)
        except ImportError:
            ratio = YAMNET_SR / sr
            n = int(len(samples) * ratio)
            x_old = np.linspace(0.0, 1.0, num=len(samples), endpoint=False)
            x_new = np.linspace(0.0, 1.0, num=n,            endpoint=False)
            return np.interp(x_new, x_old, samples).astype(np.float32)

    def _classify_window(self, window):
        """Run YAMNet on exactly YAMNET_WINDOW samples. Returns 521 scores."""
        if len(window) < YAMNET_WINDOW:
            buf = np.zeros(YAMNET_WINDOW, dtype=np.float32)
            buf[: len(window)] = window
            window = buf
        elif len(window) > YAMNET_WINDOW:
            window = window[:YAMNET_WINDOW]
        self.interpreter.set_tensor(self._input_idx, window.astype(np.float32))
        self.interpreter.invoke()
        return self.interpreter.get_tensor(self._output_idx)[0]

    def classify_chunk(self, samples, sr):
        """Run YAMNet over a multi-second chunk via 3 non-overlapping windows.
        Returns a 521-vector of MAX scores (= worst-case per class)."""
        x = self._resample_to_16k(samples, sr)
        if len(x) <= YAMNET_WINDOW:
            return self._classify_window(x)
        # Three windows tiled across the chunk
        n_windows = max(1, len(x) // YAMNET_WINDOW)
        n_windows = min(n_windows, 3)
        scores = np.zeros(521, dtype=np.float32)
        for i in range(n_windows):
            start = i * YAMNET_WINDOW
            window = x[start : start + YAMNET_WINDOW]
            np.maximum(scores, self._classify_window(window), out=scores)
        return scores

    # ── High-level helpers ────────────────────────────────────────────────

    def voice_score(self, samples, sr):
        scores = self.classify_chunk(samples, sr)
        return float(scores[list(HUMAN_VOICE_INDICES)].max())

    def dog_score(self, samples, sr):
        scores = self.classify_chunk(samples, sr)
        return float(scores[list(DOG_INDICES)].max())

    def analyze(self, samples, sr):
        """Return both (voice_score, dog_score, top1_class) in one inference pass."""
        scores = self.classify_chunk(samples, sr)
        voice = float(scores[list(HUMAN_VOICE_INDICES)].max())
        dog   = float(scores[list(DOG_INDICES)].max())
        top_idx = int(scores.argmax())
        top_label = self.labels[top_idx] if self.labels and top_idx < len(self.labels) else f"class_{top_idx}"
        return voice, dog, top_label, float(scores[top_idx])


def find_default_paths(models_dir):
    model = os.path.join(models_dir, "yamnet.tflite")
    labels = os.path.join(models_dir, "yamnet_class_map.csv")
    return model, (labels if os.path.exists(labels) else None)


# CLI smoke test: `python yamnet_filter.py path/to/audio.wav`
if __name__ == "__main__":
    import sys
    import soundfile as sf

    if len(sys.argv) < 2:
        print("Usage: yamnet_filter.py <wav_file> [models_dir]")
        sys.exit(1)
    wav = sys.argv[1]
    models_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), "models")
    model, labels = find_default_paths(models_dir)
    yf = YAMNetFilter(model, labels)
    samples, sr = sf.read(wav, dtype="float32")
    if samples.ndim > 1:
        samples = samples.mean(axis=1)
    v, d, top, top_s = yf.analyze(samples, sr)
    print(f"voice={v:.3f}  dog={d:.3f}  top={top!r} ({top_s:.3f})")
