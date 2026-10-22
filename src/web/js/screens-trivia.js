Screens.trivia = {
  game: true,
  duration: (m) => m.QuestionDuration || 0,
  answerType: 'ClientTriviaAnswer',
  mount(ctx) {
    const { scope } = ctx;
    const msg = ctx.msg;
    const finals = msg.RoundType === 5;
    const bgA = msg.BackgroundTint ? tintHex(msg.BackgroundTint) : '#333333';
    const bgB = msg.SecondaryTint ? tintHex(msg.SecondaryTint) : '#222222';
    const byIndex = new Map((msg.Answers || []).map((a) => [a.DisplayIndex, a]));
    const prior = ctx.sent('ClientTriviaAnswer');
    let answered = !!prior;
    let wrongCount = 0;
    let penalty = false;

    const cells = [];
    const grid = h('div', { class: 'grid' });
    for (let r = 0; r < 2; r++) {
      const row = h('div', { class: 'grid-row' });
      for (let c = 0; c < 2; c++) {
        const i = r * 2 + c;
        const a = byIndex.get(i);
        const btn = h('button', { class: 'answer', tabIndex: -1, text: a ? a.DisplayText : '' });
        const canvas = hiCanvas('ov');
        canvas.style.pointerEvents = 'none';
        const cell = h('div', { class: `cell${a ? '' : ' invisible'}` }, btn, canvas);
        cells.push({ i, a, btn, canvas, el: cell, fx: [], rect: null });
        row.append(cell);
      }
      grid.append(row);
    }
    const fxCanvas = hiCanvas('full');
    fxCanvas.style.pointerEvents = 'none';
    const wrongFlash = h('div', { class: 'full wrong-flash hidden' });
    const boom = h('div', { class: 'full boom hidden', text: "Don't touch the bombs!" });
    const input = h('div', { class: 'full', style: { touchAction: 'none' } });
    const el = h('div', {},
      sunburst(bgA, bgB),
      h('div', { class: 'layer trivia' },
        h('div', { class: 'q', text: msg.QuestionText || '' }),
        finals ? h('div', { class: 'finals', text: 'Finals! Wrong answers are rejected!' }) : null,
        grid),
      fxCanvas, wrongFlash, boom, input);

    const highlight = (idx) => cells.forEach((c) => { c.el.style.opacity = c.i === idx ? '1' : '0.3'; });
    if (prior) highlight(prior.ChosenAnswerDisplayIndex);

    const sendAnswer = (displayIndex, time) => App.send({
      TypeString: `${KIP}ClientTriviaAnswer`,
      ChosenAnswerDisplayIndex: displayIndex,
      AnswerTime: time,
      NumBombsExploded: 0,
      PaintCleared: false,
      IceCleared: false,
      NumWrongAnswers: wrongCount,
      TotalPaintLayersPerAnswer: 0,
      PaintLayersClearedAnswer0: 0,
      PaintLayersClearedAnswer1: 0,
      PaintLayersClearedAnswer2: 0,
      PaintLayersClearedAnswer3: 0,
      TotalIceLayersPerAnswer: 0,
      IceLayersClearedAnswer0: 0,
      IceLayersClearedAnswer1: 0,
      IceLayersClearedAnswer2: 0,
      IceLayersClearedAnswer3: 0,
    });

    function blockFor(overlay, ms) {
      penalty = true;
      overlay.classList.remove('hidden');
      scope.timeout(() => {
        overlay.classList.add('hidden');
        penalty = false;
      }, ms);
    }

    function choose(cell) {
      if (answered || penalty || !cell || !cell.a) return;
      if (finals && !cell.a.IsCorrect) {
        wrongCount++;
        Sound.play('wrong');
        Sound.vibrate([40, 30, 40]);
        blockFor(wrongFlash, 1900);
        return;
      }
      answered = true;
      Sound.play('select');
      Sound.vibrate(15);
      highlight(cell.i);
      sendAnswer(cell.a.DisplayIndex, Math.round(ctx.elapsedSec() * 1000) / 1000);
    }

    // ------------------------------------------------ effects
    const counts = powerCounts(msg.PowerPlays);
    const screenFx = [];
    let disco = null;
    let bombles = null;
    let lockdown = null;
    let bugs = null;
    function setupFx() {
      if (answered) return;
      const fontMax = parseFloat(getComputedStyle(cells[0].btn).fontSize) || 34;
      for (const cell of cells) {
        if (!cell.a) continue;
        if (counts[PT.LETTER_SCATTER] > 0) cell.fx.push(textFx(cell.a.DisplayText, { scatter: true, bites: counts[PT.NIBBLERS] > 0 ? 2 + 2 * counts[PT.NIBBLERS] : 0, maxFont: fontMax }));
        else if (counts[PT.NIBBLERS] > 0) cell.fx.push(textFx(cell.a.DisplayText, { bites: 2 + 2 * counts[PT.NIBBLERS], maxFont: Math.min(42, fontMax * 1.2) }));
        if (cell.fx.length) cell.btn.style.color = 'transparent';
        if (counts[PT.FREEZE] > 0) cell.ice = iceFx(counts[PT.FREEZE]);
        if (counts[PT.GLOOP] > 0) cell.gloop = gloopFx(counts[PT.GLOOP]);
        if (counts[PT.ZIPPERS] > 0) cell.zip = zipperFx(counts[PT.ZIPPERS]);
        for (const k of ['ice', 'gloop', 'zip']) if (cell[k]) cell.fx.push(cell[k]);
      }
      if (counts[PT.DISCO] > 0) screenFx.push(disco = discoFx());
      if (counts[PT.BOMBLES] > 0) screenFx.push(bombles = bomblesFx(counts[PT.BOMBLES], el.clientWidth, el.clientHeight));
      if (counts[PT.LOCKDOWN] > 0) screenFx.push(lockdown = lockdownFx(counts[PT.LOCKDOWN] * 3));
      if (counts[PT.BUG] > 0) screenFx.push(bugs = bugFx(counts[PT.BUG]));
    }

    function layout() {
      for (const c of cells) {
        c.rect = rectOf(c.el, el);
        c.canvas.fit();
        c.dirty = true;
      }
      fxCanvas.fit();
    }

    scope.loop((dt, now) => {
      const W = fxCanvas.cw;
      const H = fxCanvas.ch;
      for (const c of cells) {
        if (!c.fx.length) continue;
        const live = c.fx.some((f) => f.active || (f.animated && f.animated()));
        const anim = c.fx.some((f) => f.animated && f.animated());
        if (!c.dirty && !anim && !c.wasLive) continue;
        c.dirty = false;
        c.wasLive = live && anim;
        const { ctx: g, cw, ch } = c.canvas;
        if (!g) continue;
        g.clearRect(0, 0, cw, ch);
        for (const f of c.fx) f.draw(g, cw, ch, now);
      }
      if (fxCanvas.ctx && (screenFx.length || fxCanvas.wasDrawn)) {
        const g = fxCanvas.ctx;
        g.clearRect(0, 0, W, H);
        fxCanvas.wasDrawn = false;
        for (const f of screenFx) {
          if (f.update) f.update(dt, W, H, now);
          if (f.active !== false) {
            f.draw(g, W, H, now);
            fxCanvas.wasDrawn = true;
          }
        }
      }
    });

    // ------------------------------------------------ input, routed top layer first
    const cellAt = (p) => cells.find((c) => c.a && c.rect && inRect(p, c.rect)) || null;
    const local = (c, p) => ({ x: p.x - c.rect.x, y: p.y - c.rect.y });
    const gloopActive = () => cells.some((c) => c.gloop && c.gloop.active);
    let gesture = null;

    function bombHit(p) {
      if (!bombles || answered || penalty) return false;
      const b = bombles.hit(p);
      if (!b) return false;
      bombles.explode(b);
      Sound.play('boom');
      Sound.vibrate([60, 40, 80]);
      blockFor(boom, 1900);
      gesture = null;
      return true;
    }

    // A tap that reached the answers: zippers and ice take it before the button does.
    function tapCell(c, p) {
      if (!c) return;
      if (c.zip && c.zip.active) return;
      if (c.ice && c.ice.active) {
        const l = local(c, p);
        c.ice.tap(l.x / c.rect.w, l.y / c.rect.h);
        c.dirty = true;
        return;
      }
      choose(c);
    }

    scope.on(input, 'pointerdown', (e) => {
      Sound.unlock();
      if (answered || penalty || gesture) return;
      const p = localPoint(e, el);
      try { input.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      if (bugs && bugs.active) { bugs.tap(p, fxCanvas.cw, fxCanvas.ch); return; }
      if (lockdown && lockdown.active) { lockdown.tap(p, fxCanvas.cw, fxCanvas.ch); return; }
      if (bombHit(p)) return;
      const c = cellAt(p);
      gesture = { id: e.pointerId, start: p, moved: false, cell: c, gloop: gloopActive(), zip: null, lastGloop: null };
      if (c && c.zip && c.zip.active) {
        const l = local(c, p);
        const g = c.zip.grab(l.x, l.y, c.rect.w, c.rect.h);
        if (g) { gesture.zip = g; return; }
      }
      if (gesture.gloop) {
        wipe(p, true);
        return;
      }
      if (c && ((c.zip && c.zip.active) || (c.ice && c.ice.active))) {
        tapCell(c, p);
        gesture.consumed = true;
      }
    });

    function wipe(p, newContact) {
      const c = cellAt(p);
      if (!c || !c.gloop || !c.gloop.active) {
        if (gesture) gesture.lastGloop = null;
        return;
      }
      const l = local(c, p);
      c.gloop.wipe(l.x / c.rect.w, l.y / c.rect.h, c.rect.w, c.rect.h, newContact || gesture.lastGloop !== c);
      gesture.lastGloop = c;
      c.dirty = true;
    }

    scope.on(input, 'pointermove', (e) => {
      if (!gesture || e.pointerId !== gesture.id) return;
      const p = localPoint(e, el);
      if (Math.hypot(p.x - gesture.start.x, p.y - gesture.start.y) > 20) gesture.moved = true;
      if (bombHit(p)) return;
      if (gesture.zip) {
        const c = gesture.cell;
        c.zip.drag(gesture.zip, local(c, p).x, c.rect.w);
        c.dirty = true;
        return;
      }
      if (gesture.gloop) wipe(p, false);
    });

    const finish = (e, cancelled) => {
      if (!gesture || e.pointerId !== gesture.id) return;
      const g = gesture;
      gesture = null;
      cells.forEach((c) => c.gloop && c.gloop.endContact());
      if (g.zip) {
        g.cell.zip.release();
        g.cell.dirty = true;
        return;
      }
      if (cancelled || g.moved || g.consumed) return;
      const p = localPoint(e, el);
      const c = cellAt(p);
      if (c && c === g.cell) tapCell(c, p);
    };
    scope.on(input, 'pointerup', (e) => finish(e, false));
    scope.on(input, 'pointercancel', (e) => finish(e, true));

    // ------------------------------------------------ timer
    if (!answered) {
      scope.timeout(() => {
        if (answered) return;
        answered = true;
        sendAnswer(-1, msg.QuestionDuration);
      }, ctx.remainingMs(msg.QuestionDuration || 0));
    }

    scope.resize(el, layout);
    return {
      el,
      ready() {
        layout();
        setupFx();
        layout();
      },
    };
  },
};
