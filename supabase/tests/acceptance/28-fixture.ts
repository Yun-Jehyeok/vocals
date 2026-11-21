// 인수 테스트 #28 묶음 2(상품·결제·수강권)의 준비 데이터와 준비 작업. QA가 쓴다. 개발은 고치지 않는다.
//
// seed는 개발 담당이라 바뀔 수 있다. 그래서 판정에 쓰는 행은 seed와 겹치지 않는 id로 여기서 만든다.
// 서버(service_role)가 쓴 것처럼 넣는다(결제·수강 관계·수강권은 서버만 쓴다는 전제, 이슈 #28 범위).
// 테이블이 아직 없으면(개발 전) 준비 데이터 적용이 실패하고, 그 파일의 테스트가 모두 실패한다. 정상이다.
//
// 역할 (이슈 #28 완료 조건의 표기)
//   T1  = 트레이너T1 (approved). 정지·탈퇴·비노출 상태는 준비 작업(setup)으로 바꾼다.
//   T2  = 다른 트레이너 (approved)
//   SA  = 학생A: T1의 끝나지 않은 수강권이 있다(1:1 active, 그룹 active·반 배정, 그룹 waiting_schedule,
//         끝난 1:1). 파일럿 트레이너 TPL과도 수강 관계가 있다(파일럿 무료 수강권).
//   SC  = 학생C: T1과 수강 관계는 있지만 수강권이 모두 ended (환불된 1:1, 만료된 그룹·반 배정)
//   SB  = 학생B: T1과 수강 관계가 없다. T2의 학생이다.
//   SD  = T1의 학생. 반에 배정되지 않은 그룹 수강권(waiting_schedule)만 있다.
//   운영자 = seed의 활성 admin
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { createTestDb } from "../helpers/db.ts";
import { SEED } from "../helpers/seed-ids.ts";

const uuid = (suffix: string) => `00000000-0000-4000-8028-0000000000${suffix}`;

export const U = {
  T1: uuid("01"),
  T2: uuid("02"),
  /** pending 트레이너 */
  TP: uuid("03"),
  /** rejected 트레이너 */
  TR: uuid("04"),
  /** 파일럿 트레이너 (approved, is_pilot) */
  TPL: uuid("05"),
  SA: uuid("11"),
  SB: uuid("12"),
  SC: uuid("13"),
  SD: uuid("14"),
  ADMIN: SEED.admin,
} as const;

/** lesson_products */
export const P = {
  T1_PRIVATE: uuid("a1"), // T1 1:1 정기 4회 200,000원
  T1_GROUP: uuid("a2"), // T1 그룹 정기 8회 240,000원
  T1_INACTIVE: uuid("a3"), // T1 active = false
  T2: uuid("a4"),
  TP: uuid("a5"), // pending 트레이너의 active 상품
  TR: uuid("a6"), // rejected 트레이너의 active 상품
  TPL: uuid("a7"),
} as const;

/** enrollments */
export const E = {
  A: uuid("b1"), // SA–T1
  C: uuid("b2"), // SC–T1
  D: uuid("b3"), // SD–T1
  B: uuid("b4"), // SB–T2
  A_PILOT: uuid("b5"), // SA–TPL, pilot_free
} as const;

/** payments */
export const PAY = {
  A1: uuid("c1"),
  AG1: uuid("c2"),
  AG2: uuid("c3"),
  AE: uuid("c4"),
  C1: uuid("c5"),
  CG: uuid("c6"),
  D: uuid("c7"),
  B: uuid("c8"),
  /** 준비 작업 newPaymentForD가 만드는 결제 */
  NEW: uuid("cf"),
} as const;

