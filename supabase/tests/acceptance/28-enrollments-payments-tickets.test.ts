// 인수 테스트: 이슈 #28 묶음 2 — enrollments, payments, tickets, 수강권 무결성, "DB가 금액을 계산하지 않는다"
// (QA가 개발 전에 쓴다. 개발은 고치지 않는다. 틀렸다고 보면 `[질문] 받는 역할: QA`)
//
// 준비 데이터와 역할은 28-fixture.ts. 결제·수강 관계·수강권은 서버(service_role)만 쓴다(이슈 #28 범위).
// 권한은 RLS 매트릭스(attempt)로, 값 검사·중복은 attemptWrite(제약·트리거 거부도 거부)로 판정한다.
// 반 배정(group_class_id)은 28-products-classes.test.ts.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, asUser, service, withActor } from "../helpers/db.ts";
import { attemptWrite, describeRlsMatrix } from "../helpers/rls-matrix.ts";
import type { OpCase } from "../helpers/rls-matrix.ts";
import type { TicketColumn } from "./28-fixture.ts";
import {
  E,
  GC,
  P,
  PAY,
  TK,
  U,
  createBundle2Db,
  newPaymentForD,
  ticketInsertSql,
} from "./28-fixture.ts";

let db: PGlite;

beforeAll(async () => {
  db = await createBundle2Db();
});

afterAll(async () => {
  await db?.close();
});

const getDb = () => db;

const ACTORS = {
  anon,
  학생A: asUser(U.SA),
  학생B: asUser(U.SB),
  학생C: asUser(U.SC),
  T1: asUser(U.T1),
  T2: asUser(U.T2),
  운영자: asUser(U.ADMIN),
};

// ===========================================================================
// enrollments
// ===========================================================================

describeRlsMatrix(
  {
    title: "#28 enrollments 권한 — PAY-04, PLT-02, MKT-06, ADM-07",
    actors: ACTORS,
    cases: {
      "enrollments:T1–학생A": {
        select: {
          sql: `select 1 from public.enrollments where id = $1`,
          params: [E.A],
        },
        // 수강 관계가 없는 쌍(학생B–T1)을 새로 만든다
        insert: {
          sql: `insert into public.enrollments (student_id, trainer_id, source, pilot_free)
                values ($1, $2, 'trainer_link', false)`,
          params: [U.SB, U.T1],
        },
        update: {
          sql: `update public.enrollments set source = 'marketplace', pilot_free = true where id = $1`,
          params: [E.A],
        },
        delete: {
          sql: `delete from public.enrollments where id = $1`,
          params: [E.D],
        },
      },
      "enrollments.pilot_free:T1–학생A": {
        update: {
          sql: `update public.enrollments set pilot_free = true where id = $1`,
          params: [E.A],
        },
      },
      "enrollments.source:T1–학생A": {
        update: {
          sql: `update public.enrollments set source = 'marketplace' where id = $1`,
          params: [E.A],
        },
      },
    },
    rows: [
      // 역할      테이블                                select   insert   update   delete
      ["학생A", "enrollments:T1–학생A", "allow", "-", "deny", "deny"],
      ["T1", "enrollments:T1–학생A", "allow", "deny", "deny", "deny"],
      ["운영자", "enrollments:T1–학생A", "allow", "deny", "deny", "deny"],
      ["T2", "enrollments:T1–학생A", "deny", "-", "deny", "deny"],
      ["학생B", "enrollments:T1–학생A", "deny", "deny", "deny", "deny"],
      ["학생C", "enrollments:T1–학생A", "deny", "-", "-", "-"],
      ["anon", "enrollments:T1–학생A", "deny", "deny", "deny", "deny"],
      ["학생A", "enrollments.pilot_free:T1–학생A", "-", "-", "deny", "-"],
      ["T1", "enrollments.pilot_free:T1–학생A", "-", "-", "deny", "-"],
      ["학생A", "enrollments.source:T1–학생A", "-", "-", "deny", "-"],
      ["T1", "enrollments.source:T1–학생A", "-", "-", "deny", "-"],
    ],
  },
  { db: getDb },
);

