const PP_INFO = {
  4: ['FREEZE', '#4FC3F7', 'powerplay_freeze', 'Encase answers in ice'],
  5: ['BOMBS', '#FFD600', 'powerplay_bombles', 'Throw bombs over answers'],
  6: ['MUNCHERS', '#FF7043', 'powerplay_nibblers', 'Munch away at answers'],
  7: ['GLOOP', '#66BB6A', 'powerplay_gloop', 'Cover answers in gloop'],
  10: ['DOUBLE TROUBLE', '#59B89A', 'powerplay_dt_freeze_gloop', 'Freeze and gloop'],
  11: ['DOUBLE TROUBLE', '#A8C44B', 'powerplay_dt_freeze_bombles', 'Freeze and bombs'],
  12: ['DOUBLE TROUBLE', '#D48A30', 'powerplay_dt_nibblers_gloop', 'Munchers and gloop'],
  20: ['LOCKDOWN', '#78909C', 'powerplay_lockdown', 'Lock the answers in place'],
  22: ['ZIPPERS', '#CE93D8', 'powerplay_zippers', 'Zip up the answers'],
  24: ['BUG', '#8D6E63', 'powerplay_bug', 'Bugs crawl over the answers'],
  25: ['POINTS DOUBLER', '#FFD700', 'powerplay_points_doubler', 'You get ×2 prize points'],
  26: ['50/50', '#26C6DA', 'powerplay_fifty_fifty', 'Remove half the answers'],
  28: ['LETTER SCATTER', '#FFA726', 'powerplay_letter_scatter', 'Scatter the letters'],
  29: ['DISCO INFERNO', '#EC407A', 'powerplay_disco', 'Disco lights dazzle the screen'],
  8: ['POINTS PARTY', '#E91E63', 'powerplay_points_party', 'Winners get double winnings'],
  1: ['POWER PLAY #1', '#AB47BC', null, 'A bet on who gets it right'],
};
const PP_DECOYS = [4, 5, 6, 7, 11, 20, 22, 24, 28, 29];
const PP_REEL = [80, 80, 80, 80, 80, 80, 120, 160, 220, 300, 400];

function ppInfo(type) {
  const i = PP_INFO[type];
  if (i) return { name: i[0], colour: i[1], icon: i[2], desc: i[3] };
  return { name: `POWER PLAY #${type}`, colour: '#AB47BC', icon: null, desc: 'A mystery power play' };
}

function ppType(pp) {
  if (pp.PowerType != null && pp.PowerType !== -1) return pp.PowerType;
  const t = (pp.PowerTypes || []).filter((x) => x !== -1);
  if (t.length === 2) {
    const k = t.slice().sort((a, b) => a - b).join(',');
    if (k === '4,7') return 10;
    if (k === '4,5') return 11;
    if (k === '6,7') return 12;
  }
  return t.length ? t[0] : -1;
}

function ppIcon(info) {
  const ic = info.icon ? icon(info.icon) : null;
  return ic || h('div', { style: { fontSize: '54px', fontWeight: '900', color: '#fff', textShadow: 'var(--shadow)' }, text: '?' });
}

