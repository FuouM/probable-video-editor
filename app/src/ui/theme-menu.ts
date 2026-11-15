// "Theme" drop-down of the menu bar (SoulWindow pro `.daw-menu`), shared by the studio and the player.
import { sw } from './soulwindow';

/** Builds the menu and puts it into `host` (a `.daw-menubar` or a group in it). */
export function mountThemeMenu(host: HTMLElement): void {
  const menu = document.createElement('div');
  menu.className = 'daw-menu';
  const btn = document.createElement('button');
  btn.className = 'daw-menu-btn';
  btn.textContent = 'Theme';
  btn.setAttribute('aria-haspopup', 'menu');
  btn.setAttribute('aria-expanded', 'false');
  const pop = document.createElement('div');
  pop.className = 'daw-menu-pop sw-hidden';
  pop.setAttribute('role', 'menu');
  menu.append(btn, pop);
  host.append(menu);

  const items = Object.entries(sw.themes).map(([id, def]) => {
    const item = document.createElement('button');
    item.className = 'daw-menu-item';
    item.setAttribute('role', 'menuitemradio');
    const check = document.createElement('span');
    check.className = 'daw-menu-check';
    const label = document.createElement('span');
    label.textContent = def.label;
    item.append(check, label, document.createElement('span'));
    item.addEventListener('click', () => {
      sw.setTheme(id);
      close();
    });
    pop.append(item);
    return { id, item, check };
  });

  const sync = () => {
    for (const { id, item, check } of items) {
      const on = sw.theme() === id;
      item.setAttribute('aria-checked', String(on));
      check.textContent = on ? '✓' : '';
    }
  };
  const open = () => {
    sync();
    pop.classList.remove('sw-hidden');
    btn.classList.add('daw-menu-btn--open');
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
  };
  const close = () => {
    pop.classList.add('sw-hidden');
    btn.classList.remove('daw-menu-btn--open');
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
  };
  const onOutside = (ev: PointerEvent) => {
    if (!menu.contains(ev.target as Node)) close();
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return;
    ev.stopPropagation();
    close();
    btn.focus();
  };
  btn.addEventListener('click', () => (pop.classList.contains('sw-hidden') ? open() : close()));
  sw.subscribe(sync);
}
