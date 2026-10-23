// Split-flap display rows. Each character is one tile. To change, a tile steps forward through
// CHARSET the way a mechanical flap does: the top leaf falls away and the next character's
// bottom half drops into place. Long journeys are shortened so a row settles in about half a second.

export const CHARSET = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:-/'&°→↗↘";
const MAX_STEPS = 6;
const STEP_MS = 75;
const STAGGER_MS = 22;

/** 'flip' is the 3D animation, 'scramble' cycles characters without it, 'fade' swaps at once. */
export type FlapMotion = 'flip' | 'scramble' | 'fade';
let motion: FlapMotion = 'flip';
export function setFlapMotion(m: FlapMotion) {
  motion = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'fade' : m;
}

export function toFlapText(text: string): string {
  return text
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // Zürich → Zurich
    .toUpperCase()
    .split('')
    .map(c => (CHARSET.includes(c) ? c : ' '))
    .join('');
}

class Tile {
  readonly el = document.createElement('span');
  private readonly top: HTMLElement;
  private readonly bottom: HTMLElement;
  private readonly leafTop: HTMLElement;
  private readonly leafBottom: HTMLElement;
  private current = ' ';
  private target = ' ';
  private running = false;

  constructor() {
    this.el.className = 'flap';
    const half = (cls: string) => {
      const outer = document.createElement('span');
      outer.className = cls;
      outer.append(document.createElement('span'));
      this.el.append(outer);
      return outer.firstElementChild as HTMLElement;
    };
    this.top = half('half top');
    this.bottom = half('half bottom');
    this.leafTop = half('leaf top');
    this.leafBottom = half('leaf bottom');
    this.paint(' ');
  }

  private paint(c: string) {
    this.top.textContent = this.bottom.textContent = this.leafTop.textContent = this.leafBottom.textContent = c;
  }

  set(c: string, delayMs: number) {
    this.target = c;
    if (motion === 'fade') {
      this.current = c;
      this.paint(c);
      return;
    }
    if (!this.running && c !== this.current) {
      this.running = true;
      window.setTimeout(() => this.run(), delayMs);
    }
  }

  private path(): string[] {
    const from = CHARSET.indexOf(this.current);
    const to = CHARSET.indexOf(this.target);
    const steps: string[] = [];
    for (let i = (from + 1) % CHARSET.length; ; i = (i + 1) % CHARSET.length) {
      steps.push(CHARSET[i]);
      if (i === to) break;
    }
    return steps.slice(-MAX_STEPS);
  }

  private async run() {
    // Re-plan every step, so a target that changes mid-animation is still reached.
    while (this.current !== this.target) await this.step(this.path()[0]);
    this.running = false;
  }

  private step(next: string): Promise<void> {
    const prev = this.current;
    this.current = next;
    if (motion === 'scramble') {
      this.paint(next);
      return new Promise(r => setTimeout(r, STEP_MS * 0.6));
    }
    // Top shows the new character behind the falling leaf; bottom keeps the old one until covered.
    this.top.textContent = next;
    this.bottom.textContent = prev;
    this.leafTop.textContent = prev;
    this.leafBottom.textContent = next;
    this.el.classList.remove('flipping');
    void this.el.offsetWidth; // restart the CSS animation
    this.el.classList.add('flipping');
    return new Promise(r => setTimeout(() => {
      this.bottom.textContent = next;
      this.el.classList.remove('flipping');
      r();
    }, STEP_MS));
  }
}

export class FlapRow {
  readonly el = document.createElement('div');
  private readonly tiles: Tile[] = [];

  constructor(readonly length: number, size: 'xl' | 'lg' | 'md' | 'sm') {
    this.el.className = `flaprow ${size}`;
    this.el.style.setProperty('--half-ms', `${STEP_MS / 2}ms`);
    for (let i = 0; i < length; i++) {
      const t = new Tile();
      this.tiles.push(t);
      this.el.append(t.el);
    }
  }

  set(text: string, align: 'left' | 'center' | 'right' = 'left') {
    let s = toFlapText(text).slice(0, this.length);
    const pad = this.length - s.length;
    if (align === 'center') s = ' '.repeat(Math.floor(pad / 2)) + s;
    else if (align === 'right') s = ' '.repeat(pad) + s;
    s = s.padEnd(this.length, ' ');
    this.tiles.forEach((t, i) => t.set(s[i], i * STAGGER_MS));
  }
}
