// Fast headless simulation of the Police mission AI (no rendering): who catches whom, stuck cars, timings.
//   ROLE=thief|police POLICE=4 DIFF=1 SECONDS=120 node tools/sim-mission.mjs
import { chromium } from 'playwright';
import { createStatic, attachGameServer } from '../server.js';
const ROLE = process.env.ROLE || 'police', POLICE = +(process.env.POLICE || 4), DIFF = +(process.env.DIFF ?? 1), SECONDS = +(process.env.SECONDS || 120), TIME = +(process.env.TIME || 300);
const PORT = 3250 + Math.floor(Math.random() * 40);
const srv = createStatic(PORT); attachGameServer(srv); await new Promise(r => srv.listen(PORT, r));
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('pageerror', e => console.log('[pageerror]', e.message, (e.stack || '').split('\n').slice(0, 4).join(' | ')));
p.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 300)); });
await p.goto(`http://localhost:${PORT}/?manual`);
await p.waitForSelector('#menu.on', { timeout: 240000 });
await p.evaluate(([role, n, diff, time]) => { const g = window.__game; g.S.m = { role, police: n, diff, time }; g.startMission(); }, [ROLE, POLICE, DIFF, TIME]);
await p.waitForFunction('window.__game.S.screen === "race"', null, { timeout: 300000 });
const report = () => p.evaluate(() => {
  const m = window.__game.mission, th = m.thief, R = x => Math.round(x);
  return { t: R(m.t), state: m.state, bust: +m.bust.toFixed(2), over: m.over && { win: m.over.win, reason: m.over.reason },
    units: m.units.map(u => { const d = th ? Math.hypot(u.state.x - th.state.x, u.state.z - th.state.z) : 0; return `${u.id}:${R(u.state.speed * 3.6)}kmh d=${R(d)} hp=${R(u.hp)}${u.dead ? ' DEAD' : ''}`; }).join(' | '), loot: m.stats.loot, posts: m.posts.list.length, thiefHp: th ? Math.round(th.hp) : null };
});
if (process.env.AUTO) await p.evaluate(async () => {         // a simple "player": drives to the next loot bag / the hideout along the nav field
  const { driveTo } = await import('/js/missionai.js');
  const g = window.__game, m = g.mission, nav = m.nav, F = nav.field();
  let tgt = null;
  m.hook = dt => {
    const me = m.me, want = m.loot.find(l => !l.got) || (m.hide && m.hide.on ? m.hide : null);
    if (!want || !me || me.dead) return;
    if (tgt !== want) { tgt = want; F.start([nav.snap(want.x, want.z)]); F.runAll(); }
    const pts = F.descend(me.v.x, me.v.z, 26); let tx = want.x, tz = want.z;
    if (pts && pts.length > 1) { let k = pts.length - 1; while (k > 1 && m.world.rayFree(me.v.x, me.v.z, pts[k][0], pts[k][1], 0.9) < 1) k--; tx = pts[k][0]; tz = pts[k][1]; }
    driveTo(me.v, m.world, tx, tz, 40, g.race.input, { nitro: false });
  };
});
let last = -99;
for (let s = 0; s < SECONDS * 30; s++) {
  await p.evaluate(() => { window.__game.tick(1 / 30, false); });
  if (s % 300 === 0) { const r = await report(); console.log(JSON.stringify(r)); if (r.state === 'over') break; }
}
console.log('final', JSON.stringify(await report()));
await b.close(); srv.close();
