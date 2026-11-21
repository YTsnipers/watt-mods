// The progress bars through the engine: the tool, the chimes, the gate, the question at the end of a turn.
// What a bar is shows in what the band above the prompt draws, which is what these tests read.
import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { TOOL } from './plan'

const DONE = 'sounds/done.wav'
const ERROR = 'sounds/error.wav'
const DECISION = 'sounds/decision.wav'

// The engine beneath the plugin: a clock that stands still, and every sound it was asked to play, in order. `ran` is
// what the engine's own tool answers (the hooks beneath the plugin are registered once, before the first call on $).
function world(
  on: On,
  ran: () => unknown | Promise<unknown> = () => ({}),
  submitted: (context: readonly string[] | undefined) => void = () => undefined,
): { played: string[]; clock: ReturnType<typeof mock.clock> } {
  const played: string[] = []
  const clock = mock.clock(on, { now: 1_000 })

  on('audio.play', (_, e) => {
    if ('asset' in e.clip && e.clip.asset) played.push(e.clip.asset)

    return { value: undefined }
  })
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } as never }))
  on('session.usage', () => ({ value: { context: {}, rateLimits: [] } as never }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', async () => ({ result: (await ran()) as never }))
  on('classic.Stop', () => ({}))
  on('prompt.submit', (_, e) => {
    submitted(e.context)

    return { text: e.text }
  })
  on('prompt.compose', () => ({ sections: [] }))

  return { played, clock }
}

const BAND = {
  plugin: 'watt',
  component: 'AbovePrompt',
  requestId: 'band',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

type Ui = Awaited<ReturnType<Engine['ui']['mount']>>

// What each bar shows on the terminal, top to bottom: its glyph, title and percent, then its note when it has one.
async function bars($: Engine): Promise<string[]> {
  const ui = (await $.ui.mount({ ...BAND, surface: 'terminal' } as never)) as Ui
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text.trim())
  await ui.unmount()

  const out: string[] = []

  // a bar is its glyph, its title, its percent, and a note when it is not running: the glyph starts the next one
  for (let i = 0; i < texts.length; i += 1) {
    if (!/^[●?!✓]$/.test(texts[i] ?? '')) {
      continue
    }

    const next = texts.findIndex((t, j) => j > i && /^[●?!✓]$/.test(t))
    const group = texts.slice(i, next < 0 ? texts.length : next)

    out.push(`${group[0]} ${group[1]} ${group[2]}${group[3] ? ` — ${group[3]}` : ''}`)
  }

  return out
}

const create = ($: Engine, id: string, extra: Record<string, unknown> = {}) =>
  $.tool.call({
    tool: TOOL,
    id,
    title: id,
    stages: [
      { name: 'Analyse', steps: ['Read code', 'Find bug'] },
      { name: 'Fix', steps: ['Patch', 'Test'] },
    ],
    ...extra,
  } as never)

const step = ($: Engine, id: string, ops: Record<string, unknown>) =>
  $.tool.call({ tool: TOOL, id, ...ops } as never)

test('plan_progress creates a bar with its first step active, and the bar shows above the prompt', async ($, on) => {
  const { played } = world(on)
  const made = await create($, 'create-bar')

  expect(made.result).toBe('create-bar: 0/4, running, active "Read code"')
  expect(await bars($)).toEqual(['● create-bar 0%'])
  // a bar that starts says nothing aloud
  expect(played).toEqual([])
})

test('next finishes the active step and moves the bar along', async ($, on) => {
  const { played } = world(on)

  await create($, 'next-bar')

  expect((await step($, 'next-bar', { next: true })).result).toBe('next-bar: 1/4, running, active "Find bug"')
  expect((await step($, 'next-bar', { next: true })).result).toBe('next-bar: 2/4, running, active "Patch"')
  expect(await bars($)).toEqual(['● next-bar 50%'])
  expect(played).toEqual([])
})

test('a title the bar does not have is refused with its steps; an unknown bar is refused too', async ($, on) => {
  world(on)
  await create($, 'refuse-bar')

  const refused = await step($, 'refuse-bar', { done: ['Nope'] })

  expect(refused.deny).toContain('has no step "Nope". Its steps: Read code, Find bug, Patch, Test')
  expect((await step($, 'no-such-bar', { next: true })).deny).toContain('no bar "no-such-bar" yet')
})

test('finishing the last step chimes done once, and saying done again does not chime again', async ($, on) => {
  const { played } = world(on)

  await create($, 'done-bar')
  await step($, 'done-bar', { done: ['Read code', 'Find bug', 'Patch'] })
  expect(played).toEqual([])

  expect((await step($, 'done-bar', { next: true })).result).toBe('done-bar: 4/4, done')
  expect(played).toEqual([DONE])
  expect(await bars($)).toEqual(['✓ done-bar 100%'])

  await step($, 'done-bar', { state: 'done' })
  expect(played).toEqual([DONE])
})

test('a bar that fails chimes error once', async ($, on) => {
  const { played } = world(on)

  await create($, 'error-bar')

  expect((await step($, 'error-bar', { failed: 'Find bug', note: 'tests red' })).result).toBe('error-bar: 0/4, error, active "Read code"')
  expect(played).toEqual([ERROR])
  expect(await bars($)).toEqual(['! error-bar 0% — tests red'])
})

test('Claude setting needs_input before asking chimes once; AskUserQuestion then adds no second sound', async ($, on) => {
  const { played } = world(on)

  await create($, 'ask-bar')
  await step($, 'ask-bar', { state: 'needs_input', note: 'which branch?' })
  expect(played).toEqual([DECISION])
  expect(await bars($)).toEqual(['? ask-bar 0% — which branch?'])

  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)

  // the bar Claude set waiting is the one asked about: still one decision sound, and the answer sends it back to work
  expect(played).toEqual([DECISION])
  expect(await bars($)).toEqual(['● ask-bar 0%'])
})

