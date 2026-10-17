// Online: host drives the Dodge Charger, a guest drives behind it; R must hook the GUEST (another machine) and drag it.
import { chromium } from 'playwright';
import { createStatic, attachGameServer } from '../server.js';
const srv = createStatic(3226); attachGameServer(srv); await new Promise(r => srv.listen(3226, r));
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const mk = async name => {
  const p = await b.newPage({ viewport: { width: 1000, height: 560 } });
  p.on('pageerror', e => console.log(`[${name} pageerror]`, e.message));
  await p.goto('http://localhost:3226/?manual'); await p.waitForSelector('#menu.on', { timeout: 300000 });
  return p;
};
const h = await mk('host'); const g = await mk('guest');
const tick = (p, n) => p.evaluate(n => { for (let i = 0; i < n; i++) window.__game.tick(1 / 60, false); }, n);
const both = async n => { for (let i = 0; i < n; i += 30) { await tick(h, 30); await tick(g, 30); await new Promise(r => setTimeout(r, 40)); } };
await h.click('#btnFriends'); await h.click('#btnCreate'); await h.waitForSelector('#lobby.on'); await tick(h, 5);
const code = await h.evaluate(() => window.__game.S.room);
await g.click('#btnFriends'); await g.fill('#roomInput', code); await g.click('#btnJoin'); await g.waitForSelector('#lobby.on'); await tick(g, 5);
// host: Charger = car index 2, guest: Supra MK4 (6)
await h.evaluate(() => { const S = window.__game.S; S.browse = 2; }); await h.click('#btnPick'); await tick(h, 3);
await g.evaluate(() => { window.__game.S.browse = 6; }); await g.click('#btnPick'); await tick(g, 3);
await new Promise(r => setTimeout(r, 500));
await h.click('#btnStart'); await new Promise(r => setTimeout(r, 1500));
await both(60 * 9);                                                    // countdown (6 s) + a little
const place = async () => {                                            // guest 12 m straight behind the Charger, same heading, both standing
  const s = await h.evaluate(() => { const v = window.__game.race.me.v; v.vx = v.vz = 0; return { x: v.x, z: v.z, psi: v.psi }; });
  await h.evaluate(() => { window.__game.race.me.v.locked = false; });
  await g.evaluate(s => { const v = window.__game.race.me.v; v.locked = false; v.place(s.x - Math.sin(s.psi) * 12, s.z - Math.cos(s.psi) * 12, s.psi); }, s);
};
await place(); await both(60);
console.log('phase', await h.evaluate(() => window.__game.race.phase), 'host car', await h.evaluate(() => window.__game.race.me.def.id));
await h.keyboard.press('KeyR'); await both(30);
const hooked = await g.evaluate(() => !!window.__game.race.me.towedBy);
console.log('guest hooked by the Charger:', hooked);
// charger accelerates; guest must be dragged along although it holds nothing
await h.keyboard.down('KeyW'); await g.evaluate(() => { window.__game.race.input.throttle = 0; });
await both(60 * 4);
const d = await h.evaluate(() => { const r = window.__game.race, m = r.me, o = [...r.racers.values()].find(x => x !== m); return { dist: Math.hypot(o.state.x - m.v.x, o.state.z - m.v.z), tow: !!r.tow }; });
const gv = await g.evaluate(() => window.__game.race.me.v.speed);
console.log('distance after 4 s', d.dist.toFixed(1), 'guest speed', gv.toFixed(1), 'host tow active', d.tow);
await h.keyboard.press('KeyR'); await both(60);
console.log('released on guest:', await g.evaluate(() => !window.__game.race.me.towedBy));
await h.screenshot({ path: process.argv[2] + 'tow_host.png' });
await b.close(); process.exit(0);
