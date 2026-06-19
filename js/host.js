import { showNameModal, showAlert, openSettings } from './settings-ui.js';
import { SignalingClient } from './signaling.js';
import { RtcSession } from './rtc.js';
import { normalizeCode, isValidCode } from './codes.js';
import { STORAGE_KEYS } from './util.js';
import { initIcons } from './icons.js';
import { ensureM3 } from './m3-setup.js';
import { discoverAllClients, findClientByCode } from './discovery.js';

const MAX_CLIENTS = 3;
const isNativeHost = !!window.dshare?.isNativeHost;
const platform = isNativeHost ? (window.dshare.platform || 'windows') : 'web';

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
const sessions = new Map();
let discoveryTimer = null;

function canShareScreen() {
  if (isNativeHost) return !!navigator.mediaDevices?.getDisplayMedia;
  return !!(window.isSecureContext && navigator.mediaDevices?.getDisplayMedia);
}

function enterSharingUI() {
  isSharing = true;
  stopDiscoveryLoop();
  hostApp.classList.add('sharing-mode');
  idlePanel.classList.add('panel-hidden');
  livePanel.classList.remove('panel-hidden');
  hostControlBar.classList.remove('panel-hidden');
  sharingTitle.textContent = hostName;
  updateSharingStatus();
  initIcons(hostControlBar);
}

function updateSharingStatus() {
  sharingTo.textContent = sessions.size > 0
    ? `${sessions.size}명의 클라이언트에게 공유 중`
    : '연결 중…';
}

function exitSharingUI() {
  isSharing = false;
  hostApp.classList.remove('sharing-mode');
  livePanel.classList.add('panel-hidden');
  hostControlBar.classList.add('panel-hidden');
  idlePanel.classList.remove('panel-hidden');
  startDiscoveryLoop();
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
  const code = client.code.toUpperCase();
  if (selectedClients.has(code)) {
    selectedClients.delete(code);
  } else {
    if (selectedClients.size >= MAX_CLIENTS) {
      showAlert('선택 제한', `최대 ${MAX_CLIENTS}명까지 선택할 수 있습니다.`);
      return;
    }
    selectedClients.set(code, { ...client, code });
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
      : `목록에서 클라이언트 선택 (최대 ${MAX_CLIENTS}명)`;
  }
}

async function fetchDiscoveredClients(onProgress) {
  if (isNativeHost && window.dshare?.discoverClients) {
    onProgress?.('기기를 찾는 중…');
    return (await window.dshare.discoverClients()) || [];
  }
  return discoverAllClients({ onProgress });
}

async function autoDiscoverClients() {
  if (discoverStatus) discoverStatus.textContent = '기기를 찾는 중…';
  shareBtn.disabled = true;
  try {
    discoveredClients = await fetchDiscoveredClients((msg) => {
      if (discoverStatus) discoverStatus.textContent = msg;
    });
  } catch (err) {
    discoveredClients = [];
    if (discoverStatus) discoverStatus.textContent = '검색 오류: ' + err.message;
  }
  shareBtn.disabled = false;
  renderClientList();
  if (discoveredClients.length) {
    if (discoverStatus) {
      discoverStatus.textContent = `${discoveredClients.length}대 발견 — 최대 ${MAX_CLIENTS}명 선택`;
    }
    if (clientIpInput) clientIpInput.style.display = 'none';
  } else {
    if (clientIpInput) clientIpInput.style.display = '';
    if (discoverStatus) discoverStatus.textContent = '자동 검색 실패 — IP와 코드를 직접 입력하세요.';
  }
}

function startDiscoveryLoop() {
  stopDiscoveryLoop();
  if (isSharing) return;
  discoveryTimer = setInterval(() => autoDiscoverClients(), 4000);
}

function stopDiscoveryLoop() {
  if (discoveryTimer) {
    clearInterval(discoveryTimer);
    discoveryTimer = null;
  }
}

async function resolveTargets() {
  if (selectedClients.size) return [...selectedClients.values()];

  const code = normalizeCode(codeInput?.value || '');
  if (!isValidCode(code)) return [];

  const ip = clientIpInput?.value?.trim();
  if (ip && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    return [{ code, ip, name: '클라이언트' }];
  }

  const found = discoveredClients.find((c) => c.code === code);
  if (found) return [found];

  if (discoverStatus) discoverStatus.textContent = `코드 ${code} 검색 중…`;
  const probed = await findClientByCode(code, {
    onProgress: (msg) => { if (discoverStatus) discoverStatus.textContent = msg; },
  });
  if (probed) {
    discoveredClients = [...discoveredClients.filter((c) => c.code !== probed.code), probed];
    renderClientList();
    return [probed];
  }
  return [];
}

