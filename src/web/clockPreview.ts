import './previews.css';
import type { ClockStyle } from '../shared/settings';

// Small previews of each clock style, drawn with markup rather than images. Used by the
// first-run wizard on the display and by the Display card in /setup.

function el(tag: string, className?: string, ...children: Array<Node | string>): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  e.append(...children);
  return e;
}

export function clockPreview(style: ClockStyle): HTMLElement {
  const box = el('span', `cp cp-${style}`);
  box.setAttribute('aria-hidden', 'true');
  if (style === 'word') {
    box.append(
      el('span', undefined, el('i', undefined, 'IT'), ' L ', el('i', undefined, 'IS'), ' AS'),
      el('span', undefined, el('i', undefined, 'HALF'), ' S TEN'),
      el('span', undefined, el('i', undefined, 'PAST'), ' ER'),
      el('span', undefined, 'ON ', el('i', undefined, 'NINE')),
    );
  } else if (style === 'digital') {
    box.append('9:30');
  } else if (style === 'analogue') {
    box.innerHTML = '<svg viewBox="-50 -50 100 100" width="58" height="58"><circle r="46" fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width="2"/><line y1="6" y2="-24" stroke="currentColor" stroke-width="5" stroke-linecap="round" transform="rotate(285)"/><line y1="8" y2="-38" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" transform="rotate(180)"/><circle r="3.5" fill="#F59E0B"/></svg>';
  } else {
    for (const ch of ['0', '9', ':', '3', '0']) box.append(el('span', ch === ':' ? 'cp-colon' : 'cp-tile', ch));
  }
  return box;
}

export const CLOCK_LABELS: Record<ClockStyle, [string, string]> = {
  word: ['Word clock', 'The time spelled out in a letter grid.'],
  digital: ['Digital', 'Large, plain numbers. Easiest from across a room.'],
  analogue: ['Analogue', 'A quiet clock face.'],
  flip: ['Split-flap', 'Flip tiles, matching the overhead board.'],
};
