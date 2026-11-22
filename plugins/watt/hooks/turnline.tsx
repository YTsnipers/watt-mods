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
    const tinted = (text: string, value: number, marks: Marks) => {
      const color = tintOf(value, marks)

      return color ? <Text color={color}>{text}</Text> : <Text dimColor>{text}</Text>
    }
    // the five-hour and seven-day shares under one label: `usage 5h 54%/7d 92%`, each coloured at its own value
    const windows = [
      hit.usage === undefined ? null : tinted(`5h ${hit.usage.toFixed(0)}%`, hit.usage, MARKS.usage),
      hit.usage7d === undefined ? null : tinted(`7d ${hit.usage7d.toFixed(0)}%`, hit.usage7d, MARKS.usage),
    ].filter(w => w !== null)
    const numbers = (
      <Text>
        {hit.context === undefined ? null : (
          <Text>
            <Text dimColor> · </Text>
            {tinted(`ctx ${hit.context.toFixed(1)}%`, hit.context, MARKS.context)}
          </Text>
        )}
        {windows.length === 0 ? null : (
          <Text>
            <Text dimColor> · usage </Text>
            {windows[0]}
            {windows.length > 1 ? <Text dimColor>/</Text> : null}
            {windows[1] ?? null}
          </Text>
        )}
      </Text>
    )

    // a turn recorded before the summary moved here keeps its numbers on the duration line
    if (hit.summary === undefined) {
      return (
        <Box>
          {row}
          {numbers}
        </Box>
      )
    }

    // one row: the numbers keep their width and a narrow terminal cuts the summary before them
    return (
      <Box flexDirection="column">
        {row}
        <Text> </Text>
        <Box>
          <Box flexShrink={1}>
            <Text dimColor wrap="truncate-end">{`● watt: ${hit.summary}`}</Text>
          </Box>
          <Box flexShrink={0}>{numbers}</Box>
        </Box>
      </Box>
    )
  })
}
