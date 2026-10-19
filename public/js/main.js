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
import { World, Nav } from './world.js';
import { Mission, DIFFS, POLICE_MIN, POLICE_MAX, THIEF_MAX } from './mission.js';
import { MissionHUD } from './missionhud.js';
import { Fleet, SUV_DEF, SUV_INDEX } from './missionfleet.js';

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
let showroom = null, race = null, protos = [], mission = null;
const carDef = i => (i === SUV_INDEX ? SUV_DEF : CAR_DEFS[i]);
/** cars a player can pick: the 7 garage cars (+ the police SUV in police missions) */
const POLICE_LIVERY = [3, 1, 0];   // black, blue, red police paint (PAINTS index)
const policeVar = k => ({ car: k % (CAR_DEFS.length + 1), paint: POLICE_LIVERY[Math.floor(k / (CAR_DEFS.length + 1)) % POLICE_LIVERY.length] });
const garageCount = () => (S.m.role === 'police' ? (CAR_DEFS.length + 1) * POLICE_LIVERY.length : CAR_DEFS.length);
const carCount = (mission = S.game === 'mission' && S.mode === 'online') => (mission ? CAR_DEFS.length + 1 : CAR_DEFS.length);
const mhud = new MissionHUD();

const ARENA = TRACKS.findIndex(t => t.id === 'arena');          // battle track: not listed in the track picker
const DEBUG = new URLSearchParams(location.search).has('debug');
const dbg = (...a) => { if (DEBUG) console.log('[dbg]', ...a); };
function loadMissionCfg() {
  const d = { role: 'police', police: 4, thieves: 1, diff: 1, time: 300 };
  try { const o = JSON.parse(ls.get('td_m') || '{}'); if (o.role === 'thief' || o.role === 'police') d.role = o.role; d.police = Math.max(1, Math.min(POLICE_MAX, o.police | 0 || d.police)); d.thieves = Math.max(1, Math.min(THIEF_MAX, o.thieves | 0 || 1)); if ([0, 1, 2].includes(o.diff)) d.diff = o.diff; if (Number.isFinite(+o.time)) d.time = Math.max(60, Math.min(3600, Math.round(+o.time / 60) * 60)); } catch (e) { /* defaults */ }
  return d;
}
const S = {
  screen: 'loading', mode: 'solo', name: ls.get('td_name') || '', myId: 'me', hostId: 'me', room: null,
  players: [], laps: 3, bots: 3, browse: 0, soloCar: 0, paused: false, lobbyMsg: null, raceActive: false, quality: ls.get('td_q') || 'high',
  track: Math.min(TRACKS.length - 1, Math.max(0, parseInt(ls.get('td_track'), 10) || 0)),
  loadout: [...new Set((ls.get('td_lo') || '').split(',').filter(x => x !== '').map(Number))].filter(i => Number.isInteger(i) && i >= 0 && i < ABILITIES.length).slice(0, LOADOUT_SIZE),   // 3 battle abilities (indices into ABILITIES)
  game: ls.get('td_game') === 'battle' ? 'battle' : 'race',   // 'race' | 'battle' (Jang Arena)
  paint: -1,   // colour picker removed: always factory colours
  touchUI: isTouchDevice(),
  m: loadMissionCfg(), mCar: Math.max(0, Math.min(CAR_DEFS.length, parseInt(ls.get('td_mcar'), 10) || 0)), missionActive: false, world: null, nav: null,
};
if (!['ultra', 'high', 'medium', 'low'].includes(S.quality)) S.quality = 'high';
resize();
$('nameInput').value = S.name;

