import { showNameModal, showAlert, openSettings } from './settings-ui.js';
import { SignalingClient } from './signaling.js';
import { RtcSession } from './rtc.js';
import { normalizeCode, isValidCode } from './codes.js';
import { STORAGE_KEYS, getClientIp, setClientIp } from './util.js';
import { initIcons } from './icons.js';
import { ensureM3 } from './m3-setup.js';
import { discoverClient } from './discovery.js';

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

let signaling = null;
let rtc = null;
let mediaStream = null;
let selectedClient = null;
let hostName = '';
let peerReadyResolve = null;
let isSharing = false;
let handlersBound = false;
let clientIp = '';
let discoveredClient = null;

function getCodeValue() {
  return normalizeCode(codeInput?.value || '');
}

function getWsUrl() {
  const ip = clientIp || getClientIp();
  return ip ? `ws://${ip}:3847` : '';
}

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
  sharingTo.textContent = `${selectedClient?.name || '클라이언트'}에게 공유 중`;
  initIcons(hostControlBar);
}

function exitSharingUI() {
  isSharing = false;
  hostApp.classList.remove('sharing-mode');
  livePanel.classList.add('panel-hidden');
  hostControlBar.classList.add('panel-hidden');
  idlePanel.classList.remove('panel-hidden');
}

async function waitPeerReady() {
  return new Promise((resolve) => {
    peerReadyResolve = resolve;
    setTimeout(resolve, 8000);
  });
}

function bindSignalingHandlers() {
  if (handlersBound || !signaling) return;
  handlersBound = true;
  signaling.on('peer-ready', () => {
    peerReadyResolve?.();
    peerReadyResolve = null;
  });
  signaling.on('peer-disconnected', () => {
    stopSharing({ notifyServer: false, showRemoteAlert: true });
  });
  signaling.on('client-left', () => {
    stopSharing({ notifyServer: false, showRemoteAlert: true });
  });
  signaling.on('error', ({ message }) => showAlert('오류', message));
}

async function ensureSignaling() {
  const wsUrl = getWsUrl();
  if (!wsUrl) throw new Error('클라이언트를 찾지 못했습니다. 클라이언트 앱이 실행 중인지 확인하세요.');
  if (signaling) signaling.close();
  signaling = new SignalingClient();
  bindSignalingHandlers();
  await signaling.connect(wsUrl);
  signaling.registerHost(hostName, 'web');
}

async function autoDiscoverClient() {
  if (discoverStatus) discoverStatus.textContent = '기기를 찾는 중…';
  shareBtn.disabled = true;

  discoveredClient = await discoverClient({
    onProgress: (msg) => { if (discoverStatus) discoverStatus.textContent = msg; },
  });

  shareBtn.disabled = false;

  if (discoveredClient) {
    clientIp = discoveredClient.ip;
    setClientIp(clientIp);
    if (codeInput) codeInput.value = discoveredClient.code;
    if (lanHint) {
      lanHint.innerHTML = `클라이언트 <strong>${discoveredClient.name}</strong> · 코드 <strong>${discoveredClient.code}</strong>`;
    }
    if (discoverStatus) discoverStatus.textContent = '클라이언트를 찾았습니다.';
    return true;
  }

  if (clientIpInput) clientIpInput.style.display = '';
  if (discoverStatus) {
    discoverStatus.textContent = '자동 검색 실패 — IP와 코드를 입력하세요.';
  }
  return false;
}

async function selectAndShare() {
  if (!canShareScreen()) {
    showAlert(
      'HTTPS 필요',
      '화면 공유는 보안 연결(HTTPS)에서만 가능합니다.\n\nGitHub Pages 주소로 접속하세요:\nhttps://jaewondev27.github.io/d-share-web/',
    );
    return;
  }

  const normalized = getCodeValue();
  if (!isValidCode(normalized)) {
    showAlert('코드 오류', '6자리 영문·숫자 코드를 입력하세요.');
    return;
  }

  if (!clientIp && !getClientIp()) {
    const manualIp = clientIpInput?.value?.trim();
    if (manualIp && /^\d{1,3}(\.\d{1,3}){3}$/.test(manualIp)) {
      clientIp = manualIp;
      setClientIp(clientIp);
    } else {
      await autoDiscoverClient();
    }
  }

  try {
    await ensureSignaling();
    selectedClient = {
      code: normalized,
      name: discoveredClient?.name || '클라이언트',
      ip: clientIp || getClientIp(),
    };
    signaling.connectToClient(normalized);
    await waitPeerReady();
    await startSharing();
  } catch (err) {
    showAlert(
      '연결 오류',
      err.message || '클라이언트에 연결할 수 없습니다. Chrome에서「로컬 네트워크 접근」을 허용했는지 확인하세요.',
    );
    signaling?.close();
    signaling = null;
    handlersBound = false;
  }
}

async function startSharing() {
  if (!selectedClient) return;
  if (!canShareScreen()) {
    showAlert('HTTPS 필요', '화면 공유 API를 사용할 수 없습니다. GitHub Pages(HTTPS)에서 열어주세요.');
    return;
  }
  try {
    mediaStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: true,
    });
    rtc?.close();
    rtc = new RtcSession('host', signaling);
    rtc.onConnectionStateChange = (state) => {
      if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        stopSharing({ notifyServer: false });
      }
    };
    await rtc.addLocalStream(mediaStream);
    await rtc.createOffer();
    enterSharingUI();
    mediaStream.getVideoTracks()[0].addEventListener('ended', () => {
      stopSharing({ notifyServer: true });
    });
  } catch (err) {
    if (err.name !== 'NotAllowedError') showAlert('오류', err.message || String(err));
    signaling?.disconnectPeer();
    selectedClient = null;
  }
}

function stopSharing({ notifyServer = true, showRemoteAlert = false } = {}) {
  if (!isSharing && !mediaStream && !rtc) return;
  mediaStream?.getTracks().forEach((t) => t.stop());
  mediaStream = null;
  rtc?.close();
  rtc = null;
  if (notifyServer) signaling?.disconnectPeer();
  exitSharingUI();
  selectedClient = null;
  peerReadyResolve = null;
  if (showRemoteAlert) showAlert('연결 종료', '클라이언트 연결이 끊어졌습니다.');
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
      signaling?.registerHost(name, 'web');
    },
  });
});

async function init() {
  await ensureM3();

  clientIp = getClientIp();
  if (clientIp && lanHint) {
    lanHint.textContent = `저장된 클라이언트: ${clientIp}`;
  }

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
    showAlert(
      'HTTPS 필요',
      '이 페이지는 HTTP로 열려 화면 공유가 불가합니다.\n\nGitHub Pages에서 이용하세요:\nhttps://jaewondev27.github.io/d-share-web/',
    );
  }

  await autoDiscoverClient();
}

init().catch((err) => showAlert('시작 오류', err.message));
