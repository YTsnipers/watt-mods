// Ported from plan-progress by Kirill Serditov, MIT (https://github.com/zycck/claude-mods). See NOTICE.
//
// The progress bars' side of the engine: the plan_progress tool, the rules Claude is given, the gate and reminders that
// keep a bar current, the question check at the end of a turn, the bars above the prompt (terminal and desktop), the
// bars kept per session in the store, and the chimes. The sounds that other moments of watt play (a long turn ending,
// Claude asking) sit in register.tsx and ask this file whether a bar already chimed.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Plan, PlanState } from '../types'
import {
  FIGURE_SPACE,
  PLAN_ID,
  RULES,
  STATE_COLOR,
  STATE_GLYPH,
  STATUSES,
  TOOL,
  answered,
  atHead,
  carryDone,
  elapsed,
  isAllFinished,
  isFinished,
  isNextTask,
  isOpenPlan,
  normalize,
  parsePlan,
  percent,
  placeBar,
  plural,
  pointAt,
  prune,
  slug,
  str,
  where,
} from './plan'
import type { Raw } from './plan'
import { prefs } from './prefs'
import { columnsOf } from './raster'
import { TRACK_H, drawn, glideEnd, lastHead, liveSource, textWidth, timesAlt, trackSvg, waveFrom } from './svg'
import { isLight, readTint } from './tint'
import { GLIDE_MS, barCells, blitPlans, currentBand, glide, glideSettleAt, landGlides, live, setBand, stillPhase, syncFrames } from './track'

const plans = atom({ plugin: 'watt', key: 'plans' } as const, [])
const isOpen = atom({ plugin: 'watt', key: 'isOpen' } as const, true)
const tick = atom({ plugin: 'watt', key: 'tick' } as const, 0)
// The settings window's choices (settings.tsx writes them): the band reads them so a changed choice redraws it.
const choices = { plugin: 'watt', key: 'choices' } as const

// ---------- sounds ----------

// the engine's player, the soft sounds watt already has; one per moment, so whoever plays checks first
export function play($: EngineInterface, name: 'decision' | 'error' | 'done'): void {
  // turned off in the settings window
  if (!prefs.isSoundOn) return
  void $.audio.play({ asset: `sounds/${name}.wav` }).catch(() => undefined)
}

// whether a bar chimed (done, error, or waiting on the person) since the main loop's turn began: the turn's own end
// sound (register.tsx) stays quiet then, since the chime already told the person
export const chimed = { inTurn: false }

function chime($: EngineInterface, prev: PlanState | undefined, next: PlanState): void {
  if (next === prev) return
  const name = next === 'needs_input' ? 'decision' : next === 'error' ? 'error' : next === 'done' ? 'done' : undefined
  if (!name) return
  chimed.inTurn = true
  play($, name)
}

// the bars the main loop itself set waiting through the tool, the call that chimed; a subagent's amber is quiet and
// not about the person's next question
const askedIds = new Set<string>()

// the task bars Claude set waiting before it asked, as its rules say; they chimed when they turned amber
export async function waitingIds($: EngineInterface): Promise<string[]> {
  return (await read($, plans)).filter(p => p.state === 'needs_input' && askedIds.has(p.id)).map(p => p.id)
}


// builds a bar from the latest stored one inside update(), so back-to-back calls never work from a stale copy;
// make returns a string to refuse, and the list stays as it was
async function editPlan($: EngineInterface, id: string, make: (prev: Plan | null) => Plan | string, isQuiet = false): Promise<Plan | string> {
  let prev: Plan | undefined
  let made = '' as Plan | string
  await update($, plans, list => {
    prev = list.find(p => p.id === id)
    made = make(prev ?? null)
    return typeof made === 'string' ? [...list] : placeBar(list, made)
  })
  if (typeof made === 'string') return made
  if (!isQuiet) chime($, prev?.state, made.state)
  if (!prev) await update($, isOpen, () => true)
  return made
}

// the desktop rebuilds a picture's animations from the start on every redraw, so a glide is drawn once more when it is
// over, standing: one timer at a time, when the first glide still under way is over; a draw then queues the next. One
// due sooner than the timer waiting takes its place, else a later end queued first would hold the earlier picture on
let settleDue = 0
function settleBy($: EngineInterface, at: number, now: number) {
  if (at <= now || (settleDue > now && settleDue <= at)) return
  settleDue = at
  $.clock.after(at - now, () => {
    if (settleDue === at) settleDue = 0
    void update($, tick, n => n + 1).catch(() => {})
  })
}

// auto-close is off until the person turns it on (the settings window, /config): a finished bar stays until it is
// closed. On, a finished bar leaves on its own doneBarSeconds after it finished; a failed bar or one waiting on the
// person stays until it is closed, since it still asks for attention
const hasLeft = (p: Plan, now: number) => prefs.isAutoClose && p.state === 'done' && p.endedAt != null && now - p.endedAt >= prefs.doneBarMs