test('AskUserQuestion with no bar waiting turns the bar at work amber for the question, with one decision sound, then back', async ($, on) => {
  const seen: string[][] = []
  // the question is open while the engine's own hook runs: look at the band then
  const { played } = world(on, async () => {
    seen.push(await bars($))

    return {}
  })

  await create($, 'live-bar')
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)

  expect(seen).toEqual([['? live-bar 0%']])
  expect(played).toEqual([DECISION])
  expect(await bars($)).toEqual(['● live-bar 0%'])
})

test('a subagent working a bar of its own stays quiet; its question does not turn a bar', async ($, on) => {
  const { played } = world(on)

  await $.tool.call({ tool: TOOL, id: 'agent-bar', title: 'Agent job', stages: [{ name: 'A', steps: ['x'] }], agentId: 'a1' } as never)
  await $.tool.call({ tool: TOOL, id: 'agent-bar', state: 'done', agentId: 'a1' } as never)
  await $.tool.call({ tool: 'AskUserQuestion', questions: [], agentId: 'a1' } as never)

  expect(played).toEqual([])
  expect(await bars($)).toEqual(['✓ Agent job 100%'])
})

test('the turn-end sound is skipped when a bar chimed during that turn, and played when none did', async ($, on) => {
  const { played } = world(on)
  const ended = (durationMs: number) => ({ answer: '', durationMs, isAborted: false, turnId: 't1', reason: 'answer' as const })

  // no bar: a 45 s turn ends with its own done sound
  await $.turn.start({ turnId: 't1' } as never)
  await $.turn.complete(ended(45_000) as never)
  expect(played).toEqual([DONE])

  // a bar finishes in the next turn: its chime is the one sound
  played.length = 0
  await $.turn.start({ turnId: 't2' } as never)
  await create($, 'turn-bar')
  await step($, 'turn-bar', { state: 'done' })
  await $.turn.complete(ended(45_000) as never)
  expect(played).toEqual([DONE])

  // the turn after that has no chime of its own to skip: its end sound plays again
  played.length = 0
  await $.turn.start({ turnId: 't3' } as never)
  await $.turn.complete(ended(45_000) as never)
  expect(played).toEqual([DONE])
})

