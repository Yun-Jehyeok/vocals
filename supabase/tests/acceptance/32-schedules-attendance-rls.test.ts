// 인수 테스트: 이슈 #32 묶음 3 — fixed_schedules, fixed_schedule_slots, lesson_sessions, session_attendees 권한
// (QA가 개발 전에 쓴다. 개발은 고치지 않는다. 틀렸다고 보면 `[질문] 받는 역할: QA`)
//
// 준비 데이터와 역할은 32-fixture.ts. 고정 일정·회차·출결은 서버(service_role)만 쓴다(팀장 결정 1).
// 클라이언트가 직접 쓰는 것은 트레이너의 회차 시간 변경(starts_at·ends_at)뿐이다(팀장 결정 1·6).
// 학생은 자기 참여 행이 있는 회차와 자기 참여 행만 읽는다(팀장 결정 2).
// 권한은 RLS 매트릭스(attempt)로, 컬럼 단위 쓰기는 attemptWrite(허용 짝과 함께)로 판정한다.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "../helpers/db.ts";
import { anon, asUser, service, withActor } from "../helpers/db.ts";
import { attemptWrite, describeRlsMatrix } from "../helpers/rls-matrix.ts";
import type { OpCase } from "../helpers/rls-matrix.ts";
import type { Setup } from "./32-fixture.ts";
import { FS, GC, LS, SA, TK, U, createBundle3Db, suspendT1, withdrawT1 } from "./32-fixture.ts";

let db: PGlite;

beforeAll(async () => {
  db = await createBundle3Db();
});

afterAll(async () => {
  await db?.close();
});

const getDb = () => db;
const opt = (setup?: Setup) => (setup ? { setup } : {});

const ACTORS = {
  anon,
  학생A: asUser(U.SA),
  학생G: asUser(U.SG),
  학생H: asUser(U.SH),
  학생C: asUser(U.SC),
  학생B: asUser(U.SB),
  T1: asUser(U.T1),
  T2: asUser(U.T2),
  운영자: asUser(U.ADMIN),
};

// ===========================================================================
// fixed_schedules · fixed_schedule_slots
// ===========================================================================

const selectSchedule = (id: string): OpCase => ({
  sql: `select 1 from public.fixed_schedules where id = $1`,
  params: [id],
});
const selectSlots = (scheduleId: string): OpCase => ({
  sql: `select 1 from public.fixed_schedule_slots where fixed_schedule_id = $1`,
  params: [scheduleId],
});

describeRlsMatrix(
  {
    title: "#32 fixed_schedules 권한 — SCH-01, SCH-03, SCH-04, SCH-09, ADM-07",
    actors: ACTORS,
    cases: {
      "fixed_schedules:학생A 1:1": {
        select: selectSchedule(FS.A),
        // 바른 값(서버라면 허용되는 행): 학생A 재결제 수강권의 새 고정 일정
        insert: {
          sql: `insert into public.fixed_schedules (ticket_id, group_class_id, effective_from, effective_to)
                values ($1, null, '2026-12-01', null)`,
          params: [TK.A_RE],
        },
        update: {
          sql: `update public.fixed_schedules set effective_to = '2026-12-31' where id = $1`,
          params: [FS.A],
        },
        delete: { sql: `delete from public.fixed_schedules where id = $1`, params: [FS.A] },
      },
      "fixed_schedules:학생A 1:1 닫힌 일정": { select: selectSchedule(FS.A_OLD) },
      "fixed_schedules:R1": {
        select: selectSchedule(FS.R1),
        update: {
          sql: `update public.fixed_schedules set effective_to = '2026-12-31' where id = $1`,
          params: [FS.R1],
        },
        delete: { sql: `delete from public.fixed_schedules where id = $1`, params: [FS.R1] },
      },
      "fixed_schedules:학생C 끝난 수강권": { select: selectSchedule(FS.C) },
    },
    rows: [
      // 역할    테이블                                  select   insert   update   delete
      ["T1", "fixed_schedules:학생A 1:1", "allow", "deny", "deny", "deny"],
      ["T1", "fixed_schedules:R1", "allow", "-", "deny", "deny"],
      ["T1", "fixed_schedules:학생C 끝난 수강권", "allow", "-", "-", "-"],
      ["운영자", "fixed_schedules:학생A 1:1", "allow", "deny", "deny", "deny"],
      ["운영자", "fixed_schedules:R1", "allow", "-", "deny", "deny"],
      ["운영자", "fixed_schedules:학생C 끝난 수강권", "allow", "-", "-", "-"],
      ["학생A", "fixed_schedules:학생A 1:1", "allow", "deny", "deny", "deny"],
      ["학생A", "fixed_schedules:학생A 1:1 닫힌 일정", "allow", "-", "-", "-"],
      ["학생A", "fixed_schedules:R1", "deny", "-", "deny", "deny"],
      ["학생G", "fixed_schedules:R1", "allow", "-", "deny", "deny"],
      ["학생G", "fixed_schedules:학생A 1:1", "deny", "-", "-", "-"],
      ["학생C", "fixed_schedules:학생C 끝난 수강권", "allow", "-", "-", "-"],
      ["학생B", "fixed_schedules:학생A 1:1", "deny", "deny", "deny", "deny"],
      ["학생B", "fixed_schedules:R1", "deny", "-", "-", "-"],
      ["T2", "fixed_schedules:학생A 1:1", "deny", "deny", "deny", "deny"],
      ["T2", "fixed_schedules:R1", "deny", "-", "-", "-"],
      ["anon", "fixed_schedules:학생A 1:1", "deny", "deny", "deny", "deny"],
      ["anon", "fixed_schedules:R1", "deny", "-", "-", "-"],
    ],
  },
  { db: getDb },
);