// module maps outlive the bars they describe: a bar pushed out past MAX_BARS, a cleared list; drop what no bar holds
const perBar = [lastHead, waveFrom, drawn, glide, stillPhase]
function forgetGone(list: readonly Plan[]) {
  const bars = new Set(list.map(p => p.id))
  prune(perBar, key => bars.has(key))
}

// leftAt: the clock's time when it let the bar go. The bar is looked at again as it is taken away
async function dropPlan($: EngineInterface, id: string, leftAt?: number) {
  let gone = null as Plan | null
  await update($, plans, list => {
    gone = list.find(p => p.id === id && (leftAt === undefined || hasLeft(p, leftAt))) ?? null
    return list.filter(p => p !== gone)
  })
  if (!gone) return
  prune(perBar, key => key !== id)
  await saveNow($)
}


// substeps are left out: the bar never draws them and short ops cannot reach them; a plain string is its title
const STEP_SCHEMA = {
  anyOf: [
    { type: 'string' },
    {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string' },
        status: { enum: STATUSES, description: 'Default pending' },
      },
    },
  ],
}

// edits are the work the enforcement below counts. Shell calls are never refused or counted: the host marks only
// plain reads (ls) read-only, so a compound read (cd x && git log) would look like work and be refused
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])
// the person's own messages, wherever they typed them: the prompt, Remote Control, an SDK host, a Slack ping
const PERSON_ORIGINS = new Set(['composer', 'bridge', 'sdk', 'slack-ping'])
const WORK_BEFORE_PLAN = 3 // the 4th edit without a plan is refused once
const CALLS_BEFORE_NUDGE = 6 // edits without a plan update before a reminder
// the file plan mode has Claude build its plan in, a write at a time: as the engine's plan-mode note names it, else
// where plans are kept by default. Writing it is planning, so it neither counts as work nor is refused
let planFile = ''
const slashed = (path: string) => path.replace(/\\/g, '/').toLowerCase()
const isPlanFile = (path: unknown) =>
  typeof path === 'string' && ((planFile !== '' && slashed(path) === planFile) || /\/\.claude\/plans\/[^/]+\.md$/.test(slashed(path)))

// $.state lives as long as the process, so the bars are kept per session in the plugin's store as well
const SAVED = 'plans:'
const KEEP_SESSIONS = 20
// what was saved last, as text: every read of $.state is a fresh copy, so only the content tells a change
let lastSaved = ''
// the session whose bars $.state holds, the only one the bars are saved under. A /clear or a /resume inside a
// running app wipes the state and goes on under another id with no session.start; between session.end and the
// new id the wiped state is nobody's, so endedSession keeps it from being saved over the session that ended
let shownSession = ''
let endedSession = ''
// when a save last failed: the timer tries a store that cannot be written again after SAVE_RETRY_MS, not every second;
// session.end, the last chance, tries it at once
let saveFailedAt = -Infinity
const SAVE_RETRY_MS = 30_000

// the store is a file the host keeps, and one it cannot read (cut short or left empty by a crash) throws on every call:
// that costs the saved bars and the auto-close choice, never the session start or the clock that runs after it
async function fromStore($: EngineInterface, key: string): Promise<unknown> {
  return Promise.resolve()
    .then(() => $.store.get(key))
    .catch(() => undefined)
}

async function savePlans($: EngineInterface, list: Plan[], text: string, isInPlace = false) {
  lastSaved = text
  const key = SAVED + shownSession
  try {
    if (list.length === 0) return void (await $.store.delete(key))
    // session.end's short bound can cut a $ call in flight, and a cut between a delete and a set would leave the
    // session nothing to resume: there the save only writes over the key, left where the timer's last save put it
    if (isInPlace) return void (await $.store.set(key, list))
    // set keeps a key where it first went in the store's order, so the session goes to the end anew: the
    // sessions trimmed are the ones left alone longest, not the ones saved first
    await $.store.delete(key)
    await $.store.set(key, list)
  } catch {
    // a store the host cannot write (fromStore) costs this save, not the bars on screen. It is owed, even if the bars
    // never change again (the delete may have gone through), and tried again once the store has had a while
    lastSaved = ''
    saveFailedAt = await $.clock.now()
    return
  }
  // the current session counts as one of the kept, whatever its place in the store's order; a trim that fails leaves
  // old sessions a while longer and this one saved
  await Promise.resolve()
    .then(async () => {
      const keys = (await $.store.keys()).filter(k => k.startsWith(SAVED) && k !== key)
      for (const old of keys.slice(0, Math.max(0, keys.length - (KEEP_SESSIONS - 1)))) await $.store.delete(old)
    })
    .catch(() => {})
}

