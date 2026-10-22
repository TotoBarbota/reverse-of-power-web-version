// Power-play effects drawn over the trivia answers. Per-answer effects draw into the
// answer's own canvas; screen-wide effects draw into one canvas over the whole grid.
// Positions are stored as fractions of their box so a rotation or resize keeps progress.

const PT = {
  NONE: -1, BET: 1, FREEZE: 4, BOMBLES: 5, NIBBLERS: 6, GLOOP: 7, POINTS_PARTY: 8,
  DT_FREEZE_GLOOP: 10, DT_FREEZE_BOMBLES: 11, DT_NIBBLERS_GLOOP: 12,
  LOCKDOWN: 20, ZIPPERS: 22, BUG: 24, POINTS_DOUBLER: 25, FIFTY_FIFTY: 26, LETTER_SCATTER: 28, DISCO: 29,
};
const DT_PARTS = { 10: [PT.FREEZE, PT.GLOOP], 11: [PT.FREEZE, PT.BOMBLES], 12: [PT.NIBBLERS, PT.GLOOP] };

function powerCounts(list) {
  const counts = {};
  for (const pp of list || []) {
    const types = DT_PARTS[pp.PowerType] || [pp.PowerType];
    for (const t of types) counts[t] = (counts[t] || 0) + (pp.Count || 0);
  }
  return counts;
}

// ---------------------------------------------------------------- answer text: nibblers and letter scatter
function textFx(text, { scatter = false, bites = 0, maxFont = 34 } = {}) {
  const start = performance.now();
  const chars = Array.from(String(text)).map(() => ({ p1: rand(0, 6.28), p2: rand(0, 6.28), s1: rand(260, 420), s2: rand(380, 620), dy: rand(-1, 1), rot: rand(-1, 1) }));
  const biteList = Array.from({ length: bites }, (_, i) => ({ u: rand(0.05, 0.95), v: rand(0.1, 0.9), r: rand(0.45, 0.7), at: 350 + i * 260, a: rand(0, 6.28), played: false }));
  return {
    active: true,
    animated: () => scatter || biteList.some((b) => !b.played),
    draw(ctx, w, hh, now) {
      const padX = Math.min(58, w * 0.12);
      const { size, lines } = fitFont(ctx, text, w - padX * 2, hh * 0.86, maxFont, 11, 900);
      const lineH = size * 1.15;
      const top = (hh - lines.length * lineH) / 2;
      ctx.save();
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;
      ctx.shadowBlur = 3;
      let minX = w;
      let maxX = 0;
      let k = 0;
      lines.forEach((line, li) => {
        const y = top + lineH * (li + 0.5);
        const lw = ctx.measureText(line).width;
        let x = (w - lw) / 2;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x + lw);
        if (!scatter) {
          ctx.textAlign = 'left';
          ctx.fillText(line, x, y);
          k += line.length + 1;
          return;
        }
        for (const ch of Array.from(line)) {
          const cw = ctx.measureText(ch).width;
          const c = chars[k % chars.length];
          const dy = Math.sin(now / c.s1 + c.p1) * 0.25 * size;
          const rot = (Math.sin(now / c.s2 + c.p2) * 7 * Math.PI) / 180;
          ctx.save();
          ctx.translate(x + cw / 2, y + dy);
          ctx.rotate(rot);
          ctx.textAlign = 'center';
          ctx.fillText(ch, 0, 0);
          ctx.restore();
          x += cw;
          k++;
        }
        k++;
      });
      ctx.restore();
      if (biteList.length) {
        const bx = minX - size * 0.2;
        const bw = maxX - minX + size * 0.4;
        const by = top;
        const bh = lines.length * lineH;
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        for (const b of biteList) {
          if (now - start < b.at) continue;
          if (!b.played) {
            b.played = true;
            Sound.play('chomp');
          }
          const cx = bx + b.u * bw;
          const cy = by + b.v * bh;
          const r = b.r * size;
          ctx.beginPath();
          for (let i = 0; i < 3; i++) {
            const a = b.a + (i - 1) * 0.6;
            ctx.moveTo(cx + Math.cos(a) * r * 0.35 + r * 0.62, cy + Math.sin(a) * r * 0.35);
            ctx.arc(cx + Math.cos(a) * r * 0.35, cy + Math.sin(a) * r * 0.35, r * 0.62, 0, Math.PI * 2);
          }
          ctx.fill();
        }
        ctx.restore();
      }
    },
  };
}

