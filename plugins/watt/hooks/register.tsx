import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Durations } from '../types'
import { register as registerAgents } from './agents'
import {
  answerPlan,
  chimed,
  closeQuestion,
  openQuestion,
  planApproved,
  play,
  register as registerBars,
  turnFinished,
  turnStarted,
  waitingIds,
} from './bars'
import { register as registerSettings } from './settings'
import { recordTurn, register as registerTurnline } from './turnline'

const durations = atom({ plugin: 'watt', key: 'durations' } as const, {} as Durations)

const KEEP = 400
// A main-loop turn at least this long ends with a sound: the person has likely looked away and now takes over.
const HANDOFF_MS = 30_000

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

// waitMs: the part of the turn spent waiting on the person's answer, which the 30s of HANDOFF_MS leaves out.
const turn = { modelMs: 0, calls: 0, spans: [] as Span[], waitMs: 0 }

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
  registerBars(on, options)
  registerTurnline(on, options)

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      turn.modelMs = 0
      turn.calls = 0
      turn.spans = []
      turn.waitMs = 0
    }

    // the bars' side never costs the turn its own bookkeeping
    await turnStarted($, e.agentId === undefined).catch(() => undefined)

    return next(e)
  })

  // Claude stops mid-turn to ask the person (a question, a plan to approve): the decision sound at once, and the one
  // sound of that moment: a bar Claude already set waiting through plan_progress chimed when it turned, so it is not
  // played again. A subagent's question goes to Claude, not to the person.
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    if (e.agentId !== undefined) {
      return next(e)
    }

    // the bar side: the bar set waiting is the one asked about, else the latest at work turns amber
    const question = await openQuestion($).catch(() => ({ asked: [], live: undefined }))

    if (question.asked.length === 0) {
      play($, 'decision')
    }

    const askedAt = await $.clock.now()

    try {
      return await next(e)
    } finally {
      turn.waitMs += (await $.clock.now()) - askedAt
      await closeQuestion($, question).catch(() => undefined)
      // the person answered: a chime before this was about the question, and the work after it ends with its own sound
      chimed.inTurn = false
    }
  })

  on('tool.call', { tool: 'ExitPlanMode' }, async ($, e, next) => {
    if (e.agentId !== undefined) {
      return next(e)
    }

    const asked = await waitingIds($).catch(() => [])

    if (asked.length === 0) {
      play($, 'decision')
    }

    const askedAt = await $.clock.now()
    let ran: Awaited<ReturnType<typeof next>>

    try {
      ran = await next(e)
    } finally {
      turn.waitMs += (await $.clock.now()) - askedAt
      await answerPlan($, asked).catch(() => undefined)
      chimed.inTurn = false
    }

    if (ran.deny !== undefined || ran.isError === true) {
      return ran
    }

    // the approved plan lands on the bar `plan`; Claude is told which bar holds it
    const note = await planApproved($, (ran.result as { plan?: unknown } | undefined)?.plan).catch(() => undefined)

    return note === undefined ? ran : { ...ran, context: [...(ran.context ?? []), note] }
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
    // the bars first: one that finishes with the turn may chime, and the turn's own sound then stays quiet
    await turnFinished($, e.agentId).catch(() => undefined)

    const out = await next(e)

    if (e.agentId !== undefined) {
      return out
    }

    // Done when it answered, error when an API error or a refusal ended it; an interrupt is the person already there.
    // A bar that chimed (done, error, a question at the end) during this turn already told the person: one sound.
    const sound = e.reason === 'answer' ? 'done' : e.reason === 'aborted' ? undefined : 'error'

    if (sound !== undefined && !chimed.inTurn && e.durationMs - turn.waitMs >= HANDOFF_MS) {
      play($, sound)
    }

    chimed.inTurn = false

    const noun = turn.calls === 1 ? 'tool call' : 'tool calls'
    const u = e.usage
    const prompt = u ? u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens : 0
    const cache = u && prompt > 0 ? `, cache hit ${Math.round((u.cache_read_input_tokens / prompt) * 100)}%` : ''

    const { context, rateLimits } = await $.session.usage()
    // the summary is drawn under the duration line with the numbers coloured (turnline.tsx), not handed back as the
    // turn's text: that line is the engine's to draw and takes no colour. Context is of the model's own window, 200k or 1M
    await recordTurn($, {
      durationMs: e.durationMs,
      summary: `This turn: ${turn.calls} ${noun}, model ${seconds(turn.modelMs)}, tools ${seconds(unionMs(turn.spans))}${cache}`,
      context: context.tokens === undefined || !context.window ? undefined : (context.tokens / context.window) * 100,
      usage: rateLimits.find(r => r.kind === 'five_hour')?.percentUsed,
    })

    return out
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
