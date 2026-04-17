#!/usr/bin/env python3
"""
tft-display.py — PiTFT 3.5" (HX8357D + STMPE610) renderer for birdash.

Polls /api/tft-display/frame-data, composes a 480x320 image in PIL, and
writes RGB565 to /dev/fb1. Designed to run alongside BirdNET-Pi on a Pi3
with only 1 GB of RAM — stays under ~30 MB.

Usage:
  ./tft-display.py                        # normal run (writes to /dev/fb1)
  ./tft-display.py --simulate             # one tick → /tmp/tft-preview.png
  ./tft-display.py --once                 # one tick → /dev/fb1 then exit
  ./tft-display.py --base http://host     # override API base (default localhost)

The HX8357D driven by pitft35-resistive dtoverlay with rotate=90 gives a
480x320 landscape framebuffer at /dev/fb1 in RGB565 (16 bpp).
"""

import argparse, io, mmap, os, struct, sys, time
from datetime import datetime
from urllib.request import urlopen, Request
from urllib.error   import URLError

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.exit("Missing python3-pil — install with: sudo apt-get install -y python3-pil")

W, H = 480, 320
FB_PATH  = '/dev/fb1'
FONT_DIR = '/usr/share/fonts/truetype/dejavu'
FONT_REG = os.path.join(FONT_DIR, 'DejaVuSans.ttf')
FONT_BD  = os.path.join(FONT_DIR, 'DejaVuSans-Bold.ttf')
FONT_IT  = os.path.join(FONT_DIR, 'DejaVuSans-Oblique.ttf')

# Dark palette (matches birdash "dark" theme roughly)
COLOR_BG      = (17, 17, 19)
COLOR_PANEL   = (28, 28, 33)
COLOR_TEXT    = (240, 240, 242)
COLOR_MUTED   = (125, 125, 131)
COLOR_FAINT   = (70, 70, 78)
COLOR_ACCENT  = (95, 174, 145)
COLOR_HIGH    = (76, 164, 124)
COLOR_MID     = (232, 162, 86)
COLOR_LOW     = (224, 93, 93)


def _font(path, size):
    try: return ImageFont.truetype(path, size)
    except Exception: return ImageFont.load_default()


class Fonts:
    def __init__(self):
        self.tiny   = _font(FONT_REG, 11)
        self.small  = _font(FONT_REG, 13)
        self.smallB = _font(FONT_BD,  13)
        self.med    = _font(FONT_REG, 16)
        self.medB   = _font(FONT_BD,  16)
        self.big    = _font(FONT_BD,  24)
        self.huge   = _font(FONT_BD,  30)
        self.kpi    = _font(FONT_BD,  22)
        self.it     = _font(FONT_IT,  13)


def fetch_json(url, timeout=3):
    req = Request(url, headers={'User-Agent': 'birdash-tft/1.0'})
    with urlopen(req, timeout=timeout) as r:
        import json
        return json.loads(r.read().decode('utf-8'))


def fetch_photo(base, sci):
    if not sci: return None
    try:
        req = Request(f"{base}/api/photo?sci={sci.replace(' ', '+')}",
                      headers={'User-Agent': 'birdash-tft/1.0'})
        with urlopen(req, timeout=5) as r:
            return Image.open(io.BytesIO(r.read())).convert('RGB')
    except Exception:
        return None


def tier_color(tier):
    return {'high': COLOR_HIGH, 'mid': COLOR_MID, 'low': COLOR_LOW}.get(tier, COLOR_MUTED)


def compose(data, fonts, photo_img=None, mode='pulse'):
    """Dispatcher — picks the right layout based on config.mode."""
    if mode == 'headline':    return compose_headline(data, fonts, photo_img)
    if mode == 'leaderboard': return compose_leaderboard(data, fonts, photo_img)
    return compose_pulse(data, fonts, photo_img)


def _photo_sci_for(mode, data):
    """Which species photo to fetch, given the current mode."""
    if mode == 'leaderboard':
        top = data.get('topToday') or []
        return (top[0].get('sciName') if top else None)
    return (data.get('latestDet') or {}).get('sciName')


