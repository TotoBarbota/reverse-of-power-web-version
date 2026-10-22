const APP_ICON = (document.querySelector('link[rel="apple-touch-icon"]') || {}).href || '';

// ---------------------------------------------------------------- join screen
Screens.connect = {
  local: true,
  mount(ctx) {
    const { scope } = ctx;
    const body = h('div', { class: 'lobby-inner' });
    const el = h('div', { class: 'lobby' }, body);
    let manualIp = store.get('manualIp', '');

    const join = (ip) => {
      Sound.unlock();
      goImmersive();
      keepAwake();
      store.set('autojoin', ip);
      S.status = { state: 'connecting' };
      Net.raw({ op: 'connect', consoleIp: ip });
      render();
    };
    const leave = () => {
      store.set('autojoin', null);
      Net.raw({ op: 'leave' });
      S.status = { state: 'idle' };
      render();
    };

    function header() {
      return [
        APP_ICON ? h('img', { class: 'logo', src: APP_ICON, alt: '' }) : null,
        h('h1', { class: 'title', text: 'Knowledge is Power' }),
        h('p', { class: 'sub', text: 'Play along on this phone. No app needed, works with the original game and Decades.' }),
      ];
    }

    function relayCard() {
      const input = h('input', { class: 'input small', placeholder: '192.168.1.20:8080', value: Net.address || '', inputmode: 'url', autocapitalize: 'off', autocomplete: 'off' });
      return h('div', { class: 'card col', style: { width: '100%' } },
        h('b', { text: 'Where is the relay?' }),
        h('p', { class: 'sub', style: { textAlign: 'left', margin: 0 }, text: 'Open the link shown by kip-relay on your computer, or type its address here.' }),
        h('div', { class: 'row' }, input, h('button', { class: 'btn small', text: 'Connect', onclick: () => { if (input.value.trim()) Net.setAddress(input.value.trim()); } })));
    }

    function consoleList() {
      const st = S.status;
      const parts = [];
      if (st.state === 'failed' && st.error) parts.push(h('div', { class: 'err', text: st.error }));
      const list = h('div', { class: 'console-list' });
      for (const c of S.consoles) {
        list.append(h('button', { class: 'console-item', onclick: () => join(c.ip) },
          h('span', { class: `dot${c.awake === false ? ' sleep' : ''}` }),
          h('span', { style: { flex: '1' } }, c.name || 'PlayStation', h('small', { text: `${c.ip}${c.awake === false ? ' · asleep' : ''}` })),
          h('span', { text: 'Join ›' })));
      }
      if (!S.consoles.length) {
        parts.push(h('div', { class: 'row', style: { justifyContent: 'center', gap: '14px' } },
          h('div', { class: 'spinner' }),
          h('div', { style: { fontWeight: '700' }, text: 'Looking for your PlayStation…' })));
        parts.push(h('p', { class: 'sub', text: 'Open Knowledge is Power on the TV and wait for the join screen.' }));
      } else {
        parts.push(h('b', { text: 'Tap your PlayStation to join' }));
        parts.push(list);
      }
      const ipInput = h('input', { class: 'input small', placeholder: 'Console IP, e.g. 192.168.1.50', value: manualIp, inputmode: 'decimal', autocomplete: 'off' });
      parts.push(h('details', { class: 'details' },
        h('summary', { text: 'Console not listed?' }),
        h('div', { class: 'row', style: { marginTop: '8px' } }, ipInput,
          h('button', {
            class: 'btn small',
            text: 'Join',
            onclick: () => {
              const ip = ipInput.value.trim();
              if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) { toast('Enter the IP address shown in the PS4 network settings'); return; }
              manualIp = ip;
              store.set('manualIp', ip);
              join(ip);
            },
          })),
        h('button', { class: 'btn ghost small', style: { marginTop: '10px', width: '100%' }, text: 'Search again', onclick: () => Net.raw({ op: 'discover' }) })));
      const w = S.welcome;
      if (w && !w.multiPlayer && w.playersConnected >= 1) {
        parts.push(h('p', { class: 'sub', text: 'This relay can host one phone only. Start kip-relay as administrator to let more people join.' }));
      }
      return h('div', { class: 'card col', style: { width: '100%' } }, parts);
    }

    function joiningCard() {
      const st = S.status.state;
      return h('div', { class: 'card col', style: { width: '100%', alignItems: 'center' } },
        h('div', { class: 'spinner' }),
        h('b', { text: st === 'connected' ? 'Joined! Waiting for the TV…' : 'Joining the game on the TV…' }),
        h('p', { class: 'sub', text: st === 'connected' ? 'The TV will ask for your name in a moment.' : 'This takes a few seconds.' }),
        h('button', { class: 'btn ghost small', text: 'Cancel', onclick: leave }));
    }

    function shareCard() {
      const url = S.welcome && S.welcome.shareUrl;
      if (!url) return null;
      return h('div', { class: 'card share' },
        h('div', { class: 'qr' }, qrSvg(url)),
        h('div', { class: 'col', style: { gap: '8px', minWidth: '0' } },
          h('b', { text: 'Friends scan this to join' }),
          h('div', { class: 'share-text', text: url }),
          h('button', { class: 'btn small', text: navigator.share ? 'Share link' : 'Copy link', onclick: () => shareLink(url) })));
    }

    function render() {
      const st = S.status.state;
      let main;
      if (S.noRelay) main = relayCard();
      else if (!S.linkUp && !S.welcome) {
        main = h('div', { class: 'card col', style: { width: '100%', alignItems: 'center' } },
          h('div', { class: 'spinner' }), h('b', { text: 'Connecting to the relay…' }),
          h('details', { class: 'details' }, h('summary', { text: 'Change relay address' }), relayCard()));
      } else if (st === 'connecting' || st === 'connected') main = joiningCard();
      else main = consoleList();
      body.replaceChildren(...header(), main, shareCard());
    }

    App.listen(scope, (what) => { if (what === 'relay' || what === 'status') render(); });
    scope.interval(() => {
      if (S.linkUp && !S.consoles.length && S.status.state !== 'connecting') Net.raw({ op: 'discover' });
    }, 4000);
    render();
    return { el };
  },
};

