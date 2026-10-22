// ---------------------------------------------------------------- DOM helpers
const SVGNS = 'http://www.w3.org/2000/svg';

function build(el, props, kids) {
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.setAttribute('class', v);
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) {
          if (sv == null) continue;
          if (sk.startsWith('--')) el.style.setProperty(sk, sv);
          else el.style[sk] = sv;
        }
      } else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (!(el instanceof SVGElement) && k in el && k !== 'list' && k !== 'form') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  appendKids(el, kids);
  return el;
}

function appendKids(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : String(k));
  }
  return el;
}

function h(tag, props, ...kids) { return build(document.createElement(tag), props, kids); }
function s(tag, props, ...kids) { return build(document.createElementNS(SVGNS, tag), props, kids); }

function svgEl(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild;
}

function icon(name, cls) {
  const markup = ICONS[name];
  if (!markup) return null;
  const el = svgEl(markup);
  if (cls) el.setAttribute('class', cls);
  return el;
}

function localPoint(e, el) {
  const r = el.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function rectOf(el, root) {
  const r = el.getBoundingClientRect();
  const o = root ? root.getBoundingClientRect() : { left: 0, top: 0 };
  return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height };
}

const inRect = (p, r, pad = 0) => p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;

// A canvas sized to its box at device resolution; draw in CSS pixels.
function hiCanvas(cls) {
  const c = h('canvas', { class: cls || '' });
  c.fit = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = c.clientWidth;
    const hh = c.clientHeight;
    if (!w || !hh) return false;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(hh * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(hh * dpr);
    }
    c.cw = w;
    c.ch = hh;
    c.ctx = c.getContext('2d');
    c.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  };
  return c;
}

// ---------------------------------------------------------------- maths and colour
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const byte = (x) => clamp(Math.trunc(x * 255), 0, 255);
const hex2 = (n) => n.toString(16).padStart(2, '0');

// Console colours arrive as { r, g, b, a } floats. Converted like the Android app: trunc(c * 255).
function tintHex(c) {
  if (!c) return null;
  return `#${hex2(byte(c.r))}${hex2(byte(c.g))}${hex2(byte(c.b))}`;
}
const isBlackTint = (c) => !c || (byte(c.r) === 0 && byte(c.g) === 0 && byte(c.b) === 0);

function hexRgb(hex) {
  const v = hex.replace('#', '');
  const n = parseInt(v.length === 3 ? v.split('').map((ch) => ch + ch).join('') : v.slice(-6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgbHex = (r, g, b) => `#${hex2(clamp(Math.trunc(r), 0, 255))}${hex2(clamp(Math.trunc(g), 0, 255))}${hex2(clamp(Math.trunc(b), 0, 255))}`;

function blend(a, b, t) {
  const x = hexRgb(a);
  const y = hexRgb(b);
  return rgbHex(lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t));
}
function shade(hex, f) {
  const [r, g, b] = hexRgb(hex);
  return rgbHex(r * f, g * f, b * f);
}
function rgba(hex, a) {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
function hsv(hue, sat, val, alpha = 1) {
  const f = (n) => {
    const k = (n + hue / 60) % 6;
    return val - val * sat * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return `rgba(${Math.round(f(5) * 255)},${Math.round(f(3) * 255)},${Math.round(f(1) * 255)},${alpha})`;
}

// ---------------------------------------------------------------- ids and storage
function hexId(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, hex2).join('');
}
function uuid() {
  const x = hexId(16).split('');
  x[12] = '4';
  x[16] = '89ab'[parseInt(x[16], 16) & 3];
  const v = x.join('');
  return `${v.slice(0, 8)}-${v.slice(8, 12)}-${v.slice(12, 16)}-${v.slice(16, 20)}-${v.slice(20)}`;
}

const store = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(`kip.${key}`);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      if (value == null) localStorage.removeItem(`kip.${key}`);
      else localStorage.setItem(`kip.${key}`, JSON.stringify(value));
    } catch { /* private mode */ }
  },
};

function deviceUid() {
  let id = store.get('uid');
  if (!id || !/^[0-9a-f]{16}$/.test(id)) {
    id = hexId(8);
    store.set('uid', id);
  }
  return id;
}

