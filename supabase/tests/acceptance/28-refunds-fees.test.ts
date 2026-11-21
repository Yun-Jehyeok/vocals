// 인수 테스트: 이슈 #28 묶음 2 — refund_requests, refunds, fee_policies
// (QA가 개발 전에 쓴다. 개발은 고치지 않는다. 틀렸다고 보면 `[질문] 받는 역할: QA`)
//
// 준비 데이터와 역할은 28-fixture.ts.
// - 환불 요청: PM 질문 1 추천안(결제한 수강권 중 waiting_schedule·active만), 팀장 결정 9(대기 요청은 수강권당 하나,
//   철회·수정 없음)
// - fee_policies: 팀장 결정 10(읽기는 운영자, 쓰기는 마이그레이션·서버만). 기준 데이터는 28-schema-seed.test.ts
// 요청 거부(다른 학생·끝난 수강권·파일럿·중복·processed)는 막는 방법(RLS·제약·트리거)을 개발이 고르므로
// attemptWrite로 판정하고, 바른 짝(허용)을 함께 둔다.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, asUser, service, withActor } from "../helpers/db.ts";
import { attemptWrite, describeRlsMatrix } from "../helpers/rls-matrix.ts";
import type { OpCase } from "../helpers/rls-matrix.ts";
import type { Setup } from "./28-fixture.ts";
import { PAY, REF, RR, TK, U, createBundle2Db, withdraw } from "./28-fixture.ts";

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
// refund_requests
// ===========================================================================

const requestFor = (ticketId: string, setup?: Setup): OpCase => ({
  sql: `insert into public.refund_requests (ticket_id, reason) values ($1, '개인 사정')`,
  params: [ticketId],
  ...(setup ? { setup } : {}),
});

describeRlsMatrix(
  {
    title: "#28 refund_requests 권한 — PAY-10, PAY-11, ADM-07, AUTH-07, 팀장 결정 9",
    actors: { ...ACTORS, "탈퇴 학생A": asUser(U.SA) },
    cases: {
      // 학생A 1:1 active 수강권의 requested 요청
      "refund_requests:학생A 요청": {
        select: { sql: `select 1 from public.refund_requests where id = $1`, params: [RR.A] },
        update: {
          sql: `update public.refund_requests set status = 'processed' where id = $1`,
          params: [RR.A],
        },
        delete: { sql: `delete from public.refund_requests where id = $1`, params: [RR.A] },
      },
      "refund_requests.reason:학생A 요청": {
        update: {
          sql: `update public.refund_requests set reason = '바꾼 사유' where id = $1`,
          params: [RR.A],
        },
      },
      // 학생A 그룹 waiting_schedule 수강권(요청 없음)에 새 요청
      "refund_requests:학생A 대기 수강권에 새 요청": { insert: requestFor(TK.AG2) },
      "refund_requests:탈퇴 학생A 대기 수강권에 새 요청": {
        insert: requestFor(TK.AG2, withdraw(U.SA)),
      },
    },
    rows: [
      // 역할          테이블                                            select   insert   update   delete
      ["학생A", "refund_requests:학생A 요청", "allow", "-", "deny", "deny"],
      ["T1", "refund_requests:학생A 요청", "allow", "-", "deny", "deny"],
      ["운영자", "refund_requests:학생A 요청", "allow", "-", "-", "-"],
      ["T2", "refund_requests:학생A 요청", "deny", "-", "deny", "deny"],
      ["학생B", "refund_requests:학생A 요청", "deny", "-", "deny", "deny"],
      ["학생C", "refund_requests:학생A 요청", "deny", "-", "-", "-"],
      ["anon", "refund_requests:학생A 요청", "deny", "-", "deny", "deny"],
      ["학생A", "refund_requests.reason:학생A 요청", "-", "-", "deny", "-"],
      ["T1", "refund_requests.reason:학생A 요청", "-", "-", "deny", "-"],

      ["학생A", "refund_requests:학생A 대기 수강권에 새 요청", "-", "allow", "-", "-"],
      ["T1", "refund_requests:학생A 대기 수강권에 새 요청", "-", "deny", "-", "-"],
      ["운영자", "refund_requests:학생A 대기 수강권에 새 요청", "-", "deny", "-", "-"],
      ["anon", "refund_requests:학생A 대기 수강권에 새 요청", "-", "deny", "-", "-"],
      ["탈퇴 학생A", "refund_requests:탈퇴 학생A 대기 수강권에 새 요청", "-", "deny", "-", "-"],
    ],
  },
  { db: getDb },
);