describeRlsMatrix(
  {
    title: "#32 fixed_schedule_slots 권한 — SCH-01, SCH-03, SCH-04, SCH-09, ADM-07",
    actors: ACTORS,
    cases: {
      "fixed_schedule_slots:학생A 1:1": {
        select: selectSlots(FS.A),
        // 바른 값: 같은 고정 일정에 없는 요일·시각(금 20:00)
        insert: {
          sql: `insert into public.fixed_schedule_slots (fixed_schedule_id, weekday, start_time)
                values ($1, 5, '20:00')`,
          params: [FS.A],
        },
        update: {
          sql: `update public.fixed_schedule_slots set start_time = '20:00'
                where fixed_schedule_id = $1 and weekday = 2`,
          params: [FS.A],
        },
        delete: {
          sql: `delete from public.fixed_schedule_slots where fixed_schedule_id = $1 and weekday = 4`,
          params: [FS.A],
        },
      },
      "fixed_schedule_slots:R1": {
        select: selectSlots(FS.R1),
        insert: {
          sql: `insert into public.fixed_schedule_slots (fixed_schedule_id, weekday, start_time)
                values ($1, 3, '19:00')`,
          params: [FS.R1],
        },
        update: {
          sql: `update public.fixed_schedule_slots set start_time = '11:00' where fixed_schedule_id = $1`,
          params: [FS.R1],
        },
        delete: {
          sql: `delete from public.fixed_schedule_slots where fixed_schedule_id = $1`,
          params: [FS.R1],
        },
      },
      "fixed_schedule_slots:학생C 끝난 수강권": { select: selectSlots(FS.C) },
    },
    rows: [
      // 역할    테이블                                     select   insert   update   delete
      ["T1", "fixed_schedule_slots:학생A 1:1", "allow", "deny", "deny", "deny"],
      ["T1", "fixed_schedule_slots:R1", "allow", "deny", "deny", "deny"],
      ["운영자", "fixed_schedule_slots:학생A 1:1", "allow", "deny", "deny", "deny"],
      ["운영자", "fixed_schedule_slots:R1", "allow", "-", "-", "-"],
      ["학생A", "fixed_schedule_slots:학생A 1:1", "allow", "deny", "deny", "deny"],
      ["학생A", "fixed_schedule_slots:R1", "deny", "-", "-", "-"],
      ["학생G", "fixed_schedule_slots:R1", "allow", "deny", "deny", "deny"],
      ["학생G", "fixed_schedule_slots:학생A 1:1", "deny", "-", "-", "-"],
      ["학생C", "fixed_schedule_slots:학생C 끝난 수강권", "allow", "-", "-", "-"],
      ["학생B", "fixed_schedule_slots:학생A 1:1", "deny", "deny", "deny", "deny"],
      ["학생B", "fixed_schedule_slots:R1", "deny", "-", "-", "-"],
      ["T2", "fixed_schedule_slots:학생A 1:1", "deny", "deny", "deny", "deny"],
      ["T2", "fixed_schedule_slots:R1", "deny", "-", "-", "-"],
      ["anon", "fixed_schedule_slots:학생A 1:1", "deny", "deny", "deny", "deny"],
      ["anon", "fixed_schedule_slots:R1", "deny", "-", "-", "-"],
    ],
  },
  { db: getDb },
);

