// Pixel-cell drawing for the summary pill and the progress bars, adapted from the plan-progress mod
// (https://github.com/zycck/claude-mods, MIT, Copyright (c) 2026 Kirill Serditov): the Grid of Raster cells, the
// pill, the Braille twinkle and the label pill that rides the fill's head.
//
// Ported from plan-progress by Kirill Serditov, MIT. See NOTICE.

import { isLight } from './tint'

export const DEFAULT = 0x01000000

type Cell = [number, number, number]

// a Raster cell takes one printable BMP character exactly one column wide, as the engine measures it
// (Bun.stringWidth, ambiguous narrow); any other character refuses the whole tree and every bar vanishes.
// NOT_ONE lists the printable BMP characters whose width is not one, as base-36 "start-extra" ranges
const NOT_ONE = '4t,lc-33,w3-6,13l-18,14v,14x-1,150-1,153,16o-5,174-a,17g,18r-k,19s,1cm-7,1cv-5,1d3-1,1d6-3,1e7,1e9,1f4-q,1ie-a,1kb-8,1kt,1li-3,1ln-8,1lx-2,1m1-4,1nd-2,1p3-8,1qi-1k,1tm-2,1tq-f,1u9-6,1uq-1,1vk-2,1x6-2,1xa-f,1xt-6,1ya-1,1z2,1z4-2,20q-2,20u-f,21d-6,21u-1,228-1,22d,22o-2,24a-2,24e-f,24x-6,25e-1,262-8,27u-2,27y-f,28h-6,28y-1,29s-2,2be-2,2bi-f,2c1-6,2ci-1,2dc-2,2dg,2ey-2,2f2-f,2fl-6,2g2-1,2gw-2,2ii-2,2im-f,2j5-6,2jm-1,2kg-2,2m2-2,2m6-f,2n6-1,2o1,2q2,2qa-2,2qe,2sx,2t0-6,2tj-7,2wh,2wk-8,2x4-6,2zc-1,305,307,309,31t-d,328-4,32e-1,32l-a,32x-z,346,371-3,376-5,37d-1,37h-1,388-1,38e-2,38x-3,39e,39h-1,39p,3a5,3cw-73,3tp-2,4k2-2,4ky-1,4lu-1,4mq-1,4ok-1,4on-6,4p2,4p5-a,4pp,4qz-4,4ud-1,4vd,4yo-2,4yv-1,4z6,4zd-2,55j-1,55n,57a,57c-6,57k,57m,57p-7,583-9,58f,59s-2b,5dg,5di-4,5do,5du,5ez-8,5fk-1,5gi-3,5go-1,5gr-2,5ie,5ig-1,5il,5in-2,5kc-7,5km-1,5ow-2,5p0-c,5pe-6,5pp,5pw,5q0-1,5vk-1r,6bv-4,6cq-4,6e8-f,6hc-1b,6xm-1,6y1-1,73d-3,73k,73n,7i5-1,7is-1,7jk-7,7k8-b,7lr,7m2-5,7mb,7mp,7my-1,7nh-1,7no-1,7ny,7o4,7oq,7oy-1,7p1,7p6,7p9,7ph,7pm-1,7qg,7rg,7ri,7rn-2,7rr,7th-2,7u8,7un,8ij-1,8k0,8k5,8vj-2,8zj,928-v,96o-p,97f-2g,9a8-5x,9gw-26,9j5-2d,9ll-2u,9ol-16,9pt-2l,9sg-2d,9v3-1b,9wg-13,9xs-mkc,wi8-1i,wvj-3,wvo-9,wwu-1,wz4-1,x6q,x6u,x6z,x7p-1,x7w,xc4-1,xcw-h,xdr,xeu-7,xfr-a,xgg-s,xhc-2,xir,xiu-3,xj0-1,xk5,xm1-5,xm9-1,xmd-1,xmr,xn0,xoc,xps,xpu-2,xpz-1,xq6-1,xq9,xrg-1,xrq,xyd,xyg,xyl,xz4-8mb,16ls-27,1d6o-e7,1dlq,1e68-p,1e74-1e,1e8k-i,1e94-3,1edb,1edd-2n,1ejk-6'
const notOne = NOT_ONE.split(',').map(r => {
  const [a = '0', n] = r.split('-')
  const from = parseInt(a, 36)
  return [from, from + (n ? parseInt(n, 36) : 0)] as const
})
function isNotOne(cp: number) {
  let lo = 0
  let hi = notOne.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const [from, to] = notOne[mid] ?? [0, 0]
    if (cp < from) hi = mid - 1
    else if (cp > to) lo = mid + 1
    else return true
  }
  return false
}
// marks and format characters (accents written apart, variation selectors, joiners, soft hyphens) take no cell
// of their own and go; anything else that cannot fill exactly one cell is drawn as a middle dot
export const cellChar = (ch: string): string => {
  if (/\p{M}|\p{Cf}/u.test(ch)) return ''
  const cp = ch.codePointAt(0) ?? 63
  const isControl = cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)
  return isControl || cp > 0xffff || (cp >= 0xd800 && cp <= 0xdfff) || isNotOne(cp) ? '·' : ch
}
// an emoji sequence (a variation selector, a keycap, joined people, a skin tone, a flag) is one picture two columns
// wide, so it is found a grapheme cluster at a time; everything else is measured a character at a time, as the
// engine measures it, since a cluster of letters (a Hindi conjunct, Thai SARA AM) is several columns
const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null
export const clusters = (s: string): string[] => (segmenter ? Array.from(segmenter.segment(s), x => x.segment) : [...s])
const isEmojiCluster = (c: string) =>
  /\u20E3|\p{Regional_Indicator}/u.test(c) ||
  (/\p{Extended_Pictographic}/u.test(c) && (/[\uFE0F\u200D\u{1F3FB}-\u{1F3FF}]/u.test(c) || (c.codePointAt(0) ?? 0) > 0xffff))
