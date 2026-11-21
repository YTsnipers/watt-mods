// The turn's context and usage, drawn after the engine's duration line (`✻ Baked for 3s`): the turn line beneath the
// answer is a text the engine draws itself, which no hook can colour, so the two numbers live here instead. Each turns
// orange, then red, at its own marks; below them it stays dim. The engine's line is kept as handed down (another plugin
// may have coloured it), the numbers only follow it.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TurnStat } from '../types'
import { STATE_COLOR } from './plan'

type Marks = { orange: number; red: number }

// a share at or past its mark takes its colour: context of the model window, usage of the five-hour limit
export const MARKS: { context: Marks; usage: Marks } = { context: { orange: 25, red: 35 }, usage: { orange: 60, red: 80 } }

// the progress bars' own orange (at work) and red (failed)
const ORANGE = STATE_COLOR.running
const RED = STATE_COLOR.error
const KEEP = 400
// the duration line's time and turn.complete's may differ a little: within this they are the same turn
const MATCH_MS = 2_000

const turnStats = atom({ plugin: 'watt', key: 'turnStats' } as const, [] as TurnStat[])

export const tintOf = (value: number, marks: Marks): string | undefined =>
  value >= marks.red ? RED : value >= marks.orange ? ORANGE : undefined

// called from the main loop's turn.complete, which already read the session's usage
export async function recordTurn($: EngineInterface, stat: TurnStat): Promise<void> {
  if (stat.context === undefined && stat.usage === undefined) return
  await update($, turnStats, list => [...list, stat].slice(-KEEP))
}

function nearest(list: readonly TurnStat[], ms: number): TurnStat | undefined {
  let best: TurnStat | undefined
  for (const s of list) {
    const gap = Math.abs(s.durationMs - ms)
    if (gap <= MATCH_MS && (!best || gap < Math.abs(best.durationMs - ms))) best = s
  }
  return best
}

export const register: Register = on => {
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    // a line drawn while background agents run gets its numbers too: a plugin above may draw it as a duration anyway
    const hit = nearest(await read($, turnStats), e.props.durationMs)
    const row = await next(e)

    if (!hit) return row

    const { Box, Text } = $.ui.resolve(e)
    const part = (label: string, value: number | undefined, digits: number, marks: Marks) => {
      if (value === undefined) return null
      const color = tintOf(value, marks)
      const text = `${label} ${value.toFixed(digits)}%`

      return (
        <Text>
          <Text dimColor> · </Text>
          {color ? <Text color={color}>{text}</Text> : <Text dimColor>{text}</Text>}
        </Text>
      )
    }

    return (
      <Box>
        {row}
        {part('context', hit.context, 1, MARKS.context)}
        {part('usage', hit.usage, 0, MARKS.usage)}
      </Box>
    )
  })
}
