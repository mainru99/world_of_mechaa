/* Shared, code-native UI symbols. Decorative SVGs always inherit the button label. */
const paths = {
  home:'M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9',
  hangar:'M4 21V8l8-5 8 5v13M8 21v-9h8v9M3 21h18M9 7h6',
  gacha:'m12 2 8 5v10l-8 5-8-5V7l8-5Zm-8 5 8 5 8-5M12 12v10M8 5l8 5',
  battle:'m4 3 7 7-3 3-5-7 1-3Zm16 0-7 7 3 3 5-7-1-3ZM5 16l3 3m-5 2 6-6m10 1-3 3m5 2-6-6',
  hunt:'M4 4h16v13H4zM8 21h8M12 17v4m-4-9 3 3 5-6',
  terr:'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6l-9-4Zm0 5v10m-4-6h8',
  trial:'m13 2-2 7 5-2c5 6 4 14-4 15-8-1-9-8-5-12l1 4 5-12Z',
  rank:'M8 3h8v7a4 4 0 0 1-8 0V3Zm0 2H3v3a4 4 0 0 0 5 4m8-7h5v3a4 4 0 0 1-5 4M12 14v5m-5 2h10',
  more:'M4 6h16M4 12h16M4 18h16',
  arrow:'M4 12h16m-6-6 6 6-6 6',
  chevron:'m9 5 7 7-7 7',
  close:'m5 5 14 14M19 5 5 19',
  lock:'M6 10h12v11H6zM8 10V6a4 4 0 0 1 8 0v4M12 14v3',
  target:'M12 2v4m0 12v4M2 12h4m12 0h4M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0Zm-4 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  clock:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2',
  help:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9 8a3 3 0 0 1 6 0c0 2-3 2-3 5m0 3v1',
  user:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-3a8 8 0 0 1 16 0v3',
  refresh:'M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M18 18a8 8 0 0 1-13-3',
};
export function icon(name){return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]||paths.target}"/></svg>`;}
export const emblem = `<svg class="ui-emblem" viewBox="0 0 60 54" fill="currentColor" aria-hidden="true"><path d="M2 4h23l5 9L35 4h23L30 52 2 4Zm13 7 15 27 15-27h-6l-9 16-9-16h-6Z"/><path d="M0 1h20v4H0zm40 0h20v4H40z"/></svg>`;
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
