# cladding 0.10.0 — 작업 큐 (Codex 루프용)

**상태:** 설계 완료 · 구현 착수 전 · `develop` @ `23ea6be`, 트리 클린.
**이 문서는 루프가 매 바퀴 읽는 문서다.** 왜 이렇게 결정했는지는 **부록 A**에 있다. 결정을 의심할 때만 부록을 열어라 — 매 바퀴 읽지 마라.

---

## 0. 오리엔테이션 — 이만큼만 읽고 시작한다

| 순서 | 읽을 것 | 답을 얻는 질문 |
|---|---|---|
| 1 | 이 문서 §1~§7 | 루프를 어떻게 도는가 |
| 2 | `.refactor/ledger.md` | 무엇이 끝났고 다음은 무엇인가 |
| 3 | (진행 중이면) `.refactor/units/<현재항목>.yaml` | 나는 항목 중간인가, 경계인가 |

그리고 트리 상태 세 줄:

```bash
git status --porcelain          # 비어 있어야 한다. 아니면 §5의 "중간 복구"로.
git rev-parse --abbrev-ref HEAD # develop
node bin/clad --version         # 0.9.3
```

**부록 B**(리팩토링 49 유닛 전체 명세)는 `RF-*` 항목을 집을 때만 연다.

---

## 1. 루프 한 바퀴

```
1. 원장을 읽는다 (.refactor/ledger.md).
2. 마지막 줄이 IN_PROGRESS이면 → §5 "중간 복구". 아니면 계속.
3. 다음 항목을 고른다:
     depends_on이 전부 DONE이고 status가 비어 있는 항목 중,
     §3 표에서 가장 위에 있는 것. (동률은 없다 — 표 순서가 결정적이다.)
4. 그 항목이 [사람] 표시면 → 무엇이 필요한지 보고하고 멈춘다. 시작하지 않는다.
5. preconditions를 실행한다. 하나라도 어긋나면 → 멈추고 보고한다. 고치지 않는다.
6. 원장에 IN_PROGRESS 한 줄을 쓰고 커밋한다. (이게 있어야 컨텍스트를 잃어도 복구된다.)
7. actions를 수행한다.
8. done_conditions를 전부 실행한다. 하나라도 기대와 다르면 → §4로.
9. 스펙 항목을 만드는 항목이면(◆ 표시) 여기서 내부 루프:
     clad verdict --json 을 폴링한다.
       ITERATE  → next_action이 가리키는 것을 고치고 다시 폴링
       ESCALATE → 멈추고 보고한다 (동일 발견 2회 = 진전 없음. 무시하지 마라)
       BLOCKED / BOOTSTRAP → 멈추고 보고한다
     초록이면 clad done <F-id>.
10. §6의 자기 점검을 돌린다.
11. 원장 줄을 DONE으로 갱신하고 커밋한다.
12. 멈춘다. (한 바퀴 = 한 항목. 다음 바퀴는 goal을 다시 부른다.)
```

**왜 한 바퀴에 한 항목인가** — 항목 경계가 커밋 경계이고 롤백 단위다. 여러 개를 묶으면 실패했을 때 무엇을 되돌려야 하는지 알 수 없다.

---

## 2. 원장

**위치: `.refactor/` (커밋된다).** `.cladding/`은 `.gitignore:64`에 있어서 거기 두면 클론 시 사라지고 리뷰도 안 된다 — 루프의 기억이 커밋되지 않으면 컨텍스트를 잃는 순간 복구 근거가 없다.

`.refactor/ledger.md` — 항목당 한 줄, 추가만 한다:

```
| id | status | commit | 언제 | 한 줄 결과 |
|---|---|---|---|---|
| S1 | DONE | a1b2c3d | 2026-08-10 | refs/replay/ 아래 295개 고정 |
| S2 | DONE | e4f5g6h | 2026-08-10 | M5 VERDICT: 거부 메커니즘 필요 — 6b 범위 확대 |
| S3 | IN_PROGRESS | — | 2026-08-11 | jest 파서 탐침 중 |
```

`.refactor/units/<id>.yaml` — 항목을 시작할 때 쓰고 끝날 때 채운다. 다음 바퀴가 **아무것도 다시 유도하지 않도록** 하는 게 목적이다:

```yaml
id: S3
started: 2026-08-11
inherits:            # 직전 항목의 exit에서 복사
  head: e4f5g6h
  tree_clean: true
touch_allowed: [".refactor/sim/M7.md"]   # 전수. 이 밖의 diff는 범위 위반이다.
done_conditions:     # 각각 명령 + 리터럴 기대
  - {cmd: "test -f .refactor/sim/M7.md", expect: "exit 0"}
  - {cmd: "grep -c '^VERDICT: ' .refactor/sim/M7.md", expect: "1"}
exit:
  commit: <sha>
  verdict: PASS | FAIL | KILLED
  residue: "일부러 안 한 것과 그 이유"
```

`residue`가 **완료와 중단을 가른다**(§4).

---

## 3. 작업 큐

표기: **◆** = 스펙 항목을 만들고 `clad done`으로 끝난다 · **[사람]** = 루프가 완료할 수 없다, 승인을 받아야 한다 · **☠** = 이 항목이 기각하면 뒤따르는 항목이 큐에서 빠진다.

| id | 항목 | 의존 | |
|---|---|---|---|
| **S1** | **리플레이 코퍼스 고정 — 마감 지남** | — | |
| S2 | M5 · `clad sign-off` 출처 검증 | — | ☠ |
| S3 | M7 · jest 공허 가드 탐침 | — | ☠ |
| S4 | 5b 백테스트 · `repairModules` 정확도 | — | ☠ |
| P1 | 훅 배선 복구 (캐시가 0.4.0에 멈춘 원인) | S1 | |
| P2 | `clad doctor` 훅 상태 + `HOST_CLAIM_DRIFT` 신선도 ◆ | P1 | |
| P3 | 계수기: `stop_blocked` 확장 · `stop_exit_recorded` · `done_attempted.blockers` ◆ | P1 | |
| P4 | CI 버전 고정 + `doctor` 미고정 경고 ◆ | — | |
| P5 | attestation 정책 도장 + `clad init`이 `.gitattributes` 쓰기 ◆ | — | |
| P6 | **0.9.4 릴리즈** [사람] | P2·P3·P4·P5 | |
| RF0 | 리팩토링 기준선 동결 (U-00~U-07) | P6 | |
| RF1 | 패리티 하네스 + 킬 크라이테리언 (U-10~U-17) | RF0 | ☠ |
| A1 | Stop 거부권 좁히기 ◆ | RF1, P3 | |
| A2 | 게이트 페이로드 경제 ◆ | RF1 | |
| A3 | `gateFooter` 프로파일 — **스펙 개정 먼저** ◆ | RF1 | |
| A4 | 게이트 설정을 `spec.yaml`로 ◆ | RF1 | |
| A5 | 검증 능력 공시 ◆ | RF1, S3 | |
| A6 | jest·Go·Dart 러너 도달 ◆ | A5, S3 | |
| A7 | CI `--tier=all --strict` + `blind-author`에서 `Bash` 제거 ◆ | A5 | |
| A8 | `depends_on` writer ◆ | RF1 | |
| A9 | `repairModules` ◆ | A8, S4 | |
| A10 | 증거 생산자 + 커밋 원장 ◆ | RF1, S2 | |
| A11 | `claimed_blind` — **A10과 같은 릴리즈** ◆ | A10 | |
| A12 | 활성화 문장 18개 삭제 ◆ | RF1 | |
| A13 | `POLICY_LINE` 삭제 · `feature-cycle.md` 재작성 ◆ | A12 | |
| A14 | `CONTEXT_LINE` → 밀어주는 슬라이스 (Tier-A 스펙 편집) ◆ | A13, P3 | |
| RF2 | 리팩토링 2~7단계 (U-20~U-81) | RF1 | |
| A15 | **0.10.0 릴리즈** [사람] | A1~A14, RF2 | |

