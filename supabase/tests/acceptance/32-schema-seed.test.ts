// 인수 테스트: 이슈 #32 묶음 3 — 스키마, enum, 판정 함수, seed 더미 데이터와 회차 금액
// (QA가 개발 전에 쓴다. 개발은 고치지 않는다. 틀렸다고 보면 `[질문] 받는 역할: QA`)
//
// 완료 조건 → 테스트
// - 스키마: 4개 테이블·컬럼 이름(erd 4장), RLS, enum 5개(erd·domain.ts), 회차 시각 timestamptz(팀장 결정)
// - 판정 함수: 새 판정은 private 스키마에 있고 anon은 실행할 수 없다. 수강 관계·반 배정 판정은 기존 함수를 다시 쓴다
// - 공통: seed에 이번 묶음 더미 데이터가 있다. seed의 차감 행 수와 회차 금액이 shared 함수(sessionAmount)와 맞는다
// 테스트로 쓰지 않는 것(판정 때 코드·CI로 확인): 새 마이그레이션 파일(check:migrations),
//   service role key 위치, weekday 0 = 일요일·Asia/Seoul 기준(값의 뜻이라 DB로 판정할 수 없다. docs·서버 함수에서 본다)
import type { PGlite } from "@electric-sql/pglite";
import * as shared from "@vocals/shared";
import { sessionAmount } from "@vocals/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "../helpers/db.ts";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

const BUNDLE3_TABLES = [
  "fixed_schedules",
  "fixed_schedule_slots",
  "lesson_sessions",
  "session_attendees",
] as const;

/** docs/erd.md 4장 컬럼 (표기 규칙: 모든 테이블에 id, created_at) */
const ERD_COLUMNS: Record<(typeof BUNDLE3_TABLES)[number], string[]> = {
  fixed_schedules: [
    "id",
    "ticket_id",
    "group_class_id",
    "effective_from",
    "effective_to",
    "created_at",
  ],
  fixed_schedule_slots: ["id", "fixed_schedule_id", "weekday", "start_time", "created_at"],
  lesson_sessions: [
    "id",
    "trainer_id",
    "group_class_id",
    "fixed_schedule_id",
    "kind",
    "mode",
    "starts_at",
    "ends_at",
    "status",
    "created_at",
  ],
  session_attendees: [
    "id",
    "session_id",
    "ticket_id",
    "student_id",
    "attendance",
    "canceled_by",
    "deducted",
    "session_amount",
    "checked_at",
    "created_at",
  ],
};

/** erd 4장 enum 값 (erd 1장 표기: 타입 이름은 <테이블>_<컬럼>) */
const ERD_ENUMS: Record<string, string[]> = {
  lesson_sessions_kind: ["regular", "single", "makeup"],
  lesson_sessions_mode: ["offline", "online"],
  lesson_sessions_status: ["scheduled", "canceled"],
  session_attendees_attendance: ["none", "present", "absent", "pre_canceled", "makeup"],
  session_attendees_canceled_by: ["student", "trainer"],
};

/** 컬럼 → 타입 이름 */
const COLUMN_TYPES: [table: string, column: string, type: string][] = [
  ["lesson_sessions", "kind", "lesson_sessions_kind"],
  ["lesson_sessions", "mode", "lesson_sessions_mode"],
  ["lesson_sessions", "status", "lesson_sessions_status"],
  ["session_attendees", "attendance", "session_attendees_attendance"],
  ["session_attendees", "canceled_by", "session_attendees_canceled_by"],
  // 회차 시각은 timestamptz (이슈 #32 팀장 결정)
  ["lesson_sessions", "starts_at", "timestamptz"],
  ["lesson_sessions", "ends_at", "timestamptz"],
  ["fixed_schedule_slots", "start_time", "time"],
  ["fixed_schedules", "effective_from", "date"],
  ["fixed_schedules", "effective_to", "date"],
];

