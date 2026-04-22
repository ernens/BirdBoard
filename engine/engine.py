#!/usr/bin/env python3
"""BirdEngine — Modern bird detection engine for Raspberry Pi 5.

Watches for WAV files from local recording, runs BirdNET / Perch
inference, and writes detections to SQLite.

The orchestration lives here in `BirdEngine`. The reusable units have
been split into focused sibling modules:

  audio.py       — read_audio, sound-level monitoring, adaptive gain,
                   filter pipeline, chunk splitter
  models.py      — TFLite wrappers (MData, BirdNET v1/v2.4, Perch v2)
                   + load_labels / load_language / get_model factory
  db.py          — SQLite bootstrap + write_detection
  birdweather.py — soundscape + detections upload
  clips.py       — MP3 extraction + matching plasma spectrogram PNG
  watcher.py     — WavHandler (rotates one-behind to avoid races)

Tests still import from `engine` so the symbols are re-exported below.
"""

import datetime
import json
import logging
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

log = logging.getLogger("birdengine")


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

def load_config(path="config.toml"):
    with open(path) as f:
        return toml.load(f)


# ---------------------------------------------------------------------------
# Re-exports — keep `from engine import X` working for tests + external code.
# New code should import directly from the relevant module.
# ---------------------------------------------------------------------------