function qrSvg(text) {
  const { size, modules } = qrEncode(text);
  let d = '';
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (modules[y][x]) d += `M${x + 4},${y + 4}h1v1h-1z`;
  return s('svg', { viewBox: `0 0 ${size + 8} ${size + 8}`, 'shape-rendering': 'crispEdges' },
    s('rect', { width: size + 8, height: size + 8, fill: '#fff' }), s('path', { d, fill: '#000' }));
}

function shareLink(url) {
  if (navigator.share) {
    navigator.share({ title: 'Knowledge is Power', text: 'Join the quiz on the TV with your phone:', url }).catch(() => {});
    return;
  }
  const done = () => toast('Link copied');
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(url).then(done, () => {});
    return;
  }
  const ta = h('textarea', { value: url, style: { position: 'fixed', opacity: '0' } });
  document.body.append(ta);
  ta.select();
  try { document.execCommand('copy'); done(); } catch { toast(url, 5000); }
  ta.remove();
}

// ---------------------------------------------------------------- name entry
Screens.name = {
  local: true,
  mount() {
    const input = h('input', { class: 'input', value: S.name || '', placeholder: 'Enter your name', maxLength: 16, autocomplete: 'nickname', enterKeyHint: 'next' });
    const err = h('div', { class: 'err hidden' });
    const next = () => {
      const v = input.value.trim();
      if (!v) { err.textContent = 'Please enter your name'; err.classList.remove('hidden'); Sound.play('wrong'); return; }
      if (v.length < 2) { err.textContent = 'Name must be at least 2 characters'; err.classList.remove('hidden'); Sound.play('wrong'); return; }
      Sound.unlock();
      Sound.play('select');
      S.name = v;
      store.set('name', v);
      input.blur();
      App.show('photo');
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') next(); });
    const el = h('div', { class: 'lobby' },
      h('div', { class: 'lobby-inner' },
        h('div', { class: 'card col', style: { width: 'min(100%, 420px)' } },
          h('h1', { class: 'title', text: "What's your name?" }),
          input, err,
          h('button', { class: 'btn primary', text: 'Continue', onclick: next }))));
    return { el, ready: () => { if (!S.name) input.focus(); } };
  },
};

// ---------------------------------------------------------------- photo and avatar
const avatarLabel = (id) => String(id).split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
const avatarIcon = (id, cls) => icon(`avatar_${String(id).toLowerCase()}`, cls) || h('div', { class: cls, style: { fontSize: '28px', fontWeight: '900' }, text: String(id).charAt(0) });

function requestAvatar(id) {
  const previous = S.pendingAvatar || S.selectedAvatar;
  if (previous && previous !== id) {
    App.send({ TypeString: `${KIP}ClientRequestAvatarMessage`, RequestID: uuid(), AvatarID: previous, Request: false });
  }
  App.send({ TypeString: `${KIP}ClientRequestAvatarMessage`, RequestID: uuid(), AvatarID: id, Request: true });
  App.emit('avatars');
}

Screens.photo = {
  local: true,
  mount(ctx) {
    const { scope } = ctx;
    const canvas = hiCanvas();
    const empty = h('div', { class: 'ph-empty' }, h('div', { class: 'cam', text: '📷' }), h('div', { text: 'Tap to take a selfie' }));
    const mask = s('svg', { class: 'mask', viewBox: '0 0 100 100', preserveAspectRatio: 'none' });
    const box = h('div', { class: 'photo-box' }, canvas, mask, empty);
    const file = h('input', { type: 'file', accept: 'image/*', capture: 'user', class: 'hidden' });
    const grid = h('div', { class: 'avatar-grid' });
    const err = h('div', { class: 'err hidden' });
    const crop = S.photo && S.photo.crop ? S.photo.crop : { img: null, zoom: 1, cx: 0, cy: 0 };

    const takePhoto = () => { Sound.unlock(); file.click(); };
    file.addEventListener('change', () => {
      const f = file.files && file.files[0];
      if (!f) return;
      const url = URL.createObjectURL(f);
      const img = new Image();
      img.onload = () => {
        crop.img = img;
        crop.zoom = 1;
        crop.cx = img.naturalWidth / 2;
        crop.cy = img.naturalHeight * 0.45;
        S.photo = { crop, stub: false };
        draw();
        Sound.play('snap');
      };
      img.onerror = () => toast('Could not open that photo, try again');
      img.src = url;
      file.value = '';
    });

    function scaleFor(B) {
      const img = crop.img;
      return (B / Math.min(img.naturalWidth, img.naturalHeight)) * crop.zoom;
    }
    function clampCrop(B) {
      const img = crop.img;
      const sc = scaleFor(B);
      const half = B / 2 / sc;
      crop.cx = clamp(crop.cx, half, img.naturalWidth - half);
      crop.cy = clamp(crop.cy, half, img.naturalHeight - half);
    }
    function paint(ctx2, B) {
      const img = crop.img;
      clampCrop(B);
      const sc = scaleFor(B);
      ctx2.fillStyle = '#000';
      ctx2.fillRect(0, 0, B, B);
      ctx2.drawImage(img, B / 2 - crop.cx * sc, B / 2 - crop.cy * sc, img.naturalWidth * sc, img.naturalHeight * sc);
    }
    function draw() {
      empty.classList.toggle('hidden', !!crop.img || !!(S.photo && S.photo.stub));
      if (S.photo && S.photo.stub && !crop.img) {
        if (!canvas.fit()) return;
        const img = new Image();
        img.onload = () => { if (canvas.fit()) canvas.ctx.drawImage(img, 0, 0, canvas.cw, canvas.ch); };
        img.src = `data:image/jpeg;base64,${AVATAR_STUB_JPEG}`;
        return;
      }
      if (!crop.img || !canvas.fit()) return;
      paint(canvas.ctx, canvas.cw);
    }
    function exportJpeg() {
      if (!crop.img) return AVATAR_STUB_JPEG;
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 512;
      const B = canvas.cw || 300;
      const cx = c.getContext('2d');
      cx.scale(512 / B, 512 / B);
      paint(cx, B);
      return c.toDataURL('image/jpeg', 0.85).split(',')[1];
    }

    // Face guide: the console puts the costume around the face, so keep the face in the oval.
    function drawMask() {
      mask.replaceChildren(
        s('path', { d: 'M0,0H100V100H0Z M50,10 a31,38 0 1,0 0.01,0 Z', 'fill-rule': 'evenodd', fill: 'rgba(0,0,0,0.42)' }),
        s('ellipse', { cx: 50, cy: 48, rx: 31, ry: 38, fill: 'none', stroke: '#F0EAD6', 'stroke-width': 1.2, 'stroke-dasharray': '3 2.4', opacity: 0.9 }));
    }

    // Pan with one finger, zoom with two (or the mouse wheel).
    const pointers = new Map();
    let pinch = null;
    scope.on(box, 'click', () => { if (!crop.img) takePhoto(); });
    scope.on(box, 'pointerdown', (e) => {
      if (!crop.img) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { box.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: crop.zoom };
      }
    });
    scope.on(box, 'pointermove', (e) => {
      const p = pointers.get(e.pointerId);
      if (!p || !crop.img) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (pointers.size === 2 && pinch) {
        const [a, b] = [...pointers.values()];
        crop.zoom = clamp(pinch.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d), 1, 4);
      } else if (pointers.size === 1) {
        const sc = scaleFor(canvas.cw);
        crop.cx -= dx / sc;
        crop.cy -= dy / sc;
      }
      draw();
    });
    const up = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
    };
    scope.on(box, 'pointerup', up);
    scope.on(box, 'pointercancel', up);
    scope.on(box, 'wheel', (e) => {
      if (!crop.img) return;
      e.preventDefault();
      crop.zoom = clamp(crop.zoom * (e.deltaY < 0 ? 1.08 : 0.93), 1, 4);
      draw();
    }, { passive: false });

    function renderAvatars() {
      grid.replaceChildren();
      if (!S.avatars.length) {
        grid.append(h('div', { class: 'row', style: { gridColumn: '1 / -1', gap: '10px' } }, h('div', { class: 'spinner' }), h('span', { text: 'Waiting for avatars…' })));
        return;
      }
      for (const a of S.avatars) {
        const mine = a.AvatarID === S.selectedAvatar && S.avatarConfirmed;
        const pending = a.AvatarID === S.pendingAvatar;
        const taken = !a.Available && !mine && !pending;
        const status = mine ? 'Selected' : pending ? 'Asking' : taken ? 'Taken' : 'Available';
        grid.append(h('button', {
          class: `avatar${mine ? ' sel' : ''}${taken ? ' taken' : ''}${pending ? ' pending' : ''}`,
          onclick: () => {
            Sound.unlock();
            if (taken) { toast('Another player has that avatar'); Sound.play('wrong'); return; }
            if (mine || pending) return;
            Sound.play('tap');
            requestAvatar(a.AvatarID);
          },
        }, avatarIcon(a.AvatarID), h('span', { text: avatarLabel(a.AvatarID) }), h('span', { class: 'st', text: status })));
      }
    }

    const submit = () => {
      const hasPhoto = !!crop.img || !!(S.photo && S.photo.stub);
      if (!hasPhoto) { err.textContent = 'Take a photo first'; err.classList.remove('hidden'); Sound.play('wrong'); return; }
      if (!S.avatarConfirmed || !S.selectedAvatar) { err.textContent = 'Pick an avatar first'; err.classList.remove('hidden'); Sound.play('wrong'); return; }
      Sound.play('select');
      const jpeg = exportJpeg();
      const guid = uuid();
      S.photo = { ...(S.photo || {}), crop, guid, url: `data:image/jpeg;base64,${jpeg}` };
      Net.image(guid, 2, jpeg);
      App.send({
        TypeString: 'ClientPlayerProfileMessage',
        playerName: S.name,
        uppercasePlayerName: S.name.toUpperCase(),
        deviceCultureName: 'en-US',
        playerCardId: S.selectedAvatar,
      });
      Net.image(guid, 3, jpeg);
      App.show('waiting');
    };

    const el = h('div', { class: 'lobby' },
      h('div', { class: 'lobby-inner', style: { maxWidth: '980px' } },
        h('div', { class: 'photo-layout' },
          h('div', { class: 'col', style: { alignItems: 'center' } },
            box,
            h('div', { class: 'row' },
              h('button', { class: 'btn small', text: 'Take photo', onclick: takePhoto }),
              h('button', {
                class: 'btn ghost small',
                text: 'No photo',
                onclick: () => { crop.img = null; S.photo = { crop, stub: true }; draw(); },
              })),
            h('div', { class: 'sub', style: { fontSize: '13px' }, text: 'Drag to move, pinch to zoom. Keep your face in the oval.' })),
          h('div', { class: 'col', style: { flex: '1', minWidth: '0' } },
            h('h1', { class: 'title', style: { textAlign: 'left', fontSize: '24px' }, text: `Hi ${S.name}! Pick your avatar` }),
            grid, err,
            h('button', { class: 'btn primary', text: 'Continue', onclick: submit })))),
      file);

    App.listen(scope, (what) => {
      if (what === 'avatars') {
        renderAvatars();
        if (S.avatarConfirmed) err.classList.add('hidden');
      }
    });
    scope.resize(box, draw);
    drawMask();
    renderAvatars();
    if (S.selectedAvatar && !S.avatarConfirmed && !S.pendingAvatar) {
      const a = S.avatars.find((x) => x.AvatarID === S.selectedAvatar);
      if (a && a.Available) requestAvatar(a.AvatarID);
    }
    return { el, ready: draw };
  },
};