describe("#28 enrollments는 (학생, 트레이너) 쌍마다 하나이고 서버만 쓴다 — PAY-04, PLT-02, MKT-06", () => {
  const insertPair = (studentId: string, trainerId: string): OpCase => ({
    sql: `insert into public.enrollments (student_id, trainer_id, source, pilot_free)
          values ($1, $2, 'marketplace', false)`,
    params: [studentId, trainerId],
  });

  it("서버 × 새 쌍(학생B–T1) insert → 허용", async () => {
    expect(await attemptWrite(db, service, insertPair(U.SB, U.T1))).toBe("allow");
  });

  it("서버 × 이미 있는 쌍(학생A–T1) insert → 거부", async () => {
    expect(await attemptWrite(db, service, insertPair(U.SA, U.T1))).toBe("reject");
  });

  it("서버 × 파일럿 무료 수강 관계(pilot_free = true) insert → 허용 (PLT-02)", async () => {
    expect(
      await attemptWrite(db, service, {
        sql: `insert into public.enrollments (student_id, trainer_id, source, pilot_free)
              values ($1, $2, 'trainer_link', true)`,
        params: [U.SB, U.TPL],
      }),
    ).toBe("allow");
  });
});

// ===========================================================================
// payments
// ===========================================================================

const insertPayment = (studentId: string): OpCase => ({
  sql: `insert into public.payments
          (student_id, product_id, amount, method, pg_transaction_id, status, paid_at)
        values ($1, $2, 200000, 'card', 'b2-pg-client', 'paid', now())`,
  params: [studentId, P.T1_PRIVATE],
});

describeRlsMatrix(
  {
    title: "#28 payments 권한 — PAY-01, PAY-03, ADM-07, PM 질문 2(트레이너는 못 본다)",
    actors: ACTORS,
    cases: {
      "payments:학생A 결제": {
        select: { sql: `select 1 from public.payments where id = $1`, params: [PAY.A1] },
        insert: insertPayment(U.SA),
        update: {
          sql: `update public.payments set amount = 1, status = 'refunded' where id = $1`,
          params: [PAY.A1],
        },
        delete: { sql: `delete from public.payments where id = $1`, params: [PAY.D] },
      },
    },
    rows: [
      // 역할      테이블                 select   insert   update   delete
      ["학생A", "payments:학생A 결제", "allow", "deny", "deny", "deny"],
      ["운영자", "payments:학생A 결제", "allow", "deny", "deny", "deny"],
      ["T1", "payments:학생A 결제", "deny", "deny", "deny", "deny"],
      ["T2", "payments:학생A 결제", "deny", "-", "-", "-"],
      ["학생B", "payments:학생A 결제", "deny", "-", "deny", "deny"],
      ["학생C", "payments:학생A 결제", "deny", "-", "-", "-"],
      ["anon", "payments:학생A 결제", "deny", "deny", "deny", "deny"],
    ],
  },
  { db: getDb },
);

describe("#28 payments는 서버가 쓴다 — PAY-01", () => {
  it("서버 × 결제 insert → 허용", async () => {
    expect(await attemptWrite(db, service, insertPayment(U.SA))).toBe("allow");
  });

  it.each(["card", "kakaopay", "naverpay", "tosspay"])(
    "서버 × 결제 수단 %s insert → 허용 (PAY-01)",
    async (method) => {
      expect(
        await attemptWrite(db, service, {
          sql: `insert into public.payments
                  (student_id, product_id, amount, method, pg_transaction_id, status, paid_at)
                values ($1, $2, 200000, $3::public.payments_method, 'b2-pg-method', 'paid', now())`,
          params: [U.SA, P.T1_PRIVATE, method],
        }),
      ).toBe("allow");
    },
  );
});

// ===========================================================================
// tickets 권한
// ===========================================================================

describeRlsMatrix(
  {
    title: "#28 tickets 권한 — PAY-03, ATT-05, ADM-07",
    actors: { ...ACTORS, 학생D: asUser(U.SD) },
    cases: {
      "tickets:학생A 수강권": {
        select: { sql: `select 1 from public.tickets where id = $1`, params: [TK.A1] },
      },
      "tickets:학생A 파일럿 수강권": {
        select: { sql: `select 1 from public.tickets where id = $1`, params: [TK.A_PILOT] },
      },
      "tickets:학생D 수강권": {
        insert: { sql: ticketInsertSql(), setup: newPaymentForD },
        delete: { sql: `delete from public.tickets where id = $1`, params: [TK.D] },
      },
    },
    rows: [
      // 역할      테이블                          select   insert   update   delete
      ["학생A", "tickets:학생A 수강권", "allow", "-", "-", "-"],
      ["T1", "tickets:학생A 수강권", "allow", "-", "-", "-"],
      ["운영자", "tickets:학생A 수강권", "allow", "-", "-", "-"],
      ["T2", "tickets:학생A 수강권", "deny", "-", "-", "-"],
      ["학생B", "tickets:학생A 수강권", "deny", "-", "-", "-"],
      ["학생C", "tickets:학생A 수강권", "deny", "-", "-", "-"],
      ["anon", "tickets:학생A 수강권", "deny", "-", "-", "-"],
      ["학생A", "tickets:학생A 파일럿 수강권", "allow", "-", "-", "-"],
      ["T1", "tickets:학생A 파일럿 수강권", "deny", "-", "-", "-"],

      ["학생D", "tickets:학생D 수강권", "-", "deny", "-", "deny"],
      ["T1", "tickets:학생D 수강권", "-", "deny", "-", "deny"],
      ["운영자", "tickets:학생D 수강권", "-", "deny", "-", "deny"],
      ["anon", "tickets:학생D 수강권", "-", "deny", "-", "deny"],
    ],
  },
  { db: getDb },
);