function bindSessionHandlers(session, code) {
  const upper = code.toUpperCase();
  const { signaling } = session;
  signaling.on('peer-ready', (msg) => {
    if (msg?.code && msg.code.toUpperCase() !== upper) return;
    session.peerReadyResolve?.();
    session.peerReadyResolve = null;
  });
  signaling.on('peer-disconnected', () => removeSession(upper, { notify: false, alert: true }));
  signaling.on('client-left', (msg) => {
    if (!msg?.code || msg.code.toUpperCase() === upper) {
      removeSession(upper, { notify: false, alert: true });
    }
  });
  signaling.on('error', ({ message }) => showAlert('오류', message));
}

async function connectClient(meta) {
  const code = meta.code.toUpperCase();
  if (sessions.has(code)) return;

  const signaling = new SignalingClient();
  const session = { signaling, rtc: null, meta, peerReadyResolve: null };
  bindSessionHandlers(session, code);

  const peerReady = new Promise((resolve) => {
    session.peerReadyResolve = resolve;
    setTimeout(resolve, 10000);
  });

  await signaling.connect(`ws://${meta.ip}:3847`);
  signaling.registerHost(hostName, platform);
  signaling.connectToClient(code);
  sessions.set(code, session);

  await peerReady;

  const rtc = new RtcSession('host', signaling, code);
  rtc.onControlMessage = handleControl;
  rtc.onConnectionStateChange = (state) => {
    if (state === 'failed' || state === 'disconnected' || state === 'closed') {
      removeSession(code, { notify: false });
    }
  };
  session.rtc = rtc;
  await rtc.addLocalStream(mediaStream);
  await rtc.createOffer();
}

async function getScreenStream() {
  return navigator.mediaDevices.getDisplayMedia({
    video: {
      frameRate: { ideal: 30, max: 30 },
      width: { ideal: 1920, max: 1920 },
      height: { ideal: 1080, max: 1080 },
    },
    audio: !isNativeHost,
  });
}

async function handleControl(msg) {
  if (isNativeHost && window.dshare?.injectControl) {
    await window.dshare.injectControl(msg);
  }
}

async function selectAndShare() {
  if (!canShareScreen()) {
    showAlert(
      '화면 공유 불가',
      isNativeHost
        ? '화면 캡처 API를 사용할 수 없습니다. WebView2 런타임을 설치해 주세요.'
        : 'GitHub Pages(HTTPS)에서 접속하세요:\nhttps://jaewondev27.github.io/d-share-web/',
    );
    return;
  }

  const targets = await resolveTargets();
  if (!targets.length) {
    showAlert('선택 필요', '클라이언트를 선택하거나 IP와 6자리 코드를 입력하세요.');
    return;
  }
  if (targets.length > MAX_CLIENTS) {
    showAlert('선택 제한', `최대 ${MAX_CLIENTS}명까지 연결할 수 있습니다.`);
    return;
  }

  shareBtn.disabled = true;
  try {
    if (!mediaStream) {
      mediaStream = await getScreenStream();
      mediaStream.getVideoTracks()[0]?.addEventListener('ended', () => {
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
    if (sessions.size === 0) stopSharing({ notifyServer: false });
  } catch (err) {
    if (err.name !== 'NotAllowedError') showAlert('오류', err.message || String(err));
    stopSharing({ notifyServer: false });
  } finally {
    shareBtn.disabled = false;
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
    if (v.length === 6) {
      const hit = discoveredClients.find((c) => c.code === v);
      if (hit && !selectedClients.has(v)) {
        selectedClients.set(v, hit);
        renderClientList();
        if (lanHint) lanHint.textContent = `1명 선택됨 (최대 ${MAX_CLIENTS}명)`;
      }
    }
  });
}

shareBtn.addEventListener('click', () => selectAndShare());
stopBtn.addEventListener('click', () => stopSharing({ notifyServer: true }));

document.getElementById('settings-btn').addEventListener('click', () => {
  openSettings({
    nameStorageKey: STORAGE_KEYS.hostName,
    currentName: hostName,
    webHostOnly: !isNativeHost,
    onNameChange: (name) => {
      hostName = name;
      hostNameDisplay.textContent = name;
      sessions.forEach((s) => s.signaling.registerHost(name, platform));
    },
  });
});

async function waitNativeBridge() {
  if (window.dshare?.isNativeHost) return;
  await new Promise((resolve) => {
    if (window.dshare?.isNativeHost) return resolve();
    window.addEventListener('dshare-ready', resolve, { once: true });
    setTimeout(resolve, 500);
  });
}

async function init() {
  await waitNativeBridge();
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

  if (lanHint) {
    lanHint.textContent = isNativeHost
      ? '같은 Wi-Fi · LAN 직접 연결 (최대 3명)'
      : '같은 Wi-Fi · GitHub Pages HTTPS';
  }

  if (!isNativeHost && !canShareScreen()) {
    showAlert('HTTPS 필요', 'https://jaewondev27.github.io/d-share-web/ 에서 이용하세요.');
  }

  await autoDiscoverClients();
  startDiscoveryLoop();
}

init().catch((err) => showAlert('시작 오류', err.message));