/** tickets */
export const TK = {
  A1: uuid("d1"), // SA 1:1 active 4/3, 환불 요청(requested) 있음
  AG1: uuid("d2"), // SA 그룹 active, GC1 배정
  AG2: uuid("d3"), // SA 그룹 waiting_schedule (재결제), 미배정
  AE: uuid("d4"), // SA 1:1 ended(used_up)
  C1: uuid("d5"), // SC 1:1 ended(refunded), 환불 있음
  CG: uuid("d6"), // SC 그룹 ended(expired), GC1 배정
  D: uuid("d7"), // SD 그룹 waiting_schedule, 미배정
  B: uuid("d8"), // SB(T2) 1:1 active
  A_PILOT: uuid("d9"), // SA–TPL 파일럿 무료 (payment 없음, 0원, fee_rate null)
} as const;

/** group_classes */
export const GC = {
  /** T1, 정원 1. 끝나지 않은 배정: SA(TK.AG1). 끝난 배정: SC(TK.CG) */
  T1_FULL: uuid("e1"),
  /** T1, 정원 4, 배정 없음 */
  T1_EMPTY: uuid("e2"),
  T2: uuid("e3"),
} as const;

export const RR = {
  /** TK.A1의 requested 요청 */
  A: uuid("f1"),
  /** TK.C1의 processed 요청 */
  C: uuid("f2"),
} as const;

export const REF = {
  /** TK.C1의 환불 (RR.C 처리) */
  C: uuid("91"),
} as const;

