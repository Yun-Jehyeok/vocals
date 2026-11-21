// 인수 테스트: 이슈 #28 묶음 2 — lesson_products, group_classes, 그룹 반 배정(tickets.group_class_id)
// (QA가 개발 전에 쓴다. 개발은 고치지 않는다. 틀렸다고 보면 `[질문] 받는 역할: QA`)
//
// 준비 데이터와 역할은 28-fixture.ts. 정지·탈퇴·비노출·정원 상태는 시도마다 준비 작업(setup)으로 만든다.
// 권한(누가 하나)은 RLS 매트릭스(attempt: 42501·0행 = 차단)로,
// 값 검사·정원·삭제 제한(막는 방법은 개발이 고른다)은 attemptWrite(제약·트리거 거부도 거부)로 판정한다.
// 거부 판정마다 바른 값의 짝을 허용으로 함께 둔다.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, asUser, service, withActor } from "../helpers/db.ts";
import { attemptWrite, describeRlsMatrix } from "../helpers/rls-matrix.ts";
import type { OpCase } from "../helpers/rls-matrix.ts";
import type { Setup } from "./28-fixture.ts";
import {
  E,
  GC,
  P,
  TK,
  U,
  assign,
  chain,
  createBundle2Db,
  setCapacity,
  suspend,
  unlist,
  withdraw,
} from "./28-fixture.ts";

let db: PGlite;

beforeAll(async () => {
  db = await createBundle2Db();
});

afterAll(async () => {
  await db?.close();
});

const getDb = () => db;

const opt = (setup?: Setup) => (setup ? { setup } : {});

// ---------------------------------------------------------------------------
// lesson_products 시도
// ---------------------------------------------------------------------------

const selectProduct = (id: string, setup?: Setup): OpCase => ({
  sql: `select 1 from public.lesson_products where id = $1`,
  params: [id],
  ...opt(setup),
});

const insertProduct = (trainerId: string, setup?: Setup): OpCase => ({
  sql: `insert into public.lesson_products
          (trainer_id, lesson_type, ticket_type, session_count, price, duration_min, active)
        values ($1, 'private', 'regular', 6, 180000, 50, true)`,
  params: [trainerId],
  ...opt(setup),
});

const updateProduct = (id: string, setup?: Setup): OpCase => ({
  sql: `update public.lesson_products
        set price = 210000, session_count = 8, duration_min = 60, active = false
        where id = $1`,
  params: [id],
  ...opt(setup),
});

const deleteProduct = (id: string): OpCase => ({
  sql: `delete from public.lesson_products where id = $1`,
  params: [id],
});

const suspendT1 = suspend(U.T1);
const withdrawT1 = withdraw(U.T1);

