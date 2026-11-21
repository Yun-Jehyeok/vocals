// 인수 테스트: 이슈 #32 묶음 3 — 일정·출결 무결성, "DB가 금액·차감·상태를 계산하지 않는다", 회차·반 삭제
// (QA가 개발 전에 쓴다. 개발은 고치지 않는다. 틀렸다고 보면 `[질문] 받는 역할: QA`)
//
// 준비 데이터와 역할은 32-fixture.ts. 무결성 제약은 서버(service_role) insert에도 걸린다(팀장 결정 3).
// 값 검사는 attemptWrite(제약·트리거 거부도 거부)로 판정하고, 거부마다 허용되는 짝(바른 값)을 둔다.
// DB는 회차 금액(sessionAmount)·차감(isDeducted)·수강권 상태 변화를 다시 구현하지 않는다(#10 공통, CLAUDE.md 도메인 규칙).
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, service, withActor } from "../helpers/db.ts";
import { attemptWrite } from "../helpers/rls-matrix.ts";
import type { OpCase } from "../helpers/rls-matrix.ts";
import type { AttendeeColumn, SessionColumn, Setup } from "./32-fixture.ts";
import {
  AMOUNT_A,
  FS,
  GC,
  LS,
  SA,
  TK,
  U,
  attendeeInsertSql,
  createBundle3Db,
  scheduleR3,
  sessionInsertSql,
} from "./32-fixture.ts";

let db: PGlite;

beforeAll(async () => {
  db = await createBundle3Db();
});

afterAll(async () => {
  await db?.close();
});

const sql = (text: string, setup?: Setup): OpCase => ({ sql: text, ...(setup ? { setup } : {}) });
const lit = (id: string) => `'${id}'`;

// ===========================================================================
// fixed_schedules · fixed_schedule_slots
// ===========================================================================

const scheduleInsert = (
  ticketId: string | null,
  groupClassId: string | null,
  from = "'2026-12-01'",
  to = "null",
) =>
  sql(`insert into public.fixed_schedules (ticket_id, group_class_id, effective_from, effective_to)
       values (${ticketId ? lit(ticketId) : "null"}, ${groupClassId ? lit(groupClassId) : "null"}, ${from}, ${to})`);

describe("#32 고정 일정 무결성 — SCH-01, SCH-02, SCH-04, TRN-04 (팀장 결정 3)", () => {
  it.each<[string, OpCase, "allow" | "reject"]>([
    ["1:1 정기권(재결제 수강권)만 가리킴", scheduleInsert(TK.A_RE, null), "allow"],
    ["그룹 반 R3만 가리킴", scheduleInsert(null, GC.R3), "allow"],
    ["수강권과 반을 둘 다 가리킴", scheduleInsert(TK.A_RE, GC.R3), "reject"],
    ["둘 다 비어 있음", scheduleInsert(null, null), "reject"],
    ["그룹 수강권(학생G)을 가리킴", scheduleInsert(TK.G, null), "reject"],
    ["일회권(학생A)을 가리킴", scheduleInsert(TK.AS, null), "reject"],
    [
      "effective_to = effective_from",
      scheduleInsert(TK.A_RE, null, "'2026-12-01'", "'2026-12-01'"),
      "allow",
    ],
    [
      "effective_to가 effective_from 뒤",
      scheduleInsert(TK.A_RE, null, "'2026-12-01'", "'2026-12-31'"),
      "allow",
    ],
    [
      "effective_to가 effective_from 앞",
      scheduleInsert(TK.A_RE, null, "'2026-12-01'", "'2026-11-30'"),
      "reject",
    ],
  ])("SCH-01·SCH-04: 서버 × fixed_schedules insert: %s → %s", async (_, opCase, expected) => {
    expect(await attemptWrite(db, service, opCase)).toBe(expected);
  });

  const slotInsert = (weekday: number, startTime: string) =>
    sql(`insert into public.fixed_schedule_slots (fixed_schedule_id, weekday, start_time)
         values (${lit(FS.A)}, ${weekday}, '${startTime}')`);

  it.each<[string, OpCase, "allow" | "reject"]>([
    ["weekday 0(일요일) 09:00", slotInsert(0, "09:00"), "allow"],
    ["weekday 6(토요일) 09:00", slotInsert(6, "09:00"), "allow"],
    ["weekday -1", slotInsert(-1, "09:00"), "reject"],
    ["weekday 7", slotInsert(7, "09:00"), "reject"],
    ["이미 있는 요일·시각(화 19:00)", slotInsert(2, "19:00"), "reject"],
    ["이미 있는 요일, 다른 시각(화 21:00)", slotInsert(2, "21:00"), "allow"],
  ])("SCH-01: 서버 × fixed_schedule_slots insert: %s → %s", async (_, opCase, expected) => {
    expect(await attemptWrite(db, service, opCase)).toBe(expected);
  });
});

