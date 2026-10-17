import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { prepareCar } from './carmodel.js';
import { CAR_DEFS } from './car.js';
import { Showroom } from './showroom.js';
import { Race, fmt, pixelRatioFor } from './race.js';
import { TRACKS } from './trackdata.js';
import { TrackPicker, drawPreview, trackInfo, LEVELS } from './trackpicker.js';
import { HUD, escapeHtml } from './hud.js';
import { GameAudio } from './audio.js';
import { Net } from './net.js';
import { icon, iconize } from './icons.js';
import { PAINTS } from './paint.js';
import { touch, initTouch, releaseAll, isTouchDevice } from './touch.js';
import { ABILITIES, LOADOUT_SIZE, slotByCode } from './abilities.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ls = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* noop */ } } };

// ------------------------------------------------------------------ renderer
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
// UI scale: the interface is designed for ~1600x900 css px; bigger screens (4K, big monitors) scale it up so it stays crisp and readable
function applyUiScale() {
  const w = window.innerWidth, h = window.innerHeight;
  const ui = Math.min(2.6, Math.max(1, Math.min(w / 1600, h / 900)));
  const r = document.documentElement.style;
  r.setProperty('--ui', ui.toFixed(3));
  r.setProperty('--vw', (w / ui / 100).toFixed(3) + 'px');
  r.setProperty('--vh', (h / ui / 100).toFixed(3) + 'px');
  hud.setScale?.(ui);
}
const resize = () => { renderer.setPixelRatio(pixelRatioFor(S.quality)); renderer.setSize(window.innerWidth, window.innerHeight, false); applyUiScale(); };
window.addEventListener('resize', resize);

const audio = new GameAudio();
const hud = new HUD();
const net = new Net();
let showroom = null, race = null, protos = [];

const ARENA = TRACKS.findIndex(t => t.id === 'arena');          // battle track: not listed in the track picker
const DEBUG = new URLSearchParams(location.search).has('debug');
const dbg = (...a) => { if (DEBUG) console.log('[dbg]', ...a); };
const S = {
  screen: 'loading', mode: 'solo', name: ls.get('td_name') || '', myId: 'me', hostId: 'me', room: null,
  players: [], laps: 3, bots: 3, browse: 0, soloCar: 0, paused: false, lobbyMsg: null, raceActive: false, quality: ls.get('td_q') || 'high',
  track: Math.min(TRACKS.length - 1, Math.max(0, parseInt(ls.get('td_track'), 10) || 0)),
  loadout: [...new Set((ls.get('td_lo') || '').split(',').filter(x => x !== '').map(Number))].filter(i => Number.isInteger(i) && i >= 0 && i < ABILITIES.length).slice(0, LOADOUT_SIZE),   // 3 battle abilities (indices into ABILITIES)
  game: ls.get('td_game') === 'battle' ? 'battle' : 'race',   // 'race' | 'battle' (Jang Arena)
  paint: -1,   // colour picker removed: always factory colours
  touchUI: isTouchDevice(),
};
if (!['ultra', 'high', 'medium', 'low'].includes(S.quality)) S.quality = 'high';
resize();
$('nameInput').value = S.name;

function toast(msg, ms = 2600) { const t = $('toast'); t.innerHTML = iconize(msg); t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), ms); }
function show(id, on = true) { $(id).classList.toggle('on', on); }
function syncGarageSound() { audio.garageIdle(S.screen === 'lobby' && CAR_DEFS[S.browse]?.id === 'supra_mk4'); }
function setScreen(s) {
  S.screen = s;
  for (const id of ['loading', 'menu', 'lobby', 'results', 'pause', 'help']) show(id, id === s);
  hud.show(s === 'race');
  document.body.dataset.screen = s;
  if (s !== 'race') releaseAll();
  if (showroom) { showroom.setOffset(s === 'menu' ? 0.2 : 0); showroom.setInteractive(s === 'lobby'); }
  syncGarageSound();
}
function applyTouchUI() { document.body.classList.toggle('touch', S.touchUI); $('hbTouch').classList.toggle('on', S.touchUI); }
const myName = () => ($('nameInput').value.trim() || 'Poygachi').slice(0, 14);

