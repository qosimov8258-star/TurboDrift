// Menyu, lobbi, tarmoq oqimi va o'yin boshqaruvi.
import * as THREE from 'three';
import { HAudio } from './audio.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { Game } from './game.js';
import { HNet, LoopNet } from './net.js';
import { CHARS, DEFAULT_CHAR, createActor, preloadActors } from './actors.js';
import { LEVELS, DIFFS } from './levels.js';

const $ = id => document.getElementById(id);
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const SCREENS = ['hzLoading', 'hzSplash', 'hzMenu', 'hzLevels', 'hzLobby', 'hzPause', 'hzEnd', 'hzHowTo'];
const show = (...ids) => { for (const s of SCREENS) $(s).classList.toggle('on', ids.includes(s)); };

const audio = new HAudio();
const input = new Input($('hzCanvas'));
const hud = new Hud();
const game = new Game($('hzCanvas'), audio, input, hud);

const S = {
  name: store.get('hz_name', ''), role: store.get('hz_role', 'survivor'), chars: store.get('hz_chars', { ...DEFAULT_CHAR }), diff: [0, 1, 2].includes(store.get('hz_diff', 1)) ? store.get('hz_diff', 1) : 1, level: store.get('hz_level', 0), done: new Set(store.get('hz_done', [])),
  mode: 'menu', net: null, room: null, myId: null, lobby: null, portraits: [], soloCfg: null, playing: false, pendingLevelFor: 'solo', muted: store.get('hz_muted', false),
};
audio.muted = S.muted;
$('hzSnd').textContent = S.muted ? '🔇' : '🔊';

// brauzer ovozga ruxsat berishi uchun birinchi bosishda
const unlock = () => { audio.init(); if (S.mode === 'start') audio.startMenu(0.22); else if (S.mode === 'menu' || S.mode === 'levels' || S.mode === 'lobby') audio.startMenu(); };
for (const ev of ['pointerdown', 'keydown', 'touchstart']) addEventListener(ev, unlock, { passive: true });

// ---------------------------------------------------------------- portretlar (qahramon rasmlari)
async function makePortraits() {
  const W = 200, H = 250;
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); r.setSize(W, H); r.setClearColor(0x000000, 0);
  r.toneMapping = THREE.ACESFilmicToneMapping;
  const sc = new THREE.Scene(); sc.add(new THREE.HemisphereLight(0xffeedd, 0x331122, 1.6)); const dl = new THREE.DirectionalLight(0xffdcc0, 2.6); dl.position.set(2, 3, 4); sc.add(dl);
  const rim = new THREE.DirectionalLight(0xff3030, 1.8); rim.position.set(-3, 2, -2); sc.add(rim);
  const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 30);
  const out = [];
  for (const def of CHARS) {
    try {
      const a = await createActor(def);
      if (a.mixer) { a.actions.forEach(x => { x.paused = false; }); a.mixer.update(0.2); }
      sc.add(a.root); a.root.rotation.y = -0.3;
      const bb = new THREE.Box3().setFromObject(a.root), sz = bb.getSize(new THREE.Vector3()), ctr = bb.getCenter(new THREE.Vector3());
      const fit = Math.max(sz.y / (2 * Math.tan(THREE.MathUtils.degToRad(15))), sz.x / (2 * Math.tan(THREE.MathUtils.degToRad(15)) * (W / H))) * 1.18 + sz.z * 0.5;
      cam.position.set(0, ctr.y, fit); cam.lookAt(0, ctr.y, 0);
      r.render(sc, cam); out.push(r.domElement.toDataURL('image/png')); sc.remove(a.root);
    } catch (e) { out.push(''); }
  }
  r.dispose(); try { r.forceContextLoss(); } catch {}
  return out;
}

