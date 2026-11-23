# watt

[English](README.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | 한국어 | [Français](README.fr.md) | [Español](README.es.md)

Claude Code는 각 도구 호출에 걸린 시간도, 5시간과 7일 사용량이 얼마나 남았는지도, 각 서브에이전트가 무엇을 하는지도
보여 주지 않습니다. watt는 이 모든 것을 터미널의 프롬프트 옆에 그립니다.

**[라이브 데모](https://ytsnipers.github.io/watt-mods/)**: watt 자체 그리기 코드로 한 턴을 재생합니다.

- **도구 호출 시간**: 끝난 도구 호출의 줄 끝에 걸린 시간을 표시합니다(예: `took 1.2s`).
- **턴 요약 줄**: 메인 턴의 소요 시간 줄 아래에 사용 중인 context(모델 자체 한도 기준)와 5시간·7일 사용량을 표시합니다.
  기준을 넘으면 주황색, 그다음 빨간색이 됩니다.
- **에이전트 줄**: 프롬프트 위에 실행 중인 서브에이전트마다 칩(작은 상태 상자)을 하나씩 보여 줍니다. 모델, 경과 시간,
  context 사용량이 나옵니다. 끝난 칩은 초록색이나 빨간색으로 바뀌고 몇 초 동안, 또는 ×를 누를 때까지 남습니다.
- **진행 바**: 여러 단계로 된 작업에서 `plan_progress` 도구가 프롬프트 위에 실시간 단계별 바를 그려, Claude가 어느 단계에
  있는지 볼 수 있습니다([plan-progress](https://github.com/zycck/claude-mods)에서 이식, MIT, Kirill Serditov).
- **소리**: 긴 턴이나 모든 서브에이전트가 끝나면 부드러운 소리, 무언가 실패하면 오류음, Claude가 사용자의 답을 기다리면
  결정음이 납니다.

## 요구 사항

- Claude Code 2.1.295 이상(`claude --version`).
- macOS에서는 시스템의 라이트/다크 모드를 따릅니다. 다른 플랫폼에서는 `/config` 테마가 라이트가 아니면 어두운 배경에 맞춰
  그립니다.

## 설치와 제거

```
/plugin install watt --marketplace YTsnipers/watt-mods
```

```
/plugin uninstall watt@watt-mods
```

## Claude 동작에 미치는 영향

watt는 화면에 그리기만 하지 않습니다. 설치하기 전에 다음을 알아 두세요.

- **system prompt에 한 단락을 추가합니다**: 메인 대화에 진행 바 사용 규칙을 넣습니다. 요청마다 약 150 tokens입니다.
  서브에이전트에는 추가되지 않습니다.
- **파일 편집을 한 번 거부합니다**: 메인 대화가 진행 바 없이 네 번째 파일 편집(Edit, Write, MultiEdit, NotebookEdit)을
  하면 그 편집을 한 번 거부하고 Claude에게 먼저 바를 만들라고 알립니다. 셸 명령과 서브에이전트는 거부되지 않습니다.
- **짧은 알림을 추가합니다**: 열린 바가 여러 번의 편집 동안 갱신되지 않으면 도구 결과 뒤에 알립니다.
- **턴이 끝날 때 Claude를 한 번 되돌려 보냅니다**: 작업을 한 턴이 사용자에게 아무것도 묻지 않고 바를 열어 둔 채 끝나면,
  Claude는 바를 갱신하기 위해 한 라운드를 더 돌고 그만큼 tokens를 씁니다. 질문으로 끝난 턴은 대신 바를 '답변 대기'로
  표시하고, 백그라운드 작업을 기다리는 턴은 그대로 끝납니다.
- **로컬 파일 하나를 씁니다**: `~/.cache/claude-usage/usage-<hash>.json`에 사용률을 기록하며,
  [CC Switch](https://github.com/farion1231/cc-switch) 앱이 이를 표시합니다. 네트워크로는 아무것도 보내지 않습니다.

watt가 접근하는 전체 목록은 [SECURITY.md](../../SECURITY.md)(영어)에 있습니다.

## 설정

| 명령 | 기능 |
| --- | --- |
| `/watt-settings` | 바 채우기의 반짝임(점 애니메이션), 소리, 칩의 모델 표시를 켜고 끕니다. 끝난 칩과 바가 남는 시간도 정합니다. 같은 항목이 `/config`의 watt 아래에도 있습니다. |
| `/progress` | 진행 바 숨기기/보이기 |
| `/progress-clear` | 모든 진행 바 제거 |

## 문제 해결

- **세션에 `plan_progress` 도구가 없음**: 백신의 웹 필터(예: AVG Web Shield)나 프록시가 127.0.0.1을 막고 있습니다. 이
  도구는 127.0.0.1을 통해 세션에 연결됩니다. 127.0.0.1을 필터 예외에 추가하거나 `NO_PROXY=127.0.0.1,localhost`를
  설정한 뒤 Claude Code를 다시 시작하세요. 그래도 안 되면 위의 버전 요구 사항을 확인하세요.
- **턴 소요 시간 줄 뒤에 숫자가 없음**: 다른 mod가 그 줄을 그리고 다음으로 넘기지 않았습니다(예:
  [prismantis](https://github.com/NahumLitvin/prismantis),
  [issue #601](https://github.com/NahumLitvin/prismantis/issues/601) 참고). `~/.claude/settings.json`에 다음을 추가해
  watt를 먼저 불러오고 `/reload-plugins`를 실행하세요:

  ```json
  "prependPlugins": ["watt@watt-mods"]
  ```

## 개발

코드 구조는 [AGENTS.md](../../AGENTS.md)(영어)를 참고하세요. `plugins/watt`에서:

```sh
claude plugin validate .
claude plugin test .
```

소스를 고친 뒤 Claude Code에서 `/reload-plugins`를 실행하면 변경 사항이 적용됩니다.
