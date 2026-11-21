// Ported from plan-progress by Kirill Serditov, MIT (https://github.com/zycck/claude-mods). See NOTICE.
//
// The plan model: what a plan_progress call sends, how it becomes a bar (stages, steps, the short ops next / done /
// active / failed), what a plan approved in plan mode becomes, where a bar stands (pos, stage, step), and which bars
// a session keeps. Pure functions: nothing here calls the engine.

import type { Plan, PlanStage, PlanState, PlanStep, StepStatus } from '../types'

// the tool as the session lists it: mcp__<plugin>__<name>, the plugin being watt
export const TOOL: string = 'mcp__watt__plan_progress'
export const MAX_BARS = 3
// a space as wide as a digit, so '  0%' and '100%' take the same room
export const FIGURE_SPACE = String.fromCharCode(0x2007)

// watt's chip colours: Claude's orange while running, blue while waiting on the person, then red or green; the
// words on each are picked to read at 4.5:1 or better (draw.test.ts holds them to it)
export const STATE_COLOR: Record<PlanState, string> = { running: '#D97757', needs_input: '#608CE0', error: '#C5353E', done: '#18883A' }
export const INK = '#FFFFFF'
export const hex = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
export const rgb = (c: number[]) => `rgb(${c.join(',')})`
export const STATE_GLYPH: Record<PlanState, string> = { running: '●', needs_input: '?', error: '!', done: '✓' }
export const STATUSES: StepStatus[] = ['pending', 'active', 'done', 'error', 'skipped']

export const RULES = `# Progress bars
Tasks needing more than ~3 edits or commands get a bar via ${TOOL}: create it once with the full breakdown (2-7 stages of steps {title}, or kind "todo" for one flat list; titles of at most 4 words, in the user's language; the first open step becomes active), then move it with short calls: {id, next:true} when the active step is finished, or {id, done:[...], active:"..."}, {id, failed:"...", note}. When the plan changes, resend stages under the same id and title; steps sent without a status keep their done by title. Send state "needs_input" with a note before asking the user to decide. Never describe the bars to the user.`

export type Raw = Record<string, unknown>
// the cut drops half a character left at the edge (an emoji is two UTF-16 units). Control characters go first: an
// ESC or a C1 code would reach the terminal as a command (colour, cursor), and U+FFFE/U+FFFF are no text at all
export const str = (v: unknown, max = 120) =>
  typeof v === 'string'
    ? v
        .replace(/\s+/g, ' ')
        .replace(/[\u0000-\u001F\u007F-\u009F\uFFFE\uFFFF]/g, '')
        .trim()
        .slice(0, max)
        .replace(/[\uD800-\uDBFF]$/, '')
        .trimEnd()
    : ''
export const status = (v: unknown): StepStatus => (STATUSES.includes(v as StepStatus) ? (v as StepStatus) : 'pending')
export const list = (v: unknown): Raw[] => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : []) as Raw[]
export const isFinished = (s: StepStatus) => s === 'done' || s === 'skipped'

export const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