describeRlsMatrix(
  {
    title:
      "#28 lesson_products 읽기 — TRN-02, PAY-02, MKT-02, MKT-07, AUTH-05, ADM-02, ADM-07, 팀장 결정 1·7",
    actors: {
      anon,
      학생A: asUser(U.SA),
      학생B: asUser(U.SB),
      학생C: asUser(U.SC),
      T1: asUser(U.T1),
      T2: asUser(U.T2),
      "pending 트레이너(본인)": asUser(U.TP),
      운영자: asUser(U.ADMIN),
    },
    cases: {
      "lesson_products:approved·active": { select: selectProduct(P.T1_PRIVATE) },
      "lesson_products:approved·active·listed=false": {
        select: selectProduct(P.T1_PRIVATE, unlist(U.T1)),
      },
      "lesson_products:pending": { select: selectProduct(P.TP) },
      "lesson_products:rejected": { select: selectProduct(P.TR) },
      "lesson_products:suspended·active": { select: selectProduct(P.T1_PRIVATE, suspendT1) },
      "lesson_products:active=false": { select: selectProduct(P.T1_INACTIVE) },
    },
    rows: [
      // 역할                       테이블                                          select   insert  update  delete
      ["anon", "lesson_products:approved·active", "allow", "-", "-", "-"],
      ["학생B", "lesson_products:approved·active", "allow", "-", "-", "-"],
      ["학생A", "lesson_products:approved·active", "allow", "-", "-", "-"],
      ["T1", "lesson_products:approved·active", "allow", "-", "-", "-"],
      ["운영자", "lesson_products:approved·active", "allow", "-", "-", "-"],

      ["anon", "lesson_products:approved·active·listed=false", "allow", "-", "-", "-"],
      ["학생B", "lesson_products:approved·active·listed=false", "allow", "-", "-", "-"],

      ["anon", "lesson_products:pending", "deny", "-", "-", "-"],
      ["학생B", "lesson_products:pending", "deny", "-", "-", "-"],
      ["pending 트레이너(본인)", "lesson_products:pending", "allow", "-", "-", "-"],
      ["운영자", "lesson_products:pending", "allow", "-", "-", "-"],
      ["anon", "lesson_products:rejected", "deny", "-", "-", "-"],
      ["학생B", "lesson_products:rejected", "deny", "-", "-", "-"],

      ["anon", "lesson_products:suspended·active", "deny", "-", "-", "-"],
      ["학생B", "lesson_products:suspended·active", "deny", "-", "-", "-"],
      ["학생A", "lesson_products:suspended·active", "allow", "-", "-", "-"],
      ["학생C", "lesson_products:suspended·active", "allow", "-", "-", "-"],
      ["T1", "lesson_products:suspended·active", "allow", "-", "-", "-"],
      ["운영자", "lesson_products:suspended·active", "allow", "-", "-", "-"],

      ["anon", "lesson_products:active=false", "deny", "-", "-", "-"],
      ["학생A", "lesson_products:active=false", "deny", "-", "-", "-"],
      ["학생B", "lesson_products:active=false", "deny", "-", "-", "-"],
      ["T2", "lesson_products:active=false", "deny", "-", "-", "-"],
      ["T1", "lesson_products:active=false", "allow", "-", "-", "-"],
      ["운영자", "lesson_products:active=false", "allow", "-", "-", "-"],
    ],
  },
  { db: getDb },
);

describeRlsMatrix(
  {
    title: "#28 lesson_products 쓰기 — TRN-03, TRN-05, AUTH-05, AUTH-07, ADM-02, 팀장 결정 1",
    actors: {
      anon,
      학생A: asUser(U.SA),
      T1: asUser(U.T1),
      "정지 T1": asUser(U.T1),
      "탈퇴 T1": asUser(U.T1),
      T2: asUser(U.T2),
      "pending 트레이너(본인)": asUser(U.TP),
      운영자: asUser(U.ADMIN),
    },
    cases: {
      "lesson_products:T1 상품": {
        insert: insertProduct(U.T1),
        update: updateProduct(P.T1_PRIVATE),
        // 판매한 적 없는 비활성 상품도 지우지 못한다(판매 중지는 active = false)
        delete: deleteProduct(P.T1_INACTIVE),
      },
      "lesson_products:정지 T1 상품": {
        insert: insertProduct(U.T1, suspendT1),
        update: updateProduct(P.T1_PRIVATE, suspendT1),
      },
      "lesson_products:탈퇴 T1 상품": {
        insert: insertProduct(U.T1, withdrawT1),
        update: updateProduct(P.T1_PRIVATE, withdrawT1),
      },
      "lesson_products:pending 트레이너 상품": {
        insert: insertProduct(U.TP),
        update: updateProduct(P.TP),
      },
      "lesson_products:학생 자신을 trainer_id로": { insert: insertProduct(U.SA) },
      "lesson_products:운영자 자신을 trainer_id로": { insert: insertProduct(U.ADMIN) },
    },
    rows: [
      // 역할                       테이블                                    select  insert   update   delete
      ["T1", "lesson_products:T1 상품", "-", "allow", "allow", "deny"],
      ["T2", "lesson_products:T1 상품", "-", "deny", "deny", "deny"],
      ["학생A", "lesson_products:T1 상품", "-", "deny", "deny", "deny"],
      ["운영자", "lesson_products:T1 상품", "-", "deny", "-", "deny"],
      ["anon", "lesson_products:T1 상품", "-", "deny", "deny", "deny"],
      ["정지 T1", "lesson_products:정지 T1 상품", "-", "allow", "allow", "-"],
      ["탈퇴 T1", "lesson_products:탈퇴 T1 상품", "-", "deny", "deny", "-"],
      [
        "pending 트레이너(본인)",
        "lesson_products:pending 트레이너 상품",
        "-",
        "allow",
        "allow",
        "-",
      ],
      ["학생A", "lesson_products:학생 자신을 trainer_id로", "-", "deny", "-", "-"],
      ["운영자", "lesson_products:운영자 자신을 trainer_id로", "-", "deny", "-", "-"],
    ],
  },
  { db: getDb },
);