test('a bar set waiting chimes for the question; once the person answers, the work after it ends with its own sound', async ($, on) => {
  const { played } = world(on)

  await $.turn.start({ turnId: 't1' } as never)
  await create($, 'answer-bar')
  await step($, 'answer-bar', { state: 'needs_input', note: 'which branch?' })
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  await $.turn.complete({ answer: '', durationMs: 45_000, isAborted: false, turnId: 't1', reason: 'answer' } as never)

  expect(played).toEqual([DECISION, DONE])
})

test('a plan the person approves lands on the bar `plan`; Claude is told, and one decision sound plays', async ($, on) => {
  const { played } = world(on, () => ({ plan: '# Fix login\n\n## Analyse\n- Read code\n- Find bug\n## Fix\n- Patch\n- Test' }))
  const out = await $.tool.call({ tool: 'ExitPlanMode' } as never)

  expect(played).toEqual([DECISION])
  expect(out.context).toEqual(['plan-progress: bar "plan" shows this plan; move it with {id:"plan", next:true} as steps finish.'])
  expect(await bars($)).toEqual(['● Fix login 0%'])

  expect((await step($, 'plan', { next: true })).result).toBe('plan: 1/4, running, active "Find bug"')
})

const ended = (durationMs: number) => ({ answer: '', durationMs, isAborted: false, turnId: 't1', reason: 'answer' as const }) as never
const stop = ($: Engine, text: string, isActive = false) =>
  $.classic.Stop({ stop_hook_active: isActive, last_assistant_message: text } as never)

test('the Stop gate sends a turn back once while its bar is open, and lets it go when the bar is done', async ($, on) => {
  world(on)
  await $.turn.start({ turnId: 'g1' } as never)
  await create($, 'stop-bar')

  const blocked = await stop($, 'Finished the patch.')

  expect(blocked.block).toBe(
    `plan-progress: stop-bar still open. Update each with ${TOOL}: {id, next:true}, or state "done", "needs_input" or "error" with a note.`,
  )
  // the turn sent back is not sent back again
  expect((await stop($, 'Finished the patch.', true)).block).toBeUndefined()

  await step($, 'stop-bar', { state: 'done' })
  expect((await stop($, 'Finished the patch.')).block).toBeUndefined()
})

test('a turn with no work and no bar update is not sent back', async ($, on) => {
  world(on)
  await $.turn.start({ turnId: 'g2' } as never)
  // a bar left open by an earlier turn
  await create($, 'old-bar')
  await $.turn.start({ turnId: 'g3' } as never)

  expect((await stop($, 'Nothing to do here.')).block).toBeUndefined()
})

test('a question at the end of the last message turns the open bar to needs_input with one chime, and the turn-end sound stays quiet', async ($, on) => {
  const { played } = world(on)

  await $.turn.start({ turnId: 'q1' } as never)
  await create($, 'question-bar')

  // the ？ of Chinese and Japanese counts, with a quote or a bracket after it
  const out = await stop($, '要用哪個分支？」')

  expect(out.block).toBeUndefined()
  expect(await bars($)).toEqual(['? question-bar 0%'])
  expect(played).toEqual([DECISION])

  await $.turn.complete(ended(45_000))
  expect(played).toEqual([DECISION])
})

test('a question while a bar Claude already set waiting is open adds no second chime and turns no second bar', async ($, on) => {
  const { played } = world(on)

  await $.turn.start({ turnId: 'q2' } as never)
  await create($, 'first-bar')
  await create($, 'second-bar')
  await step($, 'first-bar', { state: 'needs_input', note: 'which?' })
  expect(played).toEqual([DECISION])

  await stop($, 'Which one do you prefer?')

  expect(played).toEqual([DECISION])
  expect(await bars($)).toEqual(['? first-bar 0% — which?', '● second-bar 0%'])
})

test('the fourth edit with no bar is refused once; with an open bar an edit is never refused, and a stale bar is reminded of', async ($, on) => {
  world(on)

  await $.turn.start({ turnId: 'e1' } as never)
  const edit = () => $.tool.call({ tool: 'Edit', file_path: '/work/a.ts', old_string: 'a', new_string: 'b' } as never)

  for (let i = 0; i < 3; i += 1) {
    expect((await edit()).deny).toBeUndefined()
  }

  expect((await edit()).deny).toBe(`plan-progress: several changes ahead. Create a bar with ${TOOL} first, then retry.`)
  // refused once: the retry goes through
  expect((await edit()).deny).toBeUndefined()

  await create($, 'edit-bar')

  for (let i = 0; i < 5; i += 1) {
    expect((await edit()).context).toBeUndefined()
  }

  expect((await edit()).context).toEqual(['plan-progress: edit-bar not updated for a while; send {id, next:true} or {id, done, active}.'])
})