// ---------------------------------------------------------------- waiting room
function startButton(scope, onDone) {
  const lights = [];
  const svg = s('svg', { viewBox: '0 0 300 300' });
  svg.append(s('circle', { cx: 150, cy: 150, r: 148, fill: '#1E1E1E' }));
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
    const c = s('circle', { cx: 150 + Math.cos(a) * 122, cy: 150 + Math.sin(a) * 122, r: 8, fill: '#333333' });
    lights.push(c);
    svg.append(c);
  }
  const circ = 2 * Math.PI * 138;
  const arc = s('circle', {
    cx: 150, cy: 150, r: 138, fill: 'none', stroke: '#FFEB3B', 'stroke-width': 12, 'stroke-linecap': 'round',
    'stroke-dasharray': `0 ${circ}`, transform: 'rotate(-90 150 150)',
  });
  svg.append(arc);
  const inner = s('circle', { cx: 150, cy: 150, r: 98, fill: '#4CAF50' });
  svg.append(inner, s('text', {
    x: 150, y: 162, 'text-anchor': 'middle', fill: '#fff', 'font-size': 38, 'font-weight': 900, style: 'font-family: inherit', text: 'START',
  }));
  const el = h('div', { class: 'start-btn' }, svg);

  let p = 0;
  let holding = false;
  let releaseFrom = 0;
  let lit = 0;
  let done = false;
  scope.loop((dt) => {
    if (done) return false;
    if (holding) p = Math.min(1, p + dt / 2000);
    else if (p > 0) p = Math.max(0, p - (releaseFrom * dt) / 200);
    const n = Math.floor(p * 16 + 1e-6);
    if (n > lit && holding) { Sound.play('light'); Sound.vibrate(8); }
    lit = n;
    lights.forEach((c, i) => c.setAttribute('fill', i < n ? '#FFEB3B' : '#333333'));
    arc.setAttribute('stroke-dasharray', `${p * circ} ${circ}`);
    inner.setAttribute('fill', holding ? '#43A047' : '#4CAF50');
    if (p >= 1) {
      done = true;
      Sound.play('go');
      Sound.vibrate([30, 40, 60]);
      onDone();
      return false;
    }
    return true;
  });
  const down = (e) => { e.preventDefault(); Sound.unlock(); holding = true; try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ } };
  const up = () => { if (holding) { holding = false; releaseFrom = p; } };
  scope.on(el, 'pointerdown', down);
  scope.on(el, 'pointerup', up);
  scope.on(el, 'pointercancel', up);
  scope.on(el, 'contextmenu', (e) => e.preventDefault());
  return el;
}

