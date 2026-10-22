// Shared pieces for the drag-to-link screens.
let stripePattern = null;
function linkStripe(ctx) {
  if (!stripePattern) {
    const c = document.createElement('canvas');
    c.width = 20;
    c.height = 20;
    const g = c.getContext('2d');
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        g.fillStyle = Math.floor((x + y) / 10) % 2 === 0 ? '#FFFFFF' : '#66CCDD';
        g.fillRect(x, y, 1, 1);
      }
    }
    stripePattern = c;
  }
  return ctx.createPattern(stripePattern, 'repeat');
}

function drawLinkPath(ctx, pts) {
  if (pts.length < 2) return;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [style, w] of [['#2299AA', 24], [linkStripe(ctx), 18]]) {
    ctx.strokeStyle = style;
    ctx.lineWidth = w;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
  }
}

function placeSlot(el, { w, hh, left, right, top, bottom, centerX, rot = 0, k = 1 }) {
  Object.assign(el.style, {
    width: `${w * k}px`, height: `${hh * k}px`,
    left: left != null ? `${left * k}px` : centerX ? `calc(50% - ${(w * k) / 2}px)` : '',
    right: right != null ? `${right * k}px` : '',
    top: top != null ? `${top * k}px` : '',
    bottom: bottom != null ? `${bottom * k}px` : '',
    transform: rot ? `rotate(${rot}deg)` : '',
    fontSize: `${16 * Math.max(0.8, k)}px`,
  });
}

// Centre and rotation of a slot, relative to the screen element.
function slotGeom(slot, root) {
  const r = rectOf(slot, root);
  return { cx: r.x + r.w / 2, cy: r.y + r.h / 2, w: slot.offsetWidth, h: slot.offsetHeight, rot: slot.rot || 0 };
}

function inSlot(p, g, pad = 8) {
  const a = (-g.rot * Math.PI) / 180;
  const dx = p.x - g.cx;
  const dy = p.y - g.cy;
  const x = dx * Math.cos(a) - dy * Math.sin(a);
  const y = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(x) <= g.w / 2 + pad && Math.abs(y) <= g.h / 2 + pad;
}

function minigameFrame(colours) {
  const bg = sunburst(...colours);
  const counter = counterPill();
  const feedback = feedbackBubble();
  const el = h('div', {}, bg, whirlpool(), counter);
  return { el, bg, counter, feedback };
}

const scaleFor = (el, w, hh) => Math.min(1, el.clientWidth / w, el.clientHeight / hh);

