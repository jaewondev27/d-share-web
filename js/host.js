import { showNameModal, showAlert, openSettings } from './settings-ui.js';
import { SignalingClient } from './signaling.js';
import { RtcSession } from './rtc.js';
import { normalizeCode, isValidCode } from './codes.js';
import { STORAGE_KEYS } from './util.js';
import { initIcons } from './icons.js';
import { ensureM3 } from './m3-setup.js';
import { discoverAllClients } from './discovery.js';

const MAX_CLIENTS = 3;

const hostApp = document.getElementById('host-app');
const idlePanel = document.getElementById('idle-panel');
const livePanel = document.getElementById('live-panel');
const hostControlBar = document.getElementById('host-control-bar');
const shareBtn = document.getElementById('share-btn');
const stopBtn = document.getElementById('stop-btn');
const hostNameDisplay = document.getElementById('host-name-display');
const sharingTo = document.getElementById('sharing-to');
const sharingTitle = document.getElementById('sharing-title');
const codeInput = document.getElementById('code-input');
const clientIpInput = document.getElementById('client-ip-input');
const lanHint = document.getElementById('https-hint');
const discoverStatus = document.getElementById('discover-status');
const clientListEl = document.getElementById('client-list');

let mediaStream = null;
let hostName = '';
let isSharing = false;
let discoveredClients = [];
const selectedClients = new Map();
/** @type {Map<string, { signaling: SignalingClient, rtc: RtcSession, meta: object, peerReadyResolve: Function|null }>} */
const sessions = new Map();

function canShareScreen() {
  return !!(window.isSecureContext && navigator.mediaDevices?.getDisplayMedia);
}

function enterSharingUI() {
  isSharing = true;
  hostApp.classList.add('sharing-mode');
  idlePanel.classList.add('panel-hidden');
  livePanel.classList.remove('panel-hidden');
  hostControlBar.classList.remove('panel-hidden');
  sharingTitle.textContent = hostName;
  updateSharingStatus();
  initIcons(hostControlBar);
}

function updateSharingStatus() {
  const n = sessions.size;
  sharingTo.textContent = n > 0 ? `${n}명의 클라이언트에게 공유 중` : '연결 중…';
}

function exitSharingUI() {
  isSharing = false;
  hostApp.classList.remove('sharing-mode');
  livePanel.classList.add('panel-hidden');
  hostControlBar.classList.add('panel-hidden');
  idlePanel.classList.remove('panel-hidden');
}

function renderClientList() {
  if (!clientListEl) return;
  clientListEl.innerHTML = '';
  if (!discoveredClients.length) {
    clientListEl.innerHTML = '<p class="hint-text" style="margin:8px 0">클라이언트 앱을 실행하면 여기에 표시됩니다.</p>';
    return;
  }
  discoveredClients.forEach((client) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'client-chip' + (selectedClients.has(client.code) ? ' selected' : '');
    btn.innerHTML = `<strong>${client.name}</strong><span>${client.code}</span>`;
    btn.onclick = () => toggleClient(client);
    clientListEl.appendChild(btn);
  });
}

function toggleClient(client) {
  if (selectedClients.has(client.code)) {
    selectedClients.delete(client.code);
  } else {
    if (selectedClients.size >= MAX_CLIENTS) {
      showAlert('선택 제한', `최대 ${MAX_CLIENTS}명까지 선택할 수 있습니다.`);
      return;
    }
    selectedClients.set(client.code, client);
  }
  if (selectedClients.size === 1) {
    codeInput.value = [...selectedClients.values()][0].code;
  } else if (selectedClients.size === 0) {
    codeInput.value = '';
  }
  renderClientList();
  if (lanHint) {
    lanHint.textContent = selectedClients.size
      ? `${selectedClients.size}명 선택됨 (최대 ${MAX_CLIENTS}명)`
      : '목록에서 클라이언트를 선택하세요 (최대 3명)';
  }
}

async function autoDiscoverClients() {
  if (discoverStatus) discoverStatus.textContent = '기기를 찾는 중…';
  shareBtn.disabled = true;
  discoveredClients = await discoverAllClients({
    onProgress: (msg) => { if (discoverStatus) discoverStatus.textContent = msg; },
  });
  shareBtn.disabled = false;
  renderClientList();
  if (discoveredClients.length) {
    if (discoveredClients.length === 1) toggleClient(discoveredClients[0]);
    if (discoverStatus) discoverStatus.textContent = `${discoveredClients.length}대 발견 — 최대 ${MAX_CLIENTS}명 선택`;
    if (clientIpInput) clientIpInput.style.display = 'none';
  } else {
    if (clientIpInput) clientIpInput.style.display = '';
    if (discoverStatus) discoverStatus.textContent = '자동 검색 실패 — IP와 코드를 직접 입력하세요.';
  }
}

function resolveTargets() {
  if (selectedClients.size) return [...selectedClients.values()];
  const code = normalizeCode(codeInput?.value || '');
  const ip = clientIpInput?.value?.trim();
  if (isValidCode(code) && ip && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    return [{ code, ip, name: '클라이언트' }];
  }
  if (isValidCode(code)) {
    const found = discoveredClients.find((c) => c.code === code);
    if (found) return [found];
  }
  return [];
}

