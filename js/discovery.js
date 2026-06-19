/** LAN client discovery via /api/info on port 3849 — no relay server. */
const WEB_PORT = 3849;

export function isPrivateIp(ip) {
  return /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
}

export async function probeClient(ip, timeoutMs = 1200) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`http://${ip}:${WEB_PORT}/api/info`, {
      signal: ctrl.signal,
      mode: 'cors',
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const info = await res.json();
    if (info.service !== 'd-share' || !info.code) return null;
    return {
      ip: info.lanIp || ip,
      code: String(info.code).toUpperCase(),
      name: info.name || '클라이언트',
      wsPort: info.wsPort || 3847,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function getLocalIpViaWebRtc() {
  return new Promise((resolve) => {
    const ips = new Set();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try { pc.close(); } catch { /* ignore */ }
      resolve([...ips].filter(isPrivateIp));
    };
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pc.createDataChannel('dshare');
    pc.onicecandidate = (e) => {
      if (!e.candidate) { finish(); return; }
      const m = e.candidate.candidate.match(/(\d+\.\d+\.\d+\.\d+)/);
      if (m) ips.add(m[1]);
    };
    pc.createOffer()
      .then((o) => pc.setLocalDescription(o))
      .catch(finish);
    setTimeout(finish, 3000);
  });
}

function subnetPrefix(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return null;
  return `${parts[0]}.${parts[1]}.${parts[2]}`;
}

function buildScanList(localIps) {
  const prefixes = new Set();
  for (const ip of localIps) {
    const p = subnetPrefix(ip);
    if (p) prefixes.add(p);
  }
  for (const p of ['192.168.0', '192.168.1', '192.168.43', '10.0.0']) prefixes.add(p);

  const saved = localStorage.getItem('dshare-client-ip');
  const ips = [];
  if (saved && isPrivateIp(saved)) ips.push(saved);
  for (const ip of localIps) if (!ips.includes(ip)) ips.push(ip);
  for (const prefix of prefixes) {
    for (let i = 1; i <= 254; i++) {
      const ip = `${prefix}.${i}`;
      if (!ips.includes(ip)) ips.push(ip);
    }
  }
  return ips;
}

/**
 * @param {{ onProgress?: (msg: string) => void }} [opts]
 * @returns {Promise<{ ip: string, code: string, name: string, wsPort: number } | null>}
 */
export async function discoverClient(opts = {}) {
  const { onProgress } = opts;
  const report = (msg) => onProgress?.(msg);

  const qIp = new URLSearchParams(location.search).get('ip');
  if (qIp && isPrivateIp(qIp)) {
    report('클라이언트 확인 중…');
    const hit = await probeClient(qIp);
    if (hit) return hit;
  }

  const saved = localStorage.getItem('dshare-client-ip');
  if (saved && isPrivateIp(saved)) {
    report('저장된 기기 확인 중…');
    const hit = await probeClient(saved);
    if (hit) return hit;
  }

  report('네트워크 확인 중…');
  const localIps = await getLocalIpViaWebRtc();
  const ips = buildScanList(localIps);
  const batch = 48;
  for (let i = 0; i < ips.length; i += batch) {
    report(`기기 검색 중… (${Math.min(i + batch, ips.length)}/${ips.length})`);
    const chunk = ips.slice(i, i + batch);
    const results = await Promise.all(chunk.map((ip) => probeClient(ip)));
    const hit = results.find(Boolean);
    if (hit) {
      localStorage.setItem('dshare-client-ip', hit.ip);
      return hit;
    }
  }
  return null;
}
