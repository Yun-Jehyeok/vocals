// 인수 테스트: 이슈 #28 묶음 2 — 스키마, enum, 기준 데이터, seed, private 판정 함수
// (QA가 개발 전에 쓴다. 개발은 고치지 않는다. 틀렸다고 보면 `[질문] 받는 역할: QA`)
//
// 완료 조건 → 테스트
// - 스키마: 8개 테이블·컬럼 이름(erd 3·4·6장), RLS, enum 11개(erd·domain.ts), tickets enum 분리
// - fee_policies 기준 데이터: 마이그레이션만 적용한 빈 DB에 trainer_link 0.08만, marketplace는 seed에만
// - #10에서 넘어온 정책: "자기 학생"·"수강 관계" 판정이 private 함수에 있고 anon은 실행할 수 없다
// - 공통: seed에 이번 묶음 더미 데이터가 있다
// 테스트로 쓰지 않는 것(판정 때 코드·CI로 확인): 새 마이그레이션 파일(check:migrations),
//   service role key 위치, 정책을 "함수 하나"에 모았는지의 세부(아래는 정책 본문에 수강 관계 조회가 직접 없는지만 본다)
import { PGlite } from "@electric-sql/pglite";
import * as shared from "@vocals/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyAll, createTestDb } from "../helpers/db.ts";
import { SEED } from "../helpers/seed-ids.ts";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

const BUNDLE2_TABLES = [
  "lesson_products",
  "enrollments",
  "payments",
  "tickets",
  "refund_requests",
  "refunds",
  "group_classes",
  "fee_policies",
] as const;

/** docs/erd.md 3·4·6장 컬럼 (id, created_at 포함) */
const ERD_COLUMNS: Record<(typeof BUNDLE2_TABLES)[number], string[]> = {
  lesson_products: [
    "id",
    "trainer_id",
    "lesson_type",
    "ticket_type",
    "session_count",
    "price",
    "duration_min",
    "active",
    "created_at",
  ],
  enrollments: ["id", "student_id", "trainer_id", "source", "pilot_free", "created_at"],
  payments: [
    "id",
    "student_id",
    "product_id",
    "amount",
    "method",
    "pg_transaction_id",
    "status",
    "paid_at",
    "created_at",
  ],
  tickets: [
    "id",
    "enrollment_id",
    "product_id",
    "payment_id",
    "lesson_type",
    "ticket_type",
    "total_sessions",
    "remaining_sessions",
    "price_paid",
    "fee_rate",
    "valid_until",
    "group_class_id",
    "status",
    "end_reason",
    "created_at",
  ],
  refund_requests: ["id", "ticket_id", "reason", "status", "created_at"],
  refunds: [
    "id",
    "ticket_id",
    "payment_id",
    "refund_request_id",
    "sessions_canceled",
    "amount",
    "processed_by",
    "processed_at",
    "created_at",
  ],
  group_classes: ["id", "trainer_id", "name", "capacity", "duration_min", "created_at"],
  fee_policies: ["id", "source", "rate", "effective_from", "created_at"],
};

/** erd 3·6장 enum 값 (erd 1장 표기: 타입 이름은 <테이블>_<컬럼>) */
const ERD_ENUMS: Record<string, string[]> = {
  lesson_products_lesson_type: ["private", "group"],
  lesson_products_ticket_type: ["regular", "single"],
  enrollments_source: ["trainer_link", "marketplace"],
  payments_method: ["card", "kakaopay", "naverpay", "tosspay"],
  payments_status: ["paid", "partially_refunded", "refunded"],
  tickets_lesson_type: ["private", "group"],
  tickets_ticket_type: ["regular", "single"],
  tickets_status: ["waiting_schedule", "active", "ended"],
  tickets_end_reason: ["used_up", "expired", "refunded"],
  refund_requests_status: ["requested", "processed"],
  fee_policies_source: ["trainer_link", "marketplace"],
};

/** enum 컬럼 → 타입 이름 (결정 로그 2026-11-20: tickets enum 분리) */
const ENUM_COLUMNS: [table: string, column: string, type: string][] = [
  ["lesson_products", "lesson_type", "lesson_products_lesson_type"],
  ["lesson_products", "ticket_type", "lesson_products_ticket_type"],
  ["enrollments", "source", "enrollments_source"],
  ["payments", "method", "payments_method"],
  ["payments", "status", "payments_status"],
  ["tickets", "lesson_type", "tickets_lesson_type"],
  ["tickets", "ticket_type", "tickets_ticket_type"],
  ["tickets", "status", "tickets_status"],
  ["tickets", "end_reason", "tickets_end_reason"],
  ["refund_requests", "status", "refund_requests_status"],
  ["fee_policies", "source", "fee_policies_source"],
];

