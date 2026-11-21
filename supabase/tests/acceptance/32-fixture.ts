// 인수 테스트 #32 묶음 3(일정·출결)의 준비 데이터와 준비 작업. QA가 쓴다. 개발은 고치지 않는다.
//
// seed는 개발 담당이라 바뀔 수 있다. 그래서 판정에 쓰는 행은 seed와 겹치지 않는 id로 여기서 만든다.
// 고정 일정·회차·출결은 서버(service_role)만 쓴다는 전제로 서버가 넣는다(이슈 #32 팀장 결정 1).
// 테이블이 아직 없으면(개발 전) 준비 데이터 적용이 실패하고, 그 파일의 테스트가 모두 실패한다. 정상이다.
//
// 역할 (이슈 #32 완료 조건의 표기)
//   T1  = 트레이너 (approved). 정지·탈퇴 상태는 준비 작업(setup)으로 바꾼다.
//   T2  = 다른 트레이너 (approved). 학생B의 트레이너
//   SA  = 학생A: T1의 1:1 정기권 active(TK.A), 재결제 1:1 정기권 waiting_schedule(TK.A_RE), 일회권(TK.AS)
//   SG, SH = 학생G·학생H: T1의 그룹 반 R1에 배정된 그룹 수강권(active)
//   SC  = 학생C: T1과의 수강권이 모두 ended(TK.C)이고 지난 회차 참여 기록이 있다
//   SB  = 학생B: T1과 수강 관계가 없다. T2의 학생이다
//   운영자 = seed의 활성 admin
// 회차 시각은 timestamptz, 기준 시간대 Asia/Seoul(+09) (이슈 #32 팀장 결정)
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { createTestDb } from "../helpers/db.ts";
import { SEED } from "../helpers/seed-ids.ts";

const uuid = (suffix: string) => `00000000-0000-4000-8032-0000000000${suffix}`;

export const U = {
  T1: uuid("01"),
  T2: uuid("02"),
  SA: uuid("11"),
  SB: uuid("12"),
  SC: uuid("13"),
  SG: uuid("14"),
  SH: uuid("15"),
  ADMIN: SEED.admin,
} as const;

const P = {
  T1_PRIVATE: uuid("a1"), // 1:1 정기 4회 200,000원
  T1_GROUP: uuid("a2"), // 그룹 정기 8회 240,000원
  T1_SINGLE: uuid("a3"), // 1:1 일회권 50,000원
  T2_PRIVATE: uuid("a4"),
} as const;

const E = {
  A: uuid("b1"),
  C: uuid("b2"),
  G: uuid("b3"),
  H: uuid("b4"),
  B: uuid("b5"),
} as const;

const PAY = {
  A: uuid("c1"),
  A_RE: uuid("c2"),
  AS: uuid("c3"),
  C: uuid("c4"),
  G: uuid("c5"),
  H: uuid("c6"),
  B: uuid("c7"),
} as const;

/** tickets */
export const TK = {
  /** 학생A 1:1 정기 active 4회 중 3회 남음 (LS.A1에서 1회 차감) */
  A: uuid("d1"),
  /** 학생A 1:1 정기 재결제 waiting_schedule (PAY-07) */
  A_RE: uuid("d2"),
  /** 학생A 1:1 일회권 active */
  AS: uuid("d3"),
  /** 학생C 1:1 정기 ended(expired) */
  C: uuid("d4"),
  /** 학생G 그룹 active, R1 배정 */
  G: uuid("d5"),
  /** 학생H 그룹 active, R1 배정 */
  H: uuid("d6"),
  /** 학생B–T2 1:1 정기 active */
  B: uuid("d7"),
} as const;