function toast(msg, ms = 2600) { const t = $('toast'); t.innerHTML = iconize(msg); t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), ms); }
function show(id, on = true) { $(id).classList.toggle('on', on); }
function syncGarageSound() { audio.garageIdle(S.screen === 'lobby' && CAR_DEFS[S.browse]?.id === 'supra_mk4'); }
function setScreen(s) {
  S.screen = s;
  for (const id of ['loading', 'menu', 'lobby', 'results', 'pause', 'help', 'missions', 'mres']) show(id, id === s);
  hud.show(s === 'race');
  document.body.dataset.screen = s;
  if (s !== 'race') releaseAll();
  if (showroom) { showroom.setOffset(s === 'menu' || s === 'missions' ? 0.2 : 0); showroom.setInteractive(s === 'lobby'); }
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
  text.textContent = 'Politsiya mashinasi yuklanmoqda…';
  S.fleet = new Fleet(); await S.fleet.load();
  showroom = new Showroom(renderer, protos, CAR_DEFS);
  showroom.extra = [{ def: SUV_DEF, proto: S.fleet.suv }];
  showroom.paint = S.paint;
  dbg('showroom', (performance.now() - t1).toFixed(0) + 'ms');
  race = new Race(renderer, protos, audio, hud, { track: S.track, quality: S.quality });
  dbg('race build', (performance.now() - t1).toFixed(0) + 'ms');
  race.msg = (t, ms, k) => hud.message(t, ms, k);
  race.onEnd = list => showResults(list);
  race.onMissionEnd = res => showMissionResult(res);
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
    case 'Space': if (v && (race.battle || (race.mission && race.phase === 'racing')) && !race.me.dead) v.jump(); break;
    case 'KeyC': cycleCamera(); break;
    case 'KeyF': if (race.mission) race.mission.fireGun(); break;
    case 'KeyR': if (race.mission) race.mission.fireTow(); else if (race.me?.def.id === 'charger') race.fireTow(); break;
    case 'KeyT': if (race.mission) race.mission.keyT(); else race.respawn(); break;
    case 'KeyY': if (race.mission) race.mission.respawn(); break;
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
$('btnFriends').onclick = () => {
  audio.init(); const box = $('friendsBox'); box.classList.toggle('hidden');
  if (!box.classList.contains('hidden')) {
    showFriendModes(false); S.game = 'race';                    // the game type (poyga / jang / missiya) is picked inside the room by the host
    $('frModeTag').textContent = "Onlayn xona: yarating yoki kod bilan kiring. O'yin turini (poyga / jang / missiya) xona ichida tanlaysiz.";
    setTimeout(() => box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 30);
  }
};
$('btnFriendsBack').onclick = () => { $('menuErr').textContent = ''; $('friendsBox').classList.add('hidden'); };
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
  if (q) { $('roomInput').value = q.toUpperCase().slice(0, 4); $('friendsBox').classList.remove('hidden'); $('friendModes').classList.add('hidden'); $('friendJoin').classList.remove('hidden'); $('frModeTag').textContent = 'Xonaga qo\'shilish'; }
}

async function joinOnline(code) {
  S.name = myName(); ls.set('td_name', S.name);
  $('menuErr').textContent = '';
  try {
    if (!net.connected) { net.close(); await net.connect(); bindNet(); }
  } catch (e) { $('menuErr').textContent = 'Serverga ulanib bo\'lmadi. O\'yin serveri ishlayaptimi? (npm start)'; return; }
  net.send({ t: 'join', name: S.name, room: code });
}

const sendConfig = () => net.send({ t: 'config', laps: S.laps, bots: S.bots, track: S.track, mode: S.game, m: { police: S.m.police, thieves: S.m.thieves, diff: S.m.diff, time: S.m.time } });