**항목별 상세**(preconditions / actions / done_conditions / rollback)는 `RF*`는 **부록 B**, 나머지는 **부록 A**의 해당 Phase 절에 있다. 항목을 집을 때 그 절만 연다.

### S1 — 리플레이 코퍼스 고정 (첫 항목, 마감이 지났다)

`stop_blocked` 헤드 48개 중 **29개**, `gate_run` 헤드 247개 중 **129개**가 `develop`의 조상이 아니다(feature 브랜치 스쿼시 머지의 결과). reflog에만 존재하고 가장 오래된 이벤트는 41일 전 — git 기본 `reflogExpireUnreachable`(30일)을 이미 넘겼다. 아직 살아 있는 유일한 이유는 `gc`가 안 돌았기 때문이고, 느슨한 객체가 4,824/6,700이다. **임계에 닿는 순간 부록 A의 모든 리플레이 근거가 영구히 감사 불가능해진다.**

```bash
python3 - <<'PY'
import json, subprocess
ev=[json.loads(l) for l in open('.cladding/events.log.jsonl')]
heads={e['payload']['head'] for e in ev
       if e.get('payload',{}).get('head') and e['type'] in ('stop_blocked','gate_run')}
n=0
for h in sorted(heads):
    if subprocess.run(['git','cat-file','-e',h+'^{commit}'],capture_output=True).returncode==0:
        subprocess.run(['git','update-ref',f'refs/replay/{h[:12]}',h],check=True); n+=1
print(f'pinned {n} of {len(heads)}')
PY
```

**done_condition:** `git for-each-ref refs/replay/ | wc -l` 이 위 스크립트가 출력한 `pinned N` 의 N과 같을 것.
**rollback:** `git for-each-ref --format='%(refname)' refs/replay/ | xargs -n1 git update-ref -d`
커밋 이력을 바꾸지 않는다(참조만 추가). 이후 `git gc`가 돌아도 안전하다.

### 사전 검증 4건의 완료 조건

이 넷은 조사이므로 산출물로 판정한다. 각각 `.refactor/sim/<id>.md`를 쓰고, 첫 줄이 `VERDICT: PASS|KILL|INCONCLUSIVE`, 그 아래에 근거를 `file:line`으로 적는다.

```bash
test -f .refactor/sim/M7.md && head -1 .refactor/sim/M7.md | grep -qE '^VERDICT: (PASS|KILL|INCONCLUSIVE)'
```

- **S1** 만 다르다 — 명령의 결과가 곧 판정이다: `git for-each-ref refs/replay/ | wc -l` 이 이벤트 로그의 고유 head 수와 같아야 한다.
- **S2 KILL** → A10의 `sign-off`가 출처를 검증할 방법이 없다는 뜻. A10·A11을 큐에서 빼고 `independence_policy: require`를 "CLI에서 만족 불가"로 문서화한다.
- **S3 KILL** → jest 갭이 없다는 뜻. A6에서 jest 부분을 뺀다.
- **S4 KILL** → `repairModules`의 정확도가 부족하다는 뜻. A9를 빼고 리팩토링에서 파일 이동을 하지 않는다는 제약이 확정된다.

---

## 4. 멈춰야 할 때

실패는 판단이 아니라 **무엇이 어긋났는가**로 대응이 정해진다.

| 상황 | 대응 | 재시도 |
|---|---|---|
| **범위 위반** — `git diff --name-only`가 `touch_allowed` 밖 | 즉시 되돌린다. 항목 범위 선언이 틀린 것이므로 diff를 고치지 말고 항목을 다시 계획한다 | 안 함 |
| **자기 버그** — `touch_allowed` 안의 파일을 덮는 테스트가 실패 | 제자리에서 1회 재시도 | 1회 |
| **핀 테스트 발화** — 산문·개수·바이트를 고정하는 테스트가 빨감 | **멈춘다. 그 테스트를 건드리지 마라.** 별도 항목으로 핀을 재협상하고, 그걸 먼저 끝낸 뒤 이 항목을 다시 돈다. 깨뜨린 항목 안에서 핀을 고치는 건 자기인증이다 | 안 함 |
| **패리티 델타** — 관측 계약이 바뀜 | 되돌린다. 허용 항목 추가는 별도 커밋에 이유와 함께 | 안 함 |
| **오라클 실명** — 패리티 셀프테스트가 심어둔 변경을 못 잡음 | **마지막 정상 셀프테스트 이후 전부 되돌리고 프로그램을 멈춘다.** 눈먼 오라클로 검증한 것은 미검증이다 | 안 함 |
| **주석만 바꿨는데 번들 SHA가 움직임** | 되돌린다. 안 건드렸다고 믿은 코드를 건드린 것 — 프로그램에서 가장 값진 신호다 | 안 함 |
| `clad verdict` → **ESCALATE** | 멈추고 보고한다. 동일 발견 2회는 스스로 못 고친다는 뜻이다 | 안 함 |
| **attestation만 빨감** (`STALE_ATTESTATION` 단독) | 실패 아님. strict pre-push로 재도장하고 `spec/attestation.yaml`을 코드와 같은 커밋에 넣는다 | — |
| **`STALE_TESTS`** — 안 건드린 파일에서 | 실패 아님. 작업 사본 mtime 아티팩트다. **테스트를 만져서 고치지 마라** | — |
| 같은 항목에서 **2회 연속 되돌림** | 항목이 잘못 잘린 것이다. 쪼개고 다시 계획한다. 3번째 시도 금지 | — |

**멈출 때는 항상** 원장에 이유를 남기고 커밋한다. 말 없이 멈추면 다음 바퀴가 무엇을 만났는지 모른다.

---

## 5. 중간 복구 (컨텍스트를 잃었을 때)

원장 마지막 줄이 `IN_PROGRESS`이면:

```bash
git status --porcelain            # 변경이 있나?
cat .refactor/units/<id>.yaml     # touch_allowed와 done_conditions
```

- **트리가 깨끗** → 항목이 시작만 되고 아무것도 안 했다. `IN_PROGRESS` 줄을 지우고 다시 시작한다.
- **변경이 `touch_allowed` 안에만** → 이어서 한다. `done_conditions`를 돌려 어디까지 왔는지 확인한다.
- **변경이 `touch_allowed` 밖에** → 되돌린다(`git checkout -- <해당 경로>`). 범위 위반이다.
- **내가 만들지 않은 변경** → 멈추고 사람에게 묻는다. 남의 작업 위에 쌓지 마라.

---

## 6. 훅 없는 호스트에서의 자기 규율

Codex에는 훅이 없다. Claude Code에서 **기계가 막아주던 것**이 여기서는 전부 스스로 지켜야 하는 것이 된다.

| 기계가 하던 것 | 이제 | 사후 점검 (§1의 10단계) |
|---|---|---|
| `status: done` 손으로 쓰기 차단 | 규율 | `git diff HEAD~1 -- spec/ \| grep -c '^+.*status: done'` → `clad done`을 안 돌린 커밋이면 **0**이어야 한다 |
| `F-NNN` 파일명 차단 | 규율 | `git diff --name-only HEAD~1 \| grep -cE 'spec/features/F-[0-9]+\.yaml'` → **0** |
| 편집 직후 드리프트 알림 | 없음 | 항목 끝에서 `clad check --tier=pre-commit` |
| 턴 종료 시 차단 | 없음 | 항목 끝에서 `clad check --tier=pre-push --strict` |

**그리고 정직하지 않게 초록에 도달하는 여섯 가지 — 전부 금지:**
핀 테스트 약화 · 패리티 허용 항목 추가 · 커버리지 임계 하향 · 사후 `touch_allowed` 축소 · 사실 대신 그 사실을 비교하는 문구 수정 · 뮤턴트 삭제.