const FIXTURE_SQL = `
insert into auth.users (id, email) values
  ('${U.T1}', 'b2.t1@example.test'),
  ('${U.T2}', 'b2.t2@example.test'),
  ('${U.TP}', 'b2.tp@example.test'),
  ('${U.TR}', 'b2.tr@example.test'),
  ('${U.TPL}', 'b2.tpl@example.test'),
  ('${U.SA}', 'b2.sa@example.test'),
  ('${U.SB}', 'b2.sb@example.test'),
  ('${U.SC}', 'b2.sc@example.test'),
  ('${U.SD}', 'b2.sd@example.test');

insert into public.users (id, role, nickname) values
  ('${U.T1}', 'trainer', '묶음2트레이너1'),
  ('${U.T2}', 'trainer', '묶음2트레이너2'),
  ('${U.TP}', 'trainer', '묶음2대기트레이너'),
  ('${U.TR}', 'trainer', '묶음2거절트레이너'),
  ('${U.TPL}', 'trainer', '묶음2파일럿트레이너'),
  ('${U.SA}', 'student', '묶음2학생A'),
  ('${U.SB}', 'student', '묶음2학생B'),
  ('${U.SC}', 'student', '묶음2학생C'),
  ('${U.SD}', 'student', '묶음2학생D');

insert into public.user_private_profiles (user_id, legal_name, birth_date, phone) values
  ('${U.T1}', '가짜묶음이일', '1990-02-01', '01002800001'),
  ('${U.T2}', '가짜묶음이이', '1990-02-02', '01002800002'),
  ('${U.TP}', '가짜묶음이삼', '1990-02-03', '01002800003'),
  ('${U.TR}', '가짜묶음이사', '1990-02-04', '01002800004'),
  ('${U.TPL}', '가짜묶음이오', '1990-02-05', '01002800005'),
  ('${U.SA}', '가짜학생에이', '2000-02-11', '01002800011'),
  ('${U.SB}', '가짜학생비', '2000-02-12', '01002800012'),
  ('${U.SC}', '가짜학생씨', '2000-02-13', '01002800013'),
  ('${U.SD}', '가짜학생디', '2000-02-14', '01002800014');

insert into public.user_account_records (user_id, identity_key) values
  ('${U.SA}', 'dummy-identity-key-b2-sa'),
  ('${U.T1}', 'dummy-identity-key-b2-t1');

insert into public.trainer_profiles (user_id, display_name, approval_status, is_pilot, listed) values
  ('${U.T1}', '묶음2 트레이너1', 'approved', false, true),
  ('${U.T2}', '묶음2 트레이너2', 'approved', false, true),
  ('${U.TP}', '묶음2 대기 트레이너', 'pending', false, true),
  ('${U.TR}', '묶음2 거절 트레이너', 'rejected', false, true),
  ('${U.TPL}', '묶음2 파일럿 트레이너', 'approved', true, true);

insert into public.trainer_genres (trainer_id, genre_id) values ('${U.T1}', 1);

insert into public.lesson_products
  (id, trainer_id, lesson_type, ticket_type, session_count, price, duration_min, active) values
  ('${P.T1_PRIVATE}', '${U.T1}', 'private', 'regular', 4, 200000, 50, true),
  ('${P.T1_GROUP}', '${U.T1}', 'group', 'regular', 8, 240000, 60, true),
  ('${P.T1_INACTIVE}', '${U.T1}', 'private', 'single', 1, 30000, 50, false),
  ('${P.T2}', '${U.T2}', 'private', 'regular', 4, 160000, 50, true),
  ('${P.TP}', '${U.TP}', 'private', 'regular', 4, 100000, 50, true),
  ('${P.TR}', '${U.TR}', 'private', 'regular', 4, 100000, 50, true),
  ('${P.TPL}', '${U.TPL}', 'private', 'regular', 4, 200000, 50, true);

insert into public.enrollments (id, student_id, trainer_id, source, pilot_free) values
  ('${E.A}', '${U.SA}', '${U.T1}', 'trainer_link', false),
  ('${E.C}', '${U.SC}', '${U.T1}', 'marketplace', false),
  ('${E.D}', '${U.SD}', '${U.T1}', 'trainer_link', false),
  ('${E.B}', '${U.SB}', '${U.T2}', 'trainer_link', false),
  ('${E.A_PILOT}', '${U.SA}', '${U.TPL}', 'trainer_link', true);

insert into public.payments
  (id, student_id, product_id, amount, method, pg_transaction_id, status, paid_at) values
  ('${PAY.A1}', '${U.SA}', '${P.T1_PRIVATE}', 200000, 'card', 'b2-pg-a1', 'paid', '2026-11-01 10:00:00+09'),
  ('${PAY.AG1}', '${U.SA}', '${P.T1_GROUP}', 240000, 'kakaopay', 'b2-pg-ag1', 'paid', '2026-11-01 10:05:00+09'),
  ('${PAY.AG2}', '${U.SA}', '${P.T1_GROUP}', 240000, 'naverpay', 'b2-pg-ag2', 'paid', '2026-11-15 10:00:00+09'),
  ('${PAY.AE}', '${U.SA}', '${P.T1_PRIVATE}', 200000, 'tosspay', 'b2-pg-ae', 'paid', '2025-10-01 10:00:00+09'),
  ('${PAY.C1}', '${U.SC}', '${P.T1_PRIVATE}', 200000, 'card', 'b2-pg-c1', 'partially_refunded', '2026-06-01 10:00:00+09'),
  ('${PAY.CG}', '${U.SC}', '${P.T1_GROUP}', 240000, 'card', 'b2-pg-cg', 'paid', '2025-09-01 10:00:00+09'),
  ('${PAY.D}', '${U.SD}', '${P.T1_GROUP}', 240000, 'card', 'b2-pg-d', 'paid', '2026-11-10 10:00:00+09'),
  ('${PAY.B}', '${U.SB}', '${P.T2}', 160000, 'card', 'b2-pg-b', 'paid', '2026-11-01 10:00:00+09');

insert into public.group_classes (id, trainer_id, name, capacity, duration_min) values
  ('${GC.T1_FULL}', '${U.T1}', 'T1 저녁반', 1, 60),
  ('${GC.T1_EMPTY}', '${U.T1}', 'T1 빈 반', 4, 60),
  ('${GC.T2}', '${U.T2}', 'T2 반', 4, 60);

insert into public.tickets
  (id, enrollment_id, product_id, payment_id, lesson_type, ticket_type, total_sessions,
   remaining_sessions, price_paid, fee_rate, valid_until, group_class_id, status, end_reason) values
  ('${TK.A1}', '${E.A}', '${P.T1_PRIVATE}', '${PAY.A1}', 'private', 'regular', 4, 3, 200000, 0.08, '2027-11-01', null, 'active', null),
  ('${TK.AG1}', '${E.A}', '${P.T1_GROUP}', '${PAY.AG1}', 'group', 'regular', 8, 8, 240000, 0.08, '2027-11-01', '${GC.T1_FULL}', 'active', null),
  ('${TK.AG2}', '${E.A}', '${P.T1_GROUP}', '${PAY.AG2}', 'group', 'regular', 8, 8, 240000, 0.08, '2027-11-15', null, 'waiting_schedule', null),
  ('${TK.AE}', '${E.A}', '${P.T1_PRIVATE}', '${PAY.AE}', 'private', 'regular', 4, 0, 200000, 0.08, '2026-10-01', null, 'ended', 'used_up'),
  ('${TK.C1}', '${E.C}', '${P.T1_PRIVATE}', '${PAY.C1}', 'private', 'regular', 4, 0, 200000, 0.08, '2027-06-01', null, 'ended', 'refunded'),
  ('${TK.CG}', '${E.C}', '${P.T1_GROUP}', '${PAY.CG}', 'group', 'regular', 8, 2, 240000, 0.08, '2026-09-01', '${GC.T1_FULL}', 'ended', 'expired'),
  ('${TK.D}', '${E.D}', '${P.T1_GROUP}', '${PAY.D}', 'group', 'regular', 8, 8, 240000, 0.08, '2027-11-10', null, 'waiting_schedule', null),
  ('${TK.B}', '${E.B}', '${P.T2}', '${PAY.B}', 'private', 'regular', 4, 4, 160000, 0.08, '2027-11-01', null, 'active', null),
  ('${TK.A_PILOT}', '${E.A_PILOT}', '${P.TPL}', null, 'private', 'regular', 4, 4, 0, null, '2027-11-01', null, 'waiting_schedule', null);

insert into public.refund_requests (id, ticket_id, reason, status) values
  ('${RR.A}', '${TK.A1}', '이사', 'requested'),
  ('${RR.C}', '${TK.C1}', null, 'processed');

insert into public.refunds
  (id, ticket_id, payment_id, refund_request_id, sessions_canceled, amount, processed_by, processed_at) values
  ('${REF.C}', '${TK.C1}', '${PAY.C1}', '${RR.C}', 2, 100000, '${U.T1}', '2026-11-10 12:00:00+09');
`;

