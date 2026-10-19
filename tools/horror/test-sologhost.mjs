import { chromium } from 'playwright';
import { createStatic, attachGameServer } from '../../server.js';
const srv = createStatic(3302); attachGameServer(srv); await new Promise(r => srv.listen(3302, r));
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
const errs = []; let ok = 0;
for (const [lv, ch] of [[0, 2], [3, 3], [6, 4]]) {
  const p = await b.newPage({ viewport: { width: 640, height: 360 } });
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/GL Driver|ERR_/.test(m.text())) errs.push(m.text()); });
  await p.addInitScript(c => localStorage.setItem('hz_chars', JSON.stringify({ survivor: 0, ghost: c })), ch);
  await p.goto(`http://localhost:3302/horror?solo=${lv}&role=ghost&nopause`);
  await p.waitForFunction('window.__hz && window.__hz.frameCount>10', null, { timeout: 90000 });
  await p.waitForTimeout(6000);
  const r = await p.evaluate(() => { const s = __hz.sim; return { role: s.me.role, players: s.players.size, bots: [...s.players.values()].filter(x => !x.local).map(x => [Math.round(x.x), Math.round(x.z)]), hub: __hz.hub?.bots.length, marks: __hz.hud.markPool.length, t: s.t }; });
  console.log(lv, ch, JSON.stringify(r)); if (r.role === 'ghost' && r.hub === 2) ok++;
  if (lv === 3) await p.screenshot({ path: '/private/tmp/claude-501/-Users-ismoil-Desktop-game/ce8365eb-0c45-4729-a4c4-dd8a989641db/scratchpad/sg.png' });
  await p.close();
}
console.log('ok', ok, 'errors', errs); await b.close(); srv.close(); process.exit(0);
