import type { HubConfig } from '../shared/types';

// Every screen implements this. To add one, create a module in screens/ and list it in main.ts.
export interface Screen {
  id: string;
  title: string;
  /** Seconds to stay on this screen before the rotator moves on. */
  durationSec: number;
  mount(el: HTMLElement, config: HubConfig): void;
  unmount(): void;
  /** Optional: a tap on the middle third of the screen (left and right thirds switch screens). */
  onCenterTap?(): void;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