describe("#32 스키마 — erd 4장, tech-stack 3.11, ATT-01, SCH-06", () => {
  it.each(BUNDLE3_TABLES)("%s의 컬럼이 erd와 같다", async (table) => {
    const { rows } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = $1`,
      [table],
    );
    expect(rows.map((row) => row.column_name).sort()).toEqual([...ERD_COLUMNS[table]].sort());
  });

  it.each(BUNDLE3_TABLES)("%s에 RLS가 켜져 있다", async (table) => {
    const { rows } = await db.query<{ relrowsecurity: boolean }>(
      `select c.relrowsecurity from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = $1 and c.relkind = 'r'`,
      [table],
    );
    expect(rows).toEqual([{ relrowsecurity: true }]);
  });

  it.each(Object.entries(ERD_ENUMS))("ATT-01: enum %s의 값이 erd와 같다", async (type, values) => {
    const { rows } = await db.query<{ enumlabel: string }>(
      `select e.enumlabel from pg_enum e
       join pg_type t on t.oid = e.enumtypid
       join pg_namespace n on n.oid = t.typnamespace
       where n.nspname = 'public' and t.typname = $1
       order by e.enumsortorder`,
      [type],
    );
    expect(rows.map((row) => row.enumlabel)).toEqual(values);
  });

  it.each(Object.entries(ERD_ENUMS))(
    "ATT-01: enum %s의 값이 packages/shared/src/domain.ts의 상수 하나와 같다",
    (type, values) => {
      const constants = Object.values(shared as Record<string, unknown>).filter(
        (value): value is readonly string[] => Array.isArray(value),
      );
      expect(
        constants.some((constant) => JSON.stringify(constant) === JSON.stringify(values)),
        `${type}: ${values.join(", ")}`,
      ).toBe(true);
    },
  );

  it.each(COLUMN_TYPES)("%s.%s의 타입은 %s다", async (table, column, type) => {
    const { rows } = await db.query<{ udt_name: string }>(
      `select udt_name from information_schema.columns
       where table_schema = 'public' and table_name = $1 and column_name = $2`,
      [table, column],
    );
    expect(rows).toEqual([{ udt_name: type }]);
  });
});

// ===========================================================================
// 판정 함수
// ===========================================================================

/** 묶음 1·2(마이그레이션 20261119170000·20261121120000·20261121150000)까지의 private 함수 */
const EXISTING_PRIVATE_FUNCTIONS = new Set([
  "can_request_refund",
  "enrollment_student_id",
  "enrollment_trainer_id",
  "generate_link_slug",
  "group_class_student_count",
  "group_class_trainer_id",
  "group_classes_before_update",
  "has_enrollment_with",
  "is_active_user",
  "is_admin",
  "is_assigned_to_group_class",
  "is_enrollment_member",
  "is_own_student",
  "lesson_product_trainer_id",
  "lesson_products_before_update",
  "tickets_before_write",
  "trainer_approval_status",
  "trainer_can_edit_business_info",
  "trainer_profile_is_public",
  "trainer_profiles_before_write",
  "user_role",
]);

describe("#32 판정 함수는 private 스키마에 있고 기존 판정을 다시 쓴다 — SCH-09, ATT-05, AUTH-07, 묶음 1·2 권한 원칙", () => {
  const newPrivateFunctions = async () =>
    (
      await db.query<{ name: string; definition: string; anon_exec: boolean }>(
        `select p.proname as name, pg_get_functiondef(p.oid) as definition,
                has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'private' and p.prokind = 'f'`,
      )
    ).rows.filter((fn) => !EXISTING_PRIVATE_FUNCTIONS.has(fn.name));

  const BUNDLE3_TABLE_PATTERN =
    /\b(fixed_schedules|fixed_schedule_slots|lesson_sessions|session_attendees)\b/;

  it("SCH-09·ATT-05: 묶음 3 테이블을 조회하는 새 private 함수가 있다(회차의 트레이너, 회차 참여 등)", async () => {
    const functions = (await newPrivateFunctions()).filter((fn) =>
      BUNDLE3_TABLE_PATTERN.test(fn.definition),
    );
    expect(functions.length).toBeGreaterThan(0);
  });

  it("SCH-09·ATT-05: 새 private 함수는 anon이 실행할 수 없다", async () => {
    const functions = await newPrivateFunctions();
    expect(functions.length).toBeGreaterThan(0);
    expect(functions.filter((fn) => fn.anon_exec).map((fn) => fn.name)).toEqual([]);
  });

  it("SCH-09: 새 private 함수는 수강 관계(enrollments)를 직접 조회하지 않는다 (기존 enrollment_* 함수를 다시 쓴다)", async () => {
    const functions = await newPrivateFunctions();
    expect(functions.length).toBeGreaterThan(0);
    expect(
      functions.filter((fn) => /\bpublic\.enrollments\b/.test(fn.definition)).map((fn) => fn.name),
    ).toEqual([]);
  });

  it.each(BUNDLE3_TABLES)(
    "SCH-09·ATT-05: %s의 authenticated 정책은 enrollments·tickets·group_classes를 직접 조회하지 않는다(판정은 private 함수)",
    async (table) => {
      const { rows } = await db.query<{
        policyname: string;
        qual: string | null;
        with_check: string | null;
      }>(
        `select policyname, qual, with_check from pg_policies
         where schemaname = 'public' and tablename = $1 and 'authenticated' = any(roles)`,
        [table],
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const body = `${row.qual ?? ""} ${row.with_check ?? ""}`;
        expect(body, row.policyname).not.toMatch(/\b(enrollments|tickets|group_classes)\b/);
      }
    },
  );

  it("AUTH-07: lesson_sessions의 authenticated update 정책은 private.is_active_user로 탈퇴를 판정한다", async () => {
    const { rows } = await db.query<{ qual: string | null; with_check: string | null }>(
      `select qual, with_check from pg_policies
       where schemaname = 'public' and tablename = 'lesson_sessions' and cmd = 'UPDATE'
         and 'authenticated' = any(roles)`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(`${row.qual ?? ""} ${row.with_check ?? ""}`).toMatch(/is_active_user/);
    }
  });
});

// ===========================================================================
// seed
// ===========================================================================

describe("#32 seed에 이번 묶음 더미 데이터가 있다 — #10 공통, SCH-01, SCH-02, SCH-04, SCH-06, SCH-08, ATT-01, ATT-05", () => {
  it.each<[string, string]>([
    [
      "SCH-01: 요일이 2개인 1:1 고정 일정과 그 회차",
      `select 1 from public.fixed_schedules f
       where f.ticket_id is not null
         and (select count(*) from public.fixed_schedule_slots s where s.fixed_schedule_id = f.id) >= 2
         and exists (select 1 from public.lesson_sessions l where l.fixed_schedule_id = f.id)`,
    ],
    [
      "SCH-04: 수정되어 effective_to가 닫힌 고정 일정",
      `select 1 from public.fixed_schedules where effective_to is not null`,
    ],
    [
      "SCH-01: 그룹 반 고정 일정과 학생 2명 이상이 참여한 그룹 회차",
      `select 1 from public.lesson_sessions l
       join public.fixed_schedules f on f.id = l.fixed_schedule_id
       where f.group_class_id is not null and l.group_class_id = f.group_class_id
         and (select count(distinct a.student_id) from public.session_attendees a
              where a.session_id = l.id) >= 2`,
    ],
    [
      "SCH-02: 일회권 회차",
      `select 1 from public.lesson_sessions l
       join public.session_attendees a on a.session_id = l.id
       join public.tickets t on t.id = a.ticket_id
       where l.kind = 'single' and t.ticket_type = 'single'`,
    ],
    ["SCH-08: 보강 회차", `select 1 from public.lesson_sessions where kind = 'makeup'`],
    ["SCH-06: 취소된 회차", `select 1 from public.lesson_sessions where status = 'canceled'`],
    [
      "ATT-05: 끝난 수강권의 지난 회차",
      `select 1 from public.session_attendees a
       join public.tickets t on t.id = a.ticket_id
       join public.lesson_sessions l on l.id = a.session_id
       where t.status = 'ended' and l.starts_at < now()`,
    ],
  ])("%s", async (_, sql) => {
    const { rows } = await db.query(sql);
    expect(rows.length).toBeGreaterThan(0);
  });

  it.each(["none", "present", "absent", "pre_canceled", "makeup"])(
    "ATT-01: 출결 상태 %s인 참여 행이 있다",
    async (attendance) => {
      const { rows } = await db.query(
        `select 1 from public.session_attendees where attendance::text = $1`,
        [attendance],
      );
      expect(rows.length).toBeGreaterThan(0);
    },
  );
});

describe("#32 seed의 차감 행과 회차 금액이 shared 함수와 맞는다 — STL-02, ATT-02", () => {
  type Deducted = {
    ticket_id: string;
    total_sessions: number;
    remaining_sessions: number;
    price_paid: number;
    session_amount: number | null;
    deduction_number: number;
  };
  const deductedRows = async () =>
    (
      await db.query<Deducted>(
        `select t.id as ticket_id, t.total_sessions, t.remaining_sessions, t.price_paid,
                a.session_amount,
                (row_number() over (partition by t.id order by l.starts_at, a.id))::int as deduction_number
         from public.session_attendees a
         join public.tickets t on t.id = a.ticket_id
         join public.lesson_sessions l on l.id = a.session_id
         where a.deducted
         order by t.id, deduction_number`,
      )
    ).rows;

  it("STL-02: seed에 차감된 참여 행이 있다", async () => {
    expect((await deductedRows()).length).toBeGreaterThan(0);
  });

  it("ATT-02: 수강권마다 차감 행 수 = total_sessions − remaining_sessions", async () => {
    const rows = await deductedRows();
    const byTicket = new Map<string, Deducted[]>();
    for (const row of rows)
      byTicket.set(row.ticket_id, [...(byTicket.get(row.ticket_id) ?? []), row]);
    expect(byTicket.size).toBeGreaterThan(0);
    for (const [ticketId, list] of byTicket) {
      const first = list[0] as Deducted;
      expect(list.length, ticketId).toBe(first.total_sessions - first.remaining_sessions);
    }
  });

  it("STL-02: 차감 행의 session_amount는 sessionAmount(차감 순서는 회차 시각 순)와 같다", async () => {
    const rows = await deductedRows();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.session_amount, `${row.ticket_id} #${row.deduction_number}`).toBe(
        sessionAmount({
          pricePaid: row.price_paid,
          totalSessions: row.total_sessions,
          deductionNumber: row.deduction_number,
        }),
      );
    }
  });
});
