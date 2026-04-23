#!/usr/bin/env python3
"""BirdEngine unit tests. Run: python -m pytest test_engine.py -v"""

import json
import os
import sys
import tempfile
import time
import unittest

import numpy as np

# Add engine directory to path
sys.path.insert(0, os.path.dirname(__file__))


class TestLoadConfig(unittest.TestCase):
    def test_load_valid_toml(self):
        from engine import load_config
        with tempfile.NamedTemporaryFile(mode='w', suffix='.toml', delete=False) as f:
            f.write('[station]\nname = "Test"\nlatitude = 50.0\nlongitude = 4.0\n')
            f.flush()
            config = load_config(f.name)
            self.assertEqual(config['station']['name'], 'Test')
            self.assertEqual(config['station']['latitude'], 50.0)
        os.unlink(f.name)


class TestSplitSignal(unittest.TestCase):
    def test_basic_split(self):
        from engine import split_signal
        sig = np.zeros(48000 * 10, dtype=np.float32)  # 10s at 48kHz
        chunks = split_signal(sig, 48000, 0.5, seconds=3.0)
        self.assertGreater(len(chunks), 0)
        self.assertEqual(len(chunks[0]), 48000 * 3)

    def test_short_signal(self):
        from engine import split_signal
        sig = np.zeros(1000, dtype=np.float32)  # Too short
        chunks = split_signal(sig, 48000, 0.0, seconds=3.0)
        self.assertEqual(len(chunks), 0)

    def test_zero_padding(self):
        from engine import split_signal
        sig = np.ones(48000 * 4, dtype=np.float32)  # 4s
        chunks = split_signal(sig, 48000, 0.0, seconds=3.0)
        self.assertEqual(len(chunks), 1)  # Only 1 full chunk, remainder too short

    def test_overlap(self):
        from engine import split_signal
        sig = np.zeros(48000 * 10, dtype=np.float32)
        chunks_no_overlap = split_signal(sig, 48000, 0.0, seconds=3.0)
        chunks_overlap = split_signal(sig, 48000, 1.0, seconds=3.0)
        self.assertGreater(len(chunks_overlap), len(chunks_no_overlap))


class TestLoadLabels(unittest.TestCase):
    def test_load_and_strip(self):
        from engine import load_labels
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, 'Test_Labels.txt'), 'w') as f:
                f.write('Pica pica_Eurasian Magpie\nTurdus merula_Common Blackbird\n')
            labels = load_labels('Test', d)
            self.assertEqual(labels[0], 'Pica pica')
            self.assertEqual(labels[1], 'Turdus merula')

    def test_no_strip_when_no_underscore(self):
        from engine import load_labels
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, 'Test_Labels.txt'), 'w') as f:
                f.write('Pica pica\nTurdus merula\n')
            labels = load_labels('Test', d)
            self.assertEqual(labels[0], 'Pica pica')


class TestWriteDetection(unittest.TestCase):
    def test_no_duplicate(self):
        from engine import init_db, write_detection
        with tempfile.NamedTemporaryFile(suffix='.db', delete=False) as f:
            db_path = f.name
        conn = init_db(db_path)
        det = {
            'date': '2026-01-01', 'time': '12:00:00',
            'sci_name': 'Pica pica', 'com_name': 'Pie bavarde',
            'confidence': 0.95, 'lat': 50.0, 'lon': 4.0,
            'cutoff': 0.65, 'week': 1, 'sens': 1.0, 'overlap': 0.5,
            'file_name': 'test.mp3', 'model': 'TestModel',
        }
        result1 = write_detection(conn, det)
        result2 = write_detection(conn, det)
        self.assertTrue(result1)  # First insert succeeds
        self.assertFalse(result2)  # Duplicate blocked
        # Verify only 1 row
        count = conn.execute('SELECT COUNT(*) FROM detections').fetchone()[0]
        self.assertEqual(count, 1)
        # Source column defaults to NULL when det['source'] is absent
        src = conn.execute('SELECT Source FROM detections').fetchone()[0]
        self.assertIsNone(src)
        conn.close()
        os.unlink(db_path)

    def test_source_persisted(self):
        """Multi-source: det['source'] lands in the Source column."""
        from engine import init_db, write_detection
        with tempfile.NamedTemporaryFile(suffix='.db', delete=False) as f:
            db_path = f.name
        conn = init_db(db_path)
        det = {
            'date': '2026-04-23', 'time': '08:00:00',
            'sci_name': 'Turdus merula', 'com_name': 'Merle noir',
            'confidence': 0.88, 'lat': 50.0, 'lon': 4.0,
            'cutoff': 0.65, 'week': 17, 'sens': 1.0, 'overlap': 0.5,
            'file_name': 'merle.mp3', 'model': 'BirdNET',
            'source': 'garden',
        }
        self.assertTrue(write_detection(conn, det))
        row = conn.execute('SELECT Sci_Name, Source FROM detections').fetchone()
        self.assertEqual(row, ('Turdus merula', 'garden'))
        conn.close()
        os.unlink(db_path)

    def test_init_db_idempotent_migration(self):
        """init_db on a pre-multi-source schema adds the Source column."""
        import sqlite3
        from engine import init_db
        with tempfile.NamedTemporaryFile(suffix='.db', delete=False) as f:
            db_path = f.name
        # Build the OLD schema (no Source column) by hand
        old = sqlite3.connect(db_path)
        old.execute("""
            CREATE TABLE detections (
                Date DATE, Time TIME, Sci_Name VARCHAR(100) NOT NULL,
                Com_Name VARCHAR(100) NOT NULL, Confidence FLOAT,
                Lat FLOAT, Lon FLOAT, Cutoff FLOAT, Week INT,
                Sens FLOAT, Overlap FLOAT, File_Name VARCHAR(100) NOT NULL,
                Model VARCHAR(50)
            )
        """)
        old.execute("INSERT INTO detections VALUES ('2025-12-25','10:00:00','Pica pica','Pie',0.9,0,0,0.65,52,1.0,0.5,'a.mp3','M')")
        old.commit(); old.close()
        # init_db should ALTER TABLE non-destructively
        conn = init_db(db_path)
        cols = {r[1] for r in conn.execute('PRAGMA table_info(detections)').fetchall()}
        self.assertIn('Source', cols)
        # Pre-existing row stays intact, Source = NULL
        row = conn.execute('SELECT Sci_Name, Source FROM detections').fetchone()
        self.assertEqual(row, ('Pica pica', None))
        conn.close()
        os.unlink(db_path)


