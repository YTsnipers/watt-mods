# watt

[English](README.md) | 繁體中文 | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Français](README.fr.md) | [Español](README.es.md) | [Svenska](README.sv.md)

Claude Code 不會顯示每個工具呼叫花了多久、五小時與七天用量還剩多少，也看不到每個子代理在做什麼。watt 把這些都畫在終端機
的提示列旁邊。

**[線上 demo](https://ytsnipers.github.io/watt-mods/)**：用 watt 自己的繪圖程式重播一個回合。

![watt 在 Claude Code 終端機中：工具耗時、回合摘要行、子代理標籤與進度條](../../docs/screenshot.png)

- **工具呼叫耗時**：每個完成的工具呼叫，該列結尾會標出花了多久，例如 `took 1.2s`。
- **回合摘要行**：主回合的耗時行下方，顯示已用的 context（以該模型自己的上限計算）與五小時、七天用量，超過門檻先變橘、
  再變紅。
- **代理列**：提示列上方一列，每個執行中的子代理一個標籤（小狀態框），顯示它的模型、經過時間與 context 用量。完成的標籤
  轉綠或轉紅，停留幾秒，或直到按下它的 ×。
- **進度條**：多步驟工作時，`plan_progress` 工具會在提示列上方畫出即時的階段進度條，讓你看到 Claude 做到哪一步（移植自
  [plan-progress](https://github.com/zycck/claude-mods)，MIT，Kirill Serditov）。
- **提示音**：長回合或所有子代理結束時播放輕柔提示音；有東西失敗時播錯誤音；Claude 等你回覆時播決策音。

## 需求

- Claude Code 2.1.295 以上（`claude --version`）。
- 在 macOS 上，watt 會跟隨系統的淺色／深色外觀。其他平台一律以深色背景繪製，除非 `/config` 的主題設成淺色。

## 安裝與移除

```
/plugin install watt --marketplace YTsnipers/watt-mods
```

```
/plugin uninstall watt@watt-mods
```

## 對 Claude 行為的改變

watt 不只負責畫面。安裝前請先知道它會：

- **加一段 system prompt** 到主對話：使用進度條的規則，每次請求約 150 tokens。子代理不會收到。
- **擋下一次檔案編輯**：主對話第四次編輯檔案（Edit、Write、MultiEdit、NotebookEdit）時若還沒有進度條，該次編輯會被
  擋下一次，並要求 Claude 先建立進度條。Shell 指令與子代理永遠不會被擋。
- **加上簡短提醒**：開著的進度條連續幾次編輯都沒更新時，會在工具結果後面提醒 Claude。
- **回合結束時把 Claude 送回去一次**：如果這回合有做事、留著沒關的進度條、又沒有問你任何問題，Claude 會多跑一輪來更新
  進度條，這一輪的 token 會計入用量。回合若以提問結束，進度條會改標成「等你回覆」；回合若在等背景工作，則直接放行。
- **寫一個本機檔**：`~/.cache/claude-usage/usage-<hash>.json`，內容是用量百分比，供
  [CC Switch](https://github.com/farion1231/cc-switch) 顯示。不會透過網路傳送任何資料。

watt 能碰到的完整清單見 [SECURITY.md](../../SECURITY.md)（英文）。

## 設定

| 指令 | 功能 |
| --- | --- |
| `/watt-settings` | 開關進度條填色的閃爍動畫、提示音、標籤上的模型名稱；設定完成的標籤與進度條停留多久。同樣的選項也在 `/config` 的 watt 底下。 |
| `/progress` | 隱藏或顯示進度條 |
| `/progress-clear` | 移除所有進度條 |

## 疑難排解

- **對話裡沒有 `plan_progress` 工具**：防毒軟體的網頁過濾（例如 AVG Web Shield）或 proxy 擋住了 127.0.0.1，而這個工具
  要透過它連到對話。把 127.0.0.1 加進過濾例外，或設定 `NO_PROXY=127.0.0.1,localhost`，再重開 Claude Code。如果都不是，
  檢查上面的版本需求。
- **耗時行後面的數字不見了**：另一個 mod 畫了這一行卻沒有往下傳（例如
  [prismantis](https://github.com/NahumLitvin/prismantis)，見
  [issue #601](https://github.com/NahumLitvin/prismantis/issues/601)）。在 `~/.claude/settings.json` 加入下面這行讓 watt
  先載入，再執行 `/reload-plugins`：

  ```json
  "prependPlugins": ["watt@watt-mods"]
  ```

## 開發

程式碼結構見 [AGENTS.md](../../AGENTS.md)（英文）。在 `plugins/watt` 底下執行：

```sh
claude plugin validate .
claude plugin test .
```

改完原始碼後，在 Claude Code 執行 `/reload-plugins` 載入變更。
