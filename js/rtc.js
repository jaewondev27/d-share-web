const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

function toSessionDescription(sdp) {
  if (!sdp) return null;
  if (typeof sdp === 'string') return { type: 'offer', sdp };
  return { type: sdp.type, sdp: sdp.sdp };
}

export class RtcSession {
  constructor(role, signaling, clientCode = '') {
    this.role = role;
    this.signaling = signaling;
    this.clientCode = clientCode;
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.controlChannel = null;
    this.remoteStream = new MediaStream();
    this.onRemoteStream = null;
    this.onControlMessage = null;
    this.onConnectionStateChange = null;
    this._pendingCandidates = [];
    this._remoteSet = false;
    this._unsubs = [];

    this.pc.ontrack = (ev) => {
      const stream = ev.streams?.[0] || (() => {
        this.remoteStream.addTrack(ev.track);
        return this.remoteStream;
      })();
      if (ev.streams?.[0]) {
        this.remoteStream = stream;
      }
      this.onRemoteStream?.(stream);
    };

    this.pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.signaling.sendIceCandidate(ev.candidate.toJSON(), this.clientCode || undefined);
      }
    };

    this.pc.onconnectionstatechange = () => {
      this.onConnectionStateChange?.(this.pc.connectionState);
    };

    if (role === 'host') {
      this.controlChannel = this.pc.createDataChannel('control', { ordered: true });
      this.setupControlChannel(this.controlChannel);
    } else {
      this.pc.ondatachannel = (ev) => {
        this.controlChannel = ev.channel;
        this.setupControlChannel(ev.channel);
      };
    }

    this._unsubs.push(
      signaling.on('offer', (msg) => this._onOffer(msg)),
      signaling.on('answer', (msg) => this._onAnswer(msg)),
      signaling.on('ice-candidate', (msg) => this._onIce(msg)),
    );
  }

  _matchesCode(msg) {
    const c = (msg.code || '').toUpperCase();
    if (!this.clientCode) return true;
    return !c || c === this.clientCode.toUpperCase();
  }

  async _onOffer(msg) {
    if (this.role !== 'client' || !this._matchesCode(msg)) return;
    const desc = toSessionDescription(msg.sdp);
    if (!desc) return;
    await this.pc.setRemoteDescription(desc);
    this._remoteSet = true;
    await this._flushCandidates();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this.signaling.sendAnswer(this.pc.localDescription);
  }

  async _onAnswer(msg) {
    if (this.role !== 'host' || !this._matchesCode(msg)) return;
    const desc = toSessionDescription(msg.sdp);
    if (!desc) return;
    await this.pc.setRemoteDescription(desc);
    this._remoteSet = true;
    await this._flushCandidates();
  }

  async _onIce(msg) {
    if (!this._matchesCode(msg)) return;
    const candidate = msg.candidate;
    if (!candidate) return;
    if (!this._remoteSet) {
      this._pendingCandidates.push(candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(candidate);
    } catch { /* ignore */ }
  }

  async _flushCandidates() {
    for (const c of this._pendingCandidates) {
      try { await this.pc.addIceCandidate(c); } catch { /* ignore */ }
    }
    this._pendingCandidates = [];
  }

  setupControlChannel(channel) {
    channel.onmessage = (ev) => {
      try {
        this.onControlMessage?.(JSON.parse(ev.data));
      } catch { /* ignore */ }
    };
  }

  async addLocalStream(stream) {
    for (const track of stream.getTracks()) {
      this.pc.addTrack(track, stream);
    }
  }

  async createOffer() {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.signaling.sendOffer(this.pc.localDescription, this.clientCode || undefined);
  }

  sendControl(msg) {
    if (this.controlChannel?.readyState === 'open') {
      this.controlChannel.send(JSON.stringify(msg));
    }
  }

  close() {
    for (const unsub of this._unsubs) unsub();
    this._unsubs = [];
    this.controlChannel?.close();
    this.pc.close();
  }
}

export function normalizedPointerEvent(ev, element) {
  const rect = element.getBoundingClientRect();
  const point = ev.touches?.[0] || ev.changedTouches?.[0] || ev;
  const x = (point.clientX - rect.left) / rect.width;
  const y = (point.clientY - rect.top) / rect.height;
  return {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
  };
}

export function attachPointerControl(element, sendFn) {
  let active = false;

  const emit = (action, ev) => {
    const { x, y } = normalizedPointerEvent(ev, element);
    sendFn({ type: 'pointer', action, x, y, button: 0 });
  };

  const onDown = (ev) => { active = true; emit('down', ev); ev.preventDefault(); };
  const onMove = (ev) => { if (!active) return; emit('move', ev); };
  const onUp = (ev) => { if (!active) return; active = false; emit('up', ev); };
  const onWheel = (ev) => { sendFn({ type: 'scroll', dx: ev.deltaX, dy: ev.deltaY }); ev.preventDefault(); };

  element.addEventListener('mousedown', onDown);
  element.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  element.addEventListener('touchstart', onDown, { passive: false });
  element.addEventListener('touchmove', onMove, { passive: false });
  element.addEventListener('touchend', onUp, { passive: false });
  element.addEventListener('wheel', onWheel, { passive: false });

  return () => {
    element.removeEventListener('mousedown', onDown);
    element.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    element.removeEventListener('touchstart', onDown);
    element.removeEventListener('touchmove', onMove);
    element.removeEventListener('touchend', onUp);
    element.removeEventListener('wheel', onWheel);
  };
}

export async function bindVideoStream(video, stream) {
  video.srcObject = stream;
  video.muted = true;
  try {
    await video.play();
  } catch { /* autoplay policy */ }
}
