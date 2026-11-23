# watt-mods

[English](README.md) | 繁體中文 | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Français](README.fr.md) | [Español](README.es.md)

apollon 做的 Claude Code mod。每個 mod 都直接加在 Claude Code 的介面上：有的在提示列旁邊多顯示資訊，有的也會改變
Claude 的工作方式。

**[線上 demo](https://ytsnipers.github.io/watt-mods/)**：用 watt 自己的繪圖程式重播一個回合。

| Mod | 功能 |
| --- | --- |
| [watt](plugins/watt/README.zh-TW.md) | 顯示 Claude Code 沒告訴你的資訊：每個工具呼叫花了多久、每回合結束後的 context 與五小時／七天用量、每個執行中子代理的狀態標籤，以及提示列上方的即時進度條。工作結束、失敗或等你回覆時會播放輕柔的提示音。它也會要求 Claude 在多步驟工作時維護進度條，詳見[對 Claude 行為的改變](plugins/watt/README.zh-TW.md#對-claude-行為的改變)。 |

## 安裝

在 Claude Code（2.1.295 以上）輸入：

```
/plugin install watt --marketplace YTsnipers/watt-mods
```

設定、疑難排解與移除方式見 [watt README](plugins/watt/README.zh-TW.md)。

## 安全性

[SECURITY.md](SECURITY.md)（英文）列出 watt 能碰到的所有東西：不連網、只寫一個本機檔、只跑兩個固定的本機指令，也說明如何
回報漏洞。

## 授權

MIT，見 [LICENSE](LICENSE)。watt 含有改寫自 plan-progress（MIT）的程式碼，見 [plugins/watt/NOTICE](plugins/watt/NOTICE)。
