import { expect, test } from 'claude-code/testing'

import { chipCells, contrast, trackCells } from './raster'
import { isLight, setThemeSetting } from './tint'

const ROW = {
  plugin: 'watt',
  component: 'ToolUse',
  requestId: 'call-1',
  props: {
    tool_use_id: 'call-1',
    tool: 'Bash',
    input: { command: 'ls' },
    isRunning: false,
    isErrored: false,
    isInterrupted: false,
  },
} as const

test('a finished call shows how long it took', async ($, on) => {
  on('state.get', () => ({ value: { value: { 'call-1': 1234 }, version: 1 } }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine row</Text>
  })

  const ui = await $.ui.mount({ ...ROW, surface: 'terminal' })

  expect((await ui.find({ type: 'Text', text: /took/ }))?.text).toBe(' took 1.2s')
  await ui.unmount()
})

test('a running call shows no duration', async ($, on) => {
  on('state.get', () => ({ value: { value: { 'call-1': 1234 }, version: 1 } }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine row</Text>
  })

  const ui = await $.ui.mount({
    ...ROW,
    props: { ...ROW.props, isRunning: true },
    surface: 'terminal',
  })

  expect(await ui.find({ type: 'Text', text: /took/ })).toBeUndefined()
  await ui.unmount()
})

// The characters a Raster's cells hold, its Braille dots left out.
const rasterText = (cells: string): string => {
  const words = new Uint32Array(Uint8Array.from(atob(cells), c => c.charCodeAt(0)).buffer)
  let out = ''

  for (let i = 0; i < words.length; i += 3) {
    const cp = words[i] ?? 32

    out += cp >= 0x2800 && cp <= 0x28ff ? ' ' : String.fromCodePoint(cp)
  }

  return out.replace(/\s+/g, ' ').trim()
}

const agent = (status: 'running' | 'completed') => ({
  id: 'a1',
  description: 'sandbox probe',
  type: 'general-purpose',
  status,
  kind: 'local_agent',
  taskStatus: status,
  label: 'sandbox probe',
  startTime: 1_000_000,
  cwd: '/',
  tokenCount: 0,
  tokenSamples: [],
  hasRow: true,
})

const AGENT_ROW = (status: 'running' | 'completed') => ({
  plugin: 'watt',
  component: 'AgentRow',
  requestId: 'a1',
  props: { ...agent(status), rowIds: ['a1'], columns: 80, isHidden: false },
  surface: 'terminal',
}) as const

test('a finished agent turns green, stays, and has a close button', async ($, on) => {
  let status: 'running' | 'completed' = 'running'
  let now = 1_005_000

  on('agent.list', () => ({ value: [agent(status)] as never }))
  on('clock.now', () => ({ value: now }))
  on('clock.after', () => ({ value: { cancel: () => {} } as never }))
  on('clock.every', () => ({ value: { cancel: () => {} } as never }))
  on('audio.play', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } as never }))
  on('classic.SubagentStart', () => ({}))
  on('classic.SubagentStop', () => ({}))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine row</Text>
  })

  const running = await $.ui.mount(AGENT_ROW('running') as never)

  const chip = rasterText(((await running.find({ key: 'chip-a1' }))?.props.cells ?? '') as string)

  expect(chip).toMatch(/● sandbox probe\s+5s/)
  const bar = await running.find({ type: 'Raster' })

  expect(rasterText(bar?.props.cells as string)).toBe('● 0/1 0%')
  // One chip takes at most half of the row (80 columns less 6 spare).
  expect(chip.length).toBeLessThanOrEqual(37)
  await running.unmount()

  status = 'completed'
  now = 1_030_000
  await $.classic.SubagentStop({
    agent_id: 'a1',
    agent_type: 'general-purpose',
    stop_hook_active: false,
    agent_transcript_path: '/dev/null',
  })

  const done = await $.ui.mount(AGENT_ROW('completed') as never)

  expect(rasterText((await done.find({ type: 'Raster' }))?.props.cells as string)).toBe('✓ Done 1/1 100%')
  expect(rasterText(((await done.find({ key: 'chip-a1' }))?.props.cells ?? '') as string)).toMatch(/✓ sandbox probe\s+30s/)
  expect(await done.find({ type: 'Text', text: /×/ })).toBeDefined()
  await done.unmount()

  now = 1_030_000 + 21_000
  const gone = await $.ui.mount(AGENT_ROW('completed') as never)

  expect(await gone.find({ type: 'Raster' })).toBeUndefined()
  await gone.unmount()
})

