// Horror serveri protokol sinovi (ws): xonalar, rollar, start, hodisalar relesi, host almashishi, xato kirishlar.
import WebSocket from 'ws';
import { createStatic, attachGameServer } from '../../server.js';
const PORT = 3301;
const srv = createStatic(PORT); attachGameServer(srv); await new Promise(r => srv.listen(PORT, r));
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
class C {
  constructor(name) { this.name = name; this.msgs = []; this.ws = new WebSocket(`ws://localhost:${PORT}/hws`); this.ready = new Promise(r => this.ws.on('open', r)); this.ws.on('message', d => this.msgs.push(JSON.parse(d))); }
  send(o) { this.ws.send(typeof o === 'string' ? o : JSON.stringify(o)); }
  async wait(pred, ms = 1500) { const t0 = Date.now(); for (;;) { const m = this.msgs.find(pred); if (m) return m; if (Date.now() - t0 > ms) return null; await new Promise(r => setTimeout(r, 10)); } }
  last(t) { return [...this.msgs].reverse().find(m => m.t === t); }
  clear() { this.msgs = []; }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const a = new C('A'); await a.ready; a.send({ t: 'join', name: 'Ali<script>', char: 1 });
const ja = await a.wait(m => m.t === 'joined'); ok(ja && ja.room.length === 4, 'A xona yaratdi');
const code = ja.room; let lob = a.last('lobby'); ok(lob.players[0].name === 'Alischript' || !lob.players[0].name.includes('<'), 'ism tozalandi: ' + lob.players[0].name);
const b = new C('B'); await b.ready; b.send({ t: 'join', name: 'Bob', room: code.toLowerCase(), char: 1 });
ok(await b.wait(m => m.t === 'joined'), 'B qo\'shildi (kichik harf kodi)');
lob = (await a.wait(m => m.t === 'lobby' && m.players.length === 2)); ok(lob && lob.players[0].char !== lob.players[1].char, 'bir xil qahramon berilmadi');
const x = new C('X'); await x.ready; x.send({ t: 'join', name: 'X', room: 'ZZZZ' }); ok(await x.wait(m => m.t === 'err'), 'noto\'g\'ri xona kodi xato beradi');
x.send('not json'); x.send({ t: 5 }); x.send({}); await sleep(100); ok(x.ws.readyState === 1, 'noto\'g\'ri xabarlar serverni buzmaydi');
// rollar: ikkinchi ruh rad etiladi
a.send({ t: 'role', role: 'ghost' }); await sleep(80); b.clear(); b.send({ t: 'role', role: 'ghost' }); ok(await b.wait(m => m.t === 'err'), 'ikkinchi ruh rad etildi');
// faqat ruh bo'lsa start bo'lmaydi: A ruh, B ruh emas -> bo'ladi; B ni ham ruh qilib bo'lmaydi. Start A (host)
a.clear(); b.clear();
b.send({ t: 'cfg', level: 5 }); await sleep(50); ok(a.last('lobby') == null || a.last('lobby').level === 0, 'host bo\'lmagan cfg o\'zgartirmaydi');
a.send({ t: 'cfg', level: 7, diff: 2 }); lob = await a.wait(m => m.t === 'lobby' && m.level === 7 && m.diff === 2); ok(lob, 'host cfg o\'zgartirdi');
a.send({ t: 'cfg', level: 99 }); await sleep(50); ok(a.last('lobby').level === 7, 'noto\'g\'ri daraja rad etildi');
a.clear(); b.clear();
b.send({ t: 'start' }); await sleep(80); ok(!b.last('start'), 'host bo\'lmagan start qila olmaydi');
a.send({ t: 'start' });
const sa = await a.wait(m => m.t === 'start'), sb = await b.wait(m => m.t === 'start');
ok(sa && sb && sa.seed === sb.seed && sa.level === 7 && sa.ghost === ja.id && sb.host === ja.id, 'start: bir xil seed, daraja, ruh');
// o'yin ichida
const c = new C('C'); await c.ready; c.send({ t: 'join', name: 'C', room: code }); ok(await c.wait(m => m.t === 'err'), 'boshlangan o\'yinga qo\'shilib bo\'lmaydi');
b.clear(); a.clear();
a.send({ t: 'st', s: [1, 2, 3, 4, 5, 3, -1] }); ok(await b.wait(m => m.t === 'st' && m.s[0] === 1 && m.id === ja.id), 'st relesi');
ok(!a.last('st'), 'st jo\'natuvchiga qaytmaydi');
a.send({ t: 'ev', e: { k: 'say', i: 1, x: 3, z: 4 } }); ok(await b.wait(m => m.t === 'ev' && m.e.k === 'say'), 'ev relesi');
b.send({ t: 'ev', e: { k: 'cab', c: 1 } }); ok(await a.wait(m => m.t === 'ev' && m.e.k === 'cab'), 'ev (B->A)');
a.clear(); b.send({ t: 'ev', e: { k: 'x', pad: 'y'.repeat(900) } }); b.send({ t: 'ev', e: 5 }); b.send({ t: 'ev', e: { notk: 1 } }); await sleep(100); ok(!a.last('ev'), 'katta/noto\'g\'ri ev rad etildi');
b.send({ t: 'gs', s: [1, 1, 1, 1, 1] }); await sleep(60); ok(!a.last('gs'), 'host bo\'lmagan va ruh bo\'lmagan gs rad etildi');
a.send({ t: 'gs', s: [1, 1, 1, 1, 1] }); ok(await b.wait(m => m.t === 'gs'), 'ruhdan gs');
a.clear(); b.send({ t: 'end', win: true }); await sleep(60); ok(!a.last('end'), 'host/ruh bo\'lmagan end rad etildi');
a.send({ t: 'end', win: false, msg: 'x' }); ok(await b.wait(m => m.t === 'end' && m.win === false), 'end relesi');
// ruh chiqib ketadi -> left + lobby
b.clear(); a.ws.close(); const left = await b.wait(m => m.t === 'left'); ok(left && left.id === ja.id, 'left xabari');
lob = await b.wait(m => m.t === 'lobby' && m.players.length === 1); ok(lob && lob.host === sb.host === false || lob.host !== ja.id, 'host B ga o\'tdi');
b.send({ t: 'back' }); ok(await b.wait(m => m.t === 'back'), 'host lobbiga qaytardi');
// ruh yo'q, bitta o'yinchi — start mumkin; ruh bilan yolg'iz — mumkin emas
b.send({ t: 'role', role: 'ghost' }); await sleep(50); b.clear(); b.send({ t: 'start' }); ok(await b.wait(m => m.t === 'err'), 'faqat ruh bilan start rad etildi');
b.send({ t: 'role', role: 'survivor' }); await sleep(50); b.clear(); b.send({ t: 'start' }); ok(await b.wait(m => m.t === 'start'), 'yolg\'iz o\'yinchi start qila oladi');
// 8 o'yinchi limiti
const many = []; const r2 = new C('R'); await r2.ready; r2.send({ t: 'join', name: 'R0' }); const jr = await r2.wait(m => m.t === 'joined'); many.push(r2);
for (let i = 1; i < 9; i++) { const k = new C('R' + i); await k.ready; k.send({ t: 'join', name: 'R' + i, room: jr.room }); many.push(k); }
await sleep(300); const okc = many.filter(k => k.msgs.find(m => m.t === 'joined')).length, errc = many.filter(k => k.msgs.find(m => m.t === 'err')).length;
ok(okc === 8 && errc === 1, `8 ta limit: qo'shildi ${okc}, rad ${errc}`);
for (const k of [b, c, x, ...many]) try { k.ws.close(); } catch {}
await sleep(100); srv.close();
console.log(fails ? `${fails} ta xato` : 'Hamma protokol sinovlari o\'tdi'); process.exit(fails ? 1 : 0);
