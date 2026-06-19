import { getWsUrl } from './util.js';

export class SignalingClient {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.clientIp = null;
    this.peerId = null;
  }

  on(event, handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(handler);
    return () => {
      const list = this.handlers.get(event) || [];
      const idx = list.indexOf(handler);
      if (idx >= 0) list.splice(idx, 1);
    };
  }

  emit(event, data) {
    for (const handler of this.handlers.get(event) || []) {
      handler(data);
    }
  }

  connect(wsUrlOverride) {
    return new Promise((resolve, reject) => {
      const url = wsUrlOverride || getWsUrl();
      if (!url) {
        reject(new Error('클라이언트를 찾지 못했습니다.'));
        return;
      }
      const ws = new WebSocket(url);
      this.ws = ws;
      let settled = false;

      const fail = (err) => {
        if (settled) return;
        settled = true;
        reject(err instanceof Error ? err : new Error(String(err)));
      };

      const timer = setTimeout(() => {
        try { ws.close(); } catch { /* ignore */ }
        fail(new Error('클라이언트 연결 시간 초과. 로컬 네트워크 접근을 허용했는지 확인하세요.'));
      }, 10000);

      ws.onopen = () => {};

      ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }

        if (msg.type === 'welcome') {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.clientIp = msg.clientIp;
          this.peerId = msg.id;
          resolve(msg);
        }

        this.emit(msg.type, msg);
      };

      ws.onerror = () => fail(new Error('클라이언트 WebSocket 연결 실패. 같은 Wi-Fi인지 확인하세요.'));
      ws.onclose = () => {
        clearTimeout(timer);
        this.emit('close');
      };
    });
  }

  send(type, payload = {}) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, ...payload }));
    }
  }

  registerHost(name, platform = 'web') {
    this.send('register-host', { name, platform });
  }

  connectToClient(code) {
    this.send('connect', { code });
  }

  sendOffer(sdp, code) {
    this.send('offer', { sdp, ...(code ? { code } : {}) });
  }

  sendAnswer(sdp, code) {
    this.send('answer', { sdp, ...(code ? { code } : {}) });
  }

  sendIceCandidate(candidate, code) {
    this.send('ice-candidate', { candidate, ...(code ? { code } : {}) });
  }

  disconnectPeer(code) {
    this.send('disconnect-peer', code ? { code } : {});
  }

  sendPeerReady() {
    this.send('peer-ready');
  }

  close() {
    this.ws?.close();
  }
}