function bindNet() {
  net.on.joined = m => { S.mode = 'online'; S.myId = m.id; S.room = m.room; if (S.paint >= 0) net.send({ t: 'color', color: S.paint }); };
  net.on.err = m => { if (S.screen === 'menu') $('menuErr').textContent = m.msg; else toast(m.msg, 3500); };
  net.on.lobby = m => {
    S.lobbyMsg = m; S.players = m.players; S.hostId = m.host; S.room = m.room;
    if (S.screen === 'menu' && m.host === S.myId) sendConfig();   // room creator: push our own choices
    else { S.laps = m.laps; S.bots = m.bots; S.game = m.mode === 'battle' ? 'battle' : m.mode === 'mission' ? 'mission' : 'race'; if (m.track != null) setTrack(m.track, false); if (m.m) { S.m.police = m.m.police; S.m.thieves = m.m.thieves || 1; S.m.diff = m.m.diff; S.m.time = m.m.time; } }
    if (S.screen === 'menu') { enterLobby(); const me = m.players.find(p => p.id === S.myId); if (me && me.car >= 0) S.browse = me.car; showroom.show(S.browse); }
    if (S.screen === 'lobby') renderLobby();
  };
  net.on.start = m => { if (m.track != null) setTrack(m.track, false); startOnlineRace(m); };
  net.on.ms = m => mission && mission.onSnapshot(m);
  net.on.mev = m => mission && mission.onEvent(m.e);
  net.on.mready = m => { if (pendingMission) pendingMission.ready.add(m.id); };
  net.on.mstart = m => onlineMissionGo(m);
  net.on.st = m => race && race.onState(m.id, m.s);
  net.on.fin = m => race && race.onFinish(m.id, m.time);
  net.on.ab = m => race && race.onAbility(m.id, m.k, m.p);
  net.on.mcmd = m => mission && mission.onCmd(m.id, m.c);
  net.on.tow = m => { if (!race) return; if (race.mission) race.mission.onTow(m.id, m.to, m.on); else race.onTow(m.id, m.to, m.on); };
  net.on.results = m => showResults(m.list);
  net.on.left = m => { if (race && race.mission) race.mission.removeUnit(m.id); else if (race && S.screen === 'race' || S.screen === 'results') race && race.removeRacer(m.id); };
  net.on.botsGone = () => { if (race && race.mission) { toast('Xona egasi chiqib ketdi — missiya to\'xtadi', 4000); net.close(); leaveRaceView(); toMenu(); return; } if (!race) return; for (const r of [...race.racers.values()]) if (r.bot && r.kind === 'remote') race.removeRacer(r.id); toast('Xona egasi chiqib ketdi — botlar olib tashlandi'); };
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
function browse(d) { const n = carCount(); S.browse = (S.browse + d + n) % n; showroom.show(S.browse); renderLobby(); syncGarageSound(); }
function carOwner(i) { return S.players.find(p => p.car === i && (S.game !== 'mission' || p.id === S.myId)); }   // mission: everybody may drive the same car
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
    if (k === 'laps') S.laps = clamp(S.laps + d, 1, 10);
    else if (k === 'mpol') S.m.police = clamp(S.m.police + d, POLICE_MIN, POLICE_MAX);
    else if (k === 'mthief') S.m.thieves = clamp(S.m.thieves + d, 1, THIEF_MAX);
    else if (k === 'mtime') S.m.time = clamp(S.m.time + d * 60, 60, 3600);
    else if (k === 'mdiff') S.m.diff = clamp(S.m.diff + d, 0, 2);
    else S.bots = clamp(S.bots + d, 0, S.mode === 'solo' ? 6 : 6);
    if (k[0] === 'm') saveMission();
    if (S.mode === 'online') sendConfig();
    renderLobby();
  };
});

