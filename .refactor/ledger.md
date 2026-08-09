# 0.10.0 작업 원장

루프가 매 항목마다 한 줄을 추가한다. 규칙은 `.refactor/PLAN.md` §1~§2.
`status`: `IN_PROGRESS` → 항목을 시작할 때 · `DONE` / `FAIL` / `KILLED` → 끝날 때.
`IN_PROGRESS`로 끝나 있으면 컨텍스트를 잃은 것이므로 PLAN.md §5 "중간 복구"를 따른다.

| id | status | commit | 날짜 | 결과 |
|---|---|---|---|---|
| S1 | DONE | 3c61dfc | 2026-08-10 | 이벤트 로그의 고유 head 251개를 `refs/replay/*`로 고정, 소실 0. 자동 `git gc`로부터 리플레이 코퍼스 보호됨 |
