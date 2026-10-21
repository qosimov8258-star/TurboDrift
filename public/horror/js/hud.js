// HUD: DOM yangilanishlari (faqat o'zgarganda yoziladi).
import * as THREE from 'three';
import { LEVELS } from './levels.js';
import { BITE } from './sim.js';

const $ = id => document.getElementById(id);
export class Hud {
  constructor() {
    this.el = { hud: $('hzHud'), vig: $('hzVig'), flash: $('hzFlash'), lvl: $('hzLvl'), obj: $('hzObj'), time: $('hzTime'), players: $('hzPlayers'), msgs: $('hzMsgs'), sub: $('hzSub'), prompt: $('hzPrompt'), promptTxt: $('hzPromptTxt'), promptFill: $('hzPromptFill'), hearts: $('hzHearts'), stam: $('hzStam'), help: $('hzHelp'), gp: $('hzGhostPanel'), blood: $('hzBlood'), wep: $('hzWep'), biteTxt: $('hzBiteTxt'), snakeTxt: $('hzSnakeTxt'), inv: $('hzInvTxt'), marks: $('hzMarks'), dead: $('hzDead'), intro: $('hzIntro'), touch: $('hzTouch') };
    this.cache = {}; this.subT = 0; this.markPool = []; this.pT = 0;
    this._v = new THREE.Vector3();
  }
  set(k, v, fn) { if (this.cache[k] !== v) { this.cache[k] = v; fn(v); } }
  begin(sim, game) {
    this.cache = {}; this.el.hud.classList.remove('hidden'); this.el.msgs.innerHTML = ''; this.el.sub.classList.remove('on');
    const lv = LEVELS[sim.level];
    $('hzIntroT').textContent = `${sim.level + 1}. ${lv.name}`; $('hzIntroS').textContent = lv.sub;
    this.el.intro.classList.remove('hidden'); this.el.intro.style.animation = 'none'; void this.el.intro.offsetWidth; this.el.intro.style.animation = '';
    clearTimeout(this._it); this._it = setTimeout(() => this.el.intro.classList.add('hidden'), 5600);
    const ghost = sim.me.role === 'ghost';
    this.el.gp.classList.toggle('hidden', !ghost);
    this.el.help.innerHTML = ghost ? '' : '<kbd>WASD</kbd> yurish · <kbd>Shift</kbd> yugurish<br><kbd>E</kbd> ushlab turing — shkafni qidirish · <kbd>E</kbd> bosing — qurol olish<br><kbd>Sichqoncha chap</kbd> — urish / otish<br><kbd>F</kbd> fanar · <kbd>M</kbd> ovoz';
    this.el.hearts.style.display = 'none'; this.el.stam.parentElement.style.display = ghost ? 'none' : '';
    $('tBtnsS').classList.toggle('hidden', ghost); $('tBtnsG').classList.toggle('hidden', !ghost);
    this.map = null; $('hzMap').classList.add('hidden');
    this.el.blood.innerHTML = ''; this.el.blood.classList.remove('on'); this.el.wep.textContent = '';
    this.el.dead.classList.add('hidden'); this.el.marks.innerHTML = ''; this.markPool = [];
    this.el.vig.style.setProperty('--fear', 0);
    if (sim.level === 0 && !ghost) setTimeout(() => this.msg('Maslahat: ruhni ko\'rsangiz — qoching va burilishlarda eshiklarni yoping', 'info'), 7000);
  }
  // qon dog'lari: ekranga tasodifiy joyga sachraydi va sekin quriydi
  splat(n = 2) {
    const box = this.el.blood;
    for (let i = 0; i < n; i++) {
      const d = document.createElement('div'), sz = 70 + Math.random() * 230, x = Math.random() * 100, y = Math.random() * 100;
      d.className = 'splat'; d.style.cssText = `left:${x}%;top:${y}%;width:${sz}px;height:${sz * (0.7 + Math.random() * 0.6)}px;transform:translate(-50%,-50%) rotate(${Math.random() * 360}deg) scale(.2);border-radius:${40 + Math.random() * 20}% ${40 + Math.random() * 20}% ${40 + Math.random() * 20}% ${40 + Math.random() * 20}%`;
      box.appendChild(d);
      requestAnimationFrame(() => requestAnimationFrame(() => { d.style.transform = d.style.transform.replace('scale(.2)', 'scale(1)'); d.style.opacity = 1; }));
      setTimeout(() => { d.style.opacity = 0; }, 3800 + Math.random() * 1500); setTimeout(() => d.remove(), 7500);
    }
    while (box.children.length > 16) box.firstChild.remove();
  }
  hide() { this.el.hud.classList.add('hidden'); this.el.intro.classList.add('hidden'); this.el.vig.style.setProperty('--fear', 0); }
  msg(text, kind = 'info') {
    const d = document.createElement('div'); d.className = 'toast ' + kind; d.textContent = text; this.el.msgs.appendChild(d);
    while (this.el.msgs.children.length > 5) this.el.msgs.firstChild.remove();
    setTimeout(() => d.remove(), 4300);
  }
  subtitle(text) { this.el.sub.textContent = text; this.el.sub.classList.add('on'); clearTimeout(this._st); this._st = setTimeout(() => this.el.sub.classList.remove('on'), 2600); }
  flash(color, v = 1) {
    const f = this.el.flash; f.classList.toggle('white', color === 'white'); f.style.transition = 'none'; f.style.opacity = Math.min(1, v); void f.offsetWidth; f.style.transition = ''; f.style.opacity = 0;
  }
  update(sim, game, dt) {
    const me = sim.me, e = this.el;
    this.set('fear', Math.round(sim.fear * 50), () => e.vig.style.setProperty('--fear', sim.fear.toFixed(2)));
    const lv = LEVELS[sim.level];
    this.set('lvl', sim.level, () => { e.lvl.textContent = `${sim.level + 1}-daraja · ${lv.name}`; });
    const m = Math.floor(sim.t / 60), s = Math.floor(sim.t % 60); this.set('time', m * 60 + s, () => { e.time.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; });
    const found = sim.keysFound.size, need = sim.need, open = sim.exit.isOpen;
    this.set('obj', `${found}/${need}/${open}/${me.role}`, () => {
      if (me.role === 'ghost') e.obj.innerHTML = `Omon qolganlar kalit: 🔑 <b>${found}/${need}</b>`;
      else e.obj.innerHTML = open ? '<span class="ok">Chiqish eshigi ochiq! Yuguring!</span>' : found >= need ? '<span class="ok">Hamma kalit topildi</span> — chiqish eshigini toping (yashil chiroq)' : `Kalitlar: 🔑 <b>${found}/${need}</b> — shkaflarni qidiring`;
    });
    // yuraklar / stamina
    if (me.role === 'survivor') {
      const bt = me.bitten && sim.bite ? Math.max(0, Math.ceil(BITE.TIME - sim.bite.t)) : -1;
      this.set('frz', bt >= 0 ? 'b' + bt : me.frozen > 0 ? Math.ceil(me.frozen) : 0, v => { e.hearts.style.display = ''; e.hearts.textContent = bt >= 0 ? `🩸 Tishlandi! ${bt} s — uring!` : v ? `❄ Qotib qoldingiz: ${v}` : ''; });
      this.set('wep', (me.weapon || '') + me.ammo, () => { e.wep.textContent = me.weapon === 'hammer' ? "🔨 Bolg'a" : me.weapon === 'pistol' ? `🔫 To'pponcha · ${me.ammo}` : ''; });
      this.set('stam', Math.round(me.stamina / 4), () => { e.stam.style.width = me.stamina + '%'; e.stam.style.background = me.tired ? '#c0392b' : '#c9c28a'; });
    }
    // nishon
    let prompt = null, prog = 0;
    if (me.role === 'survivor' && me.alive && !me.escaped && sim.target) {
      if (sim.target.kind === 'cab') { prompt = `<b>E</b> ni ushlab turing — ${sim.target.name === 'locker' ? 'shkafchani' : sim.target.name === 'dresser' ? 'tumbochkani' : 'shkafni'} qidirish`; prog = sim.search.p; }
      else if (sim.target.kind === 'wep') prompt = `<b>E</b> — ${sim.target.name === 'hammer' ? "bolg'ani" : "to'pponchani"} olish`;
      else if (sim.target.kind === 'exit') prompt = found >= need ? '<b>E</b> — chiqish eshigini ochish' : `Eshik qulflangan 🔒 (${found}/${need} kalit)`;
    }
    this.set('prompt', prompt, v => { e.prompt.classList.toggle('hidden', !v); if (v) e.promptTxt.innerHTML = v; });
    if (prompt) e.promptFill.style.width = Math.round(prog * 100) + '%';
    this.set('bloodOn', !!(sim.bite && sim.bite.to === me.id && me.alive), v => e.blood.classList.toggle('on', v));
    if (me.role === 'ghost') this.set('biteTxt', sim.bite ? 'b' : Math.max(0, Math.ceil(sim.biteReadyAt - sim.t)), v => { e.biteTxt.innerHTML = v === 'b' ? '🩸 Tishlab turibsiz…' : v > 0 ? `🦷 Tishlash ${v} s dan keyin` : '🦷 <b style="color:#ff8a80">TISHLASH TAYYOR</b> — odamga yaqinlashib <b>Y</b> bosing'; });
    if (me.role === 'ghost') this.set('snakeTxt', sim.snake ? 's' : Math.max(0, Math.ceil(sim.snakeReadyAt - sim.t)), v => { e.snakeTxt.innerHTML = v === 's' ? '🐍 Ilon ishlayapti…' : v > 0 ? `<kbd>T</kbd> 🐍 Ilon ${v} s dan keyin` : '<kbd>T</kbd> 🐍 <b style="color:#9fe89f">ILON TAYYOR</b> — yaqin odamni oyog\'idan tortadi'; });
    // ruh paneli
    if (me.role === 'ghost') this.set('inv', me.inv, () => { e.inv.innerHTML = me.inv ? 'ko\'rinish (hozir <b style="color:#9cc2ff">KO\'RINMASSIZ</b>)' : 'ko\'rinmas bo\'lish (hozir <b style="color:#ff8a80">KO\'RINASIZ</b>)'; });
    // o'yinchilar ro'yxati (sekin)
    this.pT -= dt;
    if (this.pT <= 0) {
      this.pT = 0.4;
      const key = [...sim.players.values()].map(p => p.id + p.alive + p.escaped + p.hearts + p.role).join('|');
      this.set('plist', key, () => {
        e.players.innerHTML = '';
        for (const p of sim.players.values()) {
          const d = document.createElement('div'); d.textContent = (p.role === 'ghost' ? '👻 ' : p.escaped ? '🚪 ' : p.alive ? '' : '💀 ') + p.name;
          d.className = p.role === 'ghost' ? 'gh' : p.escaped ? 'esc' : !p.alive ? 'dead' : ''; e.players.appendChild(d);
        }
      });
    }
    this.set('dead', (me.role === 'survivor' ? (me.escaped ? 'esc' : !me.alive ? 'dead' : '') : ''), v => { e.dead.classList.toggle('hidden', !v); if (v) e.dead.innerHTML = v === 'esc' ? '<b style="color:#6fe08a">QOCHDINGIZ!</b><span>Sheriklaringizni kuzating…</span>' : '<b>YIQILDINGIZ</b><span>Sheriklaringizni kuzating…</span>'; });
    // ruh uchun: hamma o'yinchilar nishoni (devordan ko'rinadi)
    const ghostView = me.role === 'ghost' || !me.alive || me.escaped;
    if (ghostView) {
      this._drawMap(sim, game);
      let i = 0;
      for (const p of sim.players.values()) {
        if (p.local || p.role === 'ghost' || !p.alive || p.escaped) continue;
        let el = this.markPool[i]; if (!el) { el = document.createElement('div'); el.className = 'mark'; e.marks.appendChild(el); this.markPool[i] = el; }
        this._v.set(p.x, 1.8, p.z).project(game.camera);
        if (this._v.z > 1 || this._v.z < -1) { el.style.display = 'none'; i++; continue; }
        el.style.display = ''; el.style.left = ((this._v.x * 0.5 + 0.5) * innerWidth) + 'px'; el.style.top = ((-this._v.y * 0.5 + 0.5) * innerHeight) + 'px';
        const d = Math.round(Math.hypot(p.x - me.x, p.z - me.z)); el.textContent = `${p.name} · ${d}m`;
        i++;
      }
      for (; i < this.markPool.length; i++) this.markPool[i].style.display = 'none';
    } else if (this.markPool.length) for (const el of this.markPool) el.style.display = 'none';
  }

