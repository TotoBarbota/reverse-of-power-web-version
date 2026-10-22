// ---------------------------------------------------------------- shared state
const S = {
  welcome: null,
  consoles: [],
  linkUp: false,
  noRelay: false,
  status: { state: 'idle' },
  decades: false,
  sid: null,
  name: store.get('name', ''),
  avatars: [],
  selectedAvatar: null,
  pendingAvatar: null,
  pendingRequestId: null,
  avatarConfirmed: false,
  photo: null,
  profileSent: false,
  ready: false,
  started: false,
  holding: null,
  colours: null,
  images: new Map(),
  ppCommitted: false,
  overrideSent: false,
  categorySent: null,
  categoryRequestPending: false,
};

const QUIZ = { CONTINUE: 4, READY: 14, EXIT: 15, PAUSED: 29, UNPAUSED: 30, RESET_TO_NAME: 31 };
const KIP = 'KnowledgeIsPower.';

// Screens register here: Screens[name] = { game, local, mount(ctx) -> { el, onMsg?, ready? } }
const Screens = {};

const App = {
  cur: null,
  lastSeq: 0,
  replaying: false,
  replayBuf: [],
  listeners: new Set(),
  awaitStatusTimer: 0,

  // ---------------------------------------------------------------- screens
  show(name, ctx = {}) {
    const def = Screens[name];
    if (!def) {
      console.error('unknown screen', name);
      return;
    }
    if (this.cur) {
      this.cur.scope.dispose();
      this.cur.el.remove();
    }
    const scope = new Scope();
    const full = {
      msg: null, age: 0, after: [], seq: null, ...ctx, scope,
    };
    full.startedAt = performance.now() - full.age;
    full.sent = (type) => lastOf(full.after, (e) => e.dir === 'out' && shortType(e.m.TypeString) === type);
    full.got = (type, test) => lastOf(full.after, (e) => e.dir === 'in' && shortType(e.m.TypeString) === type && (!test || test(e.m)));
    full.remainingMs = (sec) => sec * 1000 - (performance.now() - full.startedAt);
    full.elapsedSec = () => (performance.now() - full.startedAt) / 1000;
    let inst;
    try {
      inst = def.mount(full);
    } catch (e) {
      console.error(`screen ${name} failed`, e);
      scope.dispose();
      if (name !== 'holding') this.show('holding', {});
      return;
    }
    inst.el.classList.add('screen', 'enter');
    document.getElementById('app').append(inst.el);
    document.body.classList.toggle('game', !!def.game);
    document.body.dataset.screen = name;
    this.cur = { name, def, inst, scope, ctx: full, el: inst.el };
    if (inst.ready) {
      try { inst.ready(); } catch (e) { console.error(e); }
    }
  },

  emit(what) {
    for (const fn of this.listeners) {
      try { fn(what); } catch (e) { console.error(e); }
    }
  },
  listen(scope, fn) {
    this.listeners.add(fn);
    scope.add(() => this.listeners.delete(fn));
  },

  send(m) {
    applyOut(m);
    Net.game(m);
  },

  // ---------------------------------------------------------------- relay events
  onRelay(ev) {
    switch (ev.op) {
      case 'norelay':
        S.noRelay = true;
        this.emit('relay');
        break;
      case 'open':
        S.linkUp = true;
        S.noRelay = false;
        Net.raw({
          op: 'hello', deviceUid: deviceUid(), name: S.name, model: deviceModel(), os: deviceOs(), factCount: FACTOIDS.length,
        });
        netbar(false);
        this.emit('relay');
        break;
      case 'closed':
        S.linkUp = false;
        if (S.status.state === 'connected' || S.status.state === 'connecting') netbar(true);
        this.emit('relay');
        break;
      case 'welcome':
        S.welcome = ev;
        S.consoles = ev.consoles || [];
        clearTimeout(this.awaitStatusTimer);
        this.awaitStatusTimer = setTimeout(() => this.noSession(), 600);
        this.emit('relay');
        break;
      case 'consoles':
        S.consoles = ev.consoles || [];
        this.emit('relay');
        break;
      case 'status':
        clearTimeout(this.awaitStatusTimer);
        this.onStatus(ev);
        break;
      case 'replayStart':
        this.replaying = true;
        this.replayBuf = [];
        break;
      case 'image':
        if (!S.images.has(ev.guid)) S.images.set(ev.guid, b64ToBlobUrl(ev.data));
        this.emit('image');
        break;
      case 'msg':
        if (this.replaying) this.replayBuf.push(ev);
        else this.onLive(ev);
        break;
      case 'replayEnd':
        this.replaying = false;
        this.restore(this.replayBuf);
        this.replayBuf = [];
        break;
      default:
        break;
    }
  },

  noSession() {
    const autojoin = store.get('autojoin');
    if (autojoin && S.consoles.some((c) => c.ip === autojoin)) {
      Net.raw({ op: 'connect', consoleIp: autojoin });
      return;
    }
    S.status = { state: 'idle' };
    if (!this.cur || this.cur.name !== 'connect') this.show('connect');
    this.emit('status');
  },

  onStatus(st) {
    const prevSid = S.sid;
    S.status = st;
    if (st.state === 'connected') {
      S.decades = !!st.decades;
      S.sid = st.sid || null;
      if (prevSid && st.sid && prevSid !== st.sid) this.lastSeq = 0;
      if (!st.replay) Net.setGameReady(true);
      netbar(false);
    } else {
      Net.setGameReady(false);
    }
    if (st.state === 'failed' || st.state === 'idle' || st.state === 'connecting') {
      if (st.state === 'failed') store.set('autojoin', null);
      if (st.state !== 'connecting') Net.clearQueue();
      if (st.state === 'connecting') resetSessionState();
      if (!this.cur || this.cur.name !== 'connect') this.show('connect');
    }
    this.emit('status');
  },

  onLive(ev) {
    if (ev.seq) this.lastSeq = Math.max(this.lastSeq, ev.seq);
    const type = shortType(ev.m.TypeString);
    if (ev.dir === 'out') {
      applyOut(ev.m);
      return;
    }
    applyIn(ev.m, type, true);
    this.dispatch(ev.m, type, { seq: ev.seq, age: 0 });
  },

  dispatch(m, type, meta) {
    const cur = this.cur;
    if (cur && cur.inst.onMsg) {
      try {
        if (cur.inst.onMsg(m, type, meta) === true) return;
      } catch (e) {
        console.error(e);
      }
    }
    const target = navTarget(m, type, cur ? cur.name : null);
    if (target) this.show(target, { msg: m, seq: meta.seq, age: meta.age || 0 });
  },

  // ---------------------------------------------------------------- reconnect restore
  // The relay replays the whole session. Work out which screen the phone should be on
  // and what it already did there, then either keep the current screen (and feed it
  // what it missed) or rebuild it in the right state.
  restore(buf) {
    resetSessionState();
    let nav = null;
    let virt = 'connect';
    for (const e of buf) {
      const type = shortType(e.m.TypeString);
      if (e.dir === 'in') {
        applyIn(e.m, type, false, virt);
        const target = navTarget(e.m, type, virt);
        if (target) {
          nav = { name: target, msg: e.m, age: e.age, seq: e.seq, after: [] };
          virt = target;
          continue;
        }
      } else {
        applyOut(e.m);
        if (type === 'ClientPlayerProfileMessage') {
          nav = { name: 'waiting', msg: null, age: e.age, seq: e.seq, after: [] };
          virt = 'waiting';
          continue;
        }
        if (type === 'ClientRequestAvatarMessage' && virt === 'name') {
          nav = { name: 'photo', msg: null, age: e.age, seq: e.seq, after: [] };
          virt = 'photo';
        }
      }
      if (nav) nav.after.push(e);
    }
    const maxSeq = buf.reduce((m, e) => Math.max(m, e.seq || 0), 0);
    const missed = buf.filter((e) => e.dir === 'in' && (e.seq || 0) > this.lastSeq);
    const cur = this.cur;
    const keep = nav && cur && cur.name === nav.name && (cur.ctx.seq === nav.seq || Screens[nav.name].local);
    // Answers given while the link was down are still queued; the rebuilt screen must see them.
    if (nav) for (const m of Net.pendingGame()) nav.after.push({ dir: 'out', m, age: 0 });

    Net.setGameReady(true);
    this.lastSeq = maxSeq;

    if (keep) {
      for (const e of missed) {
        if (this.cur !== cur) break;
        if (e.seq <= (cur.ctx.seq || 0)) continue;
        this.dispatch(e.m, shortType(e.m.TypeString), { seq: e.seq, age: e.age, late: true });
      }
      this.emit('status');
      return;
    }
    if (!nav) {
      if (!cur || cur.name !== 'connect') this.show('connect');
      this.emit('status');
      return;
    }
    const def = Screens[nav.name];
    if (def.duration && nav.msg) {
      const dur = def.duration(nav.msg);
      const answered = def.answerType && nav.after.some((e) => e.dir === 'out' && shortType(e.m.TypeString) === def.answerType);
      if (!answered && nav.age > dur * 1000 + 2000) {
        this.show('holding', { stale: true });
        return;
      }
    }
    this.show(nav.name, { msg: nav.msg, age: nav.age, seq: nav.seq, after: nav.after, restored: true });
    this.emit('status');
  },
};