describe("#28 lesson_products 값 검사와 trainer_id 고정 — TRN-03, TRN-05, TRN-06, 팀장 결정 2", () => {
  const t1 = asUser(U.T1);
  const insertWith = (
    lessonType: string,
    ticketType: string,
    sessions: number,
    price: number,
    duration: number,
  ): OpCase => ({
    sql: `insert into public.lesson_products
            (trainer_id, lesson_type, ticket_type, session_count, price, duration_min, active)
          values ($1, $2, $3, $4, $5, $6, true)`,
    params: [U.T1, lessonType, ticketType, sessions, price, duration],
  });

  it.each<[string, OpCase, "allow" | "reject"]>([
    ["일회권 1회 (TRN-03)", insertWith("private", "single", 1, 50000, 50), "allow"],
    ["그룹 일회권 1회 (TRN-03)", insertWith("group", "single", 1, 30000, 60), "allow"],
    [
      "정기권 6회 — 4의 배수가 아니어도 된다 (TRN-06)",
      insertWith("private", "regular", 6, 1, 1),
      "allow",
    ],
    ["일회권인데 2회", insertWith("private", "single", 2, 50000, 50), "reject"],
    ["정기권 0회", insertWith("private", "regular", 0, 50000, 50), "reject"],
    ["가격 0원", insertWith("private", "regular", 4, 0, 50), "reject"],
    ["가격 음수", insertWith("private", "regular", 4, -1, 50), "reject"],
    ["레슨 길이 0분 (TRN-05)", insertWith("private", "regular", 4, 200000, 0), "reject"],
  ])("T1 × lesson_products insert: %s → %s", async (_, opCase, expected) => {
    expect(await attemptWrite(db, t1, opCase)).toBe(expected);
  });

  it.each<[string, string, "allow" | "reject"]>([
    ["session_count = 0", "session_count = 0", "reject"],
    ["price = 0", "price = 0", "reject"],
    ["duration_min = 0", "duration_min = 0", "reject"],
    ["session_count = 12, price = 500000", "session_count = 12, price = 500000", "allow"],
  ])("T1 × lesson_products update: %s → %s", async (_, set, expected) => {
    expect(
      await attemptWrite(db, t1, {
        sql: `update public.lesson_products set ${set} where id = $1`,
        params: [P.T1_PRIVATE],
      }),
    ).toBe(expected);
  });

  it("T1 × 일회권 상품의 session_count를 2로 고치기 → 거부", async () => {
    expect(
      await attemptWrite(db, t1, {
        sql: `update public.lesson_products set session_count = 2 where id = $1`,
        params: [P.T1_INACTIVE],
      }),
    ).toBe("reject");
  });

  it("T1 × 자기 상품의 trainer_id를 T2로 바꾸기 → 거부 (TRN-03)", async () => {
    expect(
      await attemptWrite(db, t1, {
        sql: `update public.lesson_products set trainer_id = $2 where id = $1`,
        params: [P.T1_PRIVATE, U.T2],
      }),
    ).toBe("reject");
  });
});

// ---------------------------------------------------------------------------
// group_classes
// ---------------------------------------------------------------------------

const selectClass = (id: string): OpCase => ({
  sql: `select 1 from public.group_classes where id = $1`,
  params: [id],
});

const insertClass = (trainerId: string, setup?: Setup): OpCase => ({
  sql: `insert into public.group_classes (trainer_id, name, capacity, duration_min)
        values ($1, '새 반', 4, 60)`,
  params: [trainerId],
  ...opt(setup),
});

