# P1R — Claude Code dogfood hook 실복구

## 복구 전 독립 상태

P1 시작 시 Claude registry에는 project-scope `claude-code@cladding` 0.4.0 설치가 두 개 있었고, marketplace는 이미 삭제된 `/Users/qwerfunch/.claude/plugins/cladding` directory를 가리켰다. 0.4.0 cache에는 hooks와 bundled engine이 없어 두 설치 모두 `cache-miss`로 load 실패했다.

P1이 current-checkout marketplace 선언을 추가했고 (`.claude/settings.json:5`), P1P는 Claude Code 2.1.224가 자동발견하는 표준 `hooks/hooks.json`을 manifest에서 중복 선언하지 않게 했다 (`tests/scripts/hooks-config.test.ts:71`). P1G는 standalone plugin build가 ignored root bundle을 정답으로 오인하지 않도록 source-first로 만들었다 (`package.json:64`).

## 실제 marketplace와 설치 복구

공유 설정에는 이식 가능한 `path: "."`을 유지했다. CLI 등록은 이를 user registry의 절대 checkout 경로로 해석했다.

```text
marketplace=cladding
source=directory
path=/Users/qwerfunch/Developer/work/cladding
installLocation=/Users/qwerfunch/Developer/work/cladding
```

동일 `0.9.3` cache가 이전 GitHub 등록 때 이미 생겨 단순 update는 version만 바꾸고 stale manifest를 재사용했다. 현재 프로젝트 설치만 `--keep-data`로 uninstall/install하여 cache 내용을 강제로 현재 checkout에서 다시 복사했다. 다른 `/Users/qwerfunch/Developer/work/logcat-on`의 0.4.0 project 설치는 범위 밖이라 변경하지 않았다.

```text
projectPath=/Users/qwerfunch/Developer/work/cladding
version=0.9.3
installPath=/Users/qwerfunch/.claude/plugins/cache/cladding/claude-code/0.9.3
status=enabled
cache_manifest_has_explicit_hooks=false
cache_hooks_file=true
checkout_engine_sha=2e87133715a75f1aa6db43fc84fd3c6f01dd912a4b2a809c24e1bf1e9943596e
cache_engine_sha=2e87133715a75f1aa6db43fc84fd3c6f01dd912a4b2a809c24e1bf1e9943596e
```

## 실제 cache의 hook 발화

설치된 cache engine을 Claude의 shipped command와 같은 인자로 직접 실행했다.

```text
printf '{}' | node <cache>/dist/clad.js hook SessionStart
hook_exit=0
stdout_bytes=652
```

출력은 `cladding: 273 features (269 done, 0 in progress) · 2 scenarios`로 시작했고, 마지막 strict gate GREEN, context, 두 prefer 규칙, spec policy를 포함했다. 동시에 `.cladding/events.log.jsonl`에 다음 관측이 추가됐다.

```text
type=session_card_rendered
payload.bytes=651
head=c72616ad16035a4c4b07cf0bb37d9e5afd9d797b
```

stdout의 마지막 newline이 event payload byte 수에 포함되지 않아 `wc -c`와 1 byte 차이다. loader 등록, cache 내용, engine parity, command 출력, telemetry의 다섯 독립 표면이 모두 이어졌으므로 P1R은 PASS다. 새 Claude Code 세션부터 host가 복구된 plugin을 적용한다.