def compose_pulse(data, fonts, photo_img=None):
    img  = Image.new('RGB', (W, H), COLOR_BG)
    draw = ImageDraw.Draw(img)

    # ─── Top bar (y 0..30) — station · time · pulse ──────────
    station = data.get('stationName') or 'BirdStation'
    now = datetime.now().strftime('%H:%M')
    draw.text((10, 7), station, fill=COLOR_TEXT, font=fonts.medB)
    # Center time
    tw = draw.textlength(now, font=fonts.medB)
    draw.text(((W - tw) / 2, 7), now, fill=COLOR_TEXT, font=fonts.medB)
    # Pulse indicator right: 3 dots whose fill depends on rate
    rate = float(data.get('pulseRate') or 0)
    filled = 3 if rate >= 10 else 2 if rate >= 4 else 1 if rate > 0 else 0
    dot_col = COLOR_HIGH if filled == 3 else COLOR_MID if filled == 2 else COLOR_ACCENT
    base_x = W - 70
    for i in range(3):
        cx = base_x + i * 12
        if i < filled:
            draw.ellipse((cx, 12, cx + 8, 20), fill=dot_col)
        else:
            draw.ellipse((cx, 12, cx + 8, 20), outline=COLOR_FAINT, width=1)
    # pulse rate number
    draw.text((W - 28, 6), f"{rate:g}", fill=COLOR_MUTED, font=fonts.smallB)

    # ─── River (y 38..96) — scatter of today's detections ────
    river_y0, river_h = 38, 58
    # Axis line bottom
    draw.rectangle((10, river_y0 + river_h - 1, W - 10, river_y0 + river_h),
                   fill=COLOR_FAINT)
    # Hour ticks every 6h
    for hour in (0, 6, 12, 18, 24):
        tx = 10 + int((hour / 24) * (W - 20))
        draw.line((tx, river_y0 + river_h - 4, tx, river_y0 + river_h + 1),
                  fill=COLOR_FAINT)
    # Dots
    for dot in data.get('river') or []:
        x = 10 + int(dot['x'] * (W - 20))
        c = max(0.5, min(1.0, dot.get('conf', 0)))
        yn = (c - 0.5) / 0.5
        y = (river_y0 + river_h - 6) - int(yn * (river_h - 12))
        r = 3 if dot.get('tier') == 'high' else 2
        col = tier_color(dot.get('tier'))
        draw.ellipse((x - r, y - r, x + r, y + r), fill=col)
    # "Now" marker
    nx = 10 + int((data.get('nowFrac') or 0) * (W - 20))
    draw.line((nx, river_y0, nx, river_y0 + river_h - 1), fill=COLOR_ACCENT, width=1)

    # ─── Main (y 104..262) — photo + species info ────────────
    box_x, box_y, box_w, box_h = 10, 104, 160, 158
    draw.rectangle((box_x, box_y, box_x + box_w, box_y + box_h),
                   fill=COLOR_PANEL, outline=COLOR_FAINT)
    if photo_img:
        # Cover-fit into the box
        src_r = photo_img.width / photo_img.height
        dst_r = box_w / box_h
        if src_r > dst_r:
            new_h = box_h
            new_w = int(src_r * new_h)
        else:
            new_w = box_w
            new_h = int(new_w / src_r)
        thumb = photo_img.resize((new_w, new_h), Image.LANCZOS)
        ox = (new_w - box_w) // 2
        oy = (new_h - box_h) // 2
        thumb = thumb.crop((ox, oy, ox + box_w, oy + box_h))
        img.paste(thumb, (box_x, box_y))

    info_x = box_x + box_w + 14
    det = data.get('latestDet') or {}
    com = det.get('comName') or '—'
    sci = det.get('sciName') or ''
    conf = det.get('confidence', 0)
    dtime = det.get('time') or ''
    # Common name (wrap to 2 lines if needed)
    words = com.split(' ')
    line1, line2 = com, ''
    if draw.textlength(com, font=fonts.big) > W - info_x - 10:
        mid = len(words) // 2 or 1
        line1 = ' '.join(words[:mid])
        line2 = ' '.join(words[mid:])
    draw.text((info_x, box_y + 4), line1, fill=COLOR_TEXT, font=fonts.big)
    y_cursor = box_y + 36
    if line2:
        draw.text((info_x, y_cursor), line2, fill=COLOR_TEXT, font=fonts.big)
        y_cursor += 32
    draw.text((info_x, y_cursor), sci, fill=COLOR_MUTED, font=fonts.it)
    y_cursor += 24
    # Confidence badge
    tier = 'high' if conf >= 85 else 'mid' if conf >= 70 else 'low'
    badge_col = tier_color(tier)
    label = f"{conf}%"
    lw = draw.textlength(label, font=fonts.medB)
    draw.rounded_rectangle((info_x, y_cursor, info_x + int(lw) + 14, y_cursor + 22),
                           radius=11, fill=badge_col)
    draw.text((info_x + 7, y_cursor + 3), label, fill=(255, 255, 255), font=fonts.medB)
    # Time next to badge
    draw.text((info_x + int(lw) + 24, y_cursor + 3), dtime, fill=COLOR_MUTED, font=fonts.med)

    # ─── Bottom KPIs (y 270..310) ────────────────────────────
    kpis = data.get('kpis') or {}
    labels = [('SPECIES', str(kpis.get('species', 0))),
              ('DETECTIONS', f"{kpis.get('total', 0):,}".replace(',', ' ')),
              ('LAST HOUR', str(kpis.get('lastHour', 0)))]
    cell_w = W // 3
    for i, (lbl, val) in enumerate(labels):
        cx = i * cell_w + cell_w // 2
        vw = draw.textlength(val, font=fonts.kpi)
        draw.text((cx - vw / 2, 268), val, fill=COLOR_ACCENT, font=fonts.kpi)
        lw = draw.textlength(lbl, font=fonts.tiny)
        draw.text((cx - lw / 2, 298), lbl, fill=COLOR_MUTED, font=fonts.tiny)

    return img


