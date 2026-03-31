#!/usr/bin/env python3
"""BirdEngine — Modern bird detection engine for Raspberry Pi 5.

Watches for WAV files (via rsync from biloute or local recording),
runs BirdNET or Perch inference, and writes detections to SQLite.
"""

import datetime
import json
import logging
import math
import operator
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time

import numpy as np
import soundfile as sf
import toml
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

log = logging.getLogger("birdengine")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

def load_config(path="config.toml"):
    with open(path) as f:
        return toml.load(f)


# ---------------------------------------------------------------------------
# Audio processing
# ---------------------------------------------------------------------------

def read_audio(path, sample_rate):
    """Read audio file and resample to target rate."""
    data, sr = sf.read(path, dtype="float32", always_2d=False)
    # Convert stereo to mono
    if data.ndim > 1:
        data = data.mean(axis=1)
    # Resample if needed
    if sr != sample_rate:
        import resampy
        data = resampy.resample(data, sr, sample_rate)
    return data


def apply_adaptive_gain(samples, api_url="http://127.0.0.1:7474"):
    """Apply adaptive gain from birdash server if enabled and not in observer mode.

    Returns (gained_samples, gain_db). If disabled/observer, returns (samples, 0).
    """
    try:
        import urllib.request
        resp = urllib.request.urlopen(f"{api_url}/api/audio/adaptive-gain/state", timeout=2)
        data = json.loads(resp.read())
        state = data.get("state", {})
        config = data.get("config", {})

        if not config.get("enabled", False) or config.get("observer_only", True):
            return samples, 0.0

        gain_db = state.get("current_gain_db", 0.0)
        if gain_db == 0.0:
            return samples, 0.0

        # Apply gain: linear = 10^(dB/20)
        linear_gain = 10.0 ** (gain_db / 20.0)
        gained = samples * linear_gain

        # Soft clip to prevent overdriving (tanh limiter)
        gained = np.tanh(gained)

        return gained.astype(np.float32), gain_db
    except Exception:
        return samples, 0.0


def load_audio_config():
    """Load audio_config.json from the birdash config directory."""
    home = os.environ.get("HOME", os.path.expanduser("~"))
    candidates = [
        os.path.join(home, "birdash", "config", "audio_config.json"),
        os.path.join(os.path.dirname(os.path.dirname(__file__)), "config", "audio_config.json"),
    ]
    for path in candidates:
        try:
            with open(path) as f:
                return json.load(f)
        except Exception:
            continue
    return {}


def apply_filters(samples, sr, audio_config):
    """Apply audio filters (highpass, lowpass, spectral gating) based on audio_config.

    Returns filtered samples as float32.
    """
    sig = samples

    # ── Highpass filter ──────────────────────────────────────────────────
    if audio_config.get("highpass_enabled", False):
        cutoff = audio_config.get("highpass_cutoff_hz", 100)
        try:
            from scipy.signal import butter, sosfilt
            sos = butter(4, cutoff, btype="high", fs=sr, output="sos")
            sig = sosfilt(sos, sig).astype(np.float32)
            log.debug("Highpass filter applied: %d Hz", cutoff)
        except ImportError:
            log.warning("scipy not installed — highpass filter skipped")

    # ── Lowpass filter ───────────────────────────────────────────────────
    if audio_config.get("lowpass_enabled", False):
        cutoff = audio_config.get("lowpass_cutoff_hz", 10000)
        try:
            from scipy.signal import butter, sosfilt
            sos = butter(4, cutoff, btype="low", fs=sr, output="sos")
            sig = sosfilt(sos, sig).astype(np.float32)
            log.debug("Lowpass filter applied: %d Hz", cutoff)
        except ImportError:
            log.warning("scipy not installed — lowpass filter skipped")

    # ── Spectral gating (noise reduction) ────────────────────────────────
    if audio_config.get("denoise_enabled", False):
        strength = audio_config.get("denoise_strength", 0.5)
        try:
            import noisereduce as nr
            sig = nr.reduce_noise(
                y=sig, sr=sr,
                prop_decrease=strength,
                stationary=True,
                n_fft=1024,
                hop_length=256,
            ).astype(np.float32)
            log.debug("Spectral gating applied: strength=%.2f", strength)
        except ImportError:
            log.warning("noisereduce not installed — spectral gating skipped")

    # ── RMS normalization ────────────────────────────────────────────────
    if audio_config.get("rms_normalize", False):
        target = audio_config.get("rms_target", 0.05)
        rms = np.sqrt(np.mean(sig ** 2))
        if rms > 1e-6:
            sig = (sig * (target / rms)).astype(np.float32)
            log.debug("RMS normalized: %.4f → %.4f", rms, target)

    return sig


def split_signal(sig, rate, overlap, seconds=3.0, minlen=1.5):
    """Split audio signal into overlapping chunks."""
    chunks = []
    step = int((seconds - overlap) * rate)
    chunk_len = int(seconds * rate)
    min_samples = int(minlen * rate)

    for i in range(0, len(sig), step):
        chunk = sig[i:i + chunk_len]
        if len(chunk) < min_samples:
            break
        if len(chunk) < chunk_len:
            padded = np.zeros(chunk_len, dtype=np.float32)
            padded[:len(chunk)] = chunk
            chunk = padded
        chunks.append(chunk)
    return chunks


# ---------------------------------------------------------------------------
# Label loading
# ---------------------------------------------------------------------------

def load_labels(model_name, models_dir):
    """Load species labels for a model."""
    label_path = os.path.join(models_dir, f"{model_name}_Labels.txt")
    with open(label_path) as f:
        labels = [line.strip() for line in f.readlines()]
    # Strip common name suffix if present (e.g. "Pica pica_Eurasian Magpie")
    # Check multiple labels to avoid edge case where first label differs
    has_suffix = any(l.count("_") == 1 for l in labels[:10] if l)
    if has_suffix:
        labels = [re.sub(r"_.+$", "", label) for label in labels]
    return labels


def load_language(lang, models_dir):
    """Load localized species names."""
    path = os.path.join(models_dir, "l18n", f"labels_{lang}.json")
    with open(path) as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# TFLite model wrappers
# ---------------------------------------------------------------------------