Screens.waiting = {
  local: true,
  mount(ctx) {
    const { scope } = ctx;
    const body = h('div', { class: 'lobby-inner' });
    const el = h('div', { class: 'lobby' }, body);
    let started = S.started || !!ctx.sent('StartGameButtonPressedResponseMessage');

    function me() {
      const photo = S.photo && S.photo.url ? h('img', { src: S.photo.url, style: { width: '64px', height: '64px', borderRadius: '50%', objectFit: 'cover' } }) : null;
      return h('div', { class: 'row', style: { gap: '14px' } }, photo,
        S.selectedAvatar ? avatarIcon(S.selectedAvatar) : null,
        h('b', { style: { fontSize: '22px' }, text: S.name }));
    }
    function render() {
      if (started) {
        body.replaceChildren(me(), h('h1', { class: 'title', text: 'Get Ready!' }), h('p', { class: 'sub', text: 'Game starting soon…' }));
        return;
      }
      if (S.ready) {
        body.replaceChildren(
          h('h1', { class: 'title', text: 'Hold to Start!' }),
          startButton(scope, () => {
            started = true;
            App.send({ TypeString: 'StartGameButtonPressedResponseMessage', Response: 9 });
            render();
          }),
          h('div', { class: 'hint', text: 'Press and hold until the lights fill up' }));
        return;
      }
      body.replaceChildren(me(), h('div', { class: 'spinner' }), h('h1', { class: 'title', style: { fontSize: '22px' }, text: 'Waiting for players to join…' }),
        h('p', { class: 'sub', text: 'Look at the TV. When everyone is in, one player holds Start.' }));
    }
    render();
    return {
      el,
      onMsg(m, type) {
        if (type === 'ClientQuizCommandMessage' && m.action === QUIZ.READY) {
          render();
          return true;
        }
        return false;
      },
    };
  },
};

