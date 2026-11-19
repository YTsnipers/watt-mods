import { expect, test } from 'claude-code/testing'

const ROW = {
  plugin: 'turn-clock',
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
