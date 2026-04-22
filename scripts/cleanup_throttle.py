#!/usr/bin/env python3
"""
BIRDASH — Retroactive noisy-species throttle cleanup.

Applies the same rule as engine.py's live throttle (cooldown + bypass-confidence)
to historical rows in birds.db. Each row that would have been throttled gets:
  - its DB row removed
  - its mp3 + .mp3.png moved to a quarantine directory (NOT rm'd)

A safe SQLite backup of birds.db is taken first. Quarantined audio stays on the
same filesystem as BirdSongs so the move is a rename (instant, no extra space
needed). The user can `mv` files back to restore, or `rm -rf` the quarantine
dir to fully reclaim space after verification.

Usage:
  ./scripts/cleanup_throttle.py                 # dry-run, current config
  ./scripts/cleanup_throttle.py --apply --yes   # actually purge
  ./scripts/cleanup_throttle.py --species "Moineau domestique" --apply
  ./scripts/cleanup_throttle.py --from 2026-01-01 --to 2026-04-21 --apply
"""

import argparse
import os
import shutil
import sqlite3
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

DEFAULT_DB = "/home/bjorn/BirdNET-Pi/scripts/birds.db"
DEFAULT_AUDIO_ROOT = "/home/bjorn/BirdSongs/Extracted/By_Date"
DEFAULT_BACKUP_ROOT = "/home/bjorn/birdash/data/cleanup-backup"
DEFAULT_COOLDOWN = 120
DEFAULT_BYPASS = 0.95


def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--apply", action="store_true",
                   help="actually delete (default: dry-run)")
    p.add_argument("--yes", action="store_true",
                   help="skip the confirmation prompt with --apply")
    p.add_argument("--cooldown", type=int, default=DEFAULT_COOLDOWN,
                   help=f"cooldown seconds per species (default {DEFAULT_COOLDOWN})")
    p.add_argument("--bypass", type=float, default=DEFAULT_BYPASS,
                   help=f"confidence threshold to always keep (default {DEFAULT_BYPASS})")
    p.add_argument("--from", dest="date_from", default=None,
                   help="lower bound YYYY-MM-DD inclusive (default: beginning)")
    p.add_argument("--to", dest="date_to", default=None,
                   help="upper bound YYYY-MM-DD inclusive (default: yesterday — never touch today)")
    p.add_argument("--species", default=None,
                   help="restrict to one Com_Name (e.g. 'Moineau domestique')")
    p.add_argument("--db", default=DEFAULT_DB,
                   help=f"path to birds.db (default {DEFAULT_DB})")
    p.add_argument("--audio-root", default=DEFAULT_AUDIO_ROOT,
                   help=f"audio root (default {DEFAULT_AUDIO_ROOT})")
    p.add_argument("--backup-dir", default=None,
                   help=f"backup root (default {DEFAULT_BACKUP_ROOT}/<timestamp>)")
    p.add_argument("--no-backup", action="store_true",
                   help="skip DB backup (dangerous, for debugging only)")
    p.add_argument("--vacuum", action="store_true",
                   help="run VACUUM after delete (slow, can be run later)")
    p.add_argument("--batch-size", type=int, default=500,
                   help="DELETE batch size (default 500)")
    return p.parse_args()


def fmt_bytes(n):
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} PB"


def parse_ts(date_s, time_s):
    # Date='2026-04-22', Time='06:42:45' -> epoch
    return datetime.strptime(f"{date_s} {time_s}", "%Y-%m-%d %H:%M:%S").timestamp()


def species_dir(com_name):
    return com_name.replace(" ", "_")