// the cells a string takes inside a Raster: a dot for an emoji sequence, each other character as cellChar draws it
export const cellText = (s: string): string => clusters(s).map(c => (isEmojiCluster(c) ? '·' : [...c].map(cellChar).join(''))).join('')
export const cellsOf = (s: string): number => [...cellText(s)].length
// the columns one character takes as plain Text: none for marks, format and control characters and the vowel and
// final jamo of a Hangul syllable written apart; two for wide ones, and for any character beyond the basic plane
// but mathematical letters (a guess too wide only pads the title box, one too narrow cuts the title)
function charColumns(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0
  if (/\p{M}|\p{Cf}/u.test(ch) || cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return 0
  if ((cp >= 0x1160 && cp <= 0x11ff) || (cp >= 0xd7b0 && cp <= 0xd7ff)) return 0
  if (cp > 0xffff) return cp >= 0x1d400 && cp <= 0x1d7ff ? 1 : 2
  return isNotOne(cp) ? 2 : 1
}
// the columns a string takes as plain Text, where the terminal draws a wide character (CJK, emoji) over two
export const columnsOf = (s: string): number => clusters(s).reduce((w, c) => w + (isEmojiCluster(c) ? 2 : [...c].reduce((n, ch) => n + charColumns(ch), 0)), 0)
export const fitCells = (s: string, w: number): string => {
  const chars = [...cellText(s)]
  if (chars.length <= w) return chars.join('')
  return w <= 1 ? '…'.slice(0, w) : chars.slice(0, w - 1).join('').trimEnd() + '…'
}


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

// What the terminal's own background is taken to be, from tint.ts: white or near-black.
export const back = (): number[] => (isLight() ? [255, 255, 255] : [24, 24, 27])
export const termFg = (): number[] => (isLight() ? [34, 34, 38] : [236, 234, 246])
const GREY = [120, 118, 128]
// Claude's orange for what is running; a blue for an agent that waits on someone (a decision).
const RUNNING = [217, 119, 87]
const WAITING = [96, 140, 224]
const FINISHED = [52, 168, 98]
const FAILED = [196, 84, 84]

export type ChipState = 'running' | 'waiting' | 'done' | 'failed'

const colorOf = (state: ChipState): number[] =>
  state === 'done' ? FINISHED : state === 'failed' ? FAILED : state === 'waiting' ? WAITING : RUNNING

// ---------- AA contrast ----------
// WCAG 2.x contrast, measured on the 4-bit colour the engine paints a Raster cell in (adapted from plan-progress).
const q17 = (c: number[]): number[] => c.map(v => Math.round(v / 17) * 17)

const relLum = (c: number[]): number => {
  const l = q17(c).map(v => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4))

  return 0.2126 * (l[0] ?? 0) + 0.7152 * (l[1] ?? 0) + 0.0722 * (l[2] ?? 0)
}