/** group_classes */
export const GC = {
  /** T1, 학생G·학생H 배정, 고정 일정 FS.R1과 회차 있음 */
  R1: uuid("e1"),
  /** T1, 배정 없음, 고정 일정 FS.R2와 회차 LS.R2 있음 */
  R2: uuid("e2"),
  /** T1, 배정·고정 일정·회차 없음 (준비 작업 scheduleR3로 고정 일정만 붙인다) */
  R3: uuid("e3"),
  /** T2의 반 */
  T2: uuid("e4"),
} as const;

/** fixed_schedules */
export const FS = {
  /** TK.A, 2026-11-10부터, 화·목 19:00 */
  A: uuid("f1"),
  /** TK.A, 2026-11-01 ~ 2026-11-10 (수정되어 닫힘), 월 19:00 */
  A_OLD: uuid("f2"),
  /** R1, 토 10:00 */
  R1: uuid("f3"),
  /** R2, 일 11:00 */
  R2: uuid("f4"),
  /** TK.C (학생C, 끝난 수강권), 수 18:00 */
  C: uuid("f5"),
  /** TK.B (T2), 금 20:00 */
  B: uuid("f6"),
  /** 준비 작업 scheduleR3가 만드는 R3의 고정 일정 */
  R3: uuid("f7"),
} as const;

/** lesson_sessions */
export const LS = {
  /** 지난 1:1 회차(FS.A_OLD). 학생A present, 차감됨 */
  A1: uuid("51"),
  /** 다가오는 1:1 회차(FS.A). 학생A none, 차감 없음 — 시간 변경 허용 대상 */
  A2: uuid("52"),
  /** 다가오는 1:1 회차(FS.A). 참여 행 없음 */
  A3: uuid("53"),
  /** 취소된 1:1 회차(FS.A). 학생A pre_canceled(trainer), 차감 없음 */
  A_CANCELED: uuid("54"),
  /** R1 그룹 회차. 학생G·학생H none */
  R1A: uuid("55"),
  /** R1 그룹 회차. 참여 행 없음 */
  R1B: uuid("56"),
  /** 일회권 회차. 학생A(TK.AS) none */
  AS: uuid("57"),
  /** 일회권 회차. 참여 행 없음 */
  AS2: uuid("58"),
  /** 보강 회차. 참여 행 없음 */
  MK: uuid("59"),
  /** 학생C의 지난 회차(FS.C). present, 차감됨 */
  C1: uuid("5a"),
  /** T2 회차(FS.B). 학생B none */
  B1: uuid("5b"),
  /** R2 그룹 회차. 참여 행 없음 */
  R2: uuid("5c"),
} as const;

/** session_attendees */
export const SA = {
  A1: uuid("61"),
  A2: uuid("62"),
  A_CANCELED: uuid("64"),
  R1A_G: uuid("65"),
  R1A_H: uuid("66"),
  AS: uuid("67"),
  C1: uuid("6a"),
  B1: uuid("6b"),
} as const;

/** TK.A의 회차 금액: floor(200000 / 4) (STL-02, 마지막 차감 아님) */
export const AMOUNT_A = 50000;

