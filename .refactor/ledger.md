# 0.10.0 작업 원장

루프가 매 항목마다 한 줄을 추가한다. 규칙은 `.refactor/PLAN.md` §1~§2.
`status`: `IN_PROGRESS` → 항목을 시작할 때 · `DONE` / `FAIL` / `KILLED` → 끝날 때.
`IN_PROGRESS`로 끝나 있으면 컨텍스트를 잃은 것이므로 PLAN.md §5 "중간 복구"를 따른다.

| id | status | commit | 날짜 | 결과 |
|---|---|---|---|---|
| S1 | DONE | 3c61dfc | 2026-08-10 | 이벤트 로그의 고유 head 251개를 `refs/replay/*`로 고정, 소실 0. 자동 `git gc`로부터 리플레이 코퍼스 보호됨 |
| S2 | KILLED | (이 커밋) | 2026-08-10 | M5 KILL — 로컬 CLI의 TTY·확인 문구·git/OS identity로 사람 출처를 검증할 수 없어 A10·A11을 큐에서 제거함 |
| S3 | DONE | (이 커밋) | 2026-08-10 | M7 PASS — Jest 30.2.0 all-skipped가 strict Unit을 통과하는 실제 갭 확인; 기존 JSON 파서는 호환되어 A6 Jest 범위 유지 |
| S4 | DONE | (이 커밋) | 2026-08-10 | 5b PASS — Git rename 기반 module claim 수리 14/14·오탐 0; 실증 없는 basename fallback은 제안-only로 축소 |
| P1 | FAIL | (이 커밋) | 2026-08-10 | marketplace source 누락은 확인·수정; Claude 2.1.224의 표준 hook 자동발견과 manifest 중복 선언이 기존 핀 테스트와 충돌해 P1P로 분리 |
| P1P | FAIL | (이 커밋) | 2026-08-10 | inline loader는 정상화됐으나 build:plugin이 허용 밖 stale engine mirror 60-byte delta를 발견해 P1B로 분리 |
| P1B | KILLED | (이 커밋) | 2026-08-10 | precondition 반증 — root dist는 gitignored이고 60-byte delta가 source에 없어 plugin mirror의 정답으로 사용할 수 없음 |
| P1G | DONE | (이 커밋) | 2026-08-10 | build:plugin을 source-first로 복구; root 결손 양성 대조·2회 결정성·plugin byte parity·actual loader 모두 통과 |
| P1R | DONE | (이 커밋) | 2026-08-10 | project 0.9.3 cache·hooks·engine parity 복구; cached SessionStart exit 0/context card/session_card_rendered 실증 |
| P2 | DONE | (이 커밋) | 2026-08-10 | 실제 bundle 5종 hook pulse·package-less cache·doctor text/JSON 검증; matrix 신선도 info; 2828/2828·verdict DONE·strict gate GREEN |
| P3 | DONE | (이 커밋) | 2026-08-10 | Stop·done·gate blocker와 알려진 실패 종료를 additive telemetry로 기록하고 후속 gate 관측을 doctor에서 집계; 실제 bundle 순차 검증·2834/2834 통과 |
