# Security

## Reporting

Report a vulnerability through GitHub's private vulnerability reporting on this repository (Security tab, "Report a
vulnerability"). Please do not open a public issue for it.

## What watt can touch

watt runs inside Claude Code's plugin sandbox and reaches the system only through the engine's `$` calls. Everything
it does is listed by `claude plugin validate plugins/watt`; this is that list in plain words.

| Capability | Where | What exactly |
| --- | --- | --- |
| Network | — | None. `plugin.json` declares `network.hosts: []`. |
| Environment | `hooks/share.ts` | Reads `HOME` and `CLAUDE_CODE_OAUTH_TOKEN`. The token is never stored or sent: only a 32-bit FNV-1a hash of it names a file, so each login gets its own file. The hash cannot recover the token, but it is a stable id for the login on this machine. |
| File writes | `hooks/share.ts` | `~/.cache/claude-usage/usage-<hash>.json`: the five-hour and seven-day usage percentages and reset times, nothing else. |
| Processes | `hooks/tint.ts` | `defaults read -g AppleInterfaceStyle` and `sh -c 'printf %s "$TERM_PROGRAM"'`, fixed arguments with no outside input, 2 s timeout, at most every 5 s while something is drawn. |
| Persistent storage | `hooks/bars.tsx` | `$.store`: the progress bars of the last 20 sessions, so a resumed session finds its bars. |
| Session state | `types/index.d.ts` | `$.state` keys under `watt.*`: chips, tool durations, turn stats, settings, bars. |
| Prompt changes | `hooks/bars.tsx`, `hooks/register.tsx` | Adds one system prompt section (the progress bar rules) to the main conversation, and short notes after tool results or prompts (a bar to update, a waiting bar). |
| Tool gating | `hooks/bars.tsx` | Refuses the main conversation's fourth file edit once when multi-step work has no progress bar, telling Claude to create one. Subagents are never gated. |
| Registered tool | `hooks/bars.tsx` | `plan_progress`: draws bars; it reads and writes nothing outside the mod's own state. |
| Sounds | `sounds/*.wav` | Played through `$.audio.play` when work ends, fails or waits. |

## Review notes

- There are no runtime dependencies; the only third-party code is the MIT-licensed plan-progress port listed in
  `plugins/watt/NOTICE`.