describe("#32 고정 일정 읽기·쓰기 — SCH-01, SCH-03, SCH-04, SCH-09, ATT-05, ADM-07", () => {
  // 매트릭스 title은 요구사항 추적이 세지 않으므로 대표 칸을 이름에 ID를 넣어 한 번 더 둔다.
  const sees = async (actor: Actor, sql: string, params: unknown[]) =>
    withActor(db, actor, async (tx) => (await tx.query(sql, params)).rows.length > 0);

  it("SCH-01·SCH-09: T1·학생A는 학생A의 1:1 고정 일정과 요일을 읽는다", async () => {
    for (const actor of [ACTORS.T1, ACTORS.학생A]) {
      expect(await sees(actor, `select 1 from public.fixed_schedules where id = $1`, [FS.A])).toBe(
        true,
      );
      expect(
        await sees(
          actor,
          `select 1 from public.fixed_schedule_slots where fixed_schedule_id = $1`,
          [FS.A],
        ),
      ).toBe(true);
    }
  });

  it("SCH-09: 학생G는 R1의 고정 일정을 읽고, 학생A는 읽지 못한다", async () => {
    const sql = `select 1 from public.fixed_schedules where id = $1`;
    expect(await sees(ACTORS.학생G, sql, [FS.R1])).toBe(true);
    expect(await sees(ACTORS.학생A, sql, [FS.R1])).toBe(false);
  });

  it("ATT-05: 학생C는 끝난 수강권의 고정 일정을 계속 읽는다", async () => {
    expect(
      await sees(ACTORS.학생C, `select 1 from public.fixed_schedules where id = $1`, [FS.C]),
    ).toBe(true);
  });

  it("ADM-07: 운영자는 고정 일정을 전부 읽는다(T2의 고정 일정 포함)", async () => {
    const { rows } = await withActor(db, ACTORS.운영자, (tx) =>
      tx.query<{ id: string }>(`select id from public.fixed_schedules where id = any($1::uuid[])`, [
        [FS.A, FS.A_OLD, FS.R1, FS.R2, FS.C, FS.B],
      ]),
    );
    expect(rows).toHaveLength(6);
  });

  it("SCH-01: 학생B·T2·anon은 T1의 고정 일정을 읽지 못한다", async () => {
    for (const actor of [ACTORS.학생B, ACTORS.T2, ACTORS.anon]) {
      const visible = await withActor(db, actor, async (tx) => {
        try {
          return (
            await tx.query(`select 1 from public.fixed_schedules where id = any($1::uuid[])`, [
              [FS.A, FS.R1],
            ])
          ).rows.length;
        } catch {
          return 0;
        }
      });
      expect(visible).toBe(0);
    }
  });

  it.each<[string, Actor]>([
    ["T1", ACTORS.T1],
    ["학생A", ACTORS.학생A],
    ["운영자", ACTORS.운영자],
  ])(
    "SCH-03·SCH-04: %s × 고정 일정·요일 만들기·고치기·지우기 → 모두 거부 (서버만 쓴다)",
    async (_, actor) => {
      const writes: OpCase[] = [
        {
          sql: `insert into public.fixed_schedules (ticket_id, group_class_id, effective_from, effective_to)
                values ($1, null, '2026-12-01', null)`,
          params: [TK.A_RE],
        },
        {
          sql: `update public.fixed_schedules set effective_to = '2026-12-31' where id = $1`,
          params: [FS.A],
        },
        {
          sql: `insert into public.fixed_schedule_slots (fixed_schedule_id, weekday, start_time)
                values ($1, 5, '20:00')`,
          params: [FS.A],
        },
        {
          sql: `update public.fixed_schedule_slots set start_time = '20:00' where fixed_schedule_id = $1`,
          params: [FS.A],
        },
        {
          sql: `delete from public.fixed_schedule_slots where fixed_schedule_id = $1`,
          params: [FS.A],
        },
      ];
      for (const opCase of writes) {
        expect(await attemptWrite(db, actor, opCase), opCase.sql).toBe("reject");
      }
    },
  );

  it("SCH-01: 서버 × 같은 쓰기(재결제 수강권 고정 일정, 요일 추가·변경) → 허용 (위 거부의 짝)", async () => {
    const writes: OpCase[] = [
      {
        sql: `insert into public.fixed_schedules (ticket_id, group_class_id, effective_from, effective_to)
              values ($1, null, '2026-12-01', null)`,
        params: [TK.A_RE],
      },
      {
        sql: `update public.fixed_schedules set effective_to = '2026-12-31' where id = $1`,
        params: [FS.A],
      },
      {
        sql: `insert into public.fixed_schedule_slots (fixed_schedule_id, weekday, start_time)
              values ($1, 5, '20:00')`,
        params: [FS.A],
      },
      {
        sql: `update public.fixed_schedule_slots set start_time = '20:00'
              where fixed_schedule_id = $1 and weekday = 2`,
        params: [FS.A],
      },
    ];
    for (const opCase of writes) {
      expect(await attemptWrite(db, service, opCase), opCase.sql).toBe("allow");
    }
  });
});

