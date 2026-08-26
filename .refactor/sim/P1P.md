# P1P — 표준 hook 자동발견 핀 재협상 기록

## 핀 변경의 독립 검증

Claude Code 2.1.224가 자동발견하는 `plugins/claude-code/hooks/hooks.json`은 그대로 두고, 같은 파일을 다시 가리키던 manifest `hooks` 필드만 제거했다. 기존 다섯 event와 matcher 단언은 유지했고, manifest 단언은 “표준 파일을 중복 선언하지 않는다”로 바꿨다 (`tests/scripts/hooks-config.test.ts:68`).

수정 전 actual session-only loader:

```text
cladding@inline
Version: 0.9.3
Status: ✘ loaded with errors
Error: Hook load failed: Duplicate hooks file detected
```

수정 후 같은 `claude --plugin-dir plugins/claude-code plugin list`:

```text
cladding@inline
Version: 0.9.3
Status: ✔ loaded
```

`claude plugin validate .`도 exit 0이었지만 수정 전에도 통과했으므로 이 결함의 오라클로 세지 않는다. 실제 loader 상태 변화만 양성 증거다.

## 범위 위반 신호

AGENTS.md가 요구하는 `npm run build:plugin`을 실행하자 manifest 외에 `plugins/claude-code/dist/clad.js`가 바뀌었다. 현재 root `dist/clad.js`와 생성 mirror SHA-256은 `664a2fc876b987bea96747a42071d6a959d039aa19cde8d7e188ba1db1bd7c04`로 같았고, 커밋된 plugin mirror는 `2e87133715a75f1aa6db43fc84fd3c6f01dd912a4b2a809c24e1bf1e9943596e`였다.

공통 prefix/suffix를 제거한 실제 delta는 source의 missing-tool 분류 정규식에 이미 있는 다음 60 bytes다.

```text
failed to load\\b.{0,40}\\b(module|rule|plugin|preset|config)|
```

P1P의 `touch_allowed` 밖이므로 생성된 mirror 변경은 HEAD로 복원했다. P1P는 FAIL로 닫았다.

## P1B 입장검사에서 정정된 provenance

위 60 bytes가 `src/stages/util.ts:56`에 있다는 최초 해석은 틀렸다. 그 줄의 현재 정규식에는 해당 분기가 없고 repo 전체 canonical source 검색도 0건이었다. 또한 root `/dist/`는 `.gitignore:17`로 제외되어 현재 checkout이나 commit의 정답이 아니다. 반면 `plugins/claude-code/dist/clad.js`는 추적되는 출하 artifact다.

즉 standalone `build:plugin`이 출처 없는 로컬 root bundle을 출하 mirror에 복사한 것이며, plugin mirror를 root에 맞추는 P1B는 잘못된 방향이다. P1B는 제품 파일을 건드리기 전에 KILL한다. P1G가 `build:plugin` 자체를 source-first로 만든 뒤 생성 결과를 다시 측정한다.
