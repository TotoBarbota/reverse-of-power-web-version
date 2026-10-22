// Backgrounds shared by most screens: the 24-ray sunburst and the whirlpool spiral.
function sunburst(primary = '#C4B8A8', secondary = '#D4C8B8') {
  const rays = h('div', { class: 'sunburst' });
  const wrap = h('div', { class: 'sunburst-wrap' }, rays);
  wrap.setColors = (a, b) => {
    rays.style.setProperty('--sb1', a);
    rays.style.setProperty('--sb2', b);
  };
  wrap.setColors(primary, secondary);
  return wrap;
}

let whirlPath = null;
function whirlpool() {
  if (!whirlPath) {
    const maxR = 38;
    const maxHalf = maxR * 0.15;
    const rotations = 3.5;
    const points = Math.round(rotations * 120);
    const parts = [];
    for (const phase of [0, Math.PI]) {
      const outer = [];
      const inner = [];
      for (let i = 0; i <= points; i++) {
        const t = i / points;
        const a = phase + t * rotations * Math.PI * 2;
        const r = t * maxR;
        const hw = t * maxHalf;
        outer.push(`${((r + hw) * Math.cos(a)).toFixed(2)},${((r + hw) * Math.sin(a)).toFixed(2)}`);
        inner.push(`${((r - hw) * Math.cos(a)).toFixed(2)},${((r - hw) * Math.sin(a)).toFixed(2)}`);
      }
      parts.push(`M${outer.join('L')}L${inner.reverse().join('L')}Z`);
    }
    whirlPath = parts.join('');
  }
  const el = s('svg', { class: 'whirlpool', viewBox: '-50 -50 100 100', preserveAspectRatio: 'xMidYMid meet' },
    s('path', { d: whirlPath, fill: 'rgba(255,255,255,0.19)' }));
  return el;
}

const PINK = ['#E8679A', '#D05888'];
const TEAL = ['#4DB6AC', '#3DA69C'];
const ROSE = ['#C85080', '#B04070'];

function counterPill() {
  const el = h('div', { class: 'pill counter' });
  el.set = (n) => {
    el.textContent = `${n} to go`;
    el.classList.toggle('hidden', n == null);
  };
  return el;
}

function feedbackBubble() {
  const top = h('div');
  const bottom = h('div', { style: { marginTop: '8px' } });
  const bubble = h('div', { class: 'bubble' }, top, bottom);
  const el = h('div', { class: 'feedback hidden' }, bubble);
  el.show = (a, b, color) => {
    top.textContent = a || '';
    bottom.textContent = b || '';
    bottom.classList.toggle('hidden', !b);
    bubble.style.color = color;
    el.classList.remove('hidden');
  };
  el.hide = () => el.classList.add('hidden');
  return el;
}
