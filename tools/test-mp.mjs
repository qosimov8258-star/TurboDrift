import { chromium } from 'playwright';
import { createStatic, attachGameServer } from '../server.js';
const srv = createStatic(3223); attachGameServer(srv); await new Promise(r => srv.listen(3223, r));
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const mk = async name => {
  const p = await b.newPage({ viewport: { width: 700, height: 400 } });
  p.on('pageerror', e => console.log(name, '[pageerror]', e.message));
  p.on('console', m => { if (m.type() === 'error') console.log(name, '[err]', m.text().slice(0, 200)); });
  await p.goto('http://localhost:3223/?manual'); await p.waitForSelector('#menu.on', { timeout: 120000 });
  await p.evaluate(n => { document.getElementById('nameInput').value = n; }, name); return p;
};
const A = await mk('Ali'); console.log('A ready'); const B = await mk('Vali'); console.log('B ready');
const tick = (p, n, dt = 1 / 60) => p.evaluate(([n, dt]) => { for (let i = 0; i < n; i++) window.__game.tick(dt, false); }, [n, dt]);
await A.evaluate(() => document.querySelector('#btnFriends').click()); await A.evaluate(() => document.querySelector('#btnCreate').click());
await A.waitForSelector('#lobby.on');
const code = await A.textContent('#roomCode'); console.log('room', code);
await B.evaluate(() => document.querySelector('#btnFriends').click()); await B.evaluate(c => { const i = document.getElementById('roomInput'); i.value = c; }, code); await B.evaluate(() => document.querySelector('#btnJoin').click());
await B.waitForSelector('#lobby.on');
await A.waitForTimeout(300);
console.log('A players:', await A.textContent('#plCount'), '| B players:', await B.textContent('#plCount'));
// A picks car 0 (already default assigned by server); B was auto-assigned another. Try B picking A's car.
await B.evaluate(() => { const g = window.__game; g.showroom.show(0); });
await B.evaluate(() => { document.getElementById('carPrev').click(); document.getElementById('carNext').click(); });   // browse returns to car 0
console.log('B state on car0:', await B.textContent('#carState'), '| pick disabled:', await B.evaluate(() => document.getElementById('btnPick').disabled));
console.log('starting'); await A.evaluate(() => document.getElementById('btnStart').click());
await A.waitForTimeout(600);
console.log('ticking'); await tick(A, 60 * 7); await tick(B, 60 * 7);
await A.keyboard.down('KeyW'); await B.keyboard.down('KeyW');
for (let k = 0; k < 8; k++) { await tick(A, 30); await tick(B, 30); await A.waitForTimeout(80); }
const info = p => p.evaluate(() => { const r = window.__game.race; return { phase: r.phase, racers: [...r.racers.values()].map(x => `${x.name}:${x.kind}:${x.state.z.toFixed(0)}:${x.rank}`) }; });
console.log('A', JSON.stringify(await info(A)));
console.log('B', JSON.stringify(await info(B)));
await b.close(); srv.close();