기계적 점검 한 줄로: **커밋 diff에 테스트·임계값·허용목록의 완화가 들어 있는데 그게 이 항목의 선언된 목적이 아니면, 그 항목은 실패다.**

---

## 7. goal 문장

**기본 — 한 바퀴에 한 항목** (매번 이걸 그대로 붙여넣는다):

```
/goal .refactor/ledger.md 의 다음 준비된 항목 하나를 완주한다.

시작 전: 이 문서(.refactor/PLAN.md)의 §0~§7을 읽고, git status --porcelain 이 비어 있는지 확인한다.
비어 있지 않으면 §5 중간 복구를 따른다.

항목 선택은 §1의 3단계 규칙을 따른다. [사람] 표시 항목은 시작하지 말고 무엇이 필요한지 보고하고 멈춘다.

완료 판정은 그 항목의 done_conditions 를 전부 실행해서 한다. 하나라도 기대와 다르면 §4의 해당 행을 따른다.
스펙 항목을 만드는 항목(◆)은 clad verdict --json 으로 초록을 확인한 뒤 clad done <F-id> 로 끝낸다.
status: done 을 손으로 쓰거나 F-NNN 파일을 손으로 만들지 마라 — 이 호스트에는 그걸 막는 훅이 없다.

끝나면 §6의 자기 점검을 돌리고 원장에 결과를 기록하고 커밋한 뒤 멈춘다. 다음 항목으로 넘어가지 마라.
```

**묶음 — 위험이 낮은 구간에서만** (사전 검증 4건, 리팩토링 주석 유닛처럼 되돌리기 쉬운 것들):

```
/goal 위와 같되, 항목을 하나씩 완주하고 원장에 기록하기를 <N>개 또는 첫 실패까지 반복한다.
◆ 표시 항목이나 [사람] 표시 항목을 만나면 그 앞에서 멈춘다.
```

**묶음을 쓰지 말아야 할 곳:** ◆ 항목(스펙을 만든다), `RF1`(패리티 하네스 — 킬 크라이테리언이 걸려 있다), 릴리즈.

---
---

# 부록 A — 결정과 그 근거

> 큐의 항목을 집을 때 해당 절만 연다. 결정을 의심할 때만 처음부터 읽는다.

## A1. 판정 기준

> **없애면 벌지 않은 `done`이 서 버리거나 번 `done`을 설명할 수 없게 되는 것은 남긴다. 그 외는 알릴 수 있어도 가로막아서는 안 된다. 그리고 가로막는 것은, 그게 없었으면 기록이 놓쳤을 무언가를 실제로 잡았다는 계수기를 반드시 내놔야 한다.**

1절은 **존재**를 정한다 — Stop 거부권·게이트·임플-블라인드 채점자·세션 카드가 남는 이유이고, "하네스라서" 잘리는 것은 하나도 없다.
2절은 **형태**를 정한다 — 스타일·시계·케이던스·중복 산문은 알릴 수 있으나 턴을 가로막는 순간 1절이 주지 않은 권한을 주장한 것이다.
3절은 **자기 자신에게 적용한 cladding의 기준**이다. 증거 없는 `done`을 거부하는 도구가 자기 차단만 신뢰로 돌릴 수는 없다.

## A2. 확정된 발견

| # | 발견 | 근거 | 함의 |
|---|---|---|---|
| 1 | **훅 층이 3주간 죽어 있었고 제품이 그걸 못 본다.** 캐시된 플러그인은 0.4.0 하나뿐이고 `hooks/`도 `dist/`도 없다. 훅 이벤트는 07-12/16에 전부 멈췄고 게이트·done 이벤트는 오늘까지 정상 | `~/.claude/plugins/cache/cladding/claude-code/0.4.0/`, `events.log.jsonl` | Phase 0 |
| 2 | **거부권이 계수기 없는 주장이다.** `stop_blocked`는 `{count, fingerprint, head, identity}`만 남긴다 — 탐지기 이름도 귀속도 후속도 없어, 89회의 차단이 무엇을 잡았는지 오늘 아무도 답할 수 없다 | `hook.ts:431` | Phase 0 |
| 3 | **README:86의 "logged as a known-failing exit"에 코드가 없다.** demote 분기는 `return ''` 하고 아무것도 기록하지 않는다 | `hook.ts:417` · 3,694 이벤트 중 0건 | Phase 1 |
| 4 | **"한 번만 차단"이 19/89회 깨졌다.** 차단 파일이 가장 최근 지문 하나만 저장해 상태가 진동하면 다시 무장한다 | `hook.ts:412-424` · 고유 지문 70 / 차단 89 | Phase 1 |
| 5 | **"Stop once more to snooze" 문구가 거짓이다.** *한 번 더* 하라면서 코드는 **바이트 동일한 발견 집합**을 요구한다 | `softShell.ts:227` | Phase 1 |
| 6 | **거부권의 배타 영역은 하나뿐인데 그보다 훨씬 넓게 막는다.** `runStopGate`(drift+arch+secret)와 `pre-commit` tier `[1.3,1.5,1.6]`은 같은 세 검사다. 커밋하면 다시, 푸시하면 CI가 잡는다 → 배타 영역은 README:46이 이름 붙인 **"커밋 안 한 실패를 두고 가는 일"** 하나 | `hook.ts:361-397` · `clad.ts:469-473` | Phase 1 |
| 7 | **게이트 응답이 신호가 아니라 덤프다.** info 미필터 + 이중 pretty-print. **GREEN 실행에서 실패하지 않은 것들의 목록을 돌려주는 것**은 README:104를 뒤집는다 | `server.ts:1114-1118` | Phase 2 |
| 8 | **`gateFooter`가 full 프로파일로 돈다** → 뮤테이션 MCP 도구 호출마다 `secretlint '**/*'` + `madge --circular .` 스폰. 모든 호스트가 받는 유일한 채널에서 Stop보다 큰 비용 | `server.ts:297` | Phase 2 |
| 9 | **판정을 바꾸는 게이트 설정이 gitignore 안에 있다.** `gate.scope`·`gate.coverage`·`gate.commands`가 `.cladding/config.yaml`인데 `clad init`이 그 디렉터리를 무시 목록에 넣는다 → **노트북과 CI가 다른 게이트를 돈다** | `init.ts:475` · `gate-config.ts:70` | Phase 3 |
| 10 | **TS+vitest 밖에서 코드↔테스트 검증 절반이 침묵하는데 GREEN은 똑같다.** 진짜 `LanguageConfig`는 3개, 공허 가드는 vitest 전용, 어디에도 "이 스택에선 못 돌렸다"는 고지가 없다 | `language-config.ts:118-122` · `unit.ts:40-42` | Phase 4 |
| 11 | **임플-블라인드 채점자가 정책 없이는 SKIP이고, `blind-author`는 `Bash`를 갖는다.** `Read`/`Grep`/`Glob`은 막았지만 `cat`은 안 막았다. README:221 자신의 기준(*"what that agent could open, not what anyone promised"*)에 코드가 못 미친다 | `blind-author.md:4` · `spec-conformance.ts` | Phase 4 |
| 12 | **CI가 미고정 `npx --yes cladding`을 쓰고 3스테이지만 돈다** (README:173은 "all 15 in CI") | `init.ts:296` · `ci.yml:59` | Phase 0·4 |
| 13 | **`depends_on` 생산자가 없다.** 그래프·임팩트·워킹셋 전체의 입력인데 `clad_create_feature` 스키마에 필드가 없고 `infer-deps`는 출력만 한다 → `breaks_if_changed`가 구조적으로 빈다 | `server.ts:1515-1571` · `infer-depends-on.ts:5-8` | Phase 5 |
| 14 | **소스 경로 수리기가 없다.** `repairTestRefs`는 있는데 `modules[]` 대응물이 없어, 파일을 옮기면 `MISSING_IMPLEMENTATION`+`UNMAPPED_ARTIFACT`가 동시에 터진다 | `test-ref-repair.ts:61` · grep 0건 | Phase 5 |
| 15 | **증거 원장이 사실상 비어 있다.** `appendEvidence` 호출부 3곳이 전부 일반 사용자가 안 밟는 차선이고 **`clad done`은 증거를 한 줄도 안 쓴다.** `human` 증거 생산자는 0 → 모든 피처가 구조적으로 `self-certified`이고 `independence_policy: require`는 통과 불가. 게다가 원장 위치도 gitignore 안 | `oracle/record.ts:106` · `drive/*` · `hitl/audit.ts:21` | Phase 6 |
| 16 | **활성화 문장이 18번 중복된다** (12 스킬 + 6 페르소나, 2,700B). 코드가 이미 세 곳에서 `existsSync(spec.yaml)`로 강제하는 조건 | `SKILL.md:2` · `agents/*.md:3` · `hook.ts:127,367,1017` | Phase 7 |
| 17 | **`docs/feature-cycle.md`가 8개 에이전트 컨텍스트를 지시한다.** README:211은 *"cladding is not a multi-agent framework and doesn't arrange them"*, 수명주기는 `Define → Sync → Implement → Earn` 네 단계 | README:203,211 | Phase 7 |
| 18 | **`AC_DRIFT`에 status 가드가 없다** (`missing-tests.ts:42`와 대조) → cladding이 요구하는 "스펙 먼저"를 따르면 코드 한 줄 전에 EARS 문구로 error 차단 | `ac-drift.ts` | Phase 1 |

