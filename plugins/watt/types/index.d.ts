export type Durations = Record<string, number>

export type Choices = { twinkle: boolean; sounds: boolean; showModel: boolean; keepSeconds: number }

// The progress bars (ported from plan-progress, MIT, Kirill Serditov).
export type StepStatus = 'pending' | 'active' | 'done' | 'error' | 'skipped'
export type PlanSubstep = { title: string; status: StepStatus }
// doneAt: when the step was finished, so a checkpoint can tell how long it took
export type PlanStep = { title: string; status: StepStatus; substeps: PlanSubstep[]; doneAt?: number }
export type PlanStage = { name: string; steps: PlanStep[] }
export type PlanState = 'running' | 'needs_input' | 'error' | 'done'
export type Plan = {
  id: string
  title: string
  kind: 'plan' | 'todo'
  stages: PlanStage[]
  state: PlanState
  note: string | null
  startedAt: number
  // when the plan was finished; the pill then shows the time it took
  endedAt?: number | null
  // the subagent that made the bar and moves it; the main loop's gate and reminders leave such a bar alone
  byAgent?: string
}

declare module 'claude-code' {
  interface PluginState {
    'watt': {
      durations: Durations
      choices: Choices
      plans: Plan[]
      isOpen: boolean
      // bumped for a timed redraw: a glide drawn once more standing
      tick: number
    }
  }
}
