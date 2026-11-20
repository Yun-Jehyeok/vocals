# supabase

- `migrations/` — DB 스키마 (`docs/erd.md` 기준). 실제 Supabase에 그대로 적용할 수 있는 SQL이다.
- `seed.sql` — 로컬 개발·테스트용 더미 데이터. 운영 DB에는 넣지 않는다.
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
- 지역(`regions`)은 아직 더미 5개다. 전국 시·군·구 목록(행정안전부 법정동코드)은 원본 파일을 받은 뒤 넣는다.

### 로컬 Postgres에 적용하기 (선택)

Postgres가 설치돼 있으면 같은 파일을 psql로 적용할 수 있다. 빈 DB에 아래 순서로 넣는다.

```sh
createdb vocals_local
psql -v ON_ERROR_STOP=1 -d vocals_local -f supabase/tests/supabase-shim.sql \
  $(ls supabase/migrations/*.sql | sort | sed 's/^/-f /') -f supabase/seed.sql
```

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
2. 테이블마다 RLS를 켜고, `anon`·`authenticated`의 기본 권한을 `revoke all`로 회수한 뒤 필요한 컬럼만 `grant`한다. Supabase는 public 테이블에 기본으로 모든 권한을 준다.
3. 정책·트리거에서 쓰는 함수는 `private` 스키마에 둔다(API로 노출되지 않는다).
4. `tests/`에 허용되는 경우와 막히는 경우를 각각 1개 이상 테스트한다.

## Supabase shim이 실제 Supabase와 다른 점

로컬에는 Supabase가 제공하는 것이 없어서 `tests/supabase-shim.sql`로 흉내 낸다. 마이그레이션에는 넣지 않는다.

- `auth.users`는 `id`, `email`, `created_at`만 있다. 실제 테이블은 컬럼이 더 많고 Supabase Auth가 행을 만든다.
- `auth.uid()`, `auth.role()`, `auth.jwt()`는 `request.jwt.claims` 설정값만 읽는다. 실제로는 PostgREST가 JWT 서명을 검증한 뒤 넣는다.
- 역할은 `anon`, `authenticated`, `service_role`(RLS 무시)만 있다. `authenticator`, `supabase_admin` 등은 없다.
- 기본 권한은 Supabase처럼 public 스키마의 새 테이블·시퀀스·함수에 세 역할 모두 권한을 준다.
- PGlite는 Postgres 18이다. Supabase 프로젝트의 Postgres 버전(15·17)과 다를 수 있다. 같은 SQL을 Postgres 16에서도 적용해 확인했다.
- PostgREST(REST API)는 거치지 않고 SQL을 직접 실행한다. 그래서 `select=*` 같은 API 동작 차이는 테스트하지 않는다.
