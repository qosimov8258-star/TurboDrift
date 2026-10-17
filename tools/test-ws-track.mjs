// Online rooms must carry the chosen track to every player.
import WebSocket from 'ws';
import { createStatic, attachGameServer } from '../server.js';
const srv = createStatic(3224); attachGameServer(srv); await new Promise(r => srv.listen(3224, r));
const open = () => new Promise(r => { const ws = new WebSocket('ws://localhost:3224'); ws.msgs = []; ws.on('message', d => ws.msgs.push(JSON.parse(d))); ws.on('open', () => r(ws)); });
const wait = ms => new Promise(r => setTimeout(r, ms));
const last = (ws, t) => [...ws.msgs].reverse().find(m => m.t === t);
let bad = 0; const check = (c, m) => { if (!c) { bad++; console.log('FAIL', m); } else console.log('ok  ', m); };
const a = await open(), b = await open();
a.send(JSON.stringify({ t: 'join', name: 'A' })); await wait(100);
const code = last(a, 'joined').room;
check(last(a, 'lobby').track === 0, 'new room defaults to track 0');
b.send(JSON.stringify({ t: 'join', name: 'B', room: code })); await wait(100);
for (const tr of [7, 3, 9, 0]) {
  a.send(JSON.stringify({ t: 'config', laps: 3, bots: 2, track: tr })); await wait(60);
  check(last(a, 'lobby').track === tr && last(b, 'lobby').track === tr, `host picks track ${tr} -> both see it`);
}
b.send(JSON.stringify({ t: 'config', laps: 3, bots: 2, track: 5 })); await wait(60);
check(last(b, 'lobby').track === 0, 'guest cannot change the track');
a.send(JSON.stringify({ t: 'config', laps: 3, bots: 2, track: 99 })); await wait(60);
check(last(a, 'lobby').track === 0, 'out-of-range track ignored');
a.send(JSON.stringify({ t: 'config', laps: 3, bots: 2, track: 'x' })); await wait(60);
check(last(a, 'lobby').track === 0, 'non-integer track ignored');
a.send(JSON.stringify({ t: 'config', laps: 4, bots: 2, track: 8 })); await wait(60);
a.send(JSON.stringify({ t: 'start' })); await wait(150);
check(last(a, 'start')?.track === 8 && last(b, 'start')?.track === 8, 'start message carries the track');
a.close(); b.close(); srv.close();
console.log(bad ? bad + ' FAILED' : 'WS TRACK SYNC OK'); process.exit(bad ? 1 : 0);
