# watt

English | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Français](README.fr.md) | [Español](README.es.md)

Claude Code does not show how long each tool call took, how much of your five-hour and seven-day usage is left, or
what each subagent is doing. watt draws all of that in the terminal, next to the prompt.

- **Tool call times**: each finished tool call's row ends with how long it took, e.g. `took 1.2s`.
- **Turn line**: the line under a main turn's duration carries the context used (against the model's own window) and
  the five-hour and seven-day usage, orange then red past their marks.
- **Agent row**: a row above the prompt with one chip (a small status box) per running subagent: its model, elapsed
  time and context fill. A finished chip turns green or red and stays for a few seconds, or until its × is pressed.
- **Progress bars**: the `plan_progress` tool draws live stage bars above the prompt for multi-step work, so you can
  see which step Claude is on (ported from [plan-progress](https://github.com/zycck/claude-mods), MIT, Kirill Serditov).
- **Sounds**: a soft sound when a long turn or all subagents end, the error one when something failed, and the decision
  one when Claude waits for you.

## Requirements

- Claude Code 2.1.295 or newer (`claude --version`).
- On macOS, watt follows the system light or dark appearance. On other platforms it draws for a dark background
  unless the `/config` theme is a light one.

## Install and remove

```
/plugin install watt --marketplace YTsnipers/watt-mods
```

```
/plugin uninstall watt@watt-mods
```

## What it changes in Claude's behaviour

watt does more than draw. Before installing, know that it:

- **Adds a system prompt section** to the main conversation: the rules for using progress bars, one paragraph of about
  150 tokens on every request. Subagents do not get it.
- **Refuses one file edit**: when the main conversation makes its fourth file edit (Edit, Write, MultiEdit,
  NotebookEdit) with no progress bar, that edit is refused once and Claude is told to create a bar first. Shell
  commands and subagents are never refused.
- **Adds short reminders** after tool results when an open bar has not been updated for several edits.
- **Sends Claude back once at the end of a turn** that did work and left a bar open without asking you anything:
  Claude gets one more round to update the bar, which costs that round's tokens. A turn that ends with a question
  marks the bar as waiting on you instead, and a turn waiting on background work is let through.
- **Writes one local file**: `~/.cache/claude-usage/usage-<hash>.json` with the usage percentages, for the
  [CC Switch](https://github.com/farion1231/cc-switch) app to show. Nothing is sent over the network.

The full list of what watt can touch is in [SECURITY.md](../../SECURITY.md).

## Settings

| Command | What it does |
| --- | --- |
| `/watt-settings` | Turn the twinkle (animated dots in the bar fill), the sounds or the model on chips on and off; set how long finished chips and bars stay. The same options are under watt in `/config`. |
| `/progress` | Hide or show the progress bars |
| `/progress-clear` | Remove all progress bars |

## Troubleshooting

- **No `plan_progress` tool in the session**: an antivirus web filter (AVG Web Shield, for one) or a proxy is blocking
  127.0.0.1, where the tool reaches the session. Add 127.0.0.1 to the filter's exceptions, or set
  `NO_PROXY=127.0.0.1,localhost`, then restart Claude Code. If that is not it, check the version requirement above.
- **The numbers after the turn's duration line are missing**: another mod drew that line without passing it on (the
  [prismantis](https://github.com/NahumLitvin/prismantis) mod does, for one;
  [issue #601](https://github.com/NahumLitvin/prismantis/issues/601)). Load watt first by adding this to
  `~/.claude/settings.json`, then run `/reload-plugins`:

  ```json
  "prependPlugins": ["watt@watt-mods"]
  ```

## Develop

Read [AGENTS.md](../../AGENTS.md) for how the code is laid out. From `plugins/watt`:

```sh
claude plugin validate .
claude plugin test .
```

After editing the source, run `/reload-plugins` in Claude Code to load the change.