// ------------------------------------------------------------------ loading
async function loadAll() {
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  const fill = $('loadFill'), text = $('loadText');
  const frac = new Array(CAR_DEFS.length).fill(0);
  const update = () => { fill.style.width = (frac.reduce((a, b) => a + b, 0) / CAR_DEFS.length * 80).toFixed(1) + '%'; };
  const gltfs = await Promise.all(CAR_DEFS.map((d, i) => new Promise((res, rej) => {
    loader.load(`/models/${d.id}.glb`, res, e => { if (e.total) { frac[i] = e.loaded / e.total; update(); } }, rej);
  }).then(g => { frac[i] = 1; update(); return g; })));
  for (let i = 0; i < gltfs.length; i++) {
    text.textContent = `Tayyorlanmoqda: ${CAR_DEFS[i].name}…`;
    await new Promise(r => setTimeout(r, 20));
    const t0 = performance.now();
    const res = prepareCar(gltfs[i].scene, { front: CAR_DEFS[i].front });
    dbg('prepare', CAR_DEFS[i].id, (performance.now() - t0).toFixed(0) + 'ms');
    if (!res.ok) console.warn('wheel detection failed for', CAR_DEFS[i].id);
    protos.push(res.root);
    fill.style.width = (80 + (i + 1) / gltfs.length * 12).toFixed(1) + '%';
  }
  text.textContent = 'Trassa qurilmoqda…';
  await new Promise(r => setTimeout(r, 30));
  const t1 = performance.now();
  showroom = new Showroom(renderer, protos, CAR_DEFS);
  showroom.paint = S.paint;
  dbg('showroom', (performance.now() - t1).toFixed(0) + 'ms');
  race = new Race(renderer, protos, audio, hud, { track: S.track, quality: S.quality });
  dbg('race build', (performance.now() - t1).toFixed(0) + 'ms');
  race.msg = (t, ms, k) => hud.message(t, ms, k);
  race.onEnd = list => showResults(list);
  hud.onAbility = i => race && race.useAbility(i);
  fill.style.width = '100%';
  await new Promise(r => setTimeout(r, 30));
}

// ------------------------------------------------------------------ input
const keys = new Set();
const gp = { steer: 0, thr: 0, brk: 0, hb: false, nitro: false };
function pollPad() {
  const pad = (navigator.getGamepads && navigator.getGamepads()[0]) || null;
  if (!pad) { gp.steer = gp.thr = gp.brk = 0; gp.hb = gp.nitro = false; return; }
  const ax = pad.axes[0] || 0; gp.steer = Math.abs(ax) > 0.12 ? ax : 0;
  gp.thr = pad.buttons[7]?.value || 0; gp.brk = pad.buttons[6]?.value || 0;
  gp.hb = !!pad.buttons[2]?.pressed; gp.nitro = !!(pad.buttons[0]?.pressed || pad.buttons[1]?.pressed);
  if (pad.buttons[5]?.pressed && !pollPad.l5) race?.me?.v?.shift(1); pollPad.l5 = pad.buttons[5]?.pressed;
  if (pad.buttons[4]?.pressed && !pollPad.l4) race?.me?.v?.shift(-1); pollPad.l4 = pad.buttons[4]?.pressed;
}
function readInput() {
  pollPad();
  const k = c => keys.has(c);
  const inp = race.input;
  inp.throttle = Math.max(k('KeyW') || k('ArrowUp') ? 1 : 0, gp.thr, touch.thr);
  inp.brake = Math.max(k('KeyS') || k('ArrowDown') ? 1 : 0, gp.brk, touch.brk);
  inp.steer = clamp(((k('KeyD') || k('ArrowRight')) ? 1 : 0) - ((k('KeyA') || k('ArrowLeft')) ? 1 : 0) + gp.steer + touch.steer, -1, 1);
  inp.handbrake = (k('Space') && !race.battle) || gp.hb || touch.hb;
  inp.nitro = k('ShiftLeft') || k('ShiftRight') || gp.nitro || touch.nitro;
}

