#!/usr/bin/env bash
# BIRDASH — Backup script (rsync incremental)
# Reads configuration from $BACKUP_CONFIG (JSON)
# Writes live progress to $STATUS_FILE for the UI
set -euo pipefail

# ── Lock : empêcher les sessions multiples ──────────────────────────────────
LOCKFILE="/tmp/birdash-backup.lock"
exec 200>"$LOCKFILE"
if ! flock -n 200; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup déjà en cours — abandon" >> /var/log/birdash-backup.log
    # Write blocked status so the UI can show feedback
    STATUS_FILE="${BACKUP_STATUS:-$(dirname "$0")/../config/backup-status.json}"
    cat > "$STATUS_FILE" <<BEOF
{"state":"blocked","percent":0,"step":"","detail":"Un autre backup est déjà en cours","startedAt":null,"updatedAt":"$(date -u '+%Y-%m-%dT%H:%M:%SZ')"}
BEOF
    exit 0
fi

CONFIG_FILE="${BACKUP_CONFIG:-$(dirname "$0")/../config/backup.json}"
STATUS_FILE="${BACKUP_STATUS:-$(dirname "$0")/../config/backup-status.json}"
LOG_FILE="/var/log/birdash-backup.log"
# Fallback if /var/log not writable
if ! touch "$LOG_FILE" 2>/dev/null; then
  LOG_FILE="$HOME/.local/share/birdash-backup.log"
  mkdir -p "$(dirname "$LOG_FILE")"
fi
HISTORY_FILE="${CONFIG_FILE%/*}/backup-history.json"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE" 2>/dev/null || echo "$*"; }

# ── Progress tracking ─────────────────────────────────────────────────────────
# Writes a JSON status file that the API serves to the frontend
STARTED_AT=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

progress() {
  # Usage: progress <state> <percent> <step> <detail>
  #   state:  running | completed | failed | stopped
  #   percent: 0-100
  #   step:   current step label (e.g. "db", "config", "projects", "audio", "upload")
  #   detail: human-readable detail string
  local state="$1" pct="$2" step="${3:-}" detail="${4:-}"
  cat > "$STATUS_FILE" <<PEOF
{"state":"${state}","percent":${pct},"step":"${step}","detail":"${detail}","startedAt":"${STARTED_AT}","updatedAt":"$(date -u '+%Y-%m-%dT%H:%M:%SZ')"}
PEOF
}

# Append to history (keep last 10 entries)
append_history() {
  local status="$1" detail="$2"
  local ended_at
  ended_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  local size
  size=$(du -sh "$BACKUP_BASE" 2>/dev/null | cut -f1 || echo "?")
  local steps_done
  steps_done=$(IFS=,; echo "${STEP_LIST[*]}")
  local entry="{\"startedAt\":\"${STARTED_AT}\",\"endedAt\":\"${ended_at}\",\"status\":\"${status}\",\"detail\":\"${detail}\",\"destination\":\"${DEST}\",\"size\":\"${size}\",\"steps\":\"${steps_done}\"}"
  if [ -f "$HISTORY_FILE" ]; then
    node -e "
      const fs=require('fs');
      let h=[]; try{h=JSON.parse(fs.readFileSync('$HISTORY_FILE','utf8'));}catch(e){}
      h.push($entry); if(h.length>10) h=h.slice(-10);
      fs.writeFileSync('$HISTORY_FILE',JSON.stringify(h,null,2));
    " 2>/dev/null || true
  else
    echo "[$entry]" > "$HISTORY_FILE"
  fi
}

# Cleanup status on exit
cleanup() {
  local code=$?
  if [ $code -eq 0 ]; then
    progress "completed" 100 "done" "Backup terminé"
    append_history "success" "Backup terminé"
  else
    progress "failed" "${_LAST_PCT:-0}" "${_LAST_STEP:-}" "Erreur (code $code)"
    append_history "failed" "Erreur code $code à l'étape ${_LAST_STEP:-?}"
    # Update backup.json on failure too
    node -e "
      const fs=require('fs');
      try {
        const cfg=JSON.parse(fs.readFileSync('${CONFIG_FILE}','utf8'));
        cfg.lastRun=new Date().toISOString();
        cfg.lastStatus='failed';
        fs.writeFileSync('${CONFIG_FILE}',JSON.stringify(cfg,null,2));
      } catch(e) {}
    " 2>/dev/null || true
  fi
}
trap cleanup EXIT

