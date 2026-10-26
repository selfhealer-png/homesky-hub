import type { HubConfig } from '../shared/types';

// Every screen implements this. To add one, create a module in screens/ and list it in main.ts.
export interface Screen {
  id: string;
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
}

let flashEl: HTMLElement | undefined;
let flashTimer: number | undefined;

/** A few words just above the dots for a couple of seconds: which screen this is, what a tap changed. */
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
