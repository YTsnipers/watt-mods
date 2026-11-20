import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Durations } from '../types'
import { register as registerAgents } from './agents'
import { register as registerSettings } from './settings'

const durations = atom({ plugin: 'watt', key: 'durations' } as const, {} as Durations)

const KEEP = 400
const CONTEXT_WINDOW = 1_000_000

type Span = [start: number, end: number]

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`

const unionMs = (spans: Span[]): number => {
  const sorted = [...spans].sort((a, b) => a[0] - b[0])
  let total = 0
  let from = 0
  let to = 0

  for (const [start, end] of sorted) {
    if (start > to) {
      total += to - from
      from = start
      to = end
    } else if (end > to) {
      to = end
    }
  }

  return total + (to - from)
}

const turn = { modelMs: 0, calls: 0, spans: [] as Span[] }

async function record(
  $: EngineInterface,
  id: string,
  ms: number | undefined,
  isMain: boolean,
): Promise<void> {
  if (ms === undefined) {
    return
  }

  if (isMain) {
    const endedAt = await $.clock.now()
    turn.calls += 1
    turn.spans.push([endedAt - ms, endedAt])
  }

  await update($, durations, all => {
    const merged: Durations = { ...all, [id]: ms }
    const keys = Object.keys(merged)

    for (const key of keys.slice(0, Math.max(0, keys.length - KEEP))) {
      delete merged[key]
    }

    return merged
  })
}

export const register: Register = (on, options) => {
  registerAgents(on, options)
  registerSettings(on, options)

  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) {
      turn.modelMs = 0
      turn.calls = 0
      turn.spans = []
    }

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) {
      yield* next(e)

      return
    }

    const startedAt = await $.clock.now()

    try {
      yield* next(e)
    } finally {
      turn.modelMs += (await $.clock.now()) - startedAt
    }
  })

  on('classic.PostToolUse', async ($, e, next) => {
    await record($, e.tool_use_id, e.duration_ms, e.agent_id === undefined)

    return next(e)
  })

  on('classic.PostToolUseFailure', async ($, e, next) => {
    await record($, e.tool_use_id, e.duration_ms, e.agent_id === undefined)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const out = await next(e)

    if (e.agentId !== undefined) {
      return out
    }

    const noun = turn.calls === 1 ? 'tool call' : 'tool calls'
    const u = e.usage
    const prompt = u ? u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens : 0
    const cache = u && prompt > 0 ? `, cache hit ${Math.round((u.cache_read_input_tokens / prompt) * 100)}%` : ''

    const { context, rateLimits } = await $.session.usage()
    const ctx = context.tokens === undefined ? '' : `, context ${((context.tokens / CONTEXT_WINDOW) * 100).toFixed(1)}%`
    const fiveHour = rateLimits.find(r => r.kind === 'five_hour')
    const usage = fiveHour ? `, usage ${fiveHour.percentUsed}%` : ''

    return {
      ...out,
      text: `This turn: ${turn.calls} ${noun}, model ${seconds(turn.modelMs)}, tools ${seconds(unionMs(turn.spans))}${cache}${ctx}${usage}`,
    }
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.props.isRunning) {
      return next(e)
    }

    const ms = (await read($, durations))[e.props.tool_use_id]

    if (ms === undefined) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box>
        {await next(e)}
        <Text dimColor> took {seconds(ms)}</Text>
      </Box>
    )
  })
}