// ===========================================================================
// lesson_sessions
// ===========================================================================

const selectSession = (id: string): OpCase => ({
  sql: `select 1 from public.lesson_sessions where id = $1`,
  params: [id],
});
const moveSession = (id: string, setup?: Setup): OpCase => ({
  sql: `update public.lesson_sessions
        set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour'
        where id = $1`,
  params: [id],
  ...opt(setup),
});
const deleteSession = (id: string): OpCase => ({
  sql: `delete from public.lesson_sessions where id = $1`,
  params: [id],
});
const insertSingleSession = (trainerId: string): OpCase => ({
  sql: `insert into public.lesson_sessions (trainer_id, group_class_id, fixed_schedule_id, kind, starts_at, ends_at)
        values ($1, null, null, 'single', '2026-12-10 15:00:00+09', '2026-12-10 15:50:00+09')`,
  params: [trainerId],
});

describeRlsMatrix(
  {
    title: "#32 lesson_sessions 권한 — SCH-01, SCH-02, SCH-03, SCH-08, SCH-09, ADM-07",
    actors: { ...ACTORS, "정지 T1": asUser(U.T1), "탈퇴 T1": asUser(U.T1) },
    cases: {
      // 다가오는 scheduled, 차감 없음 (학생A none)
      "lesson_sessions:A2": {
        select: selectSession(LS.A2),
        insert: insertSingleSession(U.T1),
        update: moveSession(LS.A2),
        delete: deleteSession(LS.A2),
      },
      "lesson_sessions:A2 정지": { update: moveSession(LS.A2, suspendT1) },
      "lesson_sessions:A2 탈퇴": { update: moveSession(LS.A2, withdrawT1) },
      // 지난 회차, 학생A present 차감됨
      "lesson_sessions:A1 차감됨": { select: selectSession(LS.A1), update: moveSession(LS.A1) },
      // 취소된 회차, 차감 없음
      "lesson_sessions:취소됨": {
        select: selectSession(LS.A_CANCELED),
        update: moveSession(LS.A_CANCELED),
      },
      "lesson_sessions:R1 그룹": {
        select: selectSession(LS.R1A),
        update: moveSession(LS.R1A),
        delete: deleteSession(LS.R1A),
      },
      "lesson_sessions:R1 참여 행 없음": { select: selectSession(LS.R1B) },
      "lesson_sessions:학생C 지난 회차": { select: selectSession(LS.C1) },
      "lesson_sessions:일회권": { select: selectSession(LS.AS) },
    },
    rows: [
      // 역할      테이블                               select   insert   update   delete
      ["T1", "lesson_sessions:A2", "allow", "deny", "allow", "deny"],
      ["T1", "lesson_sessions:A1 차감됨", "allow", "-", "deny", "-"],
      ["T1", "lesson_sessions:취소됨", "allow", "-", "deny", "-"],
      ["T1", "lesson_sessions:R1 그룹", "allow", "-", "allow", "deny"],
      ["T1", "lesson_sessions:R1 참여 행 없음", "allow", "-", "-", "-"],
      ["T1", "lesson_sessions:학생C 지난 회차", "allow", "-", "-", "-"],
      ["정지 T1", "lesson_sessions:A2 정지", "-", "-", "allow", "-"],
      ["탈퇴 T1", "lesson_sessions:A2 탈퇴", "-", "-", "deny", "-"],
      ["운영자", "lesson_sessions:A2", "allow", "deny", "deny", "deny"],
      ["운영자", "lesson_sessions:R1 참여 행 없음", "allow", "-", "-", "-"],
      ["운영자", "lesson_sessions:취소됨", "allow", "-", "-", "-"],
      ["학생A", "lesson_sessions:A2", "allow", "deny", "deny", "deny"],
      ["학생A", "lesson_sessions:A1 차감됨", "allow", "-", "-", "-"],
      ["학생A", "lesson_sessions:취소됨", "allow", "-", "deny", "-"],
      ["학생A", "lesson_sessions:일회권", "allow", "-", "-", "-"],
      ["학생A", "lesson_sessions:R1 그룹", "deny", "-", "-", "-"],
      ["학생G", "lesson_sessions:R1 그룹", "allow", "-", "deny", "deny"],
      ["학생G", "lesson_sessions:R1 참여 행 없음", "deny", "-", "-", "-"],
      ["학생G", "lesson_sessions:A2", "deny", "-", "-", "-"],
      ["학생H", "lesson_sessions:R1 그룹", "allow", "-", "-", "-"],
      ["학생C", "lesson_sessions:학생C 지난 회차", "allow", "-", "-", "-"],
      ["학생C", "lesson_sessions:A2", "deny", "-", "-", "-"],
      ["학생B", "lesson_sessions:A2", "deny", "deny", "deny", "deny"],
      ["T2", "lesson_sessions:A2", "deny", "-", "deny", "deny"],
      ["T2", "lesson_sessions:R1 그룹", "deny", "-", "deny", "-"],
      ["anon", "lesson_sessions:A2", "deny", "deny", "deny", "deny"],
    ],
  },
  { db: getDb },
);

