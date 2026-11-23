import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Choices } from '../types'
import { DONE_CHOICES, KEEP_CHOICES, prefs, snapshot } from './prefs'

const PANE = 'watt-settings'

// The choices as the drawings read them: this window and the agent row. A drawing that reads them redraws when one
// changes, so changing one needs no invalidate.
const shown = atom({ plugin: 'watt', key: 'choices' } as const, {
  twinkle: true,
  sounds: true,
  showModel: true,
  keepSeconds: 20,
  autoclose: false,
  doneBarSeconds: 30,
} as Choices)

type Field = keyof Choices

// Changes one choice here, in the plugin's options (so /config and the next session agree) and on screen.
async function choose($: EngineInterface, field: Field, value: boolean | number): Promise<void> {
  if (field === 'twinkle') prefs.isTwinkling = value === true
  if (field === 'sounds') prefs.isSoundOn = value === true
  if (field === 'showModel') prefs.isModelShown = value === true
  if (field === 'keepSeconds') prefs.keepMs = Number(value) * 1000
  if (field === 'autoclose') prefs.isAutoClose = value === true
  if (field === 'doneBarSeconds') prefs.doneBarMs = Number(value) * 1000

  await $.config.set({ key: `watt.${field}`, value }).catch(() => undefined)
  // the settings window and the agent row read `shown`: this write redraws them
  await update($, shown, () => snapshot())
}

// Run from the plugin's one `session.start` hook (a module may hook an event without a matcher only once).
export async function startSettings($: EngineInterface): Promise<void> {
  await $.command.register({ name: 'watt-settings', description: 'Open the settings of watt: twinkle, sounds, model, how long finished agents and progress bars stay' })
  await update($, shown, () => snapshot())
}

export const register: Register = on => {
  on('command.run', { command: 'watt-settings' }, async $ => {
    await $.ui.open({ id: PANE, title: 'watt settings' })

    return { text: 'watt settings opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const c = await read($, shown)
    const next = KEEP_CHOICES[(KEEP_CHOICES.indexOf(c.keepSeconds) + 1) % KEEP_CHOICES.length] ?? 20
    const nextDone = DONE_CHOICES[(DONE_CHOICES.indexOf(c.doneBarSeconds) + 1) % DONE_CHOICES.length] ?? 30
    const mark = (isOn: boolean): string => (isOn ? '[x]' : '[ ]')

    return (
      <Box flexDirection="column">
        <Text dimColor>What you see of subagents (chips under the prompt), the progress bars above it, and the sounds.</Text>
        <Button key="twinkle" plain onPress={() => choose($, 'twinkle', !c.twinkle)}>
          {mark(c.twinkle)} Twinkle the pixel fill
        </Button>
        <Button key="sounds" plain onPress={() => choose($, 'sounds', !c.sounds)}>
          {mark(c.sounds)} Sounds: done, error, decision
        </Button>
        <Button key="showModel" plain onPress={() => choose($, 'showModel', !c.showModel)}>
          {mark(c.showModel)} Show the model on each chip
        </Button>
        <Button key="keepSeconds" plain onPress={() => choose($, 'keepSeconds', next)}>
          Finished agents stay: {c.keepSeconds} s (press for {next} s)
        </Button>
        <Button key="autoclose" plain onPress={() => choose($, 'autoclose', !c.autoclose)}>
          {mark(c.autoclose)} Close finished progress bars on their own
        </Button>
        <Button key="doneBarSeconds" plain onPress={() => choose($, 'doneBarSeconds', nextDone)}>
          Finished progress bars stay: {c.doneBarSeconds} s (press for {nextDone} s)
        </Button>
      </Box>
    )
  })
}