/** 학생A 1:1 active 수강권(4회 중 3회 남음)에 바른 값으로 시도할 고치기. group_class_id는 아래 따로 */
const TICKET_UPDATES: [label: string, set: string][] = [
  ["remaining_sessions", "remaining_sessions = 2"],
  ["status", "status = 'waiting_schedule'"],
  [
    "status·end_reason (끝내기)",
    "status = 'ended', end_reason = 'refunded', remaining_sessions = 0",
  ],
  ["price_paid", "price_paid = 1"],
  ["fee_rate", "fee_rate = 0.5"],
  ["total_sessions", "total_sessions = 5"],
  ["valid_until", "valid_until = '2030-01-01'"],
  ["product_id", `product_id = '${P.T1_GROUP}'`],
  ["payment_id", "payment_id = null"],
  ["enrollment_id", `enrollment_id = '${E.C}'`],
  ["lesson_type", "lesson_type = 'group'"],
  ["ticket_type", "ticket_type = 'single', total_sessions = 1, remaining_sessions = 1"],
];

describe("#28 수강권은 반 배정 말고는 클라이언트가 고치지 못한다 — PAY-03, ATT-05, TRN-04, 팀장 결정 5", () => {
  it.each(TICKET_UPDATES)("T1 × 학생A 수강권 %s update → 거부", async (_, set) => {
    expect(
      await attemptWrite(db, asUser(U.T1), {
        sql: `update public.tickets set ${set} where id = $1`,
        params: [TK.A1],
      }),
    ).toBe("reject");
  });

  it.each(TICKET_UPDATES)("학생A × 자기 수강권 %s update → 거부", async (_, set) => {
    expect(
      await attemptWrite(db, asUser(U.SA), {
        sql: `update public.tickets set ${set} where id = $1`,
        params: [TK.A1],
      }),
    ).toBe("reject");
  });

  it("운영자 × 학생A 수강권 remaining_sessions update → 거부 (서버만 쓴다)", async () => {
    expect(
      await attemptWrite(db, asUser(U.ADMIN), {
        sql: `update public.tickets set remaining_sessions = 2 where id = $1`,
        params: [TK.A1],
      }),
    ).toBe("reject");
  });

  it("서버 × 학생A 수강권 remaining_sessions update → 허용 (차감·환불은 서버)", async () => {
    expect(
      await attemptWrite(db, service, {
        sql: `update public.tickets set remaining_sessions = 2 where id = $1`,
        params: [TK.A1],
      }),
    ).toBe("allow");
  });
});

// ===========================================================================
// 수강권 무결성 (서버 insert도 거부) — PAY-03, PLT-03, erd 3·4장, 팀장 결정 3·4
// ===========================================================================