// short updates: {next:true}, {done:[titles]}, {active:title}, {failed:title} against the stored plan;
// titles it cannot find come back in missing, so the call is refused instead of passing as a success
export function applyOps(stages: PlanStage[], input: Raw, now: number): { stages: PlanStage[]; missing: string[] } {
  const next = stages.map(s => ({ ...s, steps: s.steps.map(st => ({ ...st })) }))
  const steps = next.flatMap(s => s.steps)
  const missing: string[] = []
  // a step finishing now remembers when, for the time its checkpoint shows
  const finish = (st: PlanStep) => {
    if (!isFinished(st.status)) Object.assign(st, { status: 'done', doneAt: now })
  }
  // a step opened again forgets when it was finished, so its checkpoint shows no stale time
  const reopen = (st: PlanStep, to: StepStatus) => {
    st.status = to
    delete st.doneAt
  }
  // a title used twice means the one still open
  const find = (title: string) => {
    const found = steps.find(st => same(st.title, title) && !isFinished(st.status)) ?? steps.find(st => same(st.title, title))
    if (!found) missing.push(title)
    return found
  }
  if (input.next === true) {
    const at = steps.findIndex(st => st.status === 'active') >= 0 ? steps.findIndex(st => st.status === 'active') : steps.findIndex(st => !isFinished(st.status))
    const cur = steps[at]
    if (cur) finish(cur)
    // past the last step, work goes back to one left open earlier; a call that names the new step itself picks it,
    // so a step jumped over is not finished on the way
    const following = steps.slice(at + 1).find(st => st.status === 'pending') ?? steps.find(st => st.status === 'pending')
    if (following && typeof input.active !== 'string') following.status = 'active'
  }
  let lastDone = -1
  for (const t of Array.isArray(input.done) ? input.done : []) {
    const st = typeof t === 'string' ? find(t) : undefined
    if (st?.status === 'active') lastDone = steps.indexOf(st)
    if (st) finish(st)
  }
  // finishing the step in progress moves on, as next does, unless the call names the new one itself
  if (lastDone >= 0 && typeof input.active !== 'string' && !steps.some(st => st.status === 'active')) {
    const following = steps.slice(lastDone + 1).find(st => st.status === 'pending') ?? steps.find(st => st.status === 'pending')
    if (following) following.status = 'active'
  }
  const active = typeof input.active === 'string' ? find(input.active) : undefined
  if (active) {
    const at = steps.indexOf(active)
    steps.forEach((st, i) => {
      if (st.status === 'active' && i !== at) {
        if (i < at) finish(st)
        else st.status = 'pending'
      }
    })
    reopen(active, 'active')
  }
  const failed = typeof input.failed === 'string' ? find(input.failed) : undefined
  if (failed) reopen(failed, 'error')

  return { stages: next, missing }
}

// steps may arrive as plain strings, a stage may call its name "title", and a flat list may come as top-level "steps"
export const asSteps = (v: unknown): Raw[] => (Array.isArray(v) ? v.map(x => (typeof x === 'string' ? { title: x } : x)).filter(x => x && typeof x === 'object') : []) as Raw[]

// the new bar, or the refusal for a call that names steps the bar does not have
export function normalize(input: Raw, prev: Plan | null, now: number, id: string): Plan | string {
  const sentStages = list(input.stages).length > 0 ? list(input.stages) : asSteps(input.steps).length > 0 ? [{ name: str(input.title, 80) || 'Tasks', steps: input.steps } as Raw] : []
  const sent = sentStages
    .map(s => ({
      name: str(s.name, 80) || str(s.title, 80) || 'Stage',
      steps: asSteps(s.steps).map(st => ({
        title: str(st.title) || 'Step',
        status: status(st.status),
        substeps: asSteps(st.substeps).map(sub => ({ title: str(sub.title) || '…', status: status(sub.status) })),
      })),
    }))
    .filter(s => s.steps.length > 0) as PlanStage[]
  const isPartial = sent.length === 0 && prev !== null
  // the next task under a finished bar's id carries nothing of the last one over; the same plan grown by a step does
  const was = prev && !isPartial && isNextTask(prev, str(input.title, 400), sent) ? null : prev
  // a resent plan keeps what was finished; short ops sent along with it apply on top
  const base = isPartial ? prev.stages : pointAt(was ? carryDone(sent, was.stages) : sent)
  const { stages, missing } = applyOps(base, input, now)
  if (missing.length > 0 && base.length > 0) {
    const titles = stages.flatMap(s => s.steps.map(st => st.title)).join(', ')
    return `plan_progress: "${id}" has no step ${missing.map(t => `"${str(t, 60)}"`).join(', ')}. Its steps: ${str(titles, 400)}`
  }
  const title = str(input.title, 80) || prev?.title || 'Plan'
  const steps = stages.flatMap(s => s.steps)
  const isAllDone = steps.length > 0 && steps.every(s => isFinished(s.status))
  const asked = input.state as PlanState
  const failedNow = typeof input.failed === 'string'
  const state: PlanState = ['running', 'needs_input', 'error', 'done'].includes(asked) ? asked : isAllDone ? 'done' : failedNow ? 'error' : 'running'

  return {
    id,
    title,
    kind: input.kind === 'todo' || (isPartial && prev?.kind === 'todo') ? 'todo' : 'plan',
    stages,
    state,
    note: str(input.note, 160) || null,
    startedAt: was ? was.startedAt : now,
    endedAt: state === 'done' ? (was?.endedAt ?? now) : null,
  }
}

