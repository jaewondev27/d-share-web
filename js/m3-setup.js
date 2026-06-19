import '@material/web/all.js';

const ready = Promise.all([
  customElements.whenDefined('md-outlined-text-field'),
  customElements.whenDefined('md-switch'),
  customElements.whenDefined('md-filled-button'),
  customElements.whenDefined('md-outlined-button'),
  customElements.whenDefined('md-text-button'),
]);

export function ensureM3() {
  return ready;
}