// a bar taken away is saved at once: a reload before the next tick would find the state empty and bring the session's
// saved bars back
async function saveNow($: EngineInterface) {
  if (shownSession === '') return
  const list = await read($, plans)
  const text = JSON.stringify(list)
  if (text === lastSaved || (await $.clock.now()) - saveFailedAt < SAVE_RETRY_MS) return
  await savePlans($, list, text)
}

// a saved bar as the store hands it back: a file written over by hand or cut short can hold anything, and one bar
// without the parts the drawings read would fail every draw of the band, or the session start
const isSavedPlan = (p: unknown): p is Plan => {
  const v = p as Plan | null
  return (
    typeof v === 'object' && v !== null && typeof v.id === 'string' && typeof v.title === 'string' && typeof v.state === 'string' &&
    Array.isArray(v.stages) &&
    v.stages.every(s => typeof s === 'object' && s !== null && Array.isArray(s.steps) && s.steps.every(t => typeof t === 'object' && t !== null && typeof t.title === 'string'))
  )
}

// a subagent does not outlive the process that ran it, so a restored bar belongs to the main loop
async function restorePlans($: EngineInterface, id: string) {
  shownSession = id
  // nothing saved is nothing to delete
  lastSaved = '[]'
  const saved = await fromStore($, SAVED + id)
  if (!Array.isArray(saved) || saved.length === 0) return
  const list = saved.filter(isSavedPlan).map(p => ({ ...p, byAgent: undefined }))
  if (list.length === 0) return
  // bars the session made before the timer noticed the switch stay, after the restored ones
  await update($, plans, shown => [...list.filter(p => !shown.some(s => s.id === p.id)), ...shown])
  // lastSaved stays behind, so the next tick saves the session again and an opened session counts as used
  lastSaved = ''
}

// whether the tool reached the session, null until the first look. Missing, nothing asks Claude to use it (no
// refusal, no turn sent back, no reminders) and each turn looks again until it shows up; found, it is not looked for
// again
let hasTool: boolean | null = null
// whether the tool is known to be missing: looked up here while nothing is known yet (a reload mid-turn, a resumed
// session's first prompt, which comes before turn.start), so Claude is not sent to a tool it cannot call. Declared
// at the top of the file: the engine refuses a module that hands $ to a function declared anywhere else
async function isToolMissing($: EngineInterface) {
  if (hasTool === null) {
    const tools = await Promise.resolve()
      .then(() => $.tool.list())
      .catch(() => null)
    if (tools) hasTool = tools.some(t => t.name === TOOL)
  }
  return hasTool === false
}

// whether a drawing below the bars shows anything: an empty Box or blank text would only add the gap under them. A Box
// that draws by itself (a border, a background, a height it keeps) shows without children, as another mod's divider
// does, and stays under the bars (issue #15)
type Drawn = { type?: string; props?: Record<string, unknown>; children?: unknown[] } | string | null | undefined
const hasContent = (n: unknown): boolean => {
  if (n === null || n === undefined || n === false) return false
  if (typeof n === 'string') return n.trim() !== ''
  if (Array.isArray(n)) return n.some(hasContent)
  const el = n as Exclude<Drawn, string | null | undefined>
  const props = el.props ?? {}
  if (el.type === 'Box' && (props.borderStyle || props.backgroundColor || Number(props.height) > 0 || Number(props.minHeight) > 0)) return true
  if (el.type === 'Box' || el.type === 'Text' || el.type === undefined) return (el.children ?? []).some(hasContent)
  return true
}

// the first terminal draw of the module's life waits for the appearance: drawn on a guess, a light terminal would show
// a dark bar until the second timer repainted it
let firstTint: Promise<void> | null = null
let lightSeen = false

// reads the appearance when due and repaints the bars at once if the tint changed
async function syncTint($: EngineInterface, now: number) {
  const b = currentBand()
  if (b) await readTint($, now)
  const next = isLight()
  if (next === lightSeen) return
  lightSeen = next
  if (b) await blitPlans($, b, b.list, now)
}

// ---------- the main loop's turn ----------

// per-turn bookkeeping of the main loop; module variables are fine here, a reload just starts a fresh count
const fresh = () => ({ calls: 0, sinceUpdate: 0, isPlanTouched: false, hasRefused: false, isWaitingOnBackground: false })
const turnWork = fresh()
let hasWarnedNoTool = false

