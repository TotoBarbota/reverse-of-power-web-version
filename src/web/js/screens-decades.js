// Decades round types: elimination, matching (hex column) and missing letter.
function decadesFrame(questionText, top, size, instruction) {
  const f = minigameFrame(PINK);
  const q = h('div', { class: 'mg-q', style: { top: `${top}px`, fontSize: `${size}px` }, text: questionText || '' });
  const overlay = h('div', { class: 'full hidden', style: { background: 'rgba(255,0,0,0.376)', zIndex: '8' } });
  const hint = instruction ? h('div', { class: 'hint mg-hint', style: { bottom: '24px' }, text: instruction }) : null;
  f.el.append(q, overlay);
  if (hint) f.el.append(hint);
  return { ...f, q, overlay, hint };
}

function roundsGame(ctx, { total, send }) {
  const state = { round: 0, correct: 0, sent: false, penalty: false, locked: false };
  state.send = () => {
    if (state.sent) return;
    state.sent = true;
    send(state.correct);
  };
  if (!total) state.send();
  else ctx.scope.timeout(state.send, ctx.remainingMs(ctx.msg.QuestionDuration || 0));
  return state;
}

// ---------------------------------------------------------------- elimination
Screens.elimination = {
  game: true,
  duration: (m) => m.QuestionDuration || 0,
  answerType: 'ClientToServerEliminatingAnswer',
  mount(ctx) {
    const { scope, msg } = ctx;
    const f = decadesFrame(msg.QuestionText, 40, 16, 'Tap to smash odd one out');
    const rounds = msg.EliminatingAnswerData || [];
    const btns = [0, 1, 2].map(() => h('button', { class: 'elim-btn' }));
    f.el.append(h('div', { class: 'elim-row' }, ...btns.map((b) => h('div', {}, b))));
    if (ctx.sent('ClientToServerEliminatingAnswer')) {
      btns.forEach((b) => { b.style.visibility = 'hidden'; });
      f.hint.textContent = 'Done, waiting for other players';
      return { el: f.el };
    }
    const st = roundsGame(ctx, {
      total: rounds.length,
      send: (n) => App.send({ TypeString: `${KIP}ClientToServerEliminatingAnswer`, AnswerCount: n }),
    });

    function display() {
      const r = rounds[st.round];
      const answers = shuffle([r.CorrectAnswer, ...(r.IncorrectAnswers || []).slice(0, 2)]);
      btns.forEach((b, i) => {
        const text = answers[i];
        b.style.visibility = text == null ? 'hidden' : 'visible';
        b.textContent = text ?? '';
        b.style.opacity = '1';
        b.style.background = 'var(--eggshell)';
        b.disabled = false;
        b.correct = text === r.CorrectAnswer;
        scope.timeout(() => fitText(b, 14, 9), 0);
      });
      f.counter.set(rounds.length - st.round);
    }
    btns.forEach((b) => b.addEventListener('click', () => {
      if (st.sent || st.penalty || st.locked || b.disabled) return;
      if (b.correct) {
        st.correct++;
        st.locked = true;
        b.style.background = TEAL[0];
        btns.forEach((x) => { x.disabled = true; });
        Sound.play('shatter');
        Sound.vibrate(15);
        scope.timeout(() => {
          st.locked = false;
          st.round++;
          if (st.round >= rounds.length) st.send();
          else display();
        }, 400);
      } else {
        st.penalty = true;
        b.style.background = ROSE[0];
        b.style.opacity = '0.5';
        b.disabled = true;
        f.overlay.classList.remove('hidden');
        Sound.play('wrong');
        Sound.vibrate([40, 30, 40]);
        scope.timeout(() => {
          f.overlay.classList.add('hidden');
          st.penalty = false;
        }, 800);
      }
    }));
    if (rounds.length) display();
    return { el: f.el };
  },
};

// ---------------------------------------------------------------- matching
const HEX_ACCENTS = ['#66BB6A', '#42A5F5', '#FF8A65', '#AB47BC', '#FFCA28', '#EC407A'];
const HEX_BODY = { normal: '#9C27B0', correct: TEAL[0], wrong: ROSE[0] };