const curChar = () => S.chars[S.role];
function charGrid(el, opts = {}) {
  el.innerHTML = '';
  const role = opts.role || S.role;
  CHARS.forEach((c, i) => {
    if (role === 'survivor' && c.role !== 'survivor') return;
    const d = document.createElement('div'); d.className = 'ch' + (S.chars[role] === i ? ' on' : '');
    const taken = role === 'survivor' && opts.taken && opts.taken.has(i) && S.chars[role] !== i; if (taken) d.classList.add('taken');
    d.innerHTML = `<img alt="${c.name}" src="${S.portraits[i] || ''}"><span>${c.name}</span>`;
    d.onclick = () => { if (taken) return; S.chars[role] = i; store.set('hz_chars', S.chars); audio.uiClick(); renderChars(); if (S.net && !S.net.loop) S.net.send({ t: 'char', char: i }); };
    el.appendChild(d);
  });
}
function setRole(r) { S.role = r; store.set('hz_role', r); renderChars(); }
function renderChars() { $('hzRoleS').classList.toggle('on', S.role === 'survivor'); $('hzRoleG').classList.toggle('on', S.role === 'ghost'); charGrid($('hzChars')); charGrid($('hzLobbyChars'), { taken: S.lobby ? new Set(S.lobby.players.filter(p => p.id !== S.myId).map(p => p.char)) : null }); }

// ---------------------------------------------------------------- daraja tanlash
function renderLevels() {
  const g = $('hzLevelGrid'); g.innerHTML = '';
  LEVELS.forEach((lv, i) => {
    const d = document.createElement('div'); d.className = 'lcard' + (S.level === i ? ' on' : '');
    d.innerHTML = `<div class="n">${i + 1}</div><b>${lv.name}</b><small>${lv.sub}</small><div class="meta">🔑 ${lv.keys} · xona ${Math.round(lv.W * lv.H / 25)}+</div>${S.done.has(i) ? '<div class="done">✓</div>' : ''}`;
    d.onclick = () => { S.level = i; store.set('hz_level', i); audio.uiClick(); renderLevels(); };
    g.appendChild(d);
  });
  for (const b of document.querySelectorAll('#hzLevels .dbtn')) b.classList.toggle('on', +b.dataset.d === S.diff);
}
function setMode(m) { S.mode = m; }

// ---------------------------------------------------------------- menyu
$('hzName').value = S.name;
$('hzName').oninput = e => { S.name = e.target.value; store.set('hz_name', S.name); };
const myName = () => (S.name || '').trim() || 'Qahramon';
$('hzRoleS').onclick = () => setRole('survivor'); $('hzRoleG').onclick = () => setRole('ghost');
$('hzSnd').onclick = () => { S.muted = !S.muted; store.set('hz_muted', S.muted); audio.setMuted(S.muted); $('hzSnd').textContent = S.muted ? '🔇' : '🔊'; };
$('hzHow').onclick = () => show('hzHowTo'); $('hzHowBack').onclick = () => show('hzMenu');
$('hzSolo').onclick = () => { audio.uiClick(); S.pendingLevelFor = 'solo'; $('hzLevelGoTxt').textContent = 'BOSHLASH'; renderLevels(); setMode('levels'); show('hzLevels'); };
$('hzFriends').onclick = () => { audio.uiClick(); $('hzJoinBox').classList.remove('hidden'); $('hzSolo').classList.add('hidden'); $('hzFriends').classList.add('hidden'); $('hzHow').classList.add('hidden'); };
$('hzJoinBack').onclick = () => { $('hzJoinBox').classList.add('hidden'); $('hzSolo').classList.remove('hidden'); $('hzFriends').classList.remove('hidden'); $('hzHow').classList.remove('hidden'); $('hzMenuErr').textContent = ''; };
$('hzLevelBack').onclick = () => { if (S.pendingLevelFor === 'lobby') { setMode('lobby'); show('hzLobby'); } else { setMode('menu'); show('hzMenu'); } };
for (const b of document.querySelectorAll('.dbtn')) b.onclick = () => { S.diff = +b.dataset.d || 0; store.set('hz_diff', S.diff); for (const x of document.querySelectorAll('.dbtn')) x.classList.toggle('on', +x.dataset.d === S.diff); if (b.classList.contains('lb')) cfgSend(); };
$('hzLevelGo').onclick = () => {
  audio.uiClick();
  if (S.pendingLevelFor === 'lobby') { cfgSend(); setMode('lobby'); show('hzLobby'); return; }
  startSolo(S.level);
};