function lastOf(arr, test) {
  for (let i = arr.length - 1; i >= 0; i--) if (test(arr[i])) return arr[i].m;
  return null;
}

function resetSessionState() {
  S.avatars = [];
  S.pendingAvatar = null;
  S.avatarConfirmed = false;
  S.profileSent = false;
  S.ready = false;
  S.started = false;
  S.holding = null;
  S.colours = null;
  S.ppCommitted = false;
  S.overrideSent = false;
  S.categorySent = null;
  S.categoryRequestPending = false;
}

// ---------------------------------------------------------------- routing rules
// Mirrors which messages each Android screen listened for. Name entry and the
// photo screen only react to a reset, like the original.
function navTarget(m, type, cur) {
  const lobbyInput = cur === 'name' || cur === 'photo';
  if (type === 'ClientQuizCommandMessage') {
    if (m.action === QUIZ.RESET_TO_NAME) return cur === 'endfact' || cur === 'name' ? null : 'name';
    if (m.action === QUIZ.CONTINUE && !lobbyInput) return 'continue';
    return null;
  }
  if (type === 'RejoiningClientOwnProfileMessage') return 'holding';
  if (lobbyInput) return null;
  switch (type) {
    case 'ClientHoldingScreenCommandMessage':
      return cur === 'continue' && m.HoldingScreenType === 5 ? null : 'holding';
    case 'ServerCategorySelectOverrideSuccess': return 'holding';
    case 'ServerCategorySelectChoices': return 'category';
    case 'ServerBeginCategorySelectOverride': return 'powerpick';
    case 'ServerBeginTriviaAnsweringPhase': return 'trivia';
    case 'ServerBeginPowerPlayPhase': return 'powerplay';
    case 'ServerBeginLinkingAnsweringPhase': return 'pairs';
    case 'ServerBeginOrderingAnsweringPhase': return 'chain';
    case 'ServerBeginSortingAnsweringPhase': return 'sorting';
    case 'ServerBeginEliminatingAnsweringPhase': return 'elimination';
    case 'ServerBeginMissingLetterAnsweringPhase': return 'missing';
    case 'ServerBeginMatchingAnsweringPhase': return 'matching';
    case 'ClientEndOfGameFactCommandMessage': return 'endfact';
    default: return null;
  }
}

