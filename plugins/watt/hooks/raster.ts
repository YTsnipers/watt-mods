// Pixel-cell drawing for the summary pill, adapted from the plan-progress mod
// (https://github.com/zycck/claude-mods, MIT, Copyright (c) 2026 Kirill Serditov): the Grid of Raster cells, the
// pill, the Braille twinkle and the label pill that rides the fill's head.
//
// A Raster cell takes one printable BMP character exactly one column wide; anything else refuses the whole tree.
// plan-progress measures every character against a width table; here the allowed set is small and fixed: ASCII, a
// few symbols, and a middle dot for the rest (CJK, emoji).

export const DEFAULT = 0x01000000

type Cell = [number, number, number]

const ALLOWED = new Set(['✓', '●', '•', '│', '·'])

// The one-column character a Raster cell can hold in place of `ch`.
export const cellChar = (ch: string): string => {
  const cp = ch.codePointAt(0) ?? 63

  return (cp >= 0x20 && cp <= 0x7e) || ALLOWED.has(ch) ? ch : '·'
}

export const cellText = (s: string): string => [...s].map(cellChar).join('')

export const pack = (c: number[]): number => ((c[0] ?? 0) << 16) | ((c[1] ?? 0) << 8) | (c[2] ?? 0)

export const mix = (a: number[], b: number[], m: number): number[] => a.map((v, i) => Math.round(v + ((b[i] ?? 0) - v) * m))

export const hash = (a: number, b: number, k: number): number => {
  const x = Math.sin(a * 127.1 + b * 311.7 + k * 74.7) * 43758.5453

  return x - Math.floor(x)
}

const LEVELS = 8

export const q = (m: number): number => Math.round(Math.max(0, Math.min(1, m)) * LEVELS) / LEVELS

export const wave = (t: number, periodMs: number, offset = 0): number =>
  0.5 + 0.5 * Math.sin((t / periodMs + offset) * Math.PI * 2)

export const BRAILLE_BITS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
]

export class Grid {
  cells: Cell[]

  constructor(
    readonly columns: number,
    readonly rows: number,
  ) {
    this.cells = Array.from({ length: columns * rows }, () => [32, DEFAULT, DEFAULT] as Cell)
  }

  set(x: number, y: number, ch: string | number, fg: number, bg: number): void {
    if (x < 0 || x >= this.columns || y < 0 || y >= this.rows) {
      return
    }

    this.cells[y * this.columns + x] = [typeof ch === 'number' ? ch : (ch.codePointAt(0) ?? 32), fg, bg]
  }

  bg(x: number, y: number): number {
    return this.cells[y * this.columns + x]?.[2] ?? DEFAULT
  }

  text(x: number, y: number, s: string, fg: number, bg?: number): number {
    let i = 0

    for (const ch of cellText(s)) {
      this.set(x + i, y, ch, fg, bg ?? this.bg(x + i, y))
      i += 1
    }

    return i
  }

  encode(): string {
    const words = new Uint32Array(this.cells.length * 3)

    this.cells.forEach((c, i) => words.set(c, i * 3))

    return (new Uint8Array(words.buffer) as Uint8Array & { toBase64: () => string }).toBase64()
  }
}

export function pill(g: Grid, y: number, from: number, to: number, bgAt: (x: number) => number[]): void {
  for (let x = from; x < to; x += 1) {
    g.set(x, y, ' ', DEFAULT, pack(bgAt(x)))
  }
}

// What the terminal's own background is taken to be: a dark one. plan-progress reads the real one; this does not.
const BACK = [24, 24, 32]
const GREY = [120, 118, 128]
const RUNNING = [122, 104, 212]
const FINISHED = [52, 168, 98]

export type TrackArgs = {
  // Cells across, including the label pill's room.
  width: number
  // How far the fill has got, in cells (fractional): the label pill rides its head.
  head: number
  label: string
  isDone: boolean
  now: number
  isTwinkling: boolean
}

// One row of cells: a track, a fill up to `head` with Braille dots that twinkle, and the label on a pill at the
// head, as plan-progress draws a bar.
export function trackCells({ width: W, head: fx, label, isDone, now, isTwinkling }: TrackArgs): string {
  const g = new Grid(W, 1)
  const acc = isDone ? FINISHED : RUNNING
  const light = mix(acc, [255, 255, 255], 0.35)
  const track = mix(BACK, [128, 128, 128], 0.18)
  const fill = mix(track, acc, isDone ? 0.3 : 0.17)

  pill(g, 0, 0, W, x => (x + 0.5 < fx ? fill : track))

  const twinkle = isDone ? [3200, 3800, 4400, 3500] : [2200, 2800, 1900, 3300]
  const delay = [0, 700, 1300, 400]
  const dim = isDone ? 0.2 : 0.55

  for (let col = 0; col < Math.min(W, Math.ceil(fx)); col += 1) {
    const u = Math.min(1, (col + 0.5) / Math.max(1, fx))
    const dense = isDone ? 0.8 : 0.22 + 0.78 * Math.pow(u, 1.5)
    let bits = 0

    for (let r = 0; r < 4; r += 1) {
      for (let c = 0; c < 2; c += 1) {
        const sx = col * 2 + c

        if (sx / 2 >= fx || hash(sx, r, 1) > dense * 0.6) {
          continue
        }

        bits |= BRAILLE_BITS[r]?.[c] ?? 0
      }
    }

    if (bits === 0) {
      continue
    }

    const cls = Math.floor(hash(col, 0, 2) * 4)
    const blink = 1 - dim * (isTwinkling ? wave(now + (delay[cls] ?? 0), twinkle[cls] ?? 2200, 0.25) : 0.5)
    const tone = mix(GREY, light, isDone ? 1 : q(Math.min(1, Math.pow(u, 0.9) * 1.1)))
    const opacity = (0.35 + 0.65 * dense) * blink

    g.set(col, 0, 0x2800 + bits, pack(mix(fill, tone, q(opacity))), pack(fill))
  }

  const shown = cellText(label)
  const kw = shown.length + 2
  const kx = Math.round(Math.max(0, Math.min(W - kw, fx - kw / 2)))

  pill(g, 0, kx, kx + kw, () => acc)
  g.text(kx + 1, 0, shown, pack([255, 255, 255]), pack(acc))

  return g.encode()
}
