# 0.10.0 작업 원장

루프가 매 항목마다 한 줄을 추가한다. 규칙은 `.refactor/PLAN.md` §1~§2.
`status`: `IN_PROGRESS` → 항목을 시작할 때 · `DONE` / `FAIL` / `KILLED` → 끝날 때.
`IN_PROGRESS`로 끝나 있으면 컨텍스트를 잃은 것이므로 PLAN.md §5 "중간 복구"를 따른다.

| id | status | commit | 날짜 | 결과 |
|---|---|---|---|---|
| S1 | DONE | 3c61dfc | 2026-08-10 | 이벤트 로그의 고유 head 251개를 `refs/replay/*`로 고정, 소실 0. 자동 `git gc`로부터 리플레이 코퍼스 보호됨 |
| S2 | KILLED | (이 커밋) | 2026-08-10 | M5 KILL — 로컬 CLI의 TTY·확인 문구·git/OS identity로 사람 출처를 검증할 수 없어 A10·A11을 큐에서 제거함 |
| S3 | DONE | (이 커밋) | 2026-08-10 | M7 PASS — Jest 30.2.0 all-skipped가 strict Unit을 통과하는 실제 갭 확인; 기존 JSON 파서는 호환되어 A6 Jest 범위 유지 |