// ===========================================================================
// lesson_sessions
// ===========================================================================

const sessionInsert = (overrides: Partial<Record<SessionColumn, string>> = {}) =>
  sql(sessionInsertSql(overrides));

describe("#32 회차 무결성 — SCH-01, SCH-02, SCH-08, erd 9장 (팀장 결정 3)", () => {
  it("SCH-01: 서버가 mode·status 없이 넣은 회차는 status = scheduled, mode = offline이다", async () => {
    const rows = await withActor(
      db,
      service,
      async (tx) =>
        (
          await tx.query<{ status: string; mode: string }>(
            `${sessionInsertSql()} returning status::text as status, mode::text as mode`,
          )
        ).rows,
    );
    expect(rows).toEqual([{ status: "scheduled", mode: "offline" }]);
  });

  it.each<[string, OpCase, "allow" | "reject"]>([
    ["바른 1:1 정기 회차(FS.A)", sessionInsert(), "allow"],
    ["mode = offline 명시", sessionInsert({ mode: "'offline'" }), "allow"],
    ["mode = online (2단계)", sessionInsert({ mode: "'online'" }), "reject"],
    ["ends_at = starts_at", sessionInsert({ ends_at: "'2026-12-08 19:00:00+09'" }), "reject"],
    ["ends_at < starts_at", sessionInsert({ ends_at: "'2026-12-08 18:00:00+09'" }), "reject"],
    ["regular인데 fixed_schedule_id 없음", sessionInsert({ fixed_schedule_id: "null" }), "reject"],
    [
      "single, 고정 일정·반 없음",
      sessionInsert({ kind: "'single'", fixed_schedule_id: "null" }),
      "allow",
    ],
    ["single인데 fixed_schedule_id 있음", sessionInsert({ kind: "'single'" }), "reject"],
    [
      "single인데 group_class_id 있음",
      sessionInsert({ kind: "'single'", fixed_schedule_id: "null", group_class_id: lit(GC.R1) }),
      "reject",
    ],
    [
      "makeup, 고정 일정·반 없음",
      sessionInsert({ kind: "'makeup'", fixed_schedule_id: "null" }),
      "allow",
    ],
    ["makeup인데 fixed_schedule_id 있음", sessionInsert({ kind: "'makeup'" }), "reject"],
    [
      "makeup인데 group_class_id 있음 (그룹 학생 보강도 개별 회차, SCH-08)",
      sessionInsert({ kind: "'makeup'", fixed_schedule_id: "null", group_class_id: lit(GC.R1) }),
      "reject",
    ],
    [
      "R1 고정 일정, group_class_id = R1",
      sessionInsert({ fixed_schedule_id: lit(FS.R1), group_class_id: lit(GC.R1) }),
      "allow",
    ],
    [
      "R1 고정 일정, group_class_id 없음",
      sessionInsert({ fixed_schedule_id: lit(FS.R1) }),
      "reject",
    ],
    [
      "R1 고정 일정, group_class_id = 다른 반 R2",
      sessionInsert({ fixed_schedule_id: lit(FS.R1), group_class_id: lit(GC.R2) }),
      "reject",
    ],
    [
      "1:1 고정 일정(FS.A)인데 group_class_id = R1",
      sessionInsert({ group_class_id: lit(GC.R1) }),
      "reject",
    ],
    [
      "trainer_id = T2인데 T1 수강권의 고정 일정(FS.A)",
      sessionInsert({ trainer_id: lit(U.T2) }),
      "reject",
    ],
    [
      "trainer_id = T2인데 T1 반의 고정 일정(FS.R1)",
      sessionInsert({
        trainer_id: lit(U.T2),
        fixed_schedule_id: lit(FS.R1),
        group_class_id: lit(GC.R1),
      }),
      "reject",
    ],
    [
      "trainer_id = T2, T2 수강권의 고정 일정(FS.B)",
      sessionInsert({ trainer_id: lit(U.T2), fixed_schedule_id: lit(FS.B) }),
      "allow",
    ],
  ])(
    "SCH-01·SCH-02·SCH-08: 서버 × lesson_sessions insert: %s → %s",
    async (_, opCase, expected) => {
      expect(await attemptWrite(db, service, opCase)).toBe(expected);
    },
  );
});

