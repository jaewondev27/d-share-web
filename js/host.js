import { showNameModal, showAlert, openSettings } from './settings-ui.js';
import { SignalingClient } from './signaling.js';
import { RtcSession } from './rtc.js';
import { normalizeCode, isValidCode } from './codes.js';
import { STORAGE_KEYS, getClientIp, setClientIp } from './util.js';
import { getRelayWsUrl, useRelaySignaling } from './config.js';
import { initIcons } from './icons.js';
import { ensureM3 } from './m3-setup.js';
import { getSettings } from './settings.js';

const useRelay = useRelaySignaling();

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
const httpsHint = document.getElementById('https-hint');

let signaling = null;
let rtc = null;
let mediaStream = null;
let selectedClient = null;
let hostName = '';
let peerReadyResolve = null;
let isSharing = false;
let handlersBound = false;

function getCodeValue() {
  return normalizeCode(codeInput?.value || '');
}

function getIpValue() {
  return (clientIpInput?.value || getClientIp() || '').trim();
}

function enterSharingUI() {
  isSharing = true;
  hostApp.classList.add('sharing-mode');
  idlePanel.classList.add('panel-hidden');
  livePanel.classList.remove('panel-hidden');
  hostControlBar.classList.remove('panel-hidden');
  sharingTitle.textContent = hostName;
  sharingTo.textContent = `${selectedClient.name}에게 공유 중`;
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
    setTimeout(resolve, 5000);
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
  const wsUrl = useRelay ? getRelayWsUrl() : `ws://${getIpValue()}:3847`;
  if (!wsUrl) {
    throw new Error('릴레이 서버 URL이 설정되지 않았습니다.');
  }
  if (signaling) signaling.close();
  signaling = new SignalingClient();
  bindSignalingHandlers();
  await signaling.connect(wsUrl);
  signaling.registerHost(hostName, 'web');
}

async function selectAndShare() {
  const normalized = getCodeValue();
  if (!isValidCode(normalized)) {
    showAlert('코드 오류', '6자리 영문·숫자 코드를 입력하세요.');
    return;
  }
  if (!useRelay) {
    const clientIp = getIpValue();
    if (!clientIp) {
      showAlert('IP 필요', '클라이언트 앱에 표시된 IP를 입력하세요.');
      return;
    }
    setClientIp(clientIp);
  }
  try {
    await ensureSignaling();
    selectedClient = {
      code: normalized,
      name: '클라이언트',
      ip: useRelay ? 'relay' : getIpValue(),
    };
    signaling.connectToClient(normalized);
    await waitPeerReady();
    await startSharing();
  } catch (err) {
    const hint = useRelay
      ? '클라이언트 앱이 켜져 있는지, 같은 코드가 표시되는지 확인하세요. 릴레이 서버가 배포되어 있어야 합니다.'
      : (err.message || '클라이언트에 연결할 수 없습니다.');
    showAlert('연결 오류', hint);
    signaling?.close();
    signaling = null;
    handlersBound = false;
  }
}

async function startSharing() {
  if (!selectedClient) return;
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
    if (err.name !== 'NotAllowedError') showAlert('오류', err.message);
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
  if (!useRelay) {
    const savedIp = getClientIp();
    if (savedIp && clientIpInput) clientIpInput.value = savedIp;
  } else if (clientIpInput) {
    clientIpInput.style.display = 'none';
  }
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
  if (useRelay && httpsHint) {
    httpsHint.innerHTML = 'GitHub Pages에서 <strong>코드만</strong> 입력하면 연결됩니다.<br>클라이언트 앱이 같은 Wi-Fi에 있어야 합니다.';
    httpsHint.style.color = '#5b58e7';
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
}

init().catch((err) => showAlert('시작 오류', err.message));