// run from watt's one turn.start hook. A subagent's start leaves the main loop's counts and its animation alone
export async function turnStarted($: EngineInterface, isMain: boolean): Promise<void> {
  if (isMain) {
    live.isTurnLive = true
    chimed.inTurn = false
    Object.assign(turnWork, fresh())
  }
  // the engine hands the tool to the session over HTTP on 127.0.0.1; an antivirus web filter or a proxy that
  // catches loopback breaks that, and the tool is simply missing, so say why once instead of drawing nothing
  if (hasTool !== true) {
    const tools = await Promise.resolve()
      .then(() => $.tool.list())
      .catch(() => null)
    if (tools) hasTool = tools.some(t => t.name === TOOL)
    if (hasTool === false && !hasWarnedNoTool) {
      hasWarnedNoTool = true
      const why = `watt: the ${TOOL} tool did not reach this session, so Claude cannot draw progress bars. An antivirus web filter (AVG Web Shield, for one) or a proxy is likely blocking 127.0.0.1: add 127.0.0.1 to its exceptions, or set NO_PROXY=127.0.0.1,localhost, then restart Claude Code.`
      $.ui.log(why)
      $.ui.toast(why, { timeoutMs: 15000 })
    }
  }
}

// run from watt's one turn.complete hook, before the turn's own end sound is decided: a bar closed here may chime
export async function turnFinished($: EngineInterface, agentId: string | undefined): Promise<void> {
  if (!agentId) {
    live.isTurnLive = false
    // a glide still under way lands now: frames running on would go out with the engine's end-of-turn redraw
    landGlides()
  }
  // a bar a subagent leaves when its run is over has no one left to move it: the main loop takes it over, so its
  // Stop asks about it; a teammate only rests between its turns and keeps its own
  if (agentId && (await read($, plans)).some(p => p.byAgent === agentId)) {
    const rows = await Promise.resolve()
      .then(() => $.agent.list())
      .catch(() => null)
    if (!rows?.find(r => r.id === agentId)?.teammateId) {
      for (const p of await read($, plans)) if (p.byAgent === agentId) handedOver.set(p.id, agentId)
      await update($, plans, list => list.map(p => (p.byAgent === agentId ? { ...p, byAgent: undefined } : p)))
    }
  }
  // a plan whose steps are all finished closes itself; a failed one or one waiting on the person stays as it is,
  // since it still asks for attention
  for (const p of await read($, plans)) {
    if (p.state !== 'running' || !isAllFinished(p)) continue
    const now = await $.clock.now()
    await editPlan($, p.id, prev => (prev?.state === 'running' && isAllFinished(prev) ? { ...prev, state: 'done', endedAt: now } : 'skip'))
  }
}

// bars made by a subagent, handed to the main loop when its run ended
const handedOver = new Map<string, string>()

// ---------- Claude asks the person ----------

export type Question = { asked: string[]; live: string | undefined }

// Claude is about to ask the person a question (AskUserQuestion). A bar Claude already set waiting is the one asked
// about (it chimed when it turned amber); else the latest task bar at work turns amber, with no chime of its own. The
// caller plays the one decision sound when `asked` is empty
export async function openQuestion($: EngineInterface): Promise<Question> {
  const asked = await waitingIds($)
  const live = asked.length > 0 ? undefined : (await read($, plans)).filter(p => p.state === 'running' && !p.byAgent).pop()
  if (live) await update($, plans, list => list.map(p => (p.id === live.id ? { ...p, state: 'needs_input' as const } : p)))
  return { asked, live: live?.id }
}

// the person answered: the bar that turned amber for the question goes back to work, the one Claude set waiting is
// answered (back to work, or done when every step already was)
export async function closeQuestion($: EngineInterface, q: Question): Promise<void> {
  const now = await $.clock.now()
  await update($, plans, list =>
    list.map(p => (p.state !== 'needs_input' ? p : p.id === q.live ? { ...p, state: 'running' as const } : q.asked.includes(p.id) ? answered(p, now) : p)),
  )
  for (const id of q.asked) askedIds.delete(id)
}

// a plan is shown to the person (ExitPlanMode) and answered: the bar Claude set waiting is answered
export async function answerPlan($: EngineInterface, asked: string[]): Promise<void> {
  if (asked.length === 0) return
  const now = await $.clock.now()
  await update($, plans, list => list.map(p => (p.state === 'needs_input' && asked.includes(p.id) ? answered(p, now) : p)))
  for (const id of asked) askedIds.delete(id)
}

// the plan the person approved lands on the bar PLAN_ID: a revised plan keeps what was finished; a plan approved after
// the last one finished is a new task. Answers the line that tells Claude which bar holds its plan, so it moves that
// one rather than opening its own (none when the tool to move it never reached the session)
export async function planApproved($: EngineInterface, text: unknown): Promise<string | undefined> {
  const parsed = typeof text === 'string' ? parsePlan(text, await $.clock.now()) : null
  if (!parsed) return undefined
  await editPlan($, PLAN_ID, prev =>
    prev && !isNextTask(prev, parsed.title, parsed.stages)
      ? { ...parsed, stages: pointAt(carryDone(parsed.stages, prev.stages)), startedAt: prev.startedAt }
      : { ...parsed, stages: pointAt(parsed.stages) },
  )
  if (await isToolMissing($)) return undefined
  return `plan-progress: bar "${PLAN_ID}" shows this plan; move it with {id:"${PLAN_ID}", next:true} as steps finish.`
}

