# watt-mods

[English](README.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md) | 日本語 | [한국어](README.ko.md) | [Français](README.fr.md) | [Español](README.es.md) | [Svenska](README.sv.md)

apollon による Claude Code の mod 集です。各 mod は Claude Code のインターフェースそのものに機能を加えます。プロンプトの横に
情報を表示するものもあれば、Claude の動き方を変えるものもあります。

**[ライブデモ](https://ytsnipers.github.io/watt-mods/)**：watt 自身の描画コードで 1 ターンを再生します。

![Claude Code のターミナルで動く watt：ツールの所要時間、ターン行、エージェントチップ、進捗バー](docs/screenshot.png)

| Mod | 機能 |
| --- | --- |
| [watt](plugins/watt/README.ja.md) | Claude Code が表示しない情報を見せます。各ツール呼び出しにかかった時間、ターンごとの context と 5 時間／7 日間の使用量、実行中のサブエージェントごとのステータスチップ、プロンプト上部のリアルタイム進捗バー。作業の終了・失敗・あなたの返答待ちのときには控えめな音が鳴ります。また、複数ステップの作業では進捗バーを保つよう Claude に求めます。詳しくは[Claude の動作への影響](plugins/watt/README.ja.md#claude-の動作への影響)を参照してください。 |

## インストール

Claude Code（2.1.295 以降）で：

```
/plugin install watt --marketplace YTsnipers/watt-mods
```

設定、トラブルシューティング、アンインストール方法は [watt README](plugins/watt/README.ja.md) にあります。

## セキュリティ

[SECURITY.md](SECURITY.md)（英語）に、watt が触れるものをすべて載せています（ネットワーク通信なし、ローカルファイル 1 つ、
固定のローカルコマンド 2 つ）。脆弱性の報告方法も記載しています。

## ライセンス

MIT。[LICENSE](LICENSE) を参照してください。watt には plan-progress（MIT）から移植したコードが含まれます。
[plugins/watt/NOTICE](plugins/watt/NOTICE) を参照してください。
