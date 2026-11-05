import type { TradeEvent } from '../../shared/trading';

/**
 * StockSmart's office, drawn in pixel art on a canvas: one person per agent at a named desk, the risk gate, the bot's
 * laptop and SNB's door, with Riyadh outside the window. It plays the desk's real log: each event becomes a short scene
 * (a remark, a paper carried to the next desk, a stamp, a trip through SNB's door), one after another. When the market
 * is closed the lights go down and everyone sleeps at their desk. No images: every pixel is drawn here.
 */

export type AgentKey = 'tech' | 'news' | 'dec' | 'risk' | 'exec';
export const ACTOR_AGENT: Record<string, AgentKey> = { technical: 'tech', news: 'news', decision: 'dec', risk: 'risk', executor: 'exec' };

const W = 256;
const H = 176;

type Carry = 'paper' | 'news' | 'ticket' | 'stamped' | 'coin' | null;
type Pose = 'type' | 'idle' | 'stamp' | 'cheer' | 'sleep';
interface Person {
  key: AgentKey;
  color: string;
  shirt: string;
  skin: string;
  hair: string;
  look: 'hood' | 'glasses' | 'shemagh' | 'cap' | 'plain';
  standing?: boolean;
  home: { x: number; y: number };
  x: number;
  y: number;
  tx: number | null;
  ty: number | null;
  arrive: (() => void) | null;
  carry: Carry;
  bubble: { text: string; until: number; think: boolean } | null;
  pose: Pose;
  jump: number;
  hidden: boolean;
  phase: number;
}
interface Desk {
  x: number;
  y: number;
  w: number;
  who: AgentKey;
  screen: 'chart' | 'news' | 'dual' | 'bot';
}
interface Part {
  x: number;
  y: number;
  vx: number;
  vy: number;
  c: string;
  life: number;
  w: number;
  h: number;
}

interface OfficeState {
  night: boolean;
  halted: boolean;
  live: boolean;
  ticker: string;
}

export interface Office {
  setState(s: OfficeState): void;
  play(e: TradeEvent, name: (symbol: string) => string): void;
  /** The agent under a point given in CSS pixels from the canvas's corner, if any. */
  pick(x: number, y: number): AgentKey | null;
  resize(): void;
  destroy(): void;
}

function makePeople(): Record<AgentKey, Person> {
  const base = (p: Omit<Person, 'x' | 'y' | 'tx' | 'ty' | 'arrive' | 'carry' | 'bubble' | 'pose' | 'jump' | 'hidden' | 'phase'>): Person => ({
    ...p,
    x: p.home.x,
    y: p.home.y,
    tx: null,
    ty: null,
    arrive: null,
    carry: null,
    bubble: null,
    pose: p.standing ? 'idle' : 'type',
    jump: 0,
    hidden: false,
    phase: (p.home.x * 7 + p.home.y) % 6,
  });
  return {
    tech: base({ key: 'tech', color: '#1570ef', shirt: '#2e7fd8', skin: '#e3b088', hair: '#2a1d14', home: { x: 34, y: 70 }, look: 'hood' }),
    news: base({ key: 'news', color: '#6e4ff6', shirt: '#7357e0', skin: '#c98d5e', hair: '#151515', home: { x: 178, y: 70 }, look: 'glasses' }),
    dec: base({ key: 'dec', color: '#e04f16', shirt: '#f3f1ea', skin: '#d39b6e', hair: '#151515', home: { x: 101, y: 94 }, look: 'shemagh' }),
    risk: base({ key: 'risk', color: '#d92d20', shirt: '#24324f', skin: '#b97a4f', hair: '#151515', home: { x: 154, y: 130 }, look: 'cap', standing: true }),
    exec: base({ key: 'exec', color: '#079455', shirt: '#109a5a', skin: '#e8bb93', hair: '#3b2416', home: { x: 210, y: 118 }, look: 'plain' }),
  };
}

const DESKS: Desk[] = [
  { x: 20, y: 82, w: 26, who: 'tech', screen: 'chart' },
  { x: 164, y: 82, w: 26, who: 'news', screen: 'news' },
  { x: 88, y: 106, w: 36, who: 'dec', screen: 'dual' },
  { x: 198, y: 130, w: 26, who: 'exec', screen: 'bot' },
];

/** A remark short enough for a bubble. */
const short = (text: string, n = 30) => {
  const first = text.split(' · ')[0].split(' — ')[0];
  return first.length > n ? `${first.slice(0, n - 1)}…` : first;
};