const updateClass = (id: string, setup?: Setup): OpCase => ({
  sql: `update public.group_classes set name = '바꾼 반', duration_min = 50 where id = $1`,
  params: [id],
  ...opt(setup),
});

const deleteClass = (id: string, setup?: Setup): OpCase => ({
  sql: `delete from public.group_classes where id = $1`,
  params: [id],
  ...opt(setup),
});

describeRlsMatrix(
  {
    title: "#28 group_classes 권한 — TRN-04, ADM-02, ADM-07, AUTH-07, 팀장 결정 7·8",
    actors: {
      anon,
      "학생A(배정됨)": asUser(U.SA),
      "학생D(미배정 그룹 수강권)": asUser(U.SD),
      학생B: asUser(U.SB),
      T1: asUser(U.T1),
      "정지 T1": asUser(U.T1),
      "탈퇴 T1": asUser(U.T1),
      T2: asUser(U.T2),
      운영자: asUser(U.ADMIN),
    },
    cases: {
      "group_classes:T1 배정 있는 반": { select: selectClass(GC.T1_FULL) },
      "group_classes:T1 빈 반": {
        insert: insertClass(U.T1),
        update: updateClass(GC.T1_EMPTY),
        delete: deleteClass(GC.T1_EMPTY),
      },
      "group_classes:정지 T1 빈 반": {
        insert: insertClass(U.T1, suspendT1),
        update: updateClass(GC.T1_EMPTY, suspendT1),
      },
      "group_classes:탈퇴 T1 빈 반": {
        insert: insertClass(U.T1, withdrawT1),
        update: updateClass(GC.T1_EMPTY, withdrawT1),
        delete: deleteClass(GC.T1_EMPTY, withdrawT1),
      },
      "group_classes:학생 자신을 trainer_id로": { insert: insertClass(U.SA) },
    },
    rows: [
      // 역할                          테이블                                 select   insert   update   delete
      ["T1", "group_classes:T1 배정 있는 반", "allow", "-", "-", "-"],
      ["운영자", "group_classes:T1 배정 있는 반", "allow", "-", "-", "-"],
      ["학생A(배정됨)", "group_classes:T1 배정 있는 반", "allow", "-", "-", "-"],
      ["학생D(미배정 그룹 수강권)", "group_classes:T1 배정 있는 반", "deny", "-", "-", "-"],
      ["학생B", "group_classes:T1 배정 있는 반", "deny", "-", "-", "-"],
      ["T2", "group_classes:T1 배정 있는 반", "deny", "-", "-", "-"],
      ["anon", "group_classes:T1 배정 있는 반", "deny", "-", "-", "-"],

      ["T1", "group_classes:T1 빈 반", "-", "allow", "allow", "allow"],
      ["T2", "group_classes:T1 빈 반", "-", "deny", "deny", "deny"],
      ["학생A(배정됨)", "group_classes:T1 빈 반", "-", "deny", "deny", "deny"],
      ["anon", "group_classes:T1 빈 반", "-", "deny", "deny", "deny"],
      ["정지 T1", "group_classes:정지 T1 빈 반", "-", "allow", "allow", "-"],
      ["탈퇴 T1", "group_classes:탈퇴 T1 빈 반", "-", "deny", "deny", "deny"],
      ["학생A(배정됨)", "group_classes:학생 자신을 trainer_id로", "-", "deny", "-", "-"],
    ],
  },
  { db: getDb },
);

