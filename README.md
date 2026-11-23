# watt-mods

English | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Français](README.fr.md) | [Español](README.es.md)

Claude Code mods by apollon. Each mod adds to Claude Code's own interface: what it shows next to the prompt, and in
some cases how Claude works.

| Mod | What it does |
| --- | --- |
| [watt](plugins/watt) | Shows what Claude Code leaves hidden: how long each tool call took, context and five-hour/seven-day usage after each turn, a status chip per running subagent, and live progress bars above the prompt, with soft sounds when work ends, fails or waits for you. It also asks Claude to keep a progress bar for multi-step work; see [what it changes](plugins/watt#what-it-changes-in-claudes-behaviour). |

## Install

In Claude Code (2.1.295 or newer):

```
/plugin install watt --marketplace YTsnipers/watt-mods
```

Settings, troubleshooting and how to remove it are in the [watt README](plugins/watt).

## Security

[SECURITY.md](SECURITY.md) lists everything watt can touch (no network, one local file, two fixed local commands) and
how to report a vulnerability.

## License

MIT, see [LICENSE](LICENSE). watt includes code adapted from plan-progress (MIT); see [plugins/watt/NOTICE](plugins/watt/NOTICE).
