# P1G — Claude plugin engine build provenance 실증

## 문제

standalone `npm run build:plugin`은 ignored `dist/clad.js`가 존재하기만 하면 출처와 신선도를 검사하지 않고 출하 plugin으로 복사했다. P1P에서 그 파일이 현재 source에는 없는 60 bytes를 품은 상태가 실제로 재현됐다. root `/dist/`는 `.gitignore:17`로 제외되므로 commit이나 source의 정답으로 쓸 수 없다.

공개 npm command가 먼저 `scripts/build.mjs`를 실행하고 그 뒤에 mirror builder를 실행하도록 바꿨다 (`package.json:64`). direct builder의 계약도 두 public build command가 source-fresh root bundle을 선행한다는 사실로 맞췄다 (`scripts/build-plugin.mjs:29`, `scripts/build-plugin.mjs:123`). 회귀 테스트는 이 순서를 고정한다 (`tests/scripts/hooks-config.test.ts:86`).

## 결손 입력 양성 대조

기존 ignored root bundle을 저장소 밖 임시 디렉터리로 이동해 `dist/clad.js`가 없는 것을 먼저 확인하고 standalone command를 실행했다.

```text
pre_state_root_exists=no
command=npm run build:plugin
command_expansion=node scripts/build.mjs && node scripts/build-plugin.mjs
old_ignored_root_sha=664a2fc876b987bea96747a42071d6a959d039aa19cde8d7e188ba1db1bd7c04
new_root_sha=2e87133715a75f1aa6db43fc84fd3c6f01dd912a4b2a809c24e1bf1e9943596e
plugin_sha=2e87133715a75f1aa6db43fc84fd3c6f01dd912a4b2a809c24e1bf1e9943596e
cmp_exit=0
```

새 source build는 이미 커밋된 plugin mirror와 byte-identical했다. 따라서 P1B에서 mirror를 stale root 쪽으로 바꾸지 않은 결정이 옳았고, 오염은 ignored root에만 있었다.

보관한 이전 root bundle은 삭제하지 않고 `/Users/qwerfunch/.Trash/cladding-p1g-build.9HC6My/stale-clad.js`로 이동했다.

## 결정성 및 실제 loader

같은 command를 두 번째 실행한 뒤 root/plugin SHA는 네 자리 모두 동일했고 tracked 생성 diff는 0개였다.

```text
first_root=2e87133715a75f1aa6db43fc84fd3c6f01dd912a4b2a809c24e1bf1e9943596e
first_plugin=2e87133715a75f1aa6db43fc84fd3c6f01dd912a4b2a809c24e1bf1e9943596e
second_root=2e87133715a75f1aa6db43fc84fd3c6f01dd912a4b2a809c24e1bf1e9943596e
second_plugin=2e87133715a75f1aa6db43fc84fd3c6f01dd912a4b2a809c24e1bf1e9943596e
```

`claude --plugin-dir plugins/claude-code plugin list`는 `cladding@inline`, version 0.9.3, `Status: ✔ loaded`를 냈고 Duplicate hooks 오류는 없었다. source-first build와 표준 hook 자동발견이 함께 실제 host loader를 통과했다.
