#!/bin/bash
# ══════════════════════════════════════════════════════════════════════════
# Birdash — Complete installation script for Raspberry Pi 5
# https://github.com/ernens/birdash
#
# Usage:
#   git clone https://github.com/ernens/birdash.git
#   cd birdash
#   chmod +x install.sh
#   ./install.sh            # interactive
#   ./install.sh --yes      # non-interactive (skip confirmation)
#
# Tested on: Raspberry Pi OS Lite 64-bit (Trixie/Bookworm)
# ══════════════════════════════════════════════════════════════════════════

set -e

ASSUME_YES=0
for arg in "$@"; do
    case "$arg" in
        -y|--yes|--non-interactive) ASSUME_YES=1 ;;
    esac
done
# Auto-skip prompt when stdin isn't a TTY (e.g. piped from curl)
if [ ! -t 0 ]; then ASSUME_YES=1; fi

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

TOTAL_STEPS=12

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
if [ "$ASSUME_YES" = "1" ]; then
    echo "  (Non-interactive mode: proceeding automatically)"
else
    read -p "Continue with installation? [Y/n] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Nn]$ ]]; then exit 0; fi
fi

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
    _PERCH_MODEL="perch_v2_dynint8"
fi
echo "  Optimal Perch model for $(echo $_PI_MODEL | grep -oP 'Pi \d+' || echo 'this hardware'): $_PERCH_MODEL"

if [ ! -f /etc/birdnet/birdnet.conf ]; then
    sudo tee /etc/birdnet/birdnet.conf > /dev/null <<EOF
# Birdash detection configuration
# This file is read by both BirdEngine and Birdash dashboard

MODEL=$_PERCH_MODEL
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

# Dual-model (enabled by install.sh step 12 once BirdNET is downloaded)
DUAL_MODEL_ENABLED=0
SECONDARY_MODEL=

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
# Auto-detect USB audio device and configure
USB_CARD=$(arecord -l 2>/dev/null | grep -oP 'card \K\d+(?=:.*USB)' | head -1)
if [ -n "$USB_CARD" ]; then
    USB_NAME=$(arecord -l 2>/dev/null | grep "card ${USB_CARD}:" | sed 's/.*: \(.*\) \[.*/\1/')
    ALSA_DEV="plughw:${USB_CARD},0"
    echo "  Detected USB audio: card $USB_CARD — $USB_NAME"
    # Create audio_config.json from template if needed, then update with detected device
    if [ ! -f "$BIRDASH_DIR/config/audio_config.json" ] && [ -f "$BIRDASH_DIR/config/audio_config.example.json" ]; then
        cp "$BIRDASH_DIR/config/audio_config.example.json" "$BIRDASH_DIR/config/audio_config.json"
    fi
    if [ -f "$BIRDASH_DIR/config/audio_config.json" ]; then
        python3 -c "
import json
with open('$BIRDASH_DIR/config/audio_config.json') as f: d=json.load(f)
d['device_id'] = '$ALSA_DEV'
d['device_name'] = '$USB_NAME'
with open('$BIRDASH_DIR/config/audio_config.json','w') as f: json.dump(d, f, indent=2)
" 2>/dev/null
    fi
    # Create .asoundrc with softvol boost (many USB mics have low sensitivity)
    cat > "$BIRDASH_HOME/.asoundrc" <<ASOUND
# Auto-generated by Birdash for $USB_NAME
# Software gain boost for low-sensitivity USB microphones
pcm.boosted {
    type softvol
    slave.pcm "plughw:${USB_CARD},0"
    control {
        name "Boost"
        card ${USB_CARD}
    }
    min_dB -5.0
    max_dB 30.0
}

pcm.birdash {
    type plug
    slave.pcm "boosted"
}
ASOUND
    # Set hardware + software gain to max
    amixer -c "$USB_CARD" set 'Mic Capture Volume' 100% 2>/dev/null || true
    amixer -c "$USB_CARD" set 'Mic' 100% 2>/dev/null || true
    # Update config to use boosted device
    if [ -f "$BIRDASH_DIR/config/audio_config.json" ]; then
        python3 -c "
import json
with open('$BIRDASH_DIR/config/audio_config.json') as f: d=json.load(f)
d['device_id'] = 'birdash'
with open('$BIRDASH_DIR/config/audio_config.json','w') as f: json.dump(d, f, indent=2)
" 2>/dev/null
    fi
    ok "Audio configured: $USB_NAME (card $USB_CARD, softvol boost enabled)"
else
    # No USB device — still create config from template
    if [ ! -f "$BIRDASH_DIR/config/audio_config.json" ] && [ -f "$BIRDASH_DIR/config/audio_config.example.json" ]; then
        cp "$BIRDASH_DIR/config/audio_config.example.json" "$BIRDASH_DIR/config/audio_config.json"
    fi
    warn "No USB audio device detected — configure via Settings → Audio after plugging in a mic"