window.addEventListener('keydown', e => {
  if (e.target && e.target.tagName === 'INPUT') { if (e.code === 'Enter') { if (e.target.id === 'roomInput') $('btnJoin').click(); } return; }
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  if (e.repeat) { keys.add(e.code); return; }
  keys.add(e.code);
  audio.init();
  if (picker.isOpen) { if (e.code === 'Escape') picker.close(); else if (e.code === 'Enter') picker.confirm(); return; }
  if (S.screen === 'lobby') {
    if (e.code === 'ArrowLeft') browse(-1); else if (e.code === 'ArrowRight') browse(1); else if (e.code === 'Enter') pickCar();
    return;
  }
  if (S.screen !== 'race' && S.screen !== 'results') { if (e.code === 'Escape' && $('help').classList.contains('on')) closeHelp(); return; }
  if (e.code === 'Escape' && $('help').classList.contains('on')) { closeHelp(); return; }
  if (!race || S.screen === 'results') return;
  const v = race.me && race.me.v;
  if (race.battle && S.screen === 'race' && !S.paused) {              // battle: keys 1 2 3 fire the 3 abilities picked in the lobby, so they no longer select gears
    const slot = slotByCode(e.code);
    if (slot >= 0) { race.useAbility(slot); return; }
  }
  switch (e.code) {
    case 'KeyE': if (v) v.shift(1); break;
    case 'PageUp': if (v) v.shift(1); break;
    case 'KeyQ': if (v) v.shift(-1); break;
    case 'PageDown': if (v) v.shift(-1); break;
    case 'Digit1': case 'Numpad1': if (v) v.setGear(1); break;
    case 'Digit2': case 'Numpad2': if (v) v.setGear(2); break;
    case 'Digit3': case 'Numpad3': if (v) v.setGear(3); break;
    case 'Digit4': case 'Numpad4': if (v) v.setGear(4); break;
    case 'Digit5': case 'Numpad5': if (v) v.setGear(5); break;
    case 'KeyX': if (v) { v.auto = !v.auto; toast(v.auto ? 'Avto uzatma' : 'Qo\'lda uzatma'); } break;
    case 'Space': if (v && race.battle && !race.me.dead) v.jump(); break;
    case 'KeyC': cycleCamera(); break;
    case 'KeyR': if (race.me?.def.id === 'charger') race.fireTow(); break;
    case 'KeyT': race.respawn(); break;
    case 'KeyM': toggleMute(); break;
    case 'KeyH': toggleHelp(); break;
    case 'Escape': togglePause(); break;
    default: break;
  }
});
window.addEventListener('keyup', e => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
document.addEventListener('pointerdown', () => audio.init(), { once: false });

// ------------------------------------------------------------------ menu
$('btnSolo').onclick = () => { audio.init(); S.mode = 'solo'; S.name = myName(); ls.set('td_name', S.name); enterLobby(); };
$('btnFriends').onclick = () => { audio.init(); $('friendsBox').classList.toggle('hidden'); };
$('btnFriendsBack').onclick = () => { $('friendsBox').classList.add('hidden'); $('menuErr').textContent = ''; };
$('btnHelp').onclick = () => toggleHelp(true);
$('btnTracks').onclick = () => { audio.init(); picker.open(S.track); };
$('btnTrackOpen').onclick = () => { audio.init(); picker.open(S.track); };
$('btnQualityMenu').onclick = () => cycleQuality();

// sound / camera / fullscreen / touch controls (menu, lobby and the in-race toolbar)
function syncMuteUi() {
  const m = audio.muted;
  $('hbMute').innerHTML = icon(m ? 'mute' : 'vol'); $('hbMute').classList.toggle('on', m);
  $('btnMuteMenu').innerHTML = icon(m ? 'mute' : 'vol') + `<span id="muteLabelMenu">${m ? 'Ovoz o\'chiq' : 'Ovoz yoqiq'}</span>`;
}
function toggleMute() { audio.setMuted(!audio.muted); syncMuteUi(); toast(audio.muted ? '{mute} Ovoz o\'chirildi' : '{vol} Ovoz yoqildi', 1200); }
function cycleCamera() { if (!race) return; race.camMode = (race.camMode + 1) % 3; toast('{cam} ' + ['Kamera: orqadan', 'Kamera: uzoqdan', 'Kamera: bamper'][race.camMode], 1200); }
const canFull = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
function toggleFull() {
  const d = document, el = d.documentElement;
  if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
  else (el.requestFullscreen || el.webkitRequestFullscreen).call(el).catch?.(() => {});
}
function syncFullUi() {
  const on = !!(document.fullscreenElement || document.webkitFullscreenElement);
  for (const id of ['hbFull', 'btnFullLobby']) $(id).innerHTML = icon(on ? 'shrink' : 'expand');
  $('btnFullMenu').innerHTML = icon(on ? 'shrink' : 'expand') + (on ? 'Oynada ko\'rish' : 'To\'liq ekran');
}
if (!canFull) for (const id of ['hbFull', 'btnFullLobby', 'btnFullMenu']) $(id).classList.add('hidden');
document.addEventListener('fullscreenchange', () => { syncFullUi(); resize(); });
document.addEventListener('webkitfullscreenchange', () => { syncFullUi(); resize(); });
$('btnMuteMenu').onclick = () => { audio.init(); toggleMute(); };
$('btnFullMenu').onclick = toggleFull; $('btnFullLobby').onclick = toggleFull; $('hbFull').onclick = toggleFull;
$('hbPause').onclick = () => togglePause();
$('hbCam').onclick = cycleCamera;
$('hbMute').onclick = toggleMute;
$('hbRespawn').onclick = () => race && race.respawn();
$('hbHelp').onclick = () => toggleHelp();
$('hbTouch').onclick = () => { S.touchUI = !S.touchUI; applyTouchUI(); if (race?.me?.v) race.me.v.auto = S.touchUI; if (!S.touchUI) releaseAll(); };
$('btnHelpLobby').onclick = () => toggleHelp(true);
$('btnTrackTop').onclick = () => { audio.init(); picker.open(S.track); };
$('btnAutoRot').onclick = () => { const on = !$('btnAutoRot').classList.contains('on'); $('btnAutoRot').classList.toggle('on', on); showroom.setAutoRotate(on); };
$('btnViewReset').onclick = () => showroom.resetView();
initTouch($('touchUI'), d => { const v = race?.me?.v; if (v) v.shift(d); });
syncMuteUi(); syncFullUi(); applyTouchUI();
$('btnHelpClose').onclick = closeHelp;
$('btnPauseHelp').onclick = () => toggleHelp(true);
let helpFrom = null;
function toggleHelp(force) {
  const open = force ?? !$('help').classList.contains('on');
  if (open) { helpFrom = S.screen; show('help', true); $('help').style.zIndex = 40; } else closeHelp();
}
function closeHelp() { show('help', false); }
$('btnCreate').onclick = () => joinOnline(null);
$('btnJoin').onclick = () => { const c = $('roomInput').value.trim().toUpperCase(); if (c.length !== 4) { $('menuErr').textContent = '4 harfli kodni kiriting'; return; } joinOnline(c); };
$('roomInput').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });
{
  const q = new URLSearchParams(location.search).get('room');
  if (q) { $('roomInput').value = q.toUpperCase().slice(0, 4); $('friendsBox').classList.remove('hidden'); }
}