def create_interpreter(model_path, num_threads=None):
    """Create a TFLite interpreter, supporting both ai_edge_litert and tflite_runtime."""
    try:
        from ai_edge_litert.interpreter import Interpreter
    except ImportError:
        try:
            import tflite_runtime.interpreter as tflite
            Interpreter = tflite.Interpreter
        except ImportError:
            from tensorflow import lite as tflite
            Interpreter = tflite.Interpreter

    kwargs = {"model_path": model_path}
    if num_threads:
        kwargs["num_threads"] = num_threads
    interp = Interpreter(**kwargs)
    interp.allocate_tensors()
    return interp


class MDataModel:
    """Geographic species filter using BirdNET metadata model."""

    def __init__(self, model_path, sf_thresh):
        self.interpreter = create_interpreter(model_path)
        inp = self.interpreter.get_input_details()
        out = self.interpreter.get_output_details()
        self._input_idx = inp[0]["index"]
        self._output_idx = out[0]["index"]
        self._sf_thresh = sf_thresh
        self._cache_key = None
        self._cached_list = None

    def get_species_list(self, labels, lat, lon, week):
        key = (lat, lon, week)
        if self._cache_key == key and self._cached_list is not None:
            return self._cached_list

        sample = np.expand_dims(np.array([lat, lon, week], dtype="float32"), 0)
        self.interpreter.set_tensor(self._input_idx, sample)
        self.interpreter.invoke()
        scores = self.interpreter.get_tensor(self._output_idx)[0]

        filtered = [
            labels[i].split("_")[0]
            for i, s in enumerate(scores)
            if s >= self._sf_thresh
        ]
        self._cache_key = key
        self._cached_list = filtered
        return filtered


class BirdNETv1Model:
    """BirdNET V1 (6K Global) model wrapper — has metadata input layer."""

    name = "BirdNET_6K_GLOBAL_MODEL"
    sample_rate = 48000
    chunk_duration = 3

    def __init__(self, models_dir, sensitivity, sf_thresh, mdata_version):
        model_path = os.path.join(models_dir, f"{self.name}.tflite")
        self.interpreter = create_interpreter(model_path)

        inp = self.interpreter.get_input_details()
        out = self.interpreter.get_output_details()
        self._input_idx = inp[0]["index"]
        self._mdata_idx = inp[1]["index"]
        self._output_idx = out[0]["index"]

        self.labels = load_labels(self.name, models_dir)
        self._sensitivity = max(0.5, min(1.0 - (sensitivity - 1.0), 1.5))
        self._mdata = None

    def set_meta_data(self, lat, lon, week):
        m = np.array([lat, lon, week], dtype=np.float32)
        if 1 <= m[2] <= 48:
            m[2] = math.cos(math.radians(m[2] * 7.5)) + 1
        else:
            m[2] = -1
        mask = np.ones(3, dtype=np.float32)
        if m[0] == -1 or m[1] == -1:
            mask = np.zeros(3, dtype=np.float32)
        if m[2] == -1:
            mask[2] = 0.0
        self._mdata = np.expand_dims(np.concatenate([m, mask]), 0)

    def predict(self, chunk):
        self.interpreter.set_tensor(self._input_idx, chunk[np.newaxis, :].astype(np.float32))
        if self._mdata is not None:
            self.interpreter.set_tensor(self._mdata_idx, self._mdata)
        self.interpreter.invoke()
        logits = self.interpreter.get_tensor(self._output_idx)[0]
        probs = 1.0 / (1.0 + np.exp(-self._sensitivity * logits))
        return sorted(zip(self.labels, probs), key=lambda x: x[1], reverse=True)

    def get_species_list(self, lat, lon, week):
        self.set_meta_data(lat, lon, week)
        return []


class BirdNETModel:
    """BirdNET V2.4 FP16 model wrapper."""

    name = "BirdNET_GLOBAL_6K_V2.4_Model_FP16"
    sample_rate = 48000
    chunk_duration = 3

    def __init__(self, models_dir, sensitivity, sf_thresh, mdata_version):
        model_path = os.path.join(models_dir, f"{self.name}.tflite")
        self.interpreter = create_interpreter(model_path)

        inp = self.interpreter.get_input_details()
        out = self.interpreter.get_output_details()
        self._input_idx = inp[0]["index"]
        self._output_idx = out[0]["index"]

        self.labels = load_labels(self.name, models_dir)
        self._sensitivity = max(0.5, min(1.0 - (sensitivity - 1.0), 1.5))

        # Load MData model for geographic filtering
        mdata_name = (
            "BirdNET_GLOBAL_6K_V2.4_MData_Model_FP16" if mdata_version == 1
            else "BirdNET_GLOBAL_6K_V2.4_MData_Model_V2_FP16"
        )
        mdata_path = os.path.join(models_dir, f"{mdata_name}.tflite")
        self.mdata = MDataModel(mdata_path, sf_thresh) if os.path.exists(mdata_path) else None

    def predict(self, chunk):
        self.interpreter.set_tensor(self._input_idx, chunk[np.newaxis, :].astype(np.float32))
        self.interpreter.invoke()
        logits = self.interpreter.get_tensor(self._output_idx)[0]
        probs = 1.0 / (1.0 + np.exp(-self._sensitivity * logits))
        return sorted(zip(self.labels, probs), key=lambda x: x[1], reverse=True)

    def get_species_list(self, lat, lon, week):
        if self.mdata:
            return self.mdata.get_species_list(self.labels, lat, lon, week)
        return []