// ---------------------------------------------------------------- yakka o'yin
async function startSolo(level, seed) {
  S.soloCfg = { level, seed };
  const net = new LoopNet(); S.net = net; S.room = null; S.myId = 'solo';
  const ghost = S.role === 'ghost';
  const me = { id: 'solo', name: myName(), char: curChar(), role: S.role };
  const players = [me];
  if (ghost) for (let i = 0; i < 2; i++) players.push({ id: 'bot' + i, name: ['Rustam', 'Dilnoza'][i] + ' 🤖', char: i, role: 'survivor', bot: true });
  await launch({ net, me, players, level, seed: seed ?? (Math.random() * 4e9) >>> 0, diff: S.diff, ghostId: ghost ? 'solo' : null, hostId: 'solo', t0: Date.now() });
}

async function launch(cfg) {
  show('hzLoading'); $('hzLoadText').textContent = 'Uy quriladi…'; $('hzLoadFill').style.width = '40%';
  setMode('playing'); S.playing = true;
  await new Promise(r => setTimeout(r, 60));
  try {
    await game.start(cfg);
  } catch (e) {
    console.error(e); S.playing = false; game.stop(); show('hzMenu'); setMode('menu'); $('hzMenuErr').textContent = 'Xatolik: ' + e.message; return;
  }
  $('hzLoadFill').style.width = '100%';
  show();           // hamma ekranlar yopiladi — o'yin
  game.paused = false; S.firstLock = true;
  if (!input.touch.on) input.lock();
}
game.onEnd = f => {
  S.playing = false;
  hud.hide();
  const cfg = game.cfg;
  if (f.win && cfg.me.role === 'survivor') { S.done.add(cfg.level); store.set('hz_done', [...S.done]); }
  const ghostMe = cfg.me.role === 'ghost';
  const good = ghostMe ? !f.win : f.win;
  $('hzEndT').textContent = ghostMe ? (f.win ? 'ULAR QOCHIB QUTULDI…' : 'SIZ G\'ALABA QOZONDINGIZ!') : (f.win ? 'QOCHIB QUTULDINGIZ!' : 'RUH G\'ALABA QOZONDI'); $('hzEndT').style.color = good ? '#6fe08a' : '#e0201c';
  $('hzEndS').textContent = f.msg || '';
  const solo = S.net && S.net.loop;
  $('hzAgainTxt').textContent = solo ? 'YANA O\'YNASH' : (S.lobby && S.lobby.host === S.myId ? 'LOBBIGA QAYTISH' : 'XONA EGASINI KUTING…');
  $('hzAgain').disabled = !solo && !(S.lobby && S.lobby.host === S.myId);
  $('hzNext').classList.toggle('hidden', !(solo && f.win && cfg.level < LEVELS.length - 1));
  setTimeout(() => show('hzEnd'), 1500);
};
$('hzAgain').onclick = () => { if (S.net && S.net.loop) { game.stop(); startSolo(S.soloCfg.level); } else if (S.lobby && S.lobby.host === S.myId) S.net.send({ t: 'back' }); };
$('hzNext').onclick = () => { game.stop(); startSolo(S.soloCfg.level + 1); };
$('hzEndMenu').onclick = () => toMenu();
function toMenu() {
  game.stop(); hud.hide(); S.playing = false;
  if (S.net && !S.net.loop) { S.net.close(); } S.net = null; S.lobby = null; S.room = null;
  setMode('menu'); show('hzMenu'); audio.startMenu();
  $('hzJoinBack').click();
}
// pauza (pointer lock yo'qolganda)
const NOPAUSE = new URLSearchParams(location.search).has('nopause') || new URLSearchParams(location.search).has('bot');
input.onLock = locked => {
  if (NOPAUSE || !S.playing || game.sim?.over) return;
  if (!locked && !input.touch.on) { const first = S.firstLock; S.firstLock = false; $('hzPauseT').textContent = first ? 'Tayyormisiz?' : 'To\'xtatildi'; $('hzResumeTxt').textContent = first ? 'BOSHLASH' : 'DAVOM ETISH'; $('hzPause').classList.add('on'); if (S.net && S.net.loop) { game.paused = true; try { audio.ctx && audio.ctx.suspend(); } catch {} } }
  else { S.firstLock = false; $('hzPause').classList.remove('on'); game.paused = false; try { audio.ctx && audio.ctx.resume(); } catch {} }
};
$('hzResume').onclick = () => { $('hzPause').classList.remove('on'); game.paused = false; try { audio.ctx && audio.ctx.resume(); } catch {} input.lock(); };
$('hzQuit').onclick = () => { $('hzPause').classList.remove('on'); toMenu(); };

