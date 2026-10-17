// Headless check of the battle mode: solo fight vs bots, HP loss from impacts, deaths, results screen.
import { chromium } from 'playwright';
import { createStatic, attachGameServer } from '../server.js';
const D = process.argv[2] || '/tmp/';
const srv = createStatic(3223); attachGameServer(srv); await new Promise(r => srv.listen(3223, r));
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1000, height: 560 } });
p.on('console', m => { const t = m.text(); if (!/GL Driver|GPU stall|PCFSoft/.test(t)) console.log('[console]', m.type(), t.slice(0, 300)); });
p.on('pageerror', e => console.log('[pageerror]', e.message, (e.stack || '').split('\n').slice(0, 4).join(' | ')));
await p.goto('http://localhost:3223/?manual');
await p.waitForSelector('#menu.on', { timeout: 240000 });
const tick = (n, dt = 1 / 60, render = false) => p.evaluate(([n, dt, render]) => { for (let i = 0; i < n; i++) window.__game.tick(dt, render && i === n - 1); }, [n, dt, render]);
await tick(3, 1 / 60, true);
await p.click('#btnSolo'); await tick(10, 1 / 60, true);
await p.click('#btnPick');
await p.click('#modeSw button[data-m="battle"]');
await p.screenshot({ path: D + 'b_lobby.png' });
await p.evaluate(() => document.getElementById('btnStart').click());
await tick(60 * 3, 1 / 60, true);
await p.screenshot({ path: D + 'b_count.png' });
await tick(60 * 4, 1 / 60, false);
const snap = () => p.evaluate(() => { const r = window.__game.race; return { phase: r.phase, t: +r.raceClock.toFixed(1), racers: [...r.racers.values()].map(x => `${x.name}:${x.kind}:${Math.round(x.hp)}${x.dead ? 'X' : ''}@${x.v ? x.v.speed.toFixed(0) : '-'}`) }; });
console.log('start', JSON.stringify(await snap()));
// player just drives forward in a circle-ish and gets rammed
await p.keyboard.down('KeyW');
for (let k = 0; k < 8; k++) {
  await tick(60 * 5, 1 / 60, k % 2 === 1);
  console.log('t+', (k + 1) * 5, JSON.stringify(await snap()));
  if (k === 3) await p.screenshot({ path: D + 'b_fight.png' });
  const scr = await p.evaluate(() => document.body.dataset.screen); if (scr === 'results') break;
}
await p.screenshot({ path: D + 'b_end.png' });
console.log('screen', await p.evaluate(() => document.body.dataset.screen));
console.log(await p.evaluate(() => document.getElementById('resTable').innerText));
await b.close(); srv.close();