  _drawMap(sim, game) {
    const cv = $('hzMap'), map = sim.map;
    if (!this.map) {
      const W = 240, sc = W / map.sizeX, H = Math.round(map.sizeZ * sc);
      cv.width = W; cv.height = H; cv.style.width = W + 'px'; cv.style.height = H + 'px'; cv.classList.remove('hidden');
      const bg = document.createElement('canvas'); bg.width = W; bg.height = H; const b = bg.getContext('2d');
      b.fillStyle = '#9db8e0'; for (const w of map.walls) b.fillRect(w.x0 * sc, w.z0 * sc, Math.max(1.2, (w.x1 - w.x0) * sc), Math.max(1.2, (w.z1 - w.z0) * sc));
      this.map = { bg, sc, ctx: cv.getContext('2d'), W, H, f: 0 };
    }
    const m = this.map; if ((m.f++ % 3) !== 0) return;
    const x = m.ctx, sc = m.sc; x.clearRect(0, 0, m.W, m.H); x.drawImage(m.bg, 0, 0);
    const ex = sim.map.exit; x.fillStyle = '#4dff7a'; x.fillRect(ex.x * sc - 3, ex.z * sc - 3, 6, 6);
    x.fillStyle = '#ffd04a'; for (const c of sim.map.cabinets) { if (!sim.cabs[c.id].open) x.fillRect(c.x * sc - 1.5, c.z * sc - 1.5, 3, 3); }
    x.font = '9px Georgia'; x.textAlign = 'center';
    for (const p of sim.players.values()) {
      if (p.role === 'ghost' || !p.alive || p.escaped) continue;
      x.fillStyle = p.local ? '#fff' : '#6fb4ff'; x.beginPath(); x.arc(p.x * sc, p.z * sc, 3.5, 0, 7); x.fill();
      if (!p.local) { x.fillStyle = '#cfe6ff'; x.fillText(p.name, p.x * sc, p.z * sc - 6); }
    }
    const me = sim.me; x.fillStyle = '#ff5a4a'; x.beginPath(); x.arc(me.x * sc, me.z * sc, 4, 0, 7); x.fill();
    x.strokeStyle = '#ff5a4a'; x.beginPath(); x.moveTo(me.x * sc, me.z * sc); x.lineTo(me.x * sc - Math.sin(game.lookYaw) * 12, me.z * sc - Math.cos(game.lookYaw) * 12); x.stroke();
  }
}