Screens.matching = {
  game: true,
  duration: (m) => m.QuestionDuration || 0,
  answerType: 'ClientToServerMatchingAnswer',
  mount(ctx) {
    const { scope, msg } = ctx;
    const f = decadesFrame('', 40, 18, 'Swipe to find, tap to match');
    f.bg.setColors('#9C27B0', '#7B1FA2');
    const rounds = msg.MatchingData || [];
    const dummies = msg.DummyAnswerData || [];
    const hex = h('div', { class: 'hex' });
    const stage = h('div', { class: 'hex-stage' }, hex);
    f.el.insertBefore(stage, f.q);
    const faces = HEX_ACCENTS.map((acc) => {
      const label = h('span');
      const face = h('div', { class: 'hex-face' },
        h('div', { class: 'hex-screen' }, h('div', { class: 'hex-btn', style: { background: acc } }, label)),
        h('div', { class: 'hex-body' }));
      face.label = label;
      hex.append(face);
      return face;
    });
    const cap = h('div', { style: { position: 'absolute', background: '#70584F', filter: 'brightness(0.9)' } });
    hex.append(cap);

    let idx = 0;
    let rotation = 0;
    let faceW = 180;
    let answers = [];

    function setBody(c) {
      hex.style.setProperty('--hb', c);
      hex.style.setProperty('--hb2', shade(c, 0.75));
    }
    function shadeFaces() {
      faces.forEach((face, i) => {
        const dot = Math.cos(rotation + (i * Math.PI) / 3);
        face.style.filter = `brightness(${0.5 + 0.5 * clamp(dot, 0, 1)})`;
      });
    }
    function layout() {
      const avail = f.el.clientHeight - 150;
      const faceH = clamp(avail, 150, 300);
      faceW = Math.round(faceH / 1.29);
      const apothem = faceW * Math.cos(Math.PI / 6) / (2 * Math.sin(Math.PI / 6));
      Object.assign(hex.style, { width: `${faceW}px`, height: `${faceH}px` });
      faces.forEach((face, i) => {
        Object.assign(face.style, { width: `${faceW}px`, height: `${faceH}px`, transform: `rotateY(${i * 60}deg) translateZ(${apothem}px)` });
        face.label.style.fontSize = `${Math.round(faceW * 0.13)}px`;
      });
      const R = faceW;
      const pts = [0, 1, 2, 3, 4, 5].map((k) => {
        const a = ((30 + k * 60) * Math.PI) / 180;
        return `${50 + 50 * Math.sin(a)}% ${50 + 50 * Math.cos(a)}%`;
      });
      Object.assign(cap.style, { width: `${2 * R}px`, height: `${2 * R}px`, left: `${faceW / 2 - R}px`, top: `${-R}px`, transform: 'rotateX(90deg)', clipPath: `polygon(${pts.join(',')})` });
      faces.forEach((face) => scope.timeout(() => fitText(face.label, Math.round(faceW * 0.13), 10), 0));
    }
    function rotate() {
      hex.style.transform = `rotateX(-8deg) rotateY(${(rotation * 180) / Math.PI}deg)`;
      shadeFaces();
    }
    function display() {
      const r = rounds[st.round];
      f.q.textContent = r.QuestionText || '';
      const pool = dummies.filter((d) => d !== r.AnswerText);
      let fillers;
      if (pool.length >= 5) fillers = shuffle(pool).slice(0, 5);
      else if (pool.length) fillers = [0, 1, 2, 3, 4].map((k) => pool[k % pool.length]);
      else fillers = ['', '', '', '', ''];
      answers = shuffle([...fillers, r.AnswerText]);
      idx = 0;
      rotation = 0;
      hex.style.transition = 'none';
      rotate();
      void hex.offsetWidth;
      hex.style.transition = '';
      faces.forEach((face, i) => {
        face.classList.remove('pressed');
        face.label.textContent = answers[i];
        fitText(face.label, Math.round(faceW * 0.13), 10);
      });
      f.counter.set(rounds.length - st.round);
    }
    function step(dir) {
      idx = (idx + dir + 6) % 6;
      rotation -= (dir * Math.PI) / 3;
      Sound.play('whoosh');
      rotate();
    }
    function confirm() {
      if (st.round >= rounds.length) return;
      const r = rounds[st.round];
      const ok = answers[idx] === r.AnswerText;
      st.locked = true;
      faces[idx].classList.add('pressed');
      if (ok) {
        st.correct++;
        App.send({ TypeString: `${KIP}ClientToServerOngoingChallengeMessage`, CorrectAnswerCount: st.correct });
        f.bg.setColors(...TEAL);
        setBody(HEX_BODY.correct);
        Sound.play('correct');
        scope.timeout(() => {
          st.locked = false;
          st.round++;
          if (st.round >= rounds.length) { st.send(); return; }
          f.bg.setColors('#9C27B0', '#7B1FA2');
          setBody(HEX_BODY.normal);
          display();
        }, 500);
      } else {
        f.bg.setColors(...ROSE);
        setBody(HEX_BODY.wrong);
        Sound.play('wrong');
        Sound.vibrate(30);
        scope.timeout(() => {
          f.bg.setColors('#9C27B0', '#7B1FA2');
          setBody(HEX_BODY.normal);
          st.locked = false;
        }, 400);
      }
    }

    setBody(HEX_BODY.normal);
    if (ctx.sent('ClientToServerMatchingAnswer')) {
      stage.classList.add('hidden');
      f.hint.textContent = 'Done, waiting for other players';
      return { el: f.el };
    }
    const st = roundsGame(ctx, {
      total: rounds.length,
      send: (n) => App.send({ TypeString: `${KIP}ClientToServerMatchingAnswer`, ClientMatchingCorrectAnswerCount: n }),
    });

    let g = null;
    scope.on(stage, 'pointerdown', (e) => {
      Sound.unlock();
      g = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), consumed: false };
      try { stage.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });
    scope.on(stage, 'pointermove', (e) => {
      if (!g || e.pointerId !== g.id || st.locked || st.sent || g.consumed) return;
      const dx = e.clientX - g.x;
      if (Math.abs(dx) > 40) {
        g.consumed = true;
        step(dx > 0 ? -1 : 1);
      }
    });
    const up = (e) => {
      if (!g || e.pointerId !== g.id) return;
      const gg = g;
      g = null;
      if (st.locked || st.sent || gg.consumed || e.type === 'pointercancel') return;
      const dx = e.clientX - gg.x;
      const dy = e.clientY - gg.y;
      const fast = performance.now() - gg.t < 250;
      if (fast && Math.abs(dx) >= 24) { step(dx > 0 ? -1 : 1); return; }
      if (Math.hypot(dx, dy) > 12) return;
      const r = faces[idx].querySelector('.hex-screen').getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) confirm();
    };
    scope.on(stage, 'pointerup', up);
    scope.on(stage, 'pointercancel', up);

    scope.resize(f.el, layout);
    if (rounds.length) display();
    return { el: f.el, ready: () => { layout(); rotate(); } };
  },
};