function renderLobby() {
  const isHost = S.hostId === S.myId;
  if (S.browse >= carCount()) { S.browse = 0; showroom.show(0); }
  const def = carDef(S.browse);
  $('carIndex').textContent = `${S.browse + 1} / ${carCount()}`;
  $('carName').textContent = def.name.toUpperCase();
  const owner = carOwner(S.browse);
  const st = $('carState'), btn = $('btnPick');
  if (owner && owner.id === S.myId) { st.className = 'state mine'; st.innerHTML = icon('check') + 'Siz tanlagansiz'; btn.disabled = false; btn.innerHTML = icon('x') + 'BEKOR QILISH'; }
  else if (owner) { st.className = 'state taken'; st.innerHTML = icon('lock') + `Band — ${escapeHtml(owner.name)} tanlagan`; btn.disabled = true; btn.innerHTML = icon('lock') + 'BAND'; }
  else { st.className = 'state free'; st.textContent = 'Bo\'sh'; btn.disabled = false; btn.innerHTML = icon('check') + 'TANLASH'; }
  // dots
  $('carDots').innerHTML = Array.from({ length: carCount() }, (_, i) => carDef(i)).map((d, i) => {
    const o = carOwner(i);
    return `<i class="${i === S.browse ? 'cur ' : ''}${o && o.id !== S.myId ? 'taken ' : ''}${o && o.id === S.myId ? 'mine' : ''}" style="background:${d.color}" data-i="${i}" title="${d.name}"></i>`;
  }).join('');
  $('carDots').querySelectorAll('i').forEach(i => { i.onclick = () => { S.browse = +i.dataset.i; showroom.show(S.browse); renderLobby(); syncGarageSound(); }; });
  // players
  const rows = S.players.filter(p => !p.bot).map(p => {
    const cd = p.car >= 0 ? carDef(p.car) : null;
    return `<li class="${p.id === S.myId ? 'me' : ''}"><i style="background:${paintHex(p.color, cd)}"></i><div>${escapeHtml(p.name)}${p.id === S.hostId ? icon('crown', 'host') : ''}<small>${cd ? cd.name : 'mashina tanlanmagan'}${S.game === 'mission' ? (p.role === 'thief' ? " · <b class='rl t'>O'G'RI</b>" : " · <b class='rl p'>politsiya</b>") : ''}</small></div>${cd ? '<span class="ok">' + icon('check') + '</span>' : ''}</li>`;
  });
  const humans = rows.length;
  for (let i = humans; i < 7; i++) rows.push('<li class="empty"><i></i><div>Bo\'sh joy<small>kutilmoqda…</small></div></li>');
  $('plList').innerHTML = rows.join('');
  $('plCount').textContent = `${humans}/7`;
  $('roomCode').textContent = S.room || '----';
  $('lapsVal').textContent = S.laps; $('botsVal').textContent = S.bots;
  renderTrackBox(isHost);
  const bt = S.game === 'battle', ms = S.game === 'mission';
  renderLoadout(bt);
  $('modeSw').querySelector('[data-m="mission"]').classList.toggle('hidden', S.mode === 'solo');
  const roles = $('msRoles'); roles.classList.toggle('hidden', !ms);
  if (ms) {
    const all = S.players.filter(p => !p.bot), ths = all.filter(p => p.role === 'thief'), nT = Math.max(S.m.thieves || 1, ths.length), nhT = ths.length, nh = all.length - nhT, total = Math.max(nh, S.m.police), nAI = total - nh;
    const mine = all.find(p => p.id === S.myId), amThief = !!(mine && mine.role === 'thief');
    roles.innerHTML = `<div class="rr thief"><span>O'g'rilar <small>${nhT ? nhT + ' ta odam' : ''}${nhT && nT > nhT ? ' + ' : ''}${nT > nhT ? (nT - nhT) + ' ta AI' : ''}</small></span><b>${nT}</b></div>` +
      `<div class="rr police"><span>Politsiya <small>${nh} ta odam${nAI ? ' + ' + nAI + ' ta AI' : ''}</small></span><b>${total}</b></div>` +
      `<div class="rr"><span>Vaqt</span><b>${Math.round(S.m.time / 60)} daq</b></div>` +
      `<div class="rolePick"><button data-r="police" class="${amThief ? '' : 'on'}">POLITSIYA</button><button data-r="thief" class="${amThief ? 'on' : ''}">O'G'RI</button></div>`;
    roles.querySelectorAll('.rolePick button').forEach(b => { b.onclick = () => { audio.beep(520, 0.08, 0.1); net.send({ t: 'role', role: b.dataset.r }); }; });
  }
  $('msLobby').classList.toggle('hidden', !ms); $('botsRow').classList.toggle('hidden', ms);
  $('mpolVal').textContent = S.m.police; $('mthiefVal').textContent = S.m.thieves; $('mtimeVal').textContent = Math.round(S.m.time / 60); $('mdiffVal').textContent = DIFFS[S.m.diff].name;
  $('modeSw').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.m === S.game));
  $('modeNote').textContent = ms ? "Politsiya missiyasi: hammangiz politsiya, AI o'g'rini birga ushlaysiz. Robotlar 1 daqiqadan keyin yo'lni to'sadi." : bt ? "Mashinalar bir-biriga urilib jonini kamaytiradi. Zarba qanchalik kuchli bo'lsa, jon shuncha ko'p ketadi. Oxirgi tirik qolgan g'olib!" : "Aylanalar bo'yicha klassik poyga.";
  $('lapsRow').classList.toggle('hidden', bt || ms); $('trackBox').classList.toggle('hidden', bt || ms); $('btnTrackTop').classList.toggle('hidden', bt || ms);
  $('guestTxt').textContent = ms ? 'Xona egasi missiyani boshlashini kuting…' : bt ? 'Xona egasi jangni boshlashini kuting…' : 'Xona egasi poygani boshlashini kuting…';
  $('hostCtl').classList.toggle('hidden', !isHost);
  $('guestMsg').classList.toggle('hidden', isHost);
  const me = S.players.find(p => p.id === S.myId);
  const loReady = !bt || S.loadout.length === LOADOUT_SIZE;
  $('btnStart').disabled = !(me && me.car >= 0);
  $('btnStart').classList.toggle('need', !loReady);          // looks dimmed, but a click still explains what is missing
  $('btnStart').innerHTML = me && me.car >= 0 && !loReady ? icon('swords') + `Avval ${LOADOUT_SIZE} ta qobiliyat tanlang` : me && me.car >= 0 ? (ms ? icon('siren') + 'MISSIYANI BOSHLASH' : bt ? icon('swords') + 'JANGNI BOSHLASH' : icon('flag') + 'POYGANI BOSHLASH') : icon('car') + 'Avval mashina tanlang';
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
  if (S.mode === 'online') {
    if (S.game === 'mission' && S.lobbyMsg && S.lobbyMsg.mode !== 'mission') { toast("Server eski versiyada — serverni to'xtatib, qayta ishga tushiring (npm start)", 6000); return; }   // an old server ignores mode 'mission' and would start a normal race
    sendConfig(); net.send({ t: 'start' }); return;
  }
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
  if (m.mode === 'mission') { S.game = 'mission'; startOnlineMission(m); return; }
  const list = (S.lobbyMsg ? S.lobbyMsg.players : S.players).map(p => ({ ...p, slot: m.grid[p.id] }));
  S.game = m.mode === 'battle' ? 'battle' : 'race';
  beginRace({ players: list, laps: m.laps, myId: S.myId, isHost: S.hostId === S.myId, net, solo: false, countdown: m.countdown || 6, track: S.game === 'battle' ? ARENA : S.track, mode: S.game, loadout: S.loadout });
}