def compose_headline(data, fonts, photo_img=None):
    """Museum-placard layout — full-bleed photo, big name at bottom.

    No river, no KPIs. The photo is the star; text overlays a dark gradient
    on the lower half so it remains legible over any photo.
    """
    img = Image.new('RGB', (W, H), COLOR_BG)

    det = data.get('latestDet') or {}
    com = det.get('comName') or '—'
    sci = det.get('sciName') or ''
    conf = int(det.get('confidence') or 0)
    dtime = det.get('time') or ''
    ddate = det.get('date') or ''

    if photo_img:
        src_r = photo_img.width / photo_img.height
        dst_r = W / H
        if src_r > dst_r:
            new_h = H
            new_w = max(W, int(src_r * new_h))
        else:
            new_w = W
            new_h = max(H, int(new_w / src_r))
        photo = photo_img.resize((new_w, new_h), Image.LANCZOS)
        ox = (new_w - W) // 2
        oy = (new_h - H) // 2
        photo = photo.crop((ox, oy, ox + W, oy + H))
        img.paste(photo, (0, 0))
    else:
        ImageDraw.Draw(img).rectangle((0, 0, W, H), fill=COLOR_PANEL)

    # Dark gradient on the lower half for text legibility.
    overlay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    grad_start = 150
    for y in range(grad_start, H):
        a = int(230 * (y - grad_start) / (H - grad_start))
        od.line((0, y, W, y), fill=(0, 0, 0, a))
    img.paste(overlay, (0, 0), overlay)

    draw = ImageDraw.Draw(img)

    # Top bar: station left, clock right — small and faint over the photo.
    station = data.get('stationName') or 'BirdStation'
    now = datetime.now().strftime('%H:%M')
    draw.text((12, 9), station, fill=COLOR_TEXT, font=fonts.smallB)
    tw = draw.textlength(now, font=fonts.smallB)
    draw.text((W - tw - 12, 9), now, fill=COLOR_TEXT, font=fonts.smallB)

    # Common name — drop to big if it doesn't fit on one line at huge.
    y = 200
    name_font = fonts.huge
    if draw.textlength(com, font=name_font) > W - 36:
        name_font = fonts.big
    draw.text((18, y), com, fill=COLOR_TEXT, font=name_font)
    y += 40 if name_font is fonts.huge else 32

    # Scientific name
    draw.text((18, y), sci, fill=(200, 200, 204), font=fonts.it)
    y += 28

    # Confidence badge · time (or date + time if not today)
    tier = 'high' if conf >= 85 else 'mid' if conf >= 70 else 'low'
    label = f"{conf}%"
    lw = int(draw.textlength(label, font=fonts.medB))
    draw.rounded_rectangle((18, y, 18 + lw + 14, y + 22), radius=11,
                           fill=tier_color(tier))
    draw.text((18 + 7, y + 3), label, fill=(255, 255, 255), font=fonts.medB)

    today = datetime.now().strftime('%Y-%m-%d')
    when = dtime if (ddate == today or not ddate) else f"{ddate[5:].replace('-', '/')} · {dtime}"
    draw.text((18 + lw + 24, y + 3), when, fill=COLOR_TEXT, font=fonts.med)

    return img


