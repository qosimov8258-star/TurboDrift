import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.ico': 'image/x-icon' };

export function lanUrls(port) {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const n of list || []) if (n.family === 'IPv4' && !n.internal) out.push(`http://${n.address}:${port}`);
  return out;
}

export function createStatic(port = 3000) {
  return http.createServer((req, res) => {
    let url = decodeURIComponent(req.url.split('?')[0]);
    if (url === '/info') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ urls: lanUrls(port) }));
    }
    if (url === '/') url = '/index.html';
    let file;
    if (url.startsWith('/three/')) file = path.join(__dirname, 'node_modules/three', url.slice(7));
    else if (url.startsWith('/saund/')) file = path.join(__dirname, url);
    else if (url.startsWith('/tools/')) file = path.join(__dirname, url);
    else file = path.join(__dirname, 'public', url);
    if (!file.startsWith(__dirname)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('404'); }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': url.endsWith('.glb') ? 'public, max-age=3600' : 'no-cache' });
      res.end(data);
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
    t: 'lobby', room: room.code, host: room.hostId, phase: room.phase, laps: room.laps, bots: room.bots, track: room.track, mode: room.mode,
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, car: p.car, color: p.color ?? -1, bot: !!p.bot, ready: !!p.ready })),
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
      room = { code: roomCode(), players: new Map(), hostId: null, phase: 'lobby', laps: 3, bots: 3, track: 0, mode: 'race' };
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
      if (room.phase !== 'lobby' || c < 0 || c >= MAX_PLAYERS) break;
      if (!takenCars(room).has(c) || me.car === c) me.car = c;
      if (m.color != null) me.color = cleanColor(m.color);
      broadcast(room, lobbyMsg(room));
      break;
    }
    case 'color':
      if (room.phase !== 'lobby') break;
      me.color = cleanColor(m.color);
      broadcast(room, lobbyMsg(room));
      break;
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
      if (m.mode === 'race' || m.mode === 'battle') room.mode = m.mode;
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
    case 'ping': send(ws, { t: 'pong', c: m.c }); break;
    default: break;
  }
}

export function attachGameServer(server) {
  const wss = new WebSocketServer({ server, maxPayload: 4096 });
  wss.on('connection', ws => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', data => { let m; try { m = JSON.parse(data); } catch { return; } if (m && typeof m.t === 'string') handle(ws, m); });
    ws.on('close', () => leave(ws));
    ws.on('error', () => {});
  });
  setInterval(() => wss.clients.forEach(ws => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); }), 15000);
  return wss;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const PORT = +process.env.PORT || 3000;
  const server = createStatic(PORT);
  attachGameServer(server);
  server.listen(PORT, '0.0.0.0', () => {
    console.log('\n  🏁  POYGA o\'yini ishga tushdi\n');
    console.log('  Kompyuteringizda:  http://localhost:' + PORT);
    for (const u of lanUrls(PORT)) console.log('  Do\'stlar (bir WiFi):  ' + u);
    console.log('');
  });
}