// State every screen relies on, plus the replies the console must always get.
function applyIn(m, type, live, curName) {
  const cur = curName !== undefined ? curName : App.cur ? App.cur.name : null;
  switch (type) {
    case 'InterfaceVersionMessage':
      resetSessionState();
      break;
    case 'ServerAvatarStatusMessage': {
      const i = S.avatars.findIndex((a) => a.AvatarID === m.AvatarID);
      if (i >= 0) S.avatars[i] = { AvatarID: m.AvatarID, Available: m.Available };
      else if (m.Available) S.avatars.push({ AvatarID: m.AvatarID, Available: true });
      if (live) App.emit('avatars');
      break;
    }
    case 'ServerAvatarRequestResponseMessage':
      if (m.AvatarID === S.pendingAvatar) {
        if (m.Available) {
          S.selectedAvatar = m.AvatarID;
          S.avatarConfirmed = true;
        } else if (live) {
          toast('Someone else just took that avatar');
        }
        S.pendingAvatar = null;
      }
      if (live) App.emit('avatars');
      break;
    case 'RejoiningClientOwnProfileMessage':
      if (m.Name) S.name = m.Name;
      if (m.AvatarID) S.selectedAvatar = m.AvatarID;
      S.avatarConfirmed = true;
      S.profileSent = true;
      break;
    case 'ClientHoldingScreenCommandMessage':
      S.holding = m;
      break;
    case 'KnowledgeIsPower.ServerColourMessage':
    case 'ServerColourMessage':
      S.colours = m;
      break;
    case 'ClientQuizCommandMessage':
      if (m.action === QUIZ.READY) S.ready = true;
      if (m.action === QUIZ.RESET_TO_NAME) {
        S.ready = false;
        S.started = false;
        S.profileSent = false;
        S.avatarConfirmed = false;
      }
      if (live && m.action === QUIZ.PAUSED) toast('The game is paused on the TV');
      break;
    case 'ServerCategorySelectChoices':
      S.categorySent = null;
      S.categoryRequestPending = false;
      break;
    case 'ServerRequestCategorySelectChoice':
      if (cur !== 'category') S.categoryRequestPending = true;
      break;
    case 'ServerBeginCategorySelectOverride':
      S.overrideSent = false;
      break;
    case 'ServerStopCategorySelectOverride':
      if (live && cur !== 'powerpick') App.send({ TypeString: `${KIP}ClientStopCategorySelectOverrideResponse`, OverrideSent: S.overrideSent });
      break;
    case 'ServerBeginPowerPlayPhase':
      S.ppCommitted = false;
      break;
    case 'ServerRequestPowerPlayChoice':
      if (live && cur !== 'powerplay' && !S.ppCommitted) sendPowerPlayChoice(-1, []);
      break;
    default:
      break;
  }
}