// ---------------------------------------------------------------- linking pairs (KIP)
Screens.pairs = {
  game: true,
  duration: (m) => m.QuestionDuration || 0,
  answerType: 'ClientLinkingAnswer',
  mount(ctx) {
    const { scope } = ctx;
    const msg = ctx.msg;
    const f = minigameFrame(PINK);
    Object.assign(f.counter.style, { top: '50%', transform: 'translate(-50%, calc(-50% - 44px))' });
    const hint = h('div', { class: 'hint mg-hint', style: { top: '50%', transform: 'translate(-50%, -50%)' }, text: 'Drag to link answers' });
    const canvas = hiCanvas('link-canvas');
    const POS = [
      [{ left: 20, top: 24, rot: -12 }, { right: 20, top: 16, rot: 12 }, { centerX: true, top: 20, rot: 3 }],
      [{ left: 60, bottom: 24, rot: 8 }, { right: 20, bottom: 16, rot: -8 }, { centerX: true, bottom: 20, rot: -3 }],
    ];
    const mk = (cls) => h('div', { class: `slot ${cls}`, style: { position: 'absolute' } });
    const topEls = [0, 1, 2].map(() => mk('dome-top'));
    const botEls = [0, 1, 2].map(() => mk('dome-bottom'));
    f.el.append(...topEls, hint, ...botEls, f.feedback, canvas);

    const all = (msg.LinkingAnswers || []).slice().sort((a, b) => a.MatchIndex - b.MatchIndex);
    const topQ = all.filter((a) => a.Direction === 1);
    const botQ = all.filter((a) => a.Direction === 2);
    const totalPairs = Math.min(topQ.length, botQ.length);
    const activeTop = [null, null, null];
    const activeBot = [null, null, null];
    const attempts = [];
    let correct = 0;
    let sent = !!ctx.sent('ClientLinkingAnswer');
    let drag = null;
    let fbTimer = 0;

    const key = (id) => {
      const s2 = String(id);
      const i = s2.indexOf('Answer');
      if (i < 0) return s2;
      const after = s2.slice(i + 6);
      return after.length >= 2 ? after.slice(1) : s2;
    };

    function fillRow(slots, q) {
      const toFill = Math.min(3 - slots.filter(Boolean).length, q.length);
      const empty = shuffle(slots.map((x, i) => (x ? -1 : i)).filter((i) => i >= 0));
      for (let i = 0; i < toFill; i++) slots[empty[i]] = q.shift();
    }
    function ensureMatch() {
      const tk = new Set(activeTop.filter(Boolean).map((a) => key(a.AnswerID)));
      const bk = new Set(activeBot.filter(Boolean).map((a) => key(a.AnswerID)));
      for (const k2 of tk) if (bk.has(k2)) return;
      for (const t of activeTop.filter(Boolean)) {
        const mi = botQ.findIndex((b) => key(b.AnswerID) === key(t.AnswerID));
        if (mi >= 0) {
          const m = botQ.splice(mi, 1)[0];
          let si = activeBot.findIndex(Boolean);
          if (si < 0) si = activeBot.findIndex((x) => !x);
          if (activeBot[si]) botQ.push(activeBot[si]);
          activeBot[si] = m;
          return;
        }
      }
      for (const b of activeBot.filter(Boolean)) {
        const mi = topQ.findIndex((t) => key(t.AnswerID) === key(b.AnswerID));
        if (mi >= 0) {
          const m = topQ.splice(mi, 1)[0];
          let si = activeTop.findIndex(Boolean);
          if (si < 0) si = activeTop.findIndex((x) => !x);
          if (activeTop[si]) topQ.push(activeTop[si]);
          activeTop[si] = m;
          return;
        }
      }
      send();
    }
    function fillSlots() {
      fillRow(activeTop, topQ);
      fillRow(activeBot, botQ);
      ensureMatch();
    }
    function send() {
      if (sent) return;
      sent = true;
      App.send({ TypeString: `${KIP}ClientLinkingAnswer`, ClientLinkingCorrectAnswerCount: correct, ClientAnswers: attempts.slice() });
    }
    function updateUI() {
      const set = (els, items) => els.forEach((e, i) => {
        e.textContent = items[i] ? items[i].DisplayText : '';
        e.style.visibility = items[i] ? 'visible' : 'hidden';
      });
      set(topEls, activeTop);
      set(botEls, activeBot);
      const left = totalPairs - correct;
      f.counter.set(left > 0 && !sent ? left : null);
      hint.textContent = left > 0 && !sent ? 'Drag to link answers' : 'Done, waiting for other players';
      if (sent && left > 0) { topEls.concat(botEls).forEach((e) => { e.style.visibility = 'hidden'; }); }
    }
    function layout() {
      const k = scaleFor(f.el, 700, 360);
      [topEls, botEls].forEach((els, row) => els.forEach((e, i) => {
        placeSlot(e, { w: 200, hh: 100, k, ...POS[row][i] });
        e.rot = POS[row][i].rot;
      }));
      canvas.fit();
    }
    function redraw(pts) {
      const g = canvas.ctx;
      if (!g) return;
      g.clearRect(0, 0, canvas.cw, canvas.ch);
      if (pts) drawLinkPath(g, pts);
    }
    function feedback(a, b, ok) {
      clearTimeout(fbTimer);
      f.bg.setColors(...(ok ? TEAL : ROSE));
      f.feedback.show(a, b, ok ? TEAL[0] : ROSE[0]);
      fbTimer = scope.timeout(() => {
        f.feedback.hide();
        f.bg.setColors(...PINK);
      }, 500);
    }
    function processMatch(ti, bi) {
      const t = activeTop[ti];
      const b = activeBot[bi];
      const ok = key(t.AnswerID) === key(b.AnswerID);
      attempts.push({ FromID: t.AnswerID, ToID: b.AnswerID, Correct: ok });
      if (ok) {
        correct++;
        Sound.play('correct');
        feedback(t.DisplayText, b.DisplayText, true);
        activeTop[ti] = null;
        activeBot[bi] = null;
        scope.timeout(() => {
          fillSlots();
          updateUI();
          if (correct >= totalPairs) send();
          updateUI();
        }, 500);
      } else {
        Sound.play('wrong');
        Sound.vibrate(30);
        feedback(t.DisplayText, b.DisplayText, false);
      }
    }

    const at = (els, items, p) => els.findIndex((e, i) => items[i] && inSlot(p, slotGeom(e, f.el)));
    onDrag(scope, canvas, {
      relativeTo: f.el,
      start(p) {
        if (sent) return false;
        const ti = at(topEls, activeTop, p);
        if (ti < 0) return false;
        const g = slotGeom(topEls[ti], f.el);
        drag = { ti, pts: [{ x: g.cx, y: g.cy }] };
        Sound.play('link');
        redraw(drag.pts);
        return true;
      },
      move(p) {
        if (!drag) return;
        drag.pts.push(p);
        redraw(drag.pts);
      },
      end(p, cancelled) {
        const d = drag;
        drag = null;
        redraw(null);
        if (!d || cancelled || sent) return;
        const bi = at(botEls, activeBot, p);
        if (bi >= 0 && activeTop[d.ti] && activeBot[bi]) processMatch(d.ti, bi);
      },
    });

    if (!sent) {
      fillSlots();
      scope.timeout(send, ctx.remainingMs(msg.QuestionDuration || 0));
    }
    updateUI();
    scope.resize(f.el, layout);
    return { el: f.el, ready: layout };
  },
};

