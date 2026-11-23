# watt-mods

[English](README.md) | [繁體中文](README.zh-TW.md) | 简体中文

apollon 做的 Claude Code mod。每个 mod 都直接加在 Claude Code 的界面上：有的在输入框旁边多显示信息，有的也会改变
Claude 的工作方式。

| Mod | 功能 |
| --- | --- |
| [watt](plugins/watt/README.zh-CN.md) | 显示 Claude Code 没告诉你的信息：每个工具调用花了多久、每轮结束后的 context 与五小时／七天用量、每个运行中子代理的状态标签，以及输入框上方的实时进度条。工作结束、失败或等你回复时会播放轻柔的提示音。它也会要求 Claude 在多步骤工作时维护进度条，详见[对 Claude 行为的改变](plugins/watt/README.zh-CN.md#对-claude-行为的改变)。 |

## 安装

在 Claude Code（2.1.295 及以上）输入：

```
/plugin install watt --marketplace YTsnipers/watt-mods
```

设置、故障排查与卸载方式见 [watt README](plugins/watt/README.zh-CN.md)。

## 安全

[SECURITY.md](SECURITY.md)（英文）列出 watt 能接触的所有东西：不联网、只写一个本地文件、只运行两个固定的本地命令，也说明
如何报告漏洞。

## 许可证

MIT，见 [LICENSE](LICENSE)。watt 包含改写自 plan-progress（MIT）的代码，见 [plugins/watt/NOTICE](plugins/watt/NOTICE)。
