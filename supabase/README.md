# supabase

- `migrations/` — DB 스키마 (`docs/erd.md` 기준). 실제 Supabase에 그대로 적용할 수 있는 SQL이다.
- `seed.sql` — 로컬 개발·테스트용 더미 데이터. 원격(테스트·운영) DB에는 넣지 않는다.
- `config.toml` — Supabase CLI 설정. 테스트 프로젝트에 마이그레이션을 올릴 때만 쓴다(아래 "테스트 프로젝트에 올리기").
- `tests/` — 권한(RLS)·스키마 테스트와 로컬 DB용 Supabase shim
- `tests/acceptance/` — 이슈별 인수 테스트. QA만 쓴다(아래 "인수 테스트")
- `scripts/` — 로컬 DB 명령, ERD 드리프트 센서
- `functions/` — Edge Functions. 아직 만들지 않음.

## 로컬 DB

Supabase 테스트 프로젝트가 준비되기 전까지는 로컬 DB와 더미 데이터로 개발·테스트한다(CLAUDE.md 예외).
로컬 DB는 [PGlite](https://pglite.dev)(Node 안에서 도는 Postgres)라 Docker나 Postgres 설치가 필요 없다.

```sh
pnpm install

# 빈 로컬 DB(supabase/.pglite/)에 shim → 마이그레이션 전체 → seed를 처음부터 적용한다
pnpm db:reset

# 로컬 DB에 SQL 실행 (결과는 항상 되돌린다)
pnpm db:query "select id, role, nickname from public.users"
pnpm db:query --anon "select user_id, link_slug from public.trainer_profiles"
pnpm db:query --as 00000000-0000-4000-8000-000000000001 "select id, nickname from public.users"
```

seed 사용자 id는 `tests/helpers/seed-ids.ts`에 있다.

| 사용자    | id 끝자리 | 상태                                        |
| --------- | --------- | ------------------------------------------- |
| 학생 1, 2 | `01`,`02` |                                             |
| 트레이너  | `11`      | approved, listed, individual                |
| 트레이너  | `12`      | approved, `listed = false`, sole_proprietor |
| 트레이너  | `13`      | approved, `is_pilot = true`                 |
| 트레이너  | `14`      | pending                                     |
| 트레이너  | `15`      | rejected, corporation                       |
| 트레이너  | `16`      | suspended                                   |
| 운영자    | `99`      | 본인인증 대상이 아니라 개인정보 행 없음     |

- 학생·트레이너는 `user_private_profiles`, `user_account_records` 행이 있다. 트레이너는 모두 `trainer_business_profiles` 행이 있다.
- 묶음 2(이슈 #28) 더미 데이터(id `00000000-0000-4000-8002-…`, 금액·수수료율은 더미 값)
  - 학생 1–비노출 트레이너(`12`): 1:1 active 수강권(환불 요청 `requested`), 그룹 active 수강권(반 배정)
  - 학생 2–비노출 트레이너(`12`): 수강권이 모두 `ended`(환불됨, 요청 `processed`·환불 1건), `marketplace` 유입
  - 학생 1–파일럿 트레이너(`13`): `pilot_free` 수강 관계, 결제 없는 0원 수강권
  - 학생 2–정지 트레이너(`16`): active 1:1 수강권
  - 비활성 상품 1개, 빈 반 1개, `fee_policies`의 `marketplace` 더미 행(마이그레이션에는 `trainer_link` 0.08만)
  - 승인 트레이너(`11`)에게는 학생을 두지 않는다. 기존 테스트가 "학생이 없는 다른 트레이너"로 쓴다.
- 묶음 3(이슈 #32) 더미 데이터(id `00000000-0000-4000-8003-…`, 시각은 Asia/Seoul, `weekday` 0 = 일요일)
  - 학생 1–`12` 1:1: 수정되어 닫힌 고정 일정(월)과 새 고정 일정(화·목), 출석(차감)·트레이너 취소 회차·학생 사전 취소·다가오는 회차
  - 학생 2–`12` 끝난 수강권: 지난 회차(사전 취소). 환불로 `remaining_sessions = 0`이라 차감 행을 두지 않는다
  - 학생 2–정지 트레이너(`16`): 결석·보강 회차(차감 2회), 사전 취소, 다가오는 회차
  - 파일럿 트레이너(`13`) 그룹 반 "더미 파일럿 토요반": 학생 1(파일럿 무료 0원)·학생 2(마켓플레이스 결제) 2명이 참여한 회차, 학생 2 일회권 회차
  - 차감 행의 `session_amount`는 `packages/shared`의 `sessionAmount`로 계산한 값이다. 수강권마다 차감 행 수 = `total_sessions − remaining_sessions`
- 지역(`regions`)은 아직 더미 5개다. 전국 시·군·구 목록(행정안전부 법정동코드)은 원본 파일을 받은 뒤 넣는다.

### 로컬 Postgres에 적용하기 (선택)

Postgres가 설치돼 있으면 같은 파일을 psql로 적용할 수 있다. 빈 DB에 아래 순서로 넣는다.

```sh
createdb vocals_local
psql -v ON_ERROR_STOP=1 -d vocals_local -f supabase/tests/supabase-shim.sql \
  $(ls supabase/migrations/*.sql | sort | sed 's/^/-f /') -f supabase/seed.sql
```

## 테스트 프로젝트에 올리기

마이그레이션을 Supabase 테스트 프로젝트 `vocals-test`(ref `lzymeasuarakudsbsvpt`)에 올리는 방법. PM이 자기 컴퓨터에서 Supabase CLI로 한다(PM 결정 2026-11-23, 이슈 #59). 에이전트와 CI는 원격 DB에 올리지 않는다.

- 올리는 것은 `migrations/`뿐이다. `seed.sql`(더미 데이터)은 올리지 않는다. 원격 seed는 다음 이슈에서 따로 정한다.
- 운영 프로젝트는 아직 없다. 생기면 이 절차를 다시 정한다.

### 준비물

- 이 레포의 최신 main 체크아웃
- Supabase CLI **3.x**(3.2.0으로 확인). 2.x와 3.x는 `db push`가 기본으로 고르는 대상이 다르므로 아래 명령은 3.x 기준이다.
  - 설치하지 않고 쓰기(Node 22 이상): 아래 명령의 `supabase`를 `npx supabase@3.2.0`으로 바꿔 실행한다.
  - macOS에 설치: `brew install supabase/tap/supabase`. 그 밖의 설치는 [Supabase CLI 문서](https://supabase.com/docs/guides/local-development/cli/getting-started)
- Supabase 계정(테스트 프로젝트가 있는 조직)과 테스트 프로젝트의 DB 비밀번호. 비밀번호는 PM만 안다. CLI가 물을 때 터미널에만 입력하고, 명령 인자(`--password`)·파일·이슈·채팅 어디에도 적지 않는다.

### 순서

레포 루트에서 실행한다. `supabase/config.toml`이 있는 폴더를 CLI가 찾는다.

```sh
git checkout main && git pull
supabase --version                                     # 3.x인지 확인

supabase login                                         # 브라우저로 로그인. 토큰은 CLI가 내 컴퓨터에 저장한다
supabase link --project-ref lzymeasuarakudsbsvpt       # 테스트 프로젝트에 연결. DB 비밀번호를 물으면 입력한다
supabase migration list --remote                       # 연결 확인. Remote 칸이 비어 있어야 한다(처음 올릴 때)

supabase db push --remote --dry-run                    # 올릴 마이그레이션 목록만 본다. 아직 바뀌는 것은 없다
supabase db push --remote                              # 실제 적용. 목록을 다시 보여 주고 물으면 y
supabase migration list --remote                       # Local과 Remote 칸이 모두 채워졌는지 확인
```

- `link`는 연결 정보를 `supabase/.temp/`에 저장한다(커밋하지 않는다, `.gitignore`). `migration list --remote`·`db push --remote`가 출력 첫머리에 보여 주는 대상 ref가 `lzymeasuarakudsbsvpt`가 아니면 멈춘다.
- `link`가 "로컬 설정과 원격 설정이 다르다"는 안내를 보여도 `config.toml`을 고치거나 원격에 올리지 않는다. Postgres 메이저 버전이 17이 아니라는 안내가 나오면 팀장에게 알린다.
- `--dry-run`에 아래 파일이 이 순서로 나와야 한다. 다르면 적용하지 말고 팀장에게 알린다. 다음에 올릴 때는 아직 올리지 않은 새 파일만 나온다.

```
20261119170000_accounts_trainers.sql
20261121120000_active_user_edit_policies.sql
20261121150000_products_payments_tickets.sql
20261121180000_schedules_attendance.sql
20261121210000_homework_videos_feedback.sql
20261122090000_client_insert_authorization.sql
20261122120000_chat_reviews_reports_notifications.sql
20261122150000_user_restrictions.sql
20261123120000_explicit_role_grants.sql
```

### 실패하면

- 다시 시도하거나 다른 플래그를 붙이지 않는다. 마이그레이션 파일도 고치지 않는다.
- 실패한 명령과 오류 메시지 전체, `supabase migration list --remote` 결과를 팀장에게 보낸다(비밀번호는 빼고).
- 마이그레이션은 파일마다 따로 적용된다. 실패한 파일 앞의 파일은 적용되어 원격 이력에 남고, 실패한 파일은 남지 않는다. 고친 뒤 `db push --remote`를 다시 하면 남은 파일만 올라간다. 고치는 것은 새 마이그레이션 PR로 한다.

### 하지 말 것

- `supabase db reset --remote`(2.x는 `--linked`): 원격 DB를 지우고 처음부터 다시 만든다.
- 운영 프로젝트(생기면)나 다른 프로젝트에 `link`. 올리기 전에 연결된 ref를 확인한다.
- 원격에 seed 넣기: `db push --include-seed`, `supabase seed`, 대시보드 SQL 편집기에 `seed.sql` 붙여넣기. `config.toml`의 `[db.seed] enabled = false`는 이를 막지 못한다(CLI 3.x의 `--include-seed`는 이 값을 무시한다). 이 플래그·명령을 쓰지 않는 것만이 막는 방법이다.
- `supabase config push`: `config.toml`의 최소 설정으로 원격의 Auth 등 설정을 덮어쓴다.
- 팀장과 정하지 않은 `supabase migration repair`, `db pull`, `db push --include-all`: 원격의 마이그레이션 이력이나 로컬 파일을 바꾼다.
- 대시보드(테이블 편집기·SQL 편집기)에서 스키마를 직접 바꾸기. 스키마는 `migrations/`의 새 파일로만 바꾼다.

## 권한 테스트

```sh
pnpm --filter @vocals/supabase test   # DB 테스트만
pnpm test                             # 전체 (CI와 같다)
```

- 테스트 파일마다 메모리 안에 새 DB를 띄우고 shim → 마이그레이션 → seed를 적용한다.
- `withActor(db, actor, fn)` / `queryAs(db, actor, sql)`로 "anon", "seed의 특정 사용자로 로그인", "서버(service_role)"로 실행한다. 실행은 트랜잭션 안에서 하고 끝나면 항상 되돌린다.
- `pnpm test`에 들어 있으므로 PR마다 CI(`.github/workflows/ci.yml`의 Test 단계)에서 그대로 돈다.
- 항상 확인하는 것
  - public 스키마에 RLS가 꺼진 테이블이 있으면 실패한다.
  - DB enum 값이 `packages/shared/src/domain.ts`와 다르면 실패한다. 새 enum을 만들면 `tests/schema.test.ts`의 `DOMAIN_ENUMS`에 추가한다.
  - 테이블·컬럼 이름이 `docs/erd.md`와 다르면 실패한다. 새 테이블을 만들면 `tests/schema.test.ts`의 `ERD_COLUMNS`에 추가한다.
  - `pnpm check:erd-drift`(`pnpm check`에 포함)는 `docs/erd.md`를 직접 읽어 마이그레이션 스키마의 테이블·컬럼·enum 값과 비교한다. 자세한 내용은 `scripts/README.md`.

## 인수 테스트

- 경로: `supabase/tests/acceptance/<이슈번호>-<이름>.test.ts` (예: `21-tickets.test.ts`). `pnpm test`에 함께 돈다.
- 이슈의 완료 조건을 QA가 개발 전에 테스트로 쓴다. 테스트 이름에 요구사항 ID를 넣는다.
- QA만 쓰고, QA의 커밋에는 메시지 끝에 빈 줄을 두고 트레일러 `Acceptance: qa`를 단다.
  트레일러(Acceptance, Co-Authored-By, Claude-Session)는 마지막 문단에 빈 줄 없이 한 덩어리로 쓴다(git은 마지막 문단만 트레일러로 읽는다).
  예: `test: 21 수강권 인수 테스트` / 빈 줄 / `Acceptance: qa` / `Co-Authored-By: …` / `Claude-Session: …`
  `pnpm check:acceptance-guard`(CI 포함)가 이 트레일러 없이 바뀐 인수 테스트를 막는다.
- 판정에 영향을 주는 헬퍼(`tests/helpers/db.ts`, `tests/helpers/rls-matrix.ts`, `tests/rls-matrix.test.ts`)도 같은 규칙으로 보호한다. `seed.sql`, `seed-ids.ts`, shim은 개발이 고친다.
- 개발·디자인은 인수 테스트를 고치지 않는다. 틀렸다고 보면 `[질문] 받는 역할: QA`로 보고한다.
- E2E(실제 앱 + 로컬 Supabase + seed) 인수 테스트는 앱이 생기면 루트의 `tests/acceptance/`에 둔다. 지금은 없다. 이 경로도 같은 규칙으로 보호한다.

## RLS 권한 매트릭스

`tests/helpers/rls-matrix.ts`의 `describeRlsMatrix`에 `역할 × 테이블 × 동작 → 허용/차단` 표를 주면 칸마다 테스트를 만든다.
전체 예는 `tests/rls-matrix.test.ts`.

```ts
import { anon, asUser } from "../helpers/db.ts";
import { describeRlsMatrix } from "../helpers/rls-matrix.ts";
import { SEED } from "../helpers/seed-ids.ts";

const owner = [SEED.trainerApproved];
describeRlsMatrix({
  title: "#11 trainer_genres 권한 — TRN-08", // 이슈 번호와 요구사항 ID
  actors: { anon, 학생: asUser(SEED.student1), "트레이너(본인)": asUser(SEED.trainerApproved) },
  cases: {
    // 테이블 → 동작 → 시도할 SQL. 대상 행은 seed의 행으로 고정한다.
    // 같은 테이블의 다른 행은 "trainer_genres:pending"처럼 키를 나눈다.
    trainer_genres: {
      select: { sql: `select 1 from public.trainer_genres where trainer_id = $1`, params: owner },
      insert: {
        sql: `insert into public.trainer_genres (trainer_id, genre_id) values ($1, 3)`,
        params: owner,
      },
      update: {
        sql: `update public.trainer_genres set genre_id = 5 where trainer_id = $1`,
        params: owner,
      },
      delete: { sql: `delete from public.trainer_genres where trainer_id = $1`, params: owner },
    },
  },
  rows: [
    // 역할            테이블            select   insert   update   delete
    ["anon", "trainer_genres", "allow", "deny", "deny", "deny"],
    ["학생", "trainer_genres", "allow", "deny", "deny", "deny"],
    ["트레이너(본인)", "trainer_genres", "allow", "allow", "deny", "allow"],
  ],
});
```

- 판정: select는 1행 이상 보이면 허용, insert·update·delete는 1행 이상 바뀌면 허용. 0행이거나 권한 오류(42501: 권한 없음, RLS 위반)면 차단.
- 권한이 아닌 오류(중복 키, FK, check)는 차단으로 치지 않고 테스트를 실패시킨다. 그래서 "차단" 칸이 엉뚱한 이유로 통과하지 않는다. 트리거가 다른 오류 코드로 막는 경우만 `deniedBy: /메시지/`로 차단으로 본다.
- 행 하나 = 칸 하나로 쓴다. 여러 행을 한 번에 조회하면 하나만 보여도 허용으로 판정된다. 다른 행은 `테이블:설명` 키로 나눈다.
- `"-"`는 이 매트릭스에서 보지 않는 칸이다. 시도는 항상 되돌린다.
- 테스트 이름은 `<역할> × <테이블> × <동작> → 허용|차단`이다.

## 새 테이블을 만들 때

1. `migrations/`에 새 파일(`<YYYYMMDDHHMMSS>_<이름>.sql`)을 만든다. 기존 파일은 고치지 않는다.
2. 테이블마다 RLS를 켜고, `anon`·`authenticated`의 권한을 `revoke all`로 회수한 뒤 필요한 컬럼만 `grant`한다. `20261123120000_explicit_role_grants.sql`부터 새 테이블에는 `service_role`에만 기본 권한이 가지만, 프로젝트 설정과 상관없이 같게 하려고 회수는 계속 쓴다. 클라이언트가 `nextval`을 써야 하는 시퀀스가 생기면 그 시퀀스 권한도 명시한다.
3. 정책·트리거에서 쓰는 함수는 `private` 스키마에 둔다(API로 노출되지 않는다).
4. `tests/`에 허용되는 경우와 막히는 경우를 각각 1개 이상 테스트한다.

## Supabase shim이 실제 Supabase와 다른 점

로컬에는 Supabase가 제공하는 것이 없어서 `tests/supabase-shim.sql`로 흉내 낸다. 마이그레이션에는 넣지 않는다.

- `auth.users`는 `id`, `email`, `created_at`만 있다. 실제 테이블은 컬럼이 더 많고 Supabase Auth가 행을 만든다.
- `auth.uid()`, `auth.role()`, `auth.jwt()`는 `request.jwt.claims` 설정값만 읽는다. 실제로는 PostgREST가 JWT 서명을 검증한 뒤 넣는다.
- 역할은 `anon`, `authenticated`, `service_role`(RLS 무시)만 있다. `authenticator`, `supabase_admin` 등은 없다.
- 기본 권한은 Supabase의 옛 방식대로 public 스키마의 새 테이블·시퀀스·함수에 세 역할 모두 권한을 준다. Supabase는 2026-10-30부터 모든 프로젝트에서 새 테이블·시퀀스에 이 기본 권한을 주지 않는다([changelog #45329](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)). `tests/role-grants.test.ts`가 두 방식에서 마이그레이션 적용 결과 권한이 같은지 확인한다.
- 실제 Supabase에서 마이그레이션은 superuser가 아닌 `postgres` 역할로 적용된다. 로컬(PGlite)은 superuser로 적용한다. 이슈 #59에서 Supabase와 비슷하게 역할을 나눈 Postgres 16에 `postgres`(superuser 아님)로 마이그레이션 전체를 적용해 확인했다(자동 테스트는 아니다).
- PGlite는 Postgres 18이다. Supabase 프로젝트의 Postgres 버전(15·17)과 다를 수 있다. 같은 SQL을 Postgres 16에서도 적용해 확인했다.
- PostgREST(REST API)는 거치지 않고 SQL을 직접 실행한다. 그래서 `select=*` 같은 API 동작 차이는 테스트하지 않는다.