// ---------------------------------------------------------------- do'stlar bilan
async function connect() {
  if (S.net && !S.net.loop) { S.net.onclose = null; S.net.close(); }
  const net = new HNet(); S.net = net;
  net.onmessage = onNet;
  net.onclose = () => { if (S.mode !== 'menu') { toMenu(); $('hzJoinBox').classList.remove('hidden'); $('hzSolo').classList.add('hidden'); $('hzFriends').classList.add('hidden'); $('hzHow').classList.add('hidden'); $('hzMenuErr').textContent = 'Server bilan aloqa uzildi'; } };
  await net.connect();
  return net;
}
async function joinRoom(code) {
  $('hzMenuErr').textContent = '';
  try { const net = await connect(); net.send({ t: 'join', name: myName(), char: S.chars.survivor, room: code || undefined }); }
  catch (e) { $('hzMenuErr').textContent = e.message; }
}
$('hzCreate').onclick = () => joinRoom(null);
$('hzJoin').onclick = () => { const c = $('hzRoomIn').value.trim().toUpperCase(); if (c.length !== 4) { $('hzMenuErr').textContent = '4 harfli kodni kiriting'; return; } joinRoom(c); };
$('hzRoomIn').onkeydown = e => { if (e.key === 'Enter') $('hzJoin').click(); };

function onNet(m) {
  switch (m.t) {
    case 'joined': S.myId = m.id; S.room = m.room; break;
    case 'err': if (S.mode === 'lobby') $('hzLobbyErr').textContent = m.msg; else $('hzMenuErr').textContent = m.msg; if (S.mode === 'menu' && S.net) { /* qoladi */ } break;
    case 'lobby': S.lobby = m; if (S.mode !== 'playing') { if (S.mode !== 'lobby') { setMode('lobby'); show('hzLobby'); } renderLobby(); } if (S.playing && game.sim) game.sim.handleNet(m); break;
    case 'start': {
      const l = S.lobby; if (!l) break;
      const players = l.players.map(p => ({ id: p.id, name: p.name, char: p.char, role: p.id === m.ghost ? 'ghost' : 'survivor' }));
      const me = players.find(p => p.id === S.myId); if (!me) break;
      audio.init();
      launch({ net: S.net, me, players, level: m.level, seed: m.seed, diff: m.diff, ghostId: m.ghost, hostId: m.host, t0: m.t0 });
      break;
    }
    case 'back': game.stop(); hud.hide(); S.playing = false; setMode('lobby'); show('hzLobby'); audio.startMenu(); input.unlock(); break;
    default: if (S.playing && game.sim) game.sim.handleNet(m);
  }
}
function cfgSend() { if (S.net && !S.net.loop && S.lobby && S.lobby.host === S.myId) S.net.send({ t: 'cfg', level: S.level, diff: S.diff }); }
function renderLobby() {
  const l = S.lobby; if (!l) return;
  $('hzCode').textContent = l.room; S.room = l.room;
  const host = l.host === S.myId;
  const pl = $('hzPlist'); pl.innerHTML = '';
  for (const p of l.players) {
    const d = document.createElement('div'); d.className = 'prow' + (p.id === S.myId ? ' me' : '');
    d.innerHTML = `<img alt="" src="${S.portraits[p.char] || ''}"><div class="nm"></div><span class="rl ${p.role === 'ghost' ? 'ghost' : ''}">${p.role === 'ghost' ? '👻 RUH' : 'OMON QOLGAN'}</span>`;
    d.querySelector('.nm').textContent = p.name; if (p.id === l.host) { const c = document.createElement('i'); c.textContent = '👑'; d.querySelector('.nm').appendChild(c); }
    pl.appendChild(d);
  }
  const meL = l.players.find(p => p.id === S.myId); if (meL) S.role = meL.role;
  renderChars();
  const lv = LEVELS[l.level] || LEVELS[0];
  $('hzLobbyLv').textContent = l.level + 1; $('hzLobbyLvName').textContent = lv.name; $('hzLobbyLvSub').textContent = lv.sub;
  $('hzHostBox').classList.toggle('hidden', !host); $('hzWait').classList.toggle('hidden', host);
  for (const b of document.querySelectorAll('.dbtn.lb')) b.classList.toggle('on', +b.dataset.d === l.diff);
  const me = l.players.find(p => p.id === S.myId); const other = l.players.find(p => p.role === 'ghost' && p.id !== S.myId);
  $('hzRole').textContent = me && me.role === 'ghost' ? 'OMON QOLGAN BO\'LISH' : 'RUH BO\'LISH'; $('hzRole').disabled = !!other && me && me.role !== 'ghost';
  S.level = l.level; S.diff = l.diff;
}
$('hzRole').onclick = () => { const me = S.lobby.players.find(p => p.id === S.myId); const r = me.role === 'ghost' ? 'survivor' : 'ghost'; S.net.send({ t: 'role', role: r }); S.net.send({ t: 'char', char: S.chars[r] }); };
$('hzLobbyPick').onclick = () => { S.pendingLevelFor = 'lobby'; $('hzLevelGoTxt').textContent = 'TANLASH'; renderLevels(); show('hzLevels'); };
$('hzStart').onclick = () => { $('hzLobbyErr').textContent = ''; cfgSend(); S.net.send({ t: 'start' }); };
$('hzLobbyLeave').onclick = () => toMenu();
$('hzCopy').onclick = async () => {
  let base = location.origin;
  try { if (/^(localhost|127\.)/.test(location.hostname)) { const r = await fetch('/info'); const j = await r.json(); if (j.urls && j.urls[0]) base = j.urls[0]; } } catch {}
  const link = `${base}/horror?room=${S.room}`;
  try { await navigator.clipboard.writeText(link); hudToast('Havola nusxalandi: ' + link); } catch { prompt('Do\'stlarga yuboring:', link); }
};
function hudToast(t) { const e = $('hzLobbyErr'); e.style.color = '#8fe39b'; e.textContent = t; setTimeout(() => { e.textContent = ''; e.style.color = ''; }, 3500); }

