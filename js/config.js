/** LAN-only — no relay server. WebSocket connects directly to the client app. */
export function useRelaySignaling() {
  return false;
}

export function getRelayWsUrl() {
  return '';
}