def compose_leaderboard(data, fonts, photo_img=None):
    """Top-6 species today, photo of #1 on the left, ranked list on the right.

    Trend arrow next to each count compares today-so-far vs same time
    yesterday — small triangle up (green), down (red), or flat bar (muted).
    """
    img = Image.new('RGB', (W, H), COLOR_BG)
    draw = ImageDraw.Draw(img)

    # Top bar
    station = data.get('stationName') or 'BirdStation'
    now = datetime.now().strftime('%H:%M')
    draw.rectangle((0, 0, W, 34), fill=COLOR_PANEL)
    draw.text((10, 9), station, fill=COLOR_TEXT, font=fonts.smallB)
    title = 'TOP TODAY'
    tw = draw.textlength(title, font=fonts.smallB)
    draw.text(((W - tw) / 2, 9), title, fill=COLOR_ACCENT, font=fonts.smallB)
    cw = draw.textlength(now, font=fonts.smallB)
    draw.text((W - cw - 10, 9), now, fill=COLOR_TEXT, font=fonts.smallB)

    top = data.get('topToday') or []
    if not top:
        msg = 'No detections yet today'
        mw = draw.textlength(msg, font=fonts.med)
        draw.text(((W - mw) / 2, H / 2 - 8), msg, fill=COLOR_MUTED, font=fonts.med)
        return img

    # Photo of #1 (left column) — square-ish panel.
    box_x, box_y, box_w, box_h = 10, 44, 150, 266
    draw.rectangle((box_x, box_y, box_x + box_w, box_y + box_h),
                   fill=COLOR_PANEL, outline=COLOR_FAINT)
    if photo_img:
        src_r = photo_img.width / photo_img.height
        dst_r = box_w / box_h
        if src_r > dst_r:
            new_h = box_h
            new_w = int(src_r * new_h)
        else:
            new_w = box_w
            new_h = int(new_w / src_r)
        thumb = photo_img.resize((new_w, new_h), Image.LANCZOS)
        ox = (new_w - box_w) // 2
        oy = (new_h - box_h) // 2
        thumb = thumb.crop((ox, oy, ox + box_w, oy + box_h))
        img.paste(thumb, (box_x, box_y))
    # #1 badge over photo corner
    draw.rounded_rectangle((box_x + 6, box_y + 6, box_x + 38, box_y + 26),
                           radius=10, fill=COLOR_ACCENT)
    draw.text((box_x + 11, box_y + 8), '#1', fill=(255, 255, 255), font=fonts.smallB)

    # Ranked list (right column)
    list_x = box_x + box_w + 18
    row_y0 = 44
    row_h = 44
    for i, sp in enumerate(top[:6]):
        y = row_y0 + i * row_h
        if i > 0:
            draw.line((list_x, y, W - 10, y), fill=COLOR_FAINT)
        # Rank
        rank = f"{i + 1}"
        rc = COLOR_ACCENT if i == 0 else COLOR_MUTED
        draw.text((list_x, y + 13), rank, fill=rc, font=fonts.medB)
        # Name — truncate with ellipsis if too wide
        name_x = list_x + 22
        max_w = W - name_x - 78
        name = sp.get('comName') or '—'
        orig = name
        while name and draw.textlength(name, font=fonts.med) > max_w:
            name = name[:-1]
        if name != orig:
            name = name[:-1] + '…'
        draw.text((name_x, y + 14), name, fill=COLOR_TEXT, font=fonts.med)
        # Count (right-aligned before the arrow)
        count = str(sp.get('count') or 0)
        cw2 = int(draw.textlength(count, font=fonts.medB))
        draw.text((W - 46 - cw2, y + 11), count, fill=COLOR_ACCENT, font=fonts.medB)
        # Trend arrow
        trend = sp.get('trend') or 'flat'
        tx = W - 26
        ty = y + row_h // 2
        if trend == 'up':
            draw.polygon([(tx, ty - 7), (tx - 6, ty + 4), (tx + 6, ty + 4)],
                         fill=COLOR_HIGH)
        elif trend == 'down':
            draw.polygon([(tx, ty + 7), (tx - 6, ty - 4), (tx + 6, ty - 4)],
                         fill=COLOR_LOW)
        else:
            draw.line((tx - 6, ty, tx + 6, ty), fill=COLOR_MUTED, width=2)

    return img