Screens.powerplay = {
  game: true,
  mount(ctx) {
    const { scope } = ctx;
    const msg = ctx.msg;
    const plays = (msg.PowerPlays || []).filter((pp) => ppType(pp) !== -1);
    const players = msg.PowerPlayPlayers || [];
    let selected = null;
    let committed = !!ctx.sent('ClientPowerPlayChoice');
    let targeting = false;
    let pending = 0;

    const title = h('div', { class: 'pp-title', text: 'PICK A POWER PLAY' });
    const strip = h('div', { class: 'pp-strip' });
    const label = h('div', { class: 'pp-label hidden' });
    const desc = h('div', { class: 'pp-desc-main' });
    const targets = h('div', { class: 'pp-targets hidden' });
    const back = h('div', { class: 'pp-back hidden' });
    const el = h('div', {}, sunburst('#E8A040', '#D08830'),
      h('div', { class: 'layer center', style: { justifyContent: 'flex-start' } }, title, strip, label, desc, targets),
      back);

    const setTitle = (text) => {
      title.style.opacity = '0';
      scope.timeout(() => { title.textContent = text; title.style.opacity = '1'; }, 200);
    };

    function card(pp, animate) {
      const type = ppType(pp);
      const info = ppInfo(type);
      const iconBox = h('div', { class: 'pp-icon', style: { background: info.colour } }, ppIcon(info));
      const name = h('div', { class: 'pp-name', text: info.name });
      const d = h('div', { class: 'pp-desc', text: info.desc });
      const el2 = h('button', { class: 'pp-card' }, iconBox, h('div', { class: 'pp-name-wrap' }, name), d);
      el2.addEventListener('click', (e) => {
        e.stopPropagation();
        if (committed) return;
        if (targeting) { stepBack(); return; }
        if (!selected) select(pp);
      });
      if (animate) reel(type, iconBox, name, d);
      return el2;
    }

    // Slot-machine reveal for power plays that are new this round.
    function reel(real, iconBox, name, d) {
      const others = shuffle(PP_DECOYS.filter((t) => t !== real));
      const types = PP_REEL.map((_, i) => others[i % others.length]).concat([real]);
      const show = (t) => {
        const info = ppInfo(t);
        iconBox.style.background = info.colour;
        iconBox.replaceChildren(ppIcon(info));
        return info;
      };
      name.textContent = show(types[0]).name;
      d.textContent = '';
      let at = 300;
      for (let i = 1; i < types.length; i++) {
        const t = types[i];
        const last = i === types.length - 1;
        const spin = i < PP_REEL.length ? PP_REEL[i] * 0.4 : 100;
        scope.timeout(() => {
          const info = show(t);
          Sound.play('tick');
          name.style.transition = `transform ${spin}ms, opacity ${spin}ms`;
          name.style.transform = 'translateY(32px)';
          name.style.opacity = '0';
          scope.timeout(() => {
            name.style.transition = 'none';
            name.style.transform = 'translateY(-32px)';
            name.textContent = info.name;
            void name.offsetWidth;
            name.style.transition = `transform ${spin}ms, opacity ${spin}ms`;
            name.style.transform = 'translateY(0)';
            name.style.opacity = '1';
            if (last) {
              scope.timeout(() => {
                Sound.play('reveal');
                d.textContent = info.desc;
                d.style.opacity = '0';
                d.style.transition = 'opacity 200ms';
                void d.offsetWidth;
                d.style.opacity = '1';
                name.style.transition = 'transform 120ms';
                name.style.transform = 'scale(1.3)';
                iconBox.style.transform = 'scale(1.2)';
                scope.timeout(() => { name.style.transform = 'scale(1)'; iconBox.style.transform = 'scale(1)'; }, 120);
              }, spin);
            }
          }, spin);
        }, at);
        at += i < PP_REEL.length ? PP_REEL[i] : 400;
      }
    }

    function picker(animate) {
      clearTimeout(pending);
      targeting = false;
      selected = null;
      title.textContent = 'PICK A POWER PLAY';
      title.style.opacity = '1';
      label.classList.add('hidden');
      desc.textContent = '';
      desc.classList.remove('hidden');
      targets.classList.add('hidden');
      targets.replaceChildren();
      back.classList.add('hidden');
      strip.classList.remove('peek');
      strip.style.transform = '';
      strip.style.opacity = '1';
      strip.replaceChildren(...plays.map((pp) => card(pp, animate && pp.New)));
    }

    function select(pp) {
      selected = pp;
      const info = ppInfo(ppType(pp));
      Sound.play('select');
      label.textContent = info.name;
      label.classList.remove('hidden');
      desc.textContent = info.desc;
      setTitle(pp.TargetCount > 1 ? info.name : 'CHOOSE A TARGET');
      strip.style.transition = 'transform 300ms, opacity 300ms';
      strip.style.transform = 'scale(0.8)';
      strip.style.opacity = '0.4';
      pending = scope.timeout(() => {
        targeting = true;
        strip.style.transition = '';
        strip.style.transform = '';
        strip.classList.add('peek');
        label.classList.add('hidden');
        desc.classList.add('hidden');
        back.classList.remove('hidden');
        showTargets(pp);
      }, 300);
    }

    function stepBack() {
      if (!targeting || committed) return;
      Sound.play('tap');
      picker(false);
    }
    back.addEventListener('click', stepBack);
    strip.addEventListener('click', () => { if (targeting) stepBack(); });

    function targetCard(nameText, photoEl, onPick) {
      const spot = h('div', { class: 'pp-spot' });
      const ring = h('div', { class: 'pp-ring' });
      const photo = h('div', { class: 'pp-photo' }, photoEl);
      const c = h('button', { class: 'pp-target' }, h('div', { class: 'pp-photo-wrap' }, spot, ring, photo), h('div', { class: 'nm', text: nameText }));
      c.parts = { spot, ring, photo };
      c.addEventListener('click', (e) => { e.stopPropagation(); onPick(c); });
      return c;
    }

    function showTargets(pp) {
      targets.classList.remove('hidden');
      targets.style.opacity = '0';
      targets.style.transition = 'opacity 300ms';
      void targets.offsetWidth;
      targets.style.opacity = '1';
      targets.replaceChildren();
      const info = ppInfo(ppType(pp));
      if (pp.TargetCount > 1) {
        const ic = h('div', { style: { width: '100%', height: '100%', background: info.colour, display: 'flex', alignItems: 'center', justifyContent: 'center' } }, ppIcon(info));
        targets.append(targetCard('Everyone', ic, (c) => commit(pp, pp.PowerPlayTargets || [], c, true)));
        return;
      }
      const list = players.filter((p) => (pp.PowerPlayTargets || []).includes(p.SlotIndex));
      for (const p of list) {
        const url = S.images.get(p.ImageGUID);
        const ph = url ? h('img', { src: url, alt: '' }) : null;
        const c = targetCard(p.Name, ph, (cc) => commit(pp, [p.SlotIndex], cc, false));
        if (!url) c.parts.photo.style.background = 'rgba(255,255,255,0.5)';
        targets.append(c);
      }
    }

    function commit(pp, slots, c, everyone) {
      if (committed) return;
      committed = true;
      targeting = false;
      back.classList.add('hidden');
      sendPowerPlayChoice(pp.DisplayIndex, slots);
      Sound.play('power');
      Sound.vibrate([20, 30, 40]);
      lockedIn(c, everyone);
    }

    function lockedIn(c, everyone) {
      for (const other of targets.children) if (other !== c) other.style.opacity = '0.3';
      if (c) {
        c.parts.ring.classList.add('on');
        if (!everyone) {
          c.parts.spot.classList.add('on');
          c.parts.photo.style.transform = 'scale(1.05)';
        }
      }
      desc.textContent = '✓ Locked in!';
      desc.classList.remove('hidden');
    }

    const prior = ctx.sent('ClientPowerPlayChoice');
    if (prior && prior.PowerPlaySlotIndex >= 0) {
      const pp = plays.find((x) => x.DisplayIndex === prior.PowerPlaySlotIndex);
      picker(false);
      if (pp) {
        const info = ppInfo(ppType(pp));
        title.textContent = pp.TargetCount > 1 ? info.name : 'CHOOSE A TARGET';
        strip.classList.add('peek');
        showTargets(pp);
        const idx = pp.TargetCount > 1 ? 0 : players.filter((p) => (pp.PowerPlayTargets || []).includes(p.SlotIndex)).findIndex((p) => (prior.TargetSlotIndex || []).includes(p.SlotIndex));
        lockedIn(targets.children[idx] || null, pp.TargetCount > 1);
      }
    } else {
      picker(!ctx.restored);
      if (prior) {
        desc.textContent = "Time's up";
        strip.style.opacity = '0.4';
      }
    }

    if (!committed && ctx.got('ServerRequestPowerPlayChoice')) {
      committed = true;
      sendPowerPlayChoice(-1, []);
      desc.textContent = "Time's up";
    }

    return {
      el,
      onMsg(m, type) {
        if (type === 'ServerRequestPowerPlayChoice') {
          if (!committed) {
            committed = true;
            sendPowerPlayChoice(-1, []);
            back.classList.add('hidden');
          }
          return true;
        }
        return false;
      },
    };
  },
};