export const contrast = (a: number[], b: number[]): number =>
  (Math.max(relLum(a), relLum(b)) + 0.05) / (Math.min(relLum(a), relLum(b)) + 0.05)

// The first candidate that reads at AA (4.5:1) on every background given, else the one that reads best on the
// worst of them. The theme's own colours are never changed; the text only picks among candidates.
export function readable(bgs: number[][], ...candidates: number[][]): number[] {
  const worst = (c: number[]): number => Math.min(...bgs.map(bg => contrast(c, bg)))

  return candidates.find(c => worst(c) >= 4.5) ?? candidates.reduce((a, b) => (worst(b) > worst(a) ? b : a))
}

// Text on a solid pill: white, else the terminal's own background, else its foreground.
export const inkOn = (bg: number[]): number[] => readable([bg], [255, 255, 255], back(), termFg())

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

// The fill's Braille dots up to the head `fx`, each column twinkling with its own period and delay; `time` is the
// moment they twinkle at, and without `isTwinkling` they stand at half dim. `light` is the colour the dots brighten to.
export function twinkleFill(g: Grid, W: number, fx: number, isDone: boolean, fill: number[], light: number[], time: number, isTwinkling: boolean): void {
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
    const blink = 1 - dim * (isTwinkling ? wave(time + (delay[cls] ?? 0), twinkle[cls] ?? 2200, 0.25) : 0.5)
    const tone = mix(GREY, light, isDone ? 1 : q(Math.min(1, Math.pow(u, 0.9) * 1.1)))
    const opacity = (0.35 + 0.65 * dense) * blink

    g.set(col, 0, 0x2800 + bits, pack(mix(fill, tone, q(opacity))), pack(fill))
  }
}

// where the label pill starts: its middle on the head `fx`, kept inside the `W` cells
export const pillX = (W: number, kw: number, fx: number): number => Math.round(Math.max(0, Math.min(W - kw, fx - kw / 2)))

// One row of cells: a track, a fill up to `head` with Braille dots that twinkle, and the label on a pill at the
// head, as plan-progress draws a bar.
export function trackCells({ width: W, head: fx, label, isDone, now, isTwinkling }: TrackArgs): string {
  const g = new Grid(W, 1)
  const acc = isDone ? FINISHED : RUNNING
  const light = mix(acc, [255, 255, 255], 0.35)
  const track = mix(back(), [128, 128, 128], isLight() ? 0.14 : 0.18)
  const fill = mix(track, acc, isDone ? 0.3 : 0.17)

  pill(g, 0, 0, W, x => (x + 0.5 < fx ? fill : track))
  twinkleFill(g, W, fx, isDone, fill, light, now, isTwinkling)

  const shown = cellText(label)
  const kw = shown.length + 2
  const kx = pillX(W, kw, fx)

  pill(g, 0, kx, kx + kw, () => acc)
  g.text(kx + 1, 0, shown, pack(inkOn(acc)), pack(acc))

  return g.encode()
}

export const hexOf = (c: number[]): string => `#${c.map(v => v.toString(16).padStart(2, '0')).join('')}`