function beginRace(cfg) {
  S.raceActive = true; S.paused = false; S.missionActive = false; mhud.end();
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
  S.raceActive = false; S.paused = false; S.missionActive = false; pendingMission = null;
  mhud.end();
  if (race) { if (race.mission) race.mission.stop(); race.phase = 'idle'; for (const r of race.racers.values()) race.scene.remove(r.vis.group); race.racers.clear(); race.track.setLights(0); }
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
  if (S.missionActive && S.mode === 'solo') { show('pause', false); S.paused = false; if (audio.ctx) audio.ctx.resume(); startMission(); return; }
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
  $('btnQuit').lastChild.textContent = S.missionActive && S.mode === 'solo' ? 'Missiyalarga chiqish' : 'Garajga chiqish';
  if (S.mode !== 'online' && audio.ctx) { if (S.paused) audio.ctx.suspend(); else audio.ctx.resume(); }
}
$('btnResume').onclick = togglePause;
$('btnQuit').onclick = () => {
  if (audio.ctx) audio.ctx.resume();
  if (S.missionActive && S.mode === 'solo') { leaveRaceView(); openMissions(); return; }
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


// ------------------------------------------------------------------ missions (Police mission)
const MISSION_DESC = {
  police: n => `<b>Siz politsiyasiz.</b> ${n > 1 ? `Siz va yana ${n - 1} ta yordamchi politsiya mashinasi` : 'Siz yolg\'iz'} uch shahar bo'ylab qochayotgan o'g'rini quvasiz. Uni <b>qisib, 10 soniya to'xtatib turing</b> — shunda u ushlanadi. 1 daqiqada ulgurmasangiz <b>robot politsiya</b> yo'lni to'sib, o'q uzadi.`,
  thief: n => `<b>Siz o'g'risiz.</b> Uch shahar bo'ylab <b>5 ta pul xaltasini</b> yig'ing, so'ng <b>yashirin uyga</b> yeting. Sizni <b>${n} ta</b> politsiya quvadi; 10 soniya qisib turishsa — ushlanasiz. 1 daqiqadan keyin robotlar yo'lni to'sib, o'q uzadi.`,
};
function saveMission() { ls.set('td_m', JSON.stringify(S.m)); ls.set('td_mcar', String(S.mCar)); }
function openMissions() {
  setScreen('missions');
  showroom.setOffset?.(0.2);
  renderMission();
}
function renderMission() {
  const m = S.m;
  document.querySelectorAll('#msRole button').forEach(b => b.classList.toggle('on', b.dataset.r === m.role));
  document.querySelectorAll('#msDiff button').forEach(b => b.classList.toggle('on', +b.dataset.d === m.diff));
  const ti = $('msTimeMin'); if (document.activeElement !== ti) ti.value = Math.round(m.time / 60);
  $('msTimeVal').textContent = `${Math.floor(m.time / 60)}:${String(m.time % 60).padStart(2, '0')}`;
  $('msDesc').innerHTML = MISSION_DESC[m.role](m.police);
  $('msPolLbl').textContent = m.role === 'police' ? 'Politsiya mashinalari (siz bilan)' : 'Sizni quvuvchi politsiya soni';
  $('msPolVal').textContent = m.police; $('msThVal').textContent = m.thieves; $('msThNum').textContent = m.thieves; $('msThBox').classList.toggle('hidden', m.role !== 'police');
  const sl = $('msPol'); sl.min = POLICE_MIN; sl.max = POLICE_MAX; sl.value = m.police;
  sl.style.setProperty('--p', ((m.police - POLICE_MIN) / (POLICE_MAX - POLICE_MIN) * 100).toFixed(1) + '%');
  document.querySelectorAll('#msPolChips button').forEach(b => b.classList.toggle('on', +b.dataset.n === m.police));
  if (S.mCar >= garageCount()) S.mCar = 0;
  const pv = m.role === 'police' ? policeVar(S.mCar) : null;
  showroom.show(S.mCar, pv ? { police: true, paint: pv.paint, car: pv.car } : null);
  $('msCarName').textContent = pv ? 'Politsiya · ' + carDef(pv.car).name : carDef(S.mCar).name;
}
function setThieves(n) { S.m.thieves = clamp(n | 0, 1, THIEF_MAX); saveMission(); renderMission(); }
function setPolice(n) { S.m.police = clamp(n | 0, POLICE_MIN, POLICE_MAX); saveMission(); renderMission(); }
$('msPolChips').innerHTML = [1, 2, 4, 8, 12, 20, 30, 50].map(n => `<button type="button" data-n="${n}">${n}</button>`).join('');
$('msPolChips').querySelectorAll('button').forEach(b => { b.onclick = () => { audio.beep(520, 0.08, 0.1); setPolice(+b.dataset.n); }; });
$('msPol').addEventListener('input', e => setPolice(+e.target.value));
$('msThMinus').onclick = () => { audio.beep(440, 0.06, 0.1); setThieves(S.m.thieves - 1); };
$('msThPlus').onclick = () => { audio.beep(620, 0.06, 0.1); setThieves(S.m.thieves + 1); };
$('msPolMinus').onclick = () => { audio.beep(440, 0.06, 0.1); setPolice(S.m.police - 1); };
$('msPolPlus').onclick = () => { audio.beep(620, 0.06, 0.1); setPolice(S.m.police + 1); };
document.querySelectorAll('#msRole button').forEach(b => { b.onclick = () => { S.m.role = b.dataset.r; audio.beep(560, 0.08, 0.1); saveMission(); renderMission(); }; });
document.querySelectorAll('#msDiff button').forEach(b => { b.onclick = () => { S.m.diff = +b.dataset.d; audio.beep(520, 0.08, 0.1); saveMission(); renderMission(); }; });
$('msTimeMin').addEventListener('input', e => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) { S.m.time = clamp(Math.round(v), 1, 60) * 60; saveMission(); $('msTimeVal').textContent = `${S.m.time / 60}:00`; } });
$('msTimeMin').addEventListener('change', e => { e.target.value = Math.round(S.m.time / 60); });
const mCar = d => { const n = garageCount(); S.mCar = (S.mCar + d + n) % n; saveMission(); renderMission(); };
$('msCarPrev').onclick = () => mCar(-1); $('msCarNext').onclick = () => mCar(1);
$('msBack').onclick = () => toMenu();
$('msStart').onclick = () => startMission();
$('msHelp').onclick = () => toggleHelp(true);
$('btnMission').onclick = () => { audio.init(); S.mode = 'solo'; S.name = myName(); ls.set('td_name', S.name); openMissions(); };
$('mresAgain').onclick = () => { if (S.mode === 'online') { if (S.hostId === S.myId) net.send({ t: 'restart' }); } else startMission(); };
$('mresSetup').onclick = () => { if (S.mode === 'online') { if (S.hostId === S.myId) net.send({ t: 'back' }); } else { leaveRaceView(); openMissions(); } };
$('mresMenu').onclick = () => { if (S.mode === 'online') net.close(); leaveRaceView(); toMenu(); };
document.querySelectorAll('.ms-card').forEach(c => { c.onclick = () => { document.querySelectorAll('.ms-card').forEach(x => x.classList.toggle('on', x === c)); }; });

