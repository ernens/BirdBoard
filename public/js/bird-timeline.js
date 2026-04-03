/**
 * bird-timeline.js — Timeline rendering functions (extracted from index.html)
 * Pure functions: no Vue dependency, no global state.
 */
(function() {
  'use strict';

  const TL_SKY_H = 200;

  // ── Color interpolation ────────────────────────────────────────────────

  function hexLerp(c1, c2, t) {
    t = Math.max(0, Math.min(1, t));
    const p = s => parseInt(s, 16);
    const r = Math.round(p(c1.slice(1,3)) + (p(c2.slice(1,3)) - p(c1.slice(1,3))) * t);
    const g = Math.round(p(c1.slice(3,5)) + (p(c2.slice(3,5)) - p(c1.slice(3,5))) * t);
    const b = Math.round(p(c1.slice(5,7)) + (p(c2.slice(5,7)) - p(c1.slice(5,7))) * t);
    return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
  }

  function getSkyStops(A) {
    return [
      { h:0,          top:'#010308', bot:'#020510' },
      { h:A.astroDawn, top:'#020612', bot:'#060d20' },
      { h:A.nautDawn,  top:'#08112e', bot:'#180e28' },
      { h:A.civilDawn, top:'#122050', bot:'#5a2a18' },
      { h:A.sunrise,   top:'#1a3570', bot:'#d4601a' },
      { h:A.sunrise+.5,top:'#2b5090', bot:'#e8a030' },
      { h:A.sunrise+1, top:'#3a70b8', bot:'#c8d0e0' },
      { h:10,          top:'#3a7cc8', bot:'#7ab8e0' },
      { h:14,          top:'#3a7cc8', bot:'#7ab8e0' },
      { h:A.sunset-1,  top:'#3470b0', bot:'#c0c8d8' },
      { h:A.sunset-.5, top:'#2a5090', bot:'#e09030' },
      { h:A.sunset,    top:'#1e3870', bot:'#d06018' },
      { h:A.civilDusk, top:'#142050', bot:'#6a2040' },
      { h:A.nautDusk,  top:'#0a1530', bot:'#200d28' },
      { h:A.astroDusk, top:'#030818', bot:'#050d20' },
      { h:24,          top:'#010308', bot:'#020510' },
    ];
  }

  function getSkyColors(h, stops) {
    for (let i = 1; i < stops.length; i++) {
      if (h <= stops[i].h) {
        const t = (h - stops[i-1].h) / (stops[i].h - stops[i-1].h);
        return [hexLerp(stops[i-1].top, stops[i].top, t), hexLerp(stops[i-1].bot, stops[i].bot, t)];
      }
    }
    return ['#010308','#020510'];
  }

  // ── Canvas drawing ─────────────────────────────────────────────────────

  function drawSky(canvas, A, pxPerHour) {
    const totalW = 24 * pxPerHour;
    canvas.width = totalW; canvas.height = TL_SKY_H;
    const ctx = canvas.getContext('2d');
    const stops = getSkyStops(A);
    const STEP = 3;
    for (let x = 0; x < totalW; x += STEP) {
      const h = x / pxPerHour;
      const [top, bot] = getSkyColors(h, stops);
      const g = ctx.createLinearGradient(0, 0, 0, TL_SKY_H);
      g.addColorStop(0, top); g.addColorStop(.65, bot); g.addColorStop(1, 'rgba(0,0,0,0.6)');
      ctx.fillStyle = g; ctx.fillRect(x, 0, STEP, TL_SKY_H);
    }
    // Horizon glow
    [{cx:(A.civilDawn+A.sunrise+.3)/2, color:'rgba(255,130,20,0.22)', rx:pxPerHour*1.2},
     {cx:(A.sunset-.2+A.civilDusk)/2,  color:'rgba(255,90,10,0.22)',  rx:pxPerHour*1.2}
    ].forEach(({cx,color,rx}) => {
      const px = cx * pxPerHour;
      const g = ctx.createRadialGradient(px, TL_SKY_H, 0, px, TL_SKY_H, rx*1.8);
      g.addColorStop(0, color); g.addColorStop(1, 'transparent');
      ctx.fillStyle = g; ctx.fillRect(px-rx*2, 0, rx*4, TL_SKY_H);
    });
  }

  function drawStars(canvas, A, pxPerHour, moonPhase) {
    const totalW = 24 * pxPerHour;
    canvas.width = totalW; canvas.height = TL_SKY_H;
    const ctx = canvas.getContext('2d');
    const stops = getSkyStops(A);
    let seed = 137;
    const rng = () => { seed = (seed*1664525+1013904223)>>>0; return seed/0xffffffff; };
    const stars = Array.from({length:280}, () => ({
      x:rng()*totalW, y:rng()*TL_SKY_H*.68, r:.35+rng()*1.15, warm:rng()>.72
    }));
    stars.forEach(s => {
      const h = s.x / pxPerHour;
      let alpha = 0;
      if (h < A.astroDawn || h > A.astroDusk) alpha = .6 + (s.r/1.5)*.35;
      else if (h < A.nautDawn) alpha = (.6+(s.r/1.5)*.35)*(1-(h-A.astroDawn)/(A.nautDawn-A.astroDawn)*.75);
      else if (h < A.civilDawn) alpha = .18*(1-(h-A.nautDawn)/(A.civilDawn-A.nautDawn));
      else if (h > A.nautDusk) alpha = .18*(h-A.nautDusk)/(A.astroDusk-A.nautDusk)*.8;
      else if (h > A.civilDusk) alpha = .18*(h-A.civilDusk)/(A.nautDusk-A.civilDusk)*.5;
      if (alpha < .008) return;
      const col = s.warm ? `rgba(255,240,210,${alpha})` : `rgba(210,225,255,${alpha})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI*2);
      ctx.fillStyle = col; ctx.fill();
      if (s.r > 1 && alpha > .35) {
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r*3.5);
        g.addColorStop(0, `rgba(200,215,255,${alpha*.28})`); g.addColorStop(1, 'transparent');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.x, s.y, s.r*3.5, 0, Math.PI*2); ctx.fill();
      }
    });
    // Moon
    if (moonPhase != null) {
      const mx = 22.5*pxPerHour, my = TL_SKY_H*.2, mr = 9;
      ctx.save();
      ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(255,252,225,.92)';
      ctx.shadowColor = 'rgba(255,250,180,.55)'; ctx.shadowBlur = 18; ctx.fill();
      ctx.shadowBlur = 0;
      const off = (moonPhase < .5 ? moonPhase*2 - 1 : 1 - (moonPhase-.5)*2) * mr;
      ctx.beginPath(); ctx.arc(mx + off*.6, my, mr*.86, 0, Math.PI*2);
      const [nt] = getSkyColors(22.5, stops);
      ctx.fillStyle = nt; ctx.fill();
      ctx.restore();
    }
  }

  function buildDensityBar(canvas, density, astronomy, containerWidth, pxPerHour) {
    const A = astronomy || { civilDawn:5.5, sunrise:6.5, sunset:19.5, civilDusk:20.5 };
    const w = containerWidth || 24 * pxPerHour;
    canvas.width = w; canvas.height = 22;
    const ctx = canvas.getContext('2d');
    const slots = new Array(48).fill(0);
    (density || []).forEach(s => { if (s.slot >= 0 && s.slot < 48) slots[s.slot] = s.count; });
    const sw = w / 48, maxD = Math.max(...slots, 1);
    slots.forEach((d, i) => {
      const norm = d / maxD, x = i * sw, h = Math.max(1, norm * 22);
      const hour = i / 2;
      let col;
      if (hour < A.civilDawn || hour > A.civilDusk) col = `rgba(129,140,248,${.2+norm*.65})`;
      else if (hour < A.sunrise+.75 || hour > A.sunset-.75) col = `rgba(251,146,60,${.28+norm*.6})`;
      else col = `rgba(96,165,250,${.18+norm*.65})`;
      ctx.fillStyle = col;
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x+1, 22-h, sw-2, h, [2,2,0,0]); ctx.fill(); }
      else { ctx.fillRect(x+1, 22-h, sw-2, h); }
    });
  }

  function buildMarkers(inner, events, pxPerHour, opts) {
    if (!inner) return;
    const t = opts.t || (k => k);
    const isToday = opts.isToday || false;
    const moonPhase = opts.moonPhase;
    const onOpenPopup = opts.onOpenPopup;
    const onOpenCluster = opts.onOpenCluster;

    // Clear previous markers
    inner.querySelectorAll('.tl-hour-tick,.tl-astro-marker,.tl-now-cursor,.tl-event-marker,.tl-cluster-marker,.tp-baseline').forEach(el => el.remove());

    // Baseline
    const bl = document.createElement('div');
    bl.className = 'tp-baseline'; inner.appendChild(bl);

    // Hour ticks
    for (let h = 0; h <= 24; h++) {
      const tick = document.createElement('div');
      tick.className = 'tl-hour-tick';
      tick.style.left = (h * pxPerHour) + 'px';
      tick.innerHTML = `<div class="tick-line"></div><div class="tick-label">${String(h%24).padStart(2,'0')}:00</div>`;
      inner.appendChild(tick);
    }

    // Now cursor (only if today)
    if (isToday) {
      const now = new Date();
      const nowH = now.getHours() + now.getMinutes() / 60;
      const cursor = document.createElement('div');
      cursor.className = 'tl-now-cursor';
      cursor.style.left = (nowH * pxPerHour) + 'px';
      cursor.setAttribute('data-label', t('tl_now'));
      inner.appendChild(cursor);
    }

    const typeColors = {
      nocturnal:'#818cf8', rare:'#f43f5e', firstyear:'#fbbf24',
      firstday:'#34d399', best:'#60a5fa', out_of_season:'#f97316',
      species_return:'#a78bfa', activity_spike:'#fb923c', top_species:'#8b949e',
    };

    (events || []).forEach(ev => {
      const x = ev.timeDecimal * pxPerHour;

      // Astro markers
      if (ev.isAstro) {
        const el = document.createElement('div');
        const isSunrise = ev.timeDecimal < 12;
        el.className = `tl-astro-marker ${isSunrise ? 'sunrise' : 'sunset'}`;
        el.style.left = x + 'px';
        const sunSvg = `<svg class="a-sun" viewBox="0 0 80 80" width="32" height="32"><defs><radialGradient id="sg${isSunrise?'r':'s'}"><stop offset="0%" stop-color="${isSunrise?'#fff7cc':'#ffe0a0'}"/><stop offset="50%" stop-color="${isSunrise?'#fbbf24':'#fb923c'}"/><stop offset="100%" stop-color="${isSunrise?'#f59e0b':'#ea580c'}"/></radialGradient></defs>${Array.from({length:12},(_,i)=>{const a=i*30*Math.PI/180;const x1=40+Math.cos(a)*22,y1=40+Math.sin(a)*22,x2=40+Math.cos(a)*36,y2=40+Math.sin(a)*36;return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${isSunrise?'#fbbf24':'#fb923c'}" stroke-width="2.5" stroke-linecap="round" opacity=".7"/>`}).join('')}<circle cx="40" cy="40" r="18" fill="url(#sg${isSunrise?'r':'s'})"/><circle cx="40" cy="40" r="14" fill="${isSunrise?'#fde68a':'#fed7aa'}" opacity=".5"/></svg>`;
        el.innerHTML = `${sunSvg}<div class="a-line"></div><div class="a-label">${ev.commonName}<br><strong>${ev.time}</strong></div>`;
        inner.appendChild(el);
        return;
      }

      // Cluster markers
      if (ev.type === 'cluster') {
        const el = document.createElement('div');
        el.className = 'tl-cluster-marker'; el.style.left = x + 'px';
        const dots = (ev.colors||[]).slice(0,5).map(c => `<div class="tl-cluster-dot" style="background:${c}"></div>`).join('');
        el.innerHTML = `<div class="tl-cluster-bubble"><div class="tl-cluster-dots">${dots}</div><span>+${ev.count}</span></div>`;
        if (onOpenCluster) el.addEventListener('click', () => onOpenCluster(ev));
        inner.appendChild(el);
        return;
      }

      // Regular event markers
      const isAbove = ev.position === 'above';
      const el = document.createElement('div');
      const color = typeColors[ev.type] || '#8b949e';
      el.className = `tl-event-marker ${isAbove ? 'above' : 'below'}`;
      el.style.color = color; el.style.left = x + 'px';
      el.style.bottom = (ev.vOff || 65) + 'px';

      const tagHtml = (ev.tags||[]).map(tag =>
        `<span class="tl-ml-tag" style="background:${color}28;color:${color}">${t('tl_tag_'+tag) || tag}</span>`
      ).join('');

      const photoContent = ev.photoUrl
        ? `<img src="${ev.photoUrl}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" style="width:100%;height:100%;object-fit:cover;border-radius:50%"><span style="display:none;align-items:center;justify-content:center;width:100%;height:100%">${ev.photoFallback||''}</span>`
        : ev.photoFallback || '';

      el.innerHTML = `
        <div class="tl-marker-photo">${photoContent}</div>
        <div class="tl-marker-connector"></div>
        <div class="tl-marker-label">
          <div class="tl-ml-time">${ev.time}</div>
          <div class="tl-ml-name" style="color:${color}">${ev.commonName}</div>
          <div style="margin-top:3px">${tagHtml}</div>
        </div>`;
      if (onOpenPopup) el.addEventListener('click', () => onOpenPopup(ev));
      inner.appendChild(el);
    });
  }

  // ── Export ──────────────────────────────────────────────────────────────
  window.BIRDASH_TIMELINE = {
    TL_SKY_H,
    drawSky,
    drawStars,
    buildDensityBar,
    buildMarkers,
  };

})();