// ---------------------------------------------------------------- linking chain / ordering (Decades)
Screens.chain = {
  game: true,
  duration: (m) => m.QuestionDuration || 0,
  answerType: 'ClientToServerOrderingAnswer',
  mount(ctx) {
    const { scope } = ctx;
    const msg = ctx.msg;
    const f = minigameFrame(PINK);
    const hint = h('div', { class: 'hint mg-hint', style: { top: '50%', transform: 'translate(-50%, -50%)' }, text: 'Drag to link in order' });
    const canvas = hiCanvas('link-canvas');
    const POS = [
      { left: 16, top: 40 }, { right: 16, top: 32 }, { centerX: true, bottom: 40 }, { left: 8, bottom: 32 }, { right: 8, bottom: 32 },
    ];
    const slotEls = POS.map(() => h('div', { class: 'slot circle', style: { position: 'absolute' } }));
    f.el.append(...slotEls, hint, f.feedback, canvas);

    const rounds = (msg.OrderingAnswerData || []).map((d, mi) => (d.WordsInCorrectOrder || []).map((word, dir) => ({ DisplayText: word, AnswerID: `ORD_${mi}_${dir}` })));
    let round = 0;
    let correct = 0;
    let sent = !!ctx.sent('ClientToServerOrderingAnswer');
    let slots = [];
    let chain = [];
    let segs = [];
    let live = null;
    let locked = false;

    const send = () => {
      if (sent) return;
      sent = true;
      App.send({ TypeString: `${KIP}ClientToServerOrderingAnswer`, ClientOrderingCorrectAnswerCount: correct });
    };
    function show() {
      chain = [];
      segs = [];
      live = null;
      if (round >= rounds.length) return;
      slots = shuffle(rounds[round]).slice(0, 5);
      slotEls.forEach((e, i) => {
        const it = slots[i];
        e.classList.toggle('hidden', !it);
        e.textContent = it ? it.DisplayText : '';
        e.style.background = '#F0EAD6';
        if (it) scope.timeout(() => fitText(e, 16 * (e.k || 1), 10), 0);
      });
      f.counter.set(rounds.length - round);
      redraw();
    }
    function highlight() {
      slotEls.forEach((e, i) => { e.style.background = chain.includes(i) ? '#B2DFDB' : '#F0EAD6'; });
    }
    function centre(i) {
      const g = slotGeom(slotEls[i], f.el);
      return { x: g.cx, y: g.cy };
    }
    function redraw() {
      const g = canvas.ctx;
      if (!g) return;
      g.clearRect(0, 0, canvas.cw, canvas.ch);
      for (const s2 of segs) drawLinkPath(g, s2);
      if (live) drawLinkPath(g, live);
    }
    function reset() {
      chain = [];
      segs = [];
      live = null;
      highlight();
      redraw();
    }
    const order = () => rounds[round] || [];
    function complete() {
      live = null;
      locked = true;
      redraw();
      Sound.play('correct');
      f.bg.setColors(...TEAL);
      f.feedback.show(order().map((x) => x.DisplayText).join(' '), '', TEAL[0]);
      scope.timeout(() => {
        f.feedback.hide();
        f.bg.setColors(...PINK);
        locked = false;
        correct++;
        round++;
        f.counter.set(rounds.length - round);
        if (round >= rounds.length) send();
        else show();
      }, 600);
    }
    const slotAt = (p) => slotEls.findIndex((e, i) => slots[i] && !e.classList.contains('hidden') && inSlot(p, { ...slotGeom(e, f.el), rot: 0 }, 0));

    onDrag(scope, canvas, {
      relativeTo: f.el,
      start(p) {
        if (locked || round >= rounds.length) return false;
        const i = slotAt(p);
        if (i < 0 || chain.length || slots[i].AnswerID !== order()[0].AnswerID) return false;
        chain.push(i);
        highlight();
        Sound.play('link');
        if (chain.length === slots.length) { complete(); return false; }
        live = [centre(i)];
        redraw();
        return true;
      },
      move(p) {
        if (!live || locked) return;
        live.push(p);
        const i = slotAt(p);
        if (i >= 0 && !chain.includes(i)) {
          if (slots[i].AnswerID === order()[chain.length].AnswerID) {
            const c = centre(i);
            live.push(c);
            segs.push(live);
            chain.push(i);
            highlight();
            Sound.play('snap');
            Sound.vibrate(8);
            live = [c];
            if (chain.length === slots.length) complete();
          } else {
            live = null;
            locked = true;
            Sound.play('wrong');
            Sound.vibrate(30);
            f.bg.setColors(...ROSE);
            scope.timeout(() => {
              f.bg.setColors(...PINK);
              locked = false;
              reset();
            }, 400);
          }
        }
        redraw();
      },
      end() {
        if (!locked && round < rounds.length && chain.length < slots.length) reset();
        live = null;
        redraw();
      },
    });

    function layout() {
      const k = scaleFor(f.el, 640, 380);
      slotEls.forEach((e, i) => {
        placeSlot(e, { w: 144, hh: 144, k, ...POS[i] });
        e.k = k;
        e.style.fontSize = `${16 * k}px`;
        if (slots[i]) fitText(e, 16 * k, 10);
      });
      canvas.fit();
      redraw();
    }

    if (sent) {
      slotEls.forEach((e) => e.classList.add('hidden'));
      hint.textContent = 'Done, waiting for other players';
      f.counter.set(null);
    } else {
      show();
      scope.timeout(send, ctx.remainingMs(msg.QuestionDuration || 0));
    }
    scope.resize(f.el, layout);
    return { el: f.el, ready: layout };
  },
};