_LAST_PCT=0
_LAST_STEP=""

# Track current progress for the trap
track() { _LAST_PCT="$1"; _LAST_STEP="$2"; }

if [ ! -f "$CONFIG_FILE" ]; then
  log "ERROR: Config file not found: $CONFIG_FILE"
  progress "failed" 0 "" "Config file not found"
  exit 1
fi

# Parse JSON config using node
read_json() {
  node -e "const c=JSON.parse(require('fs').readFileSync('$CONFIG_FILE','utf8')); const v=$1; console.log(v===undefined||v===null?'':v);" 2>/dev/null
}

DEST=$(read_json "c.destination")
CONTENT=$(read_json "JSON.stringify(c.content||['all'])")
RETENTION=$(read_json "c.retention||30")

BIRDNET_DIR="$HOME/birdash/engine"
SONGS_DIR="$HOME/BirdSongs"
BIRDASH_DIR="$HOME/birdash"

# rsync with low IO/CPU priority
RSYNC="ionice -c3 nice -n 19 rsync"
RSYNC_OPTS="-avh --delete --partial --info=progress2"

# Determine what to back up
should_backup() {
  echo "$CONTENT" | node -e "const c=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.exit(c.includes('all')||c.includes('$1')?0:1);" 2>/dev/null
}

# Count total steps to calculate percentages dynamically
TOTAL_STEPS=0
STEP_LIST=()
if should_backup "db";     then TOTAL_STEPS=$((TOTAL_STEPS+1)); STEP_LIST+=("db"); fi
if should_backup "config"; then TOTAL_STEPS=$((TOTAL_STEPS+1)); STEP_LIST+=("config"); fi
if should_backup "projects"; then TOTAL_STEPS=$((TOTAL_STEPS+1)); STEP_LIST+=("projects"); fi
if should_backup "audio";  then TOTAL_STEPS=$((TOTAL_STEPS+1)); STEP_LIST+=("audio"); fi
# Upload step for remote staging destinations
case "$DEST" in sftp|s3|gdrive|webdav) TOTAL_STEPS=$((TOTAL_STEPS+1)); STEP_LIST+=("upload");; esac

if [ "$TOTAL_STEPS" -eq 0 ]; then TOTAL_STEPS=1; fi

# Returns the percentage range [start, end] for step N (0-indexed)
step_pct_start() { echo $(( ($1 * 100) / TOTAL_STEPS )); }
step_pct_end()   { echo $(( (($1 + 1) * 100) / TOTAL_STEPS )); }
CURRENT_STEP_IDX=0