// friends menu: create / join a room first; POYGA / JANG / MISSIYA is chosen inside the room
function showFriendModes(on) { $('friendModes').classList.toggle('hidden', !on); $('friendJoin').classList.toggle('hidden', on); }
document.querySelectorAll('.fr-mode').forEach(b => {
  b.onclick = () => {
    S.game = b.dataset.g; audio.beep(560, 0.08, 0.12);
    $('frModeTag').innerHTML = (S.game === 'mission' ? icon('siren') + 'MISSIYA — Politsiya missiyasi' : S.game === 'battle' ? icon('swords') + 'JANG' : icon('flag') + 'POYGA');
    showFriendModes(false);
  };
});

let worldLoading = null;
function ensureWorld() {
  if (S.world) return Promise.resolve();
  if (worldLoading) return worldLoading;
  worldLoading = (async () => {
    const fill = $('loadFill'), text = $('loadText');
    text.textContent = 'Shaharlar yuklanmoqda…'; fill.style.width = '4%';
    S.world = await World.load(renderer, f => { fill.style.width = (4 + f * 70).toFixed(1) + '%'; });
    text.textContent = 'Yo\'llar xaritasi tuzilmoqda…'; fill.style.width = '90%';
    await new Promise(r => setTimeout(r, 30));
    S.nav = new Nav(S.world);
    mission = new Mission(race, S.world, S.nav, audio, hud, protos, mhud, S.fleet);
    fill.style.width = '100%';
  })();
  worldLoading.catch(() => { worldLoading = null; });
  return worldLoading;
}

