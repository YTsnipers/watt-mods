// Ported from plan-progress by Kirill Serditov, MIT (https://github.com/zycck/claude-mods). See NOTICE.
//
// The desktop's bar: a track drawn as SVG (a stream of dots over the fill, checkpoint marks with hover tips, a pill
// with the stage, the step and a clock that counts in the frame by itself). The terminal draws its own, in track.ts.

import type { Plan, PlanState, PlanStep } from '../types'
import { INK, STATE_COLOR, atHead, elapsed, hex, isFinished, pillStep, plural, rgb } from './plan'
import { prefs } from './prefs'
import { clusters, mix } from './raster'

export const TRACK_H = 22
export const NARROW = 360
// the text of a light-scheme page that the marks left of a bar's head are read against
export const GUTTER_LIGHT = '#5F5E59'

// XML has no place for C0 controls (an ANSI colour code's ESC, a bell) or U+FFFE/U+FFFF, escaped or not: one in a
// title would leave the whole picture unparsable, drawn as a broken image
export const esc = (s: string) =>
  s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
export const textWidth = (s: string, px = 6.7) => [...s].reduce((w, ch) => w + (/[　-鿿]/.test(ch) ? 12 : /[ilI.,:;'|!]/.test(ch) ? 3.4 : /[mwMWШЩЖМ]/.test(ch) ? 9.5 : px), 0)

// a closer guess at a label's width in the system UI face the desktop draws a picture's text in (Segoe UI, SF Pro):
// spaces, the middle dot and narrow letters count narrow, wide capitals wide. Measured against Segoe UI it lands
// within a few percent; the margin on top keeps a wider face (SF Pro) inside the pill. Drawn text is centred on its
// box, so what is left of the error splits evenly between the two sides. Korean and full-width letters are an em wide
// like Chinese, an emoji (past the basic plane, or a dingbat like ✅) wider still, and the joiners and accents that
// ride on a letter take no room; lowercase Cyrillic ш щ ж ю ы м ф count wide, near their capitals
export const glyphW = (ch: string) =>
  /[\u0300-\u036F\u200B-\u200D\uFE00-\uFE0F]/.test(ch) ? 0
  : ch.length > 1 || /[\u2600-\u27BF]/.test(ch) ? 16.5
  : /[　-鿿가-힣\uFF01-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 12
  : /[\s·.,:;'|!iljI]/.test(ch) ? 3.3
  : /[frt]/.test(ch) ? 4.4
  : /[MWШЩЖЮФ…]/.test(ch) ? 10.8
  : /[шщжю]/.test(ch) ? 10.4
  : /[mwМЫымф]/.test(ch) ? 9.6
  : /[0-9]/.test(ch) ? 6.6
  : /[A-ZА-ЯЁ]/.test(ch) ? 7.6
  : 6.3
export const labelWidth = (s: string, size = 12, isBold = true) => (([...s].reduce((w, ch) => w + glyphW(ch), 0) * size) / 12) * (isBold ? 1 : 0.96) * 1.06
// a label cut to width, as labelWidth measures it, then given an ellipsis; at least three characters stay. It drops
// whole grapheme clusters, so an emoji is never split into a lone half (which shows as "�" and breaks the picture's
// encoding), and takes each one's width off as it goes, so a long label costs one pass and not one measure a letter
export const fitLabel = (s: string, width: number, size = 12, isBold = true) => {
  if (labelWidth(s, size, isBold) <= width) return s
  const scale = (size / 12) * (isBold ? 1 : 0.96) * 1.06
  const parts = clusters(s).map(c => ({ c, w: [...c].reduce((sum, ch) => sum + glyphW(ch), 0) * scale }))
  let w = parts.reduce((sum, x) => sum + x.w, 0)
  let n = parts.length
  // the ellipsis takes its own room, so the cut label with it still fits
  const room = width - glyphW('…') * scale
  while (n > 3 && w > room) w -= parts[--n]?.w ?? 0
  return n === parts.length ? s : parts.slice(0, n).map(x => x.c).join('').trimEnd() + '…'
}
// the text without its last grapheme cluster, for the cuts measured with textWidth
export const dropLast = (s: string) => clusters(s).slice(0, -1).join('')

export const ICON_PATH: Partial<Record<PlanState, string>> = {
  needs_input: 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01',
  error: 'M18 6 6 18M6 6l12 12',
  done: 'M20 6 9 17l-5-5',
}

// how long each finished step took (from the previous finish, or the plan's start) and each finished stage
export function stepTimes(p: Plan): { steps: Map<PlanStep, number>; stages: (number | undefined)[] } {
  const ends = p.stages.flatMap(s => s.steps).flatMap(st => (st.doneAt === undefined ? [] : [st.doneAt])).sort((a, b) => a - b)
  const startOf = (at: number) => Math.max(p.startedAt, ...ends.filter(t => t < at))
  const steps = new Map<PlanStep, number>()
  const stages = p.stages.map(s => {
    for (const st of s.steps) if (st.doneAt !== undefined) steps.set(st, st.doneAt - startOf(st.doneAt))
    const times = s.steps.map(st => st.doneAt)
    if (times.some(t => t === undefined)) return undefined
    const done = times as number[]
    return Math.max(...done) - Math.min(...done.map(startOf))
  })
  return { steps, stages }
}

// the fill is a still grid of 2 px dots, 3 px apart in 7 rows, and brightness streams over it from the head towards
// the start the way it does on Claude Code's effort slider: a wave of a few brightness steps scrolls left one column
// per step, and every dot flickers on its own, stepping up and back down to the grid. It is all patterns and masks,
// so the picture is the same size at any width
export const STREAM_COLS = 233 // the wave's pattern in columns, prime and long, so its loop does not show
export const STREAM_SPEED = 20 // columns a second; a bar at rest (waiting, failed, done) streams at half that
export const STREAM_LEVELS = [0.3, 0.37, 0.44, 0.51] // the grid's brightness at each step of the wave
export const FLICKER_TILE = 173 // columns the flicker classes are dealt over, every dot in exactly one
export const FLICKER_CLASSES = 24
export const FLICKER_LIFTS = [0, 0.35, 0.6, 0.9]
// [share of the fill, opacity]: the grid fades in from nothing at the start to full at two thirds; the flicker fades in
// later and steeper, so it sparkles at the head and thins out on its way to the start
export const STREAM_FADE: [number, number][] = [[0, 0], [0.67, 1], [1, 1]]
export const FLICKER_FADE: [number, number][] = [[0, 0], [0.15, 0], [0.5, 0.45], [0.8, 0.9], [1, 1]]
// mixed better than hash for the few hundred values the stream takes: with it the wave comes out as it was measured
// against the slider
export const streamHash = (a: number, b: number, k: number) => {
  let x = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(k, 1442695041)) | 0
  x = Math.imul(x ^ (x >>> 13), 1274126177)
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296
}
// the wave: noise over STREAM_COLS columns (wrapping), smoothed to blobs a few columns wide and cut into steps. Drawn
// as one stroke per step through its runs of columns, the full height of the track
export const STREAM_WAVE = (() => {
  const raw = Array.from({ length: STREAM_COLS }, (_, i) => streamHash(i, 0, 5))
  const smooth = raw.map((_, i) => {
    let sum = 0
    let weight = 0
    for (let d = -5; d <= 5; d++) {
      const k = Math.exp(-(d * d) / 12.5)
      sum += (raw[(i + d + STREAM_COLS) % STREAM_COLS] ?? 0) * k
      weight += k
    }
    return sum / weight
  })
  const lo = Math.min(...smooth)
  const hi = Math.max(...smooth)
  const steps = smooth.map(v => Math.min(STREAM_LEVELS.length - 1, Math.floor(((v - lo) / (hi - lo)) * STREAM_LEVELS.length)))
  const runs = STREAM_LEVELS.map((level, l) => {
    let d = ''
    let end = -1
    for (let i = 0; i < steps.length; ) {
      let j = i
      while (j < steps.length && steps[j] === steps[i]) j++
      if (steps[i] === l) {
        d += `${end < 0 ? `M${i * 3} ${TRACK_H / 2}` : `m${(i - end) * 3} 0`}h${(j - i) * 3}`
        end = j
      }
      i = j
    }
    return d ? `<path stroke-opacity="${level}" d="${d}"/>` : ''
  })
  return `<g stroke="#fff" stroke-width="${TRACK_H}">${runs.join('')}</g>`
})()
// the flicker: each class a pattern of its dots over the tile, and a timeline of lifts (a random walk over
// FLICKER_LIFTS, each held 50 to 300 ms, back at the grid now and then) of its own length and start. Every time in
// it is a whole number of the wave's 50 ms steps: a change anywhere in the picture redraws all of it, and on one beat
// the 24 classes and the wave redraw it 20 times a second instead of at nearly every frame (half the CPU)
export const FLICKER_TICK = 0.05
export const FLICKER = (() => {
  const of = Array.from({ length: 7 }, (_, r) => Array.from({ length: FLICKER_TILE }, (_, c) => Math.floor(streamHash(c, r, 302) * FLICKER_CLASSES)))
  return Array.from({ length: FLICKER_CLASSES }, (_, k) => {
    let d = ''
    let last: [number, number] | null = null
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < FLICKER_TILE; c++) {
        if (of[r]?.[c] !== k) continue
        d += `${last ? `m${c * 3 - last[0]} ${r * 3 - last[1]}` : `M${c * 3} ${r * 3}`}h2v2h-2z`
        last = [c * 3, r * 3]
      }
    }
    // in ticks; a frame that would hold the level it already has is left out
    const length = Math.round((2.3 + 2.4 * streamHash(k, 1, 11)) / FLICKER_TICK)
    const frames: string[] = []
    let level = 0
    let shown = -1
    for (let t = 0, i = 0; t < length - 1; i++) {
      if (level !== shown) frames.push(`${+((t / length) * 100).toFixed(3)}%{opacity:${FLICKER_LIFTS[level]}}`)
      shown = level
      t += Math.max(1, Math.round((0.07 + 0.23 * streamHash(k, i, 13)) / FLICKER_TICK))
      const u = streamHash(k, i, 15)
      level = u < 0.4 ? Math.max(0, level - 1) : u < 0.8 ? Math.min(3, level + 1) : 0
    }
    const css = `.q${k}{opacity:0;animation:q${k} ${(length * FLICKER_TICK).toFixed(2)}s step-end infinite;animation-delay:calc(var(--f) - ${(Math.round(streamHash(k, 2, 16) * length) * FLICKER_TICK).toFixed(2)}s)}@keyframes q${k}{${frames.join('')}}`
    return { d, css }
  })
})()
export const FLICKER_CSS = FLICKER.map(f => f.css).join('')
// the twinkle choice (prefs.isTwinkling) is read as it stands at each draw. Off, the fill stands still as reduce motion
// draws it, the flicker left out and the wave's bands kept where they start; the clocks and the glides still move
// the engine refuses the whole band, every bar in it, when one picture's source passes 131072 characters. A plan of
// hundreds of steps would get there through its marks and their hover tips (a few pixels apart they only cover each
// other anyway), so past a share of that each is thinned. Stage boundaries go first, as they give the track its
// shape and name the stages; the step marks fill what is left, kept only so far apart along the track. Picking by
// index would line up with regular stage sizes and drop every stage at once
export const MARKS_BUDGET = 40_000
export const TIPS_BUDGET = 100_000
export type Mark<T> = { x: number; isStage: boolean; item: T }
export function thin<T>(marks: Mark<T>[], size: (item: T) => number, budget: number): T[] {
  const sizeOf = (m: Mark<T>) => size(m.item)
  if (marks.reduce((n, m) => n + sizeOf(m), 0) <= budget) return marks.map(m => m.item)
  const keep = new Set<Mark<T>>()
  let used = 0
  // every so many, spread evenly, of the marks that fit only in part
  const spread = (list: Mark<T>[], room: number) => {
    const every = Math.max(1, Math.ceil(list.reduce((n, m) => n + sizeOf(m), 0) / Math.max(1, room)))
    list.forEach((m, i) => {
      if (i % every !== 0 || used + sizeOf(m) > budget) return
      used += sizeOf(m)
      keep.add(m)
    })
  }
  spread(marks.filter(m => m.isStage), budget)
  const steps = marks.filter(m => !m.isStage)
  const room = budget - used
  const fits = steps.length === 0 ? 0 : Math.floor(room / (steps.reduce((n, m) => n + sizeOf(m), 0) / steps.length))
  const span = (marks.at(-1)?.x ?? 0) - (marks[0]?.x ?? 0)
  const gap = fits > 0 ? span / fits : Infinity
  let last = -Infinity
  for (const m of marks) {
    if (keep.has(m)) last = m.x
    else if (!m.isStage && m.x - last >= gap && used + sizeOf(m) <= budget) {
      used += sizeOf(m)
      keep.add(m)
      last = m.x
    }
  }
  return marks.filter(m => keep.has(m)).map(m => m.item)
}

// last drawn head position per plan, so a redraw glides from where the bar was; from and at are the glide that led
// there (from === x when it stood), so a redraw before it has run keeps it going instead of drawing it arrived
export const lastHead = new Map<string, { W: number; x: number; from: number; at: number }>()
// where each bar's wave got to (cols, in columns) when it last changed speed (at): a bar coming to rest, or set going
// again, streams on from there at its new speed. Timed from the start at the new speed instead, the wave would jump to
// wherever that speed had brought it
export const waveFrom = new Map<string, { start: number; speed: number; at: number; cols: number }>()

// the track draws in a sandboxed frame (for hover); its page must stay see-through in either theme
export const SEE_THROUGH = '<style>:root,html,body{background:transparent!important;color-scheme:light dark;margin:0;overflow:hidden}svg{display:block}</style>'

// a clock that counts in the frame by itself, so the drawing never has to be redrawn each second (a redraw
// reloads the frame and everything in it blinks): each digit is a reel of its figures behind a one-line window,
// stepped by a CSS animation whose negative delay is the time already run. Plain SVG, since the host's frame
// drops foreignObject. {{T:start}} becomes those seconds on every draw (liveSource)
export const CLOCK_W = 48 // "59m 59s"
export const LINE = 16
export const CLOCK_CSS = `.ckt{font-variant-numeric:tabular-nums}
.rs1{animation:r10 10s steps(10) var(--d) infinite}.rs10{animation:r6 60s steps(6) var(--d) infinite}
.cc{animation:cc 36000s linear var(--d) both}@keyframes cc{0%,.1666%{transform:translateX(-13.5px)}.1667%,1.6666%{transform:translateX(-3.25px)}1.6667%,9.9999%{transform:none}10%,99.9999%{transform:translateX(-4.25px)}100%{transform:translateX(-.75px)}}
.rm1{animation:r10 600s steps(10) var(--d) infinite}.rm10{animation:r10 6000s steps(10) var(--d) infinite}.rmm{animation:hm 60s steps(1,end) var(--d) both}
.rm6{animation:r6 3600s steps(6) var(--d) infinite}.rh1{animation:r10 36000s steps(10) var(--d) infinite}.rh10{animation:r10 360000s steps(10) var(--d) infinite}
.ph1{animation:ho 3600s steps(1,end) var(--d) both}.ph2{animation:hm 3600s steps(1,end) var(--d) both}
@keyframes r10{to{transform:translateY(-${LINE * 10}px)}}@keyframes r6{to{transform:translateY(-${LINE * 6}px)}}@keyframes hm{from{opacity:0}to{opacity:1}}@keyframes ho{from{opacity:1}to{opacity:0}}`

// x is the clock's left edge, top the window's top. Under an hour it reads "12m 05s", the minutes part hidden for
// the first minute; from an hour on "1h 05m", as elapsed() writes a finished time, up to 99h
export function liveClock(x: number, top: number, start: number, cls: string, textCls: string, isCentered = false): string {
  const base = top + 12
  const reel = (cx: number, figures: string[], reelCls: string) =>
    `<g class="${reelCls}"><text class="${textCls} ckt" text-anchor="middle">${figures
      .map((f, i) => `<tspan x="${cx.toFixed(1)}" y="${base + i * LINE}">${f}</tspan>`)
      .join('')}</text></g>`
  const unit = (ux: number, label: string) => `<text x="${ux.toFixed(1)}" y="${base}" class="${textCls}">${label}</text>`
  const digits = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']
  const tens = ['', ...digits.slice(1)]
  const id = `ck${start}x${Math.round(x)}y${Math.round(top)}`
  const minutes =
    `<g class="ph1"><g class="rmm">${reel(x + 3.5, tens, 'rm10')}${reel(x + 10.5, digits, 'rm1')}${unit(x + 14, 'm')}</g>` +
    `${reel(x + 31, digits.slice(0, 6), 'rs10')}${reel(x + 38, digits, 'rs1')}${unit(x + 41.5, 's')}</g>`
  // "h" is narrower than "m", so the minutes sit 3 px nearer to it than the seconds sit to "m": the same space between
  // the parts, and the face's wide "m" ends about where the other face's "s" does
  const hours =
    `<g class="ph2">${reel(x + 3.5, tens, 'rh10')}${reel(x + 10.5, digits, 'rh1')}${unit(x + 14, 'h')}` +
    `${reel(x + 28, digits.slice(0, 6), 'rm6')}${reel(x + 35, digits, 'rm1')}${unit(x + 38.5, 'm')}</g>`
  // the window only has to hide the reels' other figures above and below; sideways it leaves room past the clock's
  // right edge for a wider face than Segoe UI (SF Pro), whose last letter would otherwise be cut
  return (
    `<style>.${id}{--d:-{{T:${start}}}s}</style><g class="${cls} ${id}"><clipPath id="${id}"><rect x="${(x - 2).toFixed(1)}" y="${top}" width="${CLOCK_W + 10}" height="${LINE}"/></clipPath>` +
    `<g clip-path="url(#${id})"${isCentered ? ' class="cc"' : ''}>${minutes}${hours}</g></g>`
  )
}

// the desktop rebuilds a strip's picture on every redraw of the band, another plugin's invalidate included, so a
// source reused from an earlier draw would restart its clocks at that draw's offset (issue #6): the offset is
// taken from now on every draw. To the millisecond: a glide is steepest at its start, where a tenth of a second
// is up to 40% of the way, so a picture rebuilt there at a rounded offset set the pill back and sent it on again
export function liveSource(template: string, now: number): string {
  return template.replace(/\{\{T:(\d+)\}\}/g, (_, t: string) => Math.max(0, (now - Number(t)) / 1000).toFixed(3))
}

// SMIL runs whatever CSS says, so prefers-reduced-motion alone cannot stop a glide or a colour flow: an element that
// moves is drawn twice, the moving copy (class mv) hidden under reduced motion and a still one (sv), shown only then,
// in its place. draw gets the animation to put in the element and the class to give it
export const withStill = (draw: (anim: string, cls: string) => string, anim: string) => (anim ? draw(anim, 'mv') + draw('', 'sv') : draw('', ''))
export const classAttr = (cls: string) => (cls ? ` class="${cls}"` : '')
export const STILL_CSS = '.sv{display:none}'
export const STILL_REDUCED = '.mv{display:none}.sv{display:inline}'

// a bar is drawn three times: the track itself as a plain picture, cheap for the desktop to rebuild whenever anything
// redraws; the pill's clock, a plain picture too, that the desktop shows while the pointer is over the track; and a
// see-through layer on top for the checkpoint times. That layer needs an interactive frame, and the desktop rebuilds
// such frames on every redraw of the band; empty until hovered, the rebuild is invisible. The clock is no part of it:
// a frame built anew under a still pointer is not hovered until the pointer moves, so the clock went out on every
// redraw (the footer's figure, once a second while a response streams), where the desktop's own hover holds. All
// three at one width are reused until what they show of the plan changes
export type Track = { base: string; overlay: string; clock: string }
// the desktop rebuilds the picture when anything near it redraws (the footer's figure, a strip), and a rebuilt glide
// would play again from the start, the pill jumping back to where it was. So the glide begins where its time has got
// to ({{T:moved}} becomes the seconds since the move on every draw, liveSource), and once it has run the bar is drawn
// standing at its place. A rebuild from the very same source starts that source's glide over, whatever its offset:
// the engine hands back its last answer when the desktop asks again with nothing the band read changed, which it does
// as the model starts to answer after a tool call, some .5 s after the move. So the glide is short and the standing
// picture is asked for before it ends: from PICTURE_STAND_MS on, with the pill all but there, a draw is standing,
// and the gliding source is current for as short a time as the desktop takes to draw the band again. The desktop
// shows a picture some .1 s after it is drawn and the standing one as late, so it lands about where the glide
// stands then: a step of 1-2% of the way, where at .2 s it was 5%
export const PICTURE_GLIDE_MS = 300
export const PICTURE_STAND_MS = 250

// kept per bar id with what the track shows of the plan: $.state hands back a fresh copy on every read, so a plan
// object is never seen twice and could not key the drawings itself
export const drawn = new Map<string, { sig: string; W: number; color: string; track: Track; glideUntil: number }>()
// the twinkle choice is part of what a drawing shows: turned over in the settings window, the cached one is stale
export const trackSig = (p: Plan) => JSON.stringify([p.state, p.startedAt, p.endedAt, p.stages, prefs.isTwinkling])

export function trackSvg(p: Plan, W: number, now: number): Track {
  const cached = drawn.get(p.id)
  const sig = trackSig(p)
  const color = STATE_COLOR[p.state]
  if (cached?.sig === sig && cached.W === W && cached.color === color && (cached.glideUntil === 0 || now < cached.glideUntil)) return cached.track
  const track = drawTrack(p, W, now)
  const glideUntil = track.base.includes('<animateTransform') ? (lastHead.get(p.id)?.at ?? now) + PICTURE_STAND_MS : 0
  drawn.set(p.id, { sig, W, color, track, glideUntil })
  return track
}

export function drawTrack(p: Plan, W: number, now = 0): Track {
  const H = TRACK_H
  const w = atHead(p)
  const done = p.state === 'done'
  // the fill is exactly the finished share: a fresh plan starts empty
  const frac = done ? 1 : Math.min(1, w.pos / Math.max(1, w.total))
  const fx = frac * W
  const key = p.id
  // a resize redraws at once: a head drawn at another width would glide in from the wrong place
  const last = lastHead.get(key)
  // drawn again on its way to the same place (an agent's event, any redraw), the glide goes on from where it began,
  // its begin offset putting the pill where its time has got to
  const isGliding = last?.W === W && Math.abs(last.x - fx) <= 0.5 && now < last.at + PICTURE_STAND_MS
  const from = isGliding ? last.from : last?.W === W ? last.x : fx
  const at = isGliding ? last.at : now
  lastHead.set(key, { W, x: fx, from, at })

  const acc = hex(STATE_COLOR[p.state])
  const light = mix(acc, [255, 255, 255], 0.32)
  const ease = 'calcMode="spline" keyTimes="0;1" keySplines=".2 .8 .2 1"'
  const glide = Math.abs(from - fx) > 0.5

  // the stream (STREAM_WAVE, FLICKER) over the fill, drawn as far as the fill reaches during a glide back. Its fades run
  // along the fill; the wave's mask is a pattern longer than that, so its slide never uncovers the end
  const span = Math.max(fx, from)
  const speed = p.state === 'running' ? STREAM_SPEED : STREAM_SPEED / 2
  const was = waveFrom.get(key)
  const wave =
    was?.start !== p.startedAt ? { start: p.startedAt, speed, at: p.startedAt, cols: 0 }
    : was.speed === speed ? was
    : // a whole column: the wave's delay (cols / speed) then stays on the flicker's 50 ms beat, one redraw rate for both
      { start: p.startedAt, speed, at: now, cols: Math.round(was.cols + (Math.max(0, now - was.at) / 1000) * was.speed) % STREAM_COLS }
  waveFrom.set(key, wave)
  const fadeMask = (id: string, stops: [number, number][]) =>
    `<linearGradient id="${id}g" x1="0" x2="${fx.toFixed(1)}" gradientUnits="userSpaceOnUse">${stops.map(([at, o]) => `<stop offset="${at}" stop-color="#fff" stop-opacity="${o}"/>`).join('')}</linearGradient>` +
    `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="url(#${id}g)"/></mask>`
  // without the twinkle the flicker goes as a whole: its dots get their resting opacity from its stylesheet alone, so
  // patterns left without it would draw every one of them bright
  const streamDefs =
    fadeMask('fade', STREAM_FADE) +
    (prefs.isTwinkling ? fadeMask('kfade', FLICKER_FADE) : '') +
    `<pattern id="dg" width="3" height="3" y="1" patternUnits="userSpaceOnUse"><rect width="2" height="2" fill="${rgb(light)}"/></pattern>` +
    `<pattern id="wp" width="${STREAM_COLS * 3}" height="${H}" patternUnits="userSpaceOnUse">${STREAM_WAVE}</pattern>` +
    `<mask id="wave" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect class="wm" width="${(span + STREAM_COLS * 3 + 3).toFixed(1)}" height="${H}" fill="url(#wp)"/></mask>` +
    (prefs.isTwinkling ? FLICKER.map((f, k) => `<pattern id="fp${k}" width="${FLICKER_TILE * 3}" height="21" y="1" patternUnits="userSpaceOnUse"><path class="q${k}" fill="${rgb(light)}" d="${f.d}"/></pattern>`).join('') : '')
  const stream =
    `<g mask="url(#fade)"><g mask="url(#wave)"><rect width="${span.toFixed(1)}" height="21" fill="url(#dg)"/></g></g>` +
    (prefs.isTwinkling ? `<g mask="url(#kfade)">${FLICKER.map((_, k) => `<rect width="${span.toFixed(1)}" height="${H}" fill="url(#fp${k})"/>`).join('')}</g>` : '')

  const took = stepTimes(p)
  const markList: Mark<string>[] = []
  const zoneList: Mark<{ hit: string; tip: string; rule: string }>[] = []
  let k = 0
  p.stages.forEach((s, i) => {
    s.steps.forEach((_, j) => {
      if (k > 0) {
        const x = (k / w.total) * W
        const isStage = j === 0
        // a stage boundary is a short capsule, a step a dot; bright once passed. On a light page both would fade into
        // the track, so there the stylesheet darkens them by class
        const passed = x < fx - 1
        const fill = passed ? rgb(mix(light, [255, 255, 255], 0.45)) : '#A8A69E'
        const opacity = passed ? (isStage ? 0.95 : 0.8) : isStage ? 0.9 : 0.8
        const cls = passed ? 'mp' : 'ma'
        markList.push({
          x,
          isStage,
          item: isStage
            ? `<rect class="${cls}" x="${(x - 1.5).toFixed(1)}" y="${(H - 10) / 2}" width="3" height="10" rx="1.5" fill="${fill}" opacity="${opacity}"/>`
            : `<circle class="${cls}" cx="${x.toFixed(1)}" cy="${H / 2}" r="1.4" fill="${fill}" opacity="${opacity}"/>`,
        })
        const before = p.stages[isStage ? i - 1 : i]
        const ended = isStage ? before?.steps[before.steps.length - 1] : s.steps[j - 1]
        // a mark the bar has reached names what ended there (and how long it took); one still ahead names what starts
        // there, so a name far up the track does not read as the stage the bar is in
        const label = k <= w.pos ? (isStage ? (before?.name ?? '') : (ended?.title ?? '')) : isStage ? s.name : (s.steps[j]?.title ?? '')
        const ms = isStage ? took.stages[i - 1] : took.steps.get(ended as PlanStep)
        const full = ms === undefined || k > w.pos ? label : `${label} · ${elapsed(ms)}`
        // a tip never runs past the track: a long title is shortened to fit
        const text = fitLabel(full, W - 16, 11, false)
        const tw = Math.min(W, labelWidth(text, 11, false) + 16)
        const tx = Math.max(0, Math.min(W - tw, x - tw / 2))
        zoneList.push({
          x,
          isStage,
          item: {
            hit: `<rect class="h${k}" x="${(x - 5).toFixed(1)}" width="10" height="${H}" fill="#000" fill-opacity="0"/>`,
            tip: `<g class="tp p${k}"><rect x="${tx.toFixed(1)}" y="2" width="${tw.toFixed(1)}" height="${H - 4}" rx="${(H - 4) / 2}" fill="#1F1E1D" fill-opacity=".94"/><text x="${(tx + tw / 2).toFixed(1)}" y="${H / 2 + 3.8}" text-anchor="middle" class="tt">${esc(text)}</text></g>`,
            rule: `.h${k}:hover~.p${k}`,
          },
        })
      }
      k++
    })
    void i
  })
  const marks = thin(markList, m => m.length, MARKS_BUDGET).join('')
  const zones = thin(zoneList, z => z.hit.length + z.tip.length + z.rule.length + 1, TIPS_BUDGET)
  const hits = zones.map(z => z.hit).join('')
  const tips = zones.map(z => z.tip).join('')
  const tipRules = zones.map(z => z.rule)

  // knob: a pill with stage and count, or a round dot with the stage number when narrow
  const isNarrow = W < NARROW
  const color = STATE_COLOR[p.state]
  const icon = ICON_PATH[p.state]
  const single = p.stages.length === 1
  const number = single ? w.step : w.stage + 1
  let knob = ''
  let timePill = ''
  let kw = H
  if (isNarrow) {
    const label = done ? '' : String(number)
    knob = `<circle cx="0" cy="${H / 2}" r="${H / 2}" fill="${color}"/>${
      done ? `<path d="${ICON_PATH.done}" transform="translate(-6 5) scale(.5)" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>` : `<text x="0" y="${H / 2 + 4.2}" text-anchor="middle" class="kt">${label}</text>`
    }`
  } else {
    const name = done ? (p.endedAt ? elapsed(p.endedAt - p.startedAt) : 'Done') : single ? (p.stages[0]?.name ?? 'Tasks') : (p.stages[w.stage]?.name ?? '')
    // the pill carries the stage name and, past a thin line, the step at its place (the fill and the percent
    // already say how far along it is); folded agents stay folded, the pill does not count them
    const iconW = icon ? 16 : 0
    // at most about half a short track, and never so wide on a long one that it hides the marks around it
    const maxW = Math.max(80, Math.min(W * 0.55, 320))
    const room = maxW - (20 + iconW)
    // the step is set a size smaller and lighter than the stage, past a thin line
    const stageWidth = (text: string) => labelWidth(text)
    const stepWidth = (text: string) => labelWidth(text, 11, false)
    // the step gives way first: shortened, then dropped, before the stage name is
    const sepW = 15
    const stepRoom = room - stageWidth(name) - sepW
    const step = stepRoom >= stepWidth('Abc…') ? fitLabel(pillStep(p, w), stepRoom, 11, false) : ''
    const shown = step ? name : fitLabel(name, room)
    const shownW = stageWidth(shown) + (step ? sepW + stepWidth(step) : 0)
    // a running pill is wide enough for its clock too, so the hover swap does not change its size
    const textW = done ? shownW : Math.max(shownW, CLOCK_W)
    const contentW = iconW + textW
    kw = Math.round(20 + contentW)
    const left = -contentW / 2
    const mid = left + iconW + textW / 2
    knob = `<rect x="${-kw / 2}" y="0" width="${kw}" height="${H}" rx="${H / 2}" fill="${color}"/>`
    if (icon) knob += `<path d="${icon}" transform="translate(${left.toFixed(1)} 5) scale(.5)" fill="none" stroke="${INK}" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>`
    // the separator is the mark the pill stands on: a stage's capsule at a stage's first step, a step's dot past it
    const sepMark = (x: number) =>
      w.step === 1
        ? `<rect x="${(x - 1).toFixed(1)}" y="${(H - 10) / 2}" width="2" height="10" rx="1" fill="${INK}" fill-opacity=".7"/>`
        : `<circle cx="${x.toFixed(1)}" cy="${H / 2}" r="1.7" fill="${INK}" fill-opacity=".8"/>`
    if (step) {
      // the line is the anchor: the stage ends at it and the step starts after it, so whatever the font's real
      // widths, the two never run into each other
      const line = left + iconW + (textW - shownW) / 2 + stageWidth(shown)
      knob +=
        `<text x="${line.toFixed(1)}" y="${H / 2 + 4.2}" text-anchor="end" class="kt">${esc(shown)}</text>` +
        sepMark(line + 7.5) +
        `<text x="${(line + sepW).toFixed(1)}" y="${(H / 2 + 3.9).toFixed(1)}" class="kt kp">${esc(step)}</text>`
    } else knob += `<text x="${mid.toFixed(1)}" y="${H / 2 + 4.2}" text-anchor="middle" class="kt">${esc(shown)}</text>`
    // hovering the track lays a copy of the pill over it, the stage name giving way to the time the plan has run so far
    if (!done) {
      const face = `<rect x="${-kw / 2}" y="0" width="${kw}" height="${H}" rx="${H / 2}" fill="${color}"/>${
        icon ? `<path d="${icon}" transform="translate(${left.toFixed(1)} 5) scale(.5)" fill="none" stroke="${INK}" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>` : ''
      }`
      timePill = `${face}${liveClock(mid - CLOCK_W / 2, 3, p.startedAt, 'kc0', 'kt', true)}`
    }
  }
  const clampX = (x: number) => Math.max(kw / 2, Math.min(W - kw / 2, x))
  const kx = clampX(fx)
  const kFrom = clampX(from)

  // the step name is full white: at .9 it reads under AA (4.5:1) on the amber pill
  // the desktop rebuilds the picture whenever something near it redraws, which starts its animations over: every one
  // is set back by the time since the plan started ({{T}}, liveSource), so a rebuild picks the stream up where it was
  // instead of jumping back. The wave moves one column at a time (steps), as the slider's does, timed from its last
  // change of speed (waveFrom) and set on by the columns it had gone by then
  const motion = `svg{--f:-{{T:${Math.round(p.startedAt)}}}s;--w:-{{T:${Math.round(wave.at)}}}s}
.wm{animation:wm ${(STREAM_COLS / speed).toFixed(2)}s steps(${STREAM_COLS}) infinite;animation-delay:calc(var(--w) - ${(wave.cols / speed).toFixed(2)}s)}
@keyframes wm{to{transform:translateX(-${STREAM_COLS * 3}px)}}
${FLICKER_CSS}
`
  const style = `<style>
${prefs.isTwinkling ? motion : ''}.kt{font:500 12px 'Anthropic Sans',ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;fill:${INK}}
.kp{font-size:11px;font-weight:400}
@media (prefers-color-scheme:light){.mp{fill:${rgb(mix(acc, [0, 0, 0], 0.3))};opacity:1}.ma{fill:${GUTTER_LIGHT};opacity:1}}
${STILL_CSS}@media (prefers-reduced-motion:reduce){.wm,[class^="q"]{animation:none}${STILL_REDUCED}}
</style>`
  const hoverStyle = `<style>
.tp{opacity:0;transition:opacity .12s;pointer-events:none}${tipRules.length ? `${tipRules.join(',')}{opacity:1}` : ''}
.tt{font:400 11px 'Anthropic Sans',ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;fill:#F0EEFC}
.kb,rect[class^="h"]{cursor:pointer}
</style>`
  // a glide drawn again later starts that much into its run, or past its end, standing where it went
  const begin = `begin="-{{T:${Math.round(at)}}}s"`
  const dur = `dur="${PICTURE_GLIDE_MS / 1000}s"`
  const glideFill = glide ? `<animate attributeName="width" from="${from.toFixed(1)}" to="${fx.toFixed(1)}" ${dur} ${begin} ${ease} fill="freeze"/>` : ''
  const glideKnob = glide ? `<animateTransform attributeName="transform" type="translate" from="${kFrom.toFixed(1)} 0" to="${kx.toFixed(1)} 0" ${dur} ${begin} ${ease} fill="freeze"/>` : ''

  // a gliding pill is written once and shown by reference in both copies, so its words are not in the picture twice
  const place = `transform="translate(${kx.toFixed(1)} 0)"`
  const pill = glideKnob
    ? `<defs><g id="kn">${knob}</g></defs><g class="mv" ${place}>${glideKnob}<use href="#kn"/></g><use class="sv" href="#kn" ${place}/>`
    : `<g ${place}>${knob}</g>`

  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
  const base = `${open}${style}
<defs><clipPath id="pill"><rect width="${W}" height="${H}" rx="${H / 2}"/></clipPath><clipPath id="fill">${withStill((anim, cls) => `<rect${classAttr(cls)} width="${fx.toFixed(1)}" height="${H}">${anim}</rect>`, glideFill)}</clipPath>
<linearGradient id="base" x1="0" x2="${fx.toFixed(1)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${rgb(acc)}" stop-opacity=".05"/><stop offset="1" stop-color="${rgb(acc)}" stop-opacity=".33"/></linearGradient>
${streamDefs}</defs>
<g clip-path="url(#pill)"><rect width="${W}" height="${H}" fill="#808080" fill-opacity=".16"/>
<g clip-path="url(#fill)"><rect width="${fx.toFixed(1)}" height="${H}" fill="url(#base)"/>${stream}</g>${marks}</g>
${pill}</svg>`
  // the hover layer: checkpoint areas under a running pill's place, so the pill wins where they meet; tips on top
  const pillArea = timePill ? `<rect class="kb" x="${(kx - kw / 2).toFixed(1)}" y="0" width="${kw}" height="${H}" fill="#000" fill-opacity="0"/>` : ''
  const overlay = `${open}${SEE_THROUGH}${hoverStyle}${hits}${pillArea}${tips}</svg>`
  // the pill's copy with its clock, for the desktop to show over the track while the pointer is on it. Shown at any
  // moment, so it glides with the pill (the same glide and offset, and the same still copy for reduced motion) rather
  // than standing at the new place while the pill slides in under it
  const clockStyle = `<style>.kt{font:500 12px 'Anthropic Sans',ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;fill:${INK}}${CLOCK_CSS}
${STILL_CSS}@media (prefers-reduced-motion:reduce){${STILL_REDUCED}}</style>`
  const clockPill = glideKnob ? `<g class="mv" ${place}>${glideKnob}${timePill}</g><g class="sv" ${place}>${timePill}</g>` : `<g ${place}>${timePill}</g>`
  const clock = timePill ? `${open}${clockStyle}${clockPill}</svg>` : ''

  return { base, overlay, clock }
}

// the hover layer's words: what its tips show, the time the latest finished steps took, for a person who hears the
// band instead of pointing at its marks
export function timesAlt(p: Plan): string {
  const last = [...stepTimes(p).steps].sort(([a], [b]) => (a.doneAt ?? 0) - (b.doneAt ?? 0)).slice(-3)
  if (last.length) return `${p.title}: ${last.map(([st, ms]) => `${st.title} took ${elapsed(ms)}`).join(', ')}`
  // steps sent finished, a bar closed by its state, the Agents bar's agents: finished, with no time to read
  const steps = p.stages.flatMap(s => s.steps)
  const ended = p.state === 'done' ? steps.length : steps.filter(st => isFinished(st.status)).length
  return `${p.title}: ${ended ? `${ended} of ${plural(steps.length, 'step')} finished, no times` : 'no step finished yet'}`
}

// when a gliding picture of the bar is over, 0 for one standing
export const glideEnd = (id: string): number => drawn.get(id)?.glideUntil ?? 0

// a bar that is gone takes its drawings with it
export function forgetTrack(id: string): void {
  lastHead.delete(id)
  waveFrom.delete(id)
  drawn.delete(id)
}

// module maps outlive the bars they describe: drop what no bar holds any more
export function keepTracks(bars: ReadonlySet<string>): void {
  for (const id of lastHead.keys()) if (!bars.has(id)) lastHead.delete(id)
  for (const id of waveFrom.keys()) if (!bars.has(id)) waveFrom.delete(id)
  for (const id of drawn.keys()) if (!bars.has(id)) drawn.delete(id)
}
