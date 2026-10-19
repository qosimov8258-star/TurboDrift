import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { createHorrorServer } from './horror-server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.ogg': 'audio/ogg', '.webp': 'image/webp' };

export function lanUrls(port) {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const n of list || []) if (n.family === 'IPv4' && !n.internal) out.push(`http://${n.address}:${port}`);
  return out;
}

export function createStatic(port = 3000) {
  return http.createServer((req, res) => {
    let url; try { url = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); return res.end(); }
    if (url === '/info') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ urls: lanUrls(port) }));
    }
    if (url === '/horror-list') {       // horror/music/uchratsa ichidagi baqiriq ovozlari ro'yxati
      let files = []; try { files = fs.readdirSync(path.join(__dirname, 'horror/music/uchratsa')).filter(f => /\.(mp3|wav|m4a|ogg)$/i.test(f)); } catch {}
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(files));
    }
    if (url === '/') url = req.url.includes('?') ? '/drift.html' : '/portal.html';      // /?room=ABCD, /?manual... eski havolalar Turbo Drift'ga olib boradi
    else if (url === '/drift') url = '/drift.html';
    else if (url === '/horror' || url === '/horror/') url = '/horror/index.html';
    let file;
    if (url.startsWith('/three/')) file = path.join(__dirname, 'node_modules/three', url.slice(7));
    else if (url.startsWith('/saund/')) file = path.join(__dirname, url);
    else if (url.startsWith('/tools/')) file = path.join(__dirname, url);
    else if (url.startsWith('/horror-files/')) file = path.join(__dirname, 'horror', url.slice(14));
    else file = path.join(__dirname, 'public', url);
    file = path.normalize(file);
    if (!file.startsWith(__dirname + path.sep)) { res.writeHead(403); return res.end(); }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); return res.end('404'); }
      const type = types[path.extname(file)] || 'application/octet-stream';
      const cache = /\.(glb|sdf|mp3|m4a)$/.test(url) ? 'public, max-age=3600' : 'no-cache';
      // Range qo'llab-quvvatlash: Safari audio uchun majburiy, katta mp3 lar uchun foydali
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (range && (range[1] || range[2])) {
        let a = range[1] === '' ? Math.max(0, st.size - +range[2]) : +range[1];
        let b = range[1] === '' || range[2] === '' ? st.size - 1 : Math.min(+range[2], st.size - 1);
        if (a > b || a >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
        res.writeHead(206, { 'Content-Type': type, 'Cache-Control': cache, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${a}-${b}/${st.size}`, 'Content-Length': b - a + 1 });
        const rs = fs.createReadStream(file, { start: a, end: b });
        rs.on('error', () => res.destroy()); res.on('close', () => rs.destroy());
        return rs.pipe(res);
      }
      if (st.size > 4e6) {      // katta fayllar oqim bilan
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache, 'Accept-Ranges': 'bytes', 'Content-Length': st.size });
        const rs = fs.createReadStream(file);
        rs.on('error', () => res.destroy()); res.on('close', () => rs.destroy());
        return rs.pipe(res);
      }
      fs.readFile(file, (e2, data) => {
        if (e2) { res.writeHead(404); return res.end('404'); }
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache, 'Accept-Ranges': 'bytes' });
        res.end(data);
      });
    });
  });
}

// ------------------------------------------------------------------ rooms
const MAX_PLAYERS = 7;          // one per car model
const PAINT_COUNT = 4;          // body colours, keep in sync with public/js/paint.js
const TRACK_COUNT = 10;         // keep in sync with public/js/trackdata.js (5 roads + 5 round tracks)
const rooms = new Map();
let nextId = 1;

const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const cleanColor = c => { c = c | 0; return c >= 0 && c < PAINT_COUNT ? c : -1; };
const cleanName = n => String(n || 'Poygachi').replace(/[<>&"']/g, '').trim().slice(0, 14) || 'Poygachi';
function roomCode() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) { let c = ''; for (let i = 0; i < 4; i++) c += a[Math.floor(Math.random() * a.length)]; if (!rooms.has(c)) return c; }
}

function lobbyMsg(room) {
  return {
    t: 'lobby', room: room.code, host: room.hostId, phase: room.phase, laps: room.laps, bots: room.bots, track: room.track, mode: room.mode, m: room.m,
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, car: p.car, color: p.color ?? -1, bot: !!p.bot, ready: !!p.ready, role: p.role === 'thief' ? 'thief' : 'police' })),
  };
}
function broadcast(room, msg, exceptId) {
  const s = JSON.stringify(msg);
  for (const p of room.players.values()) if (!p.bot && p.id !== exceptId && p.ws.readyState === 1) p.ws.send(s);
}
const humans = room => [...room.players.values()].filter(p => !p.bot);
const takenCars = room => new Set([...room.players.values()].map(p => p.car).filter(c => c >= 0));

function dropBots(room) { for (const [id, p] of room.players) if (p.bot) room.players.delete(id); }

function finishRace(room) {
  if (room.phase !== 'racing') return;
  clearTimeout(room.endTimer);
  room.phase = 'finished';
  const list = [...room.players.values()].map(p => ({ id: p.id, name: p.name, car: p.car, bot: !!p.bot, time: p.finish ?? null, prog: p.prog || 0 }));
  // race: fastest finish first. battle: `time` is when the car was destroyed (the winner reports clock + 1000) -> latest first
  if (room.mode === 'battle') list.sort((a, b) => (b.time ?? -1) - (a.time ?? -1) || b.prog - a.prog);
  else list.sort((a, b) => (a.time != null && b.time != null) ? a.time - b.time : a.time != null ? -1 : b.time != null ? 1 : b.prog - a.prog);
  broadcast(room, { t: 'results', list });
  broadcast(room, lobbyMsg(room));
}

function checkAllFinished(room) {
  const all = [...room.players.values()];
  if (all.every(p => p.finish != null)) finishRace(room);
}

function leave(ws) {
  const room = rooms.get(ws.room); if (!room) return;
  const me = room.players.get(ws.pid); if (!me) return;
  room.players.delete(ws.pid);
  ws.room = null;
  if (!humans(room).length) { clearTimeout(room.endTimer); rooms.delete(room.code); return; }
  broadcast(room, { t: 'left', id: me.id });
  if (room.hostId === me.id) {
    room.hostId = humans(room)[0].id;
    dropBots(room);                       // bots are simulated on the host's machine
    if (room.phase === 'racing') broadcast(room, { t: 'botsGone' });
  }
  if (room.phase === 'racing') checkAllFinished(room);
  broadcast(room, lobbyMsg(room));
}

function doStart(room, me, ws) {
      dropBots(room);
      const hs = humans(room);
      if (room.mode === 'mission') {         // Police mission: no bot cars, the host simulates the AI police / thief / robots
        if (hs.some(p => p.car < 0)) return send(ws, { t: 'err', msg: 'Hamma mashina tanlashi kerak' });
        room.phase = 'racing';
        for (const p of room.players.values()) { p.finish = null; p.prog = 0; p.ready = false; }
        broadcast(room, lobbyMsg(room));
        return broadcast(room, { t: 'start', grid: {}, laps: 1, countdown: 3, track: room.track, mode: 'mission' });
      }
      if (hs.some(p => p.car < 0)) return send(ws, { t: 'err', msg: 'Hamma mashina tanlashi kerak' });
      // fill with bots on the free cars
      const free = [...Array(MAX_PLAYERS).keys()].filter(c => !takenCars(room).has(c));
      const want = Math.min(room.bots, free.length, MAX_PLAYERS - hs.length);
      const botNames = ['Rustam', 'Jasur', 'Sardor', 'Bobur', 'Dilshod', 'Aziz', 'Otabek', 'Sherzod'];
      for (let i = 0; i < want; i++) {
        const id = 'b' + nextId++;
        room.players.set(id, { id, bot: true, name: '🤖 ' + botNames[(nextId + i) % botNames.length], car: free[i], color: Math.random() < 0.5 ? Math.floor(Math.random() * PAINT_COUNT) : -1, ready: true });
      }
      const ids = [...room.players.keys()];
      for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
      const grid = {}; ids.forEach((id, k) => { grid[id] = k; });
      room.phase = 'racing';
      for (const p of room.players.values()) { p.finish = null; p.prog = 0; p.ready = false; }
      broadcast(room, lobbyMsg(room));
      broadcast(room, { t: 'start', grid, laps: room.laps, countdown: 6, track: room.track, mode: room.mode });
}

function handle(ws, m) {
  if (m.t === 'join') {
    if (ws.room) leave(ws);
    let room = m.room ? rooms.get(String(m.room).toUpperCase()) : null;
    if (m.room && !room) return send(ws, { t: 'err', msg: `"${String(m.room).toUpperCase()}" xonasi topilmadi` });
    if (!room) {
      room = { code: roomCode(), players: new Map(), hostId: null, phase: 'lobby', laps: 3, bots: 3, track: 0, mode: 'race', m: { police: 4, thieves: 1, diff: 1, time: 300 } };
      rooms.set(room.code, room);
    }
    if (room.phase !== 'lobby') return send(ws, { t: 'err', msg: 'Poyga boshlanib ketgan, kuting' });
    if (humans(room).length >= MAX_PLAYERS) return send(ws, { t: 'err', msg: 'Xona to\'la (7 ta o\'yinchi)' });
    const id = 'p' + nextId++;
    ws.pid = id; ws.room = room.code;
    const free = [...Array(MAX_PLAYERS).keys()].find(c => !takenCars(room).has(c));
    room.players.set(id, { id, ws, name: cleanName(m.name), car: free ?? -1, ready: false });
    if (!room.hostId) room.hostId = id;
    send(ws, { t: 'joined', id, room: room.code });
    broadcast(room, lobbyMsg(room));
    return;
  }
  const room = rooms.get(ws.room);
  if (!room) return;
  const me = room.players.get(ws.pid);
  if (!me) return;

  switch (m.t) {
    case 'pick': {
      const c = m.car | 0;
      const ms = room.mode === 'mission';
      if (room.phase !== 'lobby' || c < 0 || c >= MAX_PLAYERS + (ms ? 1 : 0)) break;
      if (ms || !takenCars(room).has(c) || me.car === c) me.car = c;      // mission: any car (also the police SUV, #7), several friends may share one
      if (m.color != null) me.color = cleanColor(m.color);
      broadcast(room, lobbyMsg(room));
      break;
    }
    case 'color':
      if (room.phase !== 'lobby') break;
      me.color = cleanColor(m.color);
      broadcast(room, lobbyMsg(room));
      break;
    case 'role': {        // Police mission: choose to be the thief (only one human may) or police
      if (room.phase !== 'lobby' || room.mode !== 'mission') break;
      if (m.role === 'thief') {
        me.role = 'thief';
      } else me.role = 'police';
      broadcast(room, lobbyMsg(room));
      break;
    }
    case 'unpick':
      if (room.phase !== 'lobby') break;
      me.car = -1;
      broadcast(room, lobbyMsg(room));
      break;
    case 'name': me.name = cleanName(m.name); broadcast(room, lobbyMsg(room)); break;
    case 'config':
      if (room.hostId !== me.id || room.phase !== 'lobby') break;
      room.laps = Math.max(1, Math.min(10, m.laps | 0 || 3));
      room.bots = Math.max(0, Math.min(6, m.bots | 0));
      if (Number.isInteger(m.track) && m.track >= 0 && m.track < TRACK_COUNT) room.track = m.track;
      if (m.mode === 'race' || m.mode === 'battle' || m.mode === 'mission') {
        const was = room.mode; room.mode = m.mode;
        if (was === 'mission' && room.mode !== 'mission') {            // back to one-car-per-player: fix duplicates / the SUV
          const used = new Set();
          for (const p of room.players.values()) { if (p.car >= MAX_PLAYERS || used.has(p.car)) p.car = [...Array(MAX_PLAYERS).keys()].find(c => !used.has(c) && !takenCars(room).has(c)) ?? -1; if (p.car >= 0) used.add(p.car); }
        }
      }
      if (m.m && typeof m.m === 'object') room.m = { police: Math.max(1, Math.min(50, m.m.police | 0 || 4)), thieves: Math.max(1, Math.min(8, m.m.thieves | 0 || 1)), diff: [0, 1, 2].includes(m.m.diff | 0) ? m.m.diff | 0 : 1, time: Math.max(60, Math.min(3600, (+m.m.time | 0) || 300)) };
      broadcast(room, lobbyMsg(room));
      break;
    case 'start':
      if (room.hostId !== me.id || room.phase !== 'lobby') break;
      doStart(room, me, ws);
      break;
    case 'restart':
      if (room.hostId !== me.id || room.phase === 'lobby') break;
      clearTimeout(room.endTimer); room.endTimer = null;
      room.phase = 'lobby'; dropBots(room);
      for (const p of room.players.values()) { p.finish = null; p.prog = 0; }
      doStart(room, me, ws);
      break;
    case 'st': {
      const src = (m.id && room.hostId === me.id && room.players.get(m.id)?.bot) ? room.players.get(m.id) : me;
      if (Array.isArray(m.s)) { src.prog = m.s[11] || src.prog; broadcast(room, { t: 'st', id: src.id, s: m.s }, me.id); }
      break;
    }
    case 'tow': {         // Dodge Charger hooked (on=1) / released (on=0) car `to`: the hooked player's own machine applies the rope
      if (room.phase !== 'racing' || typeof m.to !== 'string' || !room.players.has(m.to)) break;
      broadcast(room, { t: 'tow', id: me.id, to: m.to, on: m.on ? 1 : 0 }, me.id);
      break;
    }
    case 'ab': {          // battle ability used (relayed as is; every client simulates the effect)
      const src = (m.id && room.hostId === me.id && room.players.get(m.id)?.bot) ? room.players.get(m.id) : me;
      const k = m.k | 0;
      if (room.phase !== 'racing' || room.mode !== 'battle' || k < 0 || k >= 12) break;
      const p = Array.isArray(m.p) && m.p.length === 5 && m.p.every(Number.isFinite) ? m.p : null;
      broadcast(room, { t: 'ab', id: src.id, k, p }, me.id);
      break;
    }
    case 'fin': {
      const src = (m.id && room.hostId === me.id && room.players.get(m.id)?.bot) ? room.players.get(m.id) : me;
      if (room.phase !== 'racing' || src.finish != null) break;
      src.finish = Math.max(0, +m.time || 0);
      broadcast(room, { t: 'fin', id: src.id, time: src.finish });
      if (!room.endTimer && room.mode !== 'battle') room.endTimer = setTimeout(() => finishRace(room), 50000);   // battle: ends when the last car is down
      checkAllFinished(room);
      break;
    }
    case 'back':
      if (room.hostId !== me.id) break;
      clearTimeout(room.endTimer); room.endTimer = null;
      room.phase = 'lobby'; dropBots(room);
      for (const p of room.players.values()) { p.finish = null; p.prog = 0; }
      broadcast(room, { t: 'back' });
      broadcast(room, lobbyMsg(room));
      break;
    case 'chat':
      broadcast(room, { t: 'chat', id: me.id, name: me.name, text: String(m.text || '').slice(0, 120) });
      break;
    case 'mstart': case 'ms': case 'mev': {      // Police mission: host -> everybody else (relayed as is)
      if (room.hostId !== me.id || room.mode !== 'mission' || room.phase !== 'racing') break;
      broadcast(room, m, me.id);
      break;
    }
    case 'mcmd': {                               // Police mission: a friend asks the host for something (e.g. the thief drops a bomb)
      if (room.mode !== 'mission' || room.phase !== 'racing' || room.hostId === me.id || !m.c || typeof m.c !== 'object') break;
      const host = room.players.get(room.hostId); if (host && host.ws) send(host.ws, { t: 'mcmd', id: me.id, c: m.c });
      break;
    }
    case 'mready': {                             // a friend has loaded the city: tell the host
      if (room.mode !== 'mission' || room.phase !== 'racing') break;
      const host = room.players.get(room.hostId); if (host && host.ws) send(host.ws, { t: 'mready', id: me.id });
      break;
    }
    case 'ping': send(ws, { t: 'pong', c: m.c }); break;
    default: break;
  }
}

export function attachGameServer(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32768 });
  const hz = createHorrorServer();
  server.on('upgrade', (req, socket, head) => {
    const target = (req.url || '').startsWith('/hws') ? hz : wss;
    target.handleUpgrade(req, socket, head, ws => target.emit('connection', ws, req));
  });
  wss.on('connection', ws => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', data => { let m; try { m = JSON.parse(data); } catch { return; } if (m && typeof m.t === 'string') handle(ws, m); });
    ws.on('close', () => leave(ws));
    ws.on('error', () => {});
  });
  setInterval(() => wss.clients.forEach(ws => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); }), 15000);
  wss.horror = hz;
  return wss;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const PORT = +process.env.PORT || 3000;
  const server = createStatic(PORT);
  attachGameServer(server);
  server.listen(PORT, '0.0.0.0', () => {
    console.log('\n  🎮  O\'yinlar serveri ishga tushdi\n');
    console.log('  Kompyuteringizda:  http://localhost:' + PORT + '   (ikkita o\'yin: 🏎 Turbo Drift va 👻 Qorong\'u Uy)');
    for (const u of lanUrls(PORT)) console.log('  Do\'stlar (bir WiFi):  ' + u);
    console.log('  To\'g\'ridan-to\'g\'ri:  /drift  va  /horror\n');
  });
}