describe("#28 환불 요청을 만들 수 있는 수강권 — PAY-10, PM 질문 1, 팀장 결정 9", () => {
  const sa = asUser(U.SA);

  it.each<[string, OpCase, "allow" | "reject"]>([
    ["학생A × 자기 결제한 waiting_schedule 수강권", requestFor(TK.AG2), "allow"],
    ["학생A × 자기 결제한 active 수강권(요청 없음)", requestFor(TK.AG1), "allow"],
    ["학생A × 자기 ended 수강권", requestFor(TK.AE), "reject"],
    ["학생A × 자기 파일럿 무료 수강권(payment 없음)", requestFor(TK.A_PILOT), "reject"],
    ["학생A × requested 요청이 이미 있는 자기 수강권", requestFor(TK.A1), "reject"],
  ])("%s → %s", async (_, opCase, expected) => {
    expect(await attemptWrite(db, sa, opCase)).toBe(expected);
  });

  it.each<[string, string, OpCase]>([
    ["학생B", "학생A의 waiting_schedule 수강권", requestFor(TK.AG2)],
    ["학생C", "학생A의 waiting_schedule 수강권 (같은 트레이너의 다른 학생)", requestFor(TK.AG2)],
    ["학생A", "학생B(T2)의 active 수강권", requestFor(TK.B)],
  ])("%s × %s → 거부", async (actor, _, opCase) => {
    const id = { 학생A: U.SA, 학생B: U.SB, 학생C: U.SC }[actor] as string;
    expect(await attemptWrite(db, asUser(id), opCase)).toBe("reject");
  });

  it("학생A × 사유 없이 요청 → 허용, status는 requested다", async () => {
    const rows = await withActor(db, sa, async (tx) => {
      const inserted = await tx.query(
        `insert into public.refund_requests (ticket_id) values ($1)`,
        [TK.AG2],
      );
      expect(inserted.affectedRows).toBe(1);
      return (
        await tx.query<{ reason: string | null; status: string }>(
          `select reason, status from public.refund_requests where ticket_id = $1`,
          [TK.AG2],
        )
      ).rows;
    });
    expect(rows).toEqual([{ reason: null, status: "requested" }]);
  });

  it("학생A × status = processed로 요청 만들기 → 거부", async () => {
    expect(
      await attemptWrite(db, sa, {
        sql: `insert into public.refund_requests (ticket_id, reason, status)
              values ($1, '개인 사정', 'processed')`,
        params: [TK.AG2],
      }),
    ).toBe("reject");
  });

  it("학생A × processed 요청만 있던 수강권은 대기 요청 중복이 아니다 — 서버가 처리한 뒤 다시 요청 (팀장 결정 9)", async () => {
    // 서버가 RR.A를 processed로 바꾼 뒤 같은 수강권(TK.A1, 아직 active)에 다시 요청한다
    const processA: Setup = async (tx) => {
      await tx.exec("set local role service_role");
      await tx.query(`update public.refund_requests set status = 'processed' where id = $1`, [
        RR.A,
      ]);
      await tx.exec("reset role");
    };
    expect(await attemptWrite(db, sa, requestFor(TK.A1, processA))).toBe("allow");
  });

  it("서버 × 요청을 processed로 바꾸기 → 허용 (PAY-11)", async () => {
    expect(
      await attemptWrite(db, service, {
        sql: `update public.refund_requests set status = 'processed' where id = $1`,
        params: [RR.A],
      }),
    ).toBe("allow");
  });
});

// ===========================================================================
// refunds
// ===========================================================================

const insertRefund: OpCase = {
  sql: `insert into public.refunds
          (ticket_id, payment_id, refund_request_id, sessions_canceled, amount, processed_by, processed_at)
        values ($1, $2, $3, 3, 150000, $4, now())`,
  params: [TK.A1, PAY.A1, RR.A, U.T1],
};

describeRlsMatrix(
  {
    title: "#28 refunds 권한 — PAY-09, PAY-11, ADM-07",
    actors: ACTORS,
    cases: {
      // 학생C 수강권(TK.C1)의 환불
      "refunds:학생C 환불": {
        select: { sql: `select 1 from public.refunds where id = $1`, params: [REF.C] },
        update: {
          sql: `update public.refunds set amount = 1, sessions_canceled = 0 where id = $1`,
          params: [REF.C],
        },
        delete: { sql: `delete from public.refunds where id = $1`, params: [REF.C] },
      },
      "refunds:학생A 수강권에 새 환불": { insert: insertRefund },
    },
    rows: [
      // 역할      테이블                          select   insert   update   delete
      ["학생C", "refunds:학생C 환불", "allow", "-", "deny", "deny"],
      ["T1", "refunds:학생C 환불", "allow", "-", "deny", "deny"],
      ["운영자", "refunds:학생C 환불", "allow", "-", "deny", "deny"],
      ["T2", "refunds:학생C 환불", "deny", "-", "deny", "deny"],
      ["학생A", "refunds:학생C 환불", "deny", "-", "-", "-"],
      ["학생B", "refunds:학생C 환불", "deny", "-", "-", "-"],
      ["anon", "refunds:학생C 환불", "deny", "-", "deny", "deny"],

      ["학생A", "refunds:학생A 수강권에 새 환불", "-", "deny", "-", "-"],
      ["T1", "refunds:학생A 수강권에 새 환불", "-", "deny", "-", "-"],
      ["운영자", "refunds:학생A 수강권에 새 환불", "-", "deny", "-", "-"],
      ["anon", "refunds:학생A 수강권에 새 환불", "-", "deny", "-", "-"],
    ],
  },
  { db: getDb },
);

