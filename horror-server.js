// Horror o'yini uchun xonalar serveri (WebSocket: /hws). Server "ahmoq" releyi:
// xarita seed'dan hamma klientda bir xil quriladi, o'yin hodisalari esa shu yerdan tarqatiladi.
import { WebSocketServer } from 'ws';

export const HZ_MAX_PLAYERS = 8;
export const HZ_LEVELS = 10;
export const HZ_CHARS = 5;          // masha, rabbit (omon qolgan) | ruh, scarecrow, monster (ruh)
const rooms = new Map();
let nextId = 1;

const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const cleanName = n => String(n || 'Qahramon').replace(/[<>&"'`]/g, '').trim().slice(0, 14) || 'Qahramon';
function roomCode() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) { let c = ''; for (let i = 0; i < 4; i++) c += a[Math.floor(Math.random() * a.length)]; if (!rooms.has(c)) return c; }
}
const list = room => [...room.players.values()];

function lobbyMsg(room) {
  return {
    t: 'lobby', room: room.code, host: room.hostId, phase: room.phase, level: room.level, diff: room.diff,
    players: list(room).map(p => ({ id: p.id, name: p.name, char: p.char, role: p.role })),
  };
}
function broadcast(room, msg, exceptId) {
  const s = JSON.stringify(msg);
  for (const p of room.players.values()) if (p.id !== exceptId && p.ws.readyState === 1) p.ws.send(s);
}
function ghostOf(room) { return list(room).find(p => p.role === 'ghost') || null; }

function leave(ws) {
  const room = rooms.get(ws.room); if (!room) return;
  const me = room.players.get(ws.pid); if (!me) return;
  room.players.delete(ws.pid);
  ws.room = null; ws.pid = null;
  if (!room.players.size) { rooms.delete(room.code); return; }
  broadcast(room, { t: 'left', id: me.id });
  if (room.hostId === me.id) room.hostId = list(room)[0].id;
  if (room.phase === 'playing') {
    broadcast(room, lobbyMsg(room));
    // o'yinda hamma raqib ketib, faqat sheriklar qolgan bo'lsa ham o'yin davom etadi (klient hal qiladi)
  } else broadcast(room, lobbyMsg(room));
}