// ---------------------------------------------------------------- holding screen (retro TV)
function holdingColours() {
  const c = S.colours;
  const bg = c && !isBlackTint(c.BackgroundTint) ? tintHex(c.BackgroundTint) : '#C4B8A8';
  const sec = c && !isBlackTint(c.SecondaryTint) ? tintHex(c.SecondaryTint) : '#D4C8B8';
  const fill = c && !isBlackTint(c.PrimaryTint) ? rgba(tintHex(c.PrimaryTint), c.PrimaryTint.a ?? 1) : 'transparent';
  return { bg, sec, fill };
}

function holdingText(m, stale) {
  if (stale || !m) return 'Look at the TV';
  const t = String(m.HoldingScreenText || '').replace(/\\n/g, '\n').trim();
  if (t) return t;
  return m.HoldingScreenType === 9 ? 'Get Ready!' : 'Look at the TV';
}

function scallopPath(x0, y0, x1, y1, step) {
  const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
  let d = `M${x0},${y0}`;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.round(len / step));
    const r = (len / n) * 0.62;
    for (let k = 1; k <= n; k++) d += `A${r},${r} 0 0 1 ${(ax + ((bx - ax) * k) / n).toFixed(2)},${(ay + ((by - ay) * k) / n).toFixed(2)}`;
  }
  return `${d}Z`;
}