test('the terminal is light when the theme says so', () => {
  setThemeSetting('light')
  expect(isLight()).toBe(true)

  setThemeSetting('dark-ansi')
  expect(isLight()).toBe(false)

  setThemeSetting('light-daltonized')
  expect(isLight()).toBe(true)

  setThemeSetting('dark')
})

// Every printed character of a Raster, as [fg, bg] RGB pairs; Braille dots and blanks are decoration.
const printed = (cells: string): Array<[number[], number[]]> => {
  const words = new Uint32Array(Uint8Array.from(atob(cells), c => c.charCodeAt(0)).buffer)
  const rgb = (v: number): number[] => [(v >> 16) & 255, (v >> 8) & 255, v & 255]
  const out: Array<[number[], number[]]> = []

  for (let i = 0; i < words.length; i += 3) {
    const cp = words[i] ?? 32

    if (cp > 0x20 && (cp < 0x2800 || cp > 0x28ff)) {
      out.push([rgb(words[i + 1] ?? 0), rgb(words[i + 2] ?? 0)])
    }
  }

  return out
}

test('every word on a chip and on the summary reads at AA, on a dark and a light terminal', () => {
  const states = ['running', 'waiting', 'done', 'failed'] as const

  for (const theme of ['dark', 'light']) {
    setThemeSetting(theme)

    for (const state of states) {
      const chip = chipCells({
        width: 40,
        name: 'probe alpha',
        model: 'haiku 5.5',
        time: '12s',
        state,
        ratio: 0.4,
        frame: 3,
        now: 1_000_000,
        isTwinkling: true,
      })

      // The check holds only if there is text to check: name, model, time and the glyph.
      expect(printed(chip).length).toBeGreaterThan(15)

      for (const [fg, bg] of printed(chip)) {
        expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5)
      }
    }

    for (const isDone of [false, true]) {
      const bar = trackCells({ width: 30, head: 12, label: isDone ? '✓ Done 3/3  100%' : '● 1/3  33%', isDone, now: 1_000_000, isTwinkling: true })

      for (const [fg, bg] of printed(bar)) {
        expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5)
      }
    }
  }

  setThemeSetting('dark')
})

test('past what fits, the chips fold into +N more', async ($, on) => {
  const many = Array.from({ length: 12 }, (_, n) => ({ ...agent('running'), id: `m${n}`, description: `probe ${n}` }))

  on('agent.list', () => ({ value: many as never }))
  on('clock.now', () => ({ value: 1_005_000 }))
  on('clock.every', () => ({ value: { cancel: () => {} } as never }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } as never }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine row</Text>
  })

  const ui = await $.ui.mount({
    ...AGENT_ROW('running'),
    requestId: 'm0',
    props: { ...AGENT_ROW('running').props, id: 'm0', rowIds: many.map(a => a.id) },
  } as never)

  expect((await ui.find({ type: 'Text', text: /more/ }))?.text).toMatch(/\+\d+ more/)
  await ui.unmount()
})