// ---------- the session ----------

// run from watt's one session.start hook
export async function startBars($: EngineInterface): Promise<void> {
  // a reload of the mod keeps the bars (they are the host's) but starts its maps empty
  const kept = await read($, plans)
  await $.tool.register({
    name: 'plan_progress',
    description: 'Live progress bar above the prompt, one per id. Create with title + stages; update with short ops (next, done, active, failed) or state.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'Bar id; reuse it for updates' },
        title: { type: 'string' },
        kind: { enum: ['plan', 'todo'] },
        stages: {
          type: 'array',
          description: 'Full breakdown: when creating, or resent under the same id when the plan changes',
          items: { type: 'object', required: ['name', 'steps'], properties: { name: { type: 'string' }, steps: { type: 'array', items: STEP_SCHEMA } } },
        },
        steps: {
          type: 'array',
          description: 'One flat list (kind "todo") instead of stages: step titles or {title}',
          items: STEP_SCHEMA,
        },
        next: { type: 'boolean', description: 'Active step finished, start the next one' },
        done: { type: 'array', items: { type: 'string' }, description: 'Step titles now finished' },
        active: { type: 'string', description: 'Step title now in progress' },
        failed: { type: 'string', description: 'Step title that failed' },
        state: { enum: ['running', 'needs_input', 'error', 'done'] },
        note: { type: 'string', description: 'One line for needs_input or error' },
      },
    },
  })
  // a session reopened later (an app restart, a resume) finds its bars where it left them
  const session = await $.session.id()
  if (kept.length === 0) await restorePlans($, session)
  else shownSession = session
  lightSeen = isLight()
  $.clock.every(1000, async () => {
    // the session changed under the mod (a /clear, a /resume): its bars are loaded here, as no session.start comes
    const id = await $.session.id()
    if (id !== shownSession && id !== endedSession) await restorePlans($, id)
    const list = await read($, plans)
    forgetGone(list)
    const now = await $.clock.now()
    for (const p of list) if (hasLeft(p, now)) await dropPlan($, p.id, now)
    syncFrames($, now)
    await syncTint($, now)
    // from the latest list: the one read above may predate a bar dropped just now
    await saveNow($)
  })
  await $.command.register({ name: 'progress', description: 'Show or hide the progress bars' })
  await $.command.register({ name: 'progress-clear', description: 'Remove all progress bars' })
}

