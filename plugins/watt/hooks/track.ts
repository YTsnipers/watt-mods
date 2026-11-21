// Ported from plan-progress by Kirill Serditov, MIT (https://github.com/zycck/claude-mods). See NOTICE.
//
// The terminal's bar: one row of Raster cells (a track, a fill of Braille dots that twinkle, stage marks, the label on
// a pill that rides the fill's head and glides to a new place), and the 30 fps clock that blits it while it moves. The
// desktop draws its own, in svg.ts.

import type { EngineInterface } from 'claude-code'

import type { Plan } from '../types'
import { STATE_COLOR, atHead, hex, pillStep } from './plan'
import { prefs } from './prefs'
import { Grid, back, cellsOf, fitCells, inkOn, mix, pack, pill, pillX, twinkleFill } from './raster'
import { isLight } from './tint'

// a bar twinkles only while Claude works on it; one waiting on the person or left open after the turn stands still
export const live = { isTurnLive: false }

const easeOut = (x: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 4)

export const glide = new Map<string, { from: number; to: number; at: number; W: number }>()
export const GLIDE_MS = 450
// the twinkle moment of each bar's last moving frame, kept while it stands still
export const stillPhase = new Map<string, number>()

// a head glides to a new place only while frames can carry the glide; otherwise it is drawn there at once. Its place
// is in cells of one width: at another (a narrower window, a longer title beside it) it would glide in from the wrong
// place, so it is drawn at the new one at once
function headAt(id: string, target: number, t: number, W: number, canGlide: boolean): number {
  const g = glide.get(id)
  if (!g || g.W !== W || (!canGlide && Math.abs(g.to - target) > 0.01)) {
    glide.set(id, { from: target, to: target, at: t, W })
    return target
  }
  const cur = g.from + (g.to - g.from) * easeOut((t - g.at) / GLIDE_MS)
  if (Math.abs(g.to - target) > 0.01) {
    glide.set(id, { from: cur, to: target, at: t, W })
    return cur
  }
  return cur
}

export function barCells(p: Plan, W: number, t: number): string {
  const g = new Grid(W, 1)
  const w = atHead(p)
  const done = p.state === 'done'
  const target = (done ? 1 : Math.min(1, w.pos / Math.max(1, w.total))) * W
  // after the turn a change lands at once: a glide would keep frames going through the engine's end-of-turn redraw
  const fx = headAt(p.id, target, t, W, live.isTurnLive)
  // only a moving bar twinkles with the clock; one that stands still keeps the twinkle of its last frame, so a
  // redraw (the end of a turn is one) rewrites none of its cells, even right after it stopped moving
  const phase = isAnimated(p, t) ? t : (stillPhase.get(p.id) ?? 0)
  stillPhase.set(p.id, phase)
  const bg = back()
  const acc = hex(STATE_COLOR[p.state])
  const light = mix(acc, [255, 255, 255], 0.35)
  const track = mix(bg, [128, 128, 128], isLight() ? 0.14 : 0.18)
  const fill = mix(track, acc, done ? 0.3 : 0.17)
  const under = (x: number) => (x + 0.5 < fx ? fill : track)
  pill(g, 0, 0, W, under)

  twinkleFill(g, W, fx, done, fill, light, phase, prefs.isTwinkling)

  let k = 0
  p.stages.forEach(s => {
    if (k > 0) {
      const x = Math.round((k / w.total) * W)
      if (x > 0 && x < W - 1) {
        const passed = x < fx - 0.5
        // a passed boundary is bright on a dark track and dark on a light one, where the fill is pale too
        const mark = passed ? (isLight() ? mix(acc, [0, 0, 0], 0.3) : mix(light, [255, 255, 255], 0.5)) : mix(track, isLight() ? [0, 0, 0] : [255, 255, 255], 0.45)
        g.set(x, 0, '│', pack(mark), pack(under(x)))
      }
    }
    k += s.steps.length
  })

  const base = hex(STATE_COLOR[p.state])
  const color = base
  const single = p.stages.length === 1
  const number = single ? Math.min(w.total, w.pos + 1) : w.stage + 1
  const icon = p.state === 'done' ? '✓' : p.state === 'error' ? '✕' : p.state === 'needs_input' ? '?' : ''
  let name = ''
  let count = ''
  if (W < 28) {
    name = icon || String(number)
  } else {
    name = done ? 'Done' : single ? (p.stages[0]?.name ?? 'Tasks') : (p.stages[w.stage]?.name ?? '')
    // the pill counts steps only; the agents have their own strips under the bar
    count = done ? `${w.total}/${w.total}` : single ? `${number}/${w.total}` : `${w.step}/${w.stageSize}`
  }
  const lead = icon && W >= 28 ? `${icon} ` : ''
  const maxName = Math.max(3, Math.floor(W * (W < 60 ? 0.75 : 0.55)) - cellsOf(lead) - cellsOf(count) - 5)
  // the step after the stage, as on the desktop; it gives way first when the bar is short
  const stepName = W < 28 ? '' : pillStep(p, w)
  const stepRoom = maxName - cellsOf(name) - 3
  const step = stepName && stepRoom >= 4 ? fitCells(stepName, stepRoom) : ''
  const shown = lead + (step ? name : fitCells(name, maxName))
  // the separator is the mark the pill stands on, as on the desktop: a stage's bar at its first step, a dot past it
  const tail = step ? ` ${w.step === 1 ? '│' : '•'} ${step}` : ''
  const kw = cellsOf(shown) + cellsOf(tail) + (count ? count.length + 1 : 0) + 2
  const kx = pillX(W, kw, fx)
  const white = pack(inkOn(color))
  pill(g, 0, kx, kx + kw, () => color)
  let at = kx + 1
  at += g.text(at, 0, shown, white, pack(color))
  // the separator in the text's own colour: every cell of the pill reads at AA
  if (tail) at += g.text(at, 0, tail, white, pack(color))
  if (count) g.text(at + 1, 0, count, white, pack(color))
  return g.encode()
}

