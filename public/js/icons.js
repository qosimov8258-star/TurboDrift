// Icon set (SF-Symbols style outline icons, 24x24). The sprite is injected into <body> once;
// markup uses  <svg class="ic"><use href="#i-name"/></svg>  or  icon('name').
const P = {
  play: '<path d="M8 5.2v13.6a.6.6 0 0 0 .9.5l11-6.8a.6.6 0 0 0 0-1L8.9 4.7a.6.6 0 0 0-.9.5z" fill="currentColor" stroke="none"/>',
  flag: '<path d="M5.5 21V3.8"/><path d="M5.5 4.6c3-1.6 5.4 1.2 8.5 0 1.6-.7 3-.6 4.5 0v8c-1.5-.6-2.9-.7-4.5 0-3.1 1.2-5.5-1.6-8.5 0"/>',
  users: '<circle cx="9" cy="8.2" r="3.3"/><path d="M2.8 19.6c.2-3.4 2.9-5.8 6.2-5.8s6 2.4 6.2 5.8"/><circle cx="17.2" cy="9" r="2.6"/><path d="M17 14.1c2.6.2 4.2 2.2 4.4 5"/>',
  road: '<path d="M8.2 3 4 21M15.8 3 20 21"/><path d="M12 4.5v3M12 10.5v3M12 16.5v3"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.8"/><path d="M6.6 10h.01M10.2 10h.01M13.8 10h.01M17.4 10h.01M7.6 14h8.8"/>',
  display: '<rect x="3" y="4" width="18" height="12.5" rx="2.6"/><path d="M8.5 20.5h7M12 16.5v4"/>',
  'chev-l': '<path d="m14.8 5.5-6.5 6.5 6.5 6.5"/>',
  'chev-r': '<path d="m9.2 5.5 6.5 6.5-6.5 6.5"/>',
  'chev-u': '<path d="m5.5 14.8 6.5-6.5 6.5 6.5"/>',
  'chev-d': '<path d="m5.5 9.2 6.5 6.5 6.5-6.5"/>',
  check: '<path d="m5 12.8 4.6 4.6L19.2 7.6"/>',
  x: '<path d="M6.2 6.2l11.6 11.6M17.8 6.2 6.2 17.8"/>',
  refresh: '<path d="M20.2 12.4A8.2 8.2 0 1 1 17.6 6.3"/><path d="M20.4 3.8v4.9h-4.9"/>',
  pause: '<rect x="6.3" y="5" width="3.9" height="14" rx="1.4" fill="currentColor" stroke="none"/><rect x="13.8" y="5" width="3.9" height="14" rx="1.4" fill="currentColor" stroke="none"/>',
  vol: '<path d="M3.8 9.6h3.6L12 5.6v12.8l-4.6-4H3.8z"/><path d="M15.6 9.2a4.1 4.1 0 0 1 0 5.6M18.2 6.6a7.8 7.8 0 0 1 0 10.8"/>',
  mute: '<path d="M3.8 9.6h3.6L12 5.6v12.8l-4.6-4H3.8z"/><path d="m16 9.6 4.8 4.8M20.8 9.6 16 14.4"/>',
  cam: '<rect x="2.8" y="6.8" width="13.2" height="10.4" rx="2.8"/><path d="m16 10.9 5.2-3v8.2l-5.2-3"/>',
  respawn: '<path d="M8.8 14.2 4 9.4 8.8 4.6"/><path d="M4 9.4h9.6a6.2 6.2 0 0 1 0 12.4H10"/>',
  link: '<path d="M10.2 13.8a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M13.8 10.2a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  crown: '<path d="M4.2 18.2h15.6"/><path d="M4.6 8.4 8.6 12 12 5.8l3.4 6.2 4-3.6-1.6 9.8H6.2z"/>',
  lock: '<rect x="5" y="10.8" width="14" height="9.6" rx="2.6"/><path d="M8.2 10.8V8a3.8 3.8 0 0 1 7.6 0v2.8"/>',
  bolt: '<path d="M13.2 2.8 5.2 13.4h5.7l-1 7.8 8-10.6h-5.7z"/>',
  expand: '<path d="M4 9V4.5h4.5M20 9V4.5h-4.5M4 15v4.5h4.5M20 15v4.5h-4.5"/>',
  shrink: '<path d="M8.6 4v4.6H4M15.4 4v4.6H20M8.6 20v-4.6H4M15.4 20v-4.6H20"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  power: '<path d="M12 3.2v8"/><path d="M6.6 6.9a8 8 0 1 0 10.8 0"/>',
  back: '<path d="M19.5 12H5M11 5.8 4.8 12 11 18.2"/>',
  clock: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.2V12l3.2 2"/>',
  warn: '<path d="M10.3 4.6 2.8 18a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.6a2 2 0 0 0-3.4 0z"/><path d="M12 10v4.4M12 17.4h.01"/>',
  trophy: '<path d="M8 4h8v5.2a4 4 0 0 1-8 0z"/><path d="M8 6H4.6v1.4A3.6 3.6 0 0 0 8 11M16 6h3.4v1.4A3.6 3.6 0 0 1 16 11M12 13.2V17M8.6 20.4h6.8M10 17h4"/>',
  palette: '<path d="M12 3.2a8.8 8.8 0 1 0 0 17.6c1.5 0 2.1-1.1 1.6-2.3-.5-1.3.4-2.5 1.8-2.5H17a3.8 3.8 0 0 0 3.8-3.8c0-4.9-3.9-9-8.8-9z"/><path d="M7.6 11.6h.01M10.4 7.8h.01M15 8.2h.01"/>',
  cube: '<path d="m12 3 8.2 4.6v8.8L12 21l-8.2-4.6V7.6z"/><path d="m3.8 7.6 8.2 4.6 8.2-4.6M12 12.2V21"/>',
  hand: '<circle cx="12" cy="12" r="8.6"/><path d="M10 16.4V7.8h3.1a2.5 2.5 0 0 1 0 5H10"/>',
  gauge: '<path d="M4 17.2a8.6 8.6 0 1 1 16 0"/><path d="m12 13.2 4.2-5"/><circle cx="12" cy="13.4" r="1" fill="currentColor"/>',
  rotate: '<path d="M20 12.2a8 8 0 0 1-13.9 5.4M4 11.8A8 8 0 0 1 17.9 6.4"/><path d="M18 2.8v4h-4M6 21.2v-4h4"/>',
  help: '<circle cx="12" cy="12" r="8.6"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1.1.9-1.1 1.6"/><path d="M12 16.9h.01"/>',
  info: '<circle cx="12" cy="12" r="8.6"/><path d="M12 11v5.4M12 7.7h.01"/>',
  star: '<path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>',
  pin: '<path d="M12 21s7-6.2 7-11.4A7 7 0 0 0 5 9.6C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.6" r="2.5"/>',
  car: '<path d="M4.2 15.4v-3.1l1.7-4.4A2 2 0 0 1 7.800 6.600h8.400a2 2 0 0 1 1.900 1.300l1.700 4.400v3.100"/><path d="M3 15.400h18v2.400a.8.8 0 0 1-.8.8H18a1.500 1.500 0 0 1-3 0H9a1.500 1.500 0 0 1-3 0H3.800a.8.8 0 0 1-.8-.8z"/><path d="M5.600 12.200h12.800"/>',
  hourglass: '<path d="M7 3.6h10M7 20.4h10"/><path d="M8 3.6c0 4.600 8 5.400 8 8.400s-8 3.800-8 8.400M16 3.600c0 4.600-8 5.400-8 8.400s8 3.800 8 8.400"/>',
  smoke: '<path d="M8 19a3.500 3.500 0 0 1-.4-7A5 5 0 0 1 17 10.500a3.200 3.200 0 0 1 .6 6.400"/><path d="M8 19h9"/>',
  fire: '<path d="M12 21a6.500 6.500 0 0 0 6.500-6.500c0-3.600-2.800-5.200-3.700-8.400-2.600 1.600-3.800 3.800-3.800 5.600-1.400-.4-2-1.800-2.100-3.200C7.300 10 5.500 12.300 5.500 14.500A6.500 6.500 0 0 0 12 21z"/>',
  heart: '<path d="M12 20.2S3.8 15 3.8 9.2A4.4 4.4 0 0 1 12 7.1a4.4 4.4 0 0 1 8.200 2.100C20.200 15 12 20.200 12 20.200z"/>',
  swords: '<path d="M5 4.500 14.500 14M4.500 5l4 .5M19 4.500 9.500 14M19.500 5l-4 .5M14.500 14l3 3M9.500 14l-3 3M16.500 19l2.500 2M7.500 19 5 21"/>',
  steer: '<circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="2.2"/><path d="M3.600 11.400c3 .6 5.200 1 6.200 1M20.400 11.400c-3 .6-5.200 1-6.200 1M12 14.200V20.600"/>',
};

export const ICON_NAMES = Object.keys(P);

const SPRITE = '<svg id="iconSprite" xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true"><defs>' +
  ICON_NAMES.map(n => `<symbol id="i-${n}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round">${P[n]}</symbol>`).join('') +
  '</defs></svg>';

if (typeof document !== 'undefined' && !document.getElementById('iconSprite')) {
  const add = () => document.body.insertAdjacentHTML('afterbegin', SPRITE);
  if (document.body) add(); else document.addEventListener('DOMContentLoaded', add);
}

/** <svg> markup for an icon */
export function icon(name, cls = '') {
  return `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

/** "{flag} MARRA" -> svg + text (everything else is HTML-escaped) */
export function iconize(text) {
  const esc = String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return esc.replace(/\{([a-z-]+)\}/g, (m, n) => (P[n] ? icon(n) : m));
}
