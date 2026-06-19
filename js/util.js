const STORAGE_KEYS = {
  hostName: 'dshare-host-name',
};

const CLIENT_IP_KEY = 'dshare-client-ip';

export function getClientIp() {
  const params = new URLSearchParams(window.location.search);
  return (params.get('clientIp') || localStorage.getItem(CLIENT_IP_KEY) || '').trim();
}

export function setClientIp(ip) {
  const v = String(ip || '').trim();
  if (v) localStorage.setItem(CLIENT_IP_KEY, v);
}

export function getServerUrl() {
  const clientIp = getClientIp();
  if (clientIp) return `http://${clientIp}:3847`;
  return '';
}

export function getWsUrl() {
  const ip = getClientIp();
  if (ip) return `ws://${ip}:3847`;
  return '';
}

export { STORAGE_KEYS };
