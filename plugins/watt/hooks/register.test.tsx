import { expect, test } from 'claude-code/testing'

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
  on('classic.SubagentStart', () => ({}))
  on('classic.SubagentStop', () => ({}))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine row</Text>
  })

  const running = await $.ui.mount(AGENT_ROW('running') as never)

  expect((await running.find({ type: 'Text', text: /sandbox probe/ }))?.text).toMatch(/5s/)
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

  expect((await done.find({ type: 'Text', text: /✓/ }))?.text).toMatch(/✓ sandbox probe\s+30s/)
  expect(await done.find({ type: 'Text', text: /×/ })).toBeDefined()
  await done.unmount()

  now = 1_030_000 + 121_000
  const gone = await $.ui.mount(AGENT_ROW('completed') as never)

  expect(await gone.find({ type: 'Text', text: /✓/ })).toBeUndefined()
  await gone.unmount()
})
