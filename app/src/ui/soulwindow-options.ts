// SoulWindow options, shared by the runtime controller (soulwindow.ts) and the Vite plugin's pre-paint boot script
// (vite.config.ts, vite.site.config.ts). The studio and the player share the saved theme and accent.
import type { SoulWindowOptions } from 'soulwindow/runtime';

export const SW_OPTIONS: SoulWindowOptions = { storagePrefix: 'pve-', defaultTheme: 'dark', density: 'compact' };
