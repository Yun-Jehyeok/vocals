// 인수 테스트: 이슈 #45 사용자 이용 제한 — 스키마, 판정 함수, 권한 판정 트리거 순서, seed 더미 데이터
// (QA가 개발 전에 쓴다. 개발은 고치지 않는다. 틀렸다고 보면 `[질문] 받는 역할: QA`)
//
// 완료 조건 → 테스트
// - 스키마: user_restrictions가 erd 7장 컬럼 이름 그대로(id, created_at, user_id, reason, restricted_by, lifted_at,
//   lifted_by), RLS 켜짐, 새 enum 없음, 필수 컬럼(not null)
// - 판정 함수: 제한 중 판정은 private 함수에 있다(public 함수 아님). anon은 새 security definer 함수를 실행할 수 없다.
//   운영자 판정은 private.is_admin, 탈퇴 판정은 private.is_active_user를 다시 쓴다(새 함수·정책이 public.users를
//   직접 조회하지 않고, 클라이언트 쓰기 정책에 is_admin·is_active_user가 붙어 있다)
// - 클라이언트 insert의 권한 판정 트리거 user_restrictions_authorize_insert가 무결성 트리거보다 먼저 돈다(#38)
// - 공통: seed에 이번 이슈 더미 데이터가 있고, 기존 seed의 메시지·후기가 새 제약에 걸리지 않고 들어간다
// 테이블이 없을 때도 참인 단언("public 함수 없음", 정책 for-loop)은 개발 전에도 통과한다. 같은 describe의
//   "제한 판정 private 함수가 있다"·"쓰기 정책이 있다"가 짝이다(QA 메모리, #35).
// 테스트로 쓰지 않는 것(판정 때 코드·CI로 확인): 새 마이그레이션 파일·기존 마이그레이션 보호(check:migrations),
//   빈 DB 적용(createTestDb가 shim → 마이그레이션 → seed를 적용한다), service role key 위치
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "../helpers/db.ts";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

const TABLE = "user_restrictions";

/** docs/erd.md 7장 (표기 규칙: id·created_at, created_at = 제한 시각) */
const ERD_COLUMNS = [
  "id",
  "created_at",
  "user_id",
  "reason",
  "restricted_by",
  "lifted_at",
  "lifted_by",
];