async function joinOnline(code) {
  S.name = myName(); ls.set('td_name', S.name);
  $('menuErr').textContent = '';
  try {
    if (!net.connected) { net.close(); await net.connect(); bindNet(); }
  } catch (e) { $('menuErr').textContent = 'Serverga ulanib bo\'lmadi. O\'yin serveri ishlayaptimi? (npm start)'; return; }
  net.send({ t: 'join', name: S.name, room: code });
}

const sendConfig = () => net.send({ t: 'config', laps: S.laps, bots: S.bots, track: S.track, mode: S.game });

function bindNet() {
  net.on.joined = m => { S.mode = 'online'; S.myId = m.id; S.room = m.room; if (S.paint >= 0) net.send({ t: 'color', color: S.paint }); };
  net.on.err = m => { if (S.screen === 'menu') $('menuErr').textContent = m.msg; else toast(m.msg, 3500); };
  net.on.lobby = m => {
    S.lobbyMsg = m; S.players = m.players; S.hostId = m.host; S.room = m.room;
    if (S.screen === 'menu' && m.host === S.myId) sendConfig();   // room creator: push our own choices
    else { S.laps = m.laps; S.bots = m.bots; S.game = m.mode === 'battle' ? 'battle' : 'race'; if (m.track != null) setTrack(m.track, false); }
    if (S.screen === 'menu') { enterLobby(); const me = m.players.find(p => p.id === S.myId); if (me && me.car >= 0) S.browse = me.car; showroom.show(S.browse); }
    if (S.screen === 'lobby') renderLobby();
  };
  net.on.start = m => { if (m.track != null) setTrack(m.track, false); startOnlineRace(m); };
  net.on.st = m => race && race.onState(m.id, m.s);
  net.on.fin = m => race && race.onFinish(m.id, m.time);
  net.on.ab = m => race && race.onAbility(m.id, m.k, m.p);
  net.on.tow = m => race && race.onTow(m.id, m.to, m.on);
  net.on.results = m => showResults(m.list);
  net.on.left = m => { if (race && S.screen === 'race' || S.screen === 'results') race && race.removeRacer(m.id); };
  net.on.botsGone = () => { if (!race) return; for (const r of [...race.racers.values()]) if (r.bot && r.kind === 'remote') race.removeRacer(r.id); toast('Xona egasi chiqib ketdi — botlar olib tashlandi'); };
  net.on.back = () => { leaveRaceView(); setScreen('lobby'); renderLobby(); };
  net.on.close = () => { if (S.mode === 'online') { toast('Server bilan aloqa uzildi', 4000); toMenu(); } };
}

// ------------------------------------------------------------------ lobby
function enterLobby() {
  setScreen('lobby');
  if (S.mode === 'solo') {
    S.myId = 'me'; S.hostId = 'me'; S.room = null;
    S.players = [{ id: 'me', name: S.name, car: S.soloPicked ? S.soloCar : -1, bot: false, color: S.paint }];
    S.bots = Math.min(S.bots, 6);
  }
  $('roomBox').classList.toggle('hidden', S.mode === 'solo');
  showroom.setOffset?.(0);
  showroom.show(S.browse);
  syncGarageSound();
  renderLobby();
  if (S.mode === 'online') loadLan();
}

async function loadLan() {
  const box = $('lanInfo');
  try {
    const info = await (await fetch('/info')).json();
    S.lan = info.urls || [];
    box.classList.remove('hidden');
    box.innerHTML = `Do'stlar shu manzilga kirsin (bir WiFi):<br>${S.lan.map(u => `<b>${u}</b>`).join('<br>') || '—'}<br>Xona kodi: <b>${S.room}</b>`;
  } catch (e) { box.classList.add('hidden'); }
}