/** single player: role / police count / difficulty / time from the setup screen */
async function startMission() {
  audio.init(); S.name = myName();
  S.mode = 'solo'; S.myId = 'me'; S.hostId = 'me'; S.room = null;
  if (race.mission) race.mission.stop(true);
  if (!S.world) {
    setScreen('loading'); $('loadFill').style.width = '0%';
    try { await ensureWorld(); } catch (e) { console.error(e); toast('Shaharni yuklab bo\'lmadi: ' + (e && e.message ? e.message : e), 5000); openMissions(); return; }
    await new Promise(r => setTimeout(r, 30));
  }
  S.raceActive = true; S.paused = false; S.missionActive = true;
  setScreen('race');
  hud.clearLabels();
  const m = S.m;
  mission.start({ role: m.role, police: m.police, thieves: m.thieves, diff: m.diff, time: m.time, players: [{ id: 'me', name: S.name, car: m.role === 'police' ? policeVar(S.mCar).car : S.mCar, paint: m.role === 'police' ? policeVar(S.mCar).paint : undefined }], myId: 'me' }, null);
  afterMissionStart();
}
function afterMissionStart() {
  $('hudTrack').textContent = 'Politsiya missiyasi';
  const keysEl = $('hudKeys'); keysEl.classList.remove('fade'); clearTimeout(beginRace.t); beginRace.t = setTimeout(() => keysEl.classList.add('fade'), 14000);
  syncMuteUi();
}

