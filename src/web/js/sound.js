// Sound effects synthesised with WebAudio, so the page needs no audio files.
const Sound = (() => {
  let ac = null;
  let master = null;
  let noiseBuf = null;
  let muted = store.get('muted', false);

  function ensure() {
    if (ac) {
      if (ac.state === 'suspended') ac.resume().catch(() => {});
      return ac;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = 0.55;
    master.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ac;
  }

  // iOS only plays audio after a sound is started inside a user gesture.
  function unlock() {
    if (!ensure()) return;
    const src = ac.createBufferSource();
    src.buffer = ac.createBuffer(1, 1, 22050);
    src.connect(master);
    src.start(0);
  }

  function env(g, t0, attack, dur, vol) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }

  function tone({ type = 'sine', f = 440, f2 = null, t = 0, d = 0.15, v = 0.25, attack = 0.005 }) {
    const t0 = ac.currentTime + t;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + d);
    env(g, t0, attack, d, v);
    o.connect(g).connect(master);
    o.start(t0);
    o.stop(t0 + d + 0.05);
  }

  function noise({ t = 0, d = 0.2, v = 0.25, type = 'bandpass', f = 1200, f2 = null, q = 1, attack = 0.004 }) {
    const t0 = ac.currentTime + t;
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    const filt = ac.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(f, t0);
    if (f2) filt.frequency.exponentialRampToValueAtTime(f2, t0 + d);
    filt.Q.value = q;
    const g = ac.createGain();
    env(g, t0, attack, d, v);
    src.connect(filt).connect(g).connect(master);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + d + 0.05);
  }

  const fx = {
    tap: () => tone({ type: 'triangle', f: 620, f2: 900, d: 0.07, v: 0.18 }),
    select: () => { tone({ type: 'triangle', f: 523, d: 0.09, v: 0.22 }); tone({ type: 'triangle', f: 784, t: 0.07, d: 0.14, v: 0.22 }); },
    correct: () => [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'triangle', f, t: i * 0.06, d: 0.2, v: 0.2 })),
    wrong: () => { tone({ type: 'sawtooth', f: 240, f2: 120, d: 0.32, v: 0.14 }); tone({ type: 'square', f: 180, f2: 90, t: 0.04, d: 0.3, v: 0.06 }); },
    link: () => tone({ type: 'sine', f: 700, f2: 1400, d: 0.12, v: 0.2 }),
    snap: () => { tone({ type: 'triangle', f: 880, d: 0.06, v: 0.2 }); noise({ f: 3000, d: 0.05, v: 0.12 }); },
    crack: () => { noise({ f: 3800, q: 2, d: 0.08, v: 0.35 }); tone({ type: 'square', f: 1800, f2: 900, d: 0.04, v: 0.05 }); },
    shatter: () => { for (let i = 0; i < 6; i++) noise({ t: i * 0.025, f: rand(2500, 6000), q: 3, d: 0.12, v: 0.25 }); tone({ type: 'triangle', f: 2400, f2: 1200, d: 0.25, v: 0.08 }); },
    chomp: () => { noise({ type: 'lowpass', f: 900, d: 0.07, v: 0.4 }); noise({ type: 'lowpass', t: 0.09, f: 700, d: 0.06, v: 0.3 }); },
    squish: () => { noise({ type: 'lowpass', f: 500, f2: 1500, q: 4, d: 0.12, v: 0.25 }); tone({ f: 160, f2: 260, d: 0.1, v: 0.1 }); },
    zip: () => noise({ type: 'bandpass', f: 2200, f2: 5200, q: 6, d: 0.09, v: 0.2 }),
    unzip: () => { noise({ type: 'bandpass', f: 1800, f2: 6000, q: 5, d: 0.25, v: 0.25 }); tone({ type: 'triangle', f: 660, f2: 990, t: 0.2, d: 0.12, v: 0.12 }); },
    boom: () => { noise({ type: 'lowpass', f: 1400, f2: 80, q: 0.7, d: 0.7, v: 0.6, attack: 0.002 }); tone({ type: 'sine', f: 120, f2: 35, d: 0.6, v: 0.45 }); },
    unlock: () => { tone({ type: 'square', f: 1250, d: 0.03, v: 0.08 }); tone({ type: 'square', f: 1650, t: 0.05, d: 0.05, v: 0.08 }); noise({ t: 0.03, f: 4000, d: 0.06, v: 0.15 }); },
    chains: () => { for (let i = 0; i < 5; i++) noise({ t: i * 0.05, f: rand(3000, 5000), q: 8, d: 0.08, v: 0.15 }); },
    squash: () => { noise({ type: 'lowpass', f: 1200, f2: 200, d: 0.12, v: 0.4 }); tone({ type: 'square', f: 220, f2: 70, d: 0.1, v: 0.08 }); },
    buzz: () => tone({ type: 'sawtooth', f: 140, f2: 150, d: 0.18, v: 0.07 }),
    tick: () => tone({ type: 'square', f: 1400, d: 0.02, v: 0.06 }),
    whoosh: () => noise({ type: 'bandpass', f: 400, f2: 2400, q: 1.2, d: 0.3, v: 0.25 }),
    reveal: () => { tone({ type: 'triangle', f: 784, d: 0.1, v: 0.2 }); tone({ type: 'triangle', f: 1175, t: 0.08, d: 0.25, v: 0.2 }); },
    light: () => tone({ type: 'sine', f: 900 + Math.random() * 300, d: 0.06, v: 0.1 }),
    go: () => [392, 523, 659, 784, 1047].forEach((f, i) => tone({ type: 'square', f, t: i * 0.07, d: 0.16, v: 0.08 })),
    fanfare: () => { [523, 659, 784].forEach((f, i) => tone({ type: 'triangle', f, t: i * 0.11, d: 0.22, v: 0.2 })); tone({ type: 'triangle', f: 1047, t: 0.33, d: 0.5, v: 0.22 }); },
    scroll: () => { noise({ type: 'bandpass', f: 900, f2: 300, q: 0.8, d: 0.45, v: 0.18 }); tone({ type: 'triangle', f: 660, t: 0.35, d: 0.3, v: 0.12 }); },
    power: () => { tone({ type: 'sawtooth', f: 200, f2: 800, d: 0.3, v: 0.08 }); tone({ type: 'triangle', f: 800, t: 0.25, d: 0.3, v: 0.15 }); },
    disco: () => { tone({ type: 'square', f: 110, d: 0.08, v: 0.08 }); noise({ t: 0.1, type: 'highpass', f: 7000, d: 0.04, v: 0.1 }); },
  };

  function play(name) {
    if (muted || !ensure()) return;
    try { fx[name]?.(); } catch (e) { console.warn('sound', name, e); }
  }

  function vibrate(pattern) {
    if (muted || !navigator.vibrate) return;
    try { navigator.vibrate(pattern); } catch { /* not allowed */ }
  }

  return {
    play,
    unlock,
    vibrate,
    get muted() { return muted; },
    setMuted(m) {
      muted = !!m;
      store.set('muted', muted);
    },
  };
})();
