// ---------------------------------------------------------------- category doors
const DOOR_SHAPES = [
  'M8,158 L8,62 Q8,24 50,4 Q92,24 92,62 L92,158 Z',
  'M8,158 L8,52 A42,46 0 0 1 92,52 L92,158 Z',
  'M8,158 L8,40 Q8,28 18,26 Q22,10 36,14 Q50,0 64,14 Q78,10 82,26 Q92,28 92,40 L92,158 Z',
  'M8,158 L8,36 Q8,12 50,12 Q92,12 92,36 L92,158 Z',
];

function doorSvg(style, colour) {
  const base = colour || '#8B5A2B';
  const doorCol = blend(base, '#5C4033', 0.5);
  const frameCol = blend(base, '#FFFFFF', 0.7);
  const shape = DOOR_SHAPES[style % 4];
  const svg = s('svg', { viewBox: '0 -4 100 166', preserveAspectRatio: 'xMidYMax meet' },
    s('path', { d: shape, fill: frameCol, stroke: '#D4AF37', 'stroke-width': 2.5, 'stroke-linejoin': 'round' }),
    s('g', { transform: 'translate(50 158) scale(0.8 0.86) translate(-50 -158)' },
      s('path', { d: shape, fill: doorCol, stroke: shade(doorCol, 0.7), 'stroke-width': 2 }),
      s('path', { d: 'M34,40 V156 M50,30 V156 M66,40 V156', stroke: shade(doorCol, 0.8), 'stroke-width': 1.4, opacity: 0.6 }),
      s('rect', { x: 18, y: 90, width: 64, height: 5, fill: shade(doorCol, 0.75), opacity: 0.7 }),
      s('circle', { cx: 74, cy: 108, r: 4.2, fill: '#D4AF37', stroke: '#8a6d1a', 'stroke-width': 1 })),
    s('rect', { x: 4, y: 156, width: 92, height: 4, rx: 2, fill: '#D4AF37' }));
  for (let i = 0; i < 31; i++) {
    const g = s('circle', {
      cx: rand(10, 90).toFixed(1), cy: rand(20, 154).toFixed(1), r: rand(0.6, 1.6).toFixed(2), fill: '#FFFACD',
      style: `animation: twinkle ${rand(1.2, 2.8).toFixed(2)}s ease-in-out ${rand(0, 2).toFixed(2)}s infinite`,
    });
    svg.append(g);
  }
  return svg;
}

function choiceTints(msg) {
  const bg = msg && msg.BackgroundTint && !isBlackTint(msg.BackgroundTint) ? tintHex(msg.BackgroundTint) : '#C4B8A8';
  const sec = msg && msg.SecondaryTint && !isBlackTint(msg.SecondaryTint) ? tintHex(msg.SecondaryTint) : '#D4C8B8';
  return [bg, sec];
}

Screens.category = {
  game: true,
  mount(ctx) {
    let msg = ctx.msg;
    const prior = ctx.sent('ClientCategorySelectChoice');
    let chosen = prior ? prior.ChosenCategoryIndex : null;
    if (chosen === -1) chosen = null;
    const bg = sunburst(...choiceTints(msg));
    const doors = h('div', { class: 'doors' });
    const el = h('div', {}, bg, h('div', { class: 'layer center', style: { justifyContent: 'flex-start' } },
      h('div', { class: 'cat-title', text: 'CHOOSE A CATEGORY' }), doors));

    const sendChoice = (i) => App.send({ TypeString: `${KIP}ClientCategorySelectChoice`, ChosenCategoryIndex: i });

    function render() {
      const choices = (msg && msg.CategoryChoices) || [];
      doors.replaceChildren();
      for (let i = 0; i < 4; i++) {
        const c = choices[i];
        const col = h('div', { class: `door-col${c ? '' : ' invisible'}` },
          h('div', { class: 'lbl', text: c ? String(c.DisplayText || '').replace(/\\n/g, '\n') : '' }),
          doorSvg(i, c && c.Colour ? tintHex(c.Colour) : null));
        if (chosen != null) col.style.opacity = i === chosen ? '1' : '0.3';
        col.addEventListener('click', () => {
          if (chosen != null || !c) return;
          chosen = i;
          Sound.play('select');
          Sound.vibrate(15);
          sendChoice(i);
          render();
        });
        doors.append(col);
      }
    }
    render();

    if (S.categoryRequestPending) {
      S.categoryRequestPending = false;
      sendChoice(chosen ?? -1);
    }
    return {
      el,
      onMsg(m, type) {
        if (type === 'ServerRequestCategorySelectChoice') {
          sendChoice(chosen ?? -1);
          return true;
        }
        if (type === 'ServerCategorySelectChoices') {
          msg = m;
          if (m.BackgroundTint) bg.setColors(...choiceTints(m));
          render();
          return true;
        }
        return false;
      },
    };
  },
};