fi

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
    if [ -f "$path" ] && [ "$(stat -c%s "$path" 2>/dev/null || echo 0)" -gt 10000 ]; then
        echo "  ✓ $name already present"
        return 0
    fi
    rm -f "$path" # remove empty placeholders
    echo "  Downloading $name ($size_hint)..."
    wget -q --show-progress -O "$path" "$url" || { warn "Download failed: $name"; rm -f "$path"; return 1; }
    if [ "$(stat -c%s "$path" 2>/dev/null || echo 0)" -lt 10000 ]; then
        warn "$name download appears corrupt (too small), removing"
        rm -f "$path"
        return 1
    fi
    return 0
}

# Detect Pi model for optimal default
PI_MODEL=$(cat /proc/device-tree/model 2>/dev/null | tr -d '\0' || echo "unknown")
echo "  Hardware: $PI_MODEL"

# Shared labels and indices (used by all Perch variants)
download_model "labels.txt" "$HF_BASE/labels.txt" "~300 KB"
download_model "bird_indices.json" "$HF_BASE/bird_indices.json" "~60 KB"

# Perch V2 INT8 (works on all Pi models)
download_model "perch_v2_dynint8.tflite" "$HF_BASE/perch_v2_dynint8.tflite" "~100 MB"

# FP16 and FP32 only on Pi 4/5 (too slow / too much RAM on Pi 3)
if echo "$PI_MODEL" | grep -qE "Pi 4|Pi 5|Pi 400"; then
    download_model "perch_v2_fp16.tflite" "$HF_BASE/perch_v2_fp16.tflite" "~195 MB"
    download_model "perch_v2_original.tflite" "$HF_BASE/perch_v2_original.tflite" "~390 MB"
    ok "Perch V2 models downloaded (INT8 + FP16 + FP32)"
else
    ok "Perch V2 INT8 downloaded (best for $(echo $PI_MODEL | grep -oP 'Pi \d+' || echo 'this hardware'))"
fi

# BirdNET V2.4 (CC-NC-SA license)
# Can be downloaded automatically via Settings → Detection in the dashboard,
# or via the birdnetlib pip package (which bundles the models).
BIRDNET_FOUND=0
for bn in BirdNET_GLOBAL_6K_V2.4_Model_FP16.tflite BirdNET_GLOBAL_6K_V2.4_Model_FP32.tflite; do
    if [ -f "$MODELS_DIR/$bn" ] && [ "$(stat -c%s "$MODELS_DIR/$bn" 2>/dev/null || echo 0)" -gt 1000000 ]; then
        BIRDNET_FOUND=1; break
    fi
