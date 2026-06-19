export const SETTINGS_KEYS = {
  sound: 'dshare-setting-sound',
  remoteControl: 'dshare-setting-remote-control',
};

let audioCtx = null;
let audioPrimed = false;

export function getSettings() {
  return {
    sound: localStorage.getItem(SETTINGS_KEYS.sound) !== 'false',
    remoteControl: localStorage.getItem(SETTINGS_KEYS.remoteControl) !== 'false',
  };
}

export function saveSettings({ sound, remoteControl }) {
  localStorage.setItem(SETTINGS_KEYS.sound, sound ? 'true' : 'false');
  localStorage.setItem(SETTINGS_KEYS.remoteControl, remoteControl ? 'true' : 'false');
}

export function resetAllSettings(nameKeys = []) {
  localStorage.removeItem(SETTINGS_KEYS.sound);
  localStorage.removeItem(SETTINGS_KEYS.remoteControl);
  for (const key of nameKeys) localStorage.removeItem(key);
}

export function primeAudio() {
  if (audioPrimed) return;
  audioPrimed = true;
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { /* ignore */ }
}

export async function playConnectSound() {
  if (!getSettings().sound) return;
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = 880;
    gain.gain.value = 0.08;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
    osc.stop(audioCtx.currentTime + 0.15);
  } catch { /* ignore */ }
}