// ---------------------------------------------------------------- power pick (category override)
function categoryName(msg) {
  const name = msg.InitialCategorySelectChoice || '';
  return h('div', {
    class: `shadow${name ? '' : ' hidden'}`,
    style: { fontSize: '24px', fontWeight: '700', margin: '0 0 6px' },
    text: name,
  });
}

Screens.powerpick = {
  game: true,
  duration: (m) => m.DurationSeconds || 0,
  answerType: 'ClientCategorySelectOverride',
  mount(ctx) {
    const { scope } = ctx;
    const msg = ctx.msg || {};
    let sent = !!ctx.sent('ClientCategorySelectOverride');
    const c = holdingColours();
    const bg = sunburst(c.bg, c.sec);
    const content = h('div', { class: 'layer center', style: { gap: '10px', padding: '12px' } });
    const el = h('div', {}, bg, content);
    const bar = h('div', { style: { height: '100%', width: '100%', background: '#D4AF37', borderRadius: '3px', transformOrigin: 'left' } });

    const reply = () => App.send({ TypeString: `${KIP}ClientStopCategorySelectOverrideResponse`, OverrideSent: sent });

    function offer() {
      const btn = h('button', { class: 'pentagon', 'aria-label': 'Power Pick' },
        s('svg', { viewBox: '0 0 100 100' },
          s('path', { d: 'M50,5 L97,37 L79,90 L21,90 L3,37 Z', fill: '#D4AF37', stroke: '#FFD700', 'stroke-width': 3, 'stroke-linejoin': 'round' }),
          s('text', { x: 50, y: 62, 'text-anchor': 'middle', 'font-size': 30, 'font-weight': 900, fill: '#6b4e00', text: 'P' })));
      btn.addEventListener('click', () => {
        if (sent) return;
        sent = true;
        Sound.play('power');
        Sound.vibrate([20, 30, 20]);
        App.send({ TypeString: `${KIP}ClientCategorySelectOverride`, DurationSeconds: Math.round(ctx.elapsedSec() * 1000) / 1000 });
        accepted();
      });
      content.replaceChildren(
        h('div', { class: 'shadow', style: { fontSize: '16px', fontWeight: '800', opacity: '.9' }, text: 'CATEGORY SELECTED' }),
        categoryName(msg),
        btn,
        h('div', { style: { color: '#D4AF37', fontSize: '26px', fontWeight: '900', textShadow: 'var(--shadow)' }, text: 'POWER PICK' }),
        h('div', { class: 'shadow-sm', style: { whiteSpace: 'pre-line', textAlign: 'center', fontSize: '15px' }, text: "Play a Power Pick once per game\nto overrule everyone else's choice" }),
        h('div', { style: { width: 'min(60vw, 320px)', height: '6px', background: 'rgba(0,0,0,.25)', borderRadius: '3px', marginTop: '6px' } }, bar));
      const total = (msg.DurationSeconds || 0) * 1000;
      if (total > 0) {
        scope.loop(() => {
          const left = clamp(ctx.remainingMs(msg.DurationSeconds) / total, 0, 1);
          bar.style.transform = `scaleX(${left})`;
          return left > 0 && !sent;
        });
      }
    }
    function accepted() {
      bg.setColors('#4A7AB5', '#3A6AA5');
      content.replaceChildren(
        h('div', { class: 'pentagon' }, s('svg', { viewBox: '0 0 100 100' },
          s('path', { d: 'M50,5 L97,37 L79,90 L21,90 L3,37 Z', fill: '#D4AF37', stroke: '#FFD700', 'stroke-width': 3 }))),
        h('h1', { class: 'title', text: 'Power Pick accepted!' }),
        categoryName(msg));
    }

    if (sent) accepted();
    else offer();

    const stopped = ctx.got('ServerStopCategorySelectOverride');
    if (stopped) {
      if (!ctx.sent('ClientStopCategorySelectOverrideResponse')) reply();
      if (!sent) scope.timeout(() => App.show('holding', {}), 0);
    }
    return {
      el,
      onMsg(m, type) {
        if (type === 'ServerStopCategorySelectOverride') {
          reply();
          if (!sent) App.show('holding', {});
          return true;
        }
        return false;
      },
    };
  },
};