# ── Resolve destination path ────────────────────────────────────────────────
resolve_dest() {
  case "$DEST" in
    local)
      BACKUP_BASE=$(read_json "c.local.path||'/mnt/backup'")
      mkdir -p "$BACKUP_BASE"
      ;;
    nfs)
      local NFS_HOST NFS_EXPORT NFS_MOUNT NFS_REMOTE
      NFS_HOST=$(read_json "c.nfs.host")
      NFS_EXPORT=$(read_json "c.nfs.exportPath")
      NFS_MOUNT=$(read_json "c.nfs.mountPoint||'/mnt/backup'")
      NFS_REMOTE=$(read_json "c.nfs.remotePath||'/birdash-backup'")

      if ! mountpoint -q "$NFS_MOUNT" 2>/dev/null || ! ls "$NFS_MOUNT/" >/dev/null 2>&1; then
        log "NFS not mounted or stale, attempting remount..."
        progress "running" 1 "mount" "Montage NFS $NFS_HOST..."
        sudo umount -l "$NFS_MOUNT" 2>/dev/null || true
        sleep 2
        sudo mount "$NFS_MOUNT" 2>/dev/null || sudo mount -t nfs "$NFS_HOST:$NFS_EXPORT" "$NFS_MOUNT"
        if ! mountpoint -q "$NFS_MOUNT" || ! ls "$NFS_MOUNT/" >/dev/null 2>&1; then
          log "ERROR: Cannot mount NFS $NFS_HOST:$NFS_EXPORT on $NFS_MOUNT"
          exit 1
        fi
        log "NFS remounted successfully"
      fi
      BACKUP_BASE="$NFS_MOUNT$NFS_REMOTE"
      mkdir -p "$BACKUP_BASE"
      ;;
    smb)
      local SMB_HOST SMB_SHARE SMB_USER SMB_PASS SMB_REMOTE
      SMB_HOST=$(read_json "c.smb.host")
      SMB_SHARE=$(read_json "c.smb.share")
      SMB_USER=$(read_json "c.smb.user")
      SMB_PASS=$(read_json "c.smb.pass")
      SMB_REMOTE=$(read_json "c.smb.remotePath||'/birdash-backup'")
      SMB_MOUNT="/tmp/birdash-smb-$$"
      mkdir -p "$SMB_MOUNT"
      progress "running" 1 "mount" "Montage SMB //$SMB_HOST/$SMB_SHARE..."
      sudo mount -t cifs "//$SMB_HOST/$SMB_SHARE" "$SMB_MOUNT" -o "username=$SMB_USER,password=$SMB_PASS,uid=$(id -u),gid=$(id -g)"
      BACKUP_BASE="$SMB_MOUNT$SMB_REMOTE"
      mkdir -p "$BACKUP_BASE"
      _SMB_MOUNT="$SMB_MOUNT"
      ;;
    sftp)
      SFTP_HOST=$(read_json "c.sftp.host")
      SFTP_PORT=$(read_json "c.sftp.port||22")
      SFTP_USER=$(read_json "c.sftp.user")
      SFTP_PASS=$(read_json "c.sftp.pass")
      SFTP_REMOTE=$(read_json "c.sftp.remotePath||'/birdash-backup'")
      _SFTP_MODE=1
      BACKUP_BASE=$(mktemp -d "/tmp/birdash-staging-XXXX")
      ;;
    s3)
      _S3_MODE=1
      BACKUP_BASE=$(mktemp -d "/tmp/birdash-staging-XXXX")
      ;;
    gdrive)
      _GDRIVE_MODE=1
      BACKUP_BASE=$(mktemp -d "/tmp/birdash-staging-XXXX")
      ;;
    webdav)
      _WEBDAV_MODE=1
      BACKUP_BASE=$(mktemp -d "/tmp/birdash-staging-XXXX")
      ;;
    *)
      log "ERROR: Unknown destination: $DEST"
      exit 1
      ;;
  esac
}