test('a subagent edits freely: its calls are neither refused nor counted', async ($, on) => {
  world(on)
  await $.turn.start({ turnId: 'e2' } as never)

  for (let i = 0; i < 6; i += 1) {
    expect((await $.tool.call({ tool: 'Edit', file_path: '/work/a.ts', old_string: 'a', new_string: 'b', agentId: 'a1' } as never)).deny).toBeUndefined()
  }

  // the main loop's own count is still zero
  expect((await $.tool.call({ tool: 'Edit', file_path: '/work/b.ts', old_string: 'a', new_string: 'b' } as never)).deny).toBeUndefined()
})

test('a bar a subagent made is its own: the main loop\'s Stop is not held to it', async ($, on) => {
  world(on)
  await $.turn.start({ turnId: 'e3' } as never)
  await $.tool.call({ tool: TOOL, id: 'sub-bar', title: 'Sub job', stages: [{ name: 'A', steps: ['x', 'y'] }], agentId: 'a1' } as never)
  await create($, 'main-bar-done')
  await step($, 'main-bar-done', { state: 'done' })

  expect((await stop($, 'All finished.')).block).toBeUndefined()
})

test('the person answering a waiting bar sends it back to work, and the open bars ride along with the message', async ($, on) => {
  let context: readonly string[] | undefined
  world(on, () => ({}), c => {
    context = c
  })

  await create($, 'submit-bar')
  await step($, 'submit-bar', { state: 'needs_input', note: 'which?' })
  expect(await bars($)).toEqual(['? submit-bar 0% — which?'])

  await $.prompt.submit({ text: 'the second', origin: { kind: 'composer' } } as never)

  expect(await bars($)).toEqual(['● submit-bar 0%'])
  expect(context).toEqual(['plan-progress open bars: submit-bar (Analyse 1/2)'])
})