def compute_to_delete(db_path, cooldown, bypass, date_from, date_to, species):
    """Walks detections in chronological order applying the throttle rule."""
    where = ["1=1"]
    params = []
    if date_from:
        where.append("Date >= ?"); params.append(date_from)
    if date_to:
        where.append("Date <= ?"); params.append(date_to)
    if species:
        where.append("Com_Name = ?"); params.append(species)

    sql = f"""
      SELECT rowid, Date, Time, Com_Name, Confidence, File_Name
      FROM detections
      WHERE {' AND '.join(where)}
      ORDER BY Date, Time
    """

    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row

    last_kept_ts = {}        # com_name -> last kept epoch
    to_delete = []           # list of (rowid, date, com_name, file_name)
    per_species = {}         # com_name -> {kept_bypass, kept_first, dropped, total}
    total = 0

    try:
        for row in conn.execute(sql, params):
            total += 1
            stats = per_species.setdefault(row["Com_Name"],
                                           {"kept_bypass": 0, "kept_first": 0, "dropped": 0, "total": 0})
            stats["total"] += 1

            if row["Confidence"] >= bypass:
                stats["kept_bypass"] += 1
                continue

            try:
                ts = parse_ts(row["Date"], row["Time"])
            except (TypeError, ValueError):
                stats["kept_first"] += 1
                continue

            last = last_kept_ts.get(row["Com_Name"])
            if last is None or (ts - last) >= cooldown:
                last_kept_ts[row["Com_Name"]] = ts
                stats["kept_first"] += 1
                continue

            stats["dropped"] += 1
            to_delete.append((row["rowid"], row["Date"], row["Com_Name"], row["File_Name"]))
    finally:
        conn.close()

    return to_delete, per_species, total


def disk_estimate(to_delete, audio_root):
    total = 0
    found_audio = 0
    found_png = 0
    sample = []
    for _, date, com, fname in to_delete:
        if not fname:
            continue
        audio = Path(audio_root) / date / species_dir(com) / fname
        png = Path(str(audio) + ".png")
        try:
            total += audio.stat().st_size; found_audio += 1
        except OSError:
            pass
        try:
            total += png.stat().st_size; found_png += 1
        except OSError:
            pass
        if len(sample) < 5:
            sample.append(str(audio))
    return total, found_audio, found_png, sample


def backup_db(db_path, backup_dir):
    backup_dir.mkdir(parents=True, exist_ok=True)
    target = backup_dir / "birds-pre-cleanup.db"
    print(f"\n[backup] copying {db_path} → {target} (sqlite3 .backup) ...")
    t0 = time.time()
    src = sqlite3.connect(db_path)
    dst = sqlite3.connect(str(target))
    try:
        src.backup(dst)
    finally:
        dst.close(); src.close()
    size = target.stat().st_size
    print(f"[backup] done in {time.time() - t0:.1f}s — {fmt_bytes(size)}")
    return target


def quarantine_audio(to_delete, audio_root, quarantine_root):
    """Moves mp3 + .mp3.png to quarantine, preserving Date/Species layout."""
    moved_audio = 0
    moved_png = 0
    missing = 0
    errors = 0
    audio_root = Path(audio_root)
    quarantine_root = Path(quarantine_root)
    last_progress = time.time()

    for i, (_, date, com, fname) in enumerate(to_delete, 1):
        if not fname:
            continue
        species = species_dir(com)
        src_audio = audio_root / date / species / fname
        src_png = Path(str(src_audio) + ".png")
        dst_dir = quarantine_root / date / species
        dst_dir.mkdir(parents=True, exist_ok=True)

        if src_audio.exists():
            try:
                shutil.move(str(src_audio), str(dst_dir / fname))
                moved_audio += 1
            except OSError as e:
                errors += 1
                print(f"  [warn] move failed: {src_audio}: {e}", file=sys.stderr)
        else:
            missing += 1

        if src_png.exists():
            try:
                shutil.move(str(src_png), str(dst_dir / (fname + ".png")))
                moved_png += 1
            except OSError as e:
                errors += 1

        now = time.time()
        if now - last_progress > 2:
            print(f"  [audio] {i}/{len(to_delete)} processed", end="\r", flush=True)
            last_progress = now

    print(f"\n[audio] moved {moved_audio} mp3 + {moved_png} png ; missing {missing} ; errors {errors}")
    return moved_audio, moved_png, missing, errors


def delete_rows(db_path, rowids, batch_size):
    print(f"\n[db] deleting {len(rowids)} rows in batches of {batch_size} ...")
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA busy_timeout = 30000")
    try:
        deleted = 0
        for start in range(0, len(rowids), batch_size):
            chunk = rowids[start:start + batch_size]
            placeholders = ",".join("?" * len(chunk))
            conn.execute(f"DELETE FROM detections WHERE rowid IN ({placeholders})", chunk)
            deleted += len(chunk)
            if start % (batch_size * 20) == 0:
                conn.commit()
                print(f"  [db] {deleted}/{len(rowids)}", end="\r", flush=True)
        conn.commit()
        print(f"\n[db] {deleted} rows deleted")
    finally:
        conn.close()


