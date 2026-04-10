#!/bin/bash
# ══════════════════════════════════════════════════════════════════════════
# Birdash — Complete installation script for Raspberry Pi 5
# https://github.com/ernens/birdash
#
# Usage:
#   git clone https://github.com/ernens/birdash.git
#   cd birdash
#   chmod +x install.sh
#   ./install.sh
#
# Tested on: Raspberry Pi OS Lite 64-bit (Trixie/Bookworm)
# ══════════════════════════════════════════════════════════════════════════

set -e

BIRDASH_USER=$(whoami)
BIRDASH_HOME=$(eval echo ~$BIRDASH_USER)
BIRDASH_DIR="$BIRDASH_HOME/birdash"
DB_DIR="$BIRDASH_HOME/birdash/data"
DB_PATH="$DB_DIR/birds.db"
SONGS_DIR="$BIRDASH_HOME/BirdSongs"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

step() { echo -e "\n${BLUE}[$1/$TOTAL_STEPS]${NC} $2"; }
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; exit 1; }

TOTAL_STEPS=10

echo ""
echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Birdash — Bird Detection Dashboard & Engine Installer${NC}"
echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
echo ""
echo "  User:     $BIRDASH_USER"
echo "  Home:     $BIRDASH_HOME"
echo "  Birdash:  $BIRDASH_DIR"
echo "  Platform: $(uname -m) $(cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d= -f2 | tr -d '"')"
echo ""
read -p "Continue with installation? [Y/n] " -n 1 -r
echo
if [[ $REPLY =~ ^[Nn]$ ]]; then exit 0; fi

# ══════════════════════════════════════════════════════════════════════════
# Step 1: System packages
# ══════════════════════════════════════════════════════════════════════════
step 1 "Installing system packages..."

PACKAGES="nodejs npm python3 python3-venv ffmpeg alsa-utils sqlite3 git nfs-common"
MISSING=""
for pkg in $PACKAGES; do
    if ! dpkg -s "$pkg" >/dev/null 2>&1; then
        MISSING="$MISSING $pkg"
    fi
done

if [ -n "$MISSING" ]; then
    echo "  Installing:$MISSING"
    sudo apt update -qq
    sudo apt install -y $MISSING
    ok "System packages installed"
else
    ok "All system packages already installed"
fi

# Caddy (from official repo if not installed)
if ! command -v caddy >/dev/null 2>&1; then
    echo "  Installing Caddy..."
    sudo apt install -y caddy 2>/dev/null || {
        sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
        curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null
        curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
        sudo apt update -qq && sudo apt install -y caddy
    }
    ok "Caddy installed"
else
    ok "Caddy already installed"
fi

# ttyd (web terminal)
if ! command -v ttyd >/dev/null 2>&1; then
    echo "  Installing ttyd..."
    ARCH=$(uname -m)
    [ "$ARCH" = "aarch64" ] && TTYD_ARCH="aarch64" || TTYD_ARCH="x86_64"
    curl -sL "https://github.com/tsl0922/ttyd/releases/latest/download/ttyd.${TTYD_ARCH}" -o /tmp/ttyd
    chmod +x /tmp/ttyd && sudo mv /tmp/ttyd /usr/local/bin/ttyd
    ok "ttyd installed"
else
    ok "ttyd already installed"
fi

# ══════════════════════════════════════════════════════════════════════════
# Step 2: Node.js dependencies
# ══════════════════════════════════════════════════════════════════════════
step 2 "Installing Node.js dependencies..."
cd "$BIRDASH_DIR"
npm install --production --silent 2>/dev/null
ok "Node.js dependencies installed ($(node --version))"

# ══════════════════════════════════════════════════════════════════════════
# Step 3: Python virtual environment
# ══════════════════════════════════════════════════════════════════════════
step 3 "Setting up Python virtual environment..."
if [ ! -d "$BIRDASH_DIR/engine/venv" ]; then
    python3 -m venv "$BIRDASH_DIR/engine/venv"
    ok "Virtual environment created"
fi
"$BIRDASH_DIR/engine/venv/bin/pip" install --upgrade pip -q 2>/dev/null
"$BIRDASH_DIR/engine/venv/bin/pip" install ai-edge-litert numpy soundfile resampy toml watchdog scipy noisereduce -q 2>/dev/null
ok "Python dependencies installed ($(python3 --version))"

# ══════════════════════════════════════════════════════════════════════════
# Step 4: Create directory structure
# ══════════════════════════════════════════════════════════════════════════
step 4 "Creating directory structure..."
mkdir -p "$BIRDASH_DIR/engine/audio/incoming"
mkdir -p "$BIRDASH_DIR/engine/audio/processed"
mkdir -p "$BIRDASH_DIR/engine/models"
mkdir -p "$BIRDASH_DIR/photo-cache"
mkdir -p "$SONGS_DIR/Extracted/By_Date"
mkdir -p "$SONGS_DIR/StreamData"
mkdir -p "$DB_DIR"
mkdir -p "$BIRDASH_HOME/.ssh/sockets"
ok "Directories created"