export function createOffice(canvas: HTMLCanvasElement, opts: { reduced: () => boolean }): Office {
  const ctx = canvas.getContext('2d')!;
  let S = 3;
  const people = makePeople();
  const everyone = () => Object.values(people);
  let state: OfficeState = { night: false, halted: false, live: false, ticker: '' };
  let doorOpen = 0;
  let gateLight: 'idle' | 'ok' | 'veto' | 'alarm' = 'idle';
  let botBlink = 0;
  const parts: Part[] = [];
  const roomba = { x: 60, y: 150, dx: 0.35, dy: 0.18 };
  let raf = 0;
  let running = true;
  let last = 0;

  const R = (x: number, y: number, w: number, h: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x) * S, Math.round(y) * S, Math.round(w) * S, Math.round(h) * S);
  };
  const P = (x: number, y: number, c: string) => R(x, y, 1, 1, c);

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.parentElement?.clientWidth || 360;
    S = Math.max(1, Math.floor((cw * dpr) / W));
    canvas.width = W * S;
    canvas.height = H * S;
  }

  // ---------- drawing ----------
  function person(p: Person, t: number) {
    if (p.hidden) return;
    const walking = p.tx !== null;
    const sleep = p.pose === 'sleep';
    const j = p.jump > 0 ? -Math.round(Math.abs(Math.sin(p.jump * Math.PI)) * 4) : 0;
    const x = Math.round(p.x);
    const y = Math.round(p.y) + j + (sleep ? 3 : 0);
    const f = Math.floor(t / 180 + p.phase) % 2;
    if (walking || p.standing) R(x + 1, Math.round(p.y) + 16, 8, 1, state.night ? '#0b100d' : '#c3c9ce');
    if (!sleep) {
      const pants = '#2b2f3a';
      const lA = walking && f ? 2 : 3;
      const lB = walking && !f ? 2 : 3;
      R(x + 2, y + 13, 2, lA, pants);
      R(x + 6, y + 13, 2, lB, pants);
      R(x + 2, y + 13 + lA, 2, 1, '#111');
      R(x + 6, y + 13 + lB, 2, 1, '#111');
    }
    const shirt = p.shirt;
    R(x + 1, y + 7, 8, 6, shirt);
    if (p.look === 'shemagh') R(x + 4, y + 8, 2, 5, '#e6e2d6');
    if (p.look === 'cap') {
      R(x + 7, y + 8, 2, 2, '#e5484d');
      R(x + 2, y + 8, 1, 1, '#f2c94c');
    }
    const skin = p.skin;
    if (p.pose === 'type' && !walking) {
      R(x, y + 8, 1, 3, shirt);
      R(x + 9, y + 8, 1, 3, shirt);
      R(x + 2, y + 11 - f, 2, 1, skin);
      R(x + 6, y + 11 - (1 - f), 2, 1, skin);
    } else if (p.pose === 'stamp') {
      const up = Math.floor(t / 220) % 2;
      R(x, y + 8, 1, 4, shirt);
      R(x - 1, y + 12, 1, 1, skin);
      R(x + 9, y + (up ? 3 : 8), 1, 4, shirt);
      R(x + 9, y + (up ? 2 : 12), 2, 2, '#6b4423');
    } else if (p.pose === 'cheer') {
      R(x, y + 3, 1, 5, shirt);
      R(x + 9, y + 3, 1, 5, shirt);
      R(x, y + 2, 1, 1, skin);
      R(x + 9, y + 2, 1, 1, skin);
    } else if (!sleep) {
      R(x, y + 8, 1, 4, shirt);
      R(x + 9, y + 8, 1, 4, shirt);
      R(x, y + 12, 1, 1, skin);
      R(x + 9, y + 12, 1, 1, skin);
    }
    const hy = y + (sleep ? 2 : 0);
    R(x + 2, hy + 1, 6, 6, skin);
    if (p.look === 'shemagh') {
      for (let i = 0; i < 8; i++) for (let k = 0; k < 4; k++) P(x + 1 + i, hy - 1 + k, (i + k) % 2 ? '#c8102e' : '#f6f3ee');
      for (let k = 0; k < 6; k++) {
        P(x + 1, hy + 3 + k, k % 2 ? '#c8102e' : '#f6f3ee');
        P(x + 8, hy + 3 + k, k % 2 ? '#f6f3ee' : '#c8102e');
      }
      R(x + 2, hy, 6, 1, '#111');
      R(x + 3, hy + 6, 4, 1, '#2a1d14');
    } else if (p.look === 'cap') {
      R(x + 2, hy, 6, 2, '#1c2740');
      R(x + 1, hy + 1, 3, 1, '#1c2740');
      P(x + 5, hy, '#f2c94c');
    } else if (p.look === 'hood') {
      R(x + 2, hy, 6, 2, p.hair);
      R(x + 1, hy + 1, 1, 6, shirt);
      R(x + 8, hy + 1, 1, 6, shirt);
    } else {
      R(x + 2, hy, 6, 2, p.hair);
      P(x + 2, hy + 2, p.hair);
      P(x + 7, hy + 2, p.hair);
    }
    const blink = Math.floor(t / 100 + p.phase * 7) % 40 === 0;
    if (sleep || blink) {
      R(x + 3, hy + 4, 1, 1, '#5a3a28');
      R(x + 6, hy + 4, 1, 1, '#5a3a28');
    } else {
      P(x + 3, hy + 3, '#111');
      P(x + 6, hy + 3, '#111');
    }
    if (p.look === 'glasses' && !sleep) {
      R(x + 2, hy + 3, 3, 1, '#111');
      R(x + 5, hy + 3, 3, 1, '#111');
      P(x + 3, hy + 3, '#9fd3ff');
      P(x + 6, hy + 3, '#9fd3ff');
    }
    if (p.carry && !sleep) {
      const cy = y + 9;
      if (p.carry === 'paper') {
        R(x + 2, cy, 6, 4, '#fbfaf5');
        R(x + 3, cy + 1, 4, 1, '#2e90fa');
        R(x + 3, cy + 2, 3, 1, '#2e90fa');
      } else if (p.carry === 'news') {
        R(x + 1, cy, 8, 4, '#d9d5c8');
        R(x + 2, cy + 1, 6, 1, '#555');
        R(x + 2, cy + 2, 4, 1, '#888');
      } else if (p.carry === 'ticket') {
        R(x + 2, cy - 1, 6, 5, '#ffd84a');
        R(x + 3, cy, 4, 1, '#6b4423');
        R(x + 3, cy + 2, 3, 1, '#6b4423');
      } else if (p.carry === 'stamped') {
        R(x + 2, cy - 1, 6, 5, '#ffd84a');
        R(x + 3, cy, 3, 3, '#12b76a');
      } else if (p.carry === 'coin') {
        R(x + 3, cy, 4, 4, '#f2c94c');
        R(x + 4, cy + 1, 2, 2, '#d4a017');
      }
    }
  }

  function room(t: number) {
    const night = state.night;
    R(0, 0, W, 64, night ? '#1d2a24' : '#f3f4f6');
    R(0, 58, W, 2, '#1b8354');
    R(0, 60, W, 4, night ? '#16211c' : '#d2d6db');
    for (let row = 0; row < 7; row++) for (let col = 0; col < 16; col++) R(col * 16, 64 + row * 16, 16, 16, (row + col) % 2 ? (night ? '#1b241f' : '#eceff1') : night ? '#18201b' : '#e3e7ea');
    for (let k = 0; k < 7; k++) R(0, 64 + k * 16, W, 1, night ? '#141b17' : '#d9dee2');
    // the window onto Riyadh
    const wx = 66;
    const wy = 8;
    const ww = 124;
    const wh = 44;
    R(wx - 3, wy - 3, ww + 6, wh + 6, '#204c33');
    if (night) {
      R(wx, wy, ww, wh, '#0d1530');
      R(wx, wy + 26, ww, 18, '#16224a');
      for (let i = 0; i < 18; i++) P(wx + ((i * 37) % ww), wy + ((i * 11) % 22), (Math.floor(t / 600) + i) % 5 ? '#d8e4ff' : '#6b7aa6');
      const mx = wx + 104;
      const my = wy + 4;
      const moon = '#f4f1d0';
      R(mx + 2, my, 3, 1, moon);
      R(mx + 4, my + 1, 2, 1, moon);
      R(mx + 5, my + 2, 2, 4, moon);
      R(mx + 4, my + 6, 2, 1, moon);
      R(mx + 2, my + 7, 3, 1, moon);
      R(mx + 1, my + 1, 1, 1, moon);
      R(mx + 1, my + 6, 1, 1, moon);
    } else {
      R(wx, wy, ww, wh, '#8fd0ff');
      R(wx, wy + 22, ww, 22, '#b8e2ff');
      R(wx + 100, wy + 5, 8, 8, '#ffe07a');
      R(wx + 101, wy + 4, 6, 10, '#ffe07a');
      R(wx + 99, wy + 6, 10, 6, '#ffe07a');
    }
    const bld = night ? '#1f2b4f' : '#7d93b2';
    const bld2 = night ? '#26345e' : '#93a8c4';
    for (const [dx, h, w] of [[0, 18, 12], [12, 12, 10], [24, 22, 9], [40, 14, 12], [70, 16, 10], [84, 24, 12], [98, 15, 9], [110, 20, 14]]) {
      R(wx + dx, wy + wh - h, w, h, (dx / 2) % 2 ? bld : bld2);
      if (night) for (let k = 2; k < h - 1; k += 3) for (let q = 1; q < w - 1; q += 3) if ((dx + k + q) % 4) P(wx + dx + q, wy + wh - h + k, '#ffd36b');
    }
    // Kingdom Centre, with the opening near its top
    const kx = wx + 52;
    const base = wy + wh;
    for (let k = 0; k < 40; k++) {
      const half = 6 - Math.floor(k / 9);
      R(kx - half, base - k - 1, half * 2, 1, night ? '#2c3a6b' : '#6f86a8');
    }
    R(kx - 2, base - 38, 4, 8, night ? '#0d1530' : '#9fd6ff');
    R(kx - 2, base - 33, 4, 1, night ? '#5a6cae' : '#5b7196');
    if (night) {
      P(kx - 1, base - 40, '#ff5b5b');
      for (let k = 4; k < 28; k += 3) {
        P(kx - 2, base - k, '#ffd36b');
        P(kx + 1, base - k, '#ffd36b');
      }
    }
    // Al Faisaliah, with its golden ball
    const fx = wx + 30;
    for (let k = 0; k < 30; k++) {
      const half = Math.max(1, 6 - Math.floor(k / 5));
      R(fx - half, base - k - 1, half * 2, 1, night ? '#24315c' : '#7f95b4');
    }
    R(fx - 2, base - 25, 4, 4, '#f2c94c');
    R(fx, base - 32, 1, 7, night ? '#4a5a8e' : '#5b7196');
    R(wx - 3, wy + wh + 3, ww + 6, 6, '#0e1411');
    // clock, SNB's door, the chart poster, a plant, the water cooler
    R(18, 12, 20, 20, '#204c33');
    R(20, 14, 16, 16, night ? '#cfd3df' : '#fbfaf5');
    const dX = 226;
    R(dX - 2, 20, 22, 44, '#204c33');
    if (doorOpen > 0.5) R(dX, 22, 18, 42, '#0b0f0d');
    else {
      R(dX, 22, 18, 42, night ? '#1e5a3e' : '#1b8354');
      R(dX + 14, 42, 2, 3, '#f2c94c');
      R(dX + 2, 26, 14, 10, night ? '#174a33' : '#167048');
    }
    R(199, 13, 20, 26, '#204c33');
    R(200, 14, 18, 24, night ? '#24312a' : '#ffffff');
    R(202, 30, 2, 5, '#75e0a7');
    R(205, 27, 2, 8, '#3fbf7f');
    R(208, 24, 2, 11, '#1b8354');
    R(211, 20, 2, 15, '#1b8354');
    R(6, 138, 10, 10, '#9a5b34');
    R(4, 126, 14, 12, '#2f8f4e');
    R(7, 120, 8, 8, '#3aa65c');
    R(2, 130, 4, 6, '#2f8f4e');
    R(238, 120, 12, 26, night ? '#7f8b99' : '#d7e3ee');
    R(239, 112, 10, 10, night ? '#4f7fb0' : '#7cc4ff');
  }

  function screen(x: number, y: number, kind: 'chart' | 'news' | 'ticket', t: number) {
    R(x, y, 10, 8, '#1c1f26');
    R(x + 4, y + 8, 2, 2, '#1c1f26');
    if (state.night) {
      P(x + 8, y + 6, '#12b76a');
      return;
    }
    R(x + 1, y + 1, 8, 6, '#0e2a1c');
    if (kind === 'chart') {
      const o = Math.floor(t / 300);
      for (let i = 0; i < 8; i++) P(x + 1 + i, y + 5 - (((i + o) * 7) % 4), i > 5 ? '#ffd84a' : '#3ee08f');
    } else if (kind === 'news') {
      R(x + 1, y + 1, 8, 6, '#2a2342');
      R(x + 2, y + 2, 6, 1, '#d7ccff');
      R(x + 2, y + 4, 4, 1, '#8f80c8');
      R(x + 2, y + 5, 5, 1, '#8f80c8');
    } else {
      R(x + 1, y + 1, 8, 6, '#3a2a10');
      R(x + 2, y + 2, 5, 1, '#ffd84a');
      R(x + 2, y + 4, 3, 1, '#ffd84a');
    }
  }
  function laptop(x: number, y: number, t: number) {
    R(x, y, 10, 6, '#2a2e36');
    R(x + 1, y + 1, 8, 4, state.night ? '#111' : '#123b2a');
    if (!state.night) {
      R(x + 2, y + 2, 2, 2, botBlink > 0 && Math.floor(t / 120) % 2 ? '#ffd84a' : '#3ee08f');
      R(x + 5, y + 2, 3, 1, '#9fd6b8');
    } else P(x + 8, y + 4, '#12b76a');
    R(x - 1, y + 6, 12, 1, '#555b66');
  }
  function desk(d: Desk, t: number) {
    const night = state.night;
    R(d.x + 1, d.y + 15, d.w - 2, 2, night ? '#0e1411' : '#c9cfd4');
    R(d.x, d.y, d.w, 3, night ? '#c7cbd1' : '#ffffff');
    R(d.x, d.y + 2, d.w, 1, '#1b8354');
    R(d.x, d.y + 3, d.w, 9, '#204c33');
    R(d.x + 2, d.y + 12, 2, 4, '#161616');
    R(d.x + d.w - 4, d.y + 12, 2, 4, '#161616');
    const my = d.y - 9;
    if (d.screen === 'dual') {
      screen(d.x + 1, my, 'chart', t);
      screen(d.x + d.w - 11, my, 'ticket', t);
    } else if (d.screen === 'bot') laptop(d.x + 1, d.y - 5, t);
    else screen(d.x + 2, my, d.screen, t);
  }
  function gate(t: number) {
    R(127, 143, 23, 2, state.night ? '#0e1411' : '#c9cfd4');
    R(128, 128, 3, 16, '#4d5761');
    R(146, 128, 3, 16, '#4d5761');
    const red = gateLight === 'veto' || gateLight === 'alarm' || state.halted;
    R(131, 136, 15, 2, red ? '#d92d20' : '#9da4ae');
    const c = gateLight === 'ok' ? '#3ee08f' : red ? '#ff5b5b' : state.night ? '#555533' : '#f2c94c';
    R(128, 125, 3, 3, c);
    R(146, 125, 3, 3, c);
    if ((gateLight !== 'idle' || state.halted) && Math.floor(t / 150) % 2) {
      R(127, 124, 5, 5, `${c}55`);
      R(145, 124, 5, 5, `${c}55`);
    }
  }

  function text(str: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'center', mono = false) {
    ctx.font = `600 ${size * S}px ${mono ? "'IBM Plex Mono', ui-monospace, monospace" : "'IBM Plex Sans Arabic', Tahoma, sans-serif"}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.direction = mono ? 'ltr' : 'rtl';
    ctx.fillText(str, x * S, y * S);
  }
  function bubble(p: Person) {
    if (!p.bubble || p.hidden) return;
    const size = 7;
    ctx.font = `600 ${size * S}px 'IBM Plex Sans Arabic', Tahoma, sans-serif`;
    const w = Math.min(120, ctx.measureText(p.bubble.text).width / S + 10);
    const h = 12;
    const bx = Math.max(2, Math.min(W - w - 2, p.x + 5 - w / 2));
    const by = Math.max(1, p.y - h - 6 - (p.jump > 0 ? 4 : 0));
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = p.color;
    ctx.lineWidth = S;
    ctx.beginPath();
    ctx.roundRect(bx * S, by * S, w * S, h * S, 3 * S);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    if (p.bubble.think) {
      ctx.arc((p.x + 6) * S, (by + h + 2) * S, 1.4 * S, 0, 7);
      ctx.arc((p.x + 7) * S, (by + h + 4.5) * S, 0.9 * S, 0, 7);
    } else {
      ctx.moveTo((p.x + 3) * S, (by + h) * S);
      ctx.lineTo((p.x + 6) * S, (by + h + 4) * S);
      ctx.lineTo((p.x + 8) * S, (by + h) * S);
    }
    ctx.fill();
    text(p.bubble.text, bx + w / 2, by + h / 2 + 0.5, size, '#161616');
  }
  function ticker(t: number) {
    const x0 = 63;
    const y0 = 55;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0 * S, y0 * S, 130 * S, 6 * S);
    ctx.clip();
    const words = state.night ? 'MARKET CLOSED · OPENS 10:00' : state.halted ? 'TRADING STOPPED' : `${state.ticker}   ·   `;
    ctx.font = `600 ${4.6 * S}px 'IBM Plex Mono', monospace`;
    const tw = ctx.measureText(words).width / S;
    const still = state.night || state.halted || opts.reduced();
    const off = still ? 0 : (t / 40) % tw;
    const color = state.night ? '#5f7a6c' : state.halted ? '#ff8a80' : '#75e0a7';
    // A message that stands still shows once, centred; a moving ticker repeats end to end.
    if (still) text(words, x0 + 65, y0 + 3.2, 4.6, color, 'center', true);
    else for (let k = -1; k < 2; k++) text(words, x0 + 2 - off + k * tw, y0 + 3.2, 4.6, color, 'left', true);
    ctx.restore();
  }
  function clock() {
    const now = new Date(Date.now() + 3 * 3600e3);
    const h = now.getUTCHours() % 12;
    const m = now.getUTCMinutes();
    const cx = 28 * S;
    const cy = 22 * S;
    ctx.strokeStyle = '#222';
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.2 * S;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.sin(((h + m / 60) / 12) * 6.283) * 4 * S, cy - Math.cos(((h + m / 60) / 12) * 6.283) * 4 * S);
    ctx.stroke();
    ctx.lineWidth = 0.8 * S;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.sin((m / 60) * 6.283) * 6 * S, cy - Math.cos((m / 60) * 6.283) * 6 * S);
    ctx.stroke();
    text('الرياض', 28, 36, 3.6, state.night ? '#9aa1b5' : '#4d5761');
  }

  function draw(t: number) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    room(t);
    const items: { z: number; draw: () => void }[] = [];
    for (const d of DESKS) {
      const p = people[d.who];
      items.push({ z: d.y - 20, draw: () => { R(p.home.x - 1, d.y - 15, 12, 9, '#384250'); R(p.home.x, d.y - 14, 10, 7, '#4d5761'); } });
      items.push({ z: d.y + 12, draw: () => desk(d, t) });
    }
    items.push({ z: 144, draw: () => gate(t) });
    for (const p of everyone()) items.push({ z: p.y + 16, draw: () => person(p, t) });
    if (state.night) items.push({ z: roomba.y + 4, draw: () => { R(roomba.x, roomba.y, 8, 4, '#4a4f5a'); R(roomba.x + 1, roomba.y - 1, 6, 1, '#5d636f'); P(roomba.x + 6, roomba.y + 1, Math.floor(t / 300) % 2 ? '#3ee08f' : '#1b5e3c'); } });
    items.sort((a, b) => a.z - b.z).forEach((i) => i.draw());
    for (const q of parts) R(q.x, q.y, q.w, q.h, q.c);
    ticker(t);
    clock();
    if (state.night) {
      ctx.fillStyle = 'rgba(6, 14, 10, 0.45)';
      ctx.fillRect(0, 64 * S, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'lighter';
      for (const d of DESKS) {
        const g = ctx.createRadialGradient((d.x + 7) * S, (d.y - 4) * S, 0, (d.x + 7) * S, (d.y - 4) * S, 22 * S);
        g.addColorStop(0, 'rgba(255, 200, 90, 0.35)');
        g.addColorStop(1, 'rgba(255, 200, 90, 0)');
        ctx.fillStyle = g;
        ctx.fillRect((d.x - 20) * S, (d.y - 26) * S, 60 * S, 50 * S);
      }
      ctx.globalCompositeOperation = 'source-over';
      everyone().forEach((p, i) => {
        const k = (t / 1400 + i * 0.37) % 1;
        text(k < 0.5 ? 'z' : 'Z', p.x + 10 + k * 6, p.y - 2 - k * 12, 4 + k * 3, `rgba(170, 200, 255, ${1 - k})`, 'center', true);
      });
    }
    everyone().forEach(bubble);
  }

  function update(dt: number, t: number) {
    const fast = opts.reduced();
    for (const p of everyone()) {
      if (p.jump > 0) p.jump = Math.max(0, p.jump - dt / 450);
      if (p.bubble && t > p.bubble.until) p.bubble = null;
      if (p.tx !== null && p.ty !== null) {
        const dx = p.tx - p.x;
        const dy = p.ty - p.y;
        const d = Math.hypot(dx, dy);
        const v = fast ? Infinity : 0.055 * dt;
        if (d <= v) {
          p.x = p.tx;
          p.y = p.ty;
          p.tx = p.ty = null;
          const a = p.arrive;
          p.arrive = null;
          a?.();
        } else {
          p.x += (dx / d) * v;
          p.y += (dy / d) * v;
        }
      }
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const q = parts[i];
      q.x += (q.vx * dt) / 16;
      q.y += (q.vy * dt) / 16;
      q.vy += (0.04 * dt) / 16;
      q.life -= dt;
      if (q.life <= 0) parts.splice(i, 1);
    }
    if (doorOpen > 0) doorOpen = Math.max(0, doorOpen - dt / 1400);
    if (botBlink > 0) botBlink -= dt;
    if (state.night && !fast) {
      roomba.x += (roomba.dx * dt) / 16;
      roomba.y += (roomba.dy * dt) / 16;
      if (roomba.x < 24 || roomba.x > 186) roomba.dx *= -1;
      if (roomba.y < 146 || roomba.y > 168) roomba.dy *= -1;
    }
  }

  function frame(t: number) {
    const dt = Math.min(50, t - (last || t));
    last = t;
    update(dt, t);
    draw(t);
    raf = running ? requestAnimationFrame(frame) : 0;
  }

  // ---------- scenes, played one after another ----------
  let epoch = 0;
  const CANCEL = new Error('cancelled');
  type Scene = () => Promise<void>;
  const queue: Scene[] = [];
  let playing = false;

  const wait = (ms: number, my: number) => new Promise<void>((ok, no) => setTimeout(() => (my === epoch ? ok() : no(CANCEL)), opts.reduced() ? Math.min(ms, 900) : ms));
  const walk = (p: Person, x: number, y: number, my: number) =>
    new Promise<void>((ok, no) => {
      if (my !== epoch) return no(CANCEL);
      p.tx = x;
      p.ty = y;
      p.arrive = () => (my === epoch ? ok() : no(CANCEL));
    });
  const say = (p: Person, words: string, ms: number, my: number, think = false) => {
    p.bubble = { text: words, until: performance.now() + ms, think };
    return wait(ms, my);
  };
  const seat = (p: Person) => {
    p.pose = state.night ? 'sleep' : p.standing ? 'idle' : 'type';
  };
  const goHome = (p: Person, my: number) => walk(p, p.home.x, p.home.y, my).then(() => seat(p), () => undefined);

  function homeAll() {
    for (const p of everyone()) {
      p.x = p.home.x;
      p.y = p.home.y;
      p.tx = p.ty = null;
      p.arrive = null;
      p.carry = null;
      p.bubble = null;
      p.hidden = false;
      seat(p);
    }
    doorOpen = 0;
    gateLight = 'idle';
  }

  async function runQueue() {
    if (playing) return;
    playing = true;
    while (queue.length) {
      // A burst of events (several at once) is shortened: only the last few scenes of it play.
      if (queue.length > 6) queue.splice(0, queue.length - 6);
      const scene = queue.shift()!;
      try {
        await scene();
      } catch (e) {
        if (e !== CANCEL) console.error(e);
      }
    }
    playing = false;
  }
  function add(scene: (my: number) => Promise<void>) {
    if (state.night) return;
    queue.push(() => scene(epoch));
    void runQueue();
  }

  function confetti(x: number, y: number) {
    for (let i = 0; i < 26; i++) parts.push({ x, y, vx: (Math.random() - 0.5) * 2.4, vy: -Math.random() * 2.2 - 0.6, c: ['#f2c94c', '#3ee08f', '#ff9f2e', '#8fd0ff'][i % 4], life: 1300 + Math.random() * 500, w: 1, h: 1 });
  }
  function tear(x: number, y: number) {
    for (let i = 0; i < 14; i++) parts.push({ x: x + Math.random() * 6, y, vx: (Math.random() - 0.5) * 1.4, vy: -Math.random() * 1.2, c: i % 2 ? '#ffd84a' : '#fbfaf5', life: 1200, w: 2, h: 1 });
  }

  function play(e: TradeEvent, name: (symbol: string) => string) {
    const { tech, news, dec, risk, exec } = people;
    const data = (e.data ?? {}) as { symbol?: string; side?: string; qty?: number; verdict?: string; official?: boolean; reasons?: string[]; filledQty?: number };
    const stock = data.symbol ? name(data.symbol) : '';
    switch (e.type) {
      case 'agent.observation': {
        const who = ACTOR_AGENT[e.actor];
        if (!who) return;
        const p = people[who];
        if (who === 'news' && data.official) {
          add(async (my) => {
            news.pose = 'idle';
            await say(news, `إعلان رسمي: ${stock}`, 1300, my);
            news.carry = 'news';
            await walk(news, 116, 96, my);
            await wait(400, my);
            news.carry = null;
            void goHome(news, my);
          });
        } else add(async (my) => { await say(p, short(e.text), who === 'dec' ? 1500 : 1300, my, who === 'dec'); });
        return;
      }
      case 'agent.error': {
        const who = ACTOR_AGENT[e.actor];
        if (who) add(async (my) => { await say(people[who], 'تعذّر هالمرة', 1200, my); });
        return;
      }
      case 'decision.created':
        add(async (my) => {
          tech.carry = 'paper';
          await walk(tech, 84, 96, my);
          tech.carry = null;
          void goHome(tech, my);
          dec.pose = 'idle';
          await say(dec, '... أفكر', 900, my, true);
          await say(dec, `${data.side === 'sell' ? 'بيع' : 'شراء'} ${data.qty ?? ''} ${stock}`.trim(), 1200, my);
          dec.carry = 'ticket';
          await walk(dec, 118, 128, my);
          dec.carry = null;
          risk.carry = 'ticket';
          void goHome(dec, my);
        });
        return;
      case 'risk.verdict':
        add(async (my) => {
          if (!risk.carry) risk.carry = 'ticket';
          risk.pose = 'stamp';
          await wait(1100, my);
          risk.pose = 'idle';
          if (data.verdict === 'veto') {
            gateLight = 'veto';
            risk.carry = null;
            tear(150, 138);
            await say(risk, short(e.text.replace(/^رفضت[^:]*:\s*/, 'مرفوض: '), 26), 1800, my);
          } else {
            gateLight = 'ok';
            risk.carry = 'stamped';
            await say(risk, data.verdict === 'resize' ? `خفّضتها إلى ${data.qty ?? ''}` : 'ضمن الحدود ✓', 1200, my);
          }
          gateLight = 'idle';
        });
        return;
      case 'order.queued':
        add(async (my) => {
          exec.pose = 'idle';
          await walk(exec, 166, 132, my);
          risk.carry = null;
          exec.carry = 'stamped';
          await walk(exec, exec.home.x, exec.home.y, my);
          if (state.live) {
            botBlink = 1800;
            await say(exec, 'للبوت ✓', 1000, my);
          } else await say(exec, 'تجريبي: ننتظر السعر', 1300, my);
          exec.carry = null;
          seat(exec);
        });
        return;
      case 'order.sent':
        botBlink = 1800;
        return;
      case 'order.progress':
        add(async (my) => { botBlink = 1200; await say(exec, short(e.text.replace(/^بوت SNB:\s*/, ''), 24), 1100, my); });
        return;
      case 'order.filled':
        add(async (my) => {
          exec.pose = 'idle';
          exec.carry = 'stamped';
          await walk(exec, 230, 66, my);
          doorOpen = 1;
          exec.hidden = true;
          await wait(1200, my);
          exec.hidden = false;
          doorOpen = 1;
          exec.carry = 'coin';
          await say(exec, `تم التنفيذ ✓ ${stock}`.trim(), 900, my);
          confetti(234, 70);
          for (const p of everyone()) {
            p.jump = 1;
            if (p !== exec) p.pose = 'cheer';
          }
          await wait(900, my);
          for (const p of everyone()) if (p !== exec) seat(p);
          await walk(exec, exec.home.x, exec.home.y, my);
          exec.carry = null;
          seat(exec);
        });
        return;
      case 'order.expired':
      case 'order.cancelled':
      case 'order.rejected':
      case 'order.failed': {
        const words = { 'order.expired': 'انتهت مدته', 'order.cancelled': 'أُلغي', 'order.rejected': 'رفضته SNB', 'order.failed': 'ما وصل SNB' }[e.type];
        add(async (my) => { await say(exec, `${words}${stock ? ` · ${stock}` : ''}`, 1300, my); });
        return;
      }
      case 'order.unknown':
        add(async (my) => {
          gateLight = 'alarm';
          await say(exec, 'حالته في SNB غير معروفة!', 2200, my);
        });
        return;
      case 'system.caution':
        add(async (my) => {
          const on = (e.data as { on?: boolean } | undefined)?.on;
          gateLight = on ? 'alarm' : 'idle';
          await say(risk, on ? 'وضع الحذر!' : 'انتهى الحذر', 1800, my);
          if (on) gateLight = 'idle';
        });
        return;
      case 'system.resumed':
        add(async (my) => {
          for (const p of everyone()) p.jump = 1;
          await say(dec, 'نرجع للشغل', 1200, my);
        });
        return;
      case 'user.directive':
        add(async (my) => { await say(dec, 'سمعتك، بنلتزم', 1200, my); });
        return;
      default:
        return;
    }
  }

  function setState(s: OfficeState) {
    const wasNight = state.night;
    const wasHalted = state.halted;
    state = s;
    if (s.night !== wasNight || (s.halted && !wasHalted)) {
      // Night, or a stop: whatever was playing ends, and everyone goes back to their desk.
      epoch++;
      queue.length = 0;
      homeAll();
      if (!s.night && wasNight) for (const p of everyone()) { p.jump = 1; p.bubble = { text: 'صباح الخير!', until: performance.now() + 1300, think: false }; }
      if (s.halted && !wasHalted && !s.night) people.risk.bubble = { text: 'توقّف التداول', until: performance.now() + 2500, think: false };
    }
  }

  function pick(cx: number, cy: number): AgentKey | null {
    const rect = canvas.getBoundingClientRect();
    const x = (cx / rect.width) * W;
    const y = (cy / rect.height) * H;
    for (const p of everyone()) if (!p.hidden && x >= p.x - 3 && x <= p.x + 13 && y >= p.y - 3 && y <= p.y + 20) return p.key;
    for (const d of DESKS) if (x >= d.x && x <= d.x + d.w && y >= d.y - 12 && y <= d.y + 16) return d.who;
    if (x >= 124 && x <= 152 && y >= 120 && y <= 148) return 'risk';
    return null;
  }

  function start() {
    if (!running) {
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    }
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }
  // Drawn only while it can be seen: off screen, or with the app in the background, it rests.
  const seen = new IntersectionObserver(([entry]) => (entry.isIntersecting && !document.hidden ? start() : stop()));
  seen.observe(canvas);
  const onVisibility = () => (document.hidden ? stop() : start());
  document.addEventListener('visibilitychange', onVisibility);

  resize();
  homeAll();
  raf = requestAnimationFrame(frame);

  return {
    setState,
    play,
    pick,
    resize,
    destroy() {
      stop();
      epoch++;
      queue.length = 0;
      seen.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