function retroTv() {
  const frame = s('path', { d: scallopPath(3, 3, 67, 47, 4.4), fill: 'transparent', stroke: '#F0EAD6', 'stroke-width': 1.6, 'stroke-linejoin': 'round' });
  const svg = s('svg', { viewBox: '0 0 70 50', style: 'position:absolute;inset:0;width:100%;height:100%;overflow:visible' },
    s('path', { d: 'M35,3 L23,-13 M35,3 L48,-12', stroke: '#F0EAD6', 'stroke-width': 1.4, 'stroke-linecap': 'round', fill: 'none' }),
    s('circle', { cx: 23, cy: -13, r: 1.8, fill: '#F0EAD6' }),
    s('circle', { cx: 48, cy: -12, r: 1.8, fill: '#F0EAD6' }),
    s('path', { d: 'M28,3 A7,5 0 0 1 42,3', fill: '#F0EAD6' }),
    s('path', { d: 'M16,47 L12,55 M54,47 L58,55', stroke: '#F0EAD6', 'stroke-width': 1.6, 'stroke-linecap': 'round' }),
    frame,
    s('rect', { x: 7.5, y: 7.5, width: 55, height: 35, rx: 5, fill: 'none', stroke: '#F0EAD6', 'stroke-width': 0.7, opacity: 0.55 }));
  const text = h('div', {
    style: {
      position: 'absolute', left: '7.5%', right: '7.5%', top: '12%', bottom: '12%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      textAlign: 'center', color: '#F0EAD6', fontWeight: '900', lineHeight: '1.1', whiteSpace: 'pre-line', textShadow: '1px 1px 2px rgba(0,0,0,.5)', overflow: 'hidden',
    },
  });
  const box = h('div', { style: { position: 'absolute', left: '50%', top: '50%' } }, svg, text);
  const el = h('div', { class: 'layer' }, box);
  let size = 0;
  el.layout = () => {
    const W = el.clientWidth;
    const H = el.clientHeight;
    // The original used 0.6 × the short side, which leaves the TV tiny on a landscape phone.
    size = Math.min(0.6 * W, 0.9 * H);
    Object.assign(box.style, {
      width: `${0.7 * size}px`, height: `${0.5 * size}px`,
      transform: `translate(-50%, -50%) translateY(${0.1 * size}px) rotate(-10deg) scaleX(1.2)`,
    });
    text.style.fontSize = `${0.1 * size}px`;
    fitText(text, 0.1 * size, 8);
  };
  el.setText = (t) => { text.textContent = t; if (size) fitText(text, 0.1 * size, 8); };
  el.setFill = (f) => frame.setAttribute('fill', f);
  return el;
}

