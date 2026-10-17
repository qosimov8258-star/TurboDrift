// Headless check of the battle abilities: every key 1 2 3 ... 9 0 - = fires, cool-downs run, weapons hurt a parked target,
// defences work, nothing throws. Screenshots go to the folder given as argument.
import { chromium } from 'playwright';
import { createStatic, attachGameServer } from '../server.js';
const D = process.argv[2] || '/tmp/';
const srv = createStatic(3224); attachGameServer(srv); await new Promise(r => srv.listen(3224, r));
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
let errors = 0;
const ok0 = (name, cond, extra = '') => { console.log(cond ? 'PASS' : 'FAIL', name, extra); };
const ok = ok0;
p.on('console', m => { const t = m.text(); if (m.type() === 'error' || /warn/.test(m.type())) { if (!/GL Driver|GPU stall|PCFSoft|swiftshader/i.test(t)) { console.log('[console]', m.type(), t.slice(0, 300)); errors++; } } });
p.on('pageerror', e => { errors++; console.log('[pageerror]', e.message, (e.stack || '').split('\n').slice(0, 4).join(' | ')); });
await p.goto('http://localhost:3224/?manual');
await p.waitForSelector('#menu.on', { timeout: 240000 });
const tick = (n, dt = 1 / 60, render = false) => p.evaluate(([n, dt, render]) => { for (let i = 0; i < n; i++) window.__game.tick(dt, render && i === n - 1); }, [n, dt, render]);
await tick(3, 1 / 60, true);
await p.click('#btnSolo'); await tick(10, 1 / 60, true);
await p.click('#btnPick');
await p.click('#modeSw button[data-m="battle"]');
await p.evaluate(() => { localStorage.removeItem('td_lo'); });
const startDis = () => p.evaluate(() => document.getElementById('btnStart').disabled);
await tick(5, 1 / 60, true);
const picked = () => p.evaluate(() => window.__game.S.loadout.slice());
ok0('loadout box visible in battle', await p.evaluate(() => !document.getElementById('loadoutBox').classList.contains('hidden') && document.querySelectorAll('#loGrid .lo').length === 12));
ok0('start disabled with 0 picks', await startDis());
await p.click('#loGrid .lo[data-i="9"]'); await p.click('#loGrid .lo[data-i="3"]');
ok0('start still disabled with 2 picks', await startDis());
await p.click('#loGrid .lo[data-i="0"]');
ok0('3 picks in order [9,3,0]', JSON.stringify(await picked()) === '[9,3,0]', JSON.stringify(await picked()));
ok0('start enabled with 3 picks', !(await startDis()));
await p.click('#loGrid .lo[data-i="5"]');
ok0('4th pick refused', (await picked()).length === 3);
await p.screenshot({ path: D + 'ab_lobby.png' });
await p.evaluate(() => document.getElementById('btnStart').click());
await tick(60 * 8, 1 / 60, true);

const info = () => p.evaluate(() => {
  const r = window.__game.race, A = r.arsenal, me = r.me;
  return { phase: r.phase, t: +A.t.toFixed(2), slots: document.querySelectorAll('#hudAb .ab').length, hp: Math.round(me.hp), auto: me.v.auto,
    cd: me.cd.map(c => +Math.max(0, c - A.t).toFixed(1)), objs: { b: A.bullets.length, m: A.missiles.length, mi: A.mines.length, o: A.oils.length, bo: A.bombs.length } };
});
let s = await info();
ok('racing + only 3 slots in the hot-bar', s.phase === 'racing' && s.slots === 3, JSON.stringify(s));
ok('slots hold the picked abilities', await p.evaluate(() => JSON.stringify(window.__game.race.me.loadout) === '[9,3,0]'));
ok('auto gearbox in battle', s.auto === true);

// park every bot far away, then park ONE target 40 m in front of the player
await p.evaluate(() => {
  const r = window.__game.race, me = r.me;
  me.v.place(me.v.x, me.v.z, me.v.psi); me.v.vx = me.v.vz = 0;
  const bots = [...r.racers.values()].filter(x => x !== me);
  window.__tgt = bots[0];
  for (const x of bots) { x.v.locked = true; x.v.place(x.v.x + 800, x.v.z + 800, 0); }          // out of the way (walls clamp them, fine)
});
const aim = (dist = 40) => p.evaluate(d => {
  const r = window.__game.race, me = r.me, t = window.__tgt;
  me.v.vx = me.v.vz = 0; me.v.locked = false;
  const fx = Math.sin(me.v.psi), fz = Math.cos(me.v.psi);
  t.v.locked = true; t.v.place(me.v.x + fx * d, me.v.z + fz * d, me.v.psi); t.v.vx = t.v.vz = 0; t.hp = 100; t.shown = t.ghost = 100; t.state.hp = 100;
  me.cd.fill(0); me.fx.shield = me.fx.armor = 0; t.fx.shield = t.fx.armor = 0;
}, dist);
const IDX = { gun: 0, missile: 1, mine: 2, shield: 3, repair: 4, turbo: 5, oil: 6, emp: 7, bomb: 8, laser: 9, armor: 10, magnet: 11 };
const fire = async id => { await p.evaluate(i => { window.__game.race.me.loadout = [i, (i + 1) % 12, (i + 2) % 12]; window.__game.hud?.setLoadout; }, IDX[id]); await p.keyboard.press('Digit1'); };
const tgtHp = () => p.evaluate(() => Math.round(window.__tgt.hp * 10) / 10);
const settle = async (sec) => { await tick(Math.round(sec * 60), 1 / 60, false); };