// ===========================================================================
// session_attendees
// ===========================================================================

const attendeeInsert = (overrides: Partial<Record<AttendeeColumn, string>> = {}) =>
  sql(attendeeInsertSql(overrides));

describe("#32 참여 행 무결성 — ATT-03, PAY-07, PAY-08, SCH-02, SCH-05, SCH-06, SCH-08, STL-02 (팀장 결정 3)", () => {
  it.each<[string, OpCase, "allow" | "reject"]>([
    ["바른 행: 1:1 회차 A3에 학생A(TK.A)", attendeeInsert(), "allow"],
    // (회차, 학생)마다 하나 — ATT-03, PAY-07
    [
      "같은 회차 A2에 학생A 한 번 더(같은 수강권)",
      attendeeInsert({ session_id: lit(LS.A2) }),
      "reject",
    ],
    [
      "같은 회차 A2에 학생A 한 번 더(재결제 수강권, PAY-07)",
      attendeeInsert({ session_id: lit(LS.A2), ticket_id: lit(TK.A_RE) }),
      "reject",
    ],
    ["회차 A3에 학생A 재결제 수강권 (짝)", attendeeInsert({ ticket_id: lit(TK.A_RE) }), "allow"],
    // 학생·트레이너 일치
    [
      "student_id가 수강권의 학생이 아님(TK.A에 학생B)",
      attendeeInsert({ student_id: lit(U.SB) }),
      "reject",
    ],
    [
      "다른 트레이너(T2)의 수강권으로 T1 회차에",
      attendeeInsert({ ticket_id: lit(TK.B), student_id: lit(U.SB) }),
      "reject",
    ],
    // 회차 종류별 수강권 유형 — PAY-08, SCH-02
    [
      "그룹 회차 R1B에 그룹 수강권(학생G)",
      attendeeInsert({ session_id: lit(LS.R1B), ticket_id: lit(TK.G), student_id: lit(U.SG) }),
      "allow",
    ],
    ["그룹 회차 R1B에 1:1 수강권(학생A)", attendeeInsert({ session_id: lit(LS.R1B) }), "reject"],
    [
      "1:1 정기 회차 A3에 그룹 수강권(학생G)",
      attendeeInsert({ ticket_id: lit(TK.G), student_id: lit(U.SG) }),
      "reject",
    ],
    ["1:1 정기 회차 A3에 일회권(학생A)", attendeeInsert({ ticket_id: lit(TK.AS) }), "reject"],
    [
      "일회권 회차 AS2에 일회권(학생A)",
      attendeeInsert({ session_id: lit(LS.AS2), ticket_id: lit(TK.AS) }),
      "allow",
    ],
    ["일회권 회차 AS2에 1:1 정기권(학생A)", attendeeInsert({ session_id: lit(LS.AS2) }), "reject"],
    [
      "보강 회차 MK에 그룹 수강권(학생G, SCH-08)",
      attendeeInsert({ session_id: lit(LS.MK), ticket_id: lit(TK.G), student_id: lit(U.SG) }),
      "allow",
    ],
    // canceled_by ⇔ pre_canceled — SCH-05, SCH-06
    [
      "pre_canceled, canceled_by = student",
      attendeeInsert({ attendance: "'pre_canceled'", canceled_by: "'student'" }),
      "allow",
    ],
    [
      "pre_canceled, canceled_by = trainer",
      attendeeInsert({ attendance: "'pre_canceled'", canceled_by: "'trainer'" }),
      "allow",
    ],
    [
      "pre_canceled인데 canceled_by 없음",
      attendeeInsert({ attendance: "'pre_canceled'" }),
      "reject",
    ],
    [
      "present인데 canceled_by = student",
      attendeeInsert({ attendance: "'present'", canceled_by: "'student'" }),
      "reject",
    ],
    ["none인데 canceled_by = trainer", attendeeInsert({ canceled_by: "'trainer'" }), "reject"],
    // session_amount 범위 — STL-02
    [
      "차감됨, session_amount = 0 (파일럿 무료 수강권)",
      attendeeInsert({ attendance: "'present'", deducted: "true", session_amount: "0" }),
      "allow",
    ],
    [
      "차감됨, session_amount = -1",
      attendeeInsert({ attendance: "'present'", deducted: "true", session_amount: "-1" }),
      "reject",
    ],
    ["차감 안 됨, session_amount = 50000", attendeeInsert({ session_amount: "50000" }), "reject"],
    ["차감 안 됨, session_amount = 0", attendeeInsert({ session_amount: "0" }), "reject"],
  ])(
    "ATT-03·PAY-08·STL-02: 서버 × session_attendees insert: %s → %s",
    async (_, opCase, expected) => {
      expect(await attemptWrite(db, service, opCase)).toBe(expected);
    },
  );
});