// a whole plan sent to a finished bar: another task when it has another title or leaves out a step the last one
// finished. One that keeps the title and every finished step is the plan grown after it finished ("also commit it"),
// which the rules tell Claude to resend under the same id. The same plan sent again with no statuses (at most its
// first step active), bringing no step the bar did not have, is a new run of it ("deploy again", the plan approved a
// second time): carried over, it would be finished from the start, its time counting the first run and the gap. A
// later step sent active, or any sent done, is a redo of that step and carries over
export function isNextTask(prev: Plan, title: string, stages: PlanStage[]): boolean {
  if (prev.state !== 'done') return false
  // a title is stored cut at 80, and a plan-mode one without its markdown, links and list marker, cut after that: the
  // same title resent either way, with them or without, is still the same plan
  const sentAs = [str(title, 80), str(clean(title), 80)]
  const keptAs = [prev.title, clean(prev.title)]
  if (title && !sentAs.some(a => keptAs.some(b => same(a, b)))) return true
  const key = (st: PlanStep) => st.title.trim().toLowerCase()
  const steps = stages.flatMap(s => s.steps)
  const sent = new Set(steps.map(key))
  const finished = prev.stages.flatMap(s => s.steps).filter(st => isFinished(st.status))
  if (finished.length === 0 || finished.some(st => !sent.has(key(st)))) return true
  const left = new Map<string, number>()
  for (const st of prev.stages.flatMap(s => s.steps)) left.set(key(st), (left.get(key(st)) ?? 0) + 1)
  const isGrown = steps.some(st => {
    const n = left.get(key(st)) ?? 0
    left.set(key(st), n - 1)
    return n <= 0
  })
  return !isGrown && steps.length > 0 && steps.every((st, i) => st.status === 'pending' || (st.status === 'active' && i === 0))
}

// a resent plan keeps what is finished: a step sent as pending under a title that was done stays done
// a title used twice: each finished step carries over to one resent step of that title, in order
export function carryDone(stages: PlanStage[], before: PlanStage[]): PlanStage[] {
  const finished = new Map<string, PlanStep[]>()
  for (const st of before.flatMap(s => s.steps).filter(st => isFinished(st.status))) {
    const key = st.title.trim().toLowerCase()
    finished.set(key, [...(finished.get(key) ?? []), st])
  }
  return stages.map(s => ({
    ...s,
    steps: s.steps.map(st => {
      const queue = finished.get(st.title.trim().toLowerCase())
      const was = queue?.[0]
      if (!queue || !was || !(st.status === 'pending' || st.status === was.status)) return st
      queue.shift()
      return { ...st, status: was.status, doneAt: was.doneAt }
    }),
  }))
}

// with nothing in progress, the first open step is the current one
export function pointAt(stages: PlanStage[]): PlanStage[] {
  const steps = stages.flatMap(s => s.steps)
  if (steps.some(st => st.status === 'active' || st.status === 'error')) return stages
  const first = steps.find(st => st.status === 'pending')
  return stages.map(s => ({ ...s, steps: s.steps.map(st => (st === first ? { ...st, status: 'active' as const } : st)) }))
}

// the bar an approved plan-mode plan lands on; a revised plan updates it instead of opening a second one
export const PLAN_ID = 'plan'

export const clean = (s: string) =>
  s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/^\s*(\d+[.)]|[-*+]|\[[ xX]\])\s+/, '')
    .replace(/^(\d+[.)]|\[[ xX]\])\s+/, '')
    .trim()