$('lobbyBack').onclick = () => { if (S.mode === 'online') { net.close(); } toMenu(); };
$('btnCopy').onclick = async () => {
  const base = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') && S.lan && S.lan[0] ? S.lan[0] : location.origin;
  const link = `${base}/?room=${S.room}`;
  try { await navigator.clipboard.writeText(link); toast('Havola nusxalandi: ' + link, 3500); } catch (e) { toast(link, 5000); }
};
$('carPrev').onclick = () => browse(-1);
$('carNext').onclick = () => browse(1);
$('btnPick').onclick = pickCar;
function paintHex(p, cd) { return p != null && p >= 0 && PAINTS[p] ? PAINTS[p].hex : (cd ? cd.color : 'transparent'); }
function browse(d) { S.browse = (S.browse + d + CAR_DEFS.length) % CAR_DEFS.length; showroom.show(S.browse); renderLobby(); syncGarageSound(); }
function carOwner(i) { return S.players.find(p => p.car === i); }
function pickCar() {
  const owner = carOwner(S.browse);
  if (owner && owner.id === S.myId) {   // already mine -> cancel selection
    if (S.mode === 'solo') { S.soloCar = -1; S.soloPicked = false; S.players[0].car = -1; renderLobby(); }
    else net.send({ t: 'unpick' });
    audio.beep(440, 0.12, 0.15);
    return;
  }
  if (owner && owner.id !== S.myId) { toast('Bu mashina band!'); return; }
  if (S.mode === 'solo') { S.soloCar = S.browse; S.soloPicked = true; S.players[0].car = S.browse; S.players[0].color = S.paint; renderLobby(); }
  else net.send({ t: 'pick', car: S.browse, color: S.paint });
  audio.beep(660, 0.12, 0.15);
}
$('modeSw').querySelectorAll('button').forEach(b => {
  b.onclick = () => {
    if (S.hostId !== S.myId || S.game === b.dataset.m) return;
    S.game = b.dataset.m; ls.set('td_game', S.game);
    if (S.mode === 'online') sendConfig();
    audio.beep(520, 0.1, 0.12);
    renderLobby();
  };
});
document.querySelectorAll('.stepper button').forEach(b => {
  b.onclick = () => {
    const k = b.dataset.k, d = +b.dataset.d;
    if (k === 'laps') S.laps = clamp(S.laps + d, 1, 10); else S.bots = clamp(S.bots + d, 0, S.mode === 'solo' ? 6 : 6);
    if (S.mode === 'online') sendConfig();
    renderLobby();
  };
});

function renderLobby() {
  const isHost = S.hostId === S.myId;
  const def = CAR_DEFS[S.browse];
  $('carIndex').textContent = `${S.browse + 1} / ${CAR_DEFS.length}`;
  $('carName').textContent = def.name.toUpperCase();
  const owner = carOwner(S.browse);
  const st = $('carState'), btn = $('btnPick');
  if (owner && owner.id === S.myId) { st.className = 'state mine'; st.innerHTML = icon('check') + 'Siz tanlagansiz'; btn.disabled = false; btn.innerHTML = icon('x') + 'BEKOR QILISH'; }
  else if (owner) { st.className = 'state taken'; st.innerHTML = icon('lock') + `Band — ${escapeHtml(owner.name)} tanlagan`; btn.disabled = true; btn.innerHTML = icon('lock') + 'BAND'; }
  else { st.className = 'state free'; st.textContent = 'Bo\'sh'; btn.disabled = false; btn.innerHTML = icon('check') + 'TANLASH'; }
  // dots
  $('carDots').innerHTML = CAR_DEFS.map((d, i) => {
    const o = carOwner(i);
    return `<i class="${i === S.browse ? 'cur ' : ''}${o && o.id !== S.myId ? 'taken ' : ''}${o && o.id === S.myId ? 'mine' : ''}" style="background:${d.color}" data-i="${i}" title="${d.name}"></i>`;
  }).join('');
  $('carDots').querySelectorAll('i').forEach(i => { i.onclick = () => { S.browse = +i.dataset.i; showroom.show(S.browse); renderLobby(); syncGarageSound(); }; });
  // players
  const rows = S.players.filter(p => !p.bot).map(p => {
    const cd = p.car >= 0 ? CAR_DEFS[p.car] : null;
    return `<li class="${p.id === S.myId ? 'me' : ''}"><i style="background:${paintHex(p.color, cd)}"></i><div>${escapeHtml(p.name)}${p.id === S.hostId ? icon('crown', 'host') : ''}<small>${cd ? cd.name : 'mashina tanlanmagan'}</small></div>${cd ? '<span class="ok">' + icon('check') + '</span>' : ''}</li>`;
  });
  const humans = rows.length;
  for (let i = humans; i < 7; i++) rows.push('<li class="empty"><i></i><div>Bo\'sh joy<small>kutilmoqda…</small></div></li>');
  $('plList').innerHTML = rows.join('');
  $('plCount').textContent = `${humans}/7`;
  $('roomCode').textContent = S.room || '----';
  $('lapsVal').textContent = S.laps; $('botsVal').textContent = S.bots;
  renderTrackBox(isHost);
  const bt = S.game === 'battle';
  renderLoadout(bt);
  $('modeSw').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.m === S.game));
  $('modeNote').textContent = bt ? "Mashinalar bir-biriga urilib jonini kamaytiradi. Zarba qanchalik kuchli bo'lsa, jon shuncha ko'p ketadi. Oxirgi tirik qolgan g'olib!" : "Aylanalar bo'yicha klassik poyga.";
  $('lapsRow').classList.toggle('hidden', bt); $('trackBox').classList.toggle('hidden', bt); $('btnTrackTop').classList.toggle('hidden', bt);
  $('guestTxt').textContent = bt ? 'Xona egasi jangni boshlashini kuting…' : 'Xona egasi poygani boshlashini kuting…';
  $('hostCtl').classList.toggle('hidden', !isHost);
  $('guestMsg').classList.toggle('hidden', isHost);
  const me = S.players.find(p => p.id === S.myId);
  const loReady = !bt || S.loadout.length === LOADOUT_SIZE;
  $('btnStart').disabled = !(me && me.car >= 0);
  $('btnStart').classList.toggle('need', !loReady);          // looks dimmed, but a click still explains what is missing
  $('btnStart').innerHTML = me && me.car >= 0 && !loReady ? icon('swords') + `Avval ${LOADOUT_SIZE} ta qobiliyat tanlang` : me && me.car >= 0 ? (bt ? icon('swords') + 'JANGNI BOSHLASH' : icon('flag') + 'POYGANI BOSHLASH') : icon('car') + 'Avval mashina tanlang';
}