// ===========================================================================
// DB가 금액·차감·상태를 계산하지 않는다
// ===========================================================================

describe("#32 DB가 금액·차감·수강권 상태를 계산하지 않는다 — STL-02, ATT-02, PAY-05, SCH-01", () => {
  type Attendee = {
    attendance: string;
    deducted: boolean;
    session_amount: number | null;
    checked_at: string | null;
  };
  const insertAndRead = (overrides: Partial<Record<AttendeeColumn, string>>) =>
    withActor(db, service, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `${attendeeInsertSql(overrides)} returning id`,
      );
      return (
        await tx.query<Attendee>(
          `select attendance::text as attendance, deducted, session_amount,
                  to_char(checked_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') as checked_at
           from public.session_attendees where id = $1`,
          [rows[0]?.id],
        )
      ).rows;
    });

  it("STL-02: 서버가 넣은 session_amount(sessionAmount 결과와 다른 12345)를 그대로 저장한다", async () => {
    expect(
      await insertAndRead({
        attendance: "'present'",
        deducted: "true",
        session_amount: "12345",
        checked_at: "'2026-12-03 20:00:00+09'",
      }),
    ).toEqual([
      {
        attendance: "present",
        deducted: true,
        session_amount: 12345,
        checked_at: "2026-12-03 20:00",
      },
    ]);
  });

  it("ATT-02: attendance = present, deducted = false, session_amount 없음도 막거나 고치지 않는다 (대응은 isDeducted 기준)", async () => {
    expect(await insertAndRead({ attendance: "'present'" })).toEqual([
      { attendance: "present", deducted: false, session_amount: null, checked_at: null },
    ]);
  });

  it("ATT-02: attendance = none, deducted = true도 막거나 고치지 않는다", async () => {
    expect(await insertAndRead({ deducted: "true", session_amount: String(AMOUNT_A) })).toEqual([
      { attendance: "none", deducted: true, session_amount: AMOUNT_A, checked_at: null },
    ]);
  });

  it("ATT-02: 차감된 행이어도 checked_at을 DB가 채우지 않는다", async () => {
    expect(
      await insertAndRead({ attendance: "'absent'", deducted: "true", session_amount: "50000" }),
    ).toEqual([{ attendance: "absent", deducted: true, session_amount: 50000, checked_at: null }]);
  });

  it("STL-02: 서버가 출결을 고쳐도 session_amount·deducted는 넣은 값 그대로다", async () => {
    const rows = await withActor(db, service, async (tx) => {
      await tx.query(
        `update public.session_attendees
         set attendance = 'makeup', deducted = true, session_amount = 777, checked_at = '2026-12-01 21:00:00+09'
         where id = $1`,
        [SA.A2],
      );
      return (
        await tx.query<Attendee>(
          `select attendance::text as attendance, deducted, session_amount,
                  to_char(checked_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') as checked_at
           from public.session_attendees where id = $1`,
          [SA.A2],
        )
      ).rows;
    });
    expect(rows).toEqual([
      { attendance: "makeup", deducted: true, session_amount: 777, checked_at: "2026-12-01 21:00" },
    ]);
  });

  it("ATT-02·PAY-05: 출결 행을 넣거나 고쳐도 수강권의 remaining_sessions·status·end_reason은 그대로다", async () => {
    const rows = await withActor(db, service, async (tx) => {
      // 차감 행 추가(A3), 기존 행 차감으로 변경(A2), 학생C 행 사전 취소로 변경(끝난 수강권)
      await tx.query(
        attendeeInsertSql({ attendance: "'present'", deducted: "true", session_amount: "50000" }),
      );
      await tx.query(
        `update public.session_attendees set attendance = 'absent', deducted = true, session_amount = 50000
         where id = $1`,
        [SA.A2],
      );
      await tx.query(
        `update public.session_attendees set attendance = 'pre_canceled', canceled_by = 'trainer',
           deducted = false, session_amount = null where id = $1`,
        [SA.C1],
      );
      return (
        await tx.query(
          `select id, remaining_sessions, status::text as status, end_reason::text as end_reason
           from public.tickets where id = any($1::uuid[]) order by id`,
          [[TK.A, TK.C]],
        )
      ).rows;
    });
    expect(rows).toEqual([
      { id: TK.A, remaining_sessions: 3, status: "active", end_reason: null },
      { id: TK.C, remaining_sessions: 3, status: "ended", end_reason: "expired" },
    ]);
  });

  it("SCH-01·PAY-05: 고정 일정·요일을 넣어도 회차가 생기지 않고 수강권은 waiting_schedule 그대로다", async () => {
    const result = await withActor(db, service, async (tx) => {
      const before = (
        await tx.query<{ n: number }>(`select count(*)::int as n from public.lesson_sessions`)
      ).rows[0]?.n;
      const { rows } = await tx.query<{ id: string }>(
        `insert into public.fixed_schedules (ticket_id, group_class_id, effective_from, effective_to)
         values ($1, null, '2026-12-01', null) returning id`,
        [TK.A_RE],
      );
      await tx.query(
        `insert into public.fixed_schedule_slots (fixed_schedule_id, weekday, start_time)
         values ($1, 1, '19:00'), ($1, 3, '19:00')`,
        [rows[0]?.id],
      );
      const after = (
        await tx.query<{ n: number }>(`select count(*)::int as n from public.lesson_sessions`)
      ).rows[0]?.n;
      const ticket = (
        await tx.query(`select status::text as status from public.tickets where id = $1`, [TK.A_RE])
      ).rows;
      return { added: (after ?? 0) - (before ?? 0), ticket };
    });
    expect(result).toEqual({ added: 0, ticket: [{ status: "waiting_schedule" }] });
  });
});

