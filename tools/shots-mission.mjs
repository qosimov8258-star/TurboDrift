// Teleports the player around the 3 cities / objectives and screenshots (visual QA).
import { chromium } from 'playwright';
import { createStatic, attachGameServer } from '../server.js';
const OUT = process.env.OUT || '/private/tmp/claude-501/-Users-ismoil-Desktop-game/60b90354-d033-477f-866c-49b2a7c6e66d/scratchpad/shots/';
const PORT = 3400 + Math.floor(Math.random() * 40);
const srv = createStatic(PORT); attachGameServer(srv); await new Promise(r => srv.listen(PORT, r));
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('pageerror', e => console.log('[pageerror]', e.message, (e.stack || '').split('\n').slice(0, 4).join(' | ')));
await p.goto(`http://localhost:${PORT}/?manual`);
await p.waitForSelector('#menu.on', { timeout: 240000 });
await p.evaluate(() => { const g = window.__game; g.S.m = { role: 'thief', police: 5, diff: 1, time: 300 }; g.startMission(); });
await p.waitForFunction('window.__game.S.screen === "race"', null, { timeout: 300000 });
const tick = (n, dt = 1 / 60, render = false) => p.evaluate(([n, dt, render]) => { for (let i = 0; i < n; i++) window.__game.tick(dt, render && i === n - 1); }, [n, dt, render]);
await tick(60 * 4);
const shots = [
  ['q_loot', () => { const m = window.__game.mission, l = m.loot[0]; const psi = m.world.freeHeading(l.x, l.z); m.me.v.place(l.x - Math.sin(psi) * 22, l.z - Math.cos(psi) * 22, psi); }],
  ['q_hide', () => { const m = window.__game.mission; m.stats.loot = 5; m.loot.forEach(l => { l.got = true; l.g.visible = false; }); m.hide.on = true; m.hide.g.visible = true; const h = m.hide, k = m.nav.snap(h.x - 25, h.z), [px, pz] = m.nav.centre(k); m.me.v.place(px, pz, Math.atan2(h.x - px, h.z - pz)); }],
  ['q_x', () => {}],
  ['q_cityB', () => { const m = window.__game.mission, c = m.world.cities[1], x = (c.x0 + c.x1) / 2, z = (c.z0 + c.z1) / 2, k = m.nav.snap(x, z), [px, pz] = m.nav.centre(k); m.me.v.place(px, pz, m.world.freeHeading(px, pz)); }],
  ['q_cityC', () => { const m = window.__game.mission, c = m.world.cities[2], x = (c.x0 + c.x1) / 2, z = (c.z0 + c.z1) / 2, k = m.nav.snap(x, z), [px, pz] = m.nav.centre(k); m.me.v.place(px, pz, m.world.freeHeading(px, pz)); }],
  ['q_conn', () => { const m = window.__game.mission, c = m.world.connectors[0], q = c.pts[Math.floor(c.pts.length / 2)], q2 = c.pts[Math.floor(c.pts.length / 2) + 1]; m.me.v.place(q[0], q[1], Math.atan2(q2[0] - q[0], q2[1] - q[1])); }],
];
for (const [name, fn] of shots) {
  await p.evaluate(fn); await tick(3);
  await p.evaluate(() => { const m = window.__game.mission; for (const u of m.units) if (u !== m.me) { /* keep AI away from the shot */ u.v.place(-30, -30, 0); } });
  await tick(50, 1 / 60, false);
  await p.evaluate(() => { const m = window.__game.mission, v = m.me.v; v.place(v.x, v.z, v.psi); });
  await tick(30, 1 / 60, true);
  await p.screenshot({ path: OUT + name + '.png', timeout: 240000 });
  console.log('shot', name);
}
await b.close(); srv.close();
