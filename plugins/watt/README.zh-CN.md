# watt

[English](README.md) | [繁體中文](README.zh-TW.md) | 简体中文 | [日本語](README.ja.md) | [한국어](README.ko.md) | [Français](README.fr.md) | [Español](README.es.md)

Claude Code 不会显示每个工具调用花了多久、五小时与七天用量还剩多少，也看不到每个子代理在做什么。watt 把这些都画在终端
的输入框旁边。

- **工具调用耗时**：每个完成的工具调用，该行末尾会标出花了多久，例如 `took 1.2s`。
- **本轮摘要行**：主轮耗时行下方，显示已用的 context（按该模型自己的上限计算）与五小时、七天用量，超过阈值先变橙、
  再变红。
- **代理栏**：输入框上方一栏，每个运行中的子代理一个标签（小状态框），显示它的模型、已用时间与 context 用量。完成的标签
  变绿或变红，停留几秒，或直到点击它的 ×。
- **进度条**：多步骤工作时，`plan_progress` 工具会在输入框上方画出实时的阶段进度条，让你看到 Claude 做到哪一步（移植自
  [plan-progress](https://github.com/zycck/claude-mods)，MIT，Kirill Serditov）。
- **提示音**：长轮次或所有子代理结束时播放轻柔提示音；有东西失败时播错误音；Claude 等你回复时播决策音。

## 要求

- Claude Code 2.1.295 及以上（`claude --version`）。
- 在 macOS 上，watt 会跟随系统的浅色／深色外观。其他平台一律按深色背景绘制，除非 `/config` 的主题设为浅色。

## 安装与卸载

```
/plugin install watt --marketplace YTsnipers/watt-mods
```

```
/plugin uninstall watt@watt-mods
```

## 对 Claude 行为的改变

watt 不只负责界面。安装前请先了解它会：

- **加一段 system prompt** 到主对话：使用进度条的规则，每次请求约 150 tokens。子代理不会收到。
- **拦下一次文件编辑**：主对话第四次编辑文件（Edit、Write、MultiEdit、NotebookEdit）时如果还没有进度条，该次编辑会被
  拦下一次，并要求 Claude 先创建进度条。Shell 命令与子代理永远不会被拦。
- **加上简短提醒**：打开的进度条连续几次编辑都没更新时，会在工具结果后面提醒 Claude。
- **一轮结束时把 Claude 送回去一次**：如果这一轮做了事、留着未关闭的进度条、又没有问你任何问题，Claude 会多跑一轮来更新
  进度条，这一轮的 token 会计入用量。一轮如果以提问结束，进度条会改标为「等你回复」；一轮如果在等后台任务，则直接放行。
- **写一个本地文件**：`~/.cache/claude-usage/usage-<hash>.json`，内容是用量百分比，供
  [CC Switch](https://github.com/farion1231/cc-switch) 显示。不会通过网络发送任何数据。

watt 能接触的完整清单见 [SECURITY.md](../../SECURITY.md)（英文）。

## 设置

| 命令 | 功能 |
| --- | --- |
| `/watt-settings` | 开关进度条填充的闪烁动画、提示音、标签上的模型名称；设置完成的标签与进度条停留多久。同样的选项也在 `/config` 的 watt 下面。 |
| `/progress` | 隐藏或显示进度条 |
| `/progress-clear` | 移除所有进度条 |

## 故障排查

- **会话里没有 `plan_progress` 工具**：杀毒软件的网页过滤（例如 AVG Web Shield）或代理拦截了 127.0.0.1，而这个工具
  要通过它连到会话。把 127.0.0.1 加入过滤例外，或设置 `NO_PROXY=127.0.0.1,localhost`，再重启 Claude Code。如果都不是，
  检查上面的版本要求。
- **耗时行后面的数字不见了**：另一个 mod 画了这一行却没有往下传（例如
  [prismantis](https://github.com/NahumLitvin/prismantis)，见
  [issue #601](https://github.com/NahumLitvin/prismantis/issues/601)）。在 `~/.claude/settings.json` 加入下面这行让 watt
  先加载，再运行 `/reload-plugins`：

  ```json
  "prependPlugins": ["watt@watt-mods"]
  ```

## 开发

代码结构见 [AGENTS.md](../../AGENTS.md)（英文）。在 `plugins/watt` 下运行：

```sh
claude plugin validate .
claude plugin test .
```

改完源码后，在 Claude Code 运行 `/reload-plugins` 加载改动。
