import type { EngineInterface, Register, Timer } from 'claude-code'

import { loadPrefs, prefs } from './prefs'
import { chipCells, chipTint, hexOf, trackCells } from './raster'
import { startSettings } from './settings'
import { loadThemeSetting, readTint, setThemeSetting } from './tint'

const live = (status: string): boolean => status === 'running' || status === 'waiting' || status === 'pending'

const clock = (ms: number): string => {
  const s = Math.floor(ms / 1000)

  return s >= 60 ? `${Math.floor(s / 60)}m${s % 60}s` : `${s}s`
}

const FRAME_MS = 250
const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
const PULSE = ['#5a4aa3', '#6a58c0', '#7a68d4', '#6a58c0']
const EMPTY = '#26233a'
const GREEN = '#1f6a42'
const RED = '#7a2e2e'
const CLOSE = ' × '
const PER_ROW = 4
const MAX_ROWS = 3
// The width a chip needs to show its model (with a close button on a finished one) beside a short name.
const MODEL_FITS = 28

// Terminal cells a string takes: CJK letters take two.
const cells = (text: string): number => [...text].reduce((n, c) => n + ((c.codePointAt(0) ?? 0) > 0x2e7f ? 2 : 1), 0)

// Cut `text` to `width` cells (ending in …), then centre it in exactly `width` cells.
const fit = (text: string, width: number): string => {
  let out = ''
  let used = 0

  if (cells(text) > width) {
    for (const c of text) {
      if (used + cells(c) > width - 1) {
        break
      }

      out += c
      used += cells(c)
    }

    out += '…'
    used += 1
  } else {
    out = text
    used = cells(text)
  }

  const left = Math.floor((width - used) / 2)

  return ' '.repeat(left) + out + ' '.repeat(width - used - left)
}

// `text` cut after `n` cells: [the part that fits, the rest].
const split = (text: string, n: number): [string, string] => {
  const chars = [...text]
  let used = 0
  let i = 0

  for (; i < chars.length; i += 1) {
    const w = cells(chars[i] as string)

    if (used + w > n) {
      break
    }

    used += w
  }

  return [chars.slice(0, i).join(''), chars.slice(i).join('')]
}

// claude-haiku-5-5-20260101 -> haiku 5.5, claude-sonnet-4-20250514 -> sonnet 4 (a date is no minor version); an alias
// stays as given. Adapted from plan-progress (MIT, Copyright (c) 2026 Kirill Serditov).
const modelName = (m: string): string => {
  const r = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?!\d)/.exec(m)

  return r ? `${r[1]} ${r[2]}${r[3] ? `.${r[3]}` : ''}` : m
}

type Chip = {
  id: string
  // The model it runs on, as `$.agent.list()` names it; empty when none is known.
  model: string
  // True while it waits on someone (a decision), not while it works.
  isWaiting: boolean
  // How much of its context window the agent has used, 0 to 1: the fill of a running chip.
  ratio: number
  description: string
  startTime: number
  // Set once the agent has finished: the chip turns green (or red) and stays for the chosen seconds or until closed.
  endAt?: number
  isOk: boolean
}

// Agents seen running, so a finished one still has its name and start time.
const seen = new Map<string, Chip>()
// Finished agents kept on screen.
const finished = new Map<string, Chip>()
// Finished agents the person closed: never drawn again.
const dismissed = new Set<string>()
// Ids whose SubagentStop fired in the last 2s: their status may still read `running` for a moment.
const stopped = new Set<string>()
let timer: Timer | undefined
// Agents that waited at the last sync: a decision sound plays for one that starts to.
let waiting = new Set<string>()
// How far the summary fill has got, in cells: it glides toward its target a frame at a time.
let head = 0
// Running agents at the last sync, and the ids already announced: a sound plays when the last one ends.
let lastActive = 0

async function running($: EngineInterface): Promise<Chip[]> {
  const agents = (await $.agent.list()).filter(a => a.hasRow && !stopped.has(a.id) && live(a.status))

  for (const a of agents) {
    const ratio = a.contextWindowSize ? Math.min(1, a.tokenCount / a.contextWindowSize) : 0

    seen.set(a.id, {
      id: a.id,
      ratio,
      model: a.model ?? '',
      isWaiting: a.status === 'waiting',
      description: a.description,
      startTime: a.startTime,
      isOk: true,
    })
    // An agent that came back to work after a stop leaves the finished list.
    finished.delete(a.id)
  }

  return agents.map(a => seen.get(a.id) as Chip)
}

// Move every agent that was running and no longer is into `finished`; drop the expired and the closed.
async function settle($: EngineInterface): Promise<Chip[]> {
  const now = await $.clock.now()
  const active = await running($)
  const activeIds = new Set(active.map(a => a.id))
  const all = await $.agent.list()

  for (const [id, chip] of seen) {
    if (activeIds.has(id) || finished.has(id) || dismissed.has(id)) {
      continue
    }

    const info = all.find(a => a.id === id)
    const isOk = info === undefined || (info.taskStatus !== 'failed' && info.taskStatus !== 'killed')
    finished.set(id, { ...chip, endAt: now, isOk })
  }

  for (const [id, chip] of finished) {
    if (dismissed.has(id) || now - (chip.endAt ?? now) > prefs.keepMs) {
      finished.delete(id)
      seen.delete(id)
    }
  }

  return active
}