const FIXTURE_SQL = `
insert into auth.users (id, email) values
  ('${U.T1}', 'b3.t1@example.test'),
  ('${U.T2}', 'b3.t2@example.test'),
  ('${U.SA}', 'b3.sa@example.test'),
  ('${U.SB}', 'b3.sb@example.test'),
  ('${U.SC}', 'b3.sc@example.test'),
  ('${U.SG}', 'b3.sg@example.test'),
  ('${U.SH}', 'b3.sh@example.test');

insert into public.users (id, role, nickname) values
  ('${U.T1}', 'trainer', '묶음3트레이너1'),
  ('${U.T2}', 'trainer', '묶음3트레이너2'),
  ('${U.SA}', 'student', '묶음3학생A'),
  ('${U.SB}', 'student', '묶음3학생B'),
  ('${U.SC}', 'student', '묶음3학생C'),
  ('${U.SG}', 'student', '묶음3학생G'),
  ('${U.SH}', 'student', '묶음3학생H');

insert into public.user_private_profiles (user_id, legal_name, birth_date, phone) values
  ('${U.T1}', '가짜묶음삼일', '1990-03-01', '01003200001'),
  ('${U.T2}', '가짜묶음삼이', '1990-03-02', '01003200002'),
  ('${U.SA}', '가짜삼학생에이', '2000-03-11', '01003200011'),
  ('${U.SB}', '가짜삼학생비', '2000-03-12', '01003200012'),
  ('${U.SC}', '가짜삼학생씨', '2000-03-13', '01003200013'),
  ('${U.SG}', '가짜삼학생지', '2000-03-14', '01003200014'),
  ('${U.SH}', '가짜삼학생에이치', '2000-03-15', '01003200015');

insert into public.trainer_profiles (user_id, display_name, approval_status, is_pilot, listed) values
  ('${U.T1}', '묶음3 트레이너1', 'approved', false, true),
  ('${U.T2}', '묶음3 트레이너2', 'approved', false, true);

insert into public.lesson_products
  (id, trainer_id, lesson_type, ticket_type, session_count, price, duration_min, active) values
  ('${P.T1_PRIVATE}', '${U.T1}', 'private', 'regular', 4, 200000, 50, true),
  ('${P.T1_GROUP}', '${U.T1}', 'group', 'regular', 8, 240000, 60, true),
  ('${P.T1_SINGLE}', '${U.T1}', 'private', 'single', 1, 50000, 50, true),
  ('${P.T2_PRIVATE}', '${U.T2}', 'private', 'regular', 4, 160000, 50, true);

insert into public.enrollments (id, student_id, trainer_id, source, pilot_free) values
  ('${E.A}', '${U.SA}', '${U.T1}', 'trainer_link', false),
  ('${E.C}', '${U.SC}', '${U.T1}', 'trainer_link', false),
  ('${E.G}', '${U.SG}', '${U.T1}', 'trainer_link', false),
  ('${E.H}', '${U.SH}', '${U.T1}', 'marketplace', false),
  ('${E.B}', '${U.SB}', '${U.T2}', 'trainer_link', false);

insert into public.payments
  (id, student_id, product_id, amount, method, pg_transaction_id, status, paid_at) values
  ('${PAY.A}', '${U.SA}', '${P.T1_PRIVATE}', 200000, 'card', 'b3-pg-a', 'paid', '2026-11-01 10:00:00+09'),
  ('${PAY.A_RE}', '${U.SA}', '${P.T1_PRIVATE}', 200000, 'card', 'b3-pg-a-re', 'paid', '2026-11-20 10:00:00+09'),
  ('${PAY.AS}', '${U.SA}', '${P.T1_SINGLE}', 50000, 'card', 'b3-pg-as', 'paid', '2026-11-20 11:00:00+09'),
  ('${PAY.C}', '${U.SC}', '${P.T1_PRIVATE}', 200000, 'card', 'b3-pg-c', 'paid', '2025-06-01 10:00:00+09'),
  ('${PAY.G}', '${U.SG}', '${P.T1_GROUP}', 240000, 'card', 'b3-pg-g', 'paid', '2026-11-01 10:00:00+09'),
  ('${PAY.H}', '${U.SH}', '${P.T1_GROUP}', 240000, 'card', 'b3-pg-h', 'paid', '2026-11-01 10:00:00+09'),
  ('${PAY.B}', '${U.SB}', '${P.T2_PRIVATE}', 160000, 'card', 'b3-pg-b', 'paid', '2026-11-01 10:00:00+09');

insert into public.group_classes (id, trainer_id, name, capacity, duration_min) values
  ('${GC.R1}', '${U.T1}', '묶음3 R1 토요반', 4, 60),
  ('${GC.R2}', '${U.T1}', '묶음3 R2 일요반', 4, 60),
  ('${GC.R3}', '${U.T1}', '묶음3 R3 빈 반', 4, 60),
  ('${GC.T2}', '${U.T2}', '묶음3 T2 반', 4, 60);

insert into public.tickets
  (id, enrollment_id, product_id, payment_id, lesson_type, ticket_type, total_sessions,
   remaining_sessions, price_paid, fee_rate, valid_until, group_class_id, status, end_reason) values
  ('${TK.A}', '${E.A}', '${P.T1_PRIVATE}', '${PAY.A}', 'private', 'regular', 4, 3, 200000, 0.08, '2027-11-01', null, 'active', null),
  ('${TK.A_RE}', '${E.A}', '${P.T1_PRIVATE}', '${PAY.A_RE}', 'private', 'regular', 4, 4, 200000, 0.08, '2027-11-20', null, 'waiting_schedule', null),
  ('${TK.AS}', '${E.A}', '${P.T1_SINGLE}', '${PAY.AS}', 'private', 'single', 1, 1, 50000, 0.08, '2027-11-20', null, 'active', null),
  ('${TK.C}', '${E.C}', '${P.T1_PRIVATE}', '${PAY.C}', 'private', 'regular', 4, 3, 200000, 0.08, '2026-06-01', null, 'ended', 'expired'),
  ('${TK.G}', '${E.G}', '${P.T1_GROUP}', '${PAY.G}', 'group', 'regular', 8, 8, 240000, 0.08, '2027-11-01', '${GC.R1}', 'active', null),
  ('${TK.H}', '${E.H}', '${P.T1_GROUP}', '${PAY.H}', 'group', 'regular', 8, 8, 240000, 0.08, '2027-11-01', '${GC.R1}', 'active', null),
  ('${TK.B}', '${E.B}', '${P.T2_PRIVATE}', '${PAY.B}', 'private', 'regular', 4, 4, 160000, 0.08, '2027-11-01', null, 'active', null);

insert into public.fixed_schedules (id, ticket_id, group_class_id, effective_from, effective_to) values
  ('${FS.A_OLD}', '${TK.A}', null, '2026-11-01', '2026-11-10'),
  ('${FS.A}', '${TK.A}', null, '2026-11-10', null),
  ('${FS.R1}', null, '${GC.R1}', '2026-11-01', null),
  ('${FS.R2}', null, '${GC.R2}', '2026-11-01', null),
  ('${FS.C}', '${TK.C}', null, '2025-06-01', null),
  ('${FS.B}', '${TK.B}', null, '2026-11-01', null);

insert into public.fixed_schedule_slots (fixed_schedule_id, weekday, start_time) values
  ('${FS.A_OLD}', 1, '19:00'),
  ('${FS.A}', 2, '19:00'),
  ('${FS.A}', 4, '19:00'),
  ('${FS.R1}', 6, '10:00'),
  ('${FS.R2}', 0, '11:00'),
  ('${FS.C}', 3, '18:00'),
  ('${FS.B}', 5, '20:00');

insert into public.lesson_sessions
  (id, trainer_id, group_class_id, fixed_schedule_id, kind, mode, starts_at, ends_at, status) values
  ('${LS.A1}', '${U.T1}', null, '${FS.A_OLD}', 'regular', 'offline', '2026-11-02 19:00:00+09', '2026-11-02 19:50:00+09', 'scheduled'),
  ('${LS.A2}', '${U.T1}', null, '${FS.A}', 'regular', 'offline', '2026-12-01 19:00:00+09', '2026-12-01 19:50:00+09', 'scheduled'),
  ('${LS.A3}', '${U.T1}', null, '${FS.A}', 'regular', 'offline', '2026-12-03 19:00:00+09', '2026-12-03 19:50:00+09', 'scheduled'),
  ('${LS.A_CANCELED}', '${U.T1}', null, '${FS.A}', 'regular', 'offline', '2026-11-12 19:00:00+09', '2026-11-12 19:50:00+09', 'canceled'),
  ('${LS.R1A}', '${U.T1}', '${GC.R1}', '${FS.R1}', 'regular', 'offline', '2026-12-05 10:00:00+09', '2026-12-05 11:00:00+09', 'scheduled'),
  ('${LS.R1B}', '${U.T1}', '${GC.R1}', '${FS.R1}', 'regular', 'offline', '2026-12-12 10:00:00+09', '2026-12-12 11:00:00+09', 'scheduled'),
  ('${LS.AS}', '${U.T1}', null, null, 'single', 'offline', '2026-12-07 15:00:00+09', '2026-12-07 15:50:00+09', 'scheduled'),
  ('${LS.AS2}', '${U.T1}', null, null, 'single', 'offline', '2026-12-08 15:00:00+09', '2026-12-08 15:50:00+09', 'scheduled'),
  ('${LS.MK}', '${U.T1}', null, null, 'makeup', 'offline', '2026-12-09 15:00:00+09', '2026-12-09 15:50:00+09', 'scheduled'),
  ('${LS.C1}', '${U.T1}', null, '${FS.C}', 'regular', 'offline', '2025-06-04 18:00:00+09', '2025-06-04 18:50:00+09', 'scheduled'),
  ('${LS.B1}', '${U.T2}', null, '${FS.B}', 'regular', 'offline', '2026-12-04 20:00:00+09', '2026-12-04 20:50:00+09', 'scheduled'),
  ('${LS.R2}', '${U.T1}', '${GC.R2}', '${FS.R2}', 'regular', 'offline', '2026-12-06 11:00:00+09', '2026-12-06 12:00:00+09', 'scheduled');

insert into public.session_attendees
  (id, session_id, ticket_id, student_id, attendance, canceled_by, deducted, session_amount, checked_at) values
  ('${SA.A1}', '${LS.A1}', '${TK.A}', '${U.SA}', 'present', null, true, ${AMOUNT_A}, '2026-11-02 20:00:00+09'),
  ('${SA.A2}', '${LS.A2}', '${TK.A}', '${U.SA}', 'none', null, false, null, null),
  ('${SA.A_CANCELED}', '${LS.A_CANCELED}', '${TK.A}', '${U.SA}', 'pre_canceled', 'trainer', false, null, '2026-11-10 09:00:00+09'),
  ('${SA.R1A_G}', '${LS.R1A}', '${TK.G}', '${U.SG}', 'none', null, false, null, null),
  ('${SA.R1A_H}', '${LS.R1A}', '${TK.H}', '${U.SH}', 'none', null, false, null, null),
  ('${SA.AS}', '${LS.AS}', '${TK.AS}', '${U.SA}', 'none', null, false, null, null),
  ('${SA.C1}', '${LS.C1}', '${TK.C}', '${U.SC}', 'present', null, true, ${AMOUNT_A}, '2025-06-04 19:00:00+09'),
  ('${SA.B1}', '${LS.B1}', '${TK.B}', '${U.SB}', 'none', null, false, null, null);
`;