**건드리지 않는 것:** `clad done`의 flip→gate→revert · `MISSING_TESTS`/`UNTESTED_AC`/`MISSING_IMPLEMENTATION` · PostToolUse 거버너(스킵률 97.4%) · `PreToolUse` deny 2개 · MCP 게이트 푸터 · 초기화 전 도구 스테이징과 뮤테이션 경계 · 세션 카드.

## A3. 사전 검증 게이트 — 코드를 쓰기 전에 판정한다

Part A의 32개 변경 중 **21개는 코드 한 줄 쓰기 전에 go/no-go가 나온다**(그중 10개는 이 세션에서 읽기 전용으로 이미 결정됐다). 5개는 **버리는 구현**이 있어야 판정된다(사전 검증이 아니라 조기 검증 — 정직하게 구분한다). 3개는 **출하 후에만** 알 수 있다. 나머지 3개(1b·1c·1e)는 불편한 경우다 — 제품 코드가 필요 없어 사전 검증 가능해 **보이지만, 검증할 계측기 자체가 데이터에 의해 반증됐다.**

### 이미 발화한 것 (6/8 실행, 총 4시간 미만)

| # | 검사 | 결과 | 계획 변경 |
|---|---|---|---|
| **P0** | **리플레이 코퍼스 보존 — 마감 있음** | `stop_blocked` 헤드 48개 중 **29개**, `gate_run` 헤드 247개 중 **129개**가 `develop`의 조상이 아니다(스쿼시 머지의 결과). reflog에만 존재하고, 느슨한 객체 4,824/6,700, `reflogExpireUnreachable` 기본 30일, 이벤트는 25~38일 전 | **자동 `git gc` 한 번이면 모든 리플레이 질문이 영구 불가능해진다.** 번들로 뜨거나 `refs/replay/*`에 고정 — 쓰기이므로 **승인 후 첫 작업** |
| **M1** | 같은 커밋에서 GREEN이 났는가 | 블록 헤드 **40/48(블록 77/89)** 이 같은 커밋에서 strict GREEN `gate_run`을 갖는다. 즉 커밋된 트리를 리플레이하면 차단이 아니라 통과가 재현된다 — **차단을 만든 발견은 작업 트리에 있었고 git에는 없다.** EXACT 상한 56.2% | **48-헤드 리플레이 드라이버를 짓지 않는다**(1일 + 아암당 20~40분 절약). 1b·1c·1e는 Phase 0의 계수기 뒤로 |
| **M2** | LRU 지문 집합의 실측 이득 | 설계가 명시한 *"실패 0이면 비움"* 을 모델에 넣으면 **상한 5부터 89까지 결과가 동일**하고 현재 대비 개선은 **11일간 +2회**. 게다가 16회 중 14회가 **커밋을 넘나드는 해제**(간격 최대 3.9일) | **LRU를 짓지 않는다.** `stop_exit_recorded`만 먼저 내보내고 실제 해제 데이터로 재결정 |
| **M3** | `gateFooter` 프로파일 전환이 가능한가 | `tests/stages/interactive-profile-partition.test.ts`가 **출하된 피처의 AC**로 "`profile:'interactive'`를 쓰는 `src/` 파일 집합 == `['src/cli/hook.ts']`"와 "`server.ts`는 매치되면 안 된다"를 단언한다. 헤더는 gateFooter를 **의도적** full-suite 소비자로 명시 | 2b는 튜닝 노브가 아니라 **스펙 개정**이다. 개정을 구현 앞에 두거나 드롭 |
| **M4** | 증거 생산자가 라벨을 뒤집는가 | `computeIndependence`는 `author==='human'` **또는** `blind===true`일 때만 `independent`. **`'tool'`은 어느 쪽에도 없다.** `human` 생산자는 트리에 0개, `blind` 생산자는 호스트가 넘긴 값을 그대로 전달하는 한 곳뿐 | **6a는 감사 흔적일 뿐 `require`를 만족시키지 못한다.** 그리고 7d가 `blind`를 강등하면 6b가 나오기 전까지 `independent` 생산자가 **0이 된다** → **7d와 6b는 같은 릴리즈** |
| **M6** | 죽은 코드 3종의 스펙 결합 | `preamble.ts`는 F-041의 선언 모듈이자 F-063의 `test_ref` 대상이고 attestation에 해시돼 있다. `PERSONA_PROMPT_ALIASES`는 `server.ts:2019`에서 살아 있고 테스트가 고정한다. `token_budget_per_session`은 types·schema·`update.ts`와 자기 spec.yaml에 살아 있다 | **삭제가 아니라 스펙 아카이브**(`modules: []` + `superseded_by`) + 와이어 노출 1건은 별도 폐기 절차 |
| **M7** | jest 공허 가드가 실제 갭인가 | 미실행 — 출하 코드에 대한 순수 함수 검사, 1시간 | 4b가 4시간짜리 플래그 확장인지 며칠짜리 파서인지, 그리고 **갭이 존재하기는 하는지**를 결정 |
| **M5** | `clad sign-off`의 비대화형 거부 | 미실행, 1시간 | 프로그램에서 **배관이 아니라 출처를 검사하는 유일한 항목.** 없으면 7d+6b는 검증 불가능한 자기 신고를 다른 자기 신고로 바꾼 것에 불과하다 |

### 출하 후에만 알 수 있는 것 (대리 지표를 만들지 않는다)

- **0c 계수기의 값어치** — 훅 레인이 현재 0을 내므로, 복구 후 **4~6주**의 트래픽이 있어야 분모가 안정된다. **순서 제약: Phase 1이 설계상 차단율을 줄이므로 0c는 Phase 1 이전에 깨끗한 창을 가져야 한다.** 기록된 89회로 대체하면 안 된다 — demote 분기가 아무것도 기록하지 않아 그건 **비(非)해제만 모인 표본**이다.
- **7b(밀어주는 슬라이스)** — 에이전트가 바이트로 무엇을 하는지에 대한 주장이라 로그에 관측 근거가 없다. 다만 **필요조건은 오프라인 판정 가능**하다: 최근 200 커밋에서 푸시할 슬라이스가 그 커밋이 만진 파일을 포함하는가를 **세 개의 귀무 모델**(선언된 `modules[]`만 / 최근 수정 N개 / 직전 커밋이 만진 파일) 대비 lift로. 재현율이 최선의 귀무 이하이거나 정밀도 0.3 미만이면 기각. **사전 확률이 낮으므로**(직전-커밋 귀무 모델이 단일 저자 리포에서 매우 강하다) 이 필요조건에서 떨어지면 7b 자체를 접는다.
- **7e(PreCompact)** — 7b의 관측 불가능성을 물려받는다. 빈도만으로 결정: 긴 세션의 5% 미만이 압축되거나 압축 후 중앙 작업량이 3 툴콜 미만이면 기각.