/**
 * seed가 적용된 새 테스트 DB에 #28 준비 데이터를 서버(service_role)로 넣는다(커밋).
 * 실패하면(개발 전: 테이블 없음) 그 파일의 테스트가 모두 실패한다.
 */
export async function createBundle2Db(): Promise<PGlite> {
  const db = await createTestDb();
  try {
    await db.transaction(async (tx) => {
      await tx.exec("set local role service_role");
      await tx.exec(FIXTURE_SQL);
    });
  } catch (error) {
    await db.close();
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`#28 준비 데이터를 서버(service_role)로 넣지 못했다: ${message}`, {
      cause: error,
    });
  }
  return db;
}

// ---------------------------------------------------------------------------
// 준비 작업 (OpCase.setup / withActor setup). 관리자로 시작하므로 서버 역할로 바꿔 실행한다.
// ---------------------------------------------------------------------------

export type Setup = (tx: Transaction) => Promise<void>;

export async function asServer(tx: Transaction, fn: () => Promise<unknown>): Promise<void> {
  await tx.exec("set local role service_role");
  await fn();
  await tx.exec("reset role");
}

export const chain =
  (...setups: Setup[]): Setup =>
  async (tx) => {
    for (const setup of setups) await setup(tx);
  };

/** 운영자가 정지한 상태 (ADM-02) */
export const suspend =
  (trainerId: string): Setup =>
  (tx) =>
    asServer(tx, () =>
      tx.query(
        `update public.trainer_profiles set approval_status = 'suspended' where user_id = $1`,
        [trainerId],
      ),
    );

