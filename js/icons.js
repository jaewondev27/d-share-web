import { createIcons, Unplug, Settings } from 'https://esm.sh/lucide';

const ICONS = { Unplug, Settings };

export function initIcons(root = document) {
  createIcons({ icons: ICONS, attrs: { 'stroke-width': 2 }, nameAttr: 'data-lucide', root });
}