# ══════════════════════════════════════════════════════════════════════════
# Step 5: Create/bootstrap databases
# ══════════════════════════════════════════════════════════════════════════
step 5 "Setting up databases..."

# Main detection database (birds.db)
if [ ! -f "$DB_PATH" ]; then
    sqlite3 "$DB_PATH" <<'SQL'
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
);
CREATE INDEX IF NOT EXISTS idx_date_time ON detections(Date, Time DESC);
CREATE INDEX IF NOT EXISTS idx_com_name ON detections(Com_Name);
CREATE INDEX IF NOT EXISTS idx_sci_name ON detections(Sci_Name);
CREATE INDEX IF NOT EXISTS idx_date_sci ON detections(Date, Sci_Name);
CREATE INDEX IF NOT EXISTS idx_model ON detections(Model);
PRAGMA journal_mode=WAL;
SQL
    ok "birds.db created at $DB_PATH"
else
    ok "birds.db already exists ($(sqlite3 "$DB_PATH" 'SELECT COUNT(*) FROM detections') detections)"
fi

# Birdash validation database
if [ ! -f "$BIRDASH_DIR/birdash.db" ]; then
    sqlite3 "$BIRDASH_DIR/birdash.db" <<'SQL'
CREATE TABLE IF NOT EXISTS validations (
    date TEXT,
    time TEXT,
    sci_name TEXT,
    status TEXT DEFAULT 'unreviewed',
    notes TEXT DEFAULT '',
    updated_at TEXT,
    PRIMARY KEY(date, time, sci_name)
);
PRAGMA journal_mode=WAL;
SQL
    ok "birdash.db created"
else
    ok "birdash.db already exists"
fi

# ══════════════════════════════════════════════════════════════════════════
# Step 6: Create birdnet.conf (detection settings shared with UI)
# ══════════════════════════════════════════════════════════════════════════
step 6 "Setting up configuration..."

sudo mkdir -p /etc/birdnet
# Select optimal Perch variant based on hardware
_PI_MODEL=$(cat /proc/device-tree/model 2>/dev/null | tr -d '\0' || echo "unknown")
if echo "$_PI_MODEL" | grep -q "Pi 5"; then
    _PERCH_MODEL="perch_v2_original"
elif echo "$_PI_MODEL" | grep -qE "Pi 4|Pi 400"; then
    _PERCH_MODEL="perch_v2_fp16"
else
    _PERCH_MODEL="Perch_v2_int8"
fi
echo "  Optimal Perch model for $(echo $_PI_MODEL | grep -oP 'Pi \d+' || echo 'this hardware'): $_PERCH_MODEL"

if [ ! -f /etc/birdnet/birdnet.conf ]; then
    sudo tee /etc/birdnet/birdnet.conf > /dev/null <<EOF
# Birdash detection configuration
# This file is read by both BirdEngine and Birdash dashboard

MODEL=BirdNET_GLOBAL_6K_V2.4_Model_FP16
SENSITIVITY=1.3
CONFIDENCE=0.7
OVERLAP=0.5
SF_THRESH=0.03
DATA_MODEL_VERSION=2
RECORDING_LENGTH=45
EXTRACTION_LENGTH=6
AUDIOFMT=mp3
DATABASE_LANG=en
LATITUDE=0.0
LONGITUDE=0.0
RECS_DIR=$SONGS_DIR
PRIVACY_THRESHOLD=0
FULL_DISK=purge
PURGE_THRESHOLD=95
AUDIO_RETENTION_DAYS=90

# Dual-model (auto-select best Perch variant for this hardware)
DUAL_MODEL_ENABLED=1
SECONDARY_MODEL=$_PERCH_MODEL

# Notifications (edit ntfy topic or leave empty)
NOTIFY_ENABLED=0
NOTIFY_RARE_SPECIES=1
NOTIFY_RARE_THRESHOLD=10
NOTIFY_FIRST_SEASON=1
NOTIFY_SEASON_DAYS=30

# Apprise (notification URLs, one per line)
APPRISE_NOTIFY_EACH_DETECTION=0
APPRISE_NOTIFY_NEW_SPECIES=0
APPRISE_NOTIFY_NEW_SPECIES_EACH_DAY=0
APPRISE_WEEKLY_REPORT=0
EOF
    ok "birdnet.conf created — edit /etc/birdnet/birdnet.conf with your coordinates"
else
    ok "birdnet.conf already exists"
fi