def vacuum(db_path):
    print(f"\n[db] VACUUM (this can take a while) ...")
    t0 = time.time()
    conn = sqlite3.connect(db_path)
    try:
        conn.execute("VACUUM")
    finally:
        conn.close()
    print(f"[db] VACUUM done in {time.time() - t0:.1f}s")


def main():
    args = parse_args()

    if not Path(args.db).exists():
        print(f"ERROR: DB not found: {args.db}", file=sys.stderr)
        sys.exit(1)

    if not args.date_to:
        # Default to yesterday — never touch today's incoming detections
        args.date_to = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")

    print(f"BIRDASH cleanup_throttle — {'DRY-RUN' if not args.apply else 'APPLY'}")
    print("─" * 60)
    print(f"  DB           : {args.db}")
    print(f"  audio root   : {args.audio_root}")
    print(f"  cooldown     : {args.cooldown} s")
    print(f"  bypass       : ≥ {args.bypass}")
    print(f"  date range   : {args.date_from or '<beginning>'} → {args.date_to}")
    print(f"  species      : {args.species or '<all>'}")
    print()

    print("[scan] computing throttle decisions ...")
    t0 = time.time()
    to_delete, per_species, total = compute_to_delete(
        args.db, args.cooldown, args.bypass, args.date_from, args.date_to, args.species)
    print(f"[scan] {total} rows scanned in {time.time() - t0:.1f}s")

    if not to_delete:
        print("\nNothing to do — no rows match the throttle rule.")
        return

    by_drop = sorted(per_species.items(), key=lambda kv: kv[1]["dropped"], reverse=True)
    print("\n  species                            kept(bypass)  kept(first)   drop  total")
    print("  ───────────────────────────────────  ───────────  ───────────  ─────  ─────")
    for com, s in by_drop[:15]:
        if s["dropped"] == 0:
            continue
        print(f"  {com[:35]:35}  {s['kept_bypass']:>11}  {s['kept_first']:>11}  {s['dropped']:>5}  {s['total']:>5}")
    if len(by_drop) > 15:
        rest = sum(s["dropped"] for _, s in by_drop[15:])
        print(f"  ... + {len(by_drop) - 15} more species, {rest} more drops")

    bytes_est, audio_n, png_n, sample = disk_estimate(to_delete, args.audio_root)
    print(f"\n[disk] would free ≈ {fmt_bytes(bytes_est)} "
          f"({audio_n} mp3 + {png_n} png present on disk for {len(to_delete)} rows)")
    print(f"[disk] sample paths:")
    for p in sample:
        print(f"  {p}")

    if not args.apply:
        print("\n──── DRY-RUN — nothing changed. Re-run with --apply to purge. ────")
        return

    if not args.yes:
        print(f"\n>>> About to delete {len(to_delete)} rows + quarantine "
              f"≈{fmt_bytes(bytes_est)} of audio. <<<")
        if input(">>> Type 'YES' to proceed: ") != "YES":
            print("Aborted.")
            sys.exit(1)

    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_dir = Path(args.backup_dir) if args.backup_dir else Path(DEFAULT_BACKUP_ROOT) / ts
    quarantine_dir = backup_dir / "audio"
    print(f"\n[backup] target dir: {backup_dir}")

    if not args.no_backup:
        backup_db(args.db, backup_dir)

    quarantine_audio(to_delete, args.audio_root, quarantine_dir)
    delete_rows(args.db, [r[0] for r in to_delete], args.batch_size)

    if args.vacuum:
        vacuum(args.db)

    print()
    print("═" * 60)
    print("DONE.")
    print(f"  Backup       : {backup_dir}")
    print(f"  Restore DB   : sqlite3 {args.db} '.restore {backup_dir}/birds-pre-cleanup.db'")
    print(f"  Restore mp3  : rsync -av {quarantine_dir}/ {args.audio_root}/")
    print(f"  Reclaim      : rm -rf {backup_dir}   (after verification)")
    print("═" * 60)


if __name__ == "__main__":
    main()