describe("#45 스키마 — erd 7장, tech-stack 3.11, ADM-04", () => {
  it("ADM-04: user_restrictions의 컬럼이 erd와 같다", async () => {
    const { rows } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = $1`,
      [TABLE],
    );
    expect(rows.map((row) => row.column_name).sort()).toEqual([...ERD_COLUMNS].sort());
  });

  it("ADM-04: user_restrictions에 RLS가 켜져 있다", async () => {
    const { rows } = await db.query<{ relrowsecurity: boolean }>(
      `select c.relrowsecurity from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = $1 and c.relkind = 'r'`,
      [TABLE],
    );
    expect(rows).toEqual([{ relrowsecurity: true }]);
  });

  it("ADM-04: user_restrictions에 enum 컬럼이 없다(새 enum 없음) — 짝: 컬럼이 erd와 같다", async () => {
    const { rows } = await db.query<{ column_name: string; data_type: string }>(
      `select column_name, data_type from information_schema.columns
       where table_schema = 'public' and table_name = $1 and data_type = 'USER-DEFINED'`,
      [TABLE],
    );
    expect(rows).toEqual([]);
  });

  it.each([
    ["id", "uuid"],
    ["user_id", "uuid"],
    ["restricted_by", "uuid"],
    ["lifted_by", "uuid"],
    ["reason", "text"],
    ["created_at", "timestamptz"],
    ["lifted_at", "timestamptz"],
  ])("ADM-04: user_restrictions.%s의 타입은 %s다", async (column, type) => {
    const { rows } = await db.query<{ udt_name: string }>(
      `select udt_name from information_schema.columns
       where table_schema = 'public' and table_name = $1 and column_name = $2`,
      [TABLE, column],
    );
    expect(rows).toEqual([{ udt_name: type }]);
  });

  it.each(["id", "created_at", "user_id", "reason", "restricted_by"])(
    "ADM-04: user_restrictions.%s는 비어 있을 수 없다",
    async (column) => {
      const { rows } = await db.query<{ is_nullable: string }>(
        `select is_nullable from information_schema.columns
         where table_schema = 'public' and table_name = $1 and column_name = $2`,
        [TABLE, column],
      );
      expect(rows).toEqual([{ is_nullable: "NO" }]);
    },
  );

  it.each(["lifted_at", "lifted_by"])(
    "ADM-04: user_restrictions.%s는 비어 있을 수 있다(풀리지 않은 줄)",
    async (column) => {
      const { rows } = await db.query<{ is_nullable: string }>(
        `select is_nullable from information_schema.columns
         where table_schema = 'public' and table_name = $1 and column_name = $2`,
        [TABLE, column],
      );
      expect(rows).toEqual([{ is_nullable: "YES" }]);
    },
  );

  it.each(["user_id", "restricted_by", "lifted_by"])(
    "ADM-04: user_restrictions.%s는 users를 가리킨다(FK)",
    async (column) => {
      const { rows } = await db.query<{ target: string }>(
        `select ccu.table_name as target
         from information_schema.key_column_usage kcu
         join information_schema.table_constraints tc
           on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
         join information_schema.constraint_column_usage ccu
           on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
         where tc.constraint_type = 'FOREIGN KEY' and kcu.table_schema = 'public'
           and kcu.table_name = $1 and kcu.column_name = $2`,
        [TABLE, column],
      );
      expect(rows).toEqual([{ target: "users" }]);
    },
  );
});

// ===========================================================================
// 판정 함수
// ===========================================================================

/** #41(마이그레이션 20261122120000)까지의 private 함수 */
const EXISTING_PRIVATE_FUNCTIONS = new Set([
  "authorize_client_insert",
  "can_read_homework_video",
  "can_request_refund",
  "chat_members_before_write",
  "enrollment_student_id",
  "enrollment_trainer_id",
  "feedback_comments_before_write",
  "fixed_schedule_group_class_id",
  "fixed_schedule_trainer_id",
  "fixed_schedules_before_write",
  "generate_link_slug",
  "group_class_student_count",
  "group_class_trainer_id",
  "group_classes_before_update",
  "has_blocked",
  "has_enrollment_with",
  "homework_targets_before_write",
  "homework_trainer_id",
  "homework_videos_before_write",
  "homeworks_before_write",
  "is_active_user",
  "is_admin",
  "is_assigned_to_group_class",
  "is_current_room_member",
  "is_enrollment_member",
  "is_homework_target",
  "is_own_student",
  "is_session_attendee",
  "is_ticket_member",
  "lesson_product_trainer_id",
  "lesson_products_before_update",
  "lesson_session_trainer_id",
  "lesson_sessions_before_delete",
  "lesson_sessions_before_write",
  "messages_before_write",
  "reports_before_write",
  "reviews_before_write",
  "reviews_set_updated_at",
  "room_group_trainer_id",
  "room_has_reported_message",
  "room_joined_at",
  "session_attendees_before_write",
  "session_has_deducted_attendee",
  "submissions_before_write",
  "tickets_before_write",
  "trainer_approval_status",
  "trainer_can_edit_business_info",
  "trainer_profile_is_public",
  "trainer_profile_videos_before_write",
  "trainer_profiles_before_write",
  "user_role",
  "videos_before_write",
]);

describe("#45 제한 판정은 private 함수에 있고 기존 판정을 다시 쓴다 — ADM-04, AUTH-07, 묶음 1~6 권한 원칙", () => {
  type Fn = {
    schema: string;
    name: string;
    definition: string;
    anon_exec: boolean;
    secdef: boolean;
  };
  const functions = async (schema: string) =>
    (
      await db.query<Fn>(
        `select n.nspname as schema, p.proname as name, pg_get_functiondef(p.oid) as definition,
                has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
                p.prosecdef as secdef
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = $1 and p.prokind = 'f'`,
        [schema],
      )
    ).rows;
  const newPrivateFunctions = async () =>
    (await functions("private")).filter((fn) => !EXISTING_PRIVATE_FUNCTIONS.has(fn.name));
  const RESTRICTIONS = /\bpublic\.user_restrictions\b/;

  it("ADM-04: user_restrictions를 조회하는 새 private 함수(제한 중 판정)가 있다", async () => {
    const found = (await newPrivateFunctions()).filter((fn) => RESTRICTIONS.test(fn.definition));
    expect(found.length).toBeGreaterThan(0);
  });

  it("ADM-04: public 스키마 함수는 user_restrictions를 조회하지 않는다 (짝: 위 private 함수가 있다)", async () => {
    const found = (await functions("public")).filter((fn) => RESTRICTIONS.test(fn.definition));
    expect(found.map((fn) => fn.name)).toEqual([]);
  });

  it("ADM-04: 새 security definer private 함수는 anon이 실행할 수 없다", async () => {
    const fns = await newPrivateFunctions();
    expect(fns.length).toBeGreaterThan(0);
    expect(fns.filter((fn) => fn.secdef && fn.anon_exec).map((fn) => fn.name)).toEqual([]);
  });

  it("ADM-04·AUTH-07: 새 private 함수는 public.users를 직접 조회하지 않는다(운영자는 is_admin·user_role, 탈퇴는 is_active_user를 다시 쓴다)", async () => {
    const fns = await newPrivateFunctions();
    expect(fns.length).toBeGreaterThan(0);
    expect(
      fns.filter((fn) => /\bpublic\.users\b/.test(fn.definition)).map((fn) => fn.name),
    ).toEqual([]);
  });

  type Policy = { policyname: string; cmd: string; qual: string | null; with_check: string | null };
  const authenticatedPolicies = async () =>
    (
      await db.query<Policy>(
        `select policyname, cmd, qual, with_check from pg_policies
         where schemaname = 'public' and tablename = $1 and 'authenticated' = any(roles)`,
        [TABLE],
      )
    ).rows;

  it("ADM-04: user_restrictions에 클라이언트(authenticated) insert·update 정책이 있다 (짝: 아래 for-loop)", async () => {
    const cmds = new Set((await authenticatedPolicies()).map((row) => row.cmd));
    expect(cmds.has("INSERT") || cmds.has("ALL")).toBe(true);
    expect(cmds.has("UPDATE") || cmds.has("ALL")).toBe(true);
  });

  it("AUTH-07: user_restrictions의 클라이언트 쓰기 정책은 모두 private.is_active_user와 private.is_admin으로 판정한다", async () => {
    for (const row of await authenticatedPolicies()) {
      if (!["INSERT", "UPDATE", "DELETE", "ALL"].includes(row.cmd)) continue;
      const body = `${row.qual ?? ""} ${row.with_check ?? ""}`;
      expect(body, row.policyname).toMatch(/is_active_user/);
      expect(body, row.policyname).toMatch(/is_admin/);
    }
  });

  it("ADM-04: user_restrictions의 authenticated 정책은 users를 직접 조회하지 않는다(운영자 판정은 is_admin)", async () => {
    const rows = await authenticatedPolicies();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(`${row.qual ?? ""} ${row.with_check ?? ""}`, row.policyname).not.toMatch(/\busers\b/);
    }
  });

  it("ADM-04: user_restrictions에는 클라이언트 delete 권한이 없다(줄을 지우지 않는다)", async () => {
    const { rows: exists } = await db.query(
      `select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = $1 and c.relkind = 'r'`,
      [TABLE],
    );
    expect(exists.length, `${TABLE} 테이블이 있다`).toBe(1);
    const { rows } = await db.query(
      `select privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = $1
         and grantee in ('anon', 'authenticated') and privilege_type in ('DELETE', 'TRUNCATE')`,
      [TABLE],
    );
    expect(rows).toEqual([]);
  });
});

describe("#45 클라이언트 insert의 권한 판정이 무결성 트리거보다 먼저 돈다 — ADM-04, #38", () => {
  const beforeInsertTriggers = async () =>
    (
      await db.query<{ name: string }>(
        // tgtype 비트: 1 = ROW, 2 = BEFORE, 4 = INSERT
        `select t.tgname as name
         from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
         join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = $1 and not t.tgisinternal
           and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 4) = 4
         order by t.tgname`,
        [TABLE],
      )
    ).rows.map((row) => row.name);

  it("ADM-04: user_restrictions에 user_restrictions_authorize_insert BEFORE INSERT 트리거가 있다", async () => {
    expect(await beforeInsertTriggers()).toContain("user_restrictions_authorize_insert");
  });

  it("ADM-04: user_restrictions의 BEFORE INSERT 트리거 중 user_restrictions_authorize_insert가 이름순 맨 앞이다(같은 시점 트리거는 이름순으로 돈다)", async () => {
    expect((await beforeInsertTriggers())[0]).toBe("user_restrictions_authorize_insert");
  });
});

// ===========================================================================
// seed
// ===========================================================================

describe("#45 seed에 이번 이슈 더미 데이터가 있다 — #10 공통, ADM-04", () => {
  it.each<[string, string]>([
    [
      "ADM-04: 제한 중인 학생",
      `select 1 from public.user_restrictions r join public.users u on u.id = r.user_id
       where r.lifted_at is null and u.role = 'student'`,
    ],
    [
      "ADM-04: 제한 중인 트레이너",
      `select 1 from public.user_restrictions r join public.users u on u.id = r.user_id
       where r.lifted_at is null and u.role = 'trainer'`,
    ],
    [
      "ADM-04: 풀린 제한 줄(lifted_at·lifted_by 있음)",
      `select 1 from public.user_restrictions where lifted_at is not null and lifted_by is not null`,
    ],
    [
      "ADM-04: 같은 사용자의 지난 줄(풀림)과 새 줄(풀리지 않음)",
      `select user_id from public.user_restrictions group by user_id
       having bool_or(lifted_at is null) and bool_or(lifted_at is not null)`,
    ],
    [
      "ADM-04: 제한한 운영자(restricted_by)는 운영자다",
      `select 1 from public.user_restrictions r join public.users u on u.id = r.restricted_by
       where u.role = 'admin'`,
    ],
  ])("%s", async (_, sql) => {
    const { rows } = await db.query(sql);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("ADM-04: seed의 메시지·후기가 새 제약에 걸리지 않고 들어간다(빈 DB 적용 성공 + 행 있음)", async () => {
    const { rows } = await db.query<{ messages: number; reviews: number }>(
      `select (select count(*)::int from public.messages) as messages,
              (select count(*)::int from public.reviews) as reviews`,
    );
    expect(rows[0]?.messages).toBeGreaterThan(0);
    expect(rows[0]?.reviews).toBeGreaterThan(0);
  });
});