/**
 * seed가 적용된 새 테스트 DB에 #32 준비 데이터를 서버(service_role)로 넣는다(커밋).
 * 실패하면(개발 전: 테이블 없음) 그 파일의 테스트가 모두 실패한다.
 */
export async function createBundle3Db(): Promise<PGlite> {
  const db = await createTestDb();
  try {
    await db.transaction(async (tx) => {
      await tx.exec("set local role service_role");
      await tx.exec(FIXTURE_SQL);
    });
  } catch (error) {
    await db.close();
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`#32 준비 데이터를 서버(service_role)로 넣지 못했다: ${message}`, {
      cause: error,
    });
  }
  return db;
}

// ---------------------------------------------------------------------------
// 준비 작업 (OpCase.setup / withActor setup). 관리자로 시작하므로 서버 역할로 바꿔 실행한다.
// ---------------------------------------------------------------------------

export type Setup = (tx: Transaction) => Promise<void>;

async function asServer(tx: Transaction, fn: () => Promise<unknown>): Promise<void> {
  await tx.exec("set local role service_role");
  await fn();
  await tx.exec("reset role");
}

/** 운영자가 정지한 상태 (ADM-02) */
export const suspendT1: Setup = (tx) =>
  asServer(tx, () =>
    tx.query(
      `update public.trainer_profiles set approval_status = 'suspended' where user_id = $1`,
      [U.T1],
    ),
  );