describe("#32 회차 읽기 — SCH-09, S-10, S-11, ATT-05, ADM-07 (팀장 결정 2)", () => {
  const visibleIds = async (actor: Actor, ids: string[]) =>
    withActor(db, actor, async (tx) => {
      try {
        return (
          await tx.query<{ id: string }>(
            `select id from public.lesson_sessions where id = any($1::uuid[]) order by id`,
            [ids],
          )
        ).rows.map((row) => row.id);
      } catch {
        return [];
      }
    });
  const T1_SESSIONS = [
    LS.A1,
    LS.A2,
    LS.A3,
    LS.A_CANCELED,
    LS.R1A,
    LS.R1B,
    LS.AS,
    LS.AS2,
    LS.MK,
    LS.C1,
    LS.R2,
  ];

  it("SCH-09: T1은 자기 회차 전부(취소된 회차, 참여 행 없는 회차 포함)를 읽는다", async () => {
    expect(await visibleIds(ACTORS.T1, T1_SESSIONS)).toEqual([...T1_SESSIONS].sort());
  });

  it("ADM-07: 운영자는 회차를 전부 읽는다(T2 회차 포함)", async () => {
    const all = [...T1_SESSIONS, LS.B1];
    expect(await visibleIds(ACTORS.운영자, all)).toEqual([...all].sort());
  });

  it("SCH-09·ATT-05: 학생A는 자기 참여 행이 있는 회차(지난·취소·일회권)만 읽는다", async () => {
    expect(await visibleIds(ACTORS.학생A, T1_SESSIONS)).toEqual(
      [LS.A1, LS.A2, LS.A_CANCELED, LS.AS].sort(),
    );
  });

  it("SCH-09: 학생G는 자기 참여 행이 있는 R1 회차만 읽고, 참여 행이 없는 R1 회차는 읽지 못한다", async () => {
    expect(await visibleIds(ACTORS.학생G, T1_SESSIONS)).toEqual([LS.R1A]);
  });

  it("ATT-05: 학생C는 끝난 수강권의 지난 회차를 읽는다", async () => {
    expect(await visibleIds(ACTORS.학생C, T1_SESSIONS)).toEqual([LS.C1]);
  });

  it("SCH-09: 학생B·T2·anon은 T1의 회차를 읽지 못한다", async () => {
    for (const actor of [ACTORS.학생B, ACTORS.T2, ACTORS.anon]) {
      expect(await visibleIds(actor, T1_SESSIONS)).toEqual([]);
    }
  });
});

