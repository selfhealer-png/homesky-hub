import type { ScreenId } from './settings';
import type { HubConfig } from './types';

interface RotationScreen { id: ScreenId; quiet?: boolean; isAvailable?(config: HubConfig): boolean }

/** The screens in rotation: switched on in /setup, with something to show, and in quiet hours only
 *  the calm ones (plus a screen someone pinned). If that leaves nothing, the clock, so the display
 *  is never empty. */
export function pickRotation<S extends RotationScreen>(all: S[], config: HubConfig, quiet: boolean, pinned?: S): S[] {
  const picked = all.filter(s => (s === pinned || !config.screensOff.includes(s.id))
    && (s.isAvailable?.(config) ?? true)
    && (!quiet || s.quiet || s === pinned));
  if (picked.length) return picked;
  const clock = all.find(s => s.id === 'clock');
  return clock ? [clock] : all.slice(0, 1);
}
