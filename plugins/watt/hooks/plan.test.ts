// The plan model, replayed on the cases plan-progress's own scenarios hold (ported, MIT, Kirill Serditov).
import { expect, test } from 'claude-code/testing'

import type { Plan } from '../types'
import { answered, atHead, isNextTask, normalize, parsePlan, percent, placeBar, slug, where, type Raw } from './plan'

const make = (input: Raw, prev: Plan | null = null, now = 1_000, id = 't'): Plan => {
  const made = normalize(input, prev, now, id)

  if (typeof made === 'string') {
    throw new Error(made)
  }

  return made
}

const steps = (p: Plan): string => p.stages.flatMap(s => s.steps.map(st => `${st.title}:${st.status}`)).join(' ')
const three = (): Raw => ({ title: 'Task', stages: [{ name: 'One', steps: [{ title: 'A', status: 'active' }, 'B'] }, { name: 'Two', steps: ['C'] }] })

test('a new bar starts with its first open step active, and next moves it along', () => {
  const p = make({ title: 'Task', stages: [{ name: 'One', steps: [{ title: 'A' }, { title: 'B' }] }, { name: 'Two', steps: ['C'] }] })

  expect(steps(p)).toBe('A:active B:pending C:pending')
  expect(p.state).toBe('running')

  const n1 = make({ next: true }, p, 2_000)

  expect(steps(n1)).toBe('A:done B:active C:pending')
  expect(n1.stages[0]?.steps[0]?.doneAt).toBe(2_000)

  const n3 = make({ next: true }, make({ next: true }, n1, 3_000), 4_000)

  expect(steps(n3)).toBe('A:done B:done C:done')
  expect(n3.state).toBe('done')
  expect(n3.endedAt).toBe(4_000)
})

test('done and active name steps by title; finishing the active step moves on; failed turns the bar to error', () => {
  const p = make(three())
  const a = make({ done: ['A'], active: 'C' }, p)

  expect(steps(a)).toBe('A:done B:pending C:active')

  const b = make({ done: ['A'] }, p)

  expect(steps(b)).toBe('A:done B:active C:pending')

  const f = make({ failed: 'B', note: 'tests red' }, p)

  expect(steps(f)).toBe('A:active B:error C:pending')
  expect(f.state).toBe('error')
  expect(f.note).toBe('tests red')
})

test('a failed step keeps its error: next starts the step after it, and the bar is failed again once nothing is in progress', () => {
  const f = make({ failed: 'A' }, make(three()), 2_000)

  expect(steps(f)).toBe('A:error B:pending C:pending')

  const moved = make({ next: true }, f, 3_000)

  expect(steps(moved)).toBe('A:error B:active C:pending')
  expect(moved.state).toBe('running')

  const rest = make({ done: ['B', 'C'] }, moved, 4_000)

  expect(steps(rest)).toBe('A:error B:done C:done')
  expect(rest.state).toBe('error')

  const retried = make({ active: 'A' }, rest, 5_000)

  expect(steps(retried)).toBe('A:active B:done C:done')
  expect(retried.state).toBe('running')
})

test('a title the bar does not have is refused, listing the steps it does have', () => {
  const refused = normalize({ done: ['Z'] }, make(three()), 2_000, 't')

  expect(refused).toBe('plan_progress: "t" has no step "Z". Its steps: A, B, C')
})

test('a resent plan keeps what was finished, by title', () => {
  const p = make({ next: true }, make(three()), 2_000)
  const resent = make({ stages: [{ name: 'One', steps: [{ title: 'A', status: 'done' }, { title: 'B', status: 'active' }, 'D'] }, { name: 'Two', steps: ['C'] }] }, p, 3_000)

  expect(steps(resent)).toBe('A:done B:active D:pending C:pending')
  // the title stays when the resend brings none
  expect(resent.title).toBe('Task')

  const reordered = make({ stages: [{ name: 'New', steps: [{ title: 'C', status: 'active' }, { title: 'A', status: 'pending' }, 'B2'] }] }, p, 3_000)

  expect(steps(reordered)).toBe('C:active A:done B2:pending')
})

