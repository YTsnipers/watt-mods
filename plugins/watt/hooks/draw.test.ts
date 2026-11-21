import { expect, test } from 'claude-code/testing'

import type { Plan } from '../types'
import { STATE_COLOR, hex, normalize } from './plan'
import { contrast } from './raster'
import { drawTrack, liveSource, timesAlt } from './svg'
import { setThemeSetting } from './tint'
import { barCells } from './track'

const plan = (input: Record<string, unknown>, prev: Plan | null = null, now = 1_000, id = 'draw'): Plan => {
  const made = normalize(input, prev, now, id)

  if (typeof made === 'string') {
    throw new Error(made)
  }

  return made
}

const TASK = { title: 'Fix login', stages: [{ name: 'Analyse', steps: ['Read code', 'Find bug'] }, { name: 'Fix', steps: ['Patch', 'Test'] }] }

// What a Raster holds: its characters (Braille dots left out) and, for each printed one, [foreground, background].
const decode = (cells: string): { text: string; printed: Array<[number[], number[]]> } => {
  const words = new Uint32Array(Uint8Array.from(atob(cells), c => c.charCodeAt(0)).buffer)
  const rgbOf = (v: number): number[] => [(v >> 16) & 255, (v >> 8) & 255, v & 255]
  const printed: Array<[number[], number[]]> = []
  let text = ''

  for (let i = 0; i < words.length; i += 3) {
    const cp = words[i] ?? 32
    const isDot = cp >= 0x2800 && cp <= 0x28ff

    text += isDot ? ' ' : String.fromCodePoint(cp)

    if (cp > 0x20 && !isDot) {
      printed.push([rgbOf(words[i + 1] ?? 0), rgbOf(words[i + 2] ?? 0)])
    }
  }

  return { text: text.replace(/\s+/g, ' ').trim(), printed }
}

test('the terminal bar names the stage, the step and the count on a pill at the fill head', () => {
  const p = plan(TASK)
  const { text } = decode(barCells(p, 70, 1_000))

  // the │ beside it is a stage mark of the track, not part of the pill
  expect(text).toContain('Analyse │ Read code 1/2')

  const half = plan({ next: true }, plan({ next: true }, p, 2_000), 3_000)

  expect(decode(barCells(half, 70, 4_000)).text).toContain('Fix │ Patch 1/2')
})

test('a finished terminal bar says Done and the steps it took; a narrow one is only a number or an icon', () => {
  const finished = plan({ done: ['Read code', 'Find bug', 'Patch', 'Test'] }, plan(TASK, null, 1_000, 'draw-done'), 5_000)

  expect(decode(barCells(finished, 70, 6_000)).text).toContain('✓ Done 4/4')
  expect(decode(barCells(finished, 20, 6_000)).text).toContain('✓')
  expect(decode(barCells(finished, 20, 6_000)).text).not.toContain('Done')
  expect(decode(barCells(plan(TASK, null, 1_000, 'draw-narrow'), 20, 6_000)).text).toContain('1')
})

test('every word on a terminal bar reads at AA, in every state, on a dark and a light terminal', () => {
  for (const theme of ['dark', 'light']) {
    setThemeSetting(theme)

    for (const state of ['running', 'needs_input', 'error', 'done'] as const) {
      const p = { ...plan(TASK, null, 1_000, `draw-aa-${state}`), state }
      const { printed } = decode(barCells(p, 60, 1_000))
      // the words of the pill: the cells laid on the state's own colour (a stage mark is a drawn line, not a word)
      const accent = hex(STATE_COLOR[state])
      const words = printed.filter(([, bg]) => bg.join() === accent.join())

      expect(words.length).toBeGreaterThan(5)

      for (const [fg, bg] of words) {
        expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5)
      }
    }
  }

  setThemeSetting('dark')
})

test('the desktop bar is a well-formed picture with the stage on its pill and hover tips for each step', () => {
  const p = plan(TASK, null, 1_000, 'svg-run')
  const { base, overlay, clock } = drawTrack(p, 600, 2_000)

  for (const svg of [base, overlay, clock]) {
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)
    expect(svg).not.toContain('NaN')
  }

  expect(base).toContain('>Analyse<')
  expect(base).toContain('Read code')
  // three marks between four steps, each with a tip naming what starts there
  expect(overlay.match(/class="tp /g)).toHaveLength(3)
  expect(overlay).toContain('>Find bug<')
  // the clock reels count in the frame by themselves, from the time the plan started
  expect(liveSource(clock, 4_000)).toContain('--d:-3.000s')
})

test('a finished desktop bar shows how long it took and has no clock', () => {
  const finished = plan({ done: ['Read code', 'Find bug', 'Patch', 'Test'] }, plan(TASK, null, 1_000, 'svg-done'), 66_000)
  const { base, clock } = drawTrack(finished, 600, 70_000)

  expect(finished.endedAt).toBe(66_000)
  expect(base).toContain('>1m 5s<')
  expect(clock).toBe('')
  expect(timesAlt(finished)).toContain('Test took 1m 5s')
})
