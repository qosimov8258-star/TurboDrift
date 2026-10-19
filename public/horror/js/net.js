// Horror o'yini tarmog'i: WebSocket (/hws) yoki yakka o'yin uchun bo'sh LoopNet.
export class HNet {
  constructor() { this.ws = null; this.onmessage = null; this.onclose = null; this.id = null; this.room = null; this.loop = false; this.ping = 0; this._pt = null; }
  connect() {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      let ws; try { ws = new WebSocket(`${proto}://${location.host}/hws`); } catch (e) { return reject(e); }
      this.ws = ws;
      const to = setTimeout(() => { try { ws.close(); } catch (e) {} reject(new Error('Serverga ulanib bo\'lmadi')); }, 6000);
      ws.onopen = () => { clearTimeout(to); this._pt = setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000); resolve(); };
      ws.onerror = () => { clearTimeout(to); reject(new Error('Serverga ulanib bo\'lmadi')); };
      ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } if (m.t === 'pong') { this.ping = Math.round(performance.now() - m.c); return; } if (this.onmessage) this.onmessage(m); };
      ws.onclose = () => { clearInterval(this._pt); if (this.onclose) this.onclose(); };
    });
  }
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  close() { clearInterval(this._pt); if (this.ws) { this.ws.onclose = null; try { this.ws.close(); } catch (e) {} } this.ws = null; }
}
export class LoopNet {
  constructor() { this.loop = true; this.id = 'solo'; this.room = null; this.ping = 0; this.onmessage = null; }
  connect() { return Promise.resolve(); }
  send() {}
  close() {}
}