const SETTINGS = {
  plugin: 'watt',
  component: 'Pane',
  requestId: 'watt-settings',
  surface: 'terminal',
  props: {
    title: 'watt settings',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('the settings window lists four choices and a press changes one', async ($, on) => {
  const set: Array<{ key: string; value: unknown }> = []

  on('config.set', (_, e) => {
    set.push({ key: e.key, value: e.value })

    return { value: e.value }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  const ui = await $.ui.mount(SETTINGS as never)

  expect(await ui.findAll({ type: 'Button' })).toHaveLength(4)
  expect((await ui.find({ key: 'sounds' }))?.text).toMatch(/\[x\] Sounds/)

  await ui.press({ key: 'sounds' })

  // The mod runs apart from the test, so what it did shows in what it asked of the engine.
  expect(set).toEqual([{ key: 'watt.sounds', value: false }])
  expect((await ui.find({ key: 'sounds' }))?.text).toMatch(/\[ \] Sounds/)
  await ui.unmount()
})

test('a chip shows its model while the name is cut to make room, and drops it only when it is too narrow', () => {
  const at = (width: number): string =>
    rasterText(
      chipCells({ width, name: 'a long probe name', model: 'haiku 5.5', time: '12s', state: 'running', ratio: 0, frame: 0, now: 1_000_000, isTwinkling: false }),
    )

  expect(at(28)).toMatch(/● a long\.\. +haiku 5\.5 +12s/)
  expect(at(40)).toContain('haiku 5.5')
  expect(at(16)).not.toContain('haiku')
})

const ended = (reason: 'answer' | 'aborted' | 'error', durationMs: number, agentId?: string) =>
  ({ answer: '', durationMs, isAborted: reason === 'aborted', turnId: 't1', reason, ...(agentId ? { agentId } : {}) }) as never

const hearTurns = (on: Parameters<Parameters<typeof test>[1]>[1]): string[] => {
  const played: string[] = []

  on('audio.play', (_, e) => {
    if ('asset' in e.clip && e.clip.asset) played.push(e.clip.asset)

    return { value: undefined }
  })
  on('session.usage', () => ({ value: { context: {}, rateLimits: [] } as never }))
  on('turn.complete', () => ({ text: '' }))

  return played
}

test('a main turn of 30s or more ends with done, or error when it died; an interrupt, a short turn and a subagent stay quiet', async ($, on) => {
  const played = hearTurns(on)

  await $.turn.complete(ended('answer', 31_000))
  await $.turn.complete(ended('error', 45_000))
  await $.turn.complete(ended('aborted', 60_000))
  await $.turn.complete(ended('answer', 29_000))
  await $.turn.complete(ended('answer', 90_000, 'a1'))

  expect(played).toEqual(['sounds/done.wav', 'sounds/error.wav'])
})

test('with sounds off, a long turn ends quietly', { options: { sounds: false } }, async ($, on) => {
  const played = hearTurns(on)

  await $.turn.complete(ended('answer', 31_000))

  expect(played).toEqual([])
})

test('Claude asking mid-turn plays the decision sound at once; a subagent asking does not', async ($, on) => {
  const played = hearTurns(on)

  on('clock.now', () => ({ value: 0 }))
  on('tool.call', () => ({ result: {} }))

  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  await $.tool.call({ tool: 'ExitPlanMode' } as never)
  await $.tool.call({ tool: 'AskUserQuestion', questions: [], agentId: 'a1' } as never)

  expect(played).toEqual(['sounds/decision.wav', 'sounds/decision.wav'])
})

test('the time spent waiting on an answer does not count toward the 30s', async ($, on) => {
  const played = hearTurns(on)
  let now = 0

  on('clock.now', () => ({ value: now }))
  on('tool.call', () => {
    now += 60_000

    return { result: {} }
  })

  on('turn.start', (_, e) => ({ turnId: e.turnId }))

  await $.turn.start({ turnId: 't1' } as never)
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  // 70s in all, 60s of it the person answering: 10s of work, no sound at the end.
  await $.turn.complete(ended('answer', 70_000))

  expect(played).toEqual(['sounds/decision.wav'])
})
