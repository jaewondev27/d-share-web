import { ensureM3 } from './m3-setup.js';
import { getSettings, saveSettings, resetAllSettings } from './settings.js';

function openOverlay(contentHtml) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = contentHtml;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  return overlay;
}

function closeOverlay(overlay) {
  overlay.classList.remove('open');
  return new Promise((r) => setTimeout(() => { overlay.remove(); r(); }, 200));
}

export async function showNameModal({
  storageKey,
  title = '이름 설정',
  description = '다른 기기에서 표시될 이름을 입력하세요.',
  placeholder = '예: 재원',
  force = false,
}) {
  if (!force) {
    const saved = localStorage.getItem(storageKey);
    if (saved) return saved;
  }

  await ensureM3();

  return new Promise((resolve) => {
    const overlay = openOverlay(`
      <div class="modal-box" role="dialog" aria-modal="true">
        <h2 class="modal-title">${title}</h2>
        <p class="modal-desc">${description}</p>
        <md-outlined-text-field class="m3-field" id="name-field" label="이름" placeholder="${placeholder}"></md-outlined-text-field>
        <md-filled-button class="m3-btn-full" id="name-ok">확인</md-filled-button>
      </div>
    `);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) e.stopPropagation();
    });
    const blockEscape = (e) => {
      if (e.key === 'Escape') e.preventDefault();
    };
    document.addEventListener('keydown', blockEscape, true);

    const field = overlay.querySelector('#name-field');
    const saved = localStorage.getItem(storageKey);
    if (saved) field.value = saved;

    const submit = () => {
      const val = (field.value || '').trim();
      if (!val) return;
      localStorage.setItem(storageKey, val);
      document.removeEventListener('keydown', blockEscape, true);
      closeOverlay(overlay).then(() => resolve(val));
    };

    overlay.querySelector('#name-ok').addEventListener('click', submit);
    field.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    setTimeout(() => field.focus(), 80);
  });
}

export async function showAlert(title, description) {
  await ensureM3();
  return new Promise((resolve) => {
    const overlay = openOverlay(`
      <div class="modal-box" role="dialog">
        <h2 class="modal-title">${title}</h2>
        <p class="modal-desc">${description}</p>
        <md-filled-button class="m3-btn-full" id="alert-ok">확인</md-filled-button>
      </div>
    `);
    overlay.querySelector('#alert-ok').addEventListener('click', () => {
      closeOverlay(overlay).then(resolve);
    });
  });
}

export async function openSettings({ nameStorageKey, currentName, onNameChange, webHostOnly = false }) {
  await ensureM3();
  const s = getSettings();

  return new Promise((resolve) => {
    const remoteRow = webHostOnly ? '' : `
        <div class="setting-row">
          <span class="setting-label">원격 조작</span>
          <md-switch id="set-remote" ${s.remoteControl ? 'selected' : ''}></md-switch>
        </div>`;

    const overlay = openOverlay(`
      <div class="settings-panel" role="dialog">
        <h2 class="modal-title">설정</h2>

        <md-outlined-text-field class="m3-field" id="set-name" label="이름"></md-outlined-text-field>

        <div class="setting-row">
          <span class="setting-label">소리</span>
          <md-switch id="set-sound" ${s.sound ? 'selected' : ''}></md-switch>
        </div>
        ${remoteRow}

        <div class="settings-actions">
          <md-filled-button id="set-save">저장</md-filled-button>
          <md-outlined-button id="set-reset">설정 초기화</md-outlined-button>
          <md-text-button id="set-close">닫기</md-text-button>
        </div>
      </div>
    `);

    const nameField = overlay.querySelector('#set-name');
    nameField.value = currentName || '';
    const soundSwitch = overlay.querySelector('#set-sound');
    const remoteSwitch = overlay.querySelector('#set-remote');

    overlay.querySelector('#set-save').addEventListener('click', () => {
      const name = (nameField.value || '').trim();
      if (name) {
        localStorage.setItem(nameStorageKey, name);
        onNameChange?.(name);
      }
      saveSettings({
        sound: soundSwitch.selected,
        remoteControl: webHostOnly ? false : (remoteSwitch?.selected ?? false),
      });
      closeOverlay(overlay).then(() => resolve('saved'));
    });

    overlay.querySelector('#set-reset').addEventListener('click', async () => {
      resetAllSettings([nameStorageKey]);
      closeOverlay(overlay);
      location.reload();
    });

    overlay.querySelector('#set-close').addEventListener('click', () => {
      closeOverlay(overlay).then(() => resolve('closed'));
    });
  });
}