// ---------------------------------------------------------------- boshlash
(async function boot() {
  const fill = $('hzLoadFill'); fill.style.width = '10%';
  try {
    await preloadActors(CHARS); fill.style.width = '60%';
    S.portraits = await makePortraits(); fill.style.width = '100%';
  } catch (e) { console.warn(e); }
  for (const r of ['survivor', 'ghost']) if (!CHARS[S.chars[r]] || (r === 'survivor' && CHARS[S.chars[r]].role !== r)) S.chars[r] = DEFAULT_CHAR[r];
  renderChars(); renderLevels();
  const q = new URLSearchParams(location.search);
  if (q.get('role') === 'ghost') S.role = 'ghost';
  if (q.has('solo')) { setMode('playing'); startSolo(Math.max(0, Math.min(LEVELS.length - 1, +q.get('solo') | 0)), q.has('seed') ? +q.get('seed') >>> 0 : undefined); return; }
  if (q.has('nostart') || q.has('bot')) { setMode('menu'); show('hzMenu'); if (q.get('room')) { $('hzFriends').click(); $('hzRoomIn').value = q.get('room').toUpperCase().slice(0, 4); } }
  else { setMode('start'); show('hzSplash'); audio.startMenu(0.22); setTimeout(() => $('hzStartBtn').classList.add('show'), 3000); }
  $('hzStartBtn').onclick = () => {
    audio.init(); audio.stopMenu(300);
    const v = $('hzVideo'); let done = false;
    const go = () => { if (done) return; done = true; v.pause(); v.classList.add('hidden'); setMode('menu'); show('hzMenu'); audio.startMenu();
      if (q.get('room')) { $('hzFriends').click(); $('hzRoomIn').value = q.get('room').toUpperCase().slice(0, 4); } };
    show(); v.src = '/horror-files/music/short.mp4#t=0.51'; v.classList.remove('hidden'); v.muted = false; v.volume = 1;
    v.onended = go; v.onerror = go;
    const p = v.play(); if (p && p.catch) p.catch(() => { v.muted = true; v.play().catch(go); });
    setTimeout(() => { if (!done && v.paused && v.currentTime === 0) go(); }, 6000);
  };
  if ('ontouchstart' in window || matchMedia('(pointer:coarse)').matches) { input.setupTouch($('hzTouch')); $('hzTouch').classList.remove('hidden'); }
})();
window.__hzMain = { S, game, audio, input, startSolo, toMenu };