/** 서버가 탈퇴 처리한 상태 (AUTH-07) */
export const withdrawT1: Setup = (tx) =>
  asServer(tx, () =>
    tx.query(`update public.users set status = 'withdrawn' where id = $1`, [U.T1]),
  );

/** R3에 고정 일정만 붙인 상태 (배정·회차 없음) */
export const scheduleR3: Setup = (tx) =>
  asServer(tx, () =>
    tx.query(
      `insert into public.fixed_schedules (id, ticket_id, group_class_id, effective_from, effective_to)
       values ($1, null, $2, '2026-12-01', null)`,
      [FS.R3, GC.R3],
    ),
  );

// ---------------------------------------------------------------------------
// 서버 insert SQL (무결성 판정용). 값은 SQL 리터럴
// ---------------------------------------------------------------------------

const SESSION_COLUMNS = [
  "trainer_id",
  "group_class_id",
  "fixed_schedule_id",
  "kind",
  "starts_at",
  "ends_at",
] as const;
export type SessionColumn = (typeof SESSION_COLUMNS)[number] | "mode" | "status";

/** 바른 회차: T1의 1:1 정기 회차(FS.A), mode·status는 기본값 */
const VALID_SESSION: Record<(typeof SESSION_COLUMNS)[number], string> = {
  trainer_id: `'${U.T1}'`,
  group_class_id: "null",
  fixed_schedule_id: `'${FS.A}'`,
  kind: `'regular'`,
  starts_at: `'2026-12-08 19:00:00+09'`,
  ends_at: `'2026-12-08 19:50:00+09'`,
};