describe("#28 수강권 값 검사는 서버 insert에도 걸린다 — PAY-03, PLT-03, 팀장 결정 3·4", () => {
  const cases: [string, Partial<Record<TicketColumn, string>>, "allow" | "reject"][] = [
    ["바른 정기권 (짝)", {}, "allow"],
    ["total_sessions = 0", { total_sessions: "0", remaining_sessions: "0" }, "reject"],
    ["remaining_sessions = -1", { remaining_sessions: "-1" }, "reject"],
    ["remaining_sessions > total_sessions", { remaining_sessions: "9" }, "reject"],
    ["remaining_sessions = 0 (짝)", { remaining_sessions: "0" }, "allow"],
    ["price_paid = -1", { price_paid: "-1" }, "reject"],
    [
      "일회권인데 total_sessions = 2",
      { ticket_type: "'single'", total_sessions: "2", remaining_sessions: "2" },
      "reject",
    ],
    [
      "일회권 total_sessions = 1 (짝)",
      { ticket_type: "'single'", total_sessions: "1", remaining_sessions: "1" },
      "allow",
    ],
    ["ended인데 end_reason 없음", { status: "'ended'", remaining_sessions: "0" }, "reject"],
    [
      "ended·end_reason = used_up (짝)",
      { status: "'ended'", end_reason: "'used_up'", remaining_sessions: "0" },
      "allow",
    ],
    ["active인데 end_reason 있음", { status: "'active'", end_reason: "'expired'" }, "reject"],
    [
      "waiting_schedule인데 end_reason 있음",
      { status: "'waiting_schedule'", end_reason: "'refunded'" },
      "reject",
    ],
    ["다른 트레이너(T2)의 상품", { product_id: `'${P.T2}'` }, "reject"],
    ["다른 트레이너(T2)의 그룹 반", { group_class_id: `'${GC.T2}'` }, "reject"],
    ["자기 트레이너(T1)의 빈 그룹 반 (짝)", { group_class_id: `'${GC.T1_EMPTY}'` }, "allow"],
    ["이미 수강권이 있는 결제(payment_id 중복)", { payment_id: `'${PAY.D}'` }, "reject"],
  ];

  it.each(cases)("서버 × tickets insert: %s → %s", async (_, overrides, expected) => {
    expect(
      await attemptWrite(db, service, { sql: ticketInsertSql(overrides), setup: newPaymentForD }),
    ).toBe(expected);
  });

  it("서버 × payment_id 없는 파일럿 무료 수강권은 같은 수강 관계에 여러 개 넣을 수 있다 (PLT-03)", async () => {
    const pilot = (validUntil: string) =>
      ticketInsertSql({
        enrollment_id: `'${E.A_PILOT}'`,
        product_id: `'${P.TPL}'`,
        payment_id: "null",
        lesson_type: "'private'",
        total_sessions: "4",
        remaining_sessions: "4",
        price_paid: "0",
        fee_rate: "null",
        valid_until: `'${validUntil}'`,
      });
    // 준비 데이터에 이미 payment 없는 수강권(TK.A_PILOT)이 하나 있다. 둘 더 넣는다.
    const affected = await withActor(db, service, async (tx) => {
      const first = await tx.query(pilot("2027-12-01"));
      const second = await tx.query(pilot("2027-12-02"));
      return (first.affectedRows ?? 0) + (second.affectedRows ?? 0);
    });
    expect(affected).toBe(2);
  });
});

// ===========================================================================
// DB가 금액을 계산하지 않는다 — STL-02, STL-03, STL-06, PLT-03, CLAUDE.md 도메인 규칙
// ===========================================================================

