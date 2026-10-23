import type { HubConfig } from '../../shared/types';
import { h, type Screen } from '../screen';

// A word clock: the time is spelled out by lighting words in a letter grid, in five-minute
// steps ("IT IS TWENTY FIVE PAST SEVEN"). The four corner dots count the minutes in between.

const GRID = [
  'ITLISASAMPM',
  'ACQUARTERDC',
  'TWENTYFIVEX',
  'HALFSTENFTO',
  'PASTERUNINE',
  'ONESIXTHREE',
  'FOURFIVETWO',
  'EIGHTELEVEN',
  'SEVENTWELVE',
  'TENSEOCLOCK',
];

type Word = [row: number, col: number, len: number];
const W: Record<string, Word> = {
  IT: [0, 0, 2], IS: [0, 3, 2],
  A: [1, 0, 1], QUARTER: [1, 2, 7],
  TWENTY: [2, 0, 6], FIVE_M: [2, 6, 4],
  HALF: [3, 0, 4], TEN_M: [3, 5, 3], TO: [3, 9, 2],
  PAST: [4, 0, 4],
  OCLOCK: [9, 5, 6],
};
const HOURS: Word[] = [
  [8, 5, 6], // twelve
  [5, 0, 3], [6, 8, 3], [5, 6, 5], [6, 0, 4], [6, 4, 4], [5, 3, 3], // one … six
  [8, 0, 5], [7, 0, 5], [4, 7, 4], [9, 0, 3], [7, 5, 6], // seven … eleven
];

/** The words to light for a time, plus how many corner dots (0–4). */
export function wordsFor(hours: number, minutes: number): { words: Word[]; dots: number } {
  const step = Math.floor(minutes / 5) * 5;
  const words: Word[] = [W.IT, W.IS];
  const phrase: Record<number, string[]> = {
    0: ['OCLOCK'], 5: ['FIVE_M', 'PAST'], 10: ['TEN_M', 'PAST'], 15: ['A', 'QUARTER', 'PAST'],
    20: ['TWENTY', 'PAST'], 25: ['TWENTY', 'FIVE_M', 'PAST'], 30: ['HALF', 'PAST'],
    35: ['TWENTY', 'FIVE_M', 'TO'], 40: ['TWENTY', 'TO'], 45: ['A', 'QUARTER', 'TO'],
    50: ['TEN_M', 'TO'], 55: ['FIVE_M', 'TO'],
  };
  words.push(...phrase[step].map(k => W[k]));
  words.push(HOURS[(hours + (step >= 35 ? 1 : 0)) % 12]);
  return { words, dots: minutes % 5 };
}

let timer: number | undefined;

export const wordClockScreen: Screen = {
  id: 'wordclock',
  title: 'Word clock',
  durationSec: 45,
  mount(el: HTMLElement, config: HubConfig) {
    const face = h('div', 'wc-face');
    const cells: HTMLElement[][] = GRID.map(line => {
      const row = line.split('').map(ch => h('span', 'wc-letter', ch));
      face.append(...row);
      return row;
    });
    const dots = [0, 1, 2, 3].map(i => h('span', `wc-dot wc-dot-${i}`));
    const frame = h('div', 'wc-frame');
    frame.append(face, ...dots);
    el.append(frame);

    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
    const render = () => {
      const p = Object.fromEntries(parts.formatToParts(new Date()).map(x => [x.type, x.value]));
      const { words, dots: n } = wordsFor(Number(p.hour), Number(p.minute));
      const lit = new Set<HTMLElement>();
      for (const [r, c, len] of words) for (let i = 0; i < len; i++) lit.add(cells[r][c + i]);
      cells.flat().forEach(cell => cell.classList.toggle('on', lit.has(cell)));
      dots.forEach((d, i) => d.classList.toggle('on', i < n));
      frame.setAttribute('aria-label', `${p.hour}:${p.minute}`);
    };
    render();
    timer = window.setInterval(render, 5000);
  },
  unmount() {
    clearInterval(timer);
  },
};