/** battle: pick LOADOUT_SIZE of the abilities; they go on keys 1 2 3 in the order they were picked */
function renderLoadout(show) {
  $('loadoutBox').classList.toggle('hidden', !show);
  document.body.classList.toggle('btl', show);          // battle lobby: hide the car stat bars so the ability picker + start button fit
  if (!show) return;
  const grid = $('loGrid');
  if (!grid.children.length) {
    grid.innerHTML = ABILITIES.map((a, i) => `<div class="lo ${a.kind}" data-i="${i}" title="${a.name}: ${a.desc}"><i class="slot"></i><span class="ico">${a.ico}</span><b>${a.name}</b><small>${a.desc}</small></div>`).join('');
    grid.querySelectorAll('.lo').forEach(el => {
      el.onclick = () => {
        const i = +el.dataset.i, at = S.loadout.indexOf(i);
        if (at >= 0) S.loadout.splice(at, 1);
        else if (S.loadout.length >= LOADOUT_SIZE) { toast(`Faqat ${LOADOUT_SIZE} ta tanlash mumkin — avval birini bekor qiling`, 1800); return; }
        else S.loadout.push(i);
        ls.set('td_lo', S.loadout.join(','));
        audio.beep(at >= 0 ? 440 : 660, 0.1, 0.12);
        renderLobby();
      };
    });
  }
  grid.querySelectorAll('.lo').forEach(el => {
    const at = S.loadout.indexOf(+el.dataset.i);
    el.classList.toggle('sel', at >= 0);
    el.classList.toggle('full', at < 0 && S.loadout.length >= LOADOUT_SIZE);
    el.querySelector('.slot').textContent = at >= 0 ? String(at + 1) : '';
  });
  $('loSel').textContent = `${S.loadout.length}/${LOADOUT_SIZE}`;
  $('loSel').classList.toggle('ok', S.loadout.length === LOADOUT_SIZE);
}

$('btnStart').onclick = () => {
  audio.init();
  if (S.game === 'battle' && S.loadout.length < LOADOUT_SIZE) {
    toast(`Avval pastdagi "Qobiliyatlar"dan ${LOADOUT_SIZE} tasini tanlang (${S.loadout.length}/${LOADOUT_SIZE})`, 3200);
    const box = $('loadoutBox'); box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    box.classList.remove('flash'); void box.offsetWidth; box.classList.add('flash');
    return;
  }
  if (S.mode === 'online') { sendConfig(); net.send({ t: 'start' }); return; }
  startSolo();
};

function startSolo() {
  // solo: bots take the free cars
  const free = CAR_DEFS.map((_, i) => i).filter(i => i !== S.soloCar);
  for (let i = free.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [free[i], free[j]] = [free[j], free[i]]; }
  const names = ['Rustam', 'Jasur', 'Sardor', 'Bobur', 'Dilshod', 'Aziz', 'Otabek', 'Sherzod'];
  const players = [{ id: 'me', name: S.name, car: S.soloCar, bot: false, color: S.paint }];
  for (let i = 0; i < S.bots; i++) players.push({ id: 'b' + i, name: names[i], car: free[i], bot: true, color: Math.random() < 0.5 ? Math.floor(Math.random() * PAINTS.length) : -1 });
  const slots = players.map((_, i) => i); for (let i = slots.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [slots[i], slots[j]] = [slots[j], slots[i]]; }
  players.forEach((p, i) => { p.slot = slots[i]; });
  beginRace({ players, laps: S.laps, myId: 'me', isHost: true, net: null, solo: true, countdown: 6, track: S.game === 'battle' ? ARENA : S.track, mode: S.game, loadout: S.loadout });
}

