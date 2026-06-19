export function normalizeCode(value) {
  return String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6);
}

export function isValidCode(code) {
  return /^[A-Z0-9]{6}$/.test(normalizeCode(code));
}
