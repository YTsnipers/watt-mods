import type { EngineInterface, Register, Timer } from 'claude-code'

const live = (status: string): boolean => status === 'running' || status === 'waiting' || status === 'pending'

const clock = (ms: number): string => {
  const s = Math.floor(ms / 1000)

  return s >= 60 ? `${Math.floor(s / 60)}m${s % 60}s` : `${s}s`
}

const FRAME_MS = 250
const KEEP_MS = 120_000
const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
const PULSE = ['#3a2f6b', '#4a3d86', '#5a4aa3', '#4a3d86']
const GREEN = '#1f6a42'
const RED = '#7a2e2e'
const CLOSE = ' × '

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

type Chip = {
  id: string
  description: string
  startTime: number
  // Set once the agent has finished: the chip turns green (or red) and stays KEEP_MS or until closed.
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

async function running($: EngineInterface): Promise<Chip[]> {
  const agents = (await $.agent.list()).filter(a => a.hasRow && !stopped.has(a.id) && live(a.status))

  for (const a of agents) {
    seen.set(a.id, { id: a.id, description: a.description, startTime: a.startTime, isOk: true })
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
    if (dismissed.has(id) || now - (chip.endAt ?? now) > KEEP_MS) {
      finished.delete(id)
      seen.delete(id)
    }
  }

  return active
}

// Redraw four times a second while any chip shows: the elapsed times and the animation move.
async function sync($: EngineInterface): Promise<void> {
  const active = await settle($)

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

export const register: Register = on => {
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
    const done = [...finished.values()].filter(c => !dismissed.has(c.id) && now - (c.endAt ?? now) <= KEEP_MS)
    const chips = [...active, ...done]
    const lead = chips.find(c => e.props.rowIds.includes(c.id))

    if (lead === undefined) {
      return next(e)
    }

    if (e.props.id !== lead.id) {
      return next({ ...e, props: { ...e.props, isHidden: true } })
    }

    const { Box, Text, Button } = $.ui.resolve(e)
    const frame = Math.floor(now / FRAME_MS)
    // The chips share the row's width equally, one cell between them.
    // The row's own pointer and margin sit outside `columns`; keep 6 cells spare so it never wraps.
    const total = (e.props.columns ?? 80) - 6
    const width = Math.max(8, Math.floor((total - (chips.length - 1)) / chips.length))

    // Pass `isHidden: false` down the chain: a finished agent's row may arrive hidden.
    await next({ ...e, props: { ...e.props, isHidden: false } })

    return (
      <Box>
        {chips.map((c, i) => {
          const gap = i > 0 ? <Text> </Text> : null

          if (c.endAt === undefined) {
            return (
              <Box key={c.id}>
                {gap}
                <Button plain key={c.id} onPress={() => void $.ui.view({ agentId: c.id })}>
                  <Text backgroundColor={PULSE[(frame + i) % PULSE.length]}>
                    {fit(`${SPIN[(frame + i) % SPIN.length]} ${c.description}  ${clock(now - c.startTime)}`, width)}
                  </Text>
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
        })}
      </Box>
    )
  })
}