// ------------------------------------------------------------------ race flow
function startOnlineRace(m) {
  const list = (S.lobbyMsg ? S.lobbyMsg.players : S.players).map(p => ({ ...p, slot: m.grid[p.id] }));
  S.game = m.mode === 'battle' ? 'battle' : 'race';
  beginRace({ players: list, laps: m.laps, myId: S.myId, isHost: S.hostId === S.myId, net, solo: false, countdown: m.countdown || 6, track: S.game === 'battle' ? ARENA : S.track, mode: S.game, loadout: S.loadout });
}

function beginRace(cfg) {
  S.raceActive = true; S.paused = false;
  setScreen('race');
  hud.setFinished(false); hud.clearLabels();
  const t0 = performance.now();
  race.setup(cfg);
  if ((S.touchUI || race.battle) && race.me && race.me.v) race.me.v.auto = true;   // on a phone / in battle (digits are abilities): automatic gearbox
  syncMuteUi();
  $('hudTrack').textContent = TRACKS[cfg.track].name;
  dbg('race.setup', (performance.now() - t0).toFixed(0) + 'ms');
  race.soloEnded = false;
  const keysEl = $('hudKeys'); keysEl.classList.remove('fade'); clearTimeout(beginRace.t); beginRace.t = setTimeout(() => keysEl.classList.add('fade'), 14000);
  audio.init();
}

function leaveRaceView() {
  S.raceActive = false; S.paused = false;
  if (race) { race.phase = 'idle'; for (const r of race.racers.values()) race.scene.remove(r.vis.group); race.racers.clear(); race.track.setLights(0); }
  hud.clearLabels(); hud.show(false); audio.silence(); show('pause', false);
}

function showResults(list) {
  if (S.screen === 'results') return;
  setScreen('results'); hud.show(true);
  const myId = S.myId;
  const bt = !!(race && race.battle);
  const battleTxt = r => r.time == null ? (r.alive ? `jangda qoldi · ${Math.ceil(r.hp)}% jon` : '—') : r.time >= 1000 ? icon('trophy') + " G'OLIB" : `${fmt(r.time)} da yo'q bo'ldi`;
  const rows = list.map((r, i) => {
    const cd = CAR_DEFS[r.car] || CAR_DEFS[0];
    return `<tr class="${(r.me || r.id === myId) ? 'me' : ''}"><td class="p">${i + 1}</td><td><i style="background:${cd.color}"></i>${escapeHtml(r.name)}</td><td>${cd.name}</td><td>${bt ? battleTxt(r) : r.time != null ? fmt(r.time) : 'marraga yetmadi'}</td></tr>`;
  }).join('');
  $('resTable').innerHTML = `<tr><th>#</th><th>Haydovchi</th><th>Mashina</th><th>${bt ? 'Natija' : 'Vaqt'}</th></tr>${rows}`;
  $('resTitle').innerHTML = icon('trophy') + (bt ? 'JANG NATIJALARI' : 'NATIJALAR');
  const host = S.hostId === S.myId;
  $('btnAgain').style.display = host ? '' : 'none';
  $('btnAgainTracks').style.display = host && !bt ? '' : 'none';
  $('btnRestart2').style.display = host ? '' : 'none';
  $('resWait').textContent = host ? '' : '⏳ Xona egasi garajga qaytarishini kuting…';
}

function restartRace() {
  if (S.mode === 'online') { if (S.hostId === S.myId) net.send({ t: 'restart' }); return; }
  if (audio.ctx) audio.ctx.resume();
  show('pause', false); S.paused = false; startSolo();
}
$('btnRestart').onclick = restartRace;
$('btnRestart2').onclick = restartRace;
$('btnAgain').onclick = () => {
  if (S.mode === 'online') net.send({ t: 'back' });
  else { leaveRaceView(); enterLobby(); }
};
$('btnAgainTracks').onclick = () => {
  if (S.mode === 'online') { if (S.hostId === S.myId) net.send({ t: 'back' }); }
  else { leaveRaceView(); enterLobby(); }
  setTimeout(() => picker.open(S.track), 60);
};
$('btnLeave').onclick = () => { if (S.mode === 'online') net.close(); leaveRaceView(); toMenu(); };

function toMenu() {
  leaveRaceView();
  if (net.connected || net.ws) net.close();
  S.mode = 'solo'; S.myId = 'me'; S.room = null; S.players = [];
  setScreen('menu');
  showroom.show(Math.floor(Math.random() * CAR_DEFS.length));
}