def rgb_to_rgb565_bytes(img):
    """Convert PIL RGB image → little-endian RGB565 bytes for fb1."""
    # numpy path is 50× faster; fall back to pure Python only if missing.
    try:
        import numpy as np
        a = np.asarray(img, dtype=np.uint16)
        r = (a[:, :, 0] >> 3) & 0x1F
        g = (a[:, :, 1] >> 2) & 0x3F
        b = (a[:, :, 2] >> 3) & 0x1F
        packed = (r << 11) | (g << 5) | b
        return packed.astype('<u2').tobytes()
    except ImportError:
        buf = bytearray()
        for r, g, b in img.getdata():
            v = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)
            buf += struct.pack('<H', v)
        return bytes(buf)


def write_fb(img, fb_path=FB_PATH, rotate=0):
    if rotate:
        img = img.rotate(-rotate, expand=True)
    data = rgb_to_rgb565_bytes(img)
    with open(fb_path, 'wb') as f:
        f.write(data)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--simulate', action='store_true',
                    help='Dump one frame to /tmp/tft-preview.png instead of /dev/fb1')
    ap.add_argument('--once', action='store_true', help='Render once then exit')
    ap.add_argument('--base', default='http://localhost/birds',
                    help='birdash base URL (default: http://localhost/birds)')
    ap.add_argument('--mode', choices=['pulse', 'headline', 'leaderboard'],
                    help='Override mode (bypasses server config, useful for preview)')
    args = ap.parse_args()

    fonts = Fonts()
    last_sci = None
    photo_cache = None

    def tick():
        nonlocal last_sci, photo_cache
        try:
            cfg = fetch_json(f"{args.base}/api/tft-display/config")
        except Exception:
            cfg = {}
        mode = args.mode or cfg.get('mode') or 'pulse'
        rot = int(cfg.get('rotation') or 0)

        try:
            data = fetch_json(f"{args.base}/api/tft-display/frame-data")
        except URLError as e:
            print(f"[tft] frame-data fetch failed: {e}", file=sys.stderr)
            return

        sci = _photo_sci_for(mode, data)
        if sci and sci != last_sci:
            photo_cache = fetch_photo(args.base, sci)
            last_sci = sci

        img = compose(data, fonts, photo_cache, mode=mode)

        if args.simulate:
            out = '/tmp/tft-preview.png'
            img.save(out)
            print(f"[tft] wrote {out}")
            return

        write_fb(img, rotate=rot)

    try:
        # Pick interval from config each tick so changes take effect live.
        while True:
            tick()
            if args.once or args.simulate: break
            try:
                cfg = fetch_json(f"{args.base}/api/tft-display/config")
                interval = max(1, int(cfg.get('refreshSec') or 3))
                if not cfg.get('enabled'):
                    # Service running but disabled in config — idle politely.
                    interval = 10
            except Exception: interval = 3
            time.sleep(interval)
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
