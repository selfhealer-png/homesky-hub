import type { ScreenId } from '../shared/settings';
import type { Aircraft, HubConfig } from '../shared/types';

// Every screen implements this. To add one, create a module in screens/ and list it in main.ts.
export interface Screen {
  id: ScreenId;
  title: string;
  /** Seconds to stay on this screen before the rotator moves on. */
  durationSec: number;
  mount(el: HTMLElement, config: HubConfig): void;
  unmount(): void;
  /** Optional: a tap on the middle third of the screen (left and right thirds switch screens).
   *  Return a few words saying what changed ("LED board"); the display shows them briefly. */
  onCenterTap?(): string | void;
  /** Optional: leave this screen out of the rotation while it has nothing to show. */
  isAvailable?(config: HubConfig): boolean;
  /** Optional: stays in the rotation during quiet hours, when the display dims for the night. */
  quiet?: boolean;
  /** Optional: the screen shows the time itself, so the corner time stays off. */
  ownClock?: boolean;
  /** Optional: the aircraft under a tap (a plane on the radar), which opens its plane card. */
  aircraftAt?(x: number, y: number, target: Element): Aircraft | null;
  /** Optional: the aircraft the screen is about, for "About this plane" in the menu. */
  currentAircraft?(): Aircraft | null;
}

let flashEl: HTMLElement | undefined;
let flashTimer: number | undefined;

/** A few words at the bottom for a couple of seconds: what a tap changed, or that a screen is pinned. */
export function flash(text: string) {
  if (!flashEl) {
    flashEl = h('div');
    flashEl.id = 'flash';
    flashEl.setAttribute('role', 'status');
    document.body.append(flashEl);
  }
  flashEl.textContent = text;
  flashEl.classList.add('on');
  clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => flashEl?.classList.remove('on'), 2200);
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
