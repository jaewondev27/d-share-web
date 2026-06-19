/**
 * 공개 WSS 시그널링 릴레이 URL
 * GitHub Pages(HTTPS) 웹 호스트가 클라이언트와 연결할 때 사용합니다.
 *
 * 배포: 저장소 루트 render.yaml → Render 무료 Web Service
 * URL을 배포 후 아래 값에 넣으세요.
 */
export const RELAY_WSS_URL = (() => {
  const meta = document.querySelector('meta[name="dshare-relay"]');
  if (meta?.content?.trim()) return meta.content.trim();
  const params = new URLSearchParams(window.location.search);
  const q = params.get('relay');
  if (q?.trim()) return q.trim();
  return 'wss://d-share-signaling.onrender.com';
})();

export function getRelayWsUrl() {
  const url = RELAY_WSS_URL;
  if (!url) return '';
  if (url.startsWith('ws://') || url.startsWith('wss://')) return url.replace(/\/$/, '');
  if (url.startsWith('https://')) return url.replace(/^https:/, 'wss:').replace(/\/$/, '');
  if (url.startsWith('http://')) return url.replace(/^http:/, 'ws:').replace(/\/$/, '');
  return `wss://${url.replace(/\/$/, '')}`;
}

export function useRelaySignaling() {
  return window.location.protocol === 'https:' || !!window.location.hostname?.includes('github.io');
}
