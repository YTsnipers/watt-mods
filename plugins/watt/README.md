# watt

A Claude Code mod that shows how work is going without leaving the prompt.

- **Tool call times**: each finished tool call's row ends with how long it took.
- **Turn line**: the duration line of a main turn carries the context used (of the model's window) and the five-hour and seven-day usage, orange then red past their marks.
- **Agent row**: one chip per running subagent, with its model, elapsed time and context fill; a finished chip turns green or red and stays for a few seconds or until its × is pressed.
- **Progress bars**: the `plan_progress` tool draws live bars above the prompt for multi-step work (ported from plan-progress, MIT, Kirill Serditov).
- **Sounds**: a soft sound when a long turn or all subagents end, the error one when something failed, and the decision one when Claude waits for you.

## Use

Install it in Claude Code:

```
/plugin install watt --marketplace YTsnipers/watt-mods
```

Then open `/watt-settings` to turn the twinkle, the sounds or the model on chips on and off, and to set how long finished chips and bars stay. `/progress` hides or shows the bars, and `/progress-clear` removes them.

After editing the source, run `/reload-plugins` in Claude Code to load the change.

## Develop

```sh
claude plugin validate .
claude plugin test .
```