// ===========================================================================
// 회차 삭제 (서버), 반 삭제 (트레이너)
// ===========================================================================

describe("#32 회차 삭제 — SCH-04, STL-02 (팀장 결정 4)", () => {
  it("SCH-04: 서버 × 차감된 참여 행이 없는 회차(A2) 삭제 → 허용, 참여 행도 함께 지워진다", async () => {
    const remaining = await withActor(db, service, async (tx) => {
      const { affectedRows } = await tx.query(`delete from public.lesson_sessions where id = $1`, [
        LS.A2,
      ]);
      const left = (
        await tx.query(`select 1 from public.session_attendees where session_id = $1`, [LS.A2])
      ).rows.length;
      return { affectedRows, left };
    });
    expect(remaining).toEqual({ affectedRows: 1, left: 0 });
  });

  it("SCH-04: 서버 × 사전 취소 참여 행만 있는 회차 삭제 → 허용", async () => {
    expect(
      await attemptWrite(
        db,
        service,
        sql(`delete from public.lesson_sessions where id = ${lit(LS.A_CANCELED)}`),
      ),
    ).toBe("allow");
  });

  it("STL-02: 서버 × 차감된 참여 행이 있는 회차(A1) 삭제 → 거부", async () => {
    expect(
      await attemptWrite(
        db,
        service,
        sql(`delete from public.lesson_sessions where id = ${lit(LS.A1)}`),
      ),
    ).toBe("reject");
  });
});