// ---------------------------------------------------------------- sorting (KIP)
Screens.sorting = {
  game: true,
  duration: (m) => m.QuestionDuration || 0,
  answerType: 'ClientSortingAnswer',
  mount(ctx) {
    const { scope } = ctx;
    const msg = ctx.msg;
    const f = minigameFrame(PINK);
    const q = h('div', { class: 'hint', style: { position: 'absolute', top: '48px', left: '50%', transform: 'translateX(-50%)', fontSize: '14px', zIndex: '3', maxWidth: '70%', textAlign: 'center' }, text: msg.QuestionText || '' });
    const left = h('div', { class: 'bucket left', text: msg.LeftBucketLabel || '' });
    const right = h('div', { class: 'bucket right', text: msg.RightBucketLabel || '' });
    const item = h('div', { class: 'sort-item' });
    f.el.append(q, left, right, item, f.feedback);

    const queue = shuffle(msg.SortingAnswers || []);
    const attempts = [];
    let current = null;
    let correct = 0;
    let sent = !!ctx.sent('ClientSortingAnswer');
    let start = null;

    const send = () => {
      if (sent) return;
      sent = true;
      App.send({ TypeString: `${KIP}ClientSortingAnswer`, ClientSortingCorrectAnswerCount: correct, SortingAnswers: attempts.slice() });
    };
    function next() {
      current = queue.shift() || null;
      item.style.transition = 'none';
      item.style.transform = '';
      item.style.visibility = current ? 'visible' : 'hidden';
      item.textContent = current ? current.DisplayText : '';
      if (current) fitText(item, 18, 10);
      const leftCount = queue.length + (current ? 1 : 0);
      f.counter.set(leftCount > 0 ? leftCount : null);
    }
    function sortInto(bucketId) {
      const it = current;
      const correctId = it.AnswerDirection === 1 ? msg.LeftBucketID : msg.RightBucketID;
      const ok = bucketId === correctId;
      attempts.push({ AnswerID: it.AnswerID, AnswerBucketID: bucketId, Correct: ok });
      if (ok) correct++;
      Sound.play(ok ? 'correct' : 'wrong');
      if (!ok) Sound.vibrate(30);
      f.bg.setColors(...(ok ? TEAL : ROSE));
      f.feedback.show(it.DisplayText, '', ok ? TEAL[0] : ROSE[0]);
      item.style.visibility = 'hidden';
      current = null;
      scope.timeout(() => {
        f.feedback.hide();
        f.bg.setColors(...PINK);
        next();
        if (!current && !queue.length) send();
      }, 400);
    }

    onDrag(scope, item, {
      relativeTo: f.el,
      start(p) {
        if (!current) return false;
        start = p;
        item.style.transition = 'transform 100ms';
        item.style.transform = 'scale(1.1)';
        Sound.play('tap');
        return true;
      },
      move(p) {
        if (!start) return;
        item.style.transition = 'none';
        item.style.transform = `translate(${p.x - start.x}px, ${p.y - start.y}px) scale(1.1)`;
      },
      end(p, cancelled) {
        if (!start || !current) return;
        const dx = p.x - start.x;
        start = null;
        const cx = f.el.clientWidth / 2 + dx;
        if (!cancelled && cx < left.offsetLeft + left.offsetWidth) { sortInto(msg.LeftBucketID); return; }
        if (!cancelled && cx > right.offsetLeft) { sortInto(msg.RightBucketID); return; }
        item.style.transition = 'transform 200ms';
        item.style.transform = '';
      },
    });

    if (sent) {
      item.style.visibility = 'hidden';
      f.counter.set(null);
    } else {
      next();
      scope.timeout(send, ctx.remainingMs(msg.QuestionDuration || 0));
    }
    return { el: f.el };
  },
};
