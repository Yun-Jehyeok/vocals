// 인수 테스트: 이슈 #28 묶음 2 — #10에서 넘어온 정책
// (QA가 개발 전에 쓴다. 개발은 고치지 않는다. 틀렸다고 보면 `[질문] 받는 역할: QA`)
//
// 완료 조건 → 테스트
// - 정지 트레이너 프로필·장르를 수강 관계 학생(학생A, 수강권이 모두 끝난 학생C)이 읽는다 (ADM-02, 팀장 결정 7)
// - 트레이너는 끝나지 않은 수강권(waiting_schedule·active)이 있는 자기 학생의 user_private_profiles만 읽는다 (AUTH-09)
// - 마지막 끝나지 않은 수강권을 서버가 ended로 바꾸면 바로 못 읽는다 (AUTH-09)
// - user_account_records는 본인·운영자만, 학생은 자기 트레이너의 개인정보를 못 읽는다 (AUTH-09, AUTH-08)
// - private 함수와 anon 실행 권한은 28-schema-seed.test.ts
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, asUser, service, withActor } from "../helpers/db.ts";
import { describeRlsMatrix } from "../helpers/rls-matrix.ts";
import type { OpCase } from "../helpers/rls-matrix.ts";
import type { Setup } from "./28-fixture.ts";
import { E, U, createBundle2Db, endAllTickets, suspend } from "./28-fixture.ts";

let db: PGlite;

beforeAll(async () => {
  db = await createBundle2Db();
});

afterAll(async () => {
  await db?.close();
});

const getDb = () => db;

const suspendT1 = suspend(U.T1);
const endAllOfA = endAllTickets(E.A);

const selectBy = (table: string, column: string, id: string, setup?: Setup): OpCase => ({
  sql: `select 1 from public.${table} where ${column} = $1`,
  params: [id],
  ...(setup ? { setup } : {}),
});

describeRlsMatrix(
  {
    title:
      "#28 정지 트레이너의 프로필·장르는 수강 관계 학생이 읽는다 — ADM-02, 결정 로그 2026-11-19, 팀장 결정 7",
    actors: {
      anon,
      학생A: asUser(U.SA),
      "학생C(수강권 모두 ended)": asUser(U.SC),
      학생B: asUser(U.SB),
      T2: asUser(U.T2),
      "정지 T1(본인)": asUser(U.T1),
      운영자: asUser(U.ADMIN),
    },
    cases: {
      "trainer_profiles:정지 T1": {
        select: selectBy("trainer_profiles", "user_id", U.T1, suspendT1),
      },
      "trainer_genres:정지 T1": {
        select: selectBy("trainer_genres", "trainer_id", U.T1, suspendT1),
      },
    },
    rows: [
      // 역할                        테이블                      select   insert  update  delete
      ["학생A", "trainer_profiles:정지 T1", "allow", "-", "-", "-"],
      ["학생C(수강권 모두 ended)", "trainer_profiles:정지 T1", "allow", "-", "-", "-"],
      ["학생B", "trainer_profiles:정지 T1", "deny", "-", "-", "-"],
      ["anon", "trainer_profiles:정지 T1", "deny", "-", "-", "-"],
      ["T2", "trainer_profiles:정지 T1", "deny", "-", "-", "-"],
      ["정지 T1(본인)", "trainer_profiles:정지 T1", "allow", "-", "-", "-"],
      ["운영자", "trainer_profiles:정지 T1", "allow", "-", "-", "-"],

      ["학생A", "trainer_genres:정지 T1", "allow", "-", "-", "-"],
      ["학생C(수강권 모두 ended)", "trainer_genres:정지 T1", "allow", "-", "-", "-"],
      ["학생B", "trainer_genres:정지 T1", "deny", "-", "-", "-"],
      ["anon", "trainer_genres:정지 T1", "deny", "-", "-", "-"],
    ],
  },
  { db: getDb },
);