### 시뮬레이션하지 않기로 한 것

**0d(CI 버전 고정)** — 노출 대상이 가상의 채택자이고 그 모집단이 존재하지 않는다(커밋 580개 중 566개가 한 저자). 게다가 **순효과의 부호가 제안된 방법으로 계산 불가능하다** — `<major.minor>` 상한은 오탐 차단 수정으로부터도 채택자를 얼린다. **정책으로 결정하거나, 채택자가 생길 때까지 보류한다.**

**1b·1c·1e의 리플레이 드라이버** — M1이 계측기를 반증했다. 커밋된 트리는 차단을 만든 트리가 아니고, `UNVERIFIED_AC`는 `.cladding/`이 gitignore라 모든 과거 시점에서 구조적으로 침묵하는데 그 편향은 **보수적이 아니라 관대한** 방향으로 작동한다.

### 오늘 하나 더 돌린다면

**5b(`repairModules`) 백테스트.** 완전 읽기 전용이고, git에 진짜 독립적 정답(실제로 이루어진 수리)이 있으며, 제안 알고리즘이 **틀릴 것으로 예측되는 사례를 포함**한다 — 프로그램에서 가장 강한 양성 판정 가능 시뮬레이션이다.

## A4. 단계별 작업

cladding 규약 준수: 한 번에 한 기능 엔드투엔드, 해시 id, 코드보다 스펙 항목 먼저, `clad done`은 strict pre-push GREEN일 때만. 탐지기·페르소나·매니페스트 변경 후 `npm run build:plugin` 필수.

### Phase 0 — 하네스를 보이게 한다 · **0.9.4 단독 출하**
판정을 바꾸지 않고, 이것 없이는 아래 어느 것도 판정할 수 없다.

- **훅 배선 복구.** 캐시가 0.4.0에 멈춘 원인 규명·수정.
- **가시화.** `clad doctor`가 훅 설치 상태와 **훅 이벤트별 마지막 발화 시각**을 보고. `HOST_CLAIM_DRIFT`에 신선도 축 추가.
- **계수기.** `stop_blocked` → `{count, fingerprint, head, detectors[], introduced, preexisting, dirty_hit}`; demote 분기에 **`stop_exit_recorded`**; `done_attempted`에 `blockers[]`. 읽기 시점 파생 질문 하나: **차단된 지문이 이후 어느 게이트에서든 관측된 적이 있는가.**
- **CI 버전 고정** (`init.ts:296` → `cladding@<major.minor>`) + `clad doctor` 미고정 경고.
- **파생 파일 정책 도장** (attestation에 `{cladding, blocking, detectors sha}`) + `clad init`이 `.gitattributes`(`spec/index.yaml merge=union`)를 쓰도록.
- **git 훅 fail-open은 유지** — exit 1로 바꾸면서 기본 on으로 뒤집으면 바이너리 없는 머신에서 모든 커밋이 막힌다.

**검증:** 스위트 GREEN · 정책 섹션 왕복/구버전 리더 관용 테스트 · `clad doctor`가 훅 침묵을 실제로 보고하는 픽스처.

---
*아래 Phase 1~7은 0.10.0 한 번에 나간다.*

### Phase 1 — Stop 거부권: 광고대로 좁히고 정직하게
- **죽은 `strict: true` 제거**(`hook.ts:377`). 어떤 탐지기도 `opts.strict`를 읽지 않고 Stop 경로는 `report.pass`를 안 본다.
- **`TURN_BLOCKING` 허용목록** — 기본값은 "아무것도 막지 않음"(README:215). v1은 **이미 `done`인 게 done이 아님을 말하는 넷**: `STATUS_DRIFT`, `UNVERIFIED_AC`, `MISSING_IMPLEMENTATION`, `DELIVERABLE_INTEGRITY` + 경로 무관하게 항상 막는 **arch·secret 스테이지**. `STALE_ATTESTATION`은 제외(strict pre-push가 이미 EXEMPT를 준다).
- **커밋 안 된 경로와의 교집합.** 이미 있는 `.cladding/hook-tree-state.json`을 쓴다(새 상태 파일 없음). **반드시 fail-closed로** — 스냅샷이 없거나 비면 교집합이 모든 것을 억제해 **거부권이 조용히 꺼지고, 첫 Bash 호출 전 새 세션의 기본 상태가 바로 그 빈 상태다**(200개 상한, 읽기 전용 Bash에서는 갱신 안 함). 스냅샷 부재 = 신호 없음이 아니라 **평소 규칙 적용**. 그리고 교집합 가능한 표면은 `path`를 내는 `MISSING_IMPLEMENTATION`·`DELIVERABLE_INTEGRITY` 둘뿐이므로(`STATUS_DRIFT`·`AC_DRIFT`는 `path`가 없다), 1시간짜리 측정이 1c를 아예 기각할 수도 있다.
- **`stop_exit_recorded`만 먼저.** demote 분기가 오늘 아무것도 기록하지 않아 README:86에 코드가 없다 — 그걸 채운다. **LRU 지문 집합은 짓지 않는다**(M2: 설계가 명시한 clear 의미론을 넣으면 상한 5~89가 동일하고 실측 개선이 11일간 +2회, 그나마 16회 중 14회가 커밋을 넘나드는 해제). 실제 해제 데이터가 쌓인 뒤 재결정.
- **문구 교정**: *"cladding paused before finishing: 2 thing(s) you're leaving uncommitted don't hold up — …. Fix them, or stop again on the same findings to record a known-failing exit. (14 other findings unchanged — the commit gate has them.)"*
- **대량 발화 캡을 `runDrift`에** — 한 패스 N(~20)회 초과 발화는 롤업 요약. `check`·`done`·CI·`gateFooter`·Stop을 한꺼번에 고친다.
- **`AC_DRIFT` status 인지 심각도** — 빈 껍데기 AC는 done에서 계속 error, EARS 문법 지적은 non-done에서 warn/info.

**검증:** `tests/cli/hook.test.ts:257-340` 재작성 + 신규 5케이스(허용목록 밖 error→차단 없음 / 커밋된 경로→차단 없음 / 커밋 안 된 경로→차단 / 같은 지문 재차단 없음 + `stop_exit_recorded` / secret→항상 차단). `AC-973837`이 차단 결정을 의무화하므로 **스펙 개정 선행**.
**되돌릴 조건:** 계수기 50회 시점에 세션 유발 차단이 거의 0이고 차단 지문이 이후 게이트를 빠져나간 적이 없으면 → 보고 카드로 강등하고 README:46을 고친다.