// A Raster-cell text cut to `width` columns, ending in two dots when it was cut.
const cut = (s: string, width: number): string => {
  const text = cellText(s)

  return text.length <= width ? text : width <= 2 ? text.slice(0, width) : `${text.slice(0, width - 2).trimEnd()}..`
}

// The model needs the name to keep at least this many cells; narrower than that, the model goes.
export const MIN_NAME = 5

export type ChipArgs = {
  width: number
  name: string
  // The model the agent runs on, already short ("haiku 5.5"); dropped first when the chip is narrow. Empty for none.
  model: string
  time: string
  // `running` twinkles and fills by `ratio`; the others stand still in their colour.
  state: ChipState
  // How much of its context window the agent has used, 0 to 1: the brighter part of a running chip.
  ratio: number
  frame: number
  now: number
  isTwinkling: boolean
}

// The tint a chip stands in, and what its close button takes as its own background.
export const chipTint = (state: ChipState): number[] =>
  mix(back(), colorOf(state), state === 'running' || state === 'waiting' ? 0.18 : 0.34)

// One agent as a row of cells: a tinted pill, a status glyph, the name, the model and the time at the right. A
// running chip's leading part (what it has spent of its context) is brighter and carries sparse dots that glow, as
// plan-progress's agent strips do. Every word reads at AA on the tint it sits on.
export function chipCells({ width: W, name, model, time, state, ratio, now, isTwinkling }: ChipArgs): string {
  const g = new Grid(W, 1)
  const isRunning = state === 'running'
  const color = colorOf(state)
  const tint = chipTint(state)
  const spent = mix(back(), color, 0.3)
  const edge = isRunning && ratio > 0 ? Math.max(1, Math.round(W * ratio)) : 0
  const bgs = edge > 0 ? [tint, spent] : [tint]

  pill(g, 0, 0, W, x => (x < edge ? spent : tint))

  if (isRunning) {
    for (let col = 1; col < W - 1; col += 1) {
      let bits = 0
      let glow = 0

      for (let r = 0; r < 4; r += 1) {
        for (let c = 0; c < 2; c += 1) {
          const sx = col * 2 + c

          if (hash(sx, r, 5) >= 0.08) {
            continue
          }

          bits |= BRAILLE_BITS[r]?.[c] ?? 0
          glow = Math.max(glow, 1 - 0.55 * (isTwinkling ? wave(now, 1900 + hash(sx, r, 6) * 1400, hash(sx, r, 7)) : 0.5))
        }
      }

      if (bits > 0) {
        const bg = col < edge ? spent : tint

        g.set(col, 0, 0x2800 + bits, pack(mix(bg, color, 0.2 + 0.4 * q(glow))), pack(bg))
      }
    }
  }

  const fg = termFg()
  const ink = pack(readable(bgs, fg, [255, 255, 255], [0, 0, 0]))
  const glyphInk = readable(bgs, color, mix(color, fg, 0.3), mix(color, fg, 0.6), fg)
  const glyph = state === 'done' ? '✓' : state === 'failed' ? 'x' : state === 'waiting' ? '?' : '●'
  const pulse = isRunning && isTwinkling ? mix(tint, glyphInk, 0.7 + 0.3 * q(wave(now, 1100))) : glyphInk

  g.text(1, 0, glyph, pack(readable(bgs, pulse, glyphInk, fg)), pack(tint))

  const dimInk = pack(readable(bgs, mix(tint, fg, 0.6), mix(tint, fg, 0.8), fg))
  const timeAt = W - 1 - time.length
  const modelAt = timeAt - 2 - model.length
  const hasModel = model !== '' && modelAt - 4 >= MIN_NAME
  const room = Math.max(0, (hasModel ? modelAt : timeAt) - 4)

  g.text(3, 0, cut(name, room), ink)

  if (hasModel) {
    g.text(modelAt, 0, model, dimInk)
  }

  g.text(timeAt, 0, time, dimInk)

  return g.encode()
}