export function parsePlan(markdown: string, now: number): Plan | null {
  let title = ''
  const headed: PlanStage[] = []
  const heads: { level: number; isNumbered: boolean }[] = []
  const items: { depth: number; text: string; status: StepStatus }[] = []
  let fence = ''
  for (const line of markdown.split(/\r?\n/)) {
    // a code block's shell comments and diff lines only look like headings and list items
    // a backtick run closed on its own line is inline code, not a fence (a backtick fence's info string has no backtick)
    const f = line.match(/^\s*(`{3,})([^`]*)$/) ?? line.match(/^\s*(~{3,})(.*)$/)
    const mark = f?.[1] ?? ''
    if (fence) {
      if (mark[0] === fence[0] && mark.length >= fence.length && !f?.[2]?.trim()) fence = ''
      continue
    }
    if (mark) {
      fence = mark
      continue
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      // capped as the tool caps them: a heading may become a step (120), the title 80, which isNextTask compares
      const text = str(clean(h[2] ?? ''))
      if (h[1] === '#' && !title) title = str(text, 80)
      else {
        headed.push({ name: text, steps: [] })
        heads.push({ level: (h[1] ?? '').length, isNumbered: /^(\d+[.):]|step\s+\d+[.):]?)\s/i.test(h[2] ?? '') })
      }
      continue
    }
    const li = line.match(/^(\s*)(\d+[.)]|[-*+])\s+(.*)$/)
    if (!li) continue
    const depth = Math.floor((li[1] ?? '').replace(/\t/g, '  ').length / 2)
    const text = str(clean(li[3] ?? ''))
    if (!text) continue
    // a ticked box is a step the plan already counts as done
    const status: StepStatus = /^\[[xX]\]\s/.test(li[3] ?? '') ? 'done' : 'pending'
    items.push({ depth, text, status })
    const stage = headed[headed.length - 1]
    if (!stage) continue
    const step = stage.steps[stage.steps.length - 1]
    if (depth === 0 || !step) stage.steps.push({ title: text, status, substeps: [] })
    else step.substeps.push({ title: text, status })
  }
  // steps written as numbered headings with prose under them ("### 1. Add X" under "## Implementation") have no list
  // and would be dropped as empty stages: when most of a section's numbered headings are such ones, they all become
  // that section's steps, their list items its substeps; deepest first, and a top level with no section gets "Steps".
  // Numbered sections that mostly carry lists ("1. Context" in prose, then "2. Changes" with a list) stay stages
  const folded = new Set<number>()
  const root: PlanStage = { name: 'Steps', steps: [] }
  let rootAt = -1
  for (let level = 4; level >= 1; level--) {
    for (let p = -1; p < headed.length; p++) {
      if (p >= 0 && (heads[p]?.level ?? 0) >= level) continue
      const kids: number[] = []
      for (let i = p + 1; i < headed.length && (heads[i]?.level ?? 0) >= level; i++) if (heads[i]?.level === level && heads[i]?.isNumbered && !folded.has(i)) kids.push(i)
      if (kids.filter(i => headed[i]?.steps.length === 0).length * 2 <= kids.length) continue
      if (p < 0 && rootAt < 0) rootAt = kids[0] ?? -1
      const into = headed[p] ?? root
      for (const i of kids) {
        const kid = headed[i]
        if (!kid) continue
        into.steps.push({ title: kid.name, status: 'pending', substeps: kid.steps.map(s => ({ title: s.title, status: s.status })) })
        folded.add(i)
      }
    }
  }
  let stages = headed.flatMap((s, i) => (i === rootAt ? [root] : folded.has(i) ? [] : [s])).filter(s => s.steps.length > 0)
  if (stages.length === 0) {
    if (items.some(i => i.depth > 0)) {
      for (const item of items) {
        const stage = stages[stages.length - 1]
        if (item.depth === 0 || !stage) stages.push({ name: item.text, steps: [] })
        else stage.steps.push({ title: item.text, status: item.status, substeps: [] })
      }
      stages = stages.map(s => (s.steps.length ? s : { ...s, steps: [{ title: s.name, status: 'pending', substeps: [] }] }))
    } else if (items.length > 0) {
      stages = [{ name: 'Tasks', steps: items.map(i => ({ title: i.text, status: i.status, substeps: [] })) }]
    }
  }
  if (stages.length === 0) return null

  return { id: PLAN_ID, title: title || 'Plan', kind: stages.length === 1 ? 'todo' : 'plan', stages, state: 'running', note: null, startedAt: now }
}

export type Where = { pos: number; total: number; stage: number; step: number; stageSize: number }