export const register: Register = on => {
  on('prompt.attachment', async ($, e, next) => {
    if (!e.agentId && (e.type === 'plan_mode' || e.type === 'plan_mode_reentry' || e.type === 'plan_mode_exit') && e.detail?.planFilePath)
      planFile = slashed(e.detail.planFilePath)

    return next(e)
  })

  // the rule lives in the cached system prompt; a message only carries one short line when bars are open,
  // and the person answering clears any "needs input" without a model call
  on('prompt.submit', async ($, e, next) => {
    if (!PERSON_ORIGINS.has(e.origin.kind)) return next(e)
    const list = await read($, plans)
    if (list.some(p => p.state === 'needs_input')) {
      const now = await $.clock.now()
      await update($, plans, all => all.map(p => (p.state === 'needs_input' ? answered(p, now) : p)))
      askedIds.clear()
    }
    const open = (await read($, plans)).filter(p => p.state !== 'done')
    if (open.length === 0 || (await isToolMissing($))) return next(e)
    const line = `plan-progress open bars: ${open
      .map(p => {
        const w = where(p)
        return `${p.id} (${p.stages[w.stage]?.name ?? ''} ${w.step}/${w.stageSize})`
      })
      .join(', ')}`

    return next({ ...e, context: [...(e.context ?? []), line] })
  })

  // watches the main loop's changing calls: refuses once when multi-step work starts without a bar,
  // and reminds to update the bar when it goes stale mid-turn
  on('tool.call', async ($, e, next) => {
    // a subagent's call is no work of the main loop's: no gate, no reminders
    if (e.agentId) return next(e)
    if (SHELL_TOOLS.has(e.tool)) {
      turnWork.isWaitingOnBackground = (e as unknown as Raw).run_in_background === true
      return next(e)
    }
    if (!EDIT_TOOLS.has(e.tool) || isPlanFile((e as unknown as Raw).file_path)) return next(e)
    turnWork.isWaitingOnBackground = false
    // a bar a subagent made is its own to move: it neither stands in for the main loop's bar nor is reminded of
    const open = (await read($, plans)).filter(p => isOpenPlan(p) && !p.byAgent)
    const hasLivePlan = turnWork.isPlanTouched || open.length > 0
    if (!hasLivePlan && !turnWork.hasRefused && turnWork.calls >= WORK_BEFORE_PLAN && !(await isToolMissing($))) {
      turnWork.hasRefused = true

      return { deny: `plan-progress: several changes ahead. Create a bar with ${TOOL} first, then retry.` }
    }
    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    turnWork.calls += 1
    turnWork.sinceUpdate += 1
    // a finished bar keeps the gate shut but has nothing left to update, so only an open one is reminded of
    if (open.length > 0 && turnWork.sinceUpdate >= CALLS_BEFORE_NUDGE && !(await isToolMissing($))) {
      turnWork.sinceUpdate = 0
      const ids = open.map(p => p.id).join(', ')

      return { ...ran, context: [...(ran.context ?? []), `plan-progress: ${ids} not updated for a while; send {id, next:true} or {id, done, active}.`] }
    }

    return ran
  })

  // an open bar at the end of a turn: a question to the user marks it waiting on its own;
  // only a turn that did work and left the bar unexplained is sent back once
  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    if (e.stop_hook_active || result.block) return result
    // a bar a subagent made is its own: the main loop's question is not about it, nor is it held to account here
    const open = (await read($, plans)).filter(p => isOpenPlan(p) && !p.byAgent)
    if (open.length === 0) return result
    // ？ and ؟ are the full-width (zh, ja) and Arabic marks; bold, code, a bracket or a quote may close the question
    const asks = /[?？؟][*_`)\]"'»”’」』）]*\s*$/.test(e.last_assistant_message ?? '')
    if (asks) {
      // a bar Claude already set waiting is the one asked about: no second bar turns amber, no second chime
      if ((await waitingIds($)).length > 0) return result
      const last = open[open.length - 1]
      if (last) {
        await editPlan($, last.id, prev => (prev ? { ...prev, state: 'needs_input' } : 'skip'))
        askedIds.add(last.id)
      }

      return result
    }
    // a session waiting on its background work wakes again by itself (or never, a dev server): nothing to send back
    if (turnWork.isWaitingOnBackground || (e.background_tasks?.length ?? 0) > 0) return result
    if ((turnWork.calls === 0 && !turnWork.isPlanTouched) || (await isToolMissing($))) return result

    return {
      ...result,
      block: `plan-progress: ${open.map(p => p.id).join(', ')} still open. Update each with ${TOOL}: {id, next:true}, or state "done", "needs_input" or "error" with a note.`,
    }
  })

  // the host wipes $.state right after this: the bars as they are now are the session's last save, and the timer
  // keeps off the wiped state until the next session's id shows
  on('session.end', async ($, e, next) => {
    try {
      if (e.sessionId === shownSession) {
        const list = await read($, plans)
        const text = JSON.stringify(list)
        if (text !== lastSaved) await savePlans($, list, text, true)
      }
    } finally {
      // even when the bound cut the save short: the timer must keep off the wiped state
      endedSession = e.sessionId
      shownSession = ''
    }

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)

    return { sections: [...result.sections, { id: 'watt:progress-rules', text: RULES, scope: 'session' as const }] }
  })

  // The matcher is typed from the MCP tools the session had listed when the mod was last saved, and this tool joins that
  // list only after the mod has run once: the name is read as a plain string for the first save. It is TOOL, written out
  // so that validate can read the matcher; a test calls the tool by TOOL and fails if the two ever differ
  on('tool.call', { tool: 'mcp__watt__plan_progress' as 'AskUserQuestion' }, async ($, e) => {
    const raw = e as unknown as Raw
    const now = await $.clock.now()
    // an id of emoji or punctuation alone names no bar: the title names it then, and with no title it is refused
    // rather than landing on the plan-mode bar
    const id = slug(str(raw.id, 60)) || slug(str(raw.title, 80))
    if (!id) return { deny: 'plan_progress: the id needs a letter or a digit, like "fix-login".' }
    const next = await editPlan(
      $,
      id,
      prev => {
        const made = normalize(raw, prev, now, id)
        if (typeof made === 'string') return made
        if (made.stages.length === 0) {
          // a breakdown that was sent but did not parse is a format problem, not a missing bar
          const sentAny = (Array.isArray(raw.stages) && raw.stages.length > 0) || (Array.isArray(raw.steps) && raw.steps.length > 0)
          return sentAny ? `plan_progress: could not read the breakdown for "${id}"; send stages:[{name, steps:[{title}]}], steps may be plain strings.` : `plan_progress: no bar "${id}" yet; create it with title and stages.`
        }
        // a bar belongs to the loop that made it; the main loop moving one takes it over. A subagent resumed under its id
        // (a message sent to it) takes back the bar it made, handed to the main loop when its run ended
        const isMine = !!prev && !prev.byAgent && handedOver.get(id) === e.agentId
        const owner = e.agentId ? (prev && !isMine ? prev.byAgent : e.agentId) : undefined
        return owner ? { ...made, byAgent: owner } : made
      },
      // a subagent answers to Claude, not to the person: its bars are quiet
      Boolean(e.agentId),
    )
    if (typeof next === 'string') return { deny: next }
    if (!e.agentId || next.byAgent === e.agentId) handedOver.delete(id)
    if (!e.agentId && next.state === 'needs_input') askedIds.add(id)
    else askedIds.delete(id)
    // the gate and the reminders count the main loop's own updates; a subagent's bar is not the main loop's
    if (!e.agentId) {
      turnWork.isPlanTouched = true
      turnWork.sinceUpdate = 0
    }
    const w = where(next)
    const active = next.state === 'done' ? undefined : next.stages.flatMap(st => st.steps).find(st => st.status === 'active')

    return { result: `${id}: ${Math.min(w.pos, w.total)}/${w.total}, ${next.state}${active ? `, active "${active.title}"` : ''}` }
  })

  on('command.run', { command: 'progress' }, async $ => {
    if ((await read($, plans)).length === 0) return { text: 'No plan yet. A bar appears when Claude starts a task with several steps.' }
    const open = await read($, isOpen)
    await update($, isOpen, () => !open)

    return { text: open ? 'Progress bars hidden.' : 'Progress bars shown.' }
  })

  on('command.run', { command: 'progress-clear' }, async $ => {
    glide.clear()
    await update($, plans, () => [])
    await saveNow($)

    return { text: 'Progress bars removed.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, plans)
    await read($, choices)
    if (list.length === 0 || e.props.hasSurvey || !(await read($, isOpen))) {
      setBand(null)
      return next(e)
    }
    if (e.surface === 'terminal') {
      const { Box, Button, Text, Raster } = $.ui.resolve(e)
      await read($, tick)
      const now = await $.clock.now()
      await (firstTint ??= readTint($, now))
      const cols = Math.max(1, e.props.bodyColumns || 100)
      const hasClicks = e.viewport?.isFullscreen === true
      const rest = hasClicks ? 15 : 13
      // in a narrow band the title gives way before the track: the track keeps 12 cells while the title shrinks, and
      // below 4 columns of title there is none (its cell and gap go to the track), so the row never runs past the band
      const fit = Math.min(Math.max(4, Math.min(Math.round(cols * 0.28), Math.max(...list.map(p => columnsOf(p.title))))), cols - rest - 12)
      const titleW = fit >= 4 ? fit : 0
      const trackW = Math.max(4, Math.min(512, cols - titleW - rest + (titleW > 0 ? 0 : 1)))
      const under = titleW > 0 ? titleW + 3 : 2
      setBand({ requestId: e.requestId, W: trackW, list })
      const tree = (
        <Box flexDirection="column">
          {list.map(p => {
            const w = where(p)
            const pct = percent(p, w)
            return (
              <Box key={`bar-${p.id}`} flexDirection="column">
                <Box flexDirection="row" gap={1}>
                  <Text color={STATE_COLOR[p.state]}>{STATE_GLYPH[p.state]}</Text>
                  {titleW > 0 ? (
                    <Box width={titleW} flexShrink={0}>
                      <Text wrap="truncate">{p.title}</Text>
                    </Box>
                  ) : null}
                  <Raster key={`track-${p.id}`} columns={trackW} rows={1} cells={barCells(p, trackW, now)} />
                  <Text dimColor>{`${String(pct).padStart(3, FIGURE_SPACE)}%`}</Text>
                  {hasClicks ? <Button key={`close-${p.id}`} plain dimColor label="✕" onPress={() => dropPlan($, p.id)} /> : null}
                </Box>
                {p.note && p.state !== 'running' ? (
                  <Box marginLeft={under}>
                    <Text color={STATE_COLOR[p.state]} wrap="truncate">{p.note}</Text>
                  </Box>
                ) : null}
              </Box>
            )
          })}
        </Box>
      )
      // the cells above start a glide where the bar moved; the frames that carry it start with them
      syncFrames($, now)
      // the engine keeps this tree, and a band folded and shown again mounts it anew, glide start and all (frames sent
      // while it was folded were refused): once the glides are over the band is drawn again standing, where they end
      const settleAt = glideSettleAt(list)
      if (settleAt > 0) settleBy($, settleAt + 50, now)
      // what the host and the plugins after this one draw here stays, under the bars, next to the prompt (issue #15).
      // Asked last: a slow hook below would otherwise let an older draw set the band after a newer one
      const below = await next(e)
      // the gap only over something that shows; the drawing itself is never left out
      return below ? (
        <Box flexDirection="column" gap={hasContent(below) ? 1 : 0}>
          {tree}
          {below}
        </Box>
      ) : (
        tree
      )
    }
    const t = $.ui.resolve(e)
    const { Box, Button, Text } = t
    const Svg = 'Svg' in t ? t.Svg : null
    const total = Math.max(320, (e.props.bodyColumns || 100) * 8)
    // every bar has the same width and is pinned to the right edge (fixed-width percent, close button),
    // so rows line up whatever their titles; the slack goes into the gap after the title.
    // Desktop reports ~8 CSS px per column; glyph, gaps, percent and the close button take ~126 px.
    const titleWidth = Math.min(Math.round(total * 0.3), Math.max(...list.map(p => Math.round(textWidth(p.title, 6.4)))))
    await read($, tick)
    const now = await $.clock.now()
    const trackW = Math.max(120, Math.min(1400, total - titleWidth - 140))
    // a hairline between task bars, so each bar reads as one group
    const divider = `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="1"><rect width="${total}" height="1" fill="#808080" fill-opacity=".22"/></svg>`

    const bars = (
      <Box flexDirection="column" gap={1}>
        {list.flatMap((p, i) => {
          const track = trackSvg(p, trackW, now)
          // a glide (as good as over at PICTURE_STAND_MS) is drawn once more when it is over, standing: timed from the
          // move, not from this draw, so a draw late in the glide does not hold the gliding picture on any longer. A few
          // ms past the end, so the draw it brings finds it over
          const end = glideEnd(p.id)
          if (end > 0) settleBy($, end + 5, now)
          const hover = liveSource(track.overlay, now)
          const line = i > 0 && Svg ? [<Svg key={`div-${p.id}`} source={divider} alt="divider" width={total} height={1} />] : []
          const w = atHead(p)
          const pct = percent(p, w)
          const color = STATE_COLOR[p.state]
          const stageName = p.stages[w.stage]?.name ?? ''
          // the colour and the icon say a bar failed or waits on the person; the words say it too, note or not
          const failedAt = p.stages.flatMap(s => s.steps).find(st => st.status === 'error')?.title
          const stateAlt = p.state === 'needs_input' ? 'waiting for your answer, ' : p.state === 'error' ? `failed${failedAt ? ` at ${failedAt}` : ''}, ` : ''
          const alt =
            p.state === 'done'
              ? `${p.title}: done, ${plural(w.total, 'step')}${p.endedAt ? ` in ${elapsed(p.endedAt - p.startedAt)}` : ''}`
              : `${p.title}: ${stateAlt}${stageName}, step ${w.step} of ${w.stageSize}, ${pct}%${p.note ? ` — ${p.note}` : ''}`
          const bar = `${'━'.repeat(Math.round(pct / 4))}${'─'.repeat(25 - Math.round(pct / 4))}`

          return [
            ...line,
            <Box key={`bar-${p.id}`} flexDirection="row" alignItems="center" gap={1}>
              <Text color={color}>{STATE_GLYPH[p.state]}</Text>
              <Text wrap="truncate">{p.title}</Text>
              <Box flexGrow={1} />
              {Svg ? (
                <Box flexDirection="column" flexShrink={0}>
                  <Box key={`track-${p.id}`}>
                    <Svg source={liveSource(track.base, now)} alt={alt} width={trackW} height={TRACK_H} />
                    {track.clock ? (
                      // the pill's clock, shown by the desktop's own hover of this keyed Box: the pointer over the frame
                      // below is over the Box too. Under the frame, so the checkpoint tips still take the pointer; not
                      // placed itself, or the desktop would lift it out as a hover card
                      <Box position="absolute" top={0} left={0}>
                        <Box display="none" hover={{ display: 'flex' }}>
                          <Svg source={liveSource(track.clock, now)} alt={`${p.title} has run for ${elapsed(now - p.startedAt)}`} width={trackW} height={TRACK_H} />
                        </Box>
                      </Box>
                    ) : null}
                    <Box position="absolute" top={0} left={0}>
                      <Svg source={hover} alt={timesAlt(p)} width={trackW} height={TRACK_H} isInteractive />
                    </Box>
                  </Box>
                </Box>
              ) : (
                <Text>
                  <Text color={color}>{bar.replace(/─/g, '')}</Text>
                  <Text dimColor>{bar.replace(/━/g, '')}</Text>
                  <Text color={color}>{` ${stageName} ${w.step}/${w.stageSize}`}</Text>
                </Text>
              )}
              <Text dimColor>{`${String(pct).padStart(3, FIGURE_SPACE)}%`}</Text>
              <Button key={`close-${p.id}`} plain dimColor label="✕" onPress={() => dropPlan($, p.id)} />
            </Box>,
          ]
        })}
      </Box>
    )
    const below = await next(e)
    return below ? (
      <Box flexDirection="column" gap={hasContent(below) ? 1 : 0}>
        {bars}
        {below}
      </Box>
    ) : (
      bars
    )
  })
}
