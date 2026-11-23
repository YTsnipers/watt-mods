import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, Register, Timer } from 'claude-code'

import type { AgentChip as Chip, AgentRowState } from '../types'

import { play, startBars } from './bars'
import { loadPrefs, prefs } from './prefs'
import { type ChipState, chipCells, chipTint, columnsOf, hexOf, trackCells } from './raster'
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
// A chip's least width: glyph, a short name, the model ("haiku 5.5"), the time and a close button. Without the model it
// can be narrower.
const minChip = (): number => (prefs.isModelShown ? 28 : 18)

const cells = columnsOf

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

// The chips and the sound bookkeeping live in `$.state`: a reload of the mod keeps them, and the row, which reads them
// while drawing, redraws on each write without an invalidate.
const agents = atom({ plugin: 'watt', key: 'agents' } as const, { chips: [], closed: [], waiting: [], batch: [], lastActive: 0 } as AgentRowState, { shape: 'agents-2' })
// Bumped each frame while a chip shows: the row reads it, so the times, the spinner and the glide move with a redraw of
// the row alone.
const agentFrame = atom({ plugin: 'watt', key: 'agentFrame' } as const, 0)
// The settings window's choices (settings.tsx writes them), read while drawing so a changed choice redraws the row. A
// reference is read in the file that names it, so it is named here too.
const choices = { plugin: 'watt', key: 'choices' } as const

// Ids whose SubagentStop fired in the last 2s: their status may still read `running` for a moment.
const stopped = new Set<string>()
// The frame clock, running while a chip shows.
let frames: Timer | undefined
// How far the summary fill has got, in cells: it glides toward its target a redraw at a time.
let head = 0

const isOkTask = (taskStatus: string): boolean => taskStatus !== 'failed' && taskStatus !== 'killed'

// a finished chip stays on screen for the chosen seconds after it ended
const isKept = (c: Chip, now: number): boolean => now - (c.endAt ?? now) <= prefs.keepMs

const stateOf = (c: Chip): ChipState => (c.endAt === undefined ? (c.isWaiting ? 'waiting' : 'running') : c.isOk ? 'done' : 'failed')

type Sound = 'done' | 'error' | 'decision'

// The row one sync later: running agents refreshed, the ones no longer running finished (unless closed), the expired
// dropped, and the sounds the change calls for. It writes nothing, so `update` may run it again on a version miss.
function advance(prev: AgentRowState, all: readonly AgentInfo[], now: number): { state: AgentRowState; sounds: Sound[] } {
  const active = all.filter(a => a.hasRow && !stopped.has(a.id) && live(a.status))
  const activeIds = new Set(active.map(a => a.id))
  const byId = new Map(prev.chips.map(c => [c.id, c]))

  for (const a of active) {
    byId.set(a.id, {
      id: a.id,
      ratio: a.contextWindowSize ? Math.min(1, a.tokenCount / a.contextWindowSize) : 0,
      model: a.model ?? '',
      isWaiting: a.status === 'waiting',
      description: a.description,
      startTime: a.startTime,
      isOk: true,
    })
  }

  const chips: Chip[] = []

  for (const c of byId.values()) {
    if (activeIds.has(c.id)) {
      chips.push(c)
      continue
    }

    // A task can read killed or failed a moment after its stop: a finished chip follows it while the list still has it.
    const info = all.find(a => a.id === c.id)
    const isOk = info === undefined ? c.isOk : isOkTask(info.taskStatus)
    const chip = { ...c, endAt: c.endAt ?? now, isOk }

    if (!prev.closed.includes(c.id) && isKept(chip, now)) chips.push(chip)
  }

  const sounds: Sound[] = []
  const batch = new Set([...prev.batch, ...activeIds])
  const finished = chips.filter(c => c.endAt !== undefined)

  // The last running agent just ended: one soft sound, the error one if any that ran with it failed.
  if (prev.lastActive > 0 && active.length === 0 && finished.length > 0) {
    sounds.push(finished.some(c => batch.has(c.id) && !c.isOk) ? 'error' : 'done')
  }

  // An agent that starts to wait on someone: the decision sound, once for each time it begins to.
  const waiting = active.filter(a => a.status === 'waiting').map(a => a.id)

  if (waiting.some(id => !prev.waiting.includes(id))) sounds.push('decision')

  return {
    state: { chips, closed: prev.closed, waiting, batch: active.length === 0 ? [] : [...batch], lastActive: active.length },
    sounds,
  }
}

// A sync in flight, and whether a call came while it ran: one more pass follows then, so two passes never overlap and
// `lastActive` never goes back to an older count (which would play the end sound twice).
let syncing: Promise<void> | undefined
let isSyncAgain = false