// pos counts the finished steps wherever they are; the current step is the active one, else the first still open
export function where(p: Plan): Where {
  const steps = p.stages.flatMap((s, i) => s.steps.map((step, j) => ({ i, j, step })))
  const pos = p.state === 'done' ? steps.length : steps.filter(x => isFinished(x.step.status)).length
  const cur = p.state === 'done' ? undefined : (steps.find(x => x.step.status === 'active') ?? steps.find(x => !isFinished(x.step.status)))
  const stage = (cur ?? steps[steps.length - 1])?.i ?? 0

  return { pos, total: steps.length, stage, step: cur ? cur.j + 1 : (p.stages[stage]?.steps.length ?? 0), stageSize: p.stages[stage]?.steps.length ?? 0 }
}

// what the pill shows: the stage its place on the track falls in (the finished share), so its name never runs ahead
// of the pill or lags behind it when Claude finishes steps out of order; the step counts within that stage. The
// model's own lines keep where(), which names the step actually in progress
export function atHead(p: Plan): Where {
  const w = where(p)
  if (p.state === 'done') return w
  let start = 0
  for (let i = 0; i < p.stages.length; i++) {
    const size = p.stages[i]?.steps.length ?? 0
    if (w.pos < start + size || i === p.stages.length - 1) return { ...w, stage: i, step: Math.max(1, Math.min(size, w.pos - start + 1)), stageSize: size }
    start += size
  }
  return w
}

// the step the pill stands at, named after its stage behind a small separator; none on a finished bar
export const pillStep = (p: Plan, w: Where) => (p.state === 'done' ? '' : (p.stages[w.stage]?.steps[w.step - 1]?.title ?? ''))

// an unfinished bar stops at 99%: 199 of 200 steps would otherwise round up to 100%
export function percent(p: Plan, w: { pos: number; total: number }): number {
  if (p.state === 'done') return 100
  return Math.min(99, Math.round((Math.min(w.pos, w.total) / Math.max(1, w.total)) * 100))
}

export const elapsed = (ms: number) => {
  const sec = Math.max(0, Math.round(ms / 1000))
  if (sec < 60) return `${sec}s`
  return sec < 3600 ? `${Math.floor(sec / 60)}m ${sec % 60}s` : `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
}

export function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

export const isAllFinished = (p: Plan) => {
  const steps = p.stages.flatMap(s => s.steps)
  return steps.length > 0 && steps.every(s => isFinished(s.status))
}
// a bar still being worked: running with a step left open
export const isOpenPlan = (p: Plan) => p.state === 'running' && !p.stages.flatMap(s => s.steps).every(s => isFinished(s.status))

// the person answered a bar waiting on them: back to work, or done when every step already was
export function answered(p: Plan, now: number): Plan {
  return isAllFinished(p) ? { ...p, state: 'done', note: null, endedAt: now } : { ...p, state: 'running', note: null }
}

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-/, '')
    .slice(0, 40)
    .replace(/[\uD800-\uDBFF]$/, '')
    // after the cut, which can end on a separator
    .replace(/-$/, '')

// adds or replaces one bar by id; keeps at most MAX_BARS, dropping finished ones first
// computed inside update() from the latest list, so concurrent writers (parallel agents) do not drop each other
export function placeBar(list: readonly Plan[], next: Plan): Plan[] {
  const prev = list.find(p => p.id === next.id)
  // an update keeps its row; a new bar goes to the bottom
  const rest = prev ? list.map(p => (p.id === next.id ? next : p)) : [...list, next]
  // the oldest finished bar goes first, then the oldest running one a subagent made for its own work, then the oldest
  // running one of the main loop; the bar just placed and a bar waiting on the person or showing an error stay while
  // any other can go
  const pick = (ok: (p: Plan) => boolean) => rest.findIndex(p => p.id !== next.id && ok(p))
  while (rest.length > MAX_BARS) {
    const at = [pick(p => p.state === 'done'), pick(p => p.state === 'running' && !!p.byAgent), pick(p => p.state === 'running'), pick(() => true)].find(i => i >= 0) ?? 0
    rest.splice(at, 1)
  }
  return rest
}