export type Band = { requestId: string; W: number; list: readonly Plan[] }
let band: Band | null = null
let isFrameBusy = false
let frames: { cancel: () => void } | null = null
// when the engine last refused frames of this band for good; the frames rest a second before they try again
let refusedAt: number | null = null
// refused frames in a row: one sent between a redraw and its commit is refused once and the next goes through
let refusedInRow = 0
const REFUSED_MAX = 6

const isGliding = (p: Plan, t: number) => {
  const g = glide.get(p.id)
  return g !== undefined && g.from !== g.to && t - g.at < GLIDE_MS + 100
}
// without the twinkle a running bar alone has nothing to move: a glide starts the frames itself (syncFrames after the cells)
const isAnimated = (p: Plan, t: number) => (prefs.isTwinkling && live.isTurnLive && p.state === 'running') || isGliding(p, t)

// the 30 fps clock runs only while a terminal band has something moving; the second timer starts and stops it
export function syncFrames($: EngineInterface, now: number) {
  const isRested = refusedAt === null || now - refusedAt >= 1000
  const isWanted = band !== null && isRested && band.list.some(p => isAnimated(p, now))
  if (isWanted && !frames) frames = $.clock.every(33, () => void animate($))
  if (!isWanted && frames) {
    frames.cancel()
    frames = null
  }
}

// what each key of the band was last sent: a frame sends only cells that changed, so a bar with nothing moving in
// its cells (a fill still empty, or all under the pill) is not blitted the same 30 times a second. A refusal forgets
// it all, so the band is painted whole again once it takes frames
let sent: { band: Band; cells: Map<string, string> } | null = null

// the size goes along, so a band redrawn at another width answers with a deny naming both sizes
export function blitPlans($: EngineInterface, b: Band, list: readonly Plan[], now: number, isChangeOnly = false) {
  if (sent?.band !== b) sent = { band: b, cells: new Map() }
  const last = sent.cells
  const blit = (key: string, cells: string, rows: number) => {
    if (isChangeOnly && last.get(key) === cells) return []
    last.set(key, cells)
    return [$.ui.blit({ requestId: b.requestId, key, cells, columns: b.W, rows }).catch(() => undefined)]
  }
  return Promise.all(
    list.flatMap(p => blit(`track-${p.id}`, barCells(p, b.W, now), 1)),
  )
}

// blits the engine keeps refusing (the band hidden or unmounted, redrawn at another size, or its tree refused) stop
// the frames: the 1 s timer tries one frame again a second later, and a redraw lays the band out anew at once. A
// band shown again without a redraw (folded and unfolded) so comes back within a second instead of staying still
function stopFrames(b: Band, now: number) {
  if (band !== b) return
  refusedAt = now
  refusedInRow = 0
  frames?.cancel()
  frames = null
}

async function animate($: EngineInterface) {
  const b = band
  if (!b || isFrameBusy) return
  isFrameBusy = true
  try {
    const now = await $.clock.now()
    // a redraw while the clock was read laid the band out anew: this frame belongs to the old one
    if (band !== b) return
    const live = b.list.filter(p => isAnimated(p, now))
    if (live.length === 0) return
    const answers = await blitPlans($, b, live, now, true)
    if (!answers.some(a => a?.deny)) {
      refusedInRow = 0
      refusedAt = null
    } else {
      sent = null
      if (++refusedInRow >= REFUSED_MAX) stopFrames(b, now)
    }
  } finally {
    isFrameBusy = false
  }
}

// the band the terminal draws now, null while none is shown: set by the draw, read by the clock that blits its frames
export function setBand(b: Band | null): void {
  band = b

  if (b) {
    refusedAt = null
    refusedInRow = 0
  }
}

export const currentBand = (): Band | null => band

// a glide still under way lands now: frames running on would go out with the engine's end-of-turn redraw
export function landGlides(): void {
  for (const [id, g] of glide) glide.set(id, { ...g, from: g.to })
}

// when the glides still under way are over, 0 with none
export const glideSettleAt = (list: readonly Plan[]): number =>
  Math.max(0, ...list.map(p => glide.get(p.id)).map(g => (g && g.from !== g.to ? g.at + GLIDE_MS + 100 : 0)))