test('a finished bar under another title is the next task, from zero; the same plan grown by a step is not', () => {
  const done = make({ done: ['A', 'B', 'C'] }, make(three()), 5_000)

  expect(done.state).toBe('done')

  const other = make({ title: 'Another thing', stages: [{ name: 'X', steps: ['A', 'B'] }] }, done, 6_000)

  expect(steps(other)).toBe('A:active B:pending')
  expect(other.startedAt).toBe(6_000)

  const grown = make({ title: 'Task', stages: [{ name: 'One', steps: ['A', 'B'] }, { name: 'Two', steps: ['C', 'D'] }] }, done, 6_000)

  expect(steps(grown)).toBe('A:done B:done C:done D:active')
  expect(isNextTask(done, 'Task', grown.stages)).toBe(false)
})

test('steps may be plain strings, and a flat list may come as top-level steps', () => {
  const p = make({ title: 'Chores', kind: 'todo', steps: ['wash', { title: 'dry' }] })

  expect(steps(p)).toBe('wash:active dry:pending')
  expect(p.kind).toBe('todo')
  expect(p.stages[0]?.name).toBe('Chores')
})

test('where and the percent: an unfinished bar stops at 99', () => {
  const p = make(three())

  expect(where(p)).toEqual({ pos: 0, total: 3, stage: 0, step: 1, stageSize: 2 })

  const second = make({ next: true }, p, 2_000)

  expect(atHead(second)).toMatchObject({ pos: 1, stage: 0, step: 2 })
  expect(percent(second, where(second))).toBe(33)
  expect(percent(p, { pos: 199, total: 200 })).toBe(99)
  expect(percent({ ...p, state: 'done' }, { pos: 3, total: 3 })).toBe(100)
})

test('an approved plan becomes a bar: headings are stages, list items steps, a ticked box is already done', () => {
  const md = '# Fix login\n\n## Analyse\n- Read code\n- [x] Find bug\n## Fix\n- Patch\n- Test\n\n```sh\n# a comment\n- not a step\n```'
  const plan = parsePlan(md, 1_000)

  expect(plan?.id).toBe('plan')
  expect(plan?.title).toBe('Fix login')
  expect(plan?.stages.map(s => s.name)).toEqual(['Analyse', 'Fix'])
  expect(plan?.stages.flatMap(s => s.steps.map(st => `${st.title}:${st.status}`))).toEqual(['Read code:pending', 'Find bug:done', 'Patch:pending', 'Test:pending'])
  expect(parsePlan('just prose, no list', 1_000)).toBeNull()
})

test('a session keeps at most three bars, the oldest finished one going first', () => {
  const bar = (id: string, state: Plan['state']): Plan => ({ ...make({ title: id, steps: ['x'] }, null, 1_000, id), state })
  let list: Plan[] = []

  for (const [id, state] of [['a', 'done'], ['b', 'running'], ['c', 'running'], ['d', 'running']] as const) {
    list = placeBar(list, bar(id, state))
  }

  expect(list.map(p => p.id)).toEqual(['b', 'c', 'd'])

  // an update to a bar keeps its row
  list = placeBar(list, { ...bar('c', 'needs_input') })

  expect(list.map(p => `${p.id}:${p.state}`)).toEqual(['b:running', 'c:needs_input', 'd:running'])
})

test('an id is a slug of letters and digits, and the person answering a waiting bar sends it back to work', () => {
  expect(slug('Fix login!')).toBe('fix-login')
  expect(slug('!!!')).toBe('')

  const waiting = { ...make(three()), state: 'needs_input' as const, note: 'which one?' }

  expect(answered(waiting, 9_000)).toMatchObject({ state: 'running', note: null })

  const finished = make({ done: ['A', 'B', 'C'] }, make(three()), 5_000)

  expect(answered({ ...finished, state: 'needs_input' }, 9_000)).toMatchObject({ state: 'done', endedAt: 9_000 })
})