# ── Upload staging dir for remote-only destinations ─────────────────────────
upload_staging() {
  # Find the upload step index
  local upload_start upload_end
  upload_start=$(step_pct_start $CURRENT_STEP_IDX)
  upload_end=$(step_pct_end $CURRENT_STEP_IDX)
  track "$upload_start" "upload"

  if [ "${_SFTP_MODE:-}" = "1" ]; then
    progress "running" "$upload_start" "upload" "Upload SFTP $SFTP_HOST..."
    log "Uploading to SFTP $SFTP_HOST:$SFTP_REMOTE..."
    if command -v sshpass &>/dev/null && [ -n "$SFTP_PASS" ]; then
      sshpass -p "$SFTP_PASS" rsync -avhz -e "ssh -p $SFTP_PORT -o StrictHostKeyChecking=no" \
        --delete --partial "$BACKUP_BASE/" "$SFTP_USER@$SFTP_HOST:$SFTP_REMOTE/" 2>> "$LOG_FILE"
    else
      rsync -avhz -e "ssh -p $SFTP_PORT -o StrictHostKeyChecking=no" \
        --delete --partial "$BACKUP_BASE/" "$SFTP_USER@$SFTP_HOST:$SFTP_REMOTE/" 2>> "$LOG_FILE"
    fi
    log "SFTP upload complete"
    rm -rf "$BACKUP_BASE"
  elif [ "${_S3_MODE:-}" = "1" ]; then
    local S3_BUCKET S3_REGION S3_KEY S3_SECRET S3_REMOTE
    S3_BUCKET=$(read_json "c.s3.bucket")
    S3_REGION=$(read_json "c.s3.region||'eu-west-1'")
    S3_KEY=$(read_json "c.s3.accessKey")
    S3_SECRET=$(read_json "c.s3.secretKey")
    S3_REMOTE=$(read_json "c.s3.remotePath||'birdash-backup'")
    progress "running" "$upload_start" "upload" "Upload S3 s3://$S3_BUCKET..."
    log "Uploading to S3 s3://$S3_BUCKET/$S3_REMOTE..."
    AWS_ACCESS_KEY_ID="$S3_KEY" AWS_SECRET_ACCESS_KEY="$S3_SECRET" AWS_DEFAULT_REGION="$S3_REGION" \
      aws s3 sync "$BACKUP_BASE/" "s3://$S3_BUCKET/$S3_REMOTE/" --delete 2>> "$LOG_FILE"
    log "S3 upload complete"
    rm -rf "$BACKUP_BASE"
  elif [ "${_GDRIVE_MODE:-}" = "1" ]; then
    local GDRIVE_FOLDER
    GDRIVE_FOLDER=$(read_json "c.gdrive.folderId")
    if command -v rclone &>/dev/null; then
      progress "running" "$upload_start" "upload" "Upload Google Drive..."
      log "Uploading to Google Drive (folder: $GDRIVE_FOLDER)..."
      rclone sync "$BACKUP_BASE/" "gdrive:$GDRIVE_FOLDER" 2>> "$LOG_FILE"
      log "Google Drive upload complete"
    else
      log "ERROR: rclone not installed (required for Google Drive backup)"
      rm -rf "$BACKUP_BASE"
      exit 1
    fi
    rm -rf "$BACKUP_BASE"
  elif [ "${_WEBDAV_MODE:-}" = "1" ]; then
    local WEBDAV_URL WEBDAV_USER WEBDAV_PASS WEBDAV_REMOTE
    WEBDAV_URL=$(read_json "c.webdav.url")
    WEBDAV_USER=$(read_json "c.webdav.user")
    WEBDAV_PASS=$(read_json "c.webdav.pass")
    WEBDAV_REMOTE=$(read_json "c.webdav.remotePath||'/birdash-backup'")
    progress "running" "$upload_start" "upload" "Upload WebDAV..."
    log "Uploading to WebDAV $WEBDAV_URL$WEBDAV_REMOTE..."
    if command -v rclone &>/dev/null; then
      rclone sync "$BACKUP_BASE/" ":webdav,url=$WEBDAV_URL,user=$WEBDAV_USER,pass=$(rclone obscure "$WEBDAV_PASS"):$WEBDAV_REMOTE" 2>> "$LOG_FILE"
    else
      local ARCHIVE="/tmp/birdash-webdav-upload.tar.gz"
      tar -czf "$ARCHIVE" -C "$BACKUP_BASE" .
      curl -s -T "$ARCHIVE" -u "$WEBDAV_USER:$WEBDAV_PASS" "$WEBDAV_URL$WEBDAV_REMOTE/birdash-backup-$(date +%Y%m%d).tar.gz"
      rm -f "$ARCHIVE"
    fi
    log "WebDAV upload complete"
    rm -rf "$BACKUP_BASE"
  fi

  # SMB cleanup
  if [ -n "${_SMB_MOUNT:-}" ]; then
    sudo umount "$_SMB_MOUNT" 2>/dev/null || true
    rmdir "$_SMB_MOUNT" 2>/dev/null || true
  fi

  progress "running" "$upload_end" "upload" "Upload terminé"
}

# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════
log "========================================="
log "BIRDASH backup — destination: $DEST"
log "========================================="

progress "running" 0 "init" "Initialisation — destination: $DEST"

resolve_dest

# Create backup subdirectories
mkdir -p "$BACKUP_BASE"/{db,config,data}