describe("#28 DB가 금액을 계산하지 않는다 — STL-02, STL-03, STL-06, PLT-03", () => {
  type TicketMoney = {
    price_paid: number;
    fee_rate: string | null;
    total_sessions: number;
    remaining_sessions: number;
    valid_until: string;
  };
  const MONEY_SQL = `select price_paid, fee_rate::text as fee_rate, total_sessions, remaining_sessions,
                            valid_until::text as valid_until
                     from public.tickets where id = $1`;

  it("서버가 넣은 tickets의 price_paid·fee_rate·total_sessions·remaining_sessions·valid_until은 넣은 값 그대로다 (STL-02, STL-03)", async () => {
    // 상품(240,000원·8회), fee_policies(trainer_link 0.08), 결제일 + 1년과 모두 다른 값을 넣는다
    const id = "00000000-0000-4000-8028-0000000000dd";
    const rows = await withActor(
      db,
      service,
      async (tx) => {
        await tx.query(
          `insert into public.tickets
             (id, enrollment_id, product_id, payment_id, lesson_type, ticket_type, total_sessions,
              remaining_sessions, price_paid, fee_rate, valid_until, group_class_id, status, end_reason)
           values ($1, $2, $3, $4, 'group', 'regular', 7, 5, 123457, 0.0777, '2027-02-28', null,
                   'waiting_schedule', null)`,
          [id, E.D, P.T1_GROUP, PAY.NEW],
        );
        return (await tx.query<TicketMoney>(MONEY_SQL, [id])).rows;
      },
      { setup: newPaymentForD },
    );
    expect(rows.map((row) => ({ ...row, fee_rate: Number(row.fee_rate) }))).toEqual([
      {
        price_paid: 123457,
        fee_rate: 0.0777,
        total_sessions: 7,
        remaining_sessions: 5,
        valid_until: "2027-02-28",
      },
    ]);
  });

  it("fee_policies에 새 행을 넣어도 이미 있는 tickets.fee_rate는 바뀌지 않는다 (STL-03)", async () => {
    const rows = await withActor(db, service, async (tx) => {
      const inserted = await tx.query(
        `insert into public.fee_policies (source, rate, effective_from)
         values ('trainer_link', 0.2, '2026-01-02'), ('marketplace', 0.3, '2026-01-02')`,
      );
      expect(inserted.affectedRows).toBe(2);
      return (
        await tx.query<{ fee_rate: string }>(
          `select fee_rate::text as fee_rate from public.tickets where id = any($1::uuid[])`,
          [[TK.A1, TK.C1, TK.B]],
        )
      ).rows;
    });
    expect(rows.map((row) => Number(row.fee_rate))).toEqual([0.08, 0.08, 0.08]);
  });

  it("트레이너가 상품 가격·횟수를 고쳐도 이미 있는 tickets.price_paid·total_sessions와 payments.amount는 그대로다", async () => {
    const result = await withActor(db, asUser(U.T1), async (tx) => {
      const updated = await tx.query(
        `update public.lesson_products set price = 999000, session_count = 12 where id = $1`,
        [P.T1_PRIVATE],
      );
      await tx.exec("reset role");
      const tickets = await tx.query<{ price_paid: number; total_sessions: number }>(
        `select price_paid, total_sessions from public.tickets where id = $1`,
        [TK.A1],
      );
      const payments = await tx.query<{ amount: number }>(
        `select amount from public.payments where id = $1`,
        [PAY.A1],
      );
      return { updated: updated.affectedRows, tickets: tickets.rows, payments: payments.rows };
    });
    expect(result).toEqual({
      updated: 1,
      tickets: [{ price_paid: 200000, total_sessions: 4 }],
      payments: [{ amount: 200000 }],
    });
  });

  it("서버가 파일럿 무료 수강권(payment 없음, price_paid = 0, fee_rate 없음)을 넣을 수 있고 fee_rate는 비어 있다 (PLT-03, STL-06, 팀장 결정 4)", async () => {
    const id = "00000000-0000-4000-8028-0000000000de";
    const rows = await withActor(db, service, async (tx) => {
      await tx.query(
        `insert into public.tickets
           (id, enrollment_id, product_id, payment_id, lesson_type, ticket_type, total_sessions,
            remaining_sessions, price_paid, fee_rate, valid_until, group_class_id, status, end_reason)
         values ($1, $2, $3, null, 'private', 'regular', 6, 6, 0, null, '2027-11-20', null,
                 'waiting_schedule', null)`,
        [id, E.A_PILOT, P.TPL],
      );
      return (
        await tx.query<{ payment_id: string | null; price_paid: number; fee_rate: string | null }>(
          `select payment_id, price_paid, fee_rate::text as fee_rate from public.tickets where id = $1`,
          [id],
        )
      ).rows;
    });
    expect(rows).toEqual([{ payment_id: null, price_paid: 0, fee_rate: null }]);
  });
});

// ===========================================================================
// 준비 작업 확인
// ===========================================================================

describe("#28 준비 작업이 의도한 상태를 만든다 (tickets) — PAY-03", () => {
  it("새 결제 준비: PAY.NEW가 있고 아직 수강권이 없다", async () => {
    const rows = await withActor(
      db,
      service,
      async (tx) =>
        (
          await tx.query<{ tickets: number }>(
            `select (select count(*)::int from public.tickets where payment_id = p.id) as tickets
             from public.payments p where p.id = $1`,
            [PAY.NEW],
          )
        ).rows,
      { setup: newPaymentForD },
    );
    expect(rows).toEqual([{ tickets: 0 }]);
  });

  it("준비 데이터: 학생A 1:1 수강권은 active 4회 중 3회 남음, 200,000원, 0.08", async () => {
    const rows = await withActor(
      db,
      service,
      async (tx) =>
        (
          await tx.query<Record<string, unknown>>(
            `select status, total_sessions, remaining_sessions, price_paid, fee_rate::text as fee_rate
             from public.tickets where id = $1`,
            [TK.A1],
          )
        ).rows,
    );
    expect(rows.map((row) => ({ ...row, fee_rate: Number(row.fee_rate) }))).toEqual([
      {
        status: "active",
        total_sessions: 4,
        remaining_sessions: 3,
        price_paid: 200000,
        fee_rate: 0.08,
      },
    ]);
  });
});