// ---------------------------------------------------------------- ice (freeze): tap to crack
function iceFx(count) {
  const total = 5 * count;
  const st = {
    active: true,
    left: total,
    cracks: [],
    shards: [],
    brokeAt: 0,
    specks: Array.from({ length: 46 }, () => ({ u: Math.random(), v: Math.random(), r: rand(0.6, 2.2), a: rand(0.25, 0.8) })),
    streaks: Array.from({ length: 6 }, () => ({ u: rand(-0.1, 1), v: rand(0, 1), len: rand(0.15, 0.4) })),
  };
  return {
    get active() { return st.active; },
    animated: () => st.brokeAt && performance.now() - st.brokeAt < 500,
    tap(u, v) {
      if (!st.active) return false;
      st.left--;
      const branches = randInt(3, 5);
      for (let b = 0; b < branches; b++) {
        let a = rand(0, Math.PI * 2);
        let x = u;
        let y = v;
        const pts = [[x, y]];
        for (let i = 0; i < randInt(3, 5); i++) {
          a += rand(-0.6, 0.6);
          const len = rand(0.04, 0.11);
          x += Math.cos(a) * len;
          y += Math.sin(a) * len * 2.2;
          pts.push([x, y]);
        }
        st.cracks.push(pts);
      }
      Sound.vibrate(10);
      if (st.left <= 0) {
        st.active = false;
        st.brokeAt = performance.now();
        st.shards = Array.from({ length: 16 }, () => ({ u: rand(0.05, 0.95), v: rand(0.1, 0.9), vx: rand(-0.4, 0.4), vy: rand(-0.6, 0.1), rot: rand(0, 6), vr: rand(-8, 8), s: rand(0.05, 0.12) }));
        Sound.play('shatter');
        Sound.vibrate([15, 20, 15]);
      } else {
        Sound.play('crack');
      }
      return true;
    },
    draw(ctx, w, hh, now) {
      if (st.active) {
        ctx.save();
        roundRect(ctx, 0, 0, w, hh, 8);
        ctx.fillStyle = 'rgba(202,223,234,0.53)';
        ctx.fill();
        ctx.clip();
        const g = ctx.createLinearGradient(0, 0, w, hh);
        g.addColorStop(0, 'rgba(255,255,255,0.35)');
        g.addColorStop(0.5, 'rgba(255,255,255,0.05)');
        g.addColorStop(1, 'rgba(255,255,255,0.25)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, hh);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 3;
        for (const sk of st.streaks) {
          ctx.beginPath();
          ctx.moveTo(sk.u * w, sk.v * hh);
          ctx.lineTo((sk.u + sk.len) * w, sk.v * hh - sk.len * w);
          ctx.stroke();
        }
        for (const sp of st.specks) {
          ctx.fillStyle = `rgba(255,255,255,${sp.a})`;
          ctx.beginPath();
          ctx.arc(sp.u * w, sp.v * hh, sp.r, 0, Math.PI * 2);
          ctx.fill();
        }
        const damage = 1 - st.left / total;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (const pts of st.cracks) {
          for (const [col, lw] of [['rgba(60,90,110,0.45)', 3], [`rgba(255,255,255,${0.75 + damage * 0.25})`, 1.4]]) {
            ctx.strokeStyle = col;
            ctx.lineWidth = lw;
            ctx.beginPath();
            pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * hh) : ctx.moveTo(x * w, y * hh)));
            ctx.stroke();
          }
        }
        ctx.restore();
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.lineWidth = 2;
        roundRect(ctx, 1, 1, w - 2, hh - 2, 8);
        ctx.stroke();
        return;
      }
      const t = (now - st.brokeAt) / 1000;
      if (t > 0.5) return;
      ctx.save();
      ctx.globalAlpha = 1 - t / 0.5;
      ctx.fillStyle = 'rgba(220,236,245,0.85)';
      for (const sh of st.shards) {
        const x = (sh.u + sh.vx * t) * w;
        const y = (sh.v + sh.vy * t + 1.6 * t * t) * hh;
        const sz = sh.s * Math.min(w, hh * 2);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(sh.rot + sh.vr * t);
        ctx.beginPath();
        ctx.moveTo(0, -sz);
        ctx.lineTo(sz * 0.7, sz * 0.6);
        ctx.lineTo(-sz * 0.6, sz * 0.4);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    },
  };
}