describe("#28 refunds는 서버가 쓴다 — PAY-11", () => {
  it("서버 × 환불 insert → 허용", async () => {
    expect(await attemptWrite(db, service, insertRefund)).toBe("allow");
  });

  it("서버 × 앱 요청 없는 환불(refund_request_id 없음) insert → 허용 (PAY-11)", async () => {
    expect(
      await attemptWrite(db, service, {
        sql: `insert into public.refunds
                (ticket_id, payment_id, refund_request_id, sessions_canceled, amount, processed_by, processed_at)
              values ($1, $2, null, 8, 240000, $3, now())`,
        params: [TK.AG2, PAY.AG2, U.T1],
      }),
    ).toBe("allow");
  });
});

// ===========================================================================
// fee_policies
// ===========================================================================

const NEW_POLICY = `insert into public.fee_policies (source, rate, effective_from)
                    values ('marketplace', 0.15, '2099-01-01')`;

describeRlsMatrix(
  {
    title: "#28 fee_policies 권한 — STL-03, ADM-07, 팀장 결정 10",
    actors: ACTORS,
    cases: {
      "fee_policies:trainer_link": {
        select: { sql: `select 1 from public.fee_policies where source = 'trainer_link'` },
        insert: { sql: NEW_POLICY },
        update: { sql: `update public.fee_policies set rate = 0.5 where source = 'trainer_link'` },
        delete: { sql: `delete from public.fee_policies where source = 'trainer_link'` },
      },
    },
    rows: [
      // 역할      테이블                      select   insert   update   delete
      ["운영자", "fee_policies:trainer_link", "allow", "deny", "deny", "deny"],
      ["T1", "fee_policies:trainer_link", "deny", "deny", "deny", "deny"],
      ["학생A", "fee_policies:trainer_link", "deny", "deny", "deny", "deny"],
      ["anon", "fee_policies:trainer_link", "deny", "deny", "deny", "deny"],
    ],
  },
  { db: getDb },
);

describe("#28 fee_policies는 서버가 쓰고 (source, effective_from)은 겹치지 않는다 — STL-03, erd 6장", () => {
  it("서버 × 새 수수료율 행 insert → 허용", async () => {
    expect(await attemptWrite(db, service, { sql: NEW_POLICY })).toBe("allow");
  });

  it("서버 × 이미 있는 (source, effective_from) 행 insert → 거부", async () => {
    expect(
      await attemptWrite(db, service, {
        sql: `insert into public.fee_policies (source, rate, effective_from)
              select source, 0.09, effective_from from public.fee_policies
              where source = 'trainer_link' limit 1`,
      }),
    ).toBe("reject");
  });

  it("서버 × 같은 source에 다른 effective_from insert → 허용 (짝)", async () => {
    expect(
      await attemptWrite(db, service, {
        sql: `insert into public.fee_policies (source, rate, effective_from)
              values ('trainer_link', 0.09, '2099-06-01')`,
      }),
    ).toBe("allow");
  });
});

// ===========================================================================
// 준비 작업 확인
// ===========================================================================

describe("#28 준비 작업이 의도한 상태를 만든다 (refunds) — PAY-10, AUTH-07", () => {
  const read = async <R>(sql: string, params: unknown[], setup?: Setup) =>
    withActor(
      db,
      service,
      async (tx) => (await tx.query<R>(sql, params)).rows,
      setup ? { setup } : {},
    );

  it("준비 데이터: 학생A 대기 수강권(TK.AG2)에는 요청이 없고, TK.A1에는 requested 요청이 있다", async () => {
    expect(
      await read(
        `select ticket_id, status from public.refund_requests where ticket_id = any($1::uuid[])`,
        [[TK.AG2, TK.A1]],
      ),
    ).toEqual([{ ticket_id: TK.A1, status: "requested" }]);
  });

  it("탈퇴 준비: 학생A의 users.status가 withdrawn이다", async () => {
    expect(
      await read(`select status from public.users where id = $1`, [U.SA], withdraw(U.SA)),
    ).toEqual([{ status: "withdrawn" }]);
  });

  it("준비 데이터: 끝난·파일럿 수강권의 상태", async () => {
    expect(
      await read(
        `select id, status, payment_id from public.tickets where id = any($1::uuid[]) order by id`,
        [[TK.AE, TK.A_PILOT]],
      ),
    ).toEqual([
      { id: TK.AE, status: "ended", payment_id: PAY.AE },
      { id: TK.A_PILOT, status: "waiting_schedule", payment_id: null },
    ]);
  });
});
