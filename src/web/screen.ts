import type { ScreenId } from '../shared/settings';
import type { Aircraft, HubConfig } from '../shared/types';

// Every screen implements this. To add one, create a module in screens/ and list it in main.ts.
// How long each screen stays up is DEFAULT_SCREEN_SEC (shared/settings), changed in /setup.
export interface Screen {
  id: ScreenId;
  title: string;
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
  /** Optional: the aircraft under a tap (a plane on the radar), which opens its plane card.
   *  `reach` is how far from a plane a tap still counts, in CSS pixels: more for a finger. */
  aircraftAt?(x: number, y: number, target: Element, reach: number): Aircraft | null;
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

/** Makes an open dialog modal for keyboards and screen readers: everything else on the page goes
 *  inert, so Tab and the reading cursor stay inside it. Returns the undo, which also puts focus
 *  back where it was before the dialog opened. */
export function holdFocus(dialog: HTMLElement): () => void {
  const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  dialog.setAttribute('aria-modal', 'true');
  const behind = [...document.body.children].filter((c): c is HTMLElement => c instanceof HTMLElement && !c.contains(dialog) && !c.inert);
  behind.forEach(c => { c.inert = true; });
  return () => {
    behind.forEach(c => { c.inert = false; });
    if (before?.isConnected) before.focus({ preventScroll: true });
  };
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