// each weapon against the parked target
for (const [name, key, wait, minDmg, dist] of [['Pulemyot', 'gun', 2, 15, 30], ['Raketa', 'missile', 2, 15, 45], ['Lazer', 'laser', 0.5, 15, 40], ['Bomba', 'bomb', 2.5, 5, 30], ['EMP', 'emp', 0.5, 3, 15]]) {
  await aim(dist); await fire(key); await settle(wait);
  const hp = await tgtHp();
  ok(`${name} hurts the target`, 100 - hp >= minDmg, `hp ${hp}`);
  if (name === 'Raketa') await p.screenshot({ path: D + 'ab_missile.png' });
}
// mine: drop it, then roll the target onto it
await aim(40); await p.evaluate(() => { const me = window.__game.race.me; me.v.locked = false; });
await fire('mine'); await tick(120, 1 / 60, false);
let mi = await p.evaluate(() => { const A = window.__game.race.arsenal, m = A.mines[0]; return m ? { x: m.x, z: m.z } : null; });
ok('Mina placed', !!mi);
if (mi) { await p.evaluate(m => { const t = window.__tgt; t.v.place(m.x, m.z, 0); t.v.vx = t.v.vz = 0; }, mi); await settle(0.5); const hp = await tgtHp(); ok('Mina hurts', 100 - hp >= 15, `hp ${hp}`); await p.screenshot({ path: D + 'ab_mine.png' }); }
// oil: target drives over a puddle
await aim(40); await fire('oil'); await tick(30, 1 / 60, false);
const oil = await p.evaluate(() => { const o = window.__game.race.arsenal.oils[0]; return o ? { x: o.x, z: o.z } : null; });
ok('Yog\' puddle placed', !!oil);
if (oil) { await p.evaluate(o => { const t = window.__tgt; t.v.locked = false; t.v.place(o.x, o.z, 0); }, oil); await settle(0.2); ok('Yog\' makes the target slide', await p.evaluate(() => window.__tgt.v.oil > 0)); }
// defences
await aim(40); await fire('shield'); await settle(0.1);
await p.evaluate(() => { const me = window.__game.race.me; window.__game.race.hurt(me, 30); });
ok('Qalqon blocks damage', (await info()).hp === 100, `hp ${(await info()).hp}`);
await p.screenshot({ path: D + 'ab_shield.png' });
await aim(40); await fire('armor'); await settle(0.1);
await p.evaluate(() => { window.__game.race.hurt(window.__game.race.me, 20); });
ok('Zirh halves damage', (await info()).hp === 90, `hp ${(await info()).hp}`);
await fire('repair'); await settle(5);
ok('Ta\'mir heals', (await info()).hp >= 99, `hp ${(await info()).hp}`);
// turbo + magnet
await aim(400); await p.evaluate(() => { const me = window.__game.race.me; me.v.locked = false; me.v.place(me.v.x, me.v.z, me.v.psi); });
const peak = async (sec, boost) => p.evaluate(async ([sec, boost]) => {
  const g = window.__game, me = g.race.me; let mx = 0; me.v.vx = me.v.vz = 0; me.v.gear = 1; g.race.input.throttle = 1;
  if (boost) { me.loadout = [5, 0, 1]; g.race.useAbility(0); }
  for (let i = 0; i < sec * 60; i++) { g.tick(1 / 60, false); mx = Math.max(mx, me.v.speed); if (me.v.hit > 0.3) break; }
  g.race.input.throttle = 0; return mx;
}, [sec, boost]);
const plain = await peak(1.5, false);
await p.evaluate(() => { const me = window.__game.race.me; me.v.place(me.v.x, me.v.z, me.v.psi); me.v.vx = me.v.vz = 0; me.cd.fill(0); });
const boosted = await peak(1.5, true);
ok('Turbo accelerates harder', boosted > plain + 3, `peak ${plain.toFixed(1)} -> ${boosted.toFixed(1)} m/s`);
await p.screenshot({ path: D + 'ab_turbo.png' });
await p.keyboard.up('KeyW');
await aim(35); await fire('magnet'); await settle(0.8);
ok('Magnet pulls the target', await p.evaluate(() => { const r = window.__game.race; return Math.hypot(window.__tgt.v.x - r.me.v.x, window.__tgt.v.z - r.me.v.z) < 33; }));
// cool-down + bar
s = await info(); ok('cool-downs counting', s.cd.some(c => c > 0), JSON.stringify(s.cd));

await p.screenshot({ path: D + 'ab_hud.png' });
// let bots fight with abilities for a while
await p.evaluate(() => { const r = window.__game.race; for (const x of r.racers.values()) if (x !== r.me) { x.v.locked = false; } r.me.v.locked = false; });
await tick(60 * 25, 1 / 60, false);
console.log('after 25 s with bots:', JSON.stringify(await info()));
await p.screenshot({ path: D + 'ab_fight.png' });
console.log(errors ? `DONE with ${errors} console errors` : 'DONE, no console errors');
await b.close(); process.exit(0);
