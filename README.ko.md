# watt-mods

[English](README.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | 한국어 | [Français](README.fr.md) | [Español](README.es.md)

apollon이 만든 Claude Code mod 모음입니다. 각 mod는 Claude Code 인터페이스 자체에 기능을 더합니다. 프롬프트 옆에 정보를
보여 주는 것도 있고, Claude가 일하는 방식을 바꾸는 것도 있습니다.

**[라이브 데모](https://ytsnipers.github.io/watt-mods/)**: watt 자체 그리기 코드로 한 턴을 재생합니다.

| Mod | 기능 |
| --- | --- |
| [watt](plugins/watt/README.ko.md) | Claude Code가 보여 주지 않는 정보를 표시합니다. 각 도구 호출에 걸린 시간, 턴마다의 context와 5시간/7일 사용량, 실행 중인 서브에이전트별 상태 칩, 프롬프트 위의 실시간 진행 바. 작업이 끝나거나 실패하거나 사용자의 답을 기다릴 때 부드러운 소리가 납니다. 또한 여러 단계로 된 작업에서는 Claude에게 진행 바를 유지하도록 요청합니다. 자세한 내용은 [Claude 동작에 미치는 영향](plugins/watt/README.ko.md#claude-동작에-미치는-영향)을 참고하세요. |

## 설치

Claude Code(2.1.295 이상)에서:

```
/plugin install watt --marketplace YTsnipers/watt-mods
```

설정, 문제 해결, 제거 방법은 [watt README](plugins/watt/README.ko.md)에 있습니다.

## 보안

[SECURITY.md](SECURITY.md)(영어)에 watt가 접근하는 모든 것을 적어 두었습니다(네트워크 없음, 로컬 파일 1개, 고정된 로컬 명령
2개). 취약점 신고 방법도 있습니다.

## 라이선스

MIT, [LICENSE](LICENSE)를 참고하세요. watt에는 plan-progress(MIT)에서 가져온 코드가 포함되어 있습니다.
[plugins/watt/NOTICE](plugins/watt/NOTICE)를 참고하세요.
