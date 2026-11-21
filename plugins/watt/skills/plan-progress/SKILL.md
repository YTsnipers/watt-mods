---
name: plan-progress
description: Reference for the plan_progress bars (tool ops, /progress commands). The working rules are already in the system prompt; load only when the user asks about the bars or a call was refused.
---

<!-- Ported from plan-progress by Kirill Serditov, MIT (https://github.com/zycck/claude-mods). See NOTICE. -->

# plan_progress

The tool is `mcp__watt__plan_progress`, served by the watt mod. Create once with the whole plan, then move it with short ops.

Create: `{id, title, stages:[{name, steps:[{title}]}]}`; `kind:"todo"` for one flat list. 2-7 stages, titles of at most 4 words, in the user's language, one `id` per task. A step's `status` defaults to `pending`; the first open step becomes active.

Ops:
- `{id, next:true}` — active step done, next one active (past the last step, the first one left open)
- `{id, done:["A"], active:"B"}` — mark done, pick current; steps active before B count as done
- `{id, failed:"B", note}` — error
- `{id, state:"needs_input", note}` — before asking the user
- `{id, state:"done"}` — finish

The plan changed: resend `stages` under the same `id` and `title`. Steps sent without a status keep their done by title; send `status:"active"` on a later step, or `{id, active:"..."}`, to redo one. Short ops sent along apply on top. To a finished bar, the same plan sent again with no statuses (or only its first step active) starts a new run; one under another title, or without a step it finished, is the next task and starts from zero.

A title the bar does not have is refused with the bar's step list. A title used twice means the one still open.

A plan approved in plan mode lands on the bar `plan`; move that one.

The result says `done/total, state, active step`; no need to check the bar.

User commands: `/progress` toggles the bars, `/progress-clear` removes them. `/watt-settings` opens the settings window: the `twinkle` option (the dots of the fill; off, they are drawn still), the sounds, closing finished bars on their own (`autoclose`, off by default, so a finished bar stays until it is closed) and how long a finished bar stays first (`doneBarSeconds`, 30 s by default). The same choices are options of watt in `/config`. A failed bar, or one waiting on the person, never closes by itself.

One sound for each moment: a bar turning `done`, `error` or `needs_input` chimes once, and asking the person (AskUserQuestion, ExitPlanMode) adds none when the bar already chimed; a main turn of 30 s or more ends with watt's own sound only when no bar chimed during it. A subagent's bars are quiet.

No `mcp__watt__plan_progress` tool in the session has two causes. Most often an antivirus web filter (AVG Web Shield, for one) or a proxy blocks 127.0.0.1, where the tool reaches the session; the mod then says so once in the transcript and a toast. The fix: add 127.0.0.1 to the filter's exceptions, or set `NO_PROXY=127.0.0.1,localhost`, then restart Claude Code. Otherwise the mod's hooks module did not load: the mod needs Claude Code 2.1.295 or newer (`claude --version`).
