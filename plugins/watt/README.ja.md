# watt

[English](README.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md) | 日本語 | [한국어](README.ko.md) | [Français](README.fr.md) | [Español](README.es.md)

Claude Code は、各ツール呼び出しにかかった時間も、5 時間と 7 日間の使用量の残りも、各サブエージェントが何をしているかも
表示しません。watt はそれらをすべて、ターミナルのプロンプトの横に描きます。

**[ライブデモ](https://ytsnipers.github.io/watt-mods/)**：watt 自身の描画コードで 1 ターンを再生します。

![Claude Code のターミナルで動く watt：ツールの所要時間、ターン行、エージェントチップ、進捗バー](../../docs/screenshot.png)

- **ツール呼び出しの所要時間**：完了したツール呼び出しの行の末尾に、かかった時間を表示します（例：`took 1.2s`）。
- **ターン行**：メインターンの所要時間の行の下に、使用中の context（モデル自身の上限に対する割合）と 5 時間・7 日間の
  使用量を表示します。しきい値を超えるとオレンジ、さらに赤になります。
- **エージェント行**：プロンプトの上に、実行中のサブエージェントごとにチップ（小さなステータス枠）を並べます。モデル、
  経過時間、context の使用量を表示します。終了したチップは緑か赤になり、数秒間、または × を押すまで残ります。
- **進捗バー**：複数ステップの作業では、`plan_progress` ツールがプロンプトの上にリアルタイムの段階別バーを描くので、Claude が
  どのステップにいるかがわかります（[plan-progress](https://github.com/zycck/claude-mods) から移植、MIT、Kirill Serditov）。
- **サウンド**：長いターンやすべてのサブエージェントが終わったときに控えめな音、何かが失敗したときにエラー音、Claude が
  あなたの返答を待つときに確認音が鳴ります。

## 動作要件

- Claude Code 2.1.295 以降（`claude --version`）。
- macOS では、watt はシステムのライト／ダーク外観に従います。ほかのプラットフォームでは、`/config` のテーマがライトで
  ない限り、暗い背景向けに描画します。

## インストールと削除

```
/plugin install watt --marketplace YTsnipers/watt-mods
```

```
/plugin uninstall watt@watt-mods
```

## Claude の動作への影響

watt は描画だけをするわけではありません。インストール前に、次の点を確認してください。

- **system prompt に 1 節を追加します**：メインの会話に、進捗バーの使い方のルールを追加します。リクエストごとに約 150
  tokens です。サブエージェントには追加されません。
- **ファイル編集を 1 回拒否します**：メインの会話が進捗バーなしで 4 回目のファイル編集（Edit、Write、MultiEdit、
  NotebookEdit）をすると、その編集を 1 回だけ拒否し、先にバーを作るよう Claude に伝えます。シェルコマンドと
  サブエージェントは拒否されません。
- **短いリマインダーを追加します**：開いているバーが数回の編集のあいだ更新されていないと、ツール結果のあとに通知します。
- **ターンの終わりに Claude を 1 回差し戻します**：作業をしたターンが、あなたに何も質問せずにバーを開いたまま終わると、
  Claude はバーを更新するためにもう 1 ラウンド動き、その分の tokens を消費します。質問で終わったターンでは、代わりに
  バーを「返答待ち」にします。バックグラウンド作業を待っているターンはそのまま終わります。
- **ローカルファイルを 1 つ書き込みます**：`~/.cache/claude-usage/usage-<hash>.json` に使用率を書き込み、
  [CC Switch](https://github.com/farion1231/cc-switch) アプリが表示します。ネットワークには何も送信しません。

watt が触れるものの完全な一覧は [SECURITY.md](../../SECURITY.md)（英語）にあります。

## 設定

| コマンド | 機能 |
| --- | --- |
| `/watt-settings` | バーの塗りのきらめき（ドットのアニメーション）、サウンド、チップ上のモデル表示をオン／オフします。終了したチップとバーを残す時間も設定できます。同じ項目は `/config` の watt にもあります。 |
| `/progress` | 進捗バーの表示／非表示 |
| `/progress-clear` | すべての進捗バーを削除 |

## トラブルシューティング

- **セッションに `plan_progress` ツールがない**：ウイルス対策ソフトの Web フィルター（AVG Web Shield など）かプロキシが、
  ツールがセッションに接続するための 127.0.0.1 をブロックしています。127.0.0.1 をフィルターの例外に追加するか、
  `NO_PROXY=127.0.0.1,localhost` を設定してから Claude Code を再起動してください。それでも解決しない場合は、上記の
  バージョン要件を確認してください。
- **ターンの所要時間の行のあとに数字が出ない**：別の mod がその行を描いて、次に渡していません（たとえば
  [prismantis](https://github.com/NahumLitvin/prismantis)。[issue #601](https://github.com/NahumLitvin/prismantis/issues/601)
  を参照）。`~/.claude/settings.json` に次を追加して watt を先に読み込み、`/reload-plugins` を実行してください：

  ```json
  "prependPlugins": ["watt@watt-mods"]
  ```

## 開発

コードの構成は [AGENTS.md](../../AGENTS.md)（英語）を参照してください。`plugins/watt` で：

```sh
claude plugin validate .
claude plugin test .
```

ソースを編集したら、Claude Code で `/reload-plugins` を実行して変更を読み込みます。
