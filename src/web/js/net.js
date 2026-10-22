// WebSocket link to the relay. It reconnects by itself; the relay keeps the game
// connection to the console open while the phone is away and replays what was missed.
const Net = (() => {
  let ws = null;
  let open = false;
  let retry = 0;
  let retryTimer = 0;
  let lastPong = 0;
  let pingTimer = 0;
  const listeners = new Set();
  let queue = [];
  let gameReady = false;

  function relayAddress() {
    const q = new URLSearchParams(location.search).get('relay');
    if (q) {
      store.set('relay', q);
      return q;
    }
    if (/^https?:$/.test(location.protocol) && location.host) return location.host;
    return store.get('relay');
  }

  function wsUrl() {
    const addr = relayAddress();
    if (!addr) return null;
    const clean = String(addr).replace(/^(https?|wss?):\/\//, '').replace(/\/.*$/, '');
    const secure = location.protocol === 'https:' && clean === location.host;
    return `${secure ? 'wss' : 'ws'}://${clean}/ws`;
  }

  function emit(ev) {
    for (const fn of listeners) {
      try { fn(ev); } catch (e) { console.error(e); }
    }
  }

  function connect() {
    clearTimeout(retryTimer);
    const url = wsUrl();
    if (!url) {
      emit({ op: 'norelay' });
      return;
    }
    if (ws) drop();
    let sock;
    try {
      sock = new WebSocket(url);
    } catch (e) {
      emit({ op: 'neterror', error: String(e.message || e) });
      schedule();
      return;
    }
    ws = sock;
    sock.startedAt = Date.now();
    sock.onopen = () => {
      if (ws !== sock) return;
      open = true;
      retry = 0;
      lastPong = Date.now();
      emit({ op: 'open' });
    };
    sock.onmessage = (e) => {
      if (ws !== sock) return;
      lastPong = Date.now();
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.op === 'pong') return;
      emit(msg);
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      lost();
    };
    sock.onerror = () => {};
  }

  function drop() {
    const old = ws;
    ws = null;
    open = false;
    gameReady = false;
    if (old) {
      old.onopen = old.onmessage = old.onclose = old.onerror = null;
      try { old.close(); } catch { /* already closed */ }
    }
  }

  function lost() {
    const wasOpen = open;
    drop();
    emit({ op: 'closed', wasOpen });
    schedule();
  }

  function schedule() {
    clearTimeout(retryTimer);
    const delay = Math.min(5000, 500 * 2 ** Math.min(retry, 4));
    retry++;
    retryTimer = setTimeout(connect, document.hidden ? Math.max(delay, 3000) : delay);
  }

  function raw(obj) {
    if (!ws || !open) return false;
    try {
      ws.send(JSON.stringify(obj));
      return true;
    } catch {
      return false;
    }
  }

  // Game messages wait in a queue while the link is down and go out once the
  // relay has replayed the session, as long as they are not stale.
  function enqueue(item) {
    if (gameReady && raw(item)) return;
    queue.push({ item, at: Date.now() });
  }

  function flush() {
    const now = Date.now();
    const pending = queue;
    queue = [];
    for (const q of pending) {
      if (now - q.at > 15000) continue;
      if (!raw(q.item)) queue.push(q);
    }
  }

  function heartbeat() {
    clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (!ws) return;
      if (!open && Date.now() - ws.startedAt > 8000) {
        lost();
        return;
      }
      if (open && Date.now() - lastPong > 25000) {
        lost();
        return;
      }
      raw({ op: 'ping', t: Date.now() });
    }, 8000);
  }

  // Phones freeze pages in the background and the socket often dies silently.
  function wake() {
    if (document.hidden) return;
    if (ws && !open && Date.now() - ws.startedAt < 6000) return;
    if (!ws || !open) {
      retry = 0;
      connect();
      return;
    }
    const before = lastPong;
    raw({ op: 'ping', t: Date.now() });
    setTimeout(() => {
      if (ws && lastPong === before) lost();
    }, 2500);
  }

  document.addEventListener('visibilitychange', wake);
  window.addEventListener('pageshow', wake);
  window.addEventListener('online', wake);

  return {
    start() {
      heartbeat();
      connect();
    },
    reconnect() {
      retry = 0;
      connect();
    },
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get open() { return open; },
    get address() { return relayAddress(); },
    setAddress(addr) {
      store.set('relay', addr);
      retry = 0;
      connect();
    },
    raw,
    game(m) { enqueue({ op: 'send', m }); },
    image(guid, transferId, data) { enqueue({ op: 'image', guid, transferId, imgType: 2, data }); },
    setGameReady(ready) {
      gameReady = ready;
      if (ready) flush();
    },
    clearQueue() { queue = []; },
    pendingGame() {
      const now = Date.now();
      return queue.filter((q) => q.item.op === 'send' && now - q.at <= 15000).map((q) => q.item.m);
    },
  };
})();