// pause
function togglePause() {
  if (S.screen !== 'race') return;
  S.paused = !S.paused;
  show('pause', S.paused);
  $('btnRestart').style.display = (S.mode === 'online' && S.hostId !== S.myId) ? 'none' : '';
  $('pauseNote').textContent = S.mode === 'online' ? 'Onlayn poygada o\'yin to\'xtamaydi.' : '';
  if (S.mode !== 'online' && audio.ctx) { if (S.paused) audio.ctx.suspend(); else audio.ctx.resume(); }
}
$('btnResume').onclick = togglePause;
$('btnQuit').onclick = () => {
  if (audio.ctx) audio.ctx.resume();
  if (S.mode === 'online') { net.close(); leaveRaceView(); toMenu(); } else { leaveRaceView(); enterLobby(); }
};
const QL = { ultra: '4K Ultra', high: 'Yuqori', medium: 'O\'rta', low: 'Past' };
const QNEXT = { ultra: 'high', high: 'medium', medium: 'low', low: 'ultra' };
function applyQuality(q) {
  S.quality = q; ls.set('td_q', q);
  if (race) race.setQuality(q); else renderer.setPixelRatio(pixelRatioFor(q));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  $('qLabel').textContent = QL[q]; $('qLabelMenu').textContent = QL[q];
}
function cycleQuality() { applyQuality(QNEXT[S.quality]); toast('Grafika: ' + QL[S.quality] + (S.quality === 'ultra' ? ' (' + Math.round(renderer.domElement.width) + '×' + Math.round(renderer.domElement.height) + ')' : ''), 1800); }
$('btnQuality').onclick = cycleQuality;

// ------------------------------------------------------------------ tracks
const picker = new TrackPicker({
  canChange: () => S.mode !== 'online' || S.hostId === S.myId,
  onPick: i => { setTrack(i, true); },
});
function setTrack(i, fromUser) {
  i = Math.min(TRACKS.length - 1, Math.max(0, i | 0));
  const changed = i !== S.track;
  S.track = i; ls.set('td_track', String(i));
  $('menuTrackName').textContent = TRACKS[i].name + ' · ' + TRACKS[i].group.replace('road', "yo'l").replace('ring', 'aylana');
  if (fromUser && changed) {
    S.laps = TRACKS[i].laps;
    if (S.mode === 'online' && S.hostId === S.myId) sendConfig();
    toast('Yo\'l: ' + TRACKS[i].name, 1600);
  }
  if (S.screen === 'lobby') renderTrackBox(S.hostId === S.myId);
  if (picker.isOpen) { picker.cur = i; picker.render(); }
}
function renderTrackBox(isHost) {
  const c = trackInfo(S.track), d = c.def;
  $('tbName').textContent = d.name;
  $('tbGroup').textContent = d.group === 'road' ? "YO'L" : 'AYLANA';
  $('tbMeta').textContent = `${c.km.toFixed(1)} km · ${c.corners} burilish · ${LEVELS[d.level]}`;
  drawPreview($('tbPrev'), S.track);
  $('btnTrackOpen').innerHTML = icon('road') + (isHost ? "Yo'lni tanlash" : "Yo'llarni ko'rish");
}

// ------------------------------------------------------------------ main loop
let last = performance.now(), fpsAcc = 0, fpsN = 0, fpsShow = 0, lowT = 0;
const MANUAL = new URLSearchParams(location.search).has('manual');
function frame(now) {
  if (!MANUAL) requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1); last = now;
  tick(dt, true);
}
function tick(dt, doRender = true) {
  const w = window.innerWidth, h = window.innerHeight;
  if (S.screen === 'race' || (S.screen === 'results' && S.raceActive) || (S.screen === 'help' && S.raceActive) ) {
    if (!S.paused) { readInput(); race.update(dt, w, h); }
    if (doRender) renderer.render(race.scene, race.camera);
    // adaptive quality
    if (S.screen === 'race' && !S.paused) {
      fpsAcc += dt; fpsN++;
      if (fpsAcc > 2) {
        const fps = fpsN / fpsAcc; fpsShow = fps; fpsAcc = 0; fpsN = 0;
        $('hudFps').textContent = Math.round(fps) + ' FPS';
        $('hudPing').textContent = net.connected ? Math.round(net.latency) + ' ms' : '';
        if (race.phase !== 'countdown') {
          if (fps < 34) { lowT++; } else lowT = 0;
          if (lowT >= 2 && S.quality !== 'low') { applyQuality({ ultra: 'high', high: 'medium', medium: 'low' }[S.quality]); toast('Grafika avtomatik pasaytirildi (' + QL[S.quality] + ')', 2500); lowT = 0; }
        }
      }
    }
  } else if (showroom) {
    if (doRender) showroom.update(dt, w, h);
  }
}

// ------------------------------------------------------------------ boot
(async function boot() {
  try {
    await loadAll();
  } catch (e) {
    console.error(e);
    $('loadText').textContent = 'Xatolik: ' + (e && e.message ? e.message : e);
    return;
  }
  $('qLabel').textContent = QL[S.quality]; $('qLabelMenu').textContent = QL[S.quality];
  setTrack(S.track, false);
  showroom.show(Math.floor(Math.random() * CAR_DEFS.length));
  setScreen('menu');
  if (!MANUAL) requestAnimationFrame(frame);
  // slow showcase of different cars on the menu screen
  setInterval(() => { if (S.screen === 'menu') showroom.show((showroom.index + 1) % CAR_DEFS.length); }, 6500);
  window.__game = { S, race, showroom, renderer, net, audio, tick };
})();