describe("#28 group_classes 값 검사·정원 줄이기·삭제 제한 — TRN-04, 팀장 결정 6·8", () => {
  const t1 = asUser(U.T1);
  const insertWith = (capacity: number, duration: number): OpCase => ({
    sql: `insert into public.group_classes (trainer_id, name, capacity, duration_min)
          values ($1, '새 반', $2, $3)`,
    params: [U.T1, capacity, duration],
  });
  const updateCapacity = (capacity: number, setup?: Setup): OpCase => ({
    sql: `update public.group_classes set capacity = $2 where id = $1`,
    params: [GC.T1_FULL, capacity],
    ...opt(setup),
  });

  it.each<[string, OpCase, "allow" | "reject"]>([
    ["정원 1, 60분", insertWith(1, 60), "allow"],
    ["정원 0", insertWith(0, 60), "reject"],
    ["레슨 길이 0분", insertWith(4, 0), "reject"],
  ])("T1 × group_classes insert: %s → %s", async (_, opCase, expected) => {
    expect(await attemptWrite(db, t1, opCase)).toBe(expected);
  });

  it("T1 × 반 정원을 0으로 → 거부", async () => {
    expect(
      await attemptWrite(db, t1, {
        sql: `update public.group_classes set capacity = 0 where id = $1`,
        params: [GC.T1_EMPTY],
      }),
    ).toBe("reject");
  });

  it("T1 × 배정 학생 1명(학생A)인 반의 정원 3 → 1 → 허용 (끝난 수강권의 학생C는 세지 않는다)", async () => {
    expect(await attemptWrite(db, t1, updateCapacity(1, setCapacity(GC.T1_FULL, 3)))).toBe("allow");
  });

  it("T1 × 배정 학생 2명(학생A·학생D)인 반의 정원 2 → 1 → 거부", async () => {
    const twoStudents = chain(setCapacity(GC.T1_FULL, 2), assign(TK.D, GC.T1_FULL));
    expect(await attemptWrite(db, t1, updateCapacity(1, twoStudents))).toBe("reject");
  });

  it("T1 × 수강권이 배정된 반 삭제 → 거부 (팀장 결정 8)", async () => {
    expect(await attemptWrite(db, t1, deleteClass(GC.T1_FULL))).toBe("reject");
  });

  it("T1 × 끝난 수강권만 배정된 반 삭제도 → 거부 (배정 기록 보존, 팀장 결정 8)", async () => {
    // 학생A의 active 수강권을 빈 반으로 옮겨 이 반에는 학생C의 끝난 수강권만 남긴다
    const onlyEnded = assign(TK.AG1, GC.T1_EMPTY);
    expect(await attemptWrite(db, t1, deleteClass(GC.T1_FULL, onlyEnded))).toBe("reject");
  });
});

// ---------------------------------------------------------------------------
// 그룹 반 배정 = 트레이너가 tickets.group_class_id를 고친다 (TRN-04, 팀장 결정 5·6)
// ---------------------------------------------------------------------------

const assignTo = (ticketId: string, groupClassId: string, setup?: Setup): OpCase => ({
  sql: `update public.tickets set group_class_id = $2 where id = $1`,
  params: [ticketId, groupClassId],
  ...opt(setup),
});