/** 바른 회차에서 일부 컬럼만 바꾼(또는 mode·status를 더한) insert 문 */
export function sessionInsertSql(overrides: Partial<Record<SessionColumn, string>> = {}): string {
  const columns: string[] = [...SESSION_COLUMNS];
  const values: string[] = SESSION_COLUMNS.map(
    (column) => overrides[column] ?? VALID_SESSION[column],
  );
  for (const extra of ["mode", "status"] as const) {
    if (overrides[extra] !== undefined) {
      columns.push(extra);
      values.push(overrides[extra]);
    }
  }
  return `insert into public.lesson_sessions (${columns.join(", ")}) values (${values.join(", ")})`;
}

const ATTENDEE_COLUMNS = [
  "session_id",
  "ticket_id",
  "student_id",
  "attendance",
  "canceled_by",
  "deducted",
  "session_amount",
  "checked_at",
] as const;
export type AttendeeColumn = (typeof ATTENDEE_COLUMNS)[number];

/** 바른 참여 행: 참여 행이 없는 1:1 회차 LS.A3에 학생A(TK.A), 미체크 */
const VALID_ATTENDEE: Record<AttendeeColumn, string> = {
  session_id: `'${LS.A3}'`,
  ticket_id: `'${TK.A}'`,
  student_id: `'${U.SA}'`,
  attendance: `'none'`,
  canceled_by: "null",
  deducted: "false",
  session_amount: "null",
  checked_at: "null",
};

/** 바른 참여 행에서 일부 컬럼만 바꾼 insert 문 */
export function attendeeInsertSql(overrides: Partial<Record<AttendeeColumn, string>> = {}): string {
  const values = ATTENDEE_COLUMNS.map((column) => overrides[column] ?? VALID_ATTENDEE[column]);
  return `insert into public.session_attendees (${ATTENDEE_COLUMNS.join(", ")}) values (${values.join(", ")})`;
}