describeRlsMatrix(
  {
    title: "#28 트레이너는 자기 학생의 개인정보만 읽는다 — AUTH-09, AUTH-08, 결정 로그 2026-11-20",
    actors: {
      T1: asUser(U.T1),
      T2: asUser(U.T2),
      "파일럿 트레이너": asUser(U.TPL),
      학생A: asUser(U.SA),
      운영자: asUser(U.ADMIN),
    },
    cases: {
      "user_private_profiles:학생A(active·waiting)": {
        select: selectBy("user_private_profiles", "user_id", U.SA),
      },
      "user_private_profiles:학생D(waiting_schedule만)": {
        select: selectBy("user_private_profiles", "user_id", U.SD),
      },
      "user_private_profiles:학생C(모두 ended)": {
        select: selectBy("user_private_profiles", "user_id", U.SC),
      },
      "user_private_profiles:학생B(T2의 학생)": {
        select: selectBy("user_private_profiles", "user_id", U.SB),
      },
      "user_private_profiles:학생A(서버가 마지막 수강권까지 ended로 바꾼 뒤)": {
        select: selectBy("user_private_profiles", "user_id", U.SA, endAllOfA),
      },
      "user_private_profiles:T1(학생이 자기 트레이너를)": {
        select: selectBy("user_private_profiles", "user_id", U.T1),
      },
      "user_account_records:학생A": {
        select: selectBy("user_account_records", "user_id", U.SA),
      },
    },
    rows: [
      // 역할              테이블                                                         select  insert  update  delete
      ["T1", "user_private_profiles:학생A(active·waiting)", "allow", "-", "-", "-"],
      ["T1", "user_private_profiles:학생D(waiting_schedule만)", "allow", "-", "-", "-"],
      ["T1", "user_private_profiles:학생C(모두 ended)", "deny", "-", "-", "-"],
      ["T1", "user_private_profiles:학생B(T2의 학생)", "deny", "-", "-", "-"],
      ["T2", "user_private_profiles:학생B(T2의 학생)", "allow", "-", "-", "-"],
      ["T2", "user_private_profiles:학생A(active·waiting)", "deny", "-", "-", "-"],
      // 파일럿 무료 수강권(waiting_schedule)도 끝나지 않은 수강권이다
      ["파일럿 트레이너", "user_private_profiles:학생A(active·waiting)", "allow", "-", "-", "-"],
      [
        "T1",
        "user_private_profiles:학생A(서버가 마지막 수강권까지 ended로 바꾼 뒤)",
        "deny",
        "-",
        "-",
        "-",
      ],
      [
        "운영자",
        "user_private_profiles:학생A(서버가 마지막 수강권까지 ended로 바꾼 뒤)",
        "allow",
        "-",
        "-",
        "-",
      ],
      ["학생A", "user_private_profiles:T1(학생이 자기 트레이너를)", "deny", "-", "-", "-"],
      ["T1", "user_private_profiles:T1(학생이 자기 트레이너를)", "allow", "-", "-", "-"],
      ["T1", "user_account_records:학생A", "deny", "-", "-", "-"],
      ["학생A", "user_account_records:학생A", "allow", "-", "-", "-"],
      ["운영자", "user_account_records:학생A", "allow", "-", "-", "-"],
    ],
  },
  { db: getDb },
);

describe("#28 트레이너가 읽는 개인정보 컬럼 — AUTH-09", () => {
  it("T1 × 학생A의 legal_name·birth_date·phone을 읽는다", async () => {
    const rows = await withActor(
      db,
      asUser(U.T1),
      async (tx) =>
        (
          await tx.query<{ legal_name: string; birth_date: string; phone: string }>(
            `select legal_name, birth_date::text as birth_date, phone
             from public.user_private_profiles where user_id = $1`,
            [U.SA],
          )
        ).rows,
    );
    expect(rows).toEqual([
      { legal_name: "가짜학생에이", birth_date: "2000-02-11", phone: "01002800011" },
    ]);
  });
});

describe("#28 준비 작업이 의도한 상태를 만든다 (#10 정책) — ADM-02, AUTH-09", () => {
  const read = async <R>(sql: string, params: unknown[], setup?: Setup) =>
    withActor(
      db,
      service,
      async (tx) => (await tx.query<R>(sql, params)).rows,
      setup ? { setup } : {},
    );

  it("정지 준비: T1의 approval_status가 suspended다", async () => {
    expect(
      await read(
        `select approval_status from public.trainer_profiles where user_id = $1`,
        [U.T1],
        suspendT1,
      ),
    ).toEqual([{ approval_status: "suspended" }]);
  });

  it("준비 데이터: 학생A는 T1의 끝나지 않은 수강권이 있다", async () => {
    const rows = await read<{ n: number }>(
      `select count(*)::int as n from public.tickets where enrollment_id = $1 and status <> 'ended'`,
      [E.A],
    );
    expect(rows[0]?.n).toBeGreaterThan(0);
  });

  it("끝내기 준비: 학생A–T1 수강 관계는 남고 끝나지 않은 수강권은 없다", async () => {
    const rows = await read<{ enrollments: number; open_tickets: number }>(
      `select (select count(*)::int from public.enrollments where id = $1) as enrollments,
              (select count(*)::int from public.tickets where enrollment_id = $1 and status <> 'ended') as open_tickets`,
      [E.A],
      endAllOfA,
    );
    expect(rows).toEqual([{ enrollments: 1, open_tickets: 0 }]);
  });

  it("준비 데이터: 학생C는 T1과 수강 관계가 있고 수강권은 모두 ended다", async () => {
    const rows = await read<{ statuses: string[] }>(
      `select array_agg(distinct t.status::text) as statuses
       from public.enrollments e join public.tickets t on t.enrollment_id = e.id
       where e.student_id = $1 and e.trainer_id = $2`,
      [U.SC, U.T1],
    );
    expect(rows).toEqual([{ statuses: ["ended"] }]);
  });
});
