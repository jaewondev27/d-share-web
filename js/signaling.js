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
        reject(new Error('클라이언트 IP를 입력하세요.'));
        return;
      }
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {};

      ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }

        if (msg.type === 'welcome') {
          this.clientIp = msg.clientIp;
          this.peerId = msg.id;
          resolve(msg);
        }

        this.emit(msg.type, msg);
      };

      ws.onerror = () => reject(new Error('클라이언트에 연결할 수 없습니다.'));
      ws.onclose = () => this.emit('close');
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

  sendOffer(sdp) {
    this.send('offer', { sdp });
  }

  sendAnswer(sdp) {
    this.send('answer', { sdp });
  }

  sendIceCandidate(candidate) {
    this.send('ice-candidate', { candidate });
  }

  disconnectPeer() {
    this.send('disconnect-peer');
  }

  sendPeerReady() {
    this.send('peer-ready');
  }

  close() {
    this.ws?.close();
  }
}