// ---------------------------------------------------------------- missing letter
Screens.missing = {
  game: true,
  duration: (m) => m.QuestionDuration || 0,
  answerType: 'PrototypeClientToServerMissingLetterAnswer',
  mount(ctx) {
    const { scope, msg } = ctx;
    const f = decadesFrame(msg.Question, 56, 20, null);
    const rounds = msg.MissingLetterAnswerData || [];
    const tiles = h('div', { class: 'tiles' });
    const btns = [0, 1, 2, 3, 4].map(() => h('button', { class: 'letter-btn' }));
    f.el.append(tiles, h('div', { class: 'letters' }, ...btns));
    if (ctx.sent('PrototypeClientToServerMissingLetterAnswer')) {
      btns.forEach((b) => b.classList.add('hidden'));
      f.counter.set(null);
      tiles.append(h('div', { class: 'hint', text: 'Done, waiting for other players' }));
      return { el: f.el };
    }
    const st = roundsGame(ctx, {
      total: rounds.length,
      send: (n) => App.send({ TypeString: `${KIP}PrototypeClientToServerMissingLetterAnswer`, ClientMissingLetterCorrectAnswerCount: n }),
    });

    function buildTiles() {
      const r = rounds[st.round];
      if (!r) return;
      const phrase = r.answerInfo || '';
      const missing = (r.correct || ' ')[0].toUpperCase();
      const width = Math.floor(f.el.clientWidth * 0.6);
      const perRow = clamp(Math.floor((phrase.length + 1) / 2), 4, 12);
      const size = Math.min(80, Math.floor((width - (perRow - 1) * 3) / perRow));
      Object.assign(tiles.style, { width: `${width}px`, gap: '3px' });
      tiles.replaceChildren(...[...phrase].map((ch) => {
        if (ch === ' ') return h('div', { style: { width: '10px', height: `${size}px` } });
        const blank = ch.toUpperCase() === missing;
        const revealed = blank && tiles.revealed;
        return h('div', {
          class: `tile${blank ? ' blank' : ''}${revealed ? ' revealed' : ''}`,
          style: { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.45)}px` },
          text: blank && !revealed ? '' : blank ? missing : ch,
        });
      }));
    }
    function display() {
      const r = rounds[st.round];
      tiles.revealed = false;
      buildTiles();
      const letters = [...(r.letters || '')];
      btns.forEach((b, i) => {
        b.classList.toggle('hidden', i >= letters.length);
        b.textContent = letters[i] || '';
        b.style.opacity = '1';
        b.style.background = 'var(--eggshell)';
        b.disabled = false;
        b.correct = (letters[i] || '').toUpperCase() === String(r.correct || '').toUpperCase();
      });
      f.counter.set(rounds.length - st.round);
    }
    btns.forEach((b) => b.addEventListener('click', () => {
      if (st.sent || st.penalty || st.locked || b.disabled) return;
      if (b.correct) {
        st.correct++;
        st.locked = true;
        b.style.background = TEAL[0];
        btns.forEach((x) => { x.disabled = true; });
        tiles.revealed = true;
        buildTiles();
        Sound.play('reveal');
        Sound.vibrate(15);
        scope.timeout(() => {
          st.locked = false;
          st.round++;
          if (st.round >= rounds.length) st.send();
          else display();
        }, 400);
      } else {
        st.penalty = true;
        b.style.background = ROSE[0];
        b.style.opacity = '0.5';
        b.disabled = true;
        f.overlay.classList.remove('hidden');
        Sound.play('wrong');
        Sound.vibrate([40, 30, 40]);
        scope.timeout(() => {
          f.overlay.classList.add('hidden');
          st.penalty = false;
        }, 800);
      }
    }));
    scope.resize(f.el, buildTiles);
    if (rounds.length) display();
    return { el: f.el };
  },
};
