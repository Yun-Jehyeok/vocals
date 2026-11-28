# scripts

저장소 전체를 보는 검사. 모두 `pnpm check`(`check:harness`)와 CI에서 돈다. 이슈 #17. 플러그인 훅 단위 테스트(`plugin-hooks.test.ts`, `session-context.test.ts`)도 여기 있다.

| 명령                          | 하는 일                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check:acceptance-guard` | `origin/main`과의 merge-base 이후 커밋이 건드린 보호 파일(인수 테스트 `supabase/tests/acceptance/`, `apps/mobile/tests/acceptance/`, `tests/acceptance/`와 판정 헬퍼, 목록은 `PROTECTED_PATHS`)은 지금 내용이 `Acceptance: qa` 트레일러가 달린 마지막 커밋의 내용과 같아야 한다. 브랜치에서 추가했다가 지운 파일도 본다. 기준 브랜치가 없으면 경고만 한다(CI는 `--strict`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `pnpm check:migrations`       | merge-base에 있던 `supabase/migrations/*`가 수정·삭제·이름 변경되면 실패한다. 새 파일 추가는 괜찮다. 로컬에서는 커밋 전 변경도 본다. 기준 브랜치가 없으면 경고만 한다(CI는 `--strict`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `pnpm check:harness-change`   | 하네스 경로(`HARNESS_PATHS`: `scripts/`, `supabase/scripts/check-erd-drift.ts`, `.github/`, `.claude/`, 플러그인 훅 등, 기준선 파일과 에이전트 메모리 `.claude/agent-memory/` 제외)와 어디에 있든 `vitest.config.*`·`vitest.workspace.*`·`jest.config.*`나 package.json의 `scripts`·`jest`가 바뀌었으면 PR에 `harness` 라벨이 있어야 한다. CI는 실행 시점의 PR 상태(API, `pull-requests: read`)에서 읽은 라벨을 `--labels`로, draft 여부를 `--draft`로 넘기고(이벤트 payload는 쓰지 않는다, 늦게 큐에 들어간 실행도 지금 상태로 판정), 로컬은 경고만 한다. draft PR은 라벨이 없어도 "판정 보류" 경고(어노테이션·job 요약)로 통과하고, `ready_for_review`·ready 상태의 push·라벨 변경 때는 실패한다(#61, PM 승인 A안). draft 때의 통과는 merge 근거가 아니다(team-lead 스킬 6장). `harness-guard.yml`(pull_request_target)은 main의 정의·스크립트로 같은 검사를 한다. |
| `pnpm check:req-trace`        | `docs/prd.md`의 요구사항 ID마다 이름(describe/it/test)에 그 ID가 들어간 테스트가 있는지 본다. 빠진 ID 목록을 출력한다. 기준선이 merge-base보다 늘었는지도 본다.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `pnpm check:erd-drift`        | `docs/erd.md`의 테이블·컬럼·enum 값을 마이그레이션을 적용한 스키마와 비교한다. 코드는 `supabase/scripts/check-erd-drift.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## 하네스 측정 보고 (`pnpm harness:report`, 이슈 #17 6단계, #61 확장)

검사가 아니라 보고다(`pnpm check`에 들어가지 않는다). 기간을 정해 마크다운으로 출력한다.

- 옵션: `--days N`(기본 7) 또는 `--since YYYY-MM-DD`(그날부터 지금까지, `--days`와 함께 쓰지 않음), `--issues 50-61,17`(이슈별 표·리드타임 범위), `--no-github`(로그만), `--now <ISO 시각>`(기준 시각)
- 훅 차단: `.claude/logs/*.jsonl`(플러그인 README "차단 로그")의 `event: "block"`을 규칙별·역할별로 센다. 경로는 보고에 옮기지 않는다.
- 승인 대기(#61): 같은 로그의 `event: "approval"`(`approval.wait`, PermissionRequest 훅)을 역할별·도구별로 센다.
- PM 개입: 이슈·PR 댓글, PR 리뷰 코멘트·리뷰 본문의 `받는 역할: PM` 수. 회의록의 `PM 질문: n건` 줄의 합(#61, team-lead 스킬 6장)도 함께. 코드 블록·인라인 코드 안은 세지 않는다.
- QA 반려: 첫 줄이 `[QA 반려]`로 시작하는 댓글·리뷰 수(`agents/qa.md`).
- CI 실패 원인(#61): 실패한 워크플로 실행(앞 150개)의 실패 job › step을 예상된 실패와 실제 실패로 나눈다.
  - 라벨 단계(`Harness change label`, harness-guard job): PR이 지금 `harness` 라벨을 가졌거나 열려 있으면 예상된 실패(라벨 전 push). 라벨 없이 닫히거나 merge된 PR, PR을 모르는 실행은 실제 실패.
  - draft 판정 보류(#61)가 main의 `harness-guard.yml`에 들어간 뒤(`git log origin/main --first-parent`로 merge 시각을 찾는다)의 실행은, draft의 라벨 누락이 실패가 아니라 경고라 목록에 없다. 그 뒤의 라벨 단계 실패는 ready 상태에서 라벨이 없던 것이라 실제 실패로 센다.
  - `check › Test`: PR 커밋 목록에서 실행의 head부터 거슬러 `Acceptance: qa` 커밋을 구현 커밋(feat·fix·refactor)보다 먼저 만나면 예상된 실패(인수 테스트 커밋 뒤 구현 전). chore·docs·test·merge 커밋은 건너뛴다.
  - `check › Test`(QA 재현, #61): head가 `test:` 커밋이고 그 PR에 그 커밋보다 먼저 쓴 `[QA 반려]`가 있으면 예상된 실패(QA 재현 테스트는 일부러 실패한다).
- 이슈별(#61): 범위(기본: 기간 안에 만들어졌거나 닫혔거나 연결 PR이 merge된 이슈)마다 연결 PR, 리드타임(이슈 생성 → 마지막 연결 PR merge), QA 반려, PM 질문, merge 뒤 결함(`escaped` 라벨 이슈 본문의 `원래 이슈: #번호`. 원래 번호가 PR이면 그 PR의 이슈). 연결은 PR 제목의 `#번호`, 본문의 `이슈: #번호`·`Closes #번호`만 본다(본문의 근거·관련 번호는 연결이 아님).
- 지난 보고 대비(#61): 같은 길이의 바로 앞 기간을 같은 스크립트로 다시 계산해 지표를 나란히 쓴다. 승인 대기·PM 질문·escaped는 #61부터 기록돼 그 전 기간의 0은 "측정 안 됨"이다(보고에 첫 기록일을 적는다).
- 반복된 실수: 같은 규칙·같은 실제 실패 step이 2회 이상이면 린트·훅·테스트 승격 제안.
- 한 번도 걸리지 않은 규칙: `RULE_IDS` − 기간 안에 걸린 규칙. 로그가 28일치 미만이면 "판단 보류".
- GitHub는 `gh api`(REST)로 읽는다(클라우드는 GraphQL을 막는다). 실패하면 그 절만 "조회 실패(gh api)"로 쓴다. 단위 테스트는 `harness-report.test.ts`(가짜 로그·가짜 gh 응답).

### 주간 예약 작업

팀장이 #17 6단계 PR merge 뒤 예약 작업으로 만든다. 매주 실행하는 명령:

```sh
git fetch origin main && git checkout --detach origin/main
pnpm install --frozen-lockfile
pnpm -s harness:report --days 7 > /tmp/harness-report.md
gh api repos/{owner}/{repo}/issues/17/comments -F body=@/tmp/harness-report.md --jq .html_url
```

- 결과는 #17 댓글로 남는다(`-F body=@파일`은 파일 내용을 본문으로 보낸다). 댓글 URL을 예약 작업 결과에 적는다.
- 로그는 main에 merge된 작업 PR에 들어 있는 것만 센다. 아직 merge되지 않은 PR의 로그는 다음 주에 잡힌다.
- 반복된 실수·정리 제안은 보고일 뿐이다. 실제 승격·삭제는 팀장이 이슈로 만들어 하네스 PR로 한다.

## 요구사항 추적 기준선

- `req-trace-baseline.txt`는 아직 테스트가 없는 ID 목록이다. 줄어들기만 한다.
- 기준선에 없는 ID에 테스트가 없거나, 기준선의 ID에 테스트가 생겼는데 남아 있으면 실패한다.
- 테스트를 추가했으면 `pnpm check:req-trace --update`로 기준선을 줄여 같이 커밋한다.
- 기준선이 merge-base보다 늘면 실패한다(이미 있던 ID의 테스트가 빠졌다는 뜻). 그 브랜치에서 `docs/prd.md`에 새로 생긴 ID만 예외로 허용하고 출력한다. PR 설명에 적는다.
- `skip`·`todo` 테스트와 주석은 세지 않는다.

## ERD 드리프트

- erd.md 표기 규칙대로 `id`(다른 컬럼이 PK인 1:1 테이블은 제외)와 `created_at`은 다이어그램에 없어도 있는 것으로 본다.
- enum은 주석의 쉼표 목록이 값이다(`—` 뒤는 설명). DB enum 타입 이름은 `<테이블>_<컬럼>`이어야 한다.
- 마이그레이션에만 있는 테이블·컬럼·enum 값, erd에만 있는 컬럼·enum 값은 실패한다. erd에만 있는 테이블은 "미구현"으로 출력만 한다.
- 문서가 틀렸다고 보면 코드로 맞추지 말고 `[질문] 받는 역할: 기획`으로 보고한다. 답을 기다리는 동안만 그 테이블을 `ERD_DRIFT_EXCEPTIONS`에 사유와 함께 넣는다. 차이가 없어졌는데 남아 있으면 실패한다.