describe("#32 회차 만들기·지우기·시간 변경 — SCH-01, SCH-02, SCH-03, SCH-04, SCH-06, SCH-08, ATT-06, AUTH-07, ADM-02 (팀장 결정 1·6)", () => {
  it("SCH-02·SCH-08: T1·운영자 × 일회권·보강 회차 만들기 → 거부, 서버 → 허용", async () => {
    const makeup: OpCase = {
      sql: `insert into public.lesson_sessions (trainer_id, group_class_id, fixed_schedule_id, kind, starts_at, ends_at)
            values ($1, null, null, 'makeup', '2026-12-11 15:00:00+09', '2026-12-11 15:50:00+09')`,
      params: [U.T1],
    };
    for (const actor of [ACTORS.T1, ACTORS.운영자]) {
      expect(await attemptWrite(db, actor, insertSingleSession(U.T1))).toBe("reject");
      expect(await attemptWrite(db, actor, makeup)).toBe("reject");
    }
    expect(await attemptWrite(db, service, insertSingleSession(U.T1))).toBe("allow");
    expect(await attemptWrite(db, service, makeup)).toBe("allow");
  });

  it("SCH-04: T1 × 회차 지우기 → 거부", async () => {
    expect(await attemptWrite(db, ACTORS.T1, deleteSession(LS.A3))).toBe("reject");
  });

  it("SCH-03: T1 × scheduled·차감 없는 회차의 시간 변경 → 허용, 값이 바뀐다", async () => {
    const rows = await withActor(db, ACTORS.T1, async (tx) => {
      await tx.query(moveSession(LS.A2).sql, [LS.A2]);
      return (
        await tx.query<{ starts: string; ends: string }>(
          `select to_char(starts_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') as starts,
                  to_char(ends_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') as ends
           from public.lesson_sessions where id = $1`,
          [LS.A2],
        )
      ).rows;
    });
    expect(rows).toEqual([{ starts: "2026-12-01 20:00", ends: "2026-12-01 20:50" }]);
  });

  it("SCH-03·ATT-06: T1 × 차감된 참여 행이 있는 회차의 시간 변경 → 거부", async () => {
    expect(await attemptWrite(db, ACTORS.T1, moveSession(LS.A1))).toBe("reject");
  });

  it("SCH-03·SCH-06: T1 × canceled 회차의 시간 변경 → 거부", async () => {
    expect(await attemptWrite(db, ACTORS.T1, moveSession(LS.A_CANCELED))).toBe("reject");
  });

  it("SCH-03: T1 × 시간 변경으로 ends_at ≤ starts_at → 거부", async () => {
    expect(
      await attemptWrite(db, ACTORS.T1, {
        sql: `update public.lesson_sessions set ends_at = starts_at where id = $1`,
        params: [LS.A2],
      }),
    ).toBe("reject");
  });

  it("AUTH-07: 탈퇴 T1 × 자기 회차 시간 변경 → 거부", async () => {
    expect(await attemptWrite(db, ACTORS.T1, moveSession(LS.A2, withdrawT1))).toBe("reject");
  });

  it("ADM-02: 정지 T1 × 자기 회차 시간 변경 → 허용", async () => {
    expect(await attemptWrite(db, ACTORS.T1, moveSession(LS.A2, suspendT1))).toBe("allow");
  });

  it("SCH-03·ADM-07: T2·학생A·운영자 × T1 회차 시간 변경 → 거부", async () => {
    for (const actor of [ACTORS.T2, ACTORS.학생A, ACTORS.운영자]) {
      expect(await attemptWrite(db, actor, moveSession(LS.A2))).toBe("reject");
    }
  });

  // 시간 말고 다른 컬럼은 T1도 못 고친다. 값은 무결성에 맞는 것으로 골라 권한만으로 판정되게 한다
  // (mode = online과 trainer_id·group_class_id 변경은 무결성 제약에도 걸리므로 서버 짝을 두지 않는다).
  it.each<[string, OpCase, "allow" | "reject"]>([
    [
      "status → canceled (회차 취소는 서버 함수, SCH-06)",
      {
        sql: `update public.lesson_sessions set status = 'canceled' where id = $1`,
        params: [LS.A2],
      },
      "allow",
    ],
    [
      "kind single → makeup",
      { sql: `update public.lesson_sessions set kind = 'makeup' where id = $1`, params: [LS.AS2] },
      "allow",
    ],
    [
      "fixed_schedule_id → 같은 수강권의 닫힌 고정 일정",
      {
        sql: `update public.lesson_sessions set fixed_schedule_id = $2 where id = $1`,
        params: [LS.A3, FS.A_OLD],
      },
      "allow",
    ],
    [
      "mode → online",
      { sql: `update public.lesson_sessions set mode = 'online' where id = $1`, params: [LS.A2] },
      "reject",
    ],
    [
      "trainer_id → T2",
      {
        sql: `update public.lesson_sessions set trainer_id = $2 where id = $1`,
        params: [LS.AS2, U.T2],
      },
      "reject",
    ],
    [
      "group_class_id → R3",
      {
        sql: `update public.lesson_sessions set group_class_id = $2 where id = $1`,
        params: [LS.R1B, GC.R3],
      },
      "reject",
    ],
  ])("SCH-06: T1 × %s → 거부 (서버: %s)", async (_, opCase, serverExpected) => {
    expect(await attemptWrite(db, ACTORS.T1, opCase)).toBe("reject");
    expect(await attemptWrite(db, service, opCase)).toBe(serverExpected);
  });
});

// ===========================================================================
// session_attendees
// ===========================================================================

const selectAttendee = (id: string): OpCase => ({
  sql: `select 1 from public.session_attendees where id = $1`,
  params: [id],
});
// 바른 값(서버라면 허용): 참여 행이 없는 1:1 회차 LS.A3에 학생A
const insertAttendeeA3: OpCase = {
  sql: `insert into public.session_attendees
          (session_id, ticket_id, student_id, attendance, canceled_by, deducted, session_amount, checked_at)
        values ($1, $2, $3, 'none', null, false, null, null)`,
  params: [LS.A3, TK.A, U.SA],
};
const checkPresent = (id: string): OpCase => ({
  sql: `update public.session_attendees
        set attendance = 'present', deducted = true, session_amount = 50000, checked_at = now()
        where id = $1`,
  params: [id],
});
const deleteAttendee = (id: string): OpCase => ({
  sql: `delete from public.session_attendees where id = $1`,
  params: [id],
});