describe("#28 스키마 — erd 3·4·6장, tech-stack 3.11, PAY-03, STL-03", () => {
  it.each(BUNDLE2_TABLES)("%s의 컬럼이 erd와 같다", async (table) => {
    const { rows } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = $1`,
      [table],
    );
    expect(rows.map((row) => row.column_name).sort()).toEqual([...ERD_COLUMNS[table]].sort());
  });

  it.each(BUNDLE2_TABLES)("%s에 RLS가 켜져 있다", async (table) => {
    const { rows } = await db.query<{ relrowsecurity: boolean }>(
      `select c.relrowsecurity from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = $1 and c.relkind = 'r'`,
      [table],
    );
    expect(rows).toEqual([{ relrowsecurity: true }]);
  });

  it.each(Object.entries(ERD_ENUMS))("enum %s의 값이 erd와 같다", async (type, values) => {
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
    "enum %s의 값이 packages/shared/src/domain.ts의 상수 하나와 같다",
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

  it.each(ENUM_COLUMNS)("%s.%s의 타입은 %s다", async (table, column, type) => {
    const { rows } = await db.query<{ udt_name: string }>(
      `select udt_name from information_schema.columns
       where table_schema = 'public' and table_name = $1 and column_name = $2`,
      [table, column],
    );
    expect(rows).toEqual([{ udt_name: type }]);
  });
});

describe("#28 fee_policies 기준 데이터 — STL-03, 결정 로그 2026-11-19(수수료), idea 결정 필요 4", () => {
  let emptyDb: PGlite;

  beforeAll(async () => {
    emptyDb = new PGlite();
    await applyAll(emptyDb, { seed: false });
  });

  afterAll(async () => {
    await emptyDb.close();
  });

  it("마이그레이션만 적용한 빈 DB에 trainer_link 0.08 행이 있다", async () => {
    const { rows } = await emptyDb.query<{ rate: string }>(
      `select rate::text as rate from public.fee_policies where source = 'trainer_link'`,
    );
    expect(rows.map((row) => Number(row.rate))).toEqual([0.08]);
  });

  it("마이그레이션만 적용한 빈 DB에는 marketplace 행이 없다", async () => {
    const { rows } = await emptyDb.query(
      `select 1 from public.fee_policies where source = 'marketplace'`,
    );
    expect(rows).toEqual([]);
  });

  it("seed를 적용한 DB에는 marketplace 더미 행이 있다", async () => {
    const { rows } = await db.query(
      `select 1 from public.fee_policies where source = 'marketplace'`,
    );
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe("#28 판정 함수는 private 스키마에 있고 anon은 실행할 수 없다 — AUTH-09, ADM-02", () => {
  const privateFunctions = async () =>
    (
      await db.query<{ name: string; definition: string; anon_exec: boolean }>(
        `select p.proname as name, pg_get_functiondef(p.oid) as definition,
                has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'private' and p.prokind = 'f'`,
      )
    ).rows;

  it("수강 관계(enrollments)를 조회하는 private 함수가 둘 이상 있다(자기 학생 판정, 수강 관계 판정)", async () => {
    const functions = (await privateFunctions()).filter((fn) =>
      /\benrollments\b/.test(fn.definition),
    );
    expect(functions.length).toBeGreaterThanOrEqual(2);
    // 자기 학생(AUTH-09)은 끝나지 않은 수강권으로 판정한다
    expect(functions.some((fn) => /\btickets\b/.test(fn.definition))).toBe(true);
  });

  it("수강 관계를 조회하는 private 함수는 anon이 실행할 수 없다", async () => {
    const functions = (await privateFunctions()).filter((fn) =>
      /\benrollments\b/.test(fn.definition),
    );
    expect(functions.length).toBeGreaterThan(0);
    expect(functions.filter((fn) => fn.anon_exec).map((fn) => fn.name)).toEqual([]);
  });

  it.each(["trainer_profiles", "user_private_profiles"])(
    "%s의 authenticated select 정책은 수강 관계를 직접 조회하지 않고 private 함수를 부른다",
    async (table) => {
      const { rows } = await db.query<{ policyname: string; qual: string }>(
        `select policyname, qual from pg_policies
         where schemaname = 'public' and tablename = $1 and cmd = 'SELECT'
           and 'authenticated' = any(roles)`,
        [table],
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.qual, row.policyname).not.toMatch(/\benrollments\b|\btickets\b/);
      }
      expect(rows.some((row) => /private\./.test(row.qual))).toBe(true);
    },
  );
});

describe("#28 seed에 이번 묶음 더미 데이터가 있다 — #10 공통, PAY-03, PLT-03, TRN-04, PAY-10, PAY-11", () => {
  it.each<[string, string, unknown[]]>([
    ["끝나지 않은 수강권", `select 1 from public.tickets where status <> 'ended'`, []],
    [
      "수강권이 모두 ended인 수강 관계",
      `select 1 from public.enrollments e
       where exists (select 1 from public.tickets t where t.enrollment_id = e.id)
         and not exists (select 1 from public.tickets t where t.enrollment_id = e.id and t.status <> 'ended')`,
      [],
    ],
    [
      "파일럿 무료 수강권(pilot_free 수강 관계, payment 없음, 0원)",
      `select 1 from public.tickets t join public.enrollments e on e.id = t.enrollment_id
       where e.pilot_free and t.payment_id is null and t.price_paid = 0`,
      [],
    ],
    [
      "수강권이 배정된 그룹 반",
      `select 1 from public.group_classes g
       where exists (select 1 from public.tickets t where t.group_class_id = g.id)`,
      [],
    ],
    ["비활성 상품", `select 1 from public.lesson_products where not active`, []],
    [
      "정지 트레이너와 수강 관계가 있는 학생",
      `select 1 from public.enrollments where trainer_id = $1`,
      [SEED.trainerSuspended],
    ],
    ["환불 요청", `select 1 from public.refund_requests`, []],
    ["환불", `select 1 from public.refunds`, []],
  ])("%s", async (_, sql, params) => {
    const { rows } = await db.query(sql, params);
    expect(rows.length).toBeGreaterThan(0);
  });
});