# Engine config
if [ ! -f "$BIRDASH_DIR/engine/config.toml" ]; then
    sed "s|BIRDASH_HOME|$BIRDASH_HOME|g" "$BIRDASH_DIR/engine/config.toml.example" > "$BIRDASH_DIR/engine/config.toml"
    ok "engine/config.toml created — edit with your station location"
fi

# Dashboard local config
if [ ! -f "$BIRDASH_DIR/public/js/birdash-local.js" ]; then
    cp "$BIRDASH_DIR/config/birdash-local.example.js" "$BIRDASH_DIR/public/js/birdash-local.js"
    ok "birdash-local.js created — edit with your location"
fi

# ALSA config for shared mic access
# .asoundrc is auto-generated when user selects a device in Settings → Audio
# No hardcoded device here — works with any USB audio interface
ok "Audio device will be configured via Settings → Audio"

# FUSE config for SSHFS
if ! grep -q "^user_allow_other" /etc/fuse.conf 2>/dev/null; then
    sudo sed -i 's/^#user_allow_other/user_allow_other/' /etc/fuse.conf 2>/dev/null || true
fi

# ══════════════════════════════════════════════════════════════════════════
# Step 7: Download ML models
# ══════════════════════════════════════════════════════════════════════════
step 7 "Downloading ML models..."

MODELS_DIR="$BIRDASH_DIR/engine/models"
HF_BASE="https://huggingface.co/ernensbjorn/perch-v2-int8-tflite/resolve/main"

# Helper: download model if missing or empty
download_model() {
    local name="$1" url="$2" size_hint="$3"
    local path="$MODELS_DIR/$name"
    if [ -f "$path" ] && [ "$(stat -c%s "$path" 2>/dev/null || echo 0)" -gt 1000 ]; then
        echo "  ✓ $name already present"
        return 0
    fi
    echo "  Downloading $name ($size_hint)..."
    wget -q --show-progress -O "$path" "$url" || { warn "Download failed: $name"; return 1; }
    # Verify not empty
    if [ "$(stat -c%s "$path" 2>/dev/null || echo 0)" -lt 1000 ]; then
        warn "$name download appears corrupt (too small), removing"
        rm -f "$path"
        return 1
    fi
    return 0
}

# Detect Pi model for optimal default
PI_MODEL=$(cat /proc/device-tree/model 2>/dev/null | tr -d '\0' || echo "unknown")
echo "  Hardware: $PI_MODEL"

# Perch V2 — download all variants from HuggingFace
download_model "Perch_v2_int8.tflite" "$HF_BASE/Perch_v2_int8.tflite" "~105 MB"
download_model "Perch_v2_int8_Labels.txt" "$HF_BASE/Perch_v2_int8_Labels.txt" "~200 KB"
download_model "Perch_v2_int8_bird_indices.json" "$HF_BASE/Perch_v2_int8_bird_indices.json" "~50 KB"

# FP16 and FP32 only on Pi 4/5 (too slow on Pi 3)
if echo "$PI_MODEL" | grep -qE "Pi 4|Pi 5|Pi 400"; then
    download_model "perch_v2_fp16.tflite" "$HF_BASE/perch_v2_fp16.tflite" "~205 MB"
    download_model "perch_v2_original.tflite" "$HF_BASE/perch_v2_original.tflite" "~409 MB"
    # Copy labels/indices for fp16 and original (same as int8)
    for variant in perch_v2_fp16 perch_v2_original; do
        [ ! -f "$MODELS_DIR/${variant}_Labels.txt" ] && cp "$MODELS_DIR/Perch_v2_int8_Labels.txt" "$MODELS_DIR/${variant}_Labels.txt" 2>/dev/null
        [ ! -f "$MODELS_DIR/${variant}_bird_indices.json" ] && cp "$MODELS_DIR/Perch_v2_int8_bird_indices.json" "$MODELS_DIR/${variant}_bird_indices.json" 2>/dev/null
    done
    ok "Perch V2 models downloaded (INT8 + FP16 + FP32)"
else
    ok "Perch V2 INT8 downloaded (best for $(echo $PI_MODEL | grep -oP 'Pi \d+' || echo 'this hardware'))"
fi

# BirdNET V2.4 (CC-NC-SA license — cannot redistribute, user must provide)
if [ ! -f "$MODELS_DIR/BirdNET_GLOBAL_6K_V2.4_Model_FP16.tflite" ] || \
   [ "$(stat -c%s "$MODELS_DIR/BirdNET_GLOBAL_6K_V2.4_Model_FP16.tflite" 2>/dev/null || echo 0)" -lt 1000 ]; then
    warn "BirdNET V2.4 model not found. Download manually (CC-NC-SA license):"
    echo "    From: https://github.com/kahst/BirdNET-Analyzer"
    echo "    Copy to: $MODELS_DIR/"
    echo "    Files needed: BirdNET_GLOBAL_6K_V2.4_Model_FP16.tflite"
    echo "                  BirdNET_GLOBAL_6K_V2.4_Model_FP16_Labels.txt"
    echo "                  BirdNET_GLOBAL_6K_V2.4_MData_Model_V2_FP16.tflite"