function handle(ws, m) {
  if (m.t === 'ping') return send(ws, { t: 'pong', c: m.c });
  if (m.t === 'join') {
    if (ws.room) leave(ws);
    let room = m.room ? rooms.get(String(m.room).toUpperCase()) : null;
    if (m.room && !room) return send(ws, { t: 'err', msg: `"${String(m.room).toUpperCase().slice(0, 4)}" xonasi topilmadi` });
    if (!room) {
      room = { code: roomCode(), players: new Map(), hostId: null, phase: 'lobby', level: 0, diff: 1, seed: 0 };
      rooms.set(room.code, room);
    }
    if (room.phase !== 'lobby') return send(ws, { t: 'err', msg: "O'yin boshlanib ketgan, kuting" });
    if (room.players.size >= HZ_MAX_PLAYERS) return send(ws, { t: 'err', msg: "Xona to'la (8 ta o'yinchi)" });
    const id = 'h' + nextId++;
    ws.pid = id; ws.room = room.code;
    const used = new Set(list(room).map(p => p.char));
    let char = m.char | 0; if (char < 0 || char >= HZ_CHARS) char = 0;
    if (used.has(char)) { for (let c = 0; c < HZ_CHARS; c++) if (!used.has(c)) { char = c; break; } }
    room.players.set(id, { id, ws, name: cleanName(m.name), char, role: 'survivor' });
    if (!room.hostId) room.hostId = id;
    send(ws, { t: 'joined', id, room: room.code });
    broadcast(room, lobbyMsg(room));
    return;
  }
  const room = rooms.get(ws.room); if (!room) return;
  const me = room.players.get(ws.pid); if (!me) return;

  switch (m.t) {
    case 'char': {
      if (room.phase !== 'lobby') break;
      const c = m.char | 0; if (c < 0 || c >= HZ_CHARS) break;
      me.char = c; broadcast(room, lobbyMsg(room)); break;
    }
    case 'name': me.name = cleanName(m.name); broadcast(room, lobbyMsg(room)); break;
    case 'role': {
      if (room.phase !== 'lobby') break;
      if (m.role === 'ghost') {
        const g = ghostOf(room);
        if (g && g.id !== me.id) return send(ws, { t: 'err', msg: 'Ruh allaqachon band' });
        me.role = 'ghost';
      } else me.role = 'survivor';
      broadcast(room, lobbyMsg(room)); break;
    }
    case 'cfg': {
      if (room.hostId !== me.id || room.phase !== 'lobby') break;
      if (Number.isInteger(m.level) && m.level >= 0 && m.level < HZ_LEVELS) room.level = m.level;
      if ([0, 1, 2].includes(m.diff)) room.diff = m.diff;
      broadcast(room, lobbyMsg(room)); break;
    }
    case 'start': {
      if (room.hostId !== me.id || room.phase !== 'lobby') break;
      if (!list(room).some(p => p.role !== 'ghost')) return send(ws, { t: 'err', msg: 'Kamida bitta omon qolgan o\'yinchi kerak' });
      room.phase = 'playing';
      room.seed = (Math.random() * 0xffffffff) >>> 0;
      const g = ghostOf(room);
      broadcast(room, lobbyMsg(room));
      broadcast(room, { t: 'start', seed: room.seed, level: room.level, diff: room.diff, ghost: g ? g.id : null, host: room.hostId, t0: Date.now() });
      break;
    }
    case 'st':                  // pozitsiya (tez-tez, yo'qolsa mayli)
      if (room.phase !== 'playing' || !Array.isArray(m.s) || m.s.length > 16) break;
      broadcast(room, { t: 'st', id: me.id, s: m.s }, me.id); break;
    case 'gs':                  // AI ruh holati (xona egasidan) yoki ruhning o'z holati
      if (room.phase !== 'playing' || !Array.isArray(m.s) || m.s.length > 16) break;
      if (!(room.hostId === me.id || me.role === 'ghost')) break;
      broadcast(room, { t: 'gs', id: me.id, s: m.s }, me.id); break;
    case 'ev': {                // o'yin hodisalari: shkaf ochildi, kalit, baqiriq, otilgan narsa, o'lim...
      if (room.phase !== 'playing' || !m.e || typeof m.e !== 'object' || typeof m.e.k !== 'string') break;
      if (JSON.stringify(m.e).length > 600) break;
      broadcast(room, { t: 'ev', id: me.id, e: m.e }, me.id); break;
    }
    case 'end': {               // o'yin tugadi (g'alaba/mag'lubiyat) -> hamma lobbiga qaytishi mumkin
      if (room.phase !== 'playing') break;
      if (room.hostId !== me.id && me.role !== 'ghost') break;
      broadcast(room, { t: 'end', win: !!m.win, msg: String(m.msg || '').slice(0, 80) }, me.id); break;
    }
    case 'back':
      if (room.hostId !== me.id) break;
      room.phase = 'lobby';
      broadcast(room, { t: 'back' });
      broadcast(room, lobbyMsg(room)); break;
    case 'chat':
      broadcast(room, { t: 'chat', id: me.id, name: me.name, text: String(m.text || '').slice(0, 100) }); break;
    default: break;
  }
}

export function createHorrorServer() {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8192 });
  wss.on('connection', ws => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', data => { let m; try { m = JSON.parse(data); } catch { return; } if (m && typeof m.t === 'string') { try { handle(ws, m); } catch (e) { console.error('hz error', e); } } });
    ws.on('close', () => leave(ws));
    ws.on('error', () => {});
  });
  const timer = setInterval(() => wss.clients.forEach(ws => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); }), 15000);
  timer.unref();
  return wss;
}
export const horrorRoomCount = () => rooms.size;