describe("#28 그룹 반 배정 — TRN-04, PAY-07, AUTH-07, 팀장 결정 5·6", () => {
  it.each<[string, string, OpCase, "allow" | "reject"]>([
    ["T1", "학생D 그룹 수강권 → 자기 빈 반", assignTo(TK.D, GC.T1_EMPTY), "allow"],
    [
      "T1",
      "학생A 재결제 그룹 수강권 → 학생A가 이미 있는 정원 1인 반 (같은 학생은 한 명, PAY-07)",
      assignTo(TK.AG2, GC.T1_FULL),
      "allow",
    ],
    ["T1", "학생D 그룹 수강권 → 정원이 찬 반(정원 1, 학생A)", assignTo(TK.D, GC.T1_FULL), "reject"],
    [
      "T1",
      "학생D 그룹 수강권 → 정원 2, 끝나지 않은 배정 1명인 반 (끝난 학생C는 세지 않는다)",
      assignTo(TK.D, GC.T1_FULL, setCapacity(GC.T1_FULL, 2)),
      "allow",
    ],
    ["T1", "학생D 그룹 수강권 → T2의 반", assignTo(TK.D, GC.T2), "reject"],
    ["T1", "학생A 1:1 수강권 → 자기 빈 반", assignTo(TK.A1, GC.T1_EMPTY), "reject"],
    ["T1", "학생C 끝난 그룹 수강권 → 자기 빈 반", assignTo(TK.CG, GC.T1_EMPTY), "reject"],
    ["T1", "T2 학생의 수강권 → 자기 빈 반", assignTo(TK.B, GC.T1_EMPTY), "reject"],
    ["T2", "학생D 그룹 수강권 → T2의 반", assignTo(TK.D, GC.T2), "reject"],
    ["T2", "학생D 그룹 수강권 → T1의 빈 반", assignTo(TK.D, GC.T1_EMPTY), "reject"],
    ["학생D", "자기 그룹 수강권 → T1의 빈 반", assignTo(TK.D, GC.T1_EMPTY), "reject"],
    ["학생A", "자기 재결제 그룹 수강권 → T1의 빈 반", assignTo(TK.AG2, GC.T1_EMPTY), "reject"],
    ["anon", "학생D 그룹 수강권 → T1의 빈 반", assignTo(TK.D, GC.T1_EMPTY), "reject"],
    [
      "탈퇴 T1",
      "학생D 그룹 수강권 → 자기 빈 반 (AUTH-07)",
      assignTo(TK.D, GC.T1_EMPTY, withdrawT1),
      "reject",
    ],
    [
      "정지 T1",
      "학생D 그룹 수강권 → 자기 빈 반 (ADM-02: 정지여도 자기 일은 한다)",
      assignTo(TK.D, GC.T1_EMPTY, suspendT1),
      "allow",
    ],
  ])("%s × %s → %s", async (actorName, _, opCase, expected) => {
    const actors = {
      T1: asUser(U.T1),
      "탈퇴 T1": asUser(U.T1),
      "정지 T1": asUser(U.T1),
      T2: asUser(U.T2),
      학생D: asUser(U.SD),
      학생A: asUser(U.SA),
      anon,
    } as const;
    const actor = actors[actorName as keyof typeof actors];
    expect(await attemptWrite(db, actor, opCase)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// 준비 작업 확인 (차단 칸이 엉뚱한 이유로 통과하지 않게)
// ---------------------------------------------------------------------------

describe("#28 준비 작업이 의도한 상태를 만든다 (products·classes) — ADM-02, AUTH-07, TRN-04", () => {
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

  it("비노출 준비: T1의 listed가 false이고 approved다", async () => {
    expect(
      await read(
        `select listed, approval_status from public.trainer_profiles where user_id = $1`,
        [U.T1],
        unlist(U.T1),
      ),
    ).toEqual([{ listed: false, approval_status: "approved" }]);
  });

  it("준비 데이터: 정원 1인 반에 끝나지 않은 배정은 학생A 1명, 끝난 배정은 학생C", async () => {
    const rows = await read<{ student_id: string; status: string }>(
      `select e.student_id, t.status from public.tickets t
       join public.enrollments e on e.id = t.enrollment_id
       where t.group_class_id = $1 order by t.status`,
      [GC.T1_FULL],
    );
    expect(rows).toEqual([
      { student_id: U.SA, status: "active" },
      { student_id: U.SC, status: "ended" },
    ]);
    expect(
      await read(`select capacity from public.group_classes where id = $1`, [GC.T1_FULL]),
    ).toEqual([{ capacity: 1 }]);
  });

  it("두 학생 배정 준비: 정원 2인 반에 학생A·학생D가 끝나지 않은 수강권으로 배정된다", async () => {
    const rows = await read<{ student_id: string }>(
      `select distinct e.student_id from public.tickets t
       join public.enrollments e on e.id = t.enrollment_id
       where t.group_class_id = $1 and t.status <> 'ended' order by e.student_id`,
      [GC.T1_FULL],
      chain(setCapacity(GC.T1_FULL, 2), assign(TK.D, GC.T1_FULL)),
    );
    expect(rows).toEqual([{ student_id: U.SA }, { student_id: U.SD }]);
  });

  it("준비 데이터: 학생D의 수강 관계는 T1과 있다", async () => {
    expect(await read(`select trainer_id from public.enrollments where id = $1`, [E.D])).toEqual([
      { trainer_id: U.T1 },
    ]);
  });
});