fi

# Labels l18n directory
if [ ! -d "$MODELS_DIR/l18n" ] || [ "$(ls "$MODELS_DIR/l18n/" 2>/dev/null | wc -l)" -lt 5 ]; then
    warn "Species translation labels (l18n/) not found or incomplete."
    echo "    Download from: https://github.com/kahst/BirdNET-Analyzer (model/l18n/)"
    echo "    To: $MODELS_DIR/l18n/"
fi

# ══════════════════════════════════════════════════════════════════════════
# Step 8: Install systemd services
# ══════════════════════════════════════════════════════════════════════════
step 8 "Installing systemd services..."

for svc in config/birdash.service engine/birdengine.service engine/birdengine-recording.service engine/ttyd.service; do
    svc_name=$(basename "$svc")
    if [ -f "$BIRDASH_DIR/$svc" ]; then
        sed -e "s|BIRDASH_USER|$BIRDASH_USER|g" -e "s|BIRDASH_HOME|$BIRDASH_HOME|g" \
            "$BIRDASH_DIR/$svc" | sudo tee "/etc/systemd/system/$svc_name" > /dev/null
        ok "$svc_name"
    fi
done
sudo systemctl daemon-reload

# ══════════════════════════════════════════════════════════════════════════
# Step 9: Configure Caddy reverse proxy
# ══════════════════════════════════════════════════════════════════════════
step 9 "Configuring Caddy..."

if [ ! -f /etc/caddy/Caddyfile.bak ]; then
    sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak 2>/dev/null || true
fi

sudo tee /etc/caddy/Caddyfile > /dev/null <<EOF
:80 {
    handle /birds/api/* {
        uri strip_prefix /birds
        reverse_proxy localhost:7474 {
            flush_interval -1
        }
    }
    handle /birds/terminal/* {
        reverse_proxy localhost:7681
    }
    handle /birds/audio/* {
        encode zstd gzip
        uri strip_prefix /birds/audio
        root * $SONGS_DIR/Extracted
        file_server
    }
    handle /birds* {
        encode zstd gzip
        uri strip_prefix /birds
        root * $BIRDASH_DIR/public
        file_server
    }
    redir / /birds/ permanent
}
EOF

# Allow Caddy to read user files
chmod 711 "$BIRDASH_HOME"
ok "Caddy configured"

# ══════════════════════════════════════════════════════════════════════════
# Step 10: Set up cron jobs
# ══════════════════════════════════════════════════════════════════════════
step 10 "Setting up scheduled tasks..."

# Audio purge cron (daily at 3am)
if ! crontab -l 2>/dev/null | grep -q "purge_audio"; then
    (crontab -l 2>/dev/null; echo "0 3 * * * $BIRDASH_DIR/engine/purge_audio.sh >> /tmp/purge_audio.log 2>&1") | crontab -
    ok "Audio purge cron installed (daily 3am)"
else
    ok "Audio purge cron already exists"
fi

# ══════════════════════════════════════════════════════════════════════════
# Done!
# ══════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Installation complete!${NC}"
echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
echo ""
echo "  Configuration files to edit:"
echo "    1. ${YELLOW}/etc/birdnet/birdnet.conf${NC}"
echo "       → Set LATITUDE, LONGITUDE, DATABASE_LANG"
echo ""
echo "    2. ${YELLOW}$BIRDASH_DIR/engine/config.toml${NC}"
echo "       → Set station location, BirdWeather ID, ntfy URL"
echo ""
echo "    3. ${YELLOW}$BIRDASH_DIR/public/js/birdash-local.js${NC}"
echo "       → Set location, eBird API key"
echo ""
echo "  Start all services:"
echo "    ${BLUE}sudo systemctl enable --now birdengine-recording birdengine birdash caddy ttyd${NC}"
echo ""
echo "  Dashboard:"
echo "    ${GREEN}http://$(hostname).local/birds/${NC}"
echo ""
echo "  Run tests:"
echo "    ${BLUE}cd $BIRDASH_DIR && npm test${NC}"
echo "    ${BLUE}cd $BIRDASH_DIR/engine && ../engine/venv/bin/python -m unittest test_engine -v${NC}"
echo ""
if [ ! -f "$MODELS_DIR/BirdNET_GLOBAL_6K_V2.4_Model_FP16.tflite" ]; then
    echo -e "  ${YELLOW}⚠ Remember to copy BirdNET V2.4 model to $MODELS_DIR/${NC}"
    echo ""
fi