### Phase 2 — 페이로드 경제
- `server.ts:1114-1118`: `severity !== 'info'` 필터(+`info_omitted: N`) · compact JSON · 스테이지당 발견 상한 30(+`truncated`) · **`worst`·`anyFailed`·스테이지 목록은 자르지 않음**. 이후 `clad_verdict`의 "run_gate 대신 이걸" 절 삭제.
- `gateFooter` 프로파일 전환은 **스펙 개정이 선행되어야 한다** — 출하된 AC가 `profile:'interactive'` 사용처를 `['src/cli/hook.ts']`로 못박고 `server.ts`를 명시적으로 배제한다(M3). 개정하거나 드롭.
- MCP `instructions`의 온보딩 텍스트를 `clad_prepare_init`으로 이동. `description-budget.test.ts`에 **합계 상한 + 스키마 상한** 추가.
- 죽은 것 정리 — **삭제가 아니라 스펙 아카이브**(M6): `preamble.ts`(F-041 선언 모듈 · F-063 `test_ref` 대상 · attestation 해시됨) → `modules: []` + `superseded_by`; `PERSONA_PROMPT_ALIASES`(`server.ts:2019`에서 살아 있고 `listPrompts()` 7→5로 바뀌는 **와이어 변경**) → 별도 폐기 절차; `token_budget_per_session`(types·schema·`update.ts`·자기 spec.yaml) → 스키마 변경 절차.

### Phase 3 — 게이트 설정을 커밋되는 파일로
`gate.scope`·`gate.coverage`·`gate.commands`를 `.cladding/config.yaml`에서 **`spec.yaml`의 `independence_policy` 옆으로**. `.cladding/config.yaml`은 노트북 로컬 오버라이드로만 유지.
*(스키마가 모든 층에서 `additionalProperties: false`이고 18개 피처가 `schema.json`을 claim하므로 키 추가는 채택자 가시 변경 — 자기 게이트 사이클을 갖는다.)*

### Phase 4 — 실제로 검증한 것을 말한다
**가장 큰 제품 격차이고, 방향은 "하네스가 너무 적은" 쪽이다.**
- 신규 `src/stages/verification-capability.ts` — **모든 게이트 실행(초록 포함)** 에 "이 스택에서 실제로 돌린 검사" 블록 + `--json` + MCP 푸터 + attestation 기록.
- 공허 가드를 jest까지(이미 그 형태를 파싱) · Go/Dart 러너 요약 · 인식 못 한 요약은 info.
- `unmapped-artifact.ts`: 파생 패턴이 0개 파일에 매치되면 공허함을 명시하는 info.
- **CI에 `--tier=all --strict` 스텝 추가** — README:173을 고치는 것보다 싸다.
- `blind-author.md`에서 **`Bash` 제거** → README:67이 쓰인 그대로 참이 된다. `oracle_policy`를 cladding 자기 스펙에 위험 가중 도입(`unwanted` EARS 부류부터).

### Phase 5 — 그래프에 생산자를 붙인다
- **`depends_on` 1급 writer**: `clad_create_feature` 스키마에 선택 필드 + 별도 `depends_on_inferred:` 키를 쓰는 writer(`test-ref-repair.ts` 방식 텍스트 스플라이스) + `reverse-index.ts`에서만 합집합. **어떤 탐지기도 추론 엣지를 읽지 않는다.** 스키마가 `additionalProperties: false`이므로 **키와 `schema:` 범프가 writer보다 먼저**.
- **`repairModules`** 를 `repairTestRefs` 옆에 — 리네임 레코드(`git diff -M`) 우선, 유일 basename 폴백, 모호하면 추측 금지. (리팩토링 프로그램의 선행 조건이기도 함.)
- `ac.notes` 근거 탐지기는 **연기**. 대신 README:31 문구를 강제되는 절반으로 좁힌다.

### Phase 6 — 증거에 생산자를, 그다음 자리를
**순서가 중요하다. 생산자 없이 파일만 옮기면 커밋되는 빈 디렉터리가 생긴다.**
- `clad done`이 GREEN일 때 `tool` 증거 1건 자동 기록 — **단 이건 감사 흔적일 뿐 독립성 라벨을 바꾸지 못한다.** `computeIndependence`는 `human` 또는 `blind`만 보고 `'tool'`은 어느 쪽에도 없다(M4). `require`를 만족시키는 건 아래 `sign-off`다.
- 신규 `clad sign-off <F-id>` — **`human` 증거의 유일한 생산자**, identity는 git author. 이게 있어야 `independence_policy: require`가 통과 가능한 정책이 된다. **비대화형 실행에서는 거부해야 한다**(M5) — 그렇지 않으면 검증 불가능한 자기 신고를 다른 자기 신고로 바꾼 것에 불과하다.\n- **Phase 7의 `claimed_blind`(7d)와 반드시 같은 릴리즈로.** 7d가 `blind` 자기 신고를 강등하면 `sign-off`가 나오기 전까지 `independent` 생산자가 0이 된다.
- 원장을 **`spec/evidence/<feature-id>.jsonl`** 피처별 샤드로(+`.gitattributes` union 백스톱). `Evidence.featureId`가 필수라 샤딩이 전면적이고, 해시 샤드를 채택한 이유가 그대로 적용된다. `readEvidence`는 시그니처 유지, 구 경로는 `clad sync`가 한 번 접어 넣는다.

### Phase 7 — 규칙은 한 번만, 도달하는 곳에서만
- **활성화 문장 18개 전부 삭제.** 호스트 조건부 파이프라인은 짓지 않는다. 선행 조건: 기존 호스트별 활성화 픽스처를 스펙 없는 프로젝트에 한 번 돌려 자가 활성화가 없는지 확인.
- **`POLICY_LINE` 삭제.** **`CONTEXT_LINE`은 삭제하지 않고 밀어주는 슬라이스로 교체** — README는 주입을 팔지 당김을 종용하지 않는다. Tier-A 스펙 편집이라 planner를 거치고 Phase 0 이후에.
- **MCP 검색 지시 4곳은 유지** — 값싸고 헤지돼 있으며 결함은 데이터 쪽(Phase 5)이었다.
- `docs/feature-cycle.md`를 5조건 **결과 계약**으로 재작성해 관리 블록에 넣는다(`docs/`는 npm으로 셔츠되지 않는다).
- `recordOracle`/`independence.ts`가 LLM 자기 신고 `blind`를 **`claimed_blind`** 로 기록 — 절대 `independent`를 얻지 못한다.
- **`PreCompact` 훅 추가**로 ~400B 상태 카드 재방출.

### Phase 8 — 보류, 계수기로 개폐
`clad done`의 드리프트를 피처 범위로 좁히기. Phase 0 텔레메트리가 `done_attempted` 차단자를 무관 경로가 지배함을 보일 때만.

## A5. 하지 않기로 한 것

| 기각 | 이유 |
|---|---|
| **Stop 훅 보고 전환 / 완전 삭제** | 광고된 비교표 한 행(README:46)이고 뒷받침 증거가 없다. 모델이 실제로 보는 건 문장 하나 + 예시 2건(약 40토큰)이고, 차단의 4분의 1은 이미 5건 이하였다. 좁히고 계수기를 단다 |
| **Stop을 "error만 차단"으로** | 심각도는 양방향으로 잘못된 축이다. warn 전용 14개에 `STALE_ATTESTATION`·`SMOKE_PROBE_DEMAND`·`HOLLOW_GOVERNANCE`가 있고, error와 warn을 함께 내는 탐지기가 8개 더 있어 그 분기도 같이 침묵한다. 게다가 `UNMAPPED_ARTIFACT`가 미claim 파일마다 error라 채택 초기 리포는 상시 차단이 그대로다 |
| **세션 시작 기준선 래칫** | 제품에서 가장 신뢰도 낮은 표면이 소유하는 새 상태 subsystem이고, 세션 시작 시 이미 깨진 것을 세션 내내 면제한다. `hook-tree-state.json`이 새 생명주기 없이 같은 일을 한다 |
| **탐지기 심각도 다이얼(새 필드)** | **`severity`가 이미 다이얼이고**, 탐지기마다 근거를 적어가며 저작돼 있다(`planned-backlog.ts:20-27`). 호출자 하나가 무시했을 뿐이고 Phase 1이 그걸 고친다. `spec.yaml`에 다이얼을 두면 막힌 에이전트가 한 줄로 자기를 풀어주는 경로가 생긴다 |
| **탐지기 강등·삭제** | `UNVERIFIED_AC`의 `:81`·`:88`은 error로 "실패 중인 테스트"·"skip만 돌았다"를 잡는 유일한 프레임워크 무관 장치다. `--strict`를 `{error}`로 평탄화하면 커버리지 하한과 `SMOKE_PROBE_DEMAND`가 CI·pre-push·`done`에서 조용히 꺼진다 |
| **검색 지시 삭제 · AGENTS.md 작성용 분할** | 전자는 값싸고 헤지돼 있으며 결함은 데이터 쪽이었다. 후자는 산술이 본전인데 downside가 비대칭이다(EARS 실수는 한 턴에 자가 교정, 스펙 언어 실수는 조용하고 세션을 넘어간다) |
| **git 훅 fail-open을 exit 1로 (기본 on과 동시에)** | 바이너리 없는 머신에서 모든 커밋이 막힌다 — 사용자가 cladding을 지울 가능성이 가장 높은 조합 |
| **폴리글롯 언어 테이블 통합** | 두 지도가 오늘 서로 다르다. 한쪽으로 합치면 Rust 채택자의 `UNMAPPED_ARTIFACT`가 전멸(공허 초록)하고, 반대로 합치면 `.rs`에 `CONVENTION_DRIFT`가 붙는다(업그레이드 시 빨간 게이트). 이 리포는 100% TS라 **양방향 모두 여기서 보이지 않는다** |