function applyOut(m) {
  switch (shortType(m.TypeString)) {
    case 'ClientRequestAvatarMessage':
      if (m.Request) {
        S.pendingAvatar = m.AvatarID;
        S.pendingRequestId = m.RequestID;
        S.avatarConfirmed = false;
      } else if (S.selectedAvatar === m.AvatarID) {
        S.selectedAvatar = null;
      }
      break;
    case 'ClientPlayerProfileMessage':
      S.profileSent = true;
      break;
    case 'StartGameButtonPressedResponseMessage':
      S.started = true;
      break;
    case 'ClientPowerPlayChoice':
      S.ppCommitted = true;
      break;
    case 'ClientCategorySelectOverride':
      S.overrideSent = true;
      break;
    case 'ClientCategorySelectChoice':
      S.categorySent = m.ChosenCategoryIndex;
      break;
    default:
      break;
  }
}

function sendPowerPlayChoice(slot, targets) {
  App.send({ TypeString: `${KIP}ClientPowerPlayChoice`, PowerPlaySlotIndex: slot, TargetSlotIndex: targets });
}

// ---------------------------------------------------------------- device info
function deviceModel() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad|Macintosh.*Mobile/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  const m = ua.match(/Android [\d.]+; ([^;)]+)/);
  if (m && m[1] && m[1] !== 'K') return m[1].trim();
  if (/Android/.test(ua)) return 'Android phone';
  return 'Web phone';
}

function deviceOs() {
  const ua = navigator.userAgent;
  let m = ua.match(/OS (\d+)[_.](\d+)/);
  if (/iPhone|iPad/.test(ua) && m) return `iOS ${m[1]}.${m[2]}`;
  m = ua.match(/Android ([\d.]+)/);
  if (m) return `Android ${m[1]}`;
  return 'Web';
}

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const isAndroid = () => /Android/.test(navigator.userAgent);
const isStandalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;

// Landscape and full screen like the original app, where the browser allows it.
function goImmersive() {
  if (isIOS() || isStandalone()) return;
  const el = document.documentElement;
  if (document.fullscreenElement || !el.requestFullscreen) return;
  el.requestFullscreen({ navigationUI: 'hide' })
    .then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape'))
    .catch(() => {});
}

let wakeLock = null;
function keepAwake() {
  if (!navigator.wakeLock || wakeLock || document.hidden) return;
  navigator.wakeLock.request('screen').then((l) => {
    wakeLock = l;
    l.addEventListener('release', () => { wakeLock = null; });
  }).catch(() => {});
}
document.addEventListener('visibilitychange', keepAwake);

function netbar(show) {
  let el = document.querySelector('.netbar');
  if (!el) {
    el = h('div', { class: 'netbar' }, h('div', { class: 'spinner' }), h('span', { text: 'Reconnecting…' }));
    document.body.append(el);
  }
  el.classList.toggle('show', show);
}