# NOTE: Removed TestDetToSql + TestNotifier — they referenced symbols
# (_det_to_sql, Notifier) that were dropped from engine.py long before
# the modular split (notifications now live in server/lib/notification-watcher.js,
# and write_detection uses parameterized queries instead of SQL building).


class TestReadAudio(unittest.TestCase):
    def test_read_wav(self):
        import soundfile as sf
        from engine import read_audio
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
            data = np.random.randn(48000).astype(np.float32)
            sf.write(f.name, data, 48000)
            result = read_audio(f.name, 48000)
            self.assertEqual(len(result), 48000)
        os.unlink(f.name)

    def test_stereo_to_mono(self):
        import soundfile as sf
        from engine import read_audio
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
            data = np.random.randn(48000, 2).astype(np.float32)
            sf.write(f.name, data, 48000)
            result = read_audio(f.name, 48000)
            self.assertEqual(result.ndim, 1)
        os.unlink(f.name)


class TestFindOrphans(unittest.TestCase):
    """Regression tests for the watcher-orphan pickup helper.

    Reproduces the bug where files created during the startup-scan window
    (or any time the watchdog Observer hadn't fired yet) sit forever in
    incoming/. _find_orphans() lets the main loop sweep them up.
    """

    def setUp(self):
        from engine import _find_orphans  # noqa: F401 — import side-effect check
        self.tmpdir = tempfile.mkdtemp()

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _make_wav(self, name, age_seconds):
        """Create an empty .wav and backdate its mtime."""
        path = os.path.join(self.tmpdir, name)
        with open(path, 'wb') as f:
            f.write(b'')
        old = time.time() - age_seconds
        os.utime(path, (old, old))
        return path

    def test_returns_only_old_wavs(self):
        """Old WAVs are orphans; ones still being written by arecord are not."""
        from engine import _find_orphans
        old = self._make_wav('old.wav', age_seconds=120)
        self._make_wav('fresh.wav', age_seconds=1)  # arecord still writing
        orphans = _find_orphans(self.tmpdir, pending_path=None, max_age_seconds=60)
        self.assertEqual(orphans, [old])

    def test_excludes_pending_path(self):
        """The watcher's _pending file isn't an orphan — next event handles it."""
        from engine import _find_orphans
        pending = self._make_wav('pending.wav', age_seconds=120)
        other   = self._make_wav('other.wav',   age_seconds=120)
        orphans = _find_orphans(self.tmpdir, pending_path=pending, max_age_seconds=60)
        self.assertEqual(orphans, [other])

    def test_walks_subdirs(self):
        """Multi-source layout (incoming/garden/, incoming/feeder/) is covered."""
        from engine import _find_orphans
        sub = os.path.join(self.tmpdir, 'garden')
        os.makedirs(sub)
        path = os.path.join(sub, 'g.wav')
        with open(path, 'wb') as f: f.write(b'')
        old = time.time() - 120
        os.utime(path, (old, old))
        orphans = _find_orphans(self.tmpdir, pending_path=None, max_age_seconds=60)
        self.assertEqual(orphans, [path])

    def test_ignores_non_wav(self):
        """Non-.wav files in incoming/ are not orphans."""
        from engine import _find_orphans
        with open(os.path.join(self.tmpdir, 'log.txt'), 'w') as f: f.write('x')
        wav = self._make_wav('a.wav', age_seconds=120)
        orphans = _find_orphans(self.tmpdir, pending_path=None, max_age_seconds=60)
        self.assertEqual(orphans, [wav])

    def test_missing_dir_returns_empty(self):
        """Defensive: no incoming dir yet → empty list, no exception."""
        from engine import _find_orphans
        self.assertEqual(_find_orphans('/nonexistent', None), [])


if __name__ == '__main__':
    unittest.main()
