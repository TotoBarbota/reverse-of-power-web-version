(function main() {
  document.body.append(h('div', { class: 'rotate' },
    h('div', { class: 'phone' }),
    h('div', { text: 'Turn your phone sideways to play' })));

  // A touch pointerdown is not a user activation in Chrome; pointerup and touchend are.
  const gesture = (e) => {
    Sound.unlock();
    if (e.type === 'pointerdown' && e.pointerType !== 'mouse') return;
    goImmersive();
    keepAwake();
  };
  for (const type of ['pointerdown', 'pointerup', 'touchend']) {
    document.addEventListener(type, gesture, { capture: true, passive: true });
  }
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  if (/[?&]debug\b/.test(location.search)) window.KIP_DEBUG = { App, S, Net };

  Net.on((ev) => App.onRelay(ev));
  App.show('connect');
  Net.start();
  Install.init();
}());