/** 서버가 탈퇴 처리한 상태 (AUTH-07) */
export const withdraw =
  (userId: string): Setup =>
  (tx) =>
    asServer(tx, () =>
      tx.query(`update public.users set status = 'withdrawn' where id = $1`, [userId]),
    );

/** 트레이너가 목록에서 빠진 상태 (MKT-07) */
export const unlist =
  (trainerId: string): Setup =>
  (tx) =>
    asServer(tx, () =>
      tx.query(`update public.trainer_profiles set listed = false where user_id = $1`, [trainerId]),
    );

export const setCapacity =
  (groupClassId: string, capacity: number): Setup =>
  (tx) =>
    asServer(tx, () =>
      tx.query(`update public.group_classes set capacity = $2 where id = $1`, [
        groupClassId,
        capacity,
      ]),
    );

/** 서버가 반에 배정한 상태 (준비용. 클라이언트 배정 판정과 별개) */
export const assign =
  (ticketId: string, groupClassId: string): Setup =>
  (tx) =>
    asServer(tx, () =>
      tx.query(`update public.tickets set group_class_id = $2 where id = $1`, [
        ticketId,
        groupClassId,
      ]),
    );

/** 서버가 그 수강 관계의 끝나지 않은 수강권을 모두 ended로 바꾼 상태 (AUTH-09: 횟수 소진) */
export const endAllTickets =
  (enrollmentId: string): Setup =>
  (tx) =>
    asServer(tx, () =>
      tx.query(
        `update public.tickets
         set status = 'ended', end_reason = 'used_up', remaining_sessions = 0
         where enrollment_id = $1 and status <> 'ended'`,
        [enrollmentId],
      ),
    );

/** 학생D의 새 결제 (PAY.NEW). 수강권 insert 판정용 */
export const newPaymentForD: Setup = (tx) =>
  asServer(tx, () =>
    tx.query(
      `insert into public.payments
         (id, student_id, product_id, amount, method, pg_transaction_id, status, paid_at)
       values ($1, $2, $3, 240000, 'card', 'b2-pg-new', 'paid', '2026-11-20 10:00:00+09')`,
      [PAY.NEW, U.SD, P.T1_GROUP],
    ),
  );

// ---------------------------------------------------------------------------
// 수강권 insert SQL (서버 무결성 판정용)
// ---------------------------------------------------------------------------

const TICKET_COLUMNS = [
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
] as const;
export type TicketColumn = (typeof TICKET_COLUMNS)[number];

/** 바른 수강권: 학생D–T1, 그룹 정기 8회, 새 결제(PAY.NEW, 준비 작업 newPaymentForD 필요) */
const VALID_TICKET: Record<TicketColumn, string> = {
  enrollment_id: `'${E.D}'`,
  product_id: `'${P.T1_GROUP}'`,
  payment_id: `'${PAY.NEW}'`,
  lesson_type: `'group'`,
  ticket_type: `'regular'`,
  total_sessions: "8",
  remaining_sessions: "8",
  price_paid: "240000",
  fee_rate: "0.08",
  valid_until: `'2027-11-20'`,
  group_class_id: "null",
  status: `'waiting_schedule'`,
  end_reason: "null",
};

/** 바른 수강권에서 일부 컬럼만 바꾼 insert 문 (값은 SQL 리터럴) */
export function ticketInsertSql(overrides: Partial<Record<TicketColumn, string>> = {}): string {
  const values = TICKET_COLUMNS.map((column) => overrides[column] ?? VALID_TICKET[column]);
  return `insert into public.tickets (${TICKET_COLUMNS.join(", ")}) values (${values.join(", ")})`;
}