class PerchModel:
    """Google Perch V2 model wrapper (FP32 or INT8)."""

    name = "Perch_v2"
    sample_rate = 32000
    chunk_duration = 5

    def __init__(self, models_dir, sensitivity, sf_thresh, mdata_version, model_name=None):
        if model_name:
            self.name = model_name
        model_path = os.path.join(models_dir, f"{self.name}.tflite")
        self.interpreter = create_interpreter(model_path, num_threads=2)

        inp = self.interpreter.get_input_details()
        out = self.interpreter.get_output_details()
        self._input_idx = inp[0]["index"]
        # Perch output layer is index 3
        self._output_idx = out[3]["index"]

        self.labels = load_labels(self.name, models_dir)

        # Temperature from sensitivity
        self._temperature = max(0.25, 2.0 - float(sensitivity))
        log.info("Perch temperature=%.2f (sensitivity=%.2f)", self._temperature, sensitivity)

        # Bird-only filter
        idx_path = os.path.join(models_dir, "Perch_v2_bird_indices.json")
        if os.path.exists(idx_path):
            with open(idx_path) as f:
                self._bird_indices = np.array(json.load(f), dtype=int)
            self._bird_labels = [self.labels[i] for i in self._bird_indices]
            log.info("Perch bird filter: %d / %d species", len(self._bird_indices), len(self.labels))
        else:
            self._bird_indices = None
            self._bird_labels = self.labels

        # MData geographic filter (reuses BirdNET labels)
        mdata_name = (
            "BirdNET_GLOBAL_6K_V2.4_MData_Model_FP16" if mdata_version == 1
            else "BirdNET_GLOBAL_6K_V2.4_MData_Model_V2_FP16"
        )
        mdata_path = os.path.join(models_dir, f"{mdata_name}.tflite")
        if os.path.exists(mdata_path):
            self.mdata = MDataModel(mdata_path, sf_thresh)
            self._birdnet_labels = load_labels("BirdNET_GLOBAL_6K_V2.4_Model_FP16", models_dir)
        else:
            self.mdata = None
            self._birdnet_labels = None

    def predict(self, chunk):
        self.interpreter.set_tensor(self._input_idx, chunk[np.newaxis, :].astype(np.float32))
        self.interpreter.invoke()
        logits = self.interpreter.get_tensor(self._output_idx)[0]

        # Filter to bird-only BEFORE softmax (avoids probability dilution
        # across insects, frogs, mammals etc.)
        if self._bird_indices is not None:
            bird_logits = logits[self._bird_indices]
            labels = self._bird_labels
        else:
            bird_logits = logits
            labels = self.labels

        # Temperature-scaled softmax on bird-only logits
        scaled = (bird_logits - np.max(bird_logits)) / self._temperature
        exp_x = np.exp(scaled)
        probs = exp_x / np.sum(exp_x)

        order = np.argsort(probs)[::-1]
        return [(labels[i], float(probs[i])) for i in order]

    def get_species_list(self, lat, lon, week):
        if self.mdata and self._birdnet_labels:
            return self.mdata.get_species_list(self._birdnet_labels, lat, lon, week)
        return []


def get_model(model_name, models_dir, sensitivity=1.0, sf_thresh=0.03, mdata_version=2):
    """Factory: instantiate a model by name."""
    if model_name in ("Perch_v2", "Perch_v2_int8"):
        return PerchModel(models_dir, sensitivity, sf_thresh, mdata_version,
                          model_name=model_name)
    elif model_name == "BirdNET_6K_GLOBAL_MODEL":
        return BirdNETv1Model(models_dir, sensitivity, sf_thresh, mdata_version)
    else:
        return BirdNETModel(models_dir, sensitivity, sf_thresh, mdata_version)


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

def init_db(db_path):
    """Create the detections database if it doesn't exist."""
    import sqlite3
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS detections (
            Date DATE,
            Time TIME,
            Sci_Name VARCHAR(100) NOT NULL,
            Com_Name VARCHAR(100) NOT NULL,
            Confidence FLOAT,
            Lat FLOAT,
            Lon FLOAT,
            Cutoff FLOAT,
            Week INT,
            Sens FLOAT,
            Overlap FLOAT,
            File_Name VARCHAR(100) NOT NULL,
            Model VARCHAR(50)
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_date_time ON detections(Date, Time DESC)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_com_name ON detections(Com_Name)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sci_name ON detections(Sci_Name)")
    conn.commit()
    return conn


def write_detection(conn, det):
    """Insert a detection row if not already present (avoids duplicates on restart)."""
    existing = conn.execute(
        "SELECT 1 FROM detections WHERE Date=? AND Time=? AND Sci_Name=? AND Model=? LIMIT 1",
        (det["date"], det["time"], det["sci_name"], det["model"])
    ).fetchone()
    if existing:
        return False
    conn.execute(
        "INSERT INTO detections VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (det["date"], det["time"], det["sci_name"], det["com_name"],
         det["confidence"], det["lat"], det["lon"], det["cutoff"],
         det["week"], det["sens"], det["overlap"], det["file_name"],
         det["model"])
    )
    conn.commit()
    return True


def _det_to_sql(det):
    """Convert a detection dict to an INSERT SQL statement."""
    def esc(v):
        return str(v).replace("'", "''")
    return (
        f"INSERT INTO detections VALUES("
        f"'{esc(det['date'])}','{esc(det['time'])}','{esc(det['sci_name'])}',"
        f"'{esc(det['com_name'])}',{det['confidence']},{det['lat']},{det['lon']},"
        f"{det['cutoff']},{det['week']},{det['sens']},{det['overlap']},"
        f"'{esc(det['file_name'])}','{esc(det['model'])}');"
    )