## A6. 바꿔야 할 README 문구

| 위치 | 지금 | 바뀔 것 |
|---|---|---|
| :48 · :67 | "an implementation-blind grader" | "**oracle policy를 선언한 프로젝트에서**" 단서 추가. `blind-author.md`에서 `Bash`를 빼면 :67은 쓰인 그대로 참이 된다 |
| :44 | "auto-detected **right after the edit**" | "surfaced as you work — the affected feature, its blast radius, and the tests to run" (발화율 2.6%, 20초 디바운스) |
| :31 | "the **why** lives in the spec" | "the **intent of each feature** lives in the spec" (AC 단위 근거는 파싱되지 않고 273개 중 111개에만 있다) |
| :178 | "Audit (**every** acceptance criterion has evidence)" | "every acceptance criterion **in the audit log**" |
| :126 | "median 4× less" | `medianStructuralRatio`를 싣거나 "기본 3,000토큰 예산 기준" 병기 |
| :173 | "all 15 in CI" | *문구 유지 — CI에 `--tier=all --strict`를 추가한다* |
| :46 · :86 | — | **그대로 유지. 코드가 그쪽으로 움직인다** |

## A7. 릴리즈

- **0.9.4 (패치):** Phase 0 단독. 판정을 바꾸지 않으므로 채택자가 깨지지 않는다.
- **0.10.0 (마이너):** Phase 1~7을 한 브랜치에 순서대로. 체인지로그 `BREAKING GATE` 섹션 + 업그레이드 후 첫 N회 게이트 출력 1회성 배너 + `clad doctor`의 미고정 CI 넛지.
- 더 쪼개지 않는 이유: CI 버전 고정은 *새로* 스캐폴딩하는 워크플로에만 적용되므로 분할이 안전을 사주지 않고, 릴리즈 의례(11개 사이트 + PR + 태그 + 백머지 + npm + gh release + README 4종)를 반복할 이득이 없다.
- 의례는 CLAUDE.md 절차를 따른다(범프 → PR `develop → main` **머지 커밋**, 스쿼시·리베이스 금지 → 태그 → 백머지 → `npm publish` → `gh release`). 푸시·태그·publish·release는 각각 별도 승인.

---

# 부록 B — 코드 리팩토링 프로그램

> **전체 설계서(738줄 · 49 유닛 · 유닛별 검증 명령·롤백·체크포인트):**
> `.refactor/REFACTOR.md`
> 아래는 결정 기록과 실행 골격이다. 유닛을 집을 때 위 문서를 연다.

## B1. 접근

**제자리 압축.** 파일 내용을 줄이고 죽은 코드를 지우고 중복을 헬퍼로 모으고 주석을 기계 검사 가능한 표준 아래 둔다. 관측 계약(CLI·MCP·훅·기록 파일·이벤트·게이트 disposition)은 **바이트 동일**해야 한다.

**하지 않는 것:** 파일 이름 변경·이동 금지(422개 모듈 경로가 275개 스펙 항목에 리터럴로 박혀 있다) · 동작 변경 금지(전부 Part A 소관) · 탐지기 테이블 재작성 금지(상한이 455줄=1.3%인데 파일 수가 세 곳에서 load-bearing) · `src/graph/viewer/` 제외 · **주석 class 4(자유 서술 삭제) 제외**(좋은 삭제와 결정 기록 삭제를 구분할 오라클이 없다).

## B2. 검증을 가능하게 하는 두 오라클

**① 번들 동일성.** `scripts/build.mjs:32,38`이 `legalComments:'none'` + `minify:true`이고 `src/`에 `@__PURE__`/`@license`/`@preserve`가 **0건** → **주석만 바꾼 유닛은 `dist/clad.js` SHA-256을 반드시 유지해야 한다.** 가장 크고 주관적인 작업이 해시 비교로 판정된다.

**② 패리티 하네스 + 킬 크라이테리언.** CLI·MCP·훅·기록물·이벤트·번들 6개 레인의 골든을 캡처·비교. 결정성은 마스킹이 아니라 **고정**으로. **하네스가 심어둔 변경을 못 잡으면 프로그램 중단** — 그 오라클로 검증한 모든 유닛은 미검증이므로 마지막 정상 셀프테스트 이후 전부 되돌린다.

## B3. 리팩토링 설계 중 발견된 코드 결함

| 결함 | 근거 | 유닛 |
|---|---|---|
| **`tsconfig.json`의 `include` 12개 중 9개가 0개 파일에 매칭**(전부 `src/` 도입 이전 경로) → 지금 `tsc --noEmit`은 테스트가 임포트하는 소스만 간접 검사하고, 어떤 테스트도 안 건드리는 소스는 **타입 검사가 안 된다** | 직접 확인 | U-01 |
| **매니페스트 정직성이 공허 초록** — 탐지기 `.ts` 44개 − 헬퍼 3개 = 41. 검사기와 빌드가 **같은 파일 수**에서 파생돼 서로 어긋날 수 없고 둘 다 `allDetectors`와 비교하지 않는다. 헬퍼를 하나 더 넣으면 42를 광고하며 41이 도는 상태가 완전 초록 | 44 vs 41 | U-03 |
| **커버리지 임계값 미선언** → `stage_2.2`는 커버리지가 얼마든 통과 | `vitest.config.ts` | U-02 |
| **탐지기 발화 순서가 고정돼 있지 않다** — 순서는 `--json`·패널·`stop-block.json`·사용자에게 보이는 상위 2건에 드러나는데 검사하는 테스트가 0개. ESLint import-sort `--fix` 한 번이면 뒤바뀐다 | 8개 테스트 모두 length/uniqueness만 | U-04 |
| **Windows 엔트리 가드가 절대 매칭되지 않는다** → 13개 `stage:*` 스크립트와 `benchmark.ts`가 그 플랫폼에서 조용한 no-op | `import.meta.url === 'file://'+argv[1]` | U-50(동결) |
| **테스트 없는 불변식 5건** — 특히 `arch.ts`/`secret.ts`가 "이 탐지기는 절대 warn을 내지 않는다"에 기대어 `filter(severity==='error')` 한다 | 주석만 존재 | U-05 |

## B4. 7단계 · 49 유닛

