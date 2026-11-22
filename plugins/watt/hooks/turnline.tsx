// The turn's summary line, drawn under the engine's duration line (`✻ Baked for 3s`) with its context and usage: the
// text turn.complete hands back is drawn by the engine itself and no hook can colour it, so watt draws the line here
// instead. Each number turns orange, then red, at its own marks; below them it stays dim. The engine's duration line is
// kept as handed down (another plugin may have coloured it).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TurnStat } from '../types'
import { STATE_COLOR } from './plan'

type Marks = { orange: number; red: number }

// a share at or past its mark takes its colour: context of the model window, usage of the five-hour and seven-day limits
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

    // a turn recorded before the summary moved here keeps its numbers on the duration line
    if (hit.summary === undefined) {
      return (
        <Box>
          {row}
          {part('context', hit.context, 1, MARKS.context)}
          {part('usage', hit.usage, 0, MARKS.usage)}
          {part('7d usage', hit.usage7d, 0, MARKS.usage)}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {row}
        <Text> </Text>
        <Text>
          <Text dimColor>{`● watt: ${hit.summary}`}</Text>
          {part('context', hit.context, 1, MARKS.context)}
          {part('usage', hit.usage, 0, MARKS.usage)}
          {part('7d usage', hit.usage7d, 0, MARKS.usage)}
        </Text>
      </Box>
    )
  })
}