describe("#32 고정 일정이나 회차가 있는 반은 트레이너가 지울 수 없다 — TRN-04, 결정 로그 2026-11-21", () => {
  const t1 = asUser(U.T1);
  const deleteClass = (id: string, setup?: Setup) =>
    sql(`delete from public.group_classes where id = ${lit(id)}`, setup);

  it("TRN-04: T1 × 배정·고정 일정·회차 없는 반(R3) 삭제 → 허용 (짝)", async () => {
    expect(await attemptWrite(db, t1, deleteClass(GC.R3))).toBe("allow");
  });

  it("TRN-04: T1 × 배정 없이 고정 일정만 있는 반(R3 + 고정 일정) 삭제 → 거부", async () => {
    expect(await attemptWrite(db, t1, deleteClass(GC.R3, scheduleR3))).toBe("reject");
  });

  it("TRN-04: T1 × 배정 없이 고정 일정과 회차가 있는 반(R2) 삭제 → 거부", async () => {
    expect(await attemptWrite(db, t1, deleteClass(GC.R2))).toBe("reject");
  });

  it("준비 데이터: R2·R3에는 배정된 수강권이 없고, R2에만 고정 일정·회차가 있다", async () => {
    const rows = await withActor(
      db,
      service,
      async (tx) =>
        (
          await tx.query(
            `select g.id,
                  (select count(*)::int from public.tickets t where t.group_class_id = g.id) as tickets,
                  (select count(*)::int from public.fixed_schedules f where f.group_class_id = g.id) as schedules,
                  (select count(*)::int from public.lesson_sessions s where s.group_class_id = g.id) as sessions
           from public.group_classes g where g.id = any($1::uuid[]) order by g.id`,
            [[GC.R2, GC.R3]],
          )
        ).rows,
    );
    expect(rows).toEqual([
      { id: GC.R2, tickets: 0, schedules: 1, sessions: 1 },
      { id: GC.R3, tickets: 0, schedules: 0, sessions: 0 },
    ]);
  });

  it("준비 작업 scheduleR3: R3에 고정 일정이 하나 생긴다", async () => {
    const rows = await withActor(
      db,
      service,
      async (tx) =>
        (await tx.query(`select id from public.fixed_schedules where group_class_id = $1`, [GC.R3]))
          .rows,
      { setup: scheduleR3 },
    );
    expect(rows).toEqual([{ id: FS.R3 }]);
  });
});