# ── Step 1: Database (sqlite3 safe dump) ────────────────────────────────────
if should_backup "db"; then
  PCT_START=$(step_pct_start $CURRENT_STEP_IDX)
  PCT_END=$(step_pct_end $CURRENT_STEP_IDX)
  track "$PCT_START" "db"
  progress "running" "$PCT_START" "db" "Dump des bases de données..."
  log "Step 1: Database dump..."

  DB_LIST=()
  for db in "$BIRDNET_DIR/scripts/birds.db" \
            "$BIRDNET_DIR/scripts/detections.db" \
            "$BIRDNET_DIR/scripts/flickr.db" \
            "$BIRDNET_DIR/birds.db"; do
    [ -f "$db" ] && DB_LIST+=("$db")
  done

  DB_TOTAL=${#DB_LIST[@]}
  DB_IDX=0
  for db in "${DB_LIST[@]}"; do
    dbname=$(basename "$db")
    DB_IDX=$((DB_IDX+1))
    sub_pct=$(( PCT_START + (PCT_END - PCT_START) * DB_IDX / (DB_TOTAL + 1) ))
    progress "running" "$sub_pct" "db" "Dump $dbname ($DB_IDX/$DB_TOTAL)"
    log "  Dumping $dbname..."
    sqlite3 "$db" ".backup '$BACKUP_BASE/db/$dbname'" 2>> "$LOG_FILE" || log "  WARN: Could not dump $dbname"
  done

  # InfluxDB backup (Docker) — if available
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q influxdb; then
    progress "running" "$((PCT_END - 2))" "db" "InfluxDB backup..."
    log "  InfluxDB backup..."
    mkdir -p "$BACKUP_BASE/db/influxdb"
    rm -f "$BACKUP_BASE/db/influxdb/"*.tar 2>/dev/null
    docker exec influxdb influx backup /tmp/influx-backup --compression none 2>> "$LOG_FILE" && \
    docker cp influxdb:/tmp/influx-backup/. "$BACKUP_BASE/db/influxdb/" 2>> "$LOG_FILE" && \
    docker exec influxdb rm -rf /tmp/influx-backup 2>> "$LOG_FILE" || \
    log "  WARN: InfluxDB backup failed"
  fi

  progress "running" "$PCT_END" "db" "Bases de données OK"
  log "  Databases OK"
  CURRENT_STEP_IDX=$((CURRENT_STEP_IDX+1))
fi

# ── Step 2: Configuration ────────────────────────────────────────────────────

if should_backup "config"; then
  PCT_START=$(step_pct_start $CURRENT_STEP_IDX)
  PCT_END=$(step_pct_end $CURRENT_STEP_IDX)
  track "$PCT_START" "config"
  progress "running" "$PCT_START" "config" "Sauvegarde configuration..."
  log "Step 2: Configuration..."

  mkdir -p "$BACKUP_BASE/config/systemd" "$BACKUP_BASE/config/etc"

  for svc in birdnet_analysis birdnet_log birdnet_recording birdnet_stats \
             chart_viewer livestream spectrogram_viewer web_terminal \
             birdash caddy; do
    src="/etc/systemd/system/${svc}.service"
    [ -f "$src" ] && cp "$src" "$BACKUP_BASE/config/systemd/" 2>/dev/null || true
  done

  progress "running" $(( (PCT_START + PCT_END) / 2 )) "config" "Fichiers système..."

  for conf in /etc/birdnet/birdnet.conf /etc/caddy /etc/hostapd /etc/dnsmasq.conf /etc/fstab; do
    [ -e "$conf" ] && cp -r "$conf" "$BACKUP_BASE/config/etc/" 2>/dev/null || true
  done

  crontab -l > "$BACKUP_BASE/config/crontab-$(whoami).txt" 2>/dev/null || true
  sudo crontab -l > "$BACKUP_BASE/config/crontab-root.txt" 2>/dev/null || true

  cp "$BIRDASH_DIR/public/js/birdash-local.js" "$BACKUP_BASE/config/" 2>/dev/null || true
  cp "$BIRDASH_DIR/config/backup.json" "$BACKUP_BASE/config/" 2>/dev/null || true

  cp "$BIRDNET_DIR/scripts/include_species_list.txt" "$BACKUP_BASE/config/" 2>/dev/null || true
  cp "$BIRDNET_DIR/scripts/exclude_species_list.txt" "$BACKUP_BASE/config/" 2>/dev/null || true

  $RSYNC $RSYNC_OPTS \
    "$HOME/.bashrc" "$HOME/.profile" "$HOME/.gitconfig" \
    "$BACKUP_BASE/config/" 2>> "$LOG_FILE" || true

  progress "running" "$PCT_END" "config" "Configuration OK"
  log "  Configuration OK"
  CURRENT_STEP_IDX=$((CURRENT_STEP_IDX+1))
fi

# ── Step 3: Projects (rsync incremental) ─────────────────────────────────────

if should_backup "projects"; then
  PCT_START=$(step_pct_start $CURRENT_STEP_IDX)
  PCT_END=$(step_pct_end $CURRENT_STEP_IDX)
  track "$PCT_START" "projects"
  progress "running" "$PCT_START" "projects" "Synchronisation projets..."
  log "Step 3: Syncing projects..."

  PROJECT_LIST=(birdash)
  PROJECT_TOTAL=${#PROJECT_LIST[@]}
  PROJECT_IDX=0

  for dir in "${PROJECT_LIST[@]}"; do
    src="$HOME/$dir/"
    if [ -d "$src" ]; then
      
      PROJECT_IDX=$((PROJECT_IDX+1))
      sub_pct=$(( PCT_START + (PCT_END - PCT_START) * PROJECT_IDX / PROJECT_TOTAL ))
      progress "running" "$sub_pct" "projects" "Sync $dir ($PROJECT_IDX/$PROJECT_TOTAL)"
      log "  Sync $dir..."
      $RSYNC $RSYNC_OPTS "$src" "$BACKUP_BASE/data/$dir/" 2>> "$LOG_FILE" || \
      log "  WARN: rsync $dir had errors (continuing)"
    fi
  done

  progress "running" "$PCT_END" "projects" "Projets OK"
  log "  Projects OK"
  CURRENT_STEP_IDX=$((CURRENT_STEP_IDX+1))
fi

# ── Step 4: BirdSongs (the big one ~340 Go, rsync incremental) ───────────────

if should_backup "audio"; then
  PCT_START=$(step_pct_start $CURRENT_STEP_IDX)
  PCT_END=$(step_pct_end $CURRENT_STEP_IDX)
  track "$PCT_START" "audio"
  progress "running" "$PCT_START" "audio" "Synchronisation BirdSongs..."
  log "Step 4: Syncing BirdSongs (may take several hours)..."

  # Run rsync and parse progress from --info=progress2 output
  $RSYNC $RSYNC_OPTS \
    "$SONGS_DIR/" \
    "$BACKUP_BASE/data/BirdSongs/" 2>> "$LOG_FILE" | \
  while IFS= read -r line; do
    # --info=progress2 lines look like: "  1,234,567  42%  1.23MB/s  0:12:34 (xfr#100, ir-chk=200/5000)"
    if pct_match=$(echo "$line" | grep -oP '\d+%' | head -1); then
      raw_pct=${pct_match%\%}
      if [ -n "$raw_pct" ] && [ "$raw_pct" -ge 0 ] 2>/dev/null; then
        scaled_pct=$(( PCT_START + (PCT_END - PCT_START) * raw_pct / 100 ))
        progress "running" "$scaled_pct" "audio" "BirdSongs: ${raw_pct}%"
      fi
    fi
  done || log "  WARN: rsync BirdSongs had errors"

  progress "running" "$PCT_END" "audio" "BirdSongs OK"
  log "  BirdSongs OK"
  CURRENT_STEP_IDX=$((CURRENT_STEP_IDX+1))
fi

# ── Upload for remote-only destinations ──────────────────────────────────────
case "$DEST" in sftp|s3|gdrive|webdav) upload_staging ;; esac

# ── Retention cleanup ─────────────────────────────────────────────────────────
if [ "${RETENTION:-0}" -gt 0 ] 2>/dev/null; then
  log "Retention cleanup: removing files older than ${RETENTION} days..."
  find "$BACKUP_BASE" -type f -mtime +"$RETENTION" -delete 2>/dev/null || true
  find "$BACKUP_BASE" -type d -empty -delete 2>/dev/null || true
  log "  Retention cleanup done"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
USED=$(du -sh "$BACKUP_BASE" 2>/dev/null | cut -f1 || echo "N/A")
USED_BYTES=$(du -sb "$BACKUP_BASE" 2>/dev/null | cut -f1 || echo "0")
log "========================================="
log "Backup terminé ! Total: $USED"
log "========================================="

# Update backup.json with lastRun/lastStatus (so cron backups are also recorded)
node -e "
  const fs=require('fs');
  try {
    const cfg=JSON.parse(fs.readFileSync('$CONFIG_FILE','utf8'));
    cfg.lastRun=new Date().toISOString();
    cfg.lastStatus='success';
    cfg.lastBackupSize=parseInt('$USED_BYTES')||0;
    fs.writeFileSync('$CONFIG_FILE',JSON.stringify(cfg,null,2));
  } catch(e) { console.error('Failed to update config:', e.message); }
" 2>/dev/null || true

# EXIT trap will set progress to "completed" 100%