done
if [ "$BIRDNET_FOUND" = "0" ]; then
    warn "BirdNET V2.4 not installed yet."
    echo "    → Use the dashboard: Settings → Detection → 'Download BirdNET V2.4' button"
    echo "    → Or manually: pip install birdnetlib and copy models to $MODELS_DIR/"
    echo "    → License: CC-NC-SA 4.0 (non-commercial use only)"
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
    @birds path /birds /birds/*
    handle @birds {
        encode zstd gzip
        uri strip_prefix /birds
        root * $BIRDASH_DIR/public
        header Cache-Control "public, no-cache"
        file_server
    }
    redir / /birds/ permanent
}
EOF

# Allow Caddy to read user files
chmod 711 "$BIRDASH_HOME"

# Reload caddy if already running, so it picks up the new Caddyfile.
# (systemctl enable --now in step 11 would NOT reload an already-active service.)
if systemctl is-active caddy >/dev/null 2>&1; then
    sudo systemctl reload caddy >/dev/null 2>&1 && ok "Caddy configured and reloaded" || warn "Caddy reload failed"
else
    ok "Caddy configured"
fi

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
# Step 11: Download BirdNET V2.4 (optional — CC-BY-NC-SA 4.0 license)
# ══════════════════════════════════════════════════════════════════════════
step 11 "Downloading BirdNET V2.4..."

MODELS_DIR="$BIRDASH_DIR/engine/models"

if [ "${BIRDASH_SKIP_BIRDNET:-0}" = "1" ]; then
    warn "BIRDASH_SKIP_BIRDNET=1 — skipping BirdNET download"
    warn "You can install it later from the dashboard: Settings → Detection → Download BirdNET"
elif [ -f "$MODELS_DIR/BirdNET_GLOBAL_6K_V2.4_Model_FP32.tflite" ] \
     && [ -f "$MODELS_DIR/l18n/labels_en.json" ]; then
    ok "BirdNET V2.4 already installed"
    # Promote to dual-model mode automatically (primary = BirdNET, secondary = Perch)
    sudo sed -i "s|^MODEL=.*|MODEL=BirdNET_GLOBAL_6K_V2.4_Model_FP32|" /etc/birdnet/birdnet.conf
    sudo sed -i "s|^DUAL_MODEL_ENABLED=.*|DUAL_MODEL_ENABLED=1|" /etc/birdnet/birdnet.conf
    sudo sed -i "s|^SECONDARY_MODEL=.*|SECONDARY_MODEL=$_PERCH_MODEL|" /etc/birdnet/birdnet.conf
    ok "Dual-model enabled (BirdNET + $_PERCH_MODEL)"
else
    echo ""
    echo "  BirdNET V2.4 is distributed under CC-BY-NC-SA 4.0 (non-commercial use)."
    echo "  See https://github.com/kahst/BirdNET-Analyzer for the full license."
    echo "  Set BIRDASH_SKIP_BIRDNET=1 before install to skip this download."
    echo ""
    if bash "$BIRDASH_DIR/engine/download_birdnet.sh" "$MODELS_DIR"; then
        ok "BirdNET V2.4 downloaded"
        # Enable dual-model (BirdNET primary + Perch secondary) for best accuracy
        sudo sed -i "s|^MODEL=.*|MODEL=BirdNET_GLOBAL_6K_V2.4_Model_FP32|" /etc/birdnet/birdnet.conf
        sudo sed -i "s|^DUAL_MODEL_ENABLED=.*|DUAL_MODEL_ENABLED=1|" /etc/birdnet/birdnet.conf
        sudo sed -i "s|^SECONDARY_MODEL=.*|SECONDARY_MODEL=$_PERCH_MODEL|" /etc/birdnet/birdnet.conf
        # Sync the engine config.toml as well
        if [ -f "$BIRDASH_DIR/engine/config.toml" ]; then
            sed -i "s|^model\s*=.*|model = \"BirdNET_GLOBAL_6K_V2.4_Model_FP32\"|" "$BIRDASH_DIR/engine/config.toml"
            sed -i "s|^secondary_model\s*=.*|secondary_model = \"$_PERCH_MODEL\"|" "$BIRDASH_DIR/engine/config.toml"
        fi
        ok "Dual-model enabled (BirdNET + $_PERCH_MODEL)"
    else
        warn "BirdNET download failed — starting with Perch-only"
        warn "Retry later from the dashboard: Settings → Detection → Download BirdNET"
    fi
fi

# ══════════════════════════════════════════════════════════════════════════
# Step 12: Enable and start services
# ══════════════════════════════════════════════════════════════════════════
step 12 "Enabling and starting services..."

sudo systemctl daemon-reload
sudo systemctl enable --now caddy >/dev/null 2>&1 && ok "caddy enabled & started" || warn "caddy failed to start"
sudo systemctl enable --now birdash >/dev/null 2>&1 && ok "birdash enabled & started" || warn "birdash failed to start"
sudo systemctl enable --now birdengine >/dev/null 2>&1 && ok "birdengine enabled & started" || warn "birdengine failed to start"
sudo systemctl enable --now birdengine-recording >/dev/null 2>&1 && ok "birdengine-recording enabled & started" || warn "birdengine-recording failed to start"
sudo systemctl enable --now ttyd >/dev/null 2>&1 && ok "ttyd enabled & started" || warn "ttyd failed to start"

# ══════════════════════════════════════════════════════════════════════════
# Done!
# ══════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Installation complete!${NC}"
echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Dashboard:"
echo -e "    ${GREEN}http://$(hostname).local/birds/${NC}"
echo -e "    ${GREEN}http://$(hostname -I | awk '{print $1}')/birds/${NC}"
echo ""
echo -e "  Next steps (from the dashboard → Settings):"
echo -e "    • Station: GPS coordinates, language, timezone"
echo -e "    • Detection: download BirdNET V2.4 (one-click)"
echo -e "    • Audio: select USB device and verify levels"
echo ""
echo -e "  Optional config files:"
echo -e "    ${YELLOW}/etc/birdnet/birdnet.conf${NC}      — BirdNET runtime settings"
echo -e "    ${YELLOW}$BIRDASH_DIR/engine/config.toml${NC} — engine + BirdWeather + ntfy"
echo -e "    ${YELLOW}$BIRDASH_DIR/public/js/birdash-local.js${NC} — eBird API key"
echo ""
TFLITE_COUNT=$(ls "$MODELS_DIR"/*.tflite 2>/dev/null | wc -l)
if [ "$TFLITE_COUNT" -eq 0 ]; then
    echo -e "  ${YELLOW}⚠ No TFLite models found in $MODELS_DIR/${NC}"
    echo -e "  ${YELLOW}  Use the dashboard's Detection panel to download BirdNET V2.4${NC}"
    echo ""
fi