describeRlsMatrix(
  {
    title: "#32 session_attendees 권한 — ATT-03, ATT-05, SCH-05, STL-02, ADM-07",
    actors: ACTORS,
    cases: {
      "session_attendees:학생A A2": {
        select: selectAttendee(SA.A2),
        insert: insertAttendeeA3,
        update: checkPresent(SA.A2),
        delete: deleteAttendee(SA.A2),
      },
      "session_attendees:학생A A1 차감됨": { select: selectAttendee(SA.A1) },
      "session_attendees:학생G R1": {
        select: selectAttendee(SA.R1A_G),
        update: checkPresent(SA.R1A_G),
        delete: deleteAttendee(SA.R1A_G),
      },
      "session_attendees:학생H R1": { select: selectAttendee(SA.R1A_H) },
      "session_attendees:학생C 지난 회차": { select: selectAttendee(SA.C1) },
    },
    rows: [
      // 역할    테이블                                  select   insert   update   delete
      ["T1", "session_attendees:학생A A2", "allow", "deny", "deny", "deny"],
      ["T1", "session_attendees:학생G R1", "allow", "-", "deny", "deny"],
      ["T1", "session_attendees:학생H R1", "allow", "-", "-", "-"],
      ["T1", "session_attendees:학생C 지난 회차", "allow", "-", "-", "-"],
      ["운영자", "session_attendees:학생A A2", "allow", "deny", "deny", "deny"],
      ["운영자", "session_attendees:학생H R1", "allow", "-", "-", "-"],
      ["학생A", "session_attendees:학생A A2", "allow", "deny", "deny", "deny"],
      ["학생A", "session_attendees:학생A A1 차감됨", "allow", "-", "-", "-"],
      ["학생A", "session_attendees:학생G R1", "deny", "-", "-", "-"],
      ["학생G", "session_attendees:학생G R1", "allow", "-", "deny", "deny"],
      ["학생G", "session_attendees:학생H R1", "deny", "-", "-", "-"],
      ["학생G", "session_attendees:학생A A2", "deny", "-", "-", "-"],
      ["학생H", "session_attendees:학생H R1", "allow", "-", "-", "-"],
      ["학생C", "session_attendees:학생C 지난 회차", "allow", "-", "-", "-"],
      ["학생B", "session_attendees:학생A A2", "deny", "deny", "deny", "deny"],
      ["T2", "session_attendees:학생A A2", "deny", "deny", "deny", "deny"],
      ["T2", "session_attendees:학생G R1", "deny", "-", "-", "-"],
      ["anon", "session_attendees:학생A A2", "deny", "deny", "deny", "deny"],
    ],
  },
  { db: getDb },
);

describe("#32 참여 행 읽기 — ATT-03, ATT-05, ADM-07 (팀장 결정 2)", () => {
  const visibleIds = async (actor: Actor, ids: string[]) =>
    withActor(db, actor, async (tx) => {
      try {
        return (
          await tx.query<{ id: string }>(
            `select id from public.session_attendees where id = any($1::uuid[]) order by id`,
            [ids],
          )
        ).rows.map((row) => row.id);
      } catch {
        return [];
      }
    });
  const T1_ATTENDEES = [SA.A1, SA.A2, SA.A_CANCELED, SA.R1A_G, SA.R1A_H, SA.AS, SA.C1];

  it("ATT-03: T1은 자기 회차의 참여 행 전부를 읽는다", async () => {
    expect(await visibleIds(ACTORS.T1, T1_ATTENDEES)).toEqual([...T1_ATTENDEES].sort());
  });

  it("ADM-07: 운영자는 참여 행을 전부 읽는다(T2 회차 포함)", async () => {
    const all = [...T1_ATTENDEES, SA.B1];
    expect(await visibleIds(ACTORS.운영자, all)).toEqual([...all].sort());
  });

  it("ATT-05: 학생G는 자기 참여 행만 읽고, 같은 R1 회차의 학생H 참여 행은 읽지 못한다", async () => {
    expect(await visibleIds(ACTORS.학생G, T1_ATTENDEES)).toEqual([SA.R1A_G]);
  });

  it("ATT-05: 학생A는 자기 참여 행(지난·취소·일회권 포함)만 읽는다", async () => {
    expect(await visibleIds(ACTORS.학생A, T1_ATTENDEES)).toEqual(
      [SA.A1, SA.A2, SA.A_CANCELED, SA.AS].sort(),
    );
  });

  it("ATT-05: 학생C는 끝난 수강권의 지난 참여 행을 계속 읽는다", async () => {
    expect(await visibleIds(ACTORS.학생C, T1_ATTENDEES)).toEqual([SA.C1]);
  });

  it("ATT-05: 학생B·T2·anon은 T1 회차의 참여 행을 읽지 못한다", async () => {
    for (const actor of [ACTORS.학생B, ACTORS.T2, ACTORS.anon]) {
      expect(await visibleIds(actor, T1_ATTENDEES)).toEqual([]);
    }
  });
});