// ---- online (friends): the host runs the AI / rules / robots, everybody drives a police car
let pendingMission = null;
const missionNet = host => ({ host, send: o => net.send(o), event: e => net.send({ t: 'mev', e }) });
async function startOnlineMission(m) {
  audio.init(); S.raceActive = true; S.paused = false; S.missionActive = false;
  const isHost = S.hostId === S.myId, me = (S.lobbyMsg ? S.lobbyMsg.players : S.players).find(p => p.id === S.myId);
  if (race.mission) race.mission.stop(true);
  const token = pendingMission = { ready: new Set(), host: isHost, players: (S.lobbyMsg ? S.lobbyMsg.players : S.players).filter(p => !p.bot).map(p => ({ id: p.id, name: p.name, role: p.role === 'thief' ? 'thief' : 'police', car: p.role === 'thief' && p.car === 7 ? 0 : Math.max(0, p.car) })), cfg: { role: 'police', police: S.m.police, thieves: S.m.thieves, diff: S.m.diff, time: S.m.time }, early: null };
  setScreen('loading'); $('loadFill').style.width = '0%';
  try { await ensureWorld(); } catch (e) { console.error(e); toast('Shaharni yuklab bo\'lmadi', 5000); net.close(); toMenu(); return; }
  if (pendingMission !== token) return;
  if (!isHost) { net.send({ t: 'mready' }); if (token.early) onlineMissionGo(token.early); return; }
  // host: wait (max 90 s) until every friend has loaded the city, then start for everybody
  $('loadText').textContent = "Do'stlar yuklanishini kutyapmiz…";
  const need = token.players.filter(p => p.id !== S.myId).map(p => p.id), t0 = performance.now();
  while (pendingMission === token && performance.now() - t0 < 90000 && !need.every(id => token.ready.has(id))) await new Promise(r => setTimeout(r, 120));
  if (pendingMission !== token) return;
  const live = new Set((S.lobbyMsg ? S.lobbyMsg.players : S.players).map(p => p.id));
  const players = token.players.filter(p => live.has(p.id) && (p.id === S.myId || token.ready.has(p.id)));
  S.missionActive = true; setScreen('race'); hud.clearLabels();
  mission.start({ ...token.cfg, players, myId: S.myId }, missionNet(true));
  net.send({ t: 'mstart', cfg: token.cfg, units: mission.descs, spawns: mission.spawns, t0: Date.now() });
  afterMissionStart();
}
/** friend: the host's setup arrived */
function onlineMissionGo(m) {
  if (!pendingMission) return;
  if (!mission || S.screen !== 'loading') { pendingMission.early = m; return; }
  const cfg = { ...m.cfg, players: [], myId: S.myId };
  if (!m.units.some(u => u.id === S.myId)) { toast("Missiya siz yuklanishdan oldin boshlandi — lobbiga qaytilmoqda", 4000); net.send({ t: 'back' }); pendingMission = null; return; }
  S.missionActive = true; setScreen('race'); hud.clearLabels();
  mission.start(cfg, missionNet(false), { units: m.units, spawns: m.spawns });
  afterMissionStart();
}

function showMissionResult(res) {
  if (S.screen === 'mres') return;
  mhud.result(res);
  const online = S.mode === 'online', host = S.hostId === S.myId;
  $('mresAgain').style.display = online && !host ? 'none' : '';
  $('mresSetup').style.display = online && !host ? 'none' : '';
  $('mresSetup').lastChild.textContent = online ? 'Lobbiga qaytish' : 'Missiya sozlamalari';
  $('mresNote').textContent = online && !host ? '⏳ Xona egasi tanlashini kuting…' : '';
  setScreen('mres');
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
  if (S.screen === 'race' || ((S.screen === 'results' || S.screen === 'mres') && S.raceActive) || (S.screen === 'help' && S.raceActive) ) {
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
  window.__game = { S, race, showroom, renderer, net, audio, tick, startMission, get mission() { return mission; } };
})();
