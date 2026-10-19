// UI flow of the Police mission: start -> pause -> restart -> quit to missions -> win -> result card -> retry -> setup; plus a timing check with 12 police.
import { chromium } from 'playwright';
import { createStatic, attachGameServer } from '../server.js';
const OUT = process.env.OUT || '/private/tmp/claude-501/-Users-ismoil-Desktop-game/60b90354-d033-477f-866c-49b2a7c6e66d/scratchpad/shots/';
const PORT = 3350 + Math.floor(Math.random() * 40);
const srv = createStatic(PORT); attachGameServer(srv); await new Promise(r => srv.listen(PORT, r));
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
let errors = 0;
p.on('pageerror', e => { errors++; console.log('[pageerror]', e.message, (e.stack || '').split('\n').slice(0, 5).join(' | ')); });
p.on('console', m => { const t = m.text(); if (m.type() === 'error' && !/GL Driver|GPU stall/i.test(t)) { errors++; console.log('[console.error]', t.slice(0, 300)); } });
await p.goto(`http://localhost:${PORT}/?manual`);
await p.waitForSelector('#menu.on', { timeout: 240000 });
const click = sel => p.evaluate(s => document.querySelector(s).click(), sel);
const tick = (n, dt = 1 / 60, render = false) => p.evaluate(([n, dt, render]) => { for (let i = 0; i < n; i++) window.__game.tick(dt, render && i === n - 1); }, [n, dt, render]);
const scr = () => p.evaluate(() => window.__game.S.screen);
const waitRace = () => p.waitForFunction('window.__game.S.screen === "race"', null, { timeout: 300000 });
const check = (name, ok, extra = '') => console.log(ok ? 'PASS' : 'FAIL', name, extra);

await click('#btnMission'); await tick(2);
check('missions screen', (await scr()) === 'missions');
await p.evaluate(() => { document.querySelector('#msRole button[data-r="police"]').click(); document.querySelector('#msPolChips button[data-n="20"]').click(); });
await click('#msStart'); await waitRace(); await tick(200);
let st = await p.evaluate(() => { const m = window.__game.mission; return { units: m.units.length, police: m.units.filter(u => u.isPolice).length, state: m.state, phase: window.__game.race.phase }; });
check('20 police + thief spawned', st.units === 21 && st.police === 20, JSON.stringify(st));
// timing with 12 police
const ms = await p.evaluate(() => { const t0 = performance.now(); for (let i = 0; i < 600; i++) window.__game.tick(1 / 60, false); return (performance.now() - t0) / 600; });
console.log('avg tick ms (20 police, no render):', ms.toFixed(2));
// pause / restart
await p.keyboard.press('Escape'); await tick(2, 1 / 60, true);
check('paused', await p.evaluate(() => window.__game.S.paused));
await p.screenshot({ path: OUT + 'f_pause.png' });
const t1 = await p.evaluate(() => window.__game.mission.t);
await click('#btnRestart'); await waitRace(); await tick(5);
const t2 = await p.evaluate(() => window.__game.mission.t);
check('restart resets mission clock', t2 < t1, `${t1.toFixed(1)} -> ${t2.toFixed(1)}`);
// respawn key
await tick(60 * 4); await p.keyboard.press('KeyT'); await tick(3);
check('respawn works', await p.evaluate(() => window.__game.mission.me.v.speed < 1));
// quit to missions
await p.keyboard.press('Escape'); await tick(2); await click('#btnQuit'); await tick(3);
check('quit -> missions', (await scr()) === 'missions');
check('track restored after leaving mission', await p.evaluate(() => { const r = window.__game.race; return !r.world && r.scene.children.includes(r.trackRoot); }));
// thief mission, forced win -> result card
await p.evaluate(() => document.querySelector('#msRole button[data-r="thief"]').click());
await click('#msStart'); await waitRace(); await tick(240, 1 / 60, true);
await p.screenshot({ path: OUT + 'f_thief_hud.png' });
await p.evaluate(() => window.__game.mission.finish(true, 'escaped'));
await tick(60 * 4, 1 / 60, true);
check('result card shown', (await scr()) === 'mres');
await p.screenshot({ path: OUT + 'f_result_win.png' });
await click('#mresAgain'); await waitRace(); await tick(10);
check('retry from result', (await scr()) === 'race');
await p.evaluate(() => window.__game.mission.finish(false, 'busted'));
await tick(60 * 4, 1 / 60, true);
await p.screenshot({ path: OUT + 'f_result_lose.png' });
await click('#mresSetup'); await tick(3);
check('result -> setup', (await scr()) === 'missions');
await click('#msBack'); await tick(3);
check('back to menu', (await scr()) === 'menu');
// normal race still works afterwards
await click('#btnSolo'); await tick(5); await click('#btnPick'); await click('#btnStart'); await waitRace(); await tick(120, 1 / 60, true);
check('normal race after mission', await p.evaluate(() => !window.__game.race.mission && !!window.__game.race.me));
await p.screenshot({ path: OUT + 'f_race_after.png' });
console.log('errors', errors);
await b.close(); srv.close();