function waitPeerReady(session) {
  return new Promise((resolve) => {
    session.peerReadyResolve = resolve;
    setTimeout(resolve, 8000);
  });
}

function bindSessionHandlers(session, meta) {
  const { signaling, code } = session;
  signaling.on('peer-ready', () => {
    session.peerReadyResolve?.();
    session.peerReadyResolve = null;
  });
  signaling.on('peer-disconnected', () => removeSession(code, { notify: false, alert: true }));
  signaling.on('client-left', (msg) => {
    if (!msg.code || msg.code.toUpperCase() === code) {
      removeSession(code, { notify: false, alert: true });
    }
  });
  signaling.on('error', ({ message }) => showAlert('오류', message));
}

async function connectClient(meta) {
  const code = meta.code.toUpperCase();
  if (sessions.has(code)) return;
  const signaling = new SignalingClient();
  const session = { signaling, rtc: null, meta, peerReadyResolve: null };
  bindSessionHandlers(session, meta);
  await signaling.connect(`ws://${meta.ip}:3847`);
  signaling.registerHost(hostName, 'web');
  signaling.connectToClient(code);
  sessions.set(code, session);
  await waitPeerReady(session);
  const rtc = new RtcSession('host', signaling, code);
  rtc.onConnectionStateChange = (state) => {
    if (state === 'failed' || state === 'disconnected' || state === 'closed') {
      removeSession(code, { notify: false });
    }
  };
  session.rtc = rtc;
  await rtc.addLocalStream(mediaStream);
  await rtc.createOffer();
}

async function selectAndShare() {
  if (!canShareScreen()) {
    showAlert('HTTPS 필요', '화면 공유는 GitHub Pages(HTTPS)에서만 가능합니다.\n\nhttps://jaewondev27.github.io/d-share-web/');
    return;
  }
  const targets = resolveTargets();
  if (!targets.length) {
    showAlert('선택 필요', '클라이언트를 선택하거나 IP와 코드를 입력하세요.');
    return;
  }
  if (targets.length > MAX_CLIENTS) {
    showAlert('선택 제한', `최대 ${MAX_CLIENTS}명까지 연결할 수 있습니다.`);
    return;
  }
  try {
    if (!mediaStream) {
      mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: true,
      });
      mediaStream.getVideoTracks()[0].addEventListener('ended', () => {
        stopSharing({ notifyServer: true });
      });
    }
    enterSharingUI();
    for (const meta of targets) {
      if (sessions.has(meta.code.toUpperCase())) continue;
      try {
        await connectClient(meta);
      } catch (err) {
        showAlert('연결 오류', `${meta.name || meta.code}: ${err.message}`);
      }
    }
    updateSharingStatus();
    if (sessions.size === 0) {
      stopSharing({ notifyServer: false });
    }
  } catch (err) {
    if (err.name !== 'NotAllowedError') showAlert('오류', err.message || String(err));
    stopSharing({ notifyServer: false });
  }
}

function removeSession(code, { notify = true, alert = false } = {}) {
  const key = code.toUpperCase();
  const session = sessions.get(key);
  if (!session) return;
  if (notify) session.signaling.disconnectPeer(key);
  session.rtc?.close();
  session.signaling.close();
  sessions.delete(key);
  updateSharingStatus();
  if (alert && isSharing) {
    showAlert('연결 종료', `${session.meta.name || key} 연결이 끊어졌습니다.`);
  }
  if (isSharing && sessions.size === 0) exitSharingUI();
}

function stopSharing({ notifyServer = true } = {}) {
  mediaStream?.getTracks().forEach((t) => t.stop());
  mediaStream = null;
  [...sessions.keys()].forEach((code) => removeSession(code, { notify: notifyServer, alert: false }));
  exitSharingUI();
}

function setupInputs() {
  codeInput?.addEventListener('input', () => {
    const v = normalizeCode(codeInput.value);
    if (codeInput.value !== v) codeInput.value = v;
  });
}

shareBtn.addEventListener('click', () => selectAndShare());
stopBtn.addEventListener('click', () => stopSharing({ notifyServer: true }));

document.getElementById('settings-btn').addEventListener('click', () => {
  openSettings({
    nameStorageKey: STORAGE_KEYS.hostName,
    currentName: hostName,
    webHostOnly: true,
    onNameChange: (name) => {
      hostName = name;
      hostNameDisplay.textContent = name;
      sessions.forEach((s) => s.signaling.registerHost(name, 'web'));
    },
  });
});

async function init() {
  await ensureM3();
  hostName = await showNameModal({
    storageKey: STORAGE_KEYS.hostName,
    title: '이름 설정',
    description: '다른 기기에서 표시될 이름을 입력하세요.',
    placeholder: '예: 재원',
  });
  hostNameDisplay.textContent = hostName;
  setupInputs();
  initIcons(document.body);
  if (!canShareScreen()) {
    showAlert('HTTPS 필요', 'GitHub Pages에서 이용하세요:\nhttps://jaewondev27.github.io/d-share-web/');
  }
  if (lanHint) lanHint.textContent = `목록에서 클라이언트 선택 (최대 ${MAX_CLIENTS}명)`;
  await autoDiscoverClients();
}

init().catch((err) => showAlert('시작 오류', err.message));