test('the rules name the tool as this plugin lists it', async ($, on) => {
  world(on)

  const out = await $.prompt.compose({ model: 'claude-sonnet-5-5', promptModel: 'claude-sonnet-5-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] })
  const rules = out.sections.find(s => s.id === 'watt:progress-rules')

  expect(rules?.text).toContain(`via ${TOOL}:`)
  expect(TOOL).toBe('mcp__watt__plan_progress')
  expect(rules?.text).not.toContain('plan-progress__')
})

test('/progress hides and shows the bars, /progress-clear removes them', async ($, on) => {
  world(on)

  expect((await $.command.run({ command: 'progress', args: '' } as never) as { text: string }).text).toContain('No plan yet')

  await create($, 'cmd-bar')
  expect(await bars($)).toEqual(['● cmd-bar 0%'])
  expect((await $.command.run({ command: 'progress', args: '' } as never) as { text: string }).text).toBe('Progress bars hidden.')
  expect(await bars($)).toEqual([])
  expect((await $.command.run({ command: 'progress', args: '' } as never) as { text: string }).text).toBe('Progress bars shown.')
  expect(await bars($)).toEqual(['● cmd-bar 0%'])

  expect((await $.command.run({ command: 'progress-clear', args: '' } as never) as { text: string }).text).toBe('Progress bars removed.')
  expect(await bars($)).toEqual([])
})

test('at most three bars stay, the finished ones leaving first', async ($, on) => {
  world(on)

  await create($, 'cap-a')
  await step($, 'cap-a', { state: 'done' })
  await create($, 'cap-b')
  await create($, 'cap-c')
  await create($, 'cap-d')

  expect(await bars($)).toEqual(['● cap-b 0%', '● cap-c 0%', '● cap-d 0%'])
})

test('the desktop draws each bar as a picture, with the stage on its pill', async ($, on) => {
  world(on)
  await create($, 'desk-bar')

  const ui = (await $.ui.mount({ ...BAND, surface: 'desktop' } as never)) as Ui
  const pictures = await ui.findAll({ type: 'Svg' })

  // the track, the pill's clock on hover and the hover layer with the checkpoint tips
  expect(pictures).toHaveLength(3)
  expect(String(pictures[0]?.props.source)).toContain('>Analyse<')
  expect(String(pictures[0]?.props.alt)).toBe('desk-bar: Analyse, step 1 of 2, 0%')
  await ui.unmount()
})

// A session that starts: the engine answers what the plugin asks at session.start, the store keeps what it saves.
function session(on: On, saved: Record<string, unknown> = {}): ReturnType<typeof world> & { store: Map<string, unknown> } {
  const heard = world(on)
  const store = new Map(Object.entries(saved))

  on('store.get', (_, e) => ({ value: store.get(e.key) as never }))
  on('store.set', (_, e) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))

    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    store.delete(e.key)

    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('session.id', () => ({ value: 's1' }))
  on('tool.register', () => ({ value: { tool: TOOL } as never }))
  on('command.register', () => ({ value: { command: 'x' } as never }))
  on('config.list', () => ({ value: [] }))

  return { ...heard, store }
}

const start = ($: Engine) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

test('bars are saved when the session ends and come back when it is reopened', async ($, on) => {
  const saved = {
    'plans:s1': [
      {
        id: 'saved-job',
        title: 'Saved job',
        kind: 'plan',
        stages: [{ name: 'A', steps: [{ title: 'x', status: 'done', substeps: [] }, { title: 'y', status: 'active', substeps: [] }] }],
        state: 'running',
        note: null,
        startedAt: 500,
        byAgent: 'gone-agent',
      },
    ],
  }

  const { store } = session(on, saved)
  await start($)

  // restored under the session's id, the half done bar where it was, and no longer a subagent's
  expect(await bars($)).toEqual(['● Saved job 50%'])

  await create($, 'second-job')
  await $.session.end({ sessionId: 's1', reason: 'clear' } as never)

  const kept = store.get('plans:s1') as Array<{ id: string; byAgent?: string }>

  expect(kept.map(p => p.id)).toEqual(['saved-job', 'second-job'])
  expect(kept[0]?.byAgent).toBeUndefined()
})

test('with closing on, a finished bar leaves after the seconds chosen; a failed bar or one waiting on you stays', { options: { autoclose: true, doneBarSeconds: 5 } }, async ($, on) => {
  const { clock } = session(on)

  await start($)
  await create($, 'close-done')
  await create($, 'close-error')
  await create($, 'close-wait')
  await step($, 'close-done', { state: 'done' })
  await step($, 'close-error', { failed: 'Find bug' })
  await step($, 'close-wait', { state: 'needs_input' })

  await clock.advance(4_000)
  expect((await bars($)).map(b => b.split(' ')[1])).toEqual(['close-done', 'close-error', 'close-wait'])

  await clock.advance(2_000)
  expect((await bars($)).map(b => b.split(' ')[1])).toEqual(['close-error', 'close-wait'])
})

test('with closing off, a finished bar stays until it is closed', async ($, on) => {
  const { clock } = session(on)

  await start($)
  await create($, 'stay-done')
  await step($, 'stay-done', { state: 'done' })
  await clock.advance(600_000)

  expect(await bars($)).toEqual(['✓ stay-done 100%'])
})

test('presenting a plan while a bar Claude set waiting is open adds no second chime, and a subagent\'s plan makes no bar', async ($, on) => {
  const { played } = world(on, () => ({ plan: '# Ship it\n## A\n- One\n- Two' }))

  await create($, 'plan-wait-bar')
  await step($, 'plan-wait-bar', { state: 'needs_input', note: 'approve?' })
  expect(played).toEqual([DECISION])

  await $.tool.call({ tool: 'ExitPlanMode' } as never)

  expect(played).toEqual([DECISION])
  // the waiting bar was answered (back to work), and the approved plan took its own bar
  expect(await bars($)).toEqual(['● plan-wait-bar 0%', '● Ship it 0%'])

  await $.tool.call({ tool: 'ExitPlanMode', agentId: 'a1' } as never)

  expect(played).toEqual([DECISION])
  expect((await bars($)).length).toBe(2)
})