// Redraw four times a second while any chip shows: the elapsed times and the animation move.
async function sync($: EngineInterface): Promise<void> {
  const active = await settle($)

  // The last running agent just ended: one soft sound, the error one if any of the finished failed.
  if (prefs.isSoundOn && lastActive > 0 && active.length === 0 && finished.size > 0) {
    const name = [...finished.values()].some(c => !c.isOk) ? 'error' : 'done'

    void $.audio.play({ asset: `sounds/${name}.wav` }).catch(() => undefined)
  }

  lastActive = active.length

  // An agent that starts to wait on someone: the decision sound, once for each time it begins to.
  const nowWaiting = new Set(active.filter(c => c.isWaiting).map(c => c.id))

  if (prefs.isSoundOn && [...nowWaiting].some(id => !waiting.has(id))) {
    void $.audio.play({ asset: 'sounds/decision.wav' }).catch(() => undefined)
  }

  waiting = nowWaiting

  if (active.length > 0 || finished.size > 0) {
    timer ??= $.clock.every(FRAME_MS, () => {
      void settle($).then(() => $.ui.invalidate('ui.render'))
    })
  } else if (timer !== undefined) {
    timer.cancel()
    timer = undefined
  }

  $.ui.invalidate('ui.render')
}

export const register: Register = (on, options) => {
  loadPrefs(options)

  on('session.start', async ($, e, next) => {
    await loadThemeSetting($)
    await startSettings($)

    return next(e)
  })

  // A new theme repaints the row at once.
  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const out = await next(e)

    if (out.deny === undefined) {
      setThemeSetting(String(out.value))
      $.ui.invalidate('ui.render')
    }

    return out
  })

  on('classic.SubagentStart', async ($, e, next) => {
    stopped.delete(e.agent_id)
    dismissed.delete(e.agent_id)
    const out = await next(e)
    await sync($)

    return out
  })

  on('classic.SubagentStop', async ($, e, next) => {
    stopped.add(e.agent_id)
    // An agent that stopped to wait on a background shell comes back: forget the stop soon.
    $.clock.after(2000, () => {
      stopped.delete(e.agent_id)
      void sync($)
    })
    const out = await next(e)
    await sync($)

    return out
  })

  // Fold every chip (running, then finished) into the first row that exists: one line, one chip each.
  on('ui.render', { component: 'AgentRow' }, async ($, e, next) => {
    const active = await running($)
    const now = await $.clock.now()
    const done = [...finished.values()].filter(c => !dismissed.has(c.id) && now - (c.endAt ?? now) <= prefs.keepMs)
    const chips = [...active, ...done]
    const lead = chips.find(c => e.props.rowIds.includes(c.id))

    if (lead === undefined) {
      return next(e)
    }

    if (e.props.id !== lead.id) {
      return next({ ...e, props: { ...e.props, isHidden: true } })
    }

    await readTint($, now)

    const t = $.ui.resolve(e)
    const { Box, Text, Button } = t
    const Raster = 'Raster' in t ? t.Raster : null
    const frame = Math.floor(now / FRAME_MS)
    // Chips sit left, one cell apart. Each takes an equal share of the row but never more than half of it.
    // The row's own pointer and margin sit outside `columns`; keep 6 cells spare so it never wraps.
    const row = (e.props.columns ?? 80) - 6
    // The summary pill leads the row, as plan-progress's bar does: state, count, percent; its fill is the share of agents done.
    // Raster cells hold one-column characters only, so its words are ASCII.
    const doneCount = done.length
    const isAllDone = active.length === 0
    const pct = isAllDone ? 100 : Math.round((doneCount / chips.length) * 100)
    const label = isAllDone
      ? `✓ Done ${doneCount}/${chips.length}  100%`
      : `● ${doneCount}/${chips.length}  ${String(pct)}%`
    const summaryW = Math.max(24, label.length + 6)
    const target = (isAllDone ? 1 : doneCount / chips.length) * summaryW

    head = isAllDone || Math.abs(target - head) < 0.05 ? target : head + (target - head) * 0.35

    const [filledText, restText] = split(fit(label, summaryW), Math.round(target))
    const summary =
      Raster === null ? (
        <Box>
          {filledText === '' ? null : <Text backgroundColor={GREEN}>{filledText}</Text>}
          {restText === '' ? null : <Text backgroundColor={EMPTY}>{restText}</Text>}
        </Box>
      ) : (
        <Raster
          key="summary"
          columns={summaryW}
          rows={1}
          cells={trackCells({ width: summaryW, head, label, isDone: isAllDone, now, isTwinkling: prefs.isTwinkling })}
        />
      )
    // Up to PER_ROW chips a line, then the next line; past MAX_ROWS lines the rest fold into one "+N more".
    // Each chip takes an equal share of its line but never more than half of the row.
    const widthFor = (room: number, n: number): number =>
      Math.max(8, Math.min(Math.floor(row / 2), Math.floor((room - (n - 1)) / n)))
    const needed = prefs.isModelShown ? MODEL_FITS : 18
    const capped = chips.slice(0, PER_ROW * MAX_ROWS)
    const hidden = chips.length - capped.length
    const grid: Chip[][] = []

    for (let i = 0; i < capped.length; i += PER_ROW) {
      grid.push(capped.slice(i, i + PER_ROW))
    }

    // The summary pill shares the first line with its chips while they are still wide enough to show the model;
    // otherwise it takes a line of its own.
    const inlineW = widthFor(row - summaryW - 1, grid[0]?.length ?? 1)
    const isInline = inlineW >= needed
    const lines: Array<{ chips: Chip[]; width: number; hasSummary: boolean }> = isInline
      ? grid.map((r, i) => ({ chips: r, width: i === 0 ? inlineW : widthFor(row, r.length), hasSummary: i === 0 }))
      : [
          { chips: [], width: 0, hasSummary: true },
          ...grid.map(r => ({ chips: r, width: widthFor(row, r.length), hasSummary: false })),
        ]

    // Pass `isHidden: false` down the chain: a finished agent's row may arrive hidden.
    await next({ ...e, props: { ...e.props, isHidden: false } })

    const chipNode = (c: Chip, i: number, width: number, hasGap: boolean) => {
          const gap = hasGap ? <Text> </Text> : null

          // Raster chips, the plan-progress way. A Raster is not pressable, so a chip does not open its agent here.
          if (Raster !== null) {
            const state = c.endAt === undefined ? (c.isWaiting ? 'waiting' : 'running') : c.isOk ? 'done' : 'failed'
            const room = c.endAt === undefined ? width : width - cells(CLOSE)

            return (
              <Box key={c.id}>
                {gap}
                <Raster
                  key={`chip-${c.id}`}
                  columns={room}
                  rows={1}
                  cells={chipCells({
                    width: room,
                    name: c.description,
                    model: prefs.isModelShown ? modelName(c.model) : '',
                    time: clock((c.endAt ?? now) - c.startTime),
                    state,
                    ratio: c.ratio,
                    frame: frame + i,
                    now,
                    isTwinkling: prefs.isTwinkling,
                  })}
                />
                {c.endAt === undefined ? null : (
                  <Button
                    plain
                    key={`${c.id}:close`}
                    onPress={() => {
                      dismissed.add(c.id)
                      finished.delete(c.id)
                      seen.delete(c.id)
                      void sync($)
                    }}
                  >
                    <Text backgroundColor={hexOf(chipTint(state))}>{CLOSE}</Text>
                  </Button>
                )}
              </Box>
            )
          }

          if (c.endAt === undefined) {
            // The fill follows the context window used: the purple part is what is spent, the dark part what is left.
            const text = fit(`${SPIN[(frame + i) % SPIN.length]} ${c.description}  ${clock(now - c.startTime)}`, width)
            const filled = c.ratio > 0 ? Math.max(1, Math.round(width * c.ratio)) : 0
            const [spent, left] = split(text, filled)

            return (
              <Box key={c.id}>
                {gap}
                <Button plain key={c.id} onPress={() => void $.ui.view({ agentId: c.id })}>
                  {spent === '' ? null : <Text backgroundColor={PULSE[(frame + i) % PULSE.length]}>{spent}</Text>}
                  <Text backgroundColor={EMPTY}>{left}</Text>
                </Button>
              </Box>
            )
          }

          const color = c.isOk ? GREEN : RED
          const mark = c.isOk ? '✓' : '✗'

          return (
            <Box key={c.id}>
              {gap}
              <Button plain key={`${c.id}:view`} onPress={() => void $.ui.view({ agentId: c.id })}>
                <Text backgroundColor={color}>
                  {fit(`${mark} ${c.description}  ${clock(c.endAt - c.startTime)}`, width - cells(CLOSE))}
                </Text>
              </Button>
              <Button
                plain
                key={`${c.id}:close`}
                onPress={() => {
                  dismissed.add(c.id)
                  finished.delete(c.id)
                  seen.delete(c.id)
                  void sync($)
                }}
              >
                <Text backgroundColor={color}>{CLOSE}</Text>
              </Button>
            </Box>
          )
    }

    return (
      <Box flexDirection="column">
        {lines.map((ln, li) => {
          const isLast = li === lines.length - 1

          return (
            <Box key={`line-${String(li)}`}>
              {ln.hasSummary ? summary : null}
              {ln.chips.map((c, i) => chipNode(c, chips.indexOf(c), ln.width, ln.hasSummary || i > 0))}
              {isLast && hidden > 0 ? <Text dimColor> +{hidden} more</Text> : null}
            </Box>
          )
        })}
      </Box>
    )
  })
}
