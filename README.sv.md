# watt-mods

[English](README.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Français](README.fr.md) | [Español](README.es.md) | Svenska

Claude Code-moddar av apollon. Varje mod byggs in i Claude Codes eget gränssnitt: vad som visas bredvid prompten och i
vissa fall hur Claude arbetar.

**[Livedemo](https://ytsnipers.github.io/watt-mods/)**: en omgång uppspelad med watt, ritad av watts egen renderingskod.

![watt i en Claude Code-terminal: verktygstider, omgångsrad, agentbrickor och förloppsindikatorer](docs/screenshot.png)

| Mod | Vad den gör |
| --- | --- |
| [watt](plugins/watt/README.sv.md) | Visar det som Claude Code lämnar dolt: hur lång tid varje verktygsanrop tog, kontext samt femtimmars- och sjudagarsanvändning efter varje omgång, en statusbricka per aktiv underagent och förloppsindikatorer i realtid ovanför prompten, med diskreta ljud när arbetet blir klart, misslyckas eller väntar på dig. Den ber också Claude att hålla en förloppsindikator för arbete i flera steg; se [vad det ändrar i Claudes beteende](plugins/watt/README.sv.md#vad-det-ändrar-i-claudes-beteende). |

## Installation

I Claude Code (2.1.295 eller nyare):

```
/plugin install watt --marketplace YTsnipers/watt-mods
```

Inställningar, felsökning och avinstallation finns i [watts README](plugins/watt/README.sv.md).

## Säkerhet

[SECURITY.md](SECURITY.md) (på engelska) listar allt som watt kan röra (inget nätverk, en lokal fil, två fasta lokala
kommandon) och hur du rapporterar en sårbarhet.

## Licens

MIT, se [LICENSE](LICENSE). watt innehåller kod anpassad från plan-progress (MIT); se
[plugins/watt/NOTICE](plugins/watt/NOTICE).
