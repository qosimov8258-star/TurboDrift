import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 640, height: 360 } });
p.on('pageerror', e => console.log('[pageerror]', e.message));
await p.goto('http://localhost:3000/?manual'); await p.waitForSelector('#menu.on', { timeout: 120000 });
const r = await p.evaluate(() => {
  const q = s => document.querySelector(s), g = () => window.__game;
  q('#btnSolo').click(); q('#btnPick').click(); q('#btnStart').click();
  for (let i = 0; i < 60 * 9; i++) g().tick(1 / 60, false);
  const t1 = g().race.raceClock;
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
  q('#btnRestart').click();
  for (let i = 0; i < 30; i++) g().tick(1 / 60, false);
  return { t1, phase: g().race.phase, clock: g().race.raceClock, pauseOn: q('#pause').classList.contains('on'), ctx: !!g().audio.ctx, rpm: g().race.me.v.rpm };
});
console.log(JSON.stringify(r)); await b.close();