const shortType = (t) => String(t || '').replace(/^.*\./, '');

function b64ToBlobUrl(b64, type = 'image/jpeg') {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type }));
}

// ---------------------------------------------------------------- per-screen lifetime
// Everything a screen schedules goes through its scope, so leaving the screen stops it.
class Scope {
  constructor() {
    this.fns = [];
    this.alive = true;
  }
  add(fn) { this.fns.push(fn); }
  timeout(fn, ms) {
    const id = setTimeout(() => { if (this.alive) fn(); }, Math.max(0, ms));
    this.add(() => clearTimeout(id));
    return id;
  }
  interval(fn, ms) {
    const id = setInterval(() => { if (this.alive) fn(); }, ms);
    this.add(() => clearInterval(id));
    return id;
  }
  // fn(dtMs, now) runs every frame until it returns false or the scope ends.
  loop(fn) {
    let id = 0;
    let last = performance.now();
    let stopped = false;
    const tick = (t) => {
      if (!this.alive || stopped) return;
      const dt = Math.min(64, t - last);
      last = t;
      if (fn(dt, t) === false) return;
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    const stop = () => { stopped = true; cancelAnimationFrame(id); };
    this.add(stop);
    return stop;
  }
  on(target, ev, fn, opts) {
    target.addEventListener(ev, fn, opts);
    this.add(() => target.removeEventListener(ev, fn, opts));
  }
  resize(el, fn) {
    if (typeof ResizeObserver === 'undefined') {
      this.on(window, 'resize', () => fn());
      this.timeout(fn, 0);
      return;
    }
    const ro = new ResizeObserver(() => { if (this.alive) fn(); });
    ro.observe(el);
    this.add(() => ro.disconnect());
  }
  dispose() {
    this.alive = false;
    for (const fn of this.fns.splice(0).reverse()) {
      try { fn(); } catch (e) { console.error(e); }
    }
  }
}

// Pointer drag with capture. start(p, e) returns false to ignore the gesture.
function onDrag(scope, el, { start, move, end, relativeTo }) {
  let active = null;
  const ref = relativeTo || el;
  scope.on(el, 'pointerdown', (e) => {
    if (active !== null) return;
    const p = localPoint(e, ref);
    if (start && start(p, e) === false) return;
    active = e.pointerId;
    try { el.setPointerCapture(e.pointerId); } catch { /* old browsers */ }
    e.preventDefault();
  });
  scope.on(el, 'pointermove', (e) => {
    if (e.pointerId !== active) return;
    if (move) move(localPoint(e, ref), e);
  });
  const finish = (e, cancelled) => {
    if (e.pointerId !== active) return;
    active = null;
    if (end) end(localPoint(e, ref), cancelled, e);
  };
  scope.on(el, 'pointerup', (e) => finish(e, false));
  scope.on(el, 'pointercancel', (e) => finish(e, true));
}

function wrapLines(ctx, text, maxWidth) {
  const out = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width <= maxWidth || !line) line = test;
      else {
        out.push(line);
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}

// Largest font size (<= max) at which text wraps inside w x h.
function fitFont(ctx, text, w, hgt, max, min = 10, weight = 800) {
  let size = max;
  for (; size > min; size -= 1) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    const lines = wrapLines(ctx, text, w);
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (lines.length * size * 1.15 <= hgt && widest <= w) break;
  }
  ctx.font = `${weight} ${size}px ${FONT}`;
  return { size, lines: wrapLines(ctx, text, w) };
}

const FONT = getComputedStyle(document.documentElement).getPropertyValue('--font') || 'system-ui, sans-serif';

// Shrinks an element's font until its text fits its box.
function fitText(el, max, min = 10) {
  let size = max;
  el.style.fontSize = `${size}px`;
  while (size > min && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)) {
    size -= 1;
    el.style.fontSize = `${size}px`;
  }
}

function roundRect(ctx, x, y, w, hh, r) {
  const rr = Math.min(r, w / 2, hh / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + hh, rr);
  ctx.arcTo(x + w, y + hh, x, y + hh, rr);
  ctx.arcTo(x, y + hh, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

let toastTimer = 0;
function toast(text, ms = 2600) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = h('div', { class: 'toast' });
    document.body.append(el);
  }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
