// Drives the web controller in headless Chrome against fake-game.mjs.
// Usage: node e2e.mjs <url> <kip|decades|offline> <shotsDir>
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [url, mode = 'kip', shots = 'shots'] = process.argv.slice(2);
fs.mkdirSync(shots, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(14, 23), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ICON = fileURLToPath(new URL('../src/web/generated/icon.png', import.meta.url));
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({
  viewport: { width: 800, height: 380 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
});
let page;
const errors = [];
async function openPage() {
  page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') { errors.push(m.text()); log('console', m.type(), m.text()); } });
  page.on('pageerror', (e) => { errors.push(String(e)); log('PAGEERROR', String(e.stack || e)); });
  await page.goto(`${url}?debug`);
}
await openPage();

const cur = () => page.evaluate(() => {
  const a = window.KIP_DEBUG && window.KIP_DEBUG.App;
  return a && a.cur ? { name: a.cur.name, seq: a.cur.ctx.seq, id: a.cur.el.dataset.id || (a.cur.el.dataset.id = Math.random().toString(36).slice(2)) } : null;
}).catch(() => null);
let shotN = 0;
const shot = async (name) => {
  const f = path.join(shots, `${String(++shotN).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: f }).catch(() => {});
  log('shot', f);
};
const center = async (sel, nth = 0) => {
  const b = await page.locator(sel).nth(nth).boundingBox();
  return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2, b } : null;
};
async function drag(from, to, steps = 15) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await sleep(12);
  }
  await page.mouse.up();
}
async function dragPath(points) {
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1];
    const b = points[k];
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(a.x + ((b.x - a.x) * i) / 12, a.y + ((b.y - a.y) * i) / 12);
      await sleep(12);
    }
  }
  await page.mouse.up();
}
const tap = async (p) => { await page.mouse.click(p.x, p.y); };
const stillOn = async (id) => (await cur())?.id === id;

let triviaCount = 0;
let reloadedPowerplay = false;
let reloadedTrivia = false;
let closedOffline = false;

const ACTIONS = {
  async connect() {
    const fake = `.console-item:has-text("${process.env.FAKE_IP || '192.168.2.12'}")`;
    await sleep(1500);
    if ((await cur())?.name !== 'connect') return;
    await page.waitForSelector(fake, { timeout: 8000 });
    await shot('connect');
    await page.click(fake);
  },
  async name() {
    await page.fill('input.input', 'Tester');
    await shot('name');
    await page.click('text=Continue');
  },
  async photo() {
    await page.setInputFiles('input[type=file]', ICON);
    await sleep(600);
    await page.waitForSelector('.avatar:not(.taken)', { timeout: 8000 });
    await page.locator('.avatar:not(.taken)').first().click();
    await page.waitForSelector('.avatar.sel', { timeout: 5000 });
    await shot('photo');
    await page.click('.btn.primary:has-text("Continue")');
  },
  async waiting(id) {
    await sleep(1500);
    await shot('waiting');
    const svg = await center('.start-btn');
    if (!svg) { log('no start button'); return; }
    await page.mouse.move(svg.x, svg.y);
    await page.mouse.down();
    await sleep(1000);
    await shot('waiting-hold');
    await sleep(1400);
    await page.mouse.up();
  },
  async holding() { await sleep(400); await shot('holding'); },
  async category() {
    await sleep(700);
    await shot('category');
    await page.locator('.door-col').nth(1).click();
    await sleep(400);
    await shot('category-chosen');
  },
  async powerpick() {
    await sleep(700);
    await shot('powerpick');
    await page.locator('.pentagon').first().click().catch(async () => tap({ x: 400, y: 190 }));
    await sleep(500);
    await shot('powerpick-accepted');
  },
  async powerplay(id) {
    await sleep(1200);
    await shot('powerplay-reel');
    await sleep(2200);
    await shot('powerplay-cards');
    if (mode === 'offline' && !closedOffline) {
      closedOffline = true;
      log('closing the page while the power play is open');
      await page.close();
      await sleep(29000);
      await openPage();
      return;
    }
    if (!reloadedPowerplay) {
      reloadedPowerplay = true;
      log('reloading mid power play');
      await page.reload();
      return;
    }
    await page.locator('.pp-card').nth(0).click();
    await sleep(700);
    await shot('powerplay-targets');
    await page.locator('.pp-back').click({ force: true }).catch(() => {});
    await sleep(500);
    await shot('powerplay-stepback');
    await page.locator('.pp-card').nth(1).click();
    await sleep(700);
    await page.locator('.pp-target').first().click();
    await sleep(800);
    await shot('powerplay-locked');
  },
  async trivia(id) {
    triviaCount++;
    const n = triviaCount;
    await sleep(900);
    await shot(`trivia${n}`);
    const c0 = await center('.cell', 0);
    if (!c0) return;
    const b = c0.b;
    for (let round = 0; round < 14 && (await stillOn(id)); round++) {
      // wipe gloop and drag zippers left to right, then tap (ice, locks, bugs, answer)
      await drag({ x: b.x + 6, y: b.y + b.height / 2 }, { x: b.x + b.width - 6, y: b.y + b.height / 2 }, 10);
      await drag({ x: b.x + 6, y: b.y + b.height * 0.25 }, { x: b.x + b.width - 6, y: b.y + b.height * 0.75 }, 10);
      for (let t = 0; t < 4; t++) await tap({ x: b.x + b.width * (0.3 + 0.13 * t), y: b.y + b.height * (0.35 + 0.1 * t) });
      if (round === 1) await shot(`trivia${n}-work`);
      const fx = await page.evaluate(() => [...document.querySelectorAll('canvas.full')].length).catch(() => 0);
      if (fx) for (let t = 0; t < 6; t++) await tap({ x: 60 + Math.random() * 680, y: 60 + Math.random() * 260 });
      await sleep(250);
      if (n === 1 && !reloadedTrivia && round === 0) {
        reloadedTrivia = true;
        log('reloading mid trivia');
        await page.reload();
        return;
      }
    }
    await shot(`trivia${n}-answered`);
  },
  async pairs(id) {
    await sleep(800);
    await shot('pairs');
    const MATCH = { Fire: 'Hot', Ice: 'Cold', Day: 'Light', Night: 'Dark' };
    let wrongDone = false;
    for (let k = 0; k < 12 && (await stillOn(id)); k++) {
      const tops = await page.$$eval('.slot.dome-top', (els) => els.map((e) => ({ t: e.textContent, v: getComputedStyle(e).visibility, r: e.getBoundingClientRect().toJSON() })));
      const bots = await page.$$eval('.slot.dome-bottom', (els) => els.map((e) => ({ t: e.textContent, v: getComputedStyle(e).visibility, r: e.getBoundingClientRect().toJSON() })));
      const top = tops.find((x) => x.v === 'visible' && x.t && bots.some((y) => y.v === 'visible' && y.t === MATCH[x.t]));
      if (!top) { await sleep(300); continue; }
      let bot = bots.find((y) => y.v === 'visible' && y.t === MATCH[top.t]);
      if (!wrongDone) {
        const wrong = bots.find((y) => y.v === 'visible' && y.t && y.t !== MATCH[top.t]);
        if (wrong) { bot = wrong; wrongDone = true; }
      }
      const c = (r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
      await drag(c(top.r), c(bot.r), 20);
      if (k === 0) await shot('pairs-feedback');
      await sleep(650);
    }
    await shot('pairs-done');
  },
  async sorting(id) {
    await sleep(800);
    await shot('sorting');
    const LEFT = new Set(['Apple', 'Pear']);
    for (let k = 0; k < 6 && (await stillOn(id)); k++) {
      const it = await page.$eval('.sort-item', (e) => ({ t: e.textContent, v: getComputedStyle(e).visibility, r: e.getBoundingClientRect().toJSON() })).catch(() => null);
      if (!it || it.v !== 'visible') { await sleep(300); continue; }
      const c = { x: it.r.x + it.r.width / 2, y: it.r.y + it.r.height / 2 };
      const toLeft = k === 1 ? !LEFT.has(it.t) : LEFT.has(it.t);
      await drag(c, { x: toLeft ? 60 : 740, y: c.y + 20 }, 12);
      if (k === 0) await shot('sorting-feedback');
      await sleep(500);
    }
  },
  async endfact() {
    await sleep(800);
    await shot('endfact');
    await page.locator('.scroll').click().catch(() => {});
    await sleep(1200);
    await shot('endfact-open');
  },
  async continue() {
    await sleep(500);
    await shot('continue');
    await page.click('text=CONTINUE').catch(() => {});
  },
  async chain(id) {
    await sleep(800);
    await shot('chain');
    const ORDERS = [['Walk', 'This', 'Way'], ['Born', 'In', 'The', 'USA']];
    let wrongDone = false;
    for (let k = 0; k < 6 && (await stillOn(id)); k++) {
      const slots = await page.$$eval('.slot.circle', (els) => els.filter((e) => !e.classList.contains('hidden')).map((e) => ({ t: e.textContent, r: e.getBoundingClientRect().toJSON() })));
      const order = ORDERS.find((o) => o.every((w) => slots.some((s) => s.t === w)) && o.length === slots.length);
      if (!order) { await sleep(300); continue; }
      const c = (w) => { const s = slots.find((x) => x.t === w); return { x: s.r.x + s.r.width / 2, y: s.r.y + s.r.height / 2 }; };
      if (!wrongDone) {
        wrongDone = true;
        await dragPath([c(order[0]), c(order[2])]);
        await sleep(600);
        await shot('chain-wrong');
        continue;
      }
      await dragPath(order.map(c));
      await sleep(200);
      await shot('chain-complete');
      await sleep(700);
    }
  },
  async elimination(id) {
    await sleep(700);
    await shot('elimination');
    const CORRECT = new Set(['Moon', 'Sun']);
    let wrongDone = false;
    for (let k = 0; k < 6 && (await stillOn(id)); k++) {
      const btns = await page.$$eval('.elim-btn', (els) => els.map((e) => ({ t: e.textContent, d: e.disabled })));
      let i = btns.findIndex((b) => !b.d && (wrongDone ? CORRECT.has(b.t) : !CORRECT.has(b.t)));
      if (i < 0) { await sleep(300); continue; }
      await page.locator('.elim-btn').nth(i).click();
      if (!wrongDone) { wrongDone = true; await sleep(200); await shot('elimination-wrong'); await sleep(800); continue; }
      await sleep(600);
    }
  },
  async matching(id) {
    await sleep(900);
    await shot('matching');
    const stage = await center('.hex-stage');
    for (let k = 0; k < 20 && (await stillOn(id)); k++) {
      const front = await page.evaluate(() => {
        const faces = [...document.querySelectorAll('.hex-face')];
        let best = null;
        for (const f of faces) {
          const r = f.querySelector('.hex-screen').getBoundingClientRect();
          if (!best || r.width > best.w) best = { w: r.width, t: f.textContent, x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }
        return best;
      });
      const q = await page.$eval('.mg-q', (e) => e.textContent);
      const want = q.includes('Thriller') ? 'Michael Jackson' : 'Madonna';
      if (front && front.t === want) {
        await tap(front);
        if (k < 8) await shot('matching-correct');
        await sleep(650);
      } else {
        await drag({ x: stage.x + 120, y: stage.y }, { x: stage.x - 120, y: stage.y }, 8);
        await sleep(450);
      }
    }
  },
  async missing(id) {
    await sleep(700);
    await shot('missing');
    const CORRECT = ['E', 'O'];
    let wrongDone = false;
    for (let k = 0; k < 6 && (await stillOn(id)); k++) {
      const btns = await page.$$eval('.letter-btn', (els) => els.map((e) => ({ t: e.textContent, d: e.disabled })));
      const want = await page.$$eval('.tile', (els) => els.map((e) => e.textContent).join(''));
      const letter = want.includes('CLU') ? 'E' : 'O';
      const i = btns.findIndex((b) => !b.d && (wrongDone ? b.t === letter : b.t !== letter));
      if (i < 0) { await sleep(300); continue; }
      await page.locator('.letter-btn').nth(i).click();
      if (!wrongDone) { wrongDone = true; await shot('missing-wrong'); await sleep(900); continue; }
      await sleep(150);
      await shot('missing-revealed');
      await sleep(400);
    }
    void CORRECT;
  },
};

let last = null;
const deadline = Date.now() + 280000;
while (Date.now() < deadline) {
  if (page.isClosed()) { await sleep(300); continue; }
  const c = await cur();
  if (c && (!last || c.id !== last.id)) {
    log('screen', c.name, `seq=${c.seq}`);
    last = c;
    const act = ACTIONS[c.name];
    if (act) {
      try { await act(c.id); } catch (e) { log('action error', c.name, String(e.message || e).split('\n')[0]); }
    }
    continue;
  }
  if (fs.existsSync(path.join(shots, 'STOP'))) break;
  await sleep(250);
}
log('errors', JSON.stringify(errors));
await browser.close();
