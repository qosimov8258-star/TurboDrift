import { chromium } from 'playwright';
import { createStatic, attachGameServer } from '../../server.js';
const srv = createStatic(3299); attachGameServer(srv); await new Promise(r => srv.listen(3299, r));
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
let bad = 0;
for (const url of ['/drift', '/?manual', '/?room=ABCD']) {
  const p = await b.newPage({ viewport: { width: 800, height: 450 } });
  p.on('pageerror', e => { bad++; console.log('[pageerror]', url, e.message); });
  p.on('console', m => { if (m.type() === 'error' && !/GL Driver/.test(m.text())) { bad++; console.log('[console.error]', url, m.text().slice(0, 200)); } });
  await p.goto('http://localhost:3299' + url);
  await p.waitForFunction('document.getElementById("menu") && document.getElementById("menu").classList.contains("on") || window.__game', null, { timeout: 90000 }).catch(e => { bad++; console.log('menu chiqmadi', url); });
  console.log(url, '-> title:', await p.title(), '| path:', new URL(p.url()).pathname);
  await p.close();
}
// portal + redirect
const p = await b.newPage(); await p.goto('http://localhost:3299/?room=WXYZ'); console.log('/?room=WXYZ ->', await p.title());
await p.goto('http://localhost:3299/'); console.log('/ ->', await p.title());
// 404 va Range
const r1 = await fetch('http://localhost:3299/horror-files/music/start.mp3', { headers: { Range: 'bytes=0-99' } }); console.log('range', r1.status, r1.headers.get('content-range'), (await r1.arrayBuffer()).byteLength);
const r2 = await fetch('http://localhost:3299/horror-files/../server.js'); console.log('traversal', r2.status);
const r3 = await fetch('http://localhost:3299/nope'); console.log('404', r3.status);
const r4 = await fetch('http://localhost:3299/horror/%E0%A4%A'); console.log('bad-uri', r4.status);
await b.close(); srv.close(); console.log(bad ? 'XATO' : 'OK'); process.exit(bad ? 1 : 0);