| 단계 | 유닛 | 내용 |
|---|---|---|
| 0. 기준선과 그물 | U-00~07 | 기준선 동결 · tsconfig 수리 · 커버리지 래칫 · 매니페스트 정직성 테스트 · 탐지기 순서 골든 · **불변식 5건을 주석→단언으로 승격** · 주석 표준 문서 |
| 1. 패리티 하네스 | U-10~17 | 정규화+픽스처+CLI 레인 → **뮤턴트/셀프테스트** → MCP·훅·기록물·번들 레인 → `census`/`comments`/`checkpoint` 도구 |
| 2. 린트 정합 | U-20 | ESLint 스코프 수리 — 단독, 포맷팅만 |
| 3. 죽은 코드 | U-30~31 | `preamble.ts`·`tail.ts` 삭제(의례 리허설) · 죽은 심볼 |
| 4. 주석 | U-40~44 | 참조 무결성 → 낡은 사실 → 헤더 상한 3배치. **전부 번들 SHA 불변이어야 함** |
| 5. 제자리 중복 제거 | U-50~59 | `isCliEntry` 추출+테이블 테스트 → 15개 러너 → 스테이지 어댑터·JSON 리더·훅 사이드카·서버 핸들러 |
| 6. 가산적 추출 | U-60~67 | `core/paths.ts`(`.cladding` 리터럴 39개) · `core/read.ts` · 서버 도구 분할 · `drive↔ui` 순환 제거. **원본은 경로에 남아 얇은 조립 루트가 된다**(스펙 수리 0건) |
| 7. 테스트 | U-70~81 | 교차 결합 해제 → `tests/_support/` → 4배치 마이그레이션 → 테스트 헤더 표준 |

**단위 규칙:** 1 유닛 = 1 커밋 = 1 변경 이유, **≤400줄 · ≤12파일**, **완료 조건의 모든 항목이 "명령 + 리터럴 기대 출력"**. 산문으로만 쓸 수 있는 완료 조건이 하나라도 있으면 **착수 불가** — 쪼개거나, 계측기를 먼저 짓거나, 버린다.

**19개 불변식**이 매 유닛 전후로, 싼 것·진단력 높은 것 순으로 검사된다 → **실패한 검사 번호가 곧 실패 분류**다.

## B5. 체크포인트와 실패 규칙

유닛마다 `.refactor/units/<id>.yaml` 하나 — **입장 브리핑**(조사를 다시 하지 않게)이자 **퇴장 영수증**(다음 유닛이 측정된 상태에서 시작하게). 필드: `inherits` · `preconditions` · `touch_allowed`/`touch_forbidden`(전수) · `pins_that_can_fire`(**사전 계산**) · `done_conditions`(명령+리터럴) · `expected_deltas` · `exit.carry` · `residue`.

실패 대응은 판단이 아니라 **어떤 불변식이 깨졌는가**로 결정된다: A 범위 위반→되돌림·재계획 · B 자기 버그→1회 재시도 · **C 핀 발화→중단, 테스트를 건드리지 말 것**(깨뜨린 유닛 안에서 핀을 고치는 건 자기인증) · D 패리티 델타→되돌림 · **E 오라클 실명→마지막 정상 셀프테스트 이후 전부 되돌림, 프로그램 중단** · F 주석 유닛인데 번들이 움직임→되돌림 · G attestation만 빨감→재도장 · I `STALE_TESTS`→mtime 아티팩트, 고치지 말 것.

**반합리화 조항:** 핀 테스트 약화 · 패리티 허용 항목 추가 · 커버리지 임계 하향 · 사후 `touch_allowed` 축소 · 사실 대신 주장 문구 수정 · 뮤턴트 삭제로 GREEN에 도달하는 것은 전부 금지.

## B6. Part A와의 맞물림

- **규칙 0: 동작 변경과 리팩토링 유닛을 같은 커밋에 두지 않는다.** 의도된 델타와 사고 델타가 한 패리티 실행에 섞이면 사고 쪽이 숨는다.
- **규칙 1: Part A의 Phase 0이 리팩토링 U-00보다 먼저다.** U-00 기준선에는 "훅이 실제로 돈다"가 전제로 들어가야 하는데 오늘은 거짓이다. 죽은 채로 잰 기준선으로 시작하면 **훅 표면 전체가 패리티 그물 밖에 놓인다.**
- **규칙 2: 리팩토링 0·1단계 이후에야 Part A Phase 1~7이 나간다.** 패리티 하네스 없이는 모든 동작 변경의 검증이 "테스트가 통과했다"뿐인데, 그 테스트는 번들·MCP 응답 본문·훅 사이드카 순서·기록물 트리에 닿지 않는다.
- **규칙 3: 페르소나/산문 편집은 코드와 같은 커밋에 두지 않는다.** `choreography-guard`가 99개 산문 단언을 6개 README·6개 페르소나·3개 빌드 미러·4개 SVG에 걸고 있고, 미러 단언은 빌드 산출물을 읽는다.
- **Stop 좁히기(A Phase 1)는 U-13·U-55 이후.** `stop-block.json` 스키마가 단일 지문 → LRU 집합으로 바뀌므로 **지문 계산 방식 변경과 같은 창에 넣지 않는다.**
- **U-05의 "arch/secret은 절대 warn을 내지 않는다" 승격은 필수** — `TURN_BLOCKING`이 그 불변식의 새 소비자다.

## B7. 결정된 사항

| 질문 | 결정 |
|---|---|
| 헤더 상한 | **균일 18, 예외 등록부 없음.** 예외 등록부는 파일마다 판단을 요구하는데, 무인 에이전트가 하면 안 되는 게 판단이다 |
| 6단계(가산적 추출) | **채택.** 2,030/1,364/1,209줄 신 파일이 이해도 문제의 본체다. 원본이 경로에 조립 루트로 남으므로 스펙 수리 0건 |
| U-30이 done 피처 2개 AC 편집 | **삭제 진행.** 168줄 죽은 코드를 영구히 남겨 "기존 항목 0건 편집" 보증을 지키는 건 잘못된 교환 |
| 페르소나 alias 제거 | **Part A로.** `listPrompts()`가 7→5로 바뀌는 와이어 계약 변경이다. 대신 허용목록 기계장치를 처음부터 끝까지 시험하는 첫 유닛으로 이상적 |
| 패리티를 CI에 상주 | **상주.** PR당 60~90초로 cladding이 한 번도 못 가졌던 관측 계약 회귀 그물을 얻는다 |
| Windows 엔트리 가드 | **동결**(U-50이 동작 변경 없이 추출+테이블 테스트). 수정은 `windows-latest` CI 레그와 함께 별도로 |
| 테스트 수 2,815 vs 2,821 | U-00에서 **1시간 상한**으로 규명, 못 밝히면 특성화 후 동결(이후 유닛 조사 금지) |

## B8. 완료 정의

진척은 **줄 수가 아니라 분류별 작업목록 소진**으로 측정한다. 줄 수를 목표로 삼으면 숫자를 맞추려고 주석을 지우게 되고, 그게 금지된 부작용이다.

**약속하는 숫자:** src 35,757 → ~32,400줄(**−9.4%**) · 주석 비중 28.5% → ~24% · tests 52,745 → ~50,800줄 · 모듈 경로 422(부재 0) → ~433(부재 0) · **`modules[]` 수리 0건 · `test_refs` 수리 0건 · 기존 스펙 항목 편집 2건** · 탐지기/스테이지/tier 불변.

**정직한 상한:** 측정된 src 내 정확 교차 중복은 **256줄=0.7%**, 코드 수준 총 중복은 ~900~1,200줄. **−20% 이상을 약속하는 계획은 압축이 아니라 주석 삭제를 약속하는 것이다.**

**DONE과 STOPPED의 구분은 기계적이다:** 모든 감사 도구를 돌려서 **잔여 등록부에 유닛 id와 함께 기록되지 않은 non-zero 발견이 하나라도 있으면 완료가 아니라 멈춘 것이다.**
