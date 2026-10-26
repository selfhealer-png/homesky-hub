import { SCREEN_IDS, type ScreenId } from './settings';
import type { HubConfig } from './types';

interface RotationScreen { id: ScreenId; quiet?: boolean; isAvailable?(config: HubConfig): boolean }

/** The screens in rotation: switched on in /setup, with something to show, and in quiet hours only
 *  the calm ones (plus a screen someone pinned). If that leaves nothing, the clock, so the display
 *  is never empty. */
export function pickRotation<S extends RotationScreen>(all: S[], config: HubConfig, quiet: boolean, pinned?: S): S[] {
  const rank = (s: S) => { const i = config.order.indexOf(s.id); return i < 0 ? Infinity : i; };
  const picked = [...all].sort((a, b) => rank(a) - rank(b)).filter(s => (s === pinned || !config.screensOff.includes(s.id))
    && (s.isAvailable?.(config) ?? true)
    && (!quiet || s.quiet || s === pinned));
  if (picked.length) return picked;
  const clock = all.find(s => s.id === 'clock');
  return clock ? [clock] : all.slice(0, 1);
}

/** Every screen once, in the saved order. Unknown ids are dropped, and a screen the saved order
 *  doesn't mention goes in after the screen it follows by default (or first, if it leads). */
export function screenOrder(saved: readonly unknown[] = []): ScreenId[] {
  const order = [...new Set(saved.filter((id): id is ScreenId => SCREEN_IDS.includes(id as ScreenId)))];
  SCREEN_IDS.forEach((id, i) => {
    if (order.includes(id)) return;
    order.splice(i === 0 ? 0 : order.indexOf(SCREEN_IDS[i - 1]) + 1, 0, id);
  });
  return order;
}