def sync_detections_to_remote(detections, remote_host, remote_db):
    """Write multiple detections to a remote SQLite database via SSH stdin."""
    if not detections:
        return True
    sql = "BEGIN;\n" + "\n".join(_det_to_sql(d) for d in detections) + "\nCOMMIT;\n"
    try:
        result = subprocess.run(
            ["ssh", remote_host, f"sqlite3 '{remote_db}'"],
            input=sql, capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            log.error("Remote DB batch sync failed: %s", result.stderr.strip())
            return False
        log.info("Synced %d detections to biloute", len(detections))
        return True
    except Exception as e:
        log.error("Remote DB sync error: %s", e)
        return False


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------

class Notifier:
    """Smart push notifications via ntfy.sh — reads rules from birdnet.conf."""

    def __init__(self, config, db_path=None):
        notif = config.get("notifications", {})
        self.ntfy_url = notif.get("ntfy_url", "")
        self.cooldown = notif.get("cooldown_seconds", 300)
        self.db_path = db_path
        self._species_today = set()
        self._last_notif = {}
        self._today = None
        self._species_counts = {}  # sci_name -> total count (cached)
        self._species_last_seen = {}  # sci_name -> last date (cached)
        self._cache_loaded = False

    def _load_species_cache(self):
        """Load species counts and last-seen dates from DB."""
        if self._cache_loaded or not self.db_path:
            return
        try:
            import sqlite3
            conn = sqlite3.connect(self.db_path)
            # Total counts per species
            for row in conn.execute("SELECT Sci_Name, COUNT(*) FROM detections GROUP BY Sci_Name"):
                self._species_counts[row[0]] = row[1]
            # Last seen date per species
            for row in conn.execute("SELECT Sci_Name, MAX(Date) FROM detections GROUP BY Sci_Name"):
                self._species_last_seen[row[0]] = row[1]
            conn.close()
            self._cache_loaded = True
            log.info("Notifier: loaded %d species from DB", len(self._species_counts))
        except Exception as e:
            log.warning("Notifier cache load failed: %s", e)

    def _read_notif_conf(self):
        """Read notification settings from birdnet.conf (cached 60s)."""
        now = time.time()
        if hasattr(self, '_notif_conf_cache') and now - self._notif_conf_ts < 60:
            return self._notif_conf_cache
        conf = {}
        try:
            with open("/etc/birdnet/birdnet.conf") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        conf[k] = v.strip('"')
        except Exception:
            pass
        self._notif_conf_cache = conf
        self._notif_conf_ts = now
        return conf

    def check_and_notify(self, det):
        """Check notification rules and send if matched."""
        if not self.ntfy_url:
            return

        bconf = self._read_notif_conf()

        # Global toggle
        if bconf.get("NOTIFY_ENABLED", "1") != "1":
            return

        self._load_species_cache()

        today = det["date"]
        if self._today != today:
            self._species_today.clear()
            self._last_notif.clear()
            self._today = today

        sci_name = det["sci_name"]
        com_name = det["com_name"]
        is_new_today = sci_name not in self._species_today
        self._species_today.add(sci_name)

        # Update cache
        self._species_counts[sci_name] = self._species_counts.get(sci_name, 0) + 1

        # Determine which rules match
        reason = None
        priority = "default"

        total_count = self._species_counts.get(sci_name, 1)
        rare_threshold = int(bconf.get("NOTIFY_RARE_THRESHOLD", "10"))
        season_days = int(bconf.get("NOTIFY_SEASON_DAYS", "30"))
        last_seen = self._species_last_seen.get(sci_name)

        # Rule 1: Rare species (highest priority)
        if bconf.get("NOTIFY_RARE_SPECIES", "0") == "1" and total_count <= rare_threshold:
            reason = f"Espece rare ({total_count} detection{'s' if total_count > 1 else ''} au total)"
            priority = "high"

        # Rule 2: First of season (not seen in X days)
        elif bconf.get("NOTIFY_FIRST_SEASON", "0") == "1" and is_new_today and last_seen:
            try:
                last_dt = datetime.datetime.strptime(last_seen, "%Y-%m-%d")
                today_dt = datetime.datetime.strptime(today, "%Y-%m-%d")
                days_absent = (today_dt - last_dt).days
                if days_absent >= season_days:
                    reason = f"Premiere de saison (absente depuis {days_absent} jours)"
                    priority = "high"
            except Exception:
                pass

        # Rule 3: New species ever
        elif bconf.get("APPRISE_NOTIFY_NEW_SPECIES", "0") == "1" and total_count == 1:
            reason = "Nouvelle espece — jamais detectee"
            priority = "urgent"

        # Rule 4: First of the day (noisy)
        elif bconf.get("APPRISE_NOTIFY_NEW_SPECIES_EACH_DAY", "0") == "1" and is_new_today:
            reason = "Premiere du jour"
            priority = "low"

        if not reason:
            return

        # Cooldown
        now = time.time()
        last = self._last_notif.get(sci_name, 0)
        if now - last < self.cooldown:
            return
        self._last_notif[sci_name] = now

        # Update last seen
        self._species_last_seen[sci_name] = today

        confidence = det["confidence"]
        model = det["model"]
        title = f"{com_name} — {reason}"
        body = f"{com_name} ({sci_name})\nConfiance: {confidence*100:.0f}% — {model}"

        try:
            import urllib.request
            req = urllib.request.Request(
                self.ntfy_url,
                data=body.encode("utf-8"),
                headers={"Title": title, "Priority": priority},
                method="POST"
            )
            urllib.request.urlopen(req, timeout=10)
            log.info("Notification [%s]: %s — %s", priority, com_name, reason)
        except Exception as e:
            log.warning("Notification failed: %s", e)


# ---------------------------------------------------------------------------
# BirdWeather
# ---------------------------------------------------------------------------

def upload_to_birdweather(wav_path, detections, config):
    """Upload soundscape + detections to BirdWeather API."""
    bw = config.get("birdweather", {})
    station_id = bw.get("station_id", "")
    if not station_id or not bw.get("enabled", False) or not detections:
        return

    import urllib.request
    import io

    lat = config["station"]["latitude"]
    lon = config["station"]["longitude"]

    try:
        # Convert WAV to FLAC for upload
        if not os.path.exists(wav_path):
            log.debug("BirdWeather: WAV not found (purged?): %s", wav_path)
            return
        data, sr = sf.read(wav_path, dtype="float32")
        if data.ndim > 1:
            data = data.mean(axis=1)
        buf = io.BytesIO()
        sf.write(buf, data, sr, format="FLAC")
        flac_data = buf.getvalue()

        # Parse timestamp from filename
        basename = os.path.basename(wav_path)
        date_match = re.search(r"(\d{4}-\d{2}-\d{2})", basename)
        time_match = re.search(r"(\d{2}:\d{2}:\d{2})", basename)
        if date_match and time_match:
            from datetime import timezone
            file_dt = datetime.datetime.strptime(
                f"{date_match.group(1)}T{time_match.group(1)}", "%Y-%m-%dT%H:%M:%S"
            )
            timestamp = file_dt.astimezone().isoformat()
        else:
            timestamp = datetime.datetime.now().astimezone().isoformat()

        # POST soundscape
        url = f"https://app.birdweather.com/api/v1/stations/{station_id}/soundscapes?timestamp={timestamp}"
        req = urllib.request.Request(url, data=flac_data,
                                     headers={"Content-Type": "audio/flac"}, method="POST")
        resp = urllib.request.urlopen(req, timeout=30)
        result = json.loads(resp.read())

        if not result.get("success"):
            log.warning("BirdWeather soundscape failed: %s", result.get("message"))
            return

        soundscape_id = result["soundscape"]["id"]

        # POST each detection
        det_url = f"https://app.birdweather.com/api/v1/stations/{station_id}/detections"
        model_name = detections[0].get("model", "")
        algorithm = "2p4" if "V2.4" in model_name else "alpha"

        for det in detections:
            det_data = json.dumps({
                "timestamp": timestamp,
                "lat": lat, "lon": lon,
                "soundscapeId": soundscape_id,
                "soundscapeStartTime": det.get("_start", 0),
                "soundscapeEndTime": det.get("_stop", 3),
                "commonName": det["com_name"],
                "scientificName": det["sci_name"],
                "algorithm": algorithm,
                "confidence": det["confidence"],
            }).encode("utf-8")
            req = urllib.request.Request(det_url, data=det_data,
                                         headers={"Content-Type": "application/json"}, method="POST")
            try:
                urllib.request.urlopen(req, timeout=20)
            except Exception as e:
                log.warning("BirdWeather detection POST failed: %s", e)

        log.info("BirdWeather: uploaded %d detections (soundscape %s)", len(detections), soundscape_id)

    except Exception as e:
        log.warning("BirdWeather upload failed: %s", e)


# ---------------------------------------------------------------------------
# Audio extraction
# ---------------------------------------------------------------------------

def _generate_clip_spectrogram(audio_path, png_path, width=940, height=611):
    """Generate a spectrogram PNG matching the dashboard plasma colormap.

    Uses percentile 5%-99.5% normalization and 0-12 kHz range,
    identical to bird-shared.js renderSpectrogram().
    """
    from matplotlib.colors import LinearSegmentedColormap
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from scipy.signal import stft as scipy_stft

    plasma_stops = [
        (0.00, (0, 0, 0)), (0.10, (20, 0, 50)), (0.25, (80, 0, 100)),
        (0.42, (180, 20, 80)), (0.58, (230, 70, 20)), (0.75, (255, 155, 0)),
        (0.90, (255, 230, 70)), (1.00, (255, 255, 255)),
    ]
    cmap = LinearSegmentedColormap.from_list("birdash_plasma", [
        (pos, (r / 255, g / 255, b / 255)) for pos, (r, g, b) in plasma_stops
    ], N=256)

    sig, sr = sf.read(audio_path, dtype="float32", always_2d=False)
    if sig.ndim > 1:
        sig = sig.mean(axis=1)

    f, t, Zxx = scipy_stft(sig, fs=sr, nperseg=1024, noverlap=768)
    mag_db = 20 * np.log10(np.abs(Zxx) + 1e-10)

    max_hz = 12000
    freq_mask = f <= max_hz
    f = f[freq_mask]
    mag_db = mag_db[freq_mask, :]

    flat = mag_db.ravel()
    flat.sort()
    vmin = flat[int(len(flat) * 0.05)]
    vmax = flat[int(len(flat) * 0.995)]
    if vmax <= vmin:
        vmax = vmin + 1

    dpi = 120
    fig, ax = plt.subplots(1, 1, figsize=(width / dpi, height / dpi), dpi=dpi)
    ax.pcolormesh(t, f, mag_db, shading="gouraud", cmap=cmap,
                  vmin=vmin, vmax=vmax)
    ax.set_ylim(0, max_hz)
    ax.axis("off")
    fig.subplots_adjust(left=0, right=1, top=1, bottom=0)
    fig.savefig(png_path, dpi=dpi, bbox_inches="tight", pad_inches=0)
    plt.close(fig)


def extract_clip(wav_path, det, config):
    """Extract an audio clip for a detection and store locally.

    Uses det["file_name"] as the clip filename (already set by the caller).
    Stored:  ~/BirdSongs/Extracted/By_Date/YYYY-MM-DD/Espece/
    """
    com_name_safe = det["com_name"].replace("'", "").replace(" ", "_")
    clip_name = det["file_name"]
    local_dir = os.path.join(
        os.path.expanduser("~"), "BirdSongs", "Extracted", "By_Date",
        det["date"], com_name_safe)
    os.makedirs(local_dir, exist_ok=True)

    start = max(0, det.get("_start", 0) - 1.5)
    stop = det.get("_stop", start + 3) + 1.5

    try:
        mp3_path = os.path.join(local_dir, clip_name)
        png_path = mp3_path + ".png"

        # Extract MP3 clip
        result = subprocess.run(
            ["ffmpeg", "-y", "-i", wav_path,
             "-ss", str(start), "-to", str(stop),
             "-ac", "1", "-ar", "24000", "-b:a", "128k",
             "-loglevel", "error", mp3_path],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            log.error("ffmpeg extract failed: %s", result.stderr.strip())
            return None

        # Generate spectrogram from the clip (Python, matching dashboard colormap)
        try:
            _generate_clip_spectrogram(mp3_path, png_path)
        except Exception as e:
            log.warning("Spectrogram generation failed: %s", e)

        # Sync clip + spectrogram to biloute (for biloute's birdash)
        if config["output"].get("sync_to_biloute", False):
            remote_host = config["audio"]["remote_host"]
            remote_dir = f"/home/bjorn/BirdSongs/Extracted/By_Date/{det['date']}/{com_name_safe}"
            try:
                subprocess.run(["ssh", remote_host, f"mkdir -p '{remote_dir}'"],
                               capture_output=True, timeout=10)
                files = [mp3_path]
                if os.path.exists(png_path):
                    files.append(png_path)
                subprocess.run(["scp"] + files + [f"{remote_host}:{remote_dir}/"],
                               capture_output=True, timeout=30)
            except Exception as e:
                log.warning("Clip sync to biloute failed: %s", e)

        return clip_name
    except Exception as e:
        log.error("Extract clip error: %s", e)
        return None


# ---------------------------------------------------------------------------
# File watcher
# ---------------------------------------------------------------------------

class WavHandler(FileSystemEventHandler):
    """Watchdog handler for new WAV files."""

    def __init__(self, process_fn):
        self.process_fn = process_fn

    def on_created(self, event):
        if event.is_directory:
            return
        if event.src_path.endswith(".wav"):
            # Wait briefly for file to finish writing
            time.sleep(0.5)
            self.process_fn(event.src_path)

    def on_moved(self, event):
        if not event.is_directory and event.dest_path.endswith(".wav"):
            time.sleep(0.5)
            self.process_fn(event.dest_path)


# ---------------------------------------------------------------------------
# Rsync
# ---------------------------------------------------------------------------

def rsync_audio(config):
    """Pull new WAV files from biloute via rsync."""
    audio = config["audio"]
    src = f"{audio['remote_host']}:{audio['remote_path']}"
    dst = audio["incoming_dir"] + "/"

    cmd = [
        "rsync", "-avz", "--include=*.wav", "--exclude=*",
        "--remove-source-files",
        src, dst
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        # Count transferred files
        transferred = [l for l in result.stdout.splitlines() if l.endswith(".wav")]
        if transferred:
            log.info("Rsync: %d new files", len(transferred))
        return len(transferred)
    except subprocess.TimeoutExpired:
        log.warning("Rsync timed out")
        return 0
    except Exception as e:
        log.error("Rsync error: %s", e)
        return 0


# ---------------------------------------------------------------------------
# Main processing
# ---------------------------------------------------------------------------

class BirdEngine:
    def __init__(self, config_path="config.toml"):
        self.config = load_config(config_path)
        self.base_dir = os.path.dirname(os.path.abspath(config_path))
        self.models_dir = os.path.join(self.base_dir, "models")
        self.shutdown = False
        self._shutdown_event = threading.Event()

        det = self.config["detection"]
        sensitivity = det.get("sensitivity", 1.0)
        sf_thresh = det.get("sf_thresh", 0.03)
        mdata_version = det.get("mdata_version", 2)

        # Load primary model — prefer birdnet.conf MODEL if it exists
        primary_name = det["model"]
        birdnet_conf = "/etc/birdnet/birdnet.conf"
        if os.path.exists(birdnet_conf):
            with open(birdnet_conf) as f:
                for line in f:
                    if line.startswith("MODEL="):
                        primary_name = line.strip().split("=", 1)[1].strip('"')
                        break
        log.info("Loading primary model: %s", primary_name)
        self.primary_model = get_model(primary_name, self.models_dir,
                                       sensitivity, sf_thresh, mdata_version)
        log.info("Primary model loaded (sample_rate=%d, chunk=%ds)",
                 self.primary_model.sample_rate, self.primary_model.chunk_duration)

        # Load secondary model — prefer birdnet.conf, fallback to config.toml
        secondary_name = det.get("secondary_model", "")
        birdnet_settings = self._read_birdnet_conf()
        if birdnet_settings.get("DUAL_MODEL_ENABLED", "1") == "0":
            secondary_name = ""
        elif birdnet_settings.get("SECONDARY_MODEL"):
            secondary_name = birdnet_settings["SECONDARY_MODEL"]
        self.secondary_model = None
        self._secondary_queue = None
        self._secondary_thread = None
        if secondary_name:
            log.info("Loading secondary model: %s", secondary_name)
            self.secondary_model = get_model(secondary_name, self.models_dir,
                                              sensitivity, sf_thresh, mdata_version)
            log.info("Secondary model loaded (sample_rate=%d, chunk=%ds)",
                     self.secondary_model.sample_rate, self.secondary_model.chunk_duration)
            from queue import Queue
            self._secondary_queue = Queue()

        # Load species names
        lang = self.config["station"].get("language", "en")
        try:
            self.names = load_language(lang, self.models_dir)
        except FileNotFoundError:
            log.warning("Language '%s' not found, falling back to 'en'", lang)
            self.names = load_language("en", self.models_dir)

        # Init database
        db_path = self.config["output"]["local_db"]
        self.db = init_db(db_path)
        log.info("Database: %s", db_path)

        # Notifications
        self.notifier = Notifier(self.config, db_path=self.config["output"]["local_db"])

        # Stats
        self.files_processed = 0
        self.detections_total = 0
        self.processed_files = set()
        self._db_lock = threading.Lock()
        self._post_threads = []  # Track post-processing threads for clean shutdown

    def _analyze_with_model(self, model, file_path, file_date, week, tag,
                            raw_sig=None, raw_sr=None):
        """Run inference on a file with a given model. Returns list of detections.

        If raw_sig/raw_sr are provided, skip file read and resample from those.
        """
        lat = self.config["station"]["latitude"]
        lon = self.config["station"]["longitude"]
        sensitivity = self.config["detection"].get("sensitivity", 1.0)
        overlap = self.config["detection"].get("overlap", 0.5)
        basename = os.path.basename(file_path)

        if raw_sig is not None and raw_sr is not None:
            if raw_sr != model.sample_rate:
                import resampy
                sig = resampy.resample(raw_sig, raw_sr, model.sample_rate)
            else:
                sig = raw_sig
        else:
            sig = read_audio(file_path, model.sample_rate)
        chunks = split_signal(sig, model.sample_rate, overlap,
                              seconds=model.chunk_duration)
        if not chunks:
            return []

        species_list = model.get_species_list(lat, lon, week)
        detections = []

        # Model-specific thresholds
        is_perch = isinstance(model, PerchModel)
        if is_perch:
            min_conf = self.config["detection"].get("perch_confidence", 0.15)
            min_margin = self.config["detection"].get("perch_min_margin", 0.05)
        else:
            min_conf = self.config["detection"].get("birdnet_confidence",
                       self.config["detection"].get("confidence", 0.65))
            min_margin = 0  # BirdNET: sigmoid scores are independent, no margin needed

        pred_start = 0.0
        for chunk in chunks:
            predictions = model.predict(chunk)
            pred_end = pred_start + model.chunk_duration

            for rank, (sci_name, confidence) in enumerate(predictions[:10]):
                if confidence < min_conf:
                    break
                # Perch: check margin between top-1 and top-2
                if is_perch and rank == 0 and min_margin > 0 and len(predictions) > 1:
                    top2_conf = predictions[1][1]
                    margin = confidence - top2_conf
                    if margin < min_margin:
                        break  # ambiguous detection, skip entire chunk
                if species_list and sci_name not in species_list:
                    continue

                det_time = file_date + datetime.timedelta(seconds=pred_start)
                com_name = self.names.get(sci_name, sci_name)

                com_name_safe = com_name.replace("'", "").replace(" ", "_")
                conf_pct = round(float(confidence) * 100)
                clip_name = f"{com_name_safe}-{conf_pct}-{basename.replace('.wav', '.mp3')}"

                det = {
                    "date": det_time.strftime("%Y-%m-%d"),
                    "time": det_time.strftime("%H:%M:%S"),
                    "sci_name": sci_name,
                    "com_name": com_name,
                    "confidence": round(float(confidence), 4),
                    "lat": lat,
                    "lon": lon,
                    "cutoff": min_conf,
                    "week": week,
                    "sens": sensitivity,
                    "overlap": overlap,
                    "file_name": clip_name,
                    "model": model.name,
                    "_start": pred_start,
                    "_stop": pred_end,
                }
                with self._db_lock:
                    write_detection(self.db, det)
                detections.append(det)
                log.info("  [%s] %s — %s (%.1f%%)", tag, com_name,
                         sci_name, confidence * 100)

            pred_start = pred_end - overlap

        # Store detections for post-processing by process_file (after file move)
        return detections

    def _secondary_worker(self):
        """Background thread that processes files with the secondary model."""
        while True:
            item = self._secondary_queue.get()
            if item is None:
                break
            file_path, file_date, week, raw_sig, raw_sr = item
            basename = os.path.basename(file_path)
            try:
                t0 = time.time()
                dets = self._analyze_with_model(
                    self.secondary_model, file_path, file_date, week,
                    self.secondary_model.name,
                    raw_sig=raw_sig, raw_sr=raw_sr)
                elapsed = time.time() - t0
                log.info("[%s] %s: %d detections in %.1fs",
                         self.secondary_model.name, basename,
                         len(dets), elapsed)
                # Post-processing for secondary model
                if dets:
                    def _sec_post(detections, fpath, cfg, notifier):
                        try:
                            if cfg["output"].get("sync_to_biloute", False):
                                remote_host = cfg["audio"]["remote_host"]
                                remote_db = cfg["output"]["biloute_db"]
                                sync_detections_to_remote(detections, remote_host, remote_db)
                            for d in detections:
                                extract_clip(fpath, d, cfg)
                            upload_to_birdweather(fpath, detections, cfg)
                        except Exception as e:
                            log.warning("[%s] Post-processing error: %s",
                                        self.secondary_model.name, e)
                    t = threading.Thread(target=_sec_post,
                                         args=(dets, file_path, self.config, self.notifier),
                                         daemon=True)
                    t.start()
            except Exception as e:
                log.exception("[%s] Error on %s: %s",
                              self.secondary_model.name, basename, e)
            self._secondary_queue.task_done()

    def process_file(self, file_path):
        """Analyze a single WAV file with primary model, queue for secondary."""
        try:
            basename = os.path.basename(file_path)
            if basename in self.processed_files:
                return
            # Wait for file to be fully written (rsync may still be writing)
            if not os.path.exists(file_path):
                return
            for _ in range(5):
                try:
                    size = os.path.getsize(file_path)
                    if size == 0:
                        time.sleep(0.5)
                        continue
                    time.sleep(0.3)
                    if os.path.getsize(file_path) == size:
                        break  # File size stable
                except OSError:
                    return
            if not os.path.exists(file_path) or os.path.getsize(file_path) == 0:
                return
            log.info("Analyzing: %s", basename)
            start_time = time.time()

            # Parse date/time from filename
            name = os.path.splitext(basename)[0]
            date_match = re.search(r"(\d{4}-\d{2}-\d{2})", name)
            time_match = re.search(r"(\d{2}:\d{2}:\d{2})$", name)
            if not date_match or not time_match:
                log.warning("Cannot parse filename: %s", basename)
                return

            file_date = datetime.datetime.strptime(
                f"{date_match.group(1)}T{time_match.group(1)}", "%Y-%m-%dT%H:%M:%S"
            )
            week = min(48, file_date.isocalendar()[1])  # BirdNET MData expects 1-48

            # Read raw audio once (shared between models)
            raw_sig, raw_sr = sf.read(file_path, dtype="float32", always_2d=False)
            if raw_sig.ndim > 1:
                raw_sig = raw_sig.mean(axis=1)

            # Apply adaptive gain if enabled (Phase 2)
            raw_sig, gain_applied = apply_adaptive_gain(raw_sig)
            if gain_applied != 0:
                log.info("Adaptive gain applied: %+.1f dB", gain_applied)

            # Apply audio filters (highpass, lowpass, denoise, RMS normalize)
            audio_conf = load_audio_config()
            raw_sig = apply_filters(raw_sig, raw_sr, audio_conf)

            # Primary model (fast, synchronous)
            detections = self._analyze_with_model(
                self.primary_model, file_path, file_date, week,
                self.primary_model.name,
                raw_sig=raw_sig, raw_sr=raw_sr)

            elapsed = time.time() - start_time
            self.files_processed += 1
            self.detections_total += len(detections)
            log.info("[%s] Done: %d detections in %.1fs [total: %d files, %d det]",
                     self.primary_model.name, len(detections), elapsed,
                     self.files_processed, self.detections_total)

            self.processed_files.add(basename)

            # Move to processed
            processed_dir = self.config["audio"]["processed_dir"]
            os.makedirs(processed_dir, exist_ok=True)
            dest = os.path.join(processed_dir, basename)
            shutil.move(file_path, dest)

            # Post-processing in background thread (uses dest path, after file move)
            if detections:
                def _post_process(dets, fpath, cfg, notifier):
                    try:
                        if cfg["output"].get("sync_to_biloute", False):
                            remote_host = cfg["audio"]["remote_host"]
                            remote_db = cfg["output"]["biloute_db"]
                            sync_detections_to_remote(dets, remote_host, remote_db)
                        for d in dets:
                            extract_clip(fpath, d, cfg)
                        for d in dets:
                            notifier.check_and_notify(d)
                        upload_to_birdweather(fpath, dets, cfg)
                    except Exception as e:
                        log.warning("Post-processing error: %s", e)

                t = threading.Thread(target=_post_process,
                                     args=(detections, dest, self.config, self.notifier),
                                     daemon=True)
                t.start()
                self._post_threads = [pt for pt in self._post_threads if pt.is_alive()]
                self._post_threads.append(t)

            # Queue for secondary model with raw audio (avoids re-reading file)
            if self.secondary_model and self._secondary_queue is not None:
                self._secondary_queue.put((dest, file_date, week, raw_sig, raw_sr))

        except Exception as e:
            log.exception("Error processing %s: %s", file_path, e)

    def _read_birdnet_conf(self):
        """Parse birdnet.conf and return a dict of key=value pairs."""
        birdnet_conf = "/etc/birdnet/birdnet.conf"
        if not os.path.exists(birdnet_conf):
            return {}
        result = {}
        with open(birdnet_conf) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, val = line.split("=", 1)
                    result[key] = val.strip('"')
        return result

    def _check_model_change(self):
        """Check if birdnet.conf MODEL or SECONDARY_MODEL has changed, reload if so."""
        try:
            conf = self._read_birdnet_conf()
            det = self.config["detection"]
            sens = det.get("sensitivity", 1.0)
            sf_val = det.get("sf_thresh", 0.03)
            mdv = det.get("mdata_version", 2)

            # Check primary model
            new_primary = conf.get("MODEL", self.primary_model.name)
            if new_primary != self.primary_model.name:
                log.info("Primary model change: %s -> %s", self.primary_model.name, new_primary)
                self.primary_model = get_model(new_primary, self.models_dir, sens, sf_val, mdv)
                log.info("Primary model reloaded: %s (sr=%d, chunk=%ds)",
                         new_primary, self.primary_model.sample_rate,
                         self.primary_model.chunk_duration)

            # Check dual-model toggle + secondary model
            dual_enabled = conf.get("DUAL_MODEL_ENABLED", "1") == "1"
            new_secondary = conf.get("SECONDARY_MODEL", "")

            if dual_enabled and new_secondary:
                current_name = self.secondary_model.name if self.secondary_model else ""
                if new_secondary != current_name:
                    log.info("Secondary model change: %s -> %s", current_name or "none", new_secondary)
                    # Drain queue before swapping model
                    if self._secondary_queue:
                        self._secondary_queue.join()
                    self.secondary_model = get_model(new_secondary, self.models_dir, sens, sf_val, mdv)
                    if not self._secondary_queue:
                        from queue import Queue
                        self._secondary_queue = Queue()
                        self._secondary_thread = threading.Thread(
                            target=self._secondary_worker, daemon=True)
                        self._secondary_thread.start()
                    log.info("Secondary model reloaded: %s (sr=%d, chunk=%ds)",
                             new_secondary, self.secondary_model.sample_rate,
                             self.secondary_model.chunk_duration)
            elif not dual_enabled and self.secondary_model:
                log.info("Dual-model disabled, stopping secondary model")
                self.secondary_model = None

        except Exception as e:
            log.warning("Error checking model change: %s", e)

    def _purge_processed(self, max_age_seconds=7200):
        """Delete processed WAV files older than max_age_seconds. Also trim processed_files set."""
        # Trim the in-memory set to prevent unbounded growth
        if len(self.processed_files) > 5000:
            self.processed_files.clear()
            log.info("Cleared processed_files set (was > 5000)")
        processed_dir = self.config["audio"]["processed_dir"]
        if not os.path.isdir(processed_dir):
            return
        now = time.time()
        count = 0
        for fname in os.listdir(processed_dir):
            if not fname.endswith(".wav"):
                continue
            fpath = os.path.join(processed_dir, fname)
            if now - os.path.getmtime(fpath) > max_age_seconds:
                os.remove(fpath)
                count += 1
        if count:
            log.info("Purged %d old processed WAV files", count)

    def run(self):
        """Main loop: rsync + watch for new files."""
        incoming_dir = self.config["audio"]["incoming_dir"]
        os.makedirs(incoming_dir, exist_ok=True)

        # Start secondary model worker thread
        if self.secondary_model:
            self._secondary_thread = threading.Thread(
                target=self._secondary_worker, daemon=True)
            self._secondary_thread.start()
            log.info("Secondary model worker started")

        # Process any existing files first
        existing = sorted(
            f for f in os.listdir(incoming_dir) if f.endswith(".wav")
        )
        if existing:
            log.info("Processing %d existing files...", len(existing))
            for fname in existing:
                if self.shutdown:
                    return
                self.process_file(os.path.join(incoming_dir, fname))

        # Start file watcher
        handler = WavHandler(self.process_file)
        observer = Observer()
        observer.schedule(handler, incoming_dir, recursive=False)
        observer.start()
        log.info("Watching %s for new WAV files", incoming_dir)

        # Rsync loop
        source = self.config["audio"].get("source", "rsync")
        rsync_interval = self.config["audio"].get("rsync_interval", 30)

        purge_counter = 0
        try:
            while not self.shutdown:
                if source == "rsync":
                    rsync_audio(self.config)
                # Every 10 cycles (~5 min): purge old WAVs + check model change
                purge_counter += 1
                if purge_counter >= 10:
                    self._purge_processed()
                    self._check_model_change()
                    purge_counter = 0
                self._shutdown_event.wait(timeout=rsync_interval)
        except KeyboardInterrupt:
            log.info("Interrupted")
        finally:
            observer.stop()
            observer.join()
            # Drain secondary queue
            if self._secondary_queue:
                log.info("Waiting for secondary model to finish...")
                self._secondary_queue.put(None)
                self._secondary_thread.join(timeout=120)
            # Wait for post-processing threads
            active = [t for t in self._post_threads if t.is_alive()]
            if active:
                log.info("Waiting for %d post-processing threads...", len(active))
                for t in active:
                    t.join(timeout=10)
            self.db.close()
            log.info("Shutdown complete. Processed %d files, %d detections.",
                     self.files_processed, self.detections_total)


def main():
    logging.basicConfig(
        level=logging.INFO,
        format="[%(asctime)s][%(name)s][%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )

    config_path = sys.argv[1] if len(sys.argv) > 1 else "config.toml"
    config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), config_path)

    engine = BirdEngine(config_path)

    def handle_signal(sig, frame):
        log.info("Received signal %d, shutting down...", sig)
        engine.shutdown = True
        engine._shutdown_event.set()

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    engine.run()


if __name__ == "__main__":
    main()