from audio import (
    read_audio,
    compute_sound_level, record_sound_level,
    apply_adaptive_gain,
    load_audio_config, apply_filters,
    split_signal,
)
from models import (
    load_labels, load_language, create_interpreter,
    MDataModel, BirdNETv1Model, BirdNETModel, PerchModel,
    get_model,
)
from db import init_db, write_detection
from birdweather import upload_to_birdweather
from clips import extract_clip
from watcher import WavHandler


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

        # Load species names — prefer birdnet.conf DATABASE_LANG (source of
        # truth, shared with birdash UI), fallback to config.toml station.language
        lang = (birdnet_settings.get("DATABASE_LANG")
                or self.config["station"].get("language")
                or "en")[:2]
        try:
            self.names = load_language(lang, self.models_dir)
            self._current_lang = lang
        except FileNotFoundError:
            log.warning("Language '%s' not found, falling back to 'en'", lang)
            self.names = load_language("en", self.models_dir)
            self._current_lang = "en"

        # Init database
        db_path = self.config["output"]["local_db"]
        self.db = init_db(db_path)
        log.info("Database: %s", db_path)

        # Stats
        self.files_processed = 0
        self.detections_total = 0
        self.processed_files = set()
        self._db_lock = threading.Lock()
        self._post_threads = []  # Track post-processing threads for clean shutdown
        self._post_lock = threading.Lock()  # Guards _post_threads (primary + secondary workers both append)

        # ── Noisy-species throttle ────────────────────────────────────────
        # In-memory dict mapping species (Com_Name) to last DB-insert time
        # (epoch seconds). When NOISY_THROTTLE_ENABLED is on in birdnet.conf,
        # detections of the same species within THROTTLE_COOLDOWN_SECONDS are
        # dropped before insert — unless their confidence is at or above
        # THROTTLE_BYPASS_CONFIDENCE (preserves "perfect" calls regardless).
        # Resets at process restart; that's fine, the cooldown re-anchors on
        # the first detection after restart.
        self._throttle_last = {}        # {com_name: last_insert_epoch}
        self._throttle_dropped = 0       # session counter (Prom-readable later)

        # ── Perch eBird range filter ──────────────────────────────────────
        # Perch has no MData equivalent for geographic filtering, so its
        # outputs include species that can't possibly be at this location
        # (Cornell trained on global data). When RANGE_FILTER_PERCH_EBIRD=1
        # in birdnet.conf, we drop Perch predictions whose sci_name is
        # absent from the eBird "recently observed near here" map that
        # birdash already maintains in config/ebird-frequency.json.
        self.perch_ebird_filter = (
            birdnet_settings.get("RANGE_FILTER_PERCH_EBIRD", "0") == "1"
        )
        self.perch_ebird_set = set()
        self._perch_ebird_path = None
        self._perch_ebird_mtime = 0
        if self.perch_ebird_filter:
            self._reload_perch_ebird()

        # ── YAMNet pre-filter (privacy + dog) ─────────────────────────────
        # When privacy or dog filter is enabled, run YAMNet on each WAV
        # BEFORE BirdNET / Perch inference. Voice → drop the file (and
        # optionally delete the audio for RGPD); barks → set a cooldown
        # window during which we skip detections (dogs trigger streams of
        # false positives across consecutive chunks).
        self.privacy_filter_enabled = (
            birdnet_settings.get("PRIVACY_FILTER_ENABLED", "0") == "1"
        )
        try:
            self.privacy_threshold = float(
                birdnet_settings.get("PRIVACY_FILTER_THRESHOLD", "0.5"))
        except ValueError:
            self.privacy_threshold = 0.5
        self.privacy_delete_audio = (
            birdnet_settings.get("PRIVACY_FILTER_DELETE_AUDIO", "1") == "1"
        )
        self.dog_filter_enabled = (
            birdnet_settings.get("DOG_FILTER_ENABLED", "0") == "1"
        )
        try:
            self.dog_threshold = float(
                birdnet_settings.get("DOG_FILTER_THRESHOLD", "0.5"))
        except ValueError:
            self.dog_threshold = 0.5
        try:
            self.dog_cooldown_sec = float(
                birdnet_settings.get("DOG_FILTER_COOLDOWN_SEC", "15"))
        except ValueError:
            self.dog_cooldown_sec = 15.0
        self._dog_silence_until = 0.0
        self._yamnet = None
        if self.privacy_filter_enabled or self.dog_filter_enabled:
            try:
                from yamnet_filter import YAMNetFilter, find_default_paths
                model, labels = find_default_paths(self.models_dir)
                if not os.path.exists(model):
                    log.warning("[yamnet] model not found at %s — pre-filter disabled", model)
                else:
                    self._yamnet = YAMNetFilter(model, labels)
                    log.info("[yamnet] loaded — privacy=%s (>%.2f, delete_audio=%s) dog=%s (>%.2f, cooldown=%.0fs)",
                             self.privacy_filter_enabled, self.privacy_threshold,
                             self.privacy_delete_audio,
                             self.dog_filter_enabled, self.dog_threshold,
                             self.dog_cooldown_sec)
            except Exception as e:
                log.warning("[yamnet] init failed: %s — pre-filter disabled", e)
                self._yamnet = None

    def _source_from_path(self, file_path):
        """Derive the multi-source key from a recording path.

        incoming/foo.wav            → None (legacy single-source)
        incoming/garden/foo.wav      → 'garden'
        incoming/garden/sub/foo.wav  → 'garden' (only the top-level dir matters)

        Returns None when the file lives directly in the incoming root.
        """
        try:
            incoming_dir = self.config["audio"]["incoming_dir"]
            rel = os.path.relpath(file_path, incoming_dir)
            parts = rel.split(os.sep)
            return parts[0] if len(parts) > 1 else None
        except (KeyError, ValueError):
            return None

    def _analyze_with_model(self, model, file_path, file_date, week, tag,
                            raw_sig=None, raw_sr=None, source=None):
        """Run inference on a file with a given model. Returns list of detections.

        If raw_sig/raw_sr are provided, skip file read and resample from those.
        `source` is propagated into each detection's `Source` DB column.
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
        # Refresh the per-Perch eBird presence set if the cache file on
        # disk was rewritten by birdash since we last read it (cheap mtime
        # check, no IO if unchanged).
        if self.perch_ebird_filter:
            self._reload_perch_ebird()
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
                # Perch eBird range filter — opt-in via RANGE_FILTER_PERCH_EBIRD.
                # Drops sci_names absent from the eBird "recently observed
                # near here" set, so Perch can't report tropical species
                # that BirdNET's MData filter would have caught.
                if is_perch and self.perch_ebird_filter and self.perch_ebird_set:
                    if sci_name not in self.perch_ebird_set:
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
                    "source": source,
                    "_start": pred_start,
                    "_stop": pred_end,
                }
                # Noisy-species throttle (opt-in, off by default). When a
                # species (e.g. a sparrow camped next to the mic) dominates
                # the audio, we drop its low-confidence repeats within the
                # cooldown window but always keep high-confidence calls.
                if self._should_throttle(com_name, confidence):
                    log.debug("  [%s] %s — %s (%.1f%%) THROTTLED (cooldown)",
                              tag, com_name, sci_name, confidence * 100)
                    # Don't insert into DB, don't append to detections list;
                    # downstream post-processing (MP3, spectro, BirdWeather
                    # upload) is also skipped by consequence.
                    continue
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
            # Older queue items (pre-multi-source) had 5 elements; new ones
            # have 6 with the source key as the trailing element. Tolerate
            # both during the rolling restart that ships this change.
            if len(item) == 5:
                file_path, file_date, week, raw_sig, raw_sr = item
                source = None
            else:
                file_path, file_date, week, raw_sig, raw_sr, source = item
            basename = os.path.basename(file_path)
            try:
                t0 = time.time()
                dets = self._analyze_with_model(
                    self.secondary_model, file_path, file_date, week,
                    self.secondary_model.name,
                    raw_sig=raw_sig, raw_sr=raw_sr, source=source)
                elapsed = time.time() - t0
                log.info("[%s] %s: %d detections in %.1fs",
                         self.secondary_model.name, basename,
                         len(dets), elapsed)
                # Post-processing for secondary model
                if dets:
                    def _sec_post(detections, fpath, cfg):
                        try:
                            for d in detections:
                                extract_clip(fpath, d, cfg)
                            upload_to_birdweather(fpath, detections, cfg)
                        except Exception as e:
                            log.warning("[%s] Post-processing error: %s",
                                        self.secondary_model.name, e)
                    t = threading.Thread(target=_sec_post,
                                         args=(dets, file_path, self.config),
                                         daemon=True)
                    t.start()
                    # Track so the shutdown handler waits for this too —
                    # otherwise the Perch MP3 clips are never extracted and
                    # every detection in the DB for this file becomes an
                    # "Erreur de décodage audio" on the dashboard.
                    with self._post_lock:
                        self._post_threads[:] = [pt for pt in self._post_threads if pt.is_alive()]
                        self._post_threads.append(t)
            except Exception as e:
                log.exception("[%s] Error on %s: %s",
                              self.secondary_model.name, basename, e)
            self._secondary_queue.task_done()

    def process_file(self, file_path):
        """Analyze a single WAV file with primary model, queue for secondary.

        Multi-source: the source key is derived from the recording's path
        relative to the incoming root (`incoming/garden/foo.wav` →
        `'garden'`). Files directly in `incoming/` are treated as legacy
        single-source (Source = NULL).
        """
        source = self._source_from_path(file_path)
        try:
            basename = os.path.basename(file_path)
            if basename in self.processed_files:
                return
            if not os.path.exists(file_path):
                return
            # Defensive sanity check — the watcher's "process previous on
            # rotation" logic and the startup mtime defer mean the file
            # should always be complete here, but if rsync (multi-Pi setup)
            # is still writing we wait a moment more.
            try:
                size = os.path.getsize(file_path)
                if size == 0:
                    time.sleep(0.5)
                    if os.path.getsize(file_path) == 0:
                        return
            except OSError:
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

            # Sound-level snapshot (dBFS, uncalibrated) — pre-gain/pre-filter
            try:
                leq_db, peak_db = compute_sound_level(raw_sig)
                duration = len(raw_sig) / float(raw_sr) if raw_sr else 0.0
                record_sound_level(leq_db, peak_db, duration, basename)
            except Exception as e:
                log.debug("[sound-level] compute failed: %s", e)

            # ── YAMNet pre-filter (privacy + dog) ─────────────────────
            # Runs BEFORE adaptive gain so we classify the original audio
            # the user actually recorded — gain shouldn't change YAMNet's
            # mind, but we don't want to risk it amplifying speech to the
            # detection threshold either.
            if self._yamnet is not None:
                try:
                    voice, dog, top_label, top_score = self._yamnet.analyze(raw_sig, raw_sr)
                    if (self.privacy_filter_enabled
                            and voice >= self.privacy_threshold):
                        log.info("[privacy] DROP %s — voice=%.2f (top=%s %.2f)",
                                 basename, voice, top_label, top_score)
                        if self.privacy_delete_audio:
                            try:
                                os.unlink(file_path)
                                log.info("[privacy] deleted %s (RGPD)", basename)
                            except OSError as e:
                                log.warning("[privacy] could not delete %s: %s", basename, e)
                        self.processed_files.add(basename)
                        return
                    if (self.dog_filter_enabled
                            and dog >= self.dog_threshold):
                        self._dog_silence_until = time.time() + self.dog_cooldown_sec
                        log.info("[dog] DROP %s — bark=%.2f (top=%s %.2f) cooldown %.0fs",
                                 basename, dog, top_label, top_score,
                                 self.dog_cooldown_sec)
                        self.processed_files.add(basename)
                        return
                except Exception as e:
                    log.warning("[yamnet] analyze failed on %s: %s — proceeding without filter", basename, e)

            # If we're inside a dog-bark cooldown from a previous file,
            # skip detection entirely (dogs bark in bursts that span
            # multiple recording windows).
            if self._yamnet is not None and time.time() < self._dog_silence_until:
                remaining = self._dog_silence_until - time.time()
                log.info("[dog] cooldown active — skip %s (%.0fs remaining)",
                         basename, remaining)
                self.processed_files.add(basename)
                return

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
                raw_sig=raw_sig, raw_sr=raw_sr, source=source)

            elapsed = time.time() - start_time
            self.files_processed += 1
            self.detections_total += len(detections)
            log.info("[%s] Done: %d detections in %.1fs [total: %d files, %d det]%s",
                     self.primary_model.name, len(detections), elapsed,
                     self.files_processed, self.detections_total,
                     f" [source: {source}]" if source else "")

            self.processed_files.add(basename)

            # Move to processed/<source>/ to keep multi-source captures
            # cleanly separated and avoid basename collisions when two
            # sources happen to rotate at the same second.
            processed_dir = self.config["audio"]["processed_dir"]
            target_dir = os.path.join(processed_dir, source) if source else processed_dir
            os.makedirs(target_dir, exist_ok=True)
            dest = os.path.join(target_dir, basename)
            shutil.move(file_path, dest)

            # Post-processing in background thread (uses dest path, after file move)
            if detections:
                def _post_process(dets, fpath, cfg):
                    try:
                        for d in dets:
                            extract_clip(fpath, d, cfg)
                        upload_to_birdweather(fpath, dets, cfg)
                    except Exception as e:
                        log.warning("Post-processing error: %s", e)

                t = threading.Thread(target=_post_process,
                                     args=(detections, dest, self.config),
                                     daemon=True)
                t.start()
                with self._post_lock:
                    self._post_threads[:] = [pt for pt in self._post_threads if pt.is_alive()]
                    self._post_threads.append(t)

            # Queue for secondary model with raw audio (avoids re-reading file)
            if self.secondary_model and self._secondary_queue is not None:
                self._secondary_queue.put((dest, file_date, week, raw_sig, raw_sr, source))

        except Exception as e:
            log.exception("Error processing %s: %s", file_path, e)

    def _reload_perch_ebird(self):
        """Load (or reload if stale) the eBird presence map used to filter
        Perch detections. Map lives at ~/birdash/config/ebird-frequency.json
        — refreshed daily by birdash from the eBird API.
        """
        candidates = [
            os.path.expanduser("~/birdash/config/ebird-frequency.json"),
            os.path.join(os.path.dirname(__file__), "..", "config",
                         "ebird-frequency.json"),
        ]
        path_used = next((p for p in candidates if os.path.exists(p)), None)
        if not path_used:
            log.warning("[range-perch] ebird-frequency.json not found — "
                        "Perch range filter disabled until birdash refreshes it")
            self.perch_ebird_set = set()
            return
        try:
            mtime = os.path.getmtime(path_used)
            if (path_used == self._perch_ebird_path
                    and mtime == self._perch_ebird_mtime):
                return
            with open(path_used) as f:
                data = json.load(f)
            # File is { sciName: 1, _ts: <epoch> }. Skip the _ts marker.
            self.perch_ebird_set = {k for k in data.keys() if not k.startswith("_")}
            self._perch_ebird_path = path_used
            self._perch_ebird_mtime = mtime
            log.info("[range-perch] eBird filter: %d species loaded from %s",
                     len(self.perch_ebird_set), path_used)
        except Exception as e:
            log.warning("[range-perch] failed to load %s: %s", path_used, e)
            self.perch_ebird_set = set()

    def _should_throttle(self, com_name, confidence, now=None):
        """Return True if this detection should be dropped by the noisy-species
        throttle. Reads fresh config from birdnet.conf on each call — cheap
        (it's already cached in-process) and lets the user toggle the feature
        without restarting the engine.

        Logic:
          1. Feature off (NOISY_THROTTLE_ENABLED != 1) → never throttle.
          2. Confidence ≥ THROTTLE_BYPASS_CONFIDENCE → always keep (clear call).
          3. Same species inserted within THROTTLE_COOLDOWN_SECONDS → drop.
          4. Otherwise → keep, update last-seen timestamp.
        """
        conf = self._read_birdnet_conf()
        if str(conf.get("NOISY_THROTTLE_ENABLED", "0")) != "1":
            return False
        try:
            bypass = float(conf.get("THROTTLE_BYPASS_CONFIDENCE", "0.95"))
        except ValueError:
            bypass = 0.95
        if confidence >= bypass:
            return False
        try:
            cooldown = int(conf.get("THROTTLE_COOLDOWN_SECONDS", "120"))
        except ValueError:
            cooldown = 120
        if cooldown <= 0:
            return False
        if now is None:
            now = time.time()
        last = self._throttle_last.get(com_name, 0)
        if now - last < cooldown:
            self._throttle_dropped += 1
            return True
        self._throttle_last[com_name] = now
        return False

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

            # Hot-reload per-model thresholds from birdnet.conf
            if "BIRDNET_CONFIDENCE" in conf:
                det["birdnet_confidence"] = float(conf["BIRDNET_CONFIDENCE"])
            if "PERCH_CONFIDENCE" in conf:
                det["perch_confidence"] = float(conf["PERCH_CONFIDENCE"])
            if "PERCH_MIN_MARGIN" in conf:
                det["perch_min_margin"] = float(conf["PERCH_MIN_MARGIN"])
            if "SENSITIVITY" in conf:
                det["sensitivity"] = float(conf["SENSITIVITY"])
            if "OVERLAP" in conf:
                det["overlap"] = float(conf["OVERLAP"])

            # Hot-reload species-name language if DATABASE_LANG changed
            new_lang = (conf.get("DATABASE_LANG") or "")[:2]
            if new_lang and new_lang != getattr(self, "_current_lang", None):
                try:
                    self.names = load_language(new_lang, self.models_dir)
                    self._current_lang = new_lang
                    log.info("Species-name language reloaded: %s", new_lang)
                except FileNotFoundError:
                    log.warning("Language '%s' not available", new_lang)

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
        """Delete processed WAV files older than max_age_seconds. Also trim processed_files set.

        Walks processed_dir recursively so per-source subdirs (processed/garden/,
        processed/feeder/) are purged the same as flat legacy layout.
        """
        # Trim the in-memory set to prevent unbounded growth
        if len(self.processed_files) > 5000:
            self.processed_files.clear()
            log.info("Cleared processed_files set (was > 5000)")
        processed_dir = self.config["audio"]["processed_dir"]
        if not os.path.isdir(processed_dir):
            return
        now = time.time()
        count = 0
        for root, _dirs, files in os.walk(processed_dir):
            for fname in files:
                if not fname.endswith(".wav"):
                    continue
                fpath = os.path.join(root, fname)
                try:
                    if now - os.path.getmtime(fpath) > max_age_seconds:
                        os.remove(fpath)
                        count += 1
                except OSError:
                    pass
        if count:
            log.info("Purged %d old processed WAV files", count)

    def _sweep_empty_clips(self):
        """Remove 0-byte MP3/PNG files in BirdSongs/Extracted — leftovers
        from ffmpeg crashes (OOM, SD-card I/O contention). Without this
        sweep, the dashboard keeps showing "Erreur de décodage audio" for
        detections that will never have a usable clip.
        """
        root = os.path.join(os.path.expanduser("~"), "BirdSongs", "Extracted", "By_Date")
        if not os.path.isdir(root):
            return
        removed = 0
        for date_dir in os.listdir(root):
            date_path = os.path.join(root, date_dir)
            if not os.path.isdir(date_path):
                continue
            for sp_dir in os.listdir(date_path):
                sp_path = os.path.join(date_path, sp_dir)
                if not os.path.isdir(sp_path):
                    continue
                for f in os.listdir(sp_path):
                    if not (f.endswith(".mp3") or f.endswith(".png")):
                        continue
                    fp = os.path.join(sp_path, f)
                    try:
                        if os.path.getsize(fp) == 0:
                            os.unlink(fp)
                            removed += 1
                    except OSError:
                        pass
        if removed:
            log.info("Swept %d empty clip files (ffmpeg leftovers)", removed)

    def run(self):
        """Main loop: rsync + watch for new files."""
        incoming_dir = self.config["audio"]["incoming_dir"]
        os.makedirs(incoming_dir, exist_ok=True)

        # One-shot startup cleanup of any 0-byte MP3/PNG files left behind
        # by previous ffmpeg crashes — these are otherwise sticky errors
        # in the dashboard.
        try:
            self._sweep_empty_clips()
        except Exception as e:
            log.debug("[startup-sweep] %s", e)

        # Build the watcher first so we can seed its "pending" with an
        # in-progress file if the engine restarted mid-recording.
        handler = WavHandler(self.process_file)

        # Start secondary model worker thread
        if self.secondary_model:
            self._secondary_thread = threading.Thread(
                target=self._secondary_worker, daemon=True)
            self._secondary_thread.start()
            log.info("Secondary model worker started")

        # Process any existing files first — walks subdirs (multi-source layout).
        # If the most recent file in any source was modified within the last
        # few seconds, arecord is probably still writing it; seed the watcher
        # with it so it gets picked up on the next rotation.
        existing = []
        for root, _dirs, files in os.walk(incoming_dir):
            for fname in files:
                if fname.endswith(".wav"):
                    existing.append(os.path.join(root, fname))
        existing.sort()
        if existing:
            last_path = existing[-1]
            try:
                last_age = time.time() - os.path.getmtime(last_path)
            except OSError:
                last_age = 999
            if last_age < 3.0:
                handler._pending = last_path
                log.info("Deferring in-progress file: %s (age=%.1fs)",
                         os.path.relpath(last_path, incoming_dir), last_age)
                existing = existing[:-1]
        if existing:
            log.info("Processing %d existing files...", len(existing))
            for fpath in existing:
                if self.shutdown:
                    return
                self.process_file(fpath)

        # Start file watcher — recursive=True so per-source subdirectories
        # (incoming/garden/, incoming/feeder/) are picked up automatically.
        # Legacy single-source captures dropped directly in incoming/ keep
        # working unchanged.
        observer = Observer()
        observer.schedule(handler, incoming_dir, recursive=True)
        observer.start()
        log.info("Watching %s for new WAV files (recursive — multi-source aware)", incoming_dir)

        # Main loop
        rsync_interval = self.config["audio"].get("rsync_interval", 30)

        purge_counter = 0
        try:
            while not self.shutdown:
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
            # Wait for post-processing threads (both primary and secondary
            # model post-processing append to this list now). Each thread
            # loops over detections → ffmpeg + spectrogram, so 30 s total is
            # comfortably over the worst observed case on Pi 5.
            with self._post_lock:
                active = [t for t in self._post_threads if t.is_alive()]
            if active:
                log.info("Waiting for %d post-processing threads...", len(active))
                for t in active:
                    t.join(timeout=30)
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
