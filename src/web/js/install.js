// Install prompt. Android Chrome only offers its native prompt on HTTPS, so on the
// home network the banner explains the browser menu route instead.
const Install = {
  deferred: null,
  el: null,

  init() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferred = e;
      this.render();
    });
    window.addEventListener('appinstalled', () => {
      store.set('installDismissed', true);
      this.hide();
    });
    setTimeout(() => this.render(), 2500);
  },

  shouldShow() {
    if (isStandalone()) return false;
    const dismissed = store.get('installDismissed');
    if (dismissed === true) return false;
    if (typeof dismissed === 'number' && Date.now() - dismissed < 3 * 86400000) return false;
    return isIOS() || isAndroid() || !!this.deferred;
  },

  text() {
    if (this.deferred) return { title: 'Install the controller', body: 'Add it to your home screen for full screen play.', button: 'Install' };
    if (isIOS()) {
      const share = '<svg class="share-ico" viewBox="0 0 24 24" fill="none" stroke="#2a7cf6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>';
      return { title: 'Add to Home Screen', body: `Tap ${share} Share, then <b style="display:inline;font-size:inherit">Add to Home Screen</b>.`, button: null };
    }
    return { title: 'Add to Home Screen', body: 'Open the browser menu <b style="display:inline;font-size:inherit">⋮</b> and choose <b style="display:inline;font-size:inherit">Add to Home screen</b> or <b style="display:inline;font-size:inherit">Install app</b>.', button: null };
  },

  render() {
    if (!this.shouldShow()) {
      this.hide();
      return;
    }
    const t = this.text();
    if (this.el) this.el.remove();
    const go = t.button ? h('button', { class: 'go', text: t.button, onclick: () => this.prompt() }) : null;
    this.el = h('div', { class: 'install' },
      h('img', { src: APP_ICON, alt: '' }),
      h('div', { class: 'txt', html: `<b>${t.title}</b>${t.body}` }),
      go,
      h('button', { class: 'x', 'aria-label': 'Close', text: '×', onclick: () => this.dismiss() }));
    document.body.append(this.el);
    requestAnimationFrame(() => requestAnimationFrame(() => this.el && this.el.classList.add('show')));
  },

  prompt() {
    const d = this.deferred;
    if (!d) return;
    this.deferred = null;
    d.prompt();
    d.userChoice.then((r) => {
      if (r.outcome === 'accepted') store.set('installDismissed', true);
      this.hide();
    }).catch(() => this.hide());
  },

  dismiss() {
    store.set('installDismissed', Date.now());
    this.hide();
  },

  hide() {
    if (!this.el) return;
    const el = this.el;
    this.el = null;
    el.classList.remove('show');
    setTimeout(() => el.remove(), 400);
  },
};