// ---------------------------------------------------------------- gloop: wipe it away
const GLOOP_COLOURS = ['rgba(76,175,80,0.93)', 'rgba(129,199,132,0.67)', 'rgba(56,142,60,0.87)', 'rgba(0,230,118,0.33)'];

function gloopFx(count) {
  const st = {
    active: true,
    fadeAt: 0,
    blobs: Array.from({ length: 16 + 6 * count }, () => ({ u: rand(-0.05, 1.05), v: rand(-0.1, 1.1), r: rand(0.22, 0.5), c: pick(GLOOP_COLOURS), hu: rand(-0.3, 0.3) })),
    drips: Array.from({ length: randInt(4, 7) }, () => ({ u: rand(0.05, 0.95), len: rand(0.1, 0.32), r: rand(0.03, 0.06) })),
    strokes: [],
    grid: new Array(60).fill(false),
    last: null,
    layer: document.createElement('canvas'),
    lw: 0,
    lh: 0,
    lastSound: 0,
  };
  const brush = (w, hh) => (Math.min(w, hh) * 0.216) / Math.max(1, count);

  function rebuild(w, hh) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    st.layer.width = Math.max(1, Math.round(w * dpr));
    st.layer.height = Math.max(1, Math.round(hh * dpr));
    st.lw = w;
    st.lh = hh;
    const c = st.layer.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.save();
    roundRect(c, 0, 0, w, hh, 8);
    c.clip();
    const m = Math.min(w, hh);
    for (const b of st.blobs) {
      c.fillStyle = b.c;
      c.beginPath();
      c.ellipse(b.u * w, b.v * hh, b.r * m * 1.3, b.r * m, 0, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = 'rgba(56,142,60,0.9)';
    for (const d of st.drips) {
      c.fillRect(d.u * w - d.r * m, hh * (1 - d.len), d.r * m * 2, d.len * hh);
      c.beginPath();
      c.arc(d.u * w, hh, d.r * m * 1.3, 0, Math.PI * 2);
      c.fill();
    }
    for (const b of st.blobs) {
      c.fillStyle = 'rgba(255,255,255,0.22)';
      c.beginPath();
      c.ellipse(b.u * w - b.r * m * 0.35, b.v * hh - b.r * m * 0.4, b.r * m * 0.3, b.r * m * 0.16, -0.5, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
    c.globalCompositeOperation = 'destination-out';
    c.lineCap = 'round';
    c.lineWidth = brush(w, hh) * 2;
    for (const sg of st.strokes) {
      c.beginPath();
      c.moveTo(sg[0] * w, sg[1] * hh);
      c.lineTo(sg[2] * w + 0.01, sg[3] * hh);
      c.stroke();
    }
    c.globalCompositeOperation = 'source-over';
  }

  return {
    get active() { return st.active; },
    animated: () => st.fadeAt && performance.now() - st.fadeAt < 220,
    wipe(u, v, w, hh, newContact) {
      if (!st.active || st.fadeAt) return;
      const from = !st.last || newContact ? [u, v] : st.last;
      st.last = [u, v];
      st.strokes.push([from[0], from[1], u, v]);
      const c = st.layer.getContext('2d');
      c.globalCompositeOperation = 'destination-out';
      c.lineCap = 'round';
      c.lineWidth = brush(w, hh) * 2;
      c.beginPath();
      c.moveTo(from[0] * w, from[1] * hh);
      c.lineTo(u * w + 0.01, v * hh);
      c.stroke();
      c.globalCompositeOperation = 'source-over';
      const r = brush(w, hh);
      for (let gy = 0; gy < 6; gy++) {
        for (let gx = 0; gx < 10; gx++) {
          const i = gy * 10 + gx;
          if (st.grid[i]) continue;
          const px = ((gx + 0.5) / 10) * w;
          const py = ((gy + 0.5) / 6) * hh;
          if (distToSeg(px, py, from[0] * w, from[1] * hh, u * w, v * hh) <= r) st.grid[i] = true;
        }
      }
      const now = performance.now();
      if (now - st.lastSound > 130) {
        st.lastSound = now;
        Sound.play('squish');
      }
      if (st.grid.filter(Boolean).length >= 60 * 0.65) {
        st.fadeAt = now;
        setTimeout(() => { st.active = false; }, 200);
      }
    },
    endContact() { st.last = null; },
    draw(ctx, w, hh, now) {
      if (!st.active) return;
      if (st.lw !== w || st.lh !== hh) rebuild(w, hh);
      ctx.save();
      if (st.fadeAt) ctx.globalAlpha = clamp(1 - (now - st.fadeAt) / 200, 0, 1);
      ctx.drawImage(st.layer, 0, 0, w, hh);
      ctx.restore();
    },
  };
}

function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// ---------------------------------------------------------------- zippers: drag the pull across
function zipperFx(count) {
  const st = { active: true, layer: 0, layers: clamp(count, 1, 3), q: 0, openAt: 0, lastSound: 0 };
  const DENIM = [['#3088B8', '#2878A8'], ['#2C6E9A', '#245E86'], ['#3B95C2', '#2F80AE']];
  const pullX = (w) => w * (0.08 + st.q * 0.75);
  return {
    get active() { return st.active; },
    animated: () => !!st.openAt,
    grab(x, y, w, hh) {
      if (!st.active || st.openAt) return null;
      if (Math.hypot(x - pullX(w), y - hh / 2) > hh * 0.45) return null;
      Sound.play('zip');
      return { q0: st.q, x0: x };
    },
    drag(g, x, w) {
      const q = clamp(g.q0 + (x - g.x0) / (w * 0.75), 0, 1);
      if (Math.abs(q - st.q) > 0.04 && performance.now() - st.lastSound > 70) {
        st.lastSound = performance.now();
        Sound.play('zip');
      }
      st.q = q;
    },
    release() {
      if (st.q <= 0.85 || st.openAt) return;
      st.openAt = performance.now();
      Sound.play('unzip');
      Sound.vibrate(20);
    },
    draw(ctx, w, hh, now) {
      if (!st.active) return;
      let slide = 0;
      if (st.openAt) {
        slide = clamp((now - st.openAt) / 250, 0, 1);
        if (slide >= 1) {
          st.openAt = 0;
          st.q = 0;
          st.layer++;
          if (st.layer >= st.layers) {
            st.active = false;
            return;
          }
          slide = 0;
        }
      }
      const [c1, c2] = DENIM[st.layer % DENIM.length];
      const px = st.openAt ? w : pullX(w);
      const gap = st.openAt ? hh / 2 : Math.min(hh / 2, st.q * hh * 0.6);
      const mid = hh / 2;
      ctx.save();
      roundRect(ctx, 0, 0, w, hh, 8);
      ctx.clip();
      const denim = ctx.createLinearGradient(0, 0, 0, hh);
      denim.addColorStop(0, c1);
      denim.addColorStop(1, c2);
      for (const half of [-1, 1]) {
        ctx.save();
        ctx.translate(0, half * slide * hh * 0.6);
        ctx.beginPath();
        if (half < 0) {
          ctx.moveTo(0, 0); ctx.lineTo(w, 0); ctx.lineTo(w, mid); ctx.lineTo(px, mid); ctx.lineTo(0, mid - gap);
        } else {
          ctx.moveTo(0, hh); ctx.lineTo(w, hh); ctx.lineTo(w, mid); ctx.lineTo(px, mid); ctx.lineTo(0, mid + gap);
        }
        ctx.closePath();
        ctx.fillStyle = denim;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,214,120,0.75)';
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.4;
        ctx.strokeRect(6, 6, w - 12, hh - 12);
        ctx.setLineDash([]);
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1;
        for (let x = -hh; x < w; x += 5) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x + hh, hh);
          ctx.stroke();
        }
        ctx.restore();
      }
      if (!st.openAt) {
        ctx.fillStyle = '#C9A227';
        const tooth = 6;
        for (let x = px; x < w * 0.86; x += tooth) {
          ctx.fillRect(x, mid - 4, tooth * 0.55, 4);
          ctx.fillRect(x + tooth / 2, mid, tooth * 0.55, 4);
        }
        ctx.fillRect(w * 0.86, mid - 6, 6, 12);
        for (const half of [-1, 1]) {
          const steps = Math.max(1, Math.floor(px / tooth));
          for (let i = 0; i < steps; i++) {
            const t = i / steps;
            const x = t * px;
            const y = mid + half * gap * (1 - t);
            ctx.fillRect(x, y - (half < 0 ? 4 : 0), tooth * 0.55, 4);
          }
        }
        const pull = ctx.createLinearGradient(px - 12, 0, px + 12, 0);
        pull.addColorStop(0, '#FFE082');
        pull.addColorStop(1, '#C9A227');
        ctx.fillStyle = pull;
        roundRect(ctx, px - 9, mid - 10, 26, 20, 6);
        ctx.fill();
        ctx.strokeStyle = '#8D6E1A';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(px + 22, mid, 7, 0, Math.PI * 2);
        ctx.strokeStyle = '#C9A227';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      ctx.restore();
    },
  };
}

// ---------------------------------------------------------------- disco inferno (not touchable)
function discoFx() {
  const cells = Array.from({ length: 54 }, () => ({ hue: rand(0, 360), sp: rand(0.5, 2) * (Math.random() < 0.5 ? -1 : 1), k: randInt(0, 2) }));
  const alphas = [96 / 255, 72 / 255, 84 / 255];
  let frames = 0;
  let nextFlash = 20;
  Sound.play('disco');
  return {
    active: true,
    animated: () => true,
    update(dt) {
      const f = dt / 16.67;
      frames += f;
      for (const c of cells) c.hue = (c.hue + c.sp * f + 360) % 360;
      if (frames >= nextFlash) {
        nextFlash += 20;
        for (const c of cells) c.k = (c.k + 1) % 3;
      }
    },
    draw(ctx, W, H) {
      const cw = W / 9;
      const ch = H / 6;
      for (let i = 0; i < 54; i++) {
        const c = cells[i];
        ctx.fillStyle = hsv(c.hue, 1, 1, alphas[c.k]);
        ctx.fillRect((i % 9) * cw, Math.floor(i / 9) * ch, cw + 0.5, ch + 0.5);
      }
    },
  };
}

// ---------------------------------------------------------------- bombles: do not touch
function bomblesFx(count, W, H) {
  const n = clamp(2 * count + 4, 6, 10);
  const spawn = (b) => {
    const a = rand(0, Math.PI * 2);
    const sp = rand(1.5, 3.5);
    Object.assign(b, { x: rand(b.size, W - b.size), y: rand(b.size, H - b.size), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, alive: true });
  };
  const bombs = Array.from({ length: n }, () => {
    const b = { size: 50 * rand(0.85, 1.15), phase: rand(0, 6.28) };
    spawn(b);
    return b;
  });
  const booms = [];
  return {
    active: true,
    animated: () => true,
    hit(p) {
      return bombs.find((b) => b.alive && Math.hypot(p.x - b.x, p.y - b.y) < b.size * 0.58) || null;
    },
    explode(b) {
      b.alive = false;
      booms.push({ x: b.x, y: b.y, t0: performance.now(), parts: Array.from({ length: 14 }, () => ({ a: rand(0, 6.28), v: rand(80, 260) })) });
      setTimeout(() => spawn(b), 1900);
    },
    update(dt, w, hh) {
      W = w;
      H = hh;
      const f = dt / 16.67;
      for (const b of bombs) {
        if (!b.alive) continue;
        const r = b.size / 2;
        b.x += b.vx * f;
        b.y += b.vy * f;
        if (b.x < r) { b.x = r; b.vx = Math.abs(b.vx); }
        if (b.x > W - r) { b.x = W - r; b.vx = -Math.abs(b.vx); }
        if (b.y < r) { b.y = r; b.vy = Math.abs(b.vy); }
        if (b.y > H - r) { b.y = H - r; b.vy = -Math.abs(b.vy); }
      }
    },
    draw(ctx, w, hh, now) {
      for (const b of bombs) {
        if (!b.alive) continue;
        const r = b.size / 2;
        const wob = Math.sin(now / 180 + b.phase) * 0.12;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(wob);
        ctx.strokeStyle = '#8D6E63';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(r * 0.35, -r * 0.8);
        ctx.quadraticCurveTo(r * 0.7, -r * 1.25, r * 0.95, -r * 1.05);
        ctx.stroke();
        const g = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
        g.addColorStop(0, '#666');
        g.addColorStop(1, '#111');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#333';
        ctx.fillRect(r * 0.05, -r * 1.02, r * 0.45, r * 0.32);
        const flick = 0.6 + 0.4 * Math.sin(now / 40 + b.phase * 3);
        ctx.fillStyle = `rgba(255,${Math.round(160 + 80 * flick)},0,${flick})`;
        ctx.beginPath();
        ctx.arc(r * 0.95, -r * 1.05, 4 + 3 * flick, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath();
        ctx.arc(r * 0.95, -r * 1.05, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      for (let i = booms.length - 1; i >= 0; i--) {
        const bm = booms[i];
        const t = (now - bm.t0) / 1000;
        if (t > 0.6) { booms.splice(i, 1); continue; }
        ctx.save();
        ctx.globalAlpha = 1 - t / 0.6;
        const rr = 20 + t * 220;
        const g = ctx.createRadialGradient(bm.x, bm.y, 0, bm.x, bm.y, rr);
        g.addColorStop(0, 'rgba(255,255,200,1)');
        g.addColorStop(0.4, 'rgba(255,160,0,0.9)');
        g.addColorStop(1, 'rgba(255,60,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(bm.x, bm.y, rr, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#FFB300';
        for (const p of bm.parts) {
          ctx.beginPath();
          ctx.arc(bm.x + Math.cos(p.a) * p.v * t, bm.y + Math.sin(p.a) * p.v * t, 4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    },
  };
}

// ---------------------------------------------------------------- lockdown: chains with padlocks
function seededRandom(seed) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    return x / 4294967296;
  };
}

function lockdownFx(n) {
  n = clamp(n, 1, 6);
  const rng = seededRandom(n * 7 + 13);
  const spots = [];
  for (let i = 0; i < n; i++) {
    let best = null;
    for (let tries = 0; tries < 50; tries++) {
      const c = { u: 0.15 + rng() * 0.7, v: 0.15 + rng() * 0.7 };
      best = c;
      if (spots.every((s) => Math.hypot(s.u - c.u, (s.v - c.v) * 0.5) >= 0.3)) break;
    }
    spots.push(best);
  }
  const locks = spots.map((s) => ({
    ...s,
    open: 0,
    chains: Array.from({ length: 3 + Math.floor(rng() * 3) }, () => ({
      ang: ((30 + rng() * 30 + 90 * Math.floor(rng() * 4)) * Math.PI) / 180,
      off: (rng() - 0.5) * 120,
    })),
  }));
  const st = { active: true, doneAt: 0 };
  const lockS = (W) => 0.0675 * W;

  function drawChain(ctx, W, H, cx, cy, ch) {
    const len = 2 * (W + H);
    const linkW = 60;
    const count = Math.floor(len / (linkW * 0.8));
    const px = cx - Math.sin(ch.ang) * ch.off;
    const py = cy + Math.cos(ch.ang) * ch.off;
    const dx = Math.cos(ch.ang);
    const dy = Math.sin(ch.ang);
    for (let i = 0; i <= count; i++) {
      const d = -len / 2 + (i / count) * len;
      const x = px + dx * d;
      const y = py + dy * d;
      if (x < -120 || y < -120 || x > W + 120 || y > H + 120) continue;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ch.ang + (i % 2 ? Math.PI / 2 : 0));
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,0.376)';
      ctx.lineWidth = 8;
      roundRect(ctx, -30 + 1.5, -18 + 2, 60, 36, 18);
      ctx.stroke();
      ctx.strokeStyle = '#E0C850';
      ctx.lineWidth = 6;
      roundRect(ctx, -30, -18, 60, 36, 18);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawPadlock(ctx, cx, cy, s) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#887010';
    ctx.lineWidth = 0.16 * s;
    ctx.beginPath();
    ctx.arc(cx, cy - 0.55 * s, 0.3 * s, Math.PI, 0);
    ctx.moveTo(cx - 0.3 * s, cy - 0.55 * s);
    ctx.lineTo(cx - 0.3 * s, cy - 0.25 * s);
    ctx.moveTo(cx + 0.3 * s, cy - 0.55 * s);
    ctx.lineTo(cx + 0.3 * s, cy - 0.25 * s);
    ctx.stroke();
    const bx = cx - 0.5 * s;
    const by = cy - 0.25 * s;
    const bw = s;
    const bh = 0.85 * s;
    ctx.fillStyle = '#A07010';
    roundRect(ctx, bx, by, bw, bh, 0.12 * s);
    ctx.fill();
    ctx.strokeStyle = '#604008';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#C89820';
    roundRect(ctx, bx + 0.08 * bw, by + 0.06 * bh, 0.34 * bw, 0.32 * bh, 0.06 * s);
    ctx.fill();
    const ky = by + 0.48 * bh;
    ctx.fillStyle = '#302008';
    ctx.beginPath();
    ctx.arc(cx, ky, 0.12 * s, 0, Math.PI * 2);
    ctx.moveTo(cx - 0.054 * s, ky + 0.06 * s);
    ctx.lineTo(cx + 0.054 * s, ky + 0.06 * s);
    ctx.lineTo(cx, ky + 0.3 * s);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  return {
    get active() { return st.active; },
    animated: () => locks.some((l) => l.open && performance.now() - l.open < 450) || !!st.doneAt,
    tap(p, W, H) {
      if (!st.active) return false;
      const reach = 2 * lockS(W);
      const l = locks.find((k) => !k.open && Math.hypot(p.x - k.u * W, p.y - k.v * H) <= reach);
      if (l) {
        l.open = performance.now();
        Sound.play('unlock');
        Sound.vibrate(12);
        if (locks.every((k) => k.open)) {
          Sound.play('chains');
          st.doneAt = performance.now() + 250;
        }
      }
      return true;
    },
    draw(ctx, W, H, now) {
      if (!st.active) return;
      let fade = 1;
      if (st.doneAt && now > st.doneAt) {
        fade = clamp(1 - (now - st.doneAt) / 200, 0, 1);
        if (fade <= 0) { st.active = false; return; }
      }
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(0, 0, W, H);
      const s = lockS(W);
      for (const l of locks) {
        const t = l.open ? clamp((now - l.open) / 400, 0, 1) : 0;
        if (t >= 1) continue;
        ctx.globalAlpha = fade * (1 - t);
        for (const ch of l.chains) drawChain(ctx, W, H, l.u * W, l.v * H + t * t * H * 0.4, ch);
      }
      for (const l of locks) {
        const t = l.open ? clamp((now - l.open) / 400, 0, 1) : 0;
        if (t >= 1) continue;
        ctx.globalAlpha = fade * (1 - t);
        drawPadlock(ctx, l.u * W, l.v * H + t * t * H * 0.5, s * (1 + t * 0.3));
      }
      ctx.restore();
    },
  };
}

// ---------------------------------------------------------------- bugs: tap each twice
const BUG_WORDS = ['Sna', 'Fli', 'res', 'OV', 'Pl', 'Air', 'gh', 'he'];
const BUG_RECTS = ['#5A3D7A', '#7A5A9A', '#4A2D6A', '#6A4A8A', '#3A1D5A', '#8A6AAA'];

function bugFx(count) {
  const n = clamp(count, 1, 6);
  const bugs = Array.from({ length: n }, () => ({ u: rand(0.18, 0.82), v: rand(0.18, 0.82), taps: 2, phase: rand(0, 6.28), from: null, jumpAt: 0 }));
  const rects = Array.from({ length: 40 }, () => ({
    u: Math.random(), v: Math.random(), w: rand(40, 120), h: rand(25, 65), rot: (rand(-30, 30) * Math.PI) / 180,
    c: pick(BUG_RECTS), t: Math.random() > 0.4 ? pick(BUG_WORDS) : '',
  }));
  const st = { active: true, vortex: 0 };
  const R = (W) => 0.12 * W;

  function drawBug(ctx, x, y, r, b) {
    ctx.save();
    ctx.translate(x, y);
    ctx.save();
    ctx.rotate((st.vortex * Math.PI) / 180);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const hw = (8 * Math.PI) / 180;
      ctx.fillStyle = i % 2 ? 'rgba(136,51,170,0.25)' : 'rgba(170,68,204,0.376)';
      ctx.beginPath();
      ctx.moveTo(Math.cos(a - hw) * r * 0.8, Math.sin(a - hw) * r * 0.8);
      ctx.lineTo(Math.cos(a) * r * 4, Math.sin(a) * r * 4);
      ctx.lineTo(Math.cos(a + hw) * r * 0.8, Math.sin(a + hw) * r * 0.8);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    ctx.rotate((Math.sin(b.phase) * 5 * Math.PI) / 180);
    const sc = 1 + Math.sin(1.5 * b.phase) * 0.03;
    ctx.scale(sc, sc);
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1.6 * r);
    glow.addColorStop(0.4, 'rgba(64,224,255,0.5)');
    glow.addColorStop(1, 'rgba(64,224,255,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, 1.6 * r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineCap = 'round';
    ctx.lineWidth = 0.08 * r;
    for (let layer = 8; layer >= 0; layer--) {
      const rr = r * (0.3 + layer * 0.08);
      const alpha = clamp(255 - layer * 20, 100, 255) / 255;
      ctx.strokeStyle = `rgba(64,200,232,${alpha})`;
      const strokes = 20 + layer * 4;
      ctx.beginPath();
      for (let s2 = 0; s2 < strokes; s2++) {
        const a = ((s2 * 360) / strokes + layer * 15) * (Math.PI / 180);
        ctx.moveTo(Math.cos(a) * (rr - 0.06 * r), Math.sin(a) * (rr - 0.06 * r));
        ctx.lineTo(Math.cos(a) * (rr + 0.06 * r), Math.sin(a) * (rr + 0.06 * r));
      }
      ctx.stroke();
    }
    ctx.fillStyle = '#50D0F0';
    ctx.beginPath();
    ctx.arc(0, 0, 0.5 * r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#80E0FF';
    ctx.fillStyle = '#80E0FF';
    ctx.lineWidth = 0.06 * r;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(side * 0.15 * r, -0.4 * r);
      ctx.lineTo(side * 0.4 * r, -1.21 * r);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(side * 0.4 * r, -1.21 * r, 0.08 * r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#fff';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(side * 0.2 * r, -0.1 * r, 0.22 * r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#000';
    for (const px of [-0.15, 0.25]) {
      ctx.beginPath();
      ctx.arc(px * r, -0.05 * r, 0.11 * r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  return {
    get active() { return st.active; },
    animated: () => st.active,
    tap(p, W, H) {
      if (!st.active) return false;
      const r = R(W);
      const now = performance.now();
      const b = bugs.find((k) => k.taps > 0 && Math.hypot(p.x - k.u * W, p.y - k.v * H) <= r * 1.5);
      if (!b) return true;
      b.taps--;
      if (b.taps === 0) {
        Sound.play('squash');
        Sound.vibrate(25);
        if (bugs.every((k) => k.taps === 0)) st.active = false;
        return true;
      }
      Sound.play('buzz');
      const m = (r * 1.5) / W;
      const mv = (r * 1.5) / H;
      b.from = { u: b.u, v: b.v };
      b.jumpAt = now;
      b.u = b.from.u < 0.5 ? rand(0.5, 1 - m) : rand(m, 0.5);
      b.v = b.from.v < 0.5 ? rand(0.5, Math.max(0.5, 1 - mv)) : rand(Math.min(0.5, mv), 0.5);
      return true;
    },
    update(dt) {
      const f = dt / 16.67;
      st.vortex += 0.8 * f;
      for (const b of bugs) b.phase += 0.08 * f;
    },
    draw(ctx, W, H, now) {
      if (!st.active) return;
      ctx.save();
      ctx.fillStyle = 'rgba(58,21,96,0.733)';
      ctx.fillRect(0, 0, W, H);
      ctx.font = '800 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const rc of rects) {
        ctx.save();
        ctx.translate(rc.u * W, rc.v * H);
        ctx.rotate(rc.rot);
        ctx.fillStyle = rc.c;
        roundRect(ctx, -rc.w / 2, -rc.h / 2, rc.w, rc.h, 4);
        ctx.fill();
        if (rc.t) {
          ctx.fillStyle = '#fff';
          ctx.fillText(rc.t, 0, rc.h * 0.15);
        }
        ctx.restore();
      }
      const r = R(W);
      for (const b of bugs) {
        if (b.taps === 0) continue;
        let x = b.u * W;
        let y = b.v * H;
        if (b.jumpAt && now - b.jumpAt < 180) {
          const t = (now - b.jumpAt) / 180;
          x = lerp(b.from.u * W, x, t);
          y = lerp(b.from.v * H, y, t);
        }
        drawBug(ctx, x, y, r, b);
      }
      ctx.restore();
    },
  };
}