describe("#32 참여 행은 서버만 쓴다 — ATT-03, ATT-05, SCH-05, STL-02 (팀장 결정 1)", () => {
  const studentPreCancel: OpCase = {
    sql: `update public.session_attendees
          set attendance = 'pre_canceled', canceled_by = 'student', checked_at = now()
          where id = $1`,
    params: [SA.A2],
  };
  const trainerCheckOnly: OpCase = {
    sql: `update public.session_attendees set attendance = 'absent' where id = $1`,
    params: [SA.A2],
  };
  const trainerDeductOnly: OpCase = {
    sql: `update public.session_attendees set deducted = true, session_amount = 50000 where id = $1`,
    params: [SA.A2],
  };

  it("SCH-05·ATT-05: 학생A × 자기 출결을 사전 취소로 바꾸기 → 거부, 서버 → 허용", async () => {
    expect(await attemptWrite(db, ACTORS.학생A, studentPreCancel)).toBe("reject");
    expect(await attemptWrite(db, service, studentPreCancel)).toBe("allow");
  });

  it("ATT-05: 학생A × 자기 출결을 출석·차감으로 바꾸기 → 거부", async () => {
    expect(await attemptWrite(db, ACTORS.학생A, checkPresent(SA.A2))).toBe("reject");
  });

  it("ATT-03: T1 × 클라이언트로 출결만 쓰기 → 거부, 서버 → 허용", async () => {
    expect(await attemptWrite(db, ACTORS.T1, trainerCheckOnly)).toBe("reject");
    expect(await attemptWrite(db, service, checkPresent(SA.A2))).toBe("allow");
  });

  it("STL-02: T1 × 클라이언트로 deducted·session_amount 쓰기 → 거부", async () => {
    expect(await attemptWrite(db, ACTORS.T1, trainerDeductOnly)).toBe("reject");
  });

  it("ATT-03: T1 × 자기 회차에 참여 행 넣기·지우기 → 거부, 서버 넣기 → 허용", async () => {
    expect(await attemptWrite(db, ACTORS.T1, insertAttendeeA3)).toBe("reject");
    expect(await attemptWrite(db, ACTORS.T1, deleteAttendee(SA.A2))).toBe("reject");
    expect(await attemptWrite(db, service, insertAttendeeA3)).toBe("allow");
  });

  it("ATT-05: 학생A × 자기 참여 행 넣기·지우기 → 거부", async () => {
    expect(await attemptWrite(db, ACTORS.학생A, insertAttendeeA3)).toBe("reject");
    expect(await attemptWrite(db, ACTORS.학생A, deleteAttendee(SA.A2))).toBe("reject");
  });
});

// ===========================================================================
// 준비 작업 확인 (차단 칸이 엉뚱한 이유로 통과하지 않게)
// ===========================================================================

describe("#32 준비 작업이 의도한 상태를 만든다 (권한) — ADM-02, AUTH-07, SCH-03", () => {
  const read = async <R>(sql: string, params: unknown[], setup?: Setup) =>
    withActor(db, service, async (tx) => (await tx.query<R>(sql, params)).rows, opt(setup));

  it("정지 준비: T1의 approval_status가 suspended다", async () => {
    expect(
      await read(
        `select approval_status from public.trainer_profiles where user_id = $1`,
        [U.T1],
        suspendT1,
      ),
    ).toEqual([{ approval_status: "suspended" }]);
  });

  it("탈퇴 준비: T1의 users.status가 withdrawn이다", async () => {
    expect(await read(`select status from public.users where id = $1`, [U.T1], withdrawT1)).toEqual(
      [{ status: "withdrawn" }],
    );
  });

  it("준비 데이터: A2는 scheduled이고 차감된 참여 행이 없다, A1에는 있다, 취소 회차에는 없다", async () => {
    const rows = await read<{ id: string; status: string; deducted_count: number }>(
      `select s.id, s.status::text as status,
              (select count(*)::int from public.session_attendees a
               where a.session_id = s.id and a.deducted) as deducted_count
       from public.lesson_sessions s where s.id = any($1::uuid[]) order by s.id`,
      [[LS.A1, LS.A2, LS.A_CANCELED]],
    );
    expect(rows).toEqual([
      { id: LS.A1, status: "scheduled", deducted_count: 1 },
      { id: LS.A2, status: "scheduled", deducted_count: 0 },
      { id: LS.A_CANCELED, status: "canceled", deducted_count: 0 },
    ]);
  });
});