Screens.holding = {
  game: true,
  mount(ctx) {
    const { scope } = ctx;
    const c = holdingColours();
    const bg = sunburst(c.bg, c.sec);
    const tv = retroTv();
    const el = h('div', {}, bg, tv);
    const msg = ctx.msg && shortType(ctx.msg.TypeString) === 'ClientHoldingScreenCommandMessage' ? ctx.msg : S.holding;
    const apply = () => {
      const col = holdingColours();
      bg.setColors(col.bg, col.sec);
      tv.setFill(col.fill);
    };
    tv.setText(holdingText(msg, ctx.stale));
    apply();
    scope.resize(el, () => tv.layout());
    return {
      el,
      ready: () => tv.layout(),
      onMsg(m, type) {
        if (type === 'ClientHoldingScreenCommandMessage') {
          tv.setText(holdingText(m));
          return true;
        }
        if (type === 'ServerColourMessage') {
          apply();
          return true;
        }
        return false;
      },
    };
  },
};

// ---------------------------------------------------------------- continue
Screens.continue = {
  game: true,
  mount(ctx) {
    const c = holdingColours();
    const btn = h('button', { class: 'btn', style: { fontSize: '30px', padding: '22px 56px' }, text: 'CONTINUE' });
    const press = () => {
      if (btn.disabled) return;
      btn.disabled = true;
      Sound.play('select');
      App.send({ TypeString: 'ContinuePressedResponseMessage', Response: 3 });
    };
    btn.addEventListener('click', press);
    if (ctx.sent('ContinuePressedResponseMessage')) btn.disabled = true;
    const el = h('div', {}, sunburst(c.bg, c.sec), h('div', { class: 'layer center' }, btn));
    return { el };
  },
};

// ---------------------------------------------------------------- end of game fact
Screens.endfact = {
  game: true,
  mount(ctx) {
    const n = Math.abs((ctx.msg && ctx.msg.FactNumber) || 0) % FACTOIDS.length;
    let canContinue = !!ctx.got('ClientQuizCommandMessage', (m) => m.action === QUIZ.RESET_TO_NAME);
    let opened = false;
    const scroll = h('div', { class: 'scroll' },
      h('div', { class: 'rod' }),
      h('div', { class: 'paper', text: FACTOIDS[n] }),
      h('div', { class: 'rod' }),
      h('div', { class: 'seal', text: '?' }));
    const hint = h('div', { class: 'hint', text: 'Tap the scroll to open your reward' });
    const cont = h('button', { class: 'btn primary hidden', text: 'Continue', onclick: () => { Sound.play('select'); App.show('name'); } });
    const update = () => {
      cont.classList.toggle('hidden', !(opened && canContinue));
      hint.classList.toggle('hidden', opened);
    };
    scroll.addEventListener('click', () => {
      if (opened) return;
      opened = true;
      scroll.classList.add('open');
      Sound.play('scroll');
      update();
    });
    const el = h('div', {}, sunburst('#2196F3', '#1976D2'),
      h('div', { class: 'layer center', style: { gap: '18px', padding: '16px' } },
        h('h1', { class: 'title', text: 'Did you know?' }), scroll, hint, cont));
    update();
    return {
      el,
      onMsg(m, type) {
        if (type === 'ClientQuizCommandMessage' && m.action === QUIZ.RESET_TO_NAME) {
          canContinue = true;
          update();
          return true;
        }
        return false;
      },
    };
  },
};