function sync($: EngineInterface): Promise<void> {
  if (syncing !== undefined) {
    isSyncAgain = true

    return syncing
  }

  syncing = (async () => {
    try {
      do {
        isSyncAgain = false
        await syncOnce($)
      } while (isSyncAgain)
    } finally {
      syncing = undefined
    }
  })()

  return syncing
}

// The close button of a finished chip: it leaves the row, and the same agent ending again later draws no chip.
function close($: EngineInterface, id: string): void {
  void update($, agents, s => ({ ...s, chips: s.chips.filter(c => c.id !== id), closed: [...s.closed, id] }))
}

// Read the agents again (one stopped by TaskStop, or one that died, fires no SubagentStop, and a teammate no
// SubagentStart), write the row only when it changed, and run the frame clock while a chip shows.
async function syncOnce($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const all = await $.agent.list()
  const prev = await read($, agents)
  const { state, sounds } = advance(prev, all, now)

  if (JSON.stringify(state) !== JSON.stringify(prev)) {
    await update($, agents, cur => advance(cur, all, now).state)
  }

  for (const s of sounds) play($, s)

  if (state.chips.length > 0) {
    frames ??= $.clock.every(FRAME_MS, () => {
      void sync($)
        .then(() => update($, agentFrame, n => n + 1))
        .catch(() => undefined)
    })
  } else {
    frames?.cancel()
    frames = undefined
  }
}

export const register: Register = (on, options) => {
  loadPrefs(options)

  on('session.start', async ($, e, next) => {
    await loadThemeSetting($)
    await startSettings($)
    await startBars($)
    // A slow look at the agents while no chip shows: a teammate's row comes with no SubagentStart, and a reload keeps
    // the chips in `$.state` but not the clock that moves them.
    await sync($)
    $.clock.every(1000, () => {
      if (frames === undefined) void sync($).catch(() => undefined)
    })

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
    await update($, agents, s => ({ ...s, closed: s.closed.filter(id => id !== e.agent_id) }))
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
    // Reading these subscribes the row: a sync that changed it, a frame and a changed choice redraw it.
    const { chips: all } = await read($, agents)
    await read($, agentFrame)
    await read($, choices)
    const now = await $.clock.now()
    const active = all.filter(c => c.endAt === undefined)
    const done = all.filter(c => c.endAt !== undefined && isKept(c, now))
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
    // Chips sit left, one cell apart. Each takes an equal share of the row but never more than half of it. The width is
    // the row's as the surface measured it (a narrow window or a large font gives fewer columns), else the viewport's.
    // The row's own pointer and margin sit outside it; keep 6 cells spare so it never wraps.
    const row = Math.max(1, (e.props.columns ?? e.viewport?.columns ?? 80) - 6)
    // The summary pill leads the row, as plan-progress's bar does: state, count, percent; its fill is the share of agents done.
    // Raster cells hold one-column characters only, so its words are ASCII.
    const doneCount = done.length
    const isAllDone = active.length === 0
    const pct = isAllDone ? 100 : Math.round((doneCount / chips.length) * 100)
    const label = isAllDone
      ? `✓ Done ${doneCount}/${chips.length}  100%`
      : `● ${doneCount}/${chips.length}  ${String(pct)}%`
    const summaryW = Math.min(row, Math.max(24, cells(label) + 6))
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
    // Chips are at least minChip() wide; past what fits, the rest fold into one "+N more" (unfinished ones first). Too
    // narrow for one, the summary stands alone: its count says how many there are.
    const total = row - summaryW - 1
    const fits = (room: number): number => Math.max(0, Math.floor((room + 1) / (minChip() + 1)))
    const moreW = chips.length > fits(total) ? cells(` +${chips.length} more`) : 0
    const shown = chips.slice(0, fits(total - moreW))
    const hidden = chips.length - shown.length
    const share = Math.floor((total - (hidden > 0 ? moreW : 0) - (shown.length - 1)) / Math.max(1, shown.length))
    const width = Math.min(Math.floor(row / 2), share)
    const roomOf = (c: Chip): number => (c.endAt === undefined ? width : width - cells(CLOSE))

    // Pass `isHidden: false` down the chain: a finished agent's row may arrive hidden.
    await next({ ...e, props: { ...e.props, isHidden: false } })

    return (
      <Box>
        {summary}
        {shown.map((c, i) => {
          const gap = <Text> </Text>

          // Raster chips, the plan-progress way. A Raster is not pressable, so a chip does not open its agent here.
          if (Raster !== null) {
            const state = stateOf(c)
            const room = roomOf(c)

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
                    onPress={() => close($, c.id)}
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
                onPress={() => close($, c.id)}
              >
                <Text backgroundColor={color}>{CLOSE}</Text>
              </Button>
            </Box>
          )
        })}
        {hidden > 0 && shown.length > 0 ? <Text dimColor> +{hidden} more</Text> : null}
      </Box>
    )
  })
}
