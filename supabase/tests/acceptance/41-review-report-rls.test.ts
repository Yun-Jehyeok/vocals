// 인수 테스트: 이슈 #41 묶음 6 — reviews, review_replies, blocks, reports, push_tokens, notifications 권한
// (QA가 개발 전에 쓴다. 개발은 고치지 않는다. 틀렸다고 보면 `[질문] 받는 역할: QA`)
//
// 준비 데이터와 역할은 41-fixture.ts.
// 쓰기 경로(팀장 결정 1): 후기 쓰기·고치기와 답글, 기기 토큰, 알림 만들기는 서버만. 클라이언트 직접은
//   작성자의 후기 지우기, 운영자의 후기 가리기(hidden), 차단하기, 신고하기, 운영자의 신고 처리, 자기 알림 read_at뿐
// 읽기(팀장 결정 2, 7): 후기·답글은 그 트레이너 프로필을 읽을 수 있는 사람(정지 트레이너 기준 포함), 가린 후기와
//   그 답글은 작성자·운영자만. 차단은 차단한 사람만, 신고는 신고한 사람·운영자만, 토큰·알림은 본인만
// 수정·삭제(팀장 결정 6): 가리기 되돌리기·답글 수정 삭제·차단 해제·신고 철회·알림 삭제 없음
// 신고 대상(팀장 결정 8, #38): 신고자가 읽을 수 있는 메시지·후기·다른 사용자만, 자기 것 불가. 권한 없는 insert
//   (남의 이름, 읽을 수 없는 대상, 없는 대상)는 대상의 관계와 상관없이 같은 코드 42501로 막힌다
// 권한(읽기, grant가 없는 쓰기)은 RLS 매트릭스(attempt)로, 값·관계에 따라 갈리는 쓰기는 attemptWrite로,
// 오류 코드가 갈리는지는 SQLSTATE를 그대로 돌려주는 outcome()으로 판정한다(#38).
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "../helpers/db.ts";
import { anon, asUser, queryAs, withActor } from "../helpers/db.ts";
import { attempt, attemptWrite, describeRlsMatrix } from "../helpers/rls-matrix.ts";
import type { Op, OpCase } from "../helpers/rls-matrix.ts";
import type { Setup } from "./41-fixture.ts";
import {
  BL,
  M,
  MISSING,
  N,
  PT,
  RP,
  RV,
  TK,
  U,
  createBundle6Db,
  makeupForSG,
  suspendT1,
  withdrawSA,
} from "./41-fixture.ts";

let db: PGlite;

beforeAll(async () => {
  db = await createBundle6Db();
});

afterAll(async () => {
  await db?.close();
});

const getDb = () => db;
const withSetup = (opCase: OpCase, setup?: Setup): OpCase =>
  setup ? { ...opCase, setup } : opCase;

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
type ActorName = keyof typeof ACTORS;

/**
 * actor로 쓰기를 시도하고 결과를 돌려준다. 항상 되돌린다. (#38)
 * 1행 이상 바뀌면 "허용", 0행이면 "0행", 오류면 SQLSTATE(예: "42501", "23514").
 */
async function outcome(actor: Actor, text: string, params: unknown[] = []): Promise<string> {
  try {
    const result = await queryAs(db, actor, text, params);
    return result.affectedRows > 0 ? "허용" : "0행";
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
    throw error;
  }
}

// ===========================================================================
// 시도 (OpCase)
// ===========================================================================

const selectReview = (id: string, setup?: Setup): OpCase =>
  withSetup({ sql: `select 1 from public.reviews where id = $1`, params: [id] }, setup);
const selectReply = (id: string, setup?: Setup): OpCase =>
  withSetup(
    { sql: `select 1 from public.review_replies where review_id = $1`, params: [id] },
    setup,
  );
const updateReview = (id: string, set: string, setup?: Setup): OpCase =>
  withSetup({ sql: `update public.reviews set ${set} where id = $1`, params: [id] }, setup);
const deleteReview = (id: string, setup?: Setup): OpCase =>
  withSetup({ sql: `delete from public.reviews where id = $1`, params: [id] }, setup);
/** 학생G가 보강 기록이 있는 TK.G에 후기를 직접 넣는 시도 (서버만 쓴다) */
const insertReviewSG: OpCase = {
  sql: `insert into public.reviews (trainer_id, student_id, ticket_id, body) values ($1, $2, $3, '묶음6 클라이언트 후기')`,
  params: [U.T1, U.SG, TK.G],
  setup: makeupForSG,
};

const selectBlock = (id: string): OpCase => ({
  sql: `select 1 from public.blocks where id = $1`,
  params: [id],
});
const insertBlock = (blocker: string, blocked: string, setup?: Setup): OpCase =>
  withSetup(
    {
      sql: `insert into public.blocks (blocker_id, blocked_id) values ($1, $2)`,
      params: [blocker, blocked],
    },
    setup,
  );

const selectReport = (id: string): OpCase => ({
  sql: `select 1 from public.reports where id = $1`,
  params: [id],
});
const reportInsertSql = `insert into public.reports (reporter_id, target_type, target_id, reason)
  values ($1, $2, $3, '묶음6 클라이언트 신고')`;
const insertReport = (
  reporter: string,
  targetType: "message" | "review" | "user",
  target: string,
  setup?: Setup,
): OpCase => withSetup({ sql: reportInsertSql, params: [reporter, targetType, target] }, setup);
const updateReport = (id: string, set: string): OpCase => ({
  sql: `update public.reports set ${set} where id = $1`,
  params: [id],
});

const selectToken = (id: string): OpCase => ({
  sql: `select 1 from public.push_tokens where id = $1`,
  params: [id],
});
const selectNotification = (id: string): OpCase => ({
  sql: `select 1 from public.notifications where id = $1`,
  params: [id],
});
const updateNotification = (id: string, set: string, setup?: Setup): OpCase =>
  withSetup({ sql: `update public.notifications set ${set} where id = $1`, params: [id] }, setup);

// ===========================================================================
// reviews · review_replies 읽기
// ===========================================================================

describeRlsMatrix(
  {
    title:
      "#41 reviews·review_replies 권한 — REV-02, REV-03, REV-04, REV-05, REV-06, ADM-02, ADM-04",
    actors: ACTORS,
    cases: {
      "reviews:RV1": {
        select: selectReview(RV.RV1),
        insert: insertReviewSG,
        update: updateReview(RV.RV1, `body = '묶음6 클라이언트가 고침'`),
      },
      "reviews:RV1 — T1 정지": { select: selectReview(RV.RV1, suspendT1) },
      "reviews:RV2(가림)": { select: selectReview(RV.RV2) },
      "review_replies:RV1 답글": {
        select: selectReply(RV.RV1),
        insert: {
          sql: `insert into public.review_replies (review_id, body) values ($1, '묶음6 클라이언트 답글')`,
          params: [RV.RV1],
          setup: async (tx) => {
            await tx.exec("set local role service_role");
            await tx.query(`delete from public.review_replies where review_id = $1`, [RV.RV1]);
            await tx.exec("reset role");
          },
        },
        update: {
          sql: `update public.review_replies set body = '묶음6 고친 답글' where review_id = $1`,
          params: [RV.RV1],
        },
        delete: {
          sql: `delete from public.review_replies where review_id = $1`,
          params: [RV.RV1],
        },
      },
      "review_replies:RV1 답글 — T1 정지": { select: selectReply(RV.RV1, suspendT1) },
      "review_replies:RV2(가림) 답글": { select: selectReply(RV.RV2) },
    },
    rows: [
      // 역할      테이블                                   select   insert   update   delete
      ["anon", "reviews:RV1", "allow", "deny", "deny", "-"],
      ["anon", "reviews:RV1 — T1 정지", "deny", "-", "-", "-"],
      ["anon", "reviews:RV2(가림)", "deny", "-", "-", "-"],
      ["anon", "review_replies:RV1 답글", "allow", "deny", "deny", "deny"],
      ["anon", "review_replies:RV1 답글 — T1 정지", "deny", "-", "-", "-"],
      ["anon", "review_replies:RV2(가림) 답글", "deny", "-", "-", "-"],

      ["학생A", "reviews:RV1", "allow", "-", "deny", "-"],
      ["학생A", "reviews:RV1 — T1 정지", "allow", "-", "-", "-"],
      ["학생A", "reviews:RV2(가림)", "deny", "-", "-", "-"],
      ["학생A", "review_replies:RV1 답글", "allow", "-", "deny", "deny"],
      ["학생A", "review_replies:RV1 답글 — T1 정지", "allow", "-", "-", "-"],
      ["학생A", "review_replies:RV2(가림) 답글", "deny", "-", "-", "-"],

      ["학생G", "reviews:RV1", "allow", "deny", "-", "-"],
      ["학생G", "reviews:RV1 — T1 정지", "allow", "-", "-", "-"],
      ["학생G", "reviews:RV2(가림)", "deny", "-", "-", "-"],

      ["학생C", "reviews:RV1 — T1 정지", "allow", "-", "-", "-"],
      ["학생C", "reviews:RV2(가림)", "allow", "-", "-", "-"],
      ["학생C", "review_replies:RV1 답글 — T1 정지", "allow", "-", "-", "-"],
      ["학생C", "review_replies:RV2(가림) 답글", "allow", "-", "-", "-"],

      ["학생B", "reviews:RV1", "allow", "-", "deny", "-"],
      ["학생B", "reviews:RV1 — T1 정지", "deny", "-", "-", "-"],
      ["학생B", "reviews:RV2(가림)", "deny", "-", "-", "-"],
      ["학생B", "review_replies:RV1 답글", "allow", "-", "-", "-"],
      ["학생B", "review_replies:RV1 답글 — T1 정지", "deny", "-", "-", "-"],
      ["학생B", "review_replies:RV2(가림) 답글", "deny", "-", "-", "-"],

      ["T1", "reviews:RV1", "allow", "deny", "deny", "-"],
      ["T1", "reviews:RV1 — T1 정지", "allow", "-", "-", "-"],
      ["T1", "reviews:RV2(가림)", "deny", "-", "-", "-"],
      ["T1", "review_replies:RV1 답글", "allow", "deny", "deny", "deny"],
      ["T1", "review_replies:RV1 답글 — T1 정지", "allow", "-", "-", "-"],
      ["T1", "review_replies:RV2(가림) 답글", "deny", "-", "-", "-"],

      ["T2", "reviews:RV1", "allow", "-", "-", "-"],
      ["T2", "reviews:RV1 — T1 정지", "deny", "-", "-", "-"],
      ["T2", "reviews:RV2(가림)", "deny", "-", "-", "-"],
      ["T2", "review_replies:RV1 답글 — T1 정지", "deny", "-", "-", "-"],

      ["운영자", "reviews:RV1", "allow", "deny", "deny", "-"],
      ["운영자", "reviews:RV1 — T1 정지", "allow", "-", "-", "-"],
      ["운영자", "reviews:RV2(가림)", "allow", "-", "-", "-"],
      ["운영자", "review_replies:RV1 답글", "allow", "deny", "deny", "deny"],
      ["운영자", "review_replies:RV1 답글 — T1 정지", "allow", "-", "-", "-"],
      ["운영자", "review_replies:RV2(가림) 답글", "allow", "-", "-", "-"],
    ],
  },
  { db: getDb },
);

// ===========================================================================
// reviews 쓰기 (값에 따라 갈리므로 attemptWrite, 허용 짝과 함께)
// ===========================================================================

describe("#41 후기 지우기·가리기 — REV-04, REV-05, ADM-04, AUTH-07 (팀장 결정 1, 6)", () => {
  it.each<[string, ActorName, OpCase, "allow" | "reject"]>([
    ["REV-04: 학생A는 자기 후기 RV1을 지운다", "학생A", deleteReview(RV.RV1), "allow"],
    ["REV-04: T1(받은 트레이너)은 RV1을 지우지 못한다", "T1", deleteReview(RV.RV1), "reject"],
    ["REV-04: 학생B(다른 학생)는 RV1을 지우지 못한다", "학생B", deleteReview(RV.RV1), "reject"],
    ["REV-04: 운영자는 RV1을 지우지 못한다", "운영자", deleteReview(RV.RV1), "reject"],
    [
      "AUTH-07: 탈퇴 학생A는 자기 후기 RV1을 지우지 못한다",
      "학생A",
      deleteReview(RV.RV1, withdrawSA),
      "reject",
    ],
    [
      "REV-04: 학생A는 자기 후기 body를 직접 고치지 못한다(서버만, NFR-02)",
      "학생A",
      updateReview(RV.RV1, `body = '묶음6 직접 고침'`),
      "reject",
    ],
    ["REV-05: 운영자는 RV1을 가린다", "운영자", updateReview(RV.RV1, `hidden = true`), "allow"],
    [
      "REV-05: 운영자는 가린 RV2를 되돌리지 못한다",
      "운영자",
      updateReview(RV.RV2, `hidden = false`),
      "reject",
    ],
    [
      "ADM-04: 운영자는 후기 body를 고치지 못한다",
      "운영자",
      updateReview(RV.RV1, `body = '묶음6 운영자가 고침'`),
      "reject",
    ],
    [
      "ADM-04: 운영자는 가리면서 body를 함께 고치지 못한다",
      "운영자",
      updateReview(RV.RV1, `hidden = true, body = '묶음6 운영자가 고침'`),
      "reject",
    ],
    [
      "REV-05: T1은 RV1의 hidden을 고치지 못한다",
      "T1",
      updateReview(RV.RV1, `hidden = true`),
      "reject",
    ],
    [
      "REV-05: 학생A는 자기 후기의 hidden을 고치지 못한다",
      "학생A",
      updateReview(RV.RV1, `hidden = true`),
      "reject",
    ],
    [
      "REV-05: 학생C는 자기 가린 후기 RV2를 되돌리지 못한다",
      "학생C",
      updateReview(RV.RV2, `hidden = false`),
      "reject",
    ],
  ])("%s", async (_, actor, opCase, expected) => {
    expect(await attemptWrite(db, ACTORS[actor] as Actor, opCase)).toBe(expected);
  });

  it("REV-04: 학생A가 RV1을 지우면 답글도 지워진다", async () => {
    const remaining = await withActor(db, ACTORS.학생A, async (tx) => {
      const deleted = await tx.query(`delete from public.reviews where id = $1`, [RV.RV1]);
      expect(deleted.affectedRows).toBe(1);
      await tx.exec("reset role");
      const { rows } = await tx.query(`select 1 from public.review_replies where review_id = $1`, [
        RV.RV1,
      ]);
      return rows.length;
    });
    expect(remaining).toBe(0);
  });
});

// ===========================================================================
// blocks
// ===========================================================================

describeRlsMatrix(
  {
    title: "#41 blocks 권한 — CHAT-07, DM-05",
    actors: ACTORS,
    cases: {
      "blocks:학생G → 학생H": {
        select: selectBlock(BL.G_H),
        update: {
          sql: `update public.blocks set blocked_id = $2 where id = $1`,
          params: [BL.G_H, U.SA],
        },
        delete: { sql: `delete from public.blocks where id = $1`, params: [BL.G_H] },
      },
    },
    rows: [
      // 역할      테이블                   select   insert   update   delete
      ["학생G", "blocks:학생G → 학생H", "allow", "-", "deny", "deny"],
      ["학생H", "blocks:학생G → 학생H", "deny", "-", "deny", "deny"],
      ["운영자", "blocks:학생G → 학생H", "deny", "-", "deny", "deny"],
      ["T1", "blocks:학생G → 학생H", "deny", "-", "-", "-"],
      ["학생A", "blocks:학생G → 학생H", "deny", "-", "-", "-"],
      ["anon", "blocks:학생G → 학생H", "deny", "-", "deny", "deny"],
    ],
  },
  { db: getDb },
);

describe("#41 차단하기 — CHAT-07, DM-05, AUTH-07 (팀장 결정 1, 6)", () => {
  it.each<[string, ActorName, OpCase, "allow" | "reject"]>([
    ["CHAT-07: 학생A는 학생B를 차단한다", "학생A", insertBlock(U.SA, U.SB), "allow"],
    ["DM-05: T1은 학생B를 차단한다", "T1", insertBlock(U.T1, U.SB), "allow"],
    [
      "CHAT-07: 학생A는 학생G 이름으로 차단하지 못한다(blocker_id는 자기 자신)",
      "학생A",
      insertBlock(U.SG, U.SB),
      "reject",
    ],
    ["CHAT-07: anon은 차단하지 못한다", "anon", insertBlock(U.SA, U.SB), "reject"],
    [
      "AUTH-07: 탈퇴 학생A는 차단하지 못한다",
      "학생A",
      insertBlock(U.SA, U.SB, withdrawSA),
      "reject",
    ],
    [
      "CHAT-07: 학생G는 차단을 풀지 못한다(차단 해제 없음)",
      "학생G",
      { sql: `delete from public.blocks where id = $1`, params: [BL.G_H] },
      "reject",
    ],
    [
      "DM-05: 학생G는 차단 대상을 바꾸지 못한다",
      "학생G",
      { sql: `update public.blocks set blocked_id = $2 where id = $1`, params: [BL.G_H, U.SA] },
      "reject",
    ],
  ])("%s", async (_, actor, opCase, expected) => {
    expect(await attemptWrite(db, ACTORS[actor] as Actor, opCase)).toBe(expected);
  });
});

// ===========================================================================
// reports
// ===========================================================================

describeRlsMatrix(
  {
    title: "#41 reports 권한 — CHAT-07, DM-05, REV-05, ADM-04",
    actors: ACTORS,
    cases: {
      "reports:학생H의 DM2 메시지 신고": {
        select: selectReport(RP.DM2_MSG),
        delete: { sql: `delete from public.reports where id = $1`, params: [RP.DM2_MSG] },
      },
      "reports:학생A의 방1 메시지 신고": { select: selectReport(RP.R1_MSG) },
      "reports:학생B의 RV1 신고(resolved)": { select: selectReport(RP.RV1) },
      "reports:학생G의 사용자 학생H 신고": { select: selectReport(RP.USER_H) },
    },
    rows: [
      // 역할      테이블                                       select   insert   update   delete
      ["학생H", "reports:학생H의 DM2 메시지 신고", "allow", "-", "-", "deny"],
      ["학생H", "reports:학생G의 사용자 학생H 신고", "deny", "-", "-", "-"],
      ["학생G", "reports:학생H의 DM2 메시지 신고", "deny", "-", "-", "deny"],
      ["학생G", "reports:학생A의 방1 메시지 신고", "deny", "-", "-", "-"],
      ["학생G", "reports:학생G의 사용자 학생H 신고", "allow", "-", "-", "-"],
      ["학생A", "reports:학생A의 방1 메시지 신고", "allow", "-", "-", "-"],
      ["학생A", "reports:학생H의 DM2 메시지 신고", "deny", "-", "-", "-"],
      ["학생A", "reports:학생B의 RV1 신고(resolved)", "deny", "-", "-", "-"],
      ["학생B", "reports:학생B의 RV1 신고(resolved)", "allow", "-", "-", "-"],
      ["T1", "reports:학생A의 방1 메시지 신고", "deny", "-", "-", "-"],
      ["T1", "reports:학생B의 RV1 신고(resolved)", "deny", "-", "-", "-"],
      ["T1", "reports:학생H의 DM2 메시지 신고", "deny", "-", "-", "deny"],
      ["anon", "reports:학생H의 DM2 메시지 신고", "deny", "-", "-", "deny"],
      ["운영자", "reports:학생H의 DM2 메시지 신고", "allow", "-", "-", "deny"],
      ["운영자", "reports:학생A의 방1 메시지 신고", "allow", "-", "-", "-"],
      ["운영자", "reports:학생B의 RV1 신고(resolved)", "allow", "-", "-", "-"],
      ["운영자", "reports:학생G의 사용자 학생H 신고", "allow", "-", "-", "-"],
    ],
  },
  { db: getDb },
);

describe("#41 신고하기·신고 처리 — CHAT-07, DM-05, DM-07, REV-05, ADM-04, AUTH-07 (팀장 결정 1, 6, 8)", () => {
  it.each<[string, ActorName, OpCase, "allow" | "reject"]>([
    [
      "CHAT-07: 학생A는 읽을 수 있는 방1의 학생H 메시지를 신고한다",
      "학생A",
      insertReport(U.SA, "message", M.R1_H),
      "allow",
    ],
    [
      "DM-05: 학생B는 읽을 수 있는 DM1의 T1 메시지를 신고한다",
      "학생B",
      insertReport(U.SB, "message", M.DM1_T),
      "allow",
    ],
    [
      "REV-05: 학생B는 RV1을 다시 신고한다(앞 신고는 resolved)",
      "학생B",
      insertReport(U.SB, "review", RV.RV1),
      "allow",
    ],
    [
      "REV-05: T1은 받은 후기 RV1을 신고한다(T-24)",
      "T1",
      insertReport(U.T1, "review", RV.RV1),
      "allow",
    ],
    [
      "DM-05: 학생A는 다른 사용자 학생B를 신고한다",
      "학생A",
      insertReport(U.SA, "user", U.SB),
      "allow",
    ],
    [
      "CHAT-07: 학생A는 방1의 학생G 메시지에 open 신고를 하나 더 내지 못한다",
      "학생A",
      insertReport(U.SA, "message", M.R1_G),
      "reject",
    ],
    [
      "CHAT-07: 학생A는 자기 메시지를 신고하지 못한다",
      "학생A",
      insertReport(U.SA, "message", M.R1_A),
      "reject",
    ],
    [
      "REV-05: 학생A는 자기 후기를 신고하지 못한다",
      "학생A",
      insertReport(U.SA, "review", RV.RV1),
      "reject",
    ],
    [
      "DM-05: 학생A는 자기 자신을 신고하지 못한다",
      "학생A",
      insertReport(U.SA, "user", U.SA),
      "reject",
    ],
    ["REV-05: anon은 신고하지 못한다", "anon", insertReport(U.SA, "review", RV.RV1), "reject"],
    [
      "AUTH-07: 탈퇴 학생A는 신고하지 못한다",
      "학생A",
      insertReport(U.SA, "user", U.SB, withdrawSA),
      "reject",
    ],
    [
      "ADM-04: 학생A는 resolved 상태로 신고를 넣지 못한다",
      "학생A",
      {
        sql: `insert into public.reports (reporter_id, target_type, target_id, reason, status, handled_by)
              values ($1, 'user', $2, '묶음6 처리된 척', 'resolved', $3)`,
        params: [U.SA, U.SB, U.ADMIN],
      },
      "reject",
    ],
    [
      "ADM-04: 학생A는 handled_by를 채워 신고를 넣지 못한다",
      "학생A",
      {
        sql: `insert into public.reports (reporter_id, target_type, target_id, reason, status, handled_by)
              values ($1, 'user', $2, '묶음6 처리자 지정', 'open', $3)`,
        params: [U.SA, U.SB, U.ADMIN],
      },
      "reject",
    ],

    [
      "ADM-04: 운영자는 open 신고를 resolved로 바꾸고 handled_by에 자기 자신을 넣는다",
      "운영자",
      updateReport(RP.DM2_MSG, `status = 'resolved', handled_by = '${U.ADMIN}'`),
      "allow",
    ],
    [
      "ADM-04: 운영자는 handled_by를 다른 사람으로 넣지 못한다",
      "운영자",
      updateReport(RP.DM2_MSG, `status = 'resolved', handled_by = '${U.T1}'`),
      "reject",
    ],
    [
      "ADM-04: 운영자는 handled_by 없이 resolved로 바꾸지 못한다",
      "운영자",
      updateReport(RP.DM2_MSG, `status = 'resolved'`),
      "reject",
    ],
    [
      "ADM-04: 신고자 학생H는 자기 신고를 resolved로 바꾸지 못한다",
      "학생H",
      updateReport(RP.DM2_MSG, `status = 'resolved', handled_by = '${U.SH}'`),
      "reject",
    ],
    [
      "ADM-04: 신고자 학생H는 자기 신고 사유를 고치지 못한다",
      "학생H",
      updateReport(RP.DM2_MSG, `reason = '묶음6 고친 사유'`),
      "reject",
    ],
    [
      "ADM-04: T1은 방1 메시지 신고를 처리하지 못한다",
      "T1",
      updateReport(RP.R1_MSG, `status = 'resolved', handled_by = '${U.T1}'`),
      "reject",
    ],
    [
      "ADM-04: 신고자 학생H는 자기 신고를 지우지 못한다(철회 없음)",
      "학생H",
      { sql: `delete from public.reports where id = $1`, params: [RP.DM2_MSG] },
      "reject",
    ],
  ])("%s", async (_, actor, opCase, expected) => {
    expect(await attemptWrite(db, ACTORS[actor] as Actor, opCase)).toBe(expected);
  });
});

// ===========================================================================
// #38: 권한 없는 insert는 대상의 관계와 관계없이 같은 코드(42501)
// ===========================================================================

describe("#41 신고: 읽을 수 없는 대상과 없는 대상은 같은 오류 코드 42501 — CHAT-07, REV-05, #38 (팀장 결정 8)", () => {
  it.each<[string, ActorName, string, "message" | "review" | "user", string]>([
    ["CHAT-07: 학생A가 DM2의 메시지(읽을 수 없음)", "학생A", U.SA, "message", M.DM2_G],
    ["CHAT-07: 학생C(나간 사람)가 방1의 메시지", "학생C", U.SC, "message", M.R1_A],
    ["CHAT-07: 학생B가 방1의 메시지(참여하지 않음)", "학생B", U.SB, "message", M.R1_A],
    ["REV-05: 학생B가 가린 후기 RV2", "학생B", U.SB, "review", RV.RV2],
    ["CHAT-07: 학생A가 없는 메시지", "학생A", U.SA, "message", MISSING],
    ["REV-05: 학생A가 없는 후기", "학생A", U.SA, "review", MISSING],
    ["DM-05: 학생A가 없는 사용자", "학생A", U.SA, "user", MISSING],
  ])("%s → 42501", async (_, actor, reporter, targetType, target) => {
    expect(await outcome(ACTORS[actor], reportInsertSql, [reporter, targetType, target])).toBe(
      "42501",
    );
  });

  it("CHAT-07: 짝 — 학생A가 읽을 수 있는 방1 메시지는 허용", async () => {
    expect(await outcome(ACTORS.학생A, reportInsertSql, [U.SA, "message", M.R1_H])).toBe("허용");
  });

  it("REV-05: 짝 — 학생B가 읽을 수 있는 RV1(앞 신고 resolved)은 허용", async () => {
    expect(await outcome(ACTORS.학생B, reportInsertSql, [U.SB, "review", RV.RV1])).toBe("허용");
  });

  it.each<[string, string, "message" | "review" | "user", string]>([
    ["읽을 수 있는 방1 메시지", U.SA, "message", M.R1_H],
    ["자기(학생A) 메시지", U.SA, "message", M.R1_A],
    ["이미 open 신고가 있는 방1 메시지(학생A 이름)", U.SA, "message", M.R1_G],
    ["읽을 수 없는 DM2 메시지", U.SA, "message", M.DM2_G],
    ["없는 메시지", U.SA, "message", MISSING],
    ["자기(학생A) 자신", U.SA, "user", U.SA],
  ])(
    "CHAT-07: 학생B가 학생A 이름으로 신고 — %s → 42501",
    async (_, reporter, targetType, target) => {
      expect(await outcome(ACTORS.학생B, reportInsertSql, [reporter, targetType, target])).toBe(
        "42501",
      );
    },
  );
});

describe("#41 차단: 남의 이름으로 차단은 대상과 관계없이 42501 — CHAT-07, DM-05, #38", () => {
  const blockSql = `insert into public.blocks (blocker_id, blocked_id) values ($1, $2)`;

  it.each<[string, string, string]>([
    ["학생G 이름으로 학생A 차단", U.SG, U.SA],
    ["학생G 이름으로 이미 차단한 학생H", U.SG, U.SH],
    ["학생G 이름으로 학생G 자신", U.SG, U.SG],
    ["학생G 이름으로 없는 사용자", U.SG, MISSING],
  ])("DM-05: 학생B가 %s → 42501", async (_, blocker, blocked) => {
    expect(await outcome(ACTORS.학생B, blockSql, [blocker, blocked])).toBe("42501");
  });

  it("CHAT-07: 짝 — 학생B가 자기 이름으로 학생A를 차단하면 허용", async () => {
    expect(await outcome(ACTORS.학생B, blockSql, [U.SB, U.SA])).toBe("허용");
  });
});

// ===========================================================================
// push_tokens · notifications
// ===========================================================================

describeRlsMatrix(
  {
    title: "#41 push_tokens·notifications 권한 — NOTI-01, NOTI-02, C-06",
    actors: ACTORS,
    cases: {
      "push_tokens:T1 ios": {
        select: selectToken(PT.T1_IOS),
        insert: {
          sql: `insert into public.push_tokens (user_id, token, platform) values ($1, 'b6-client-token', 'ios')`,
          params: [U.T1],
        },
        update: {
          sql: `update public.push_tokens set token = 'b6-client-changed' where id = $1`,
          params: [PT.T1_IOS],
        },
        delete: { sql: `delete from public.push_tokens where id = $1`, params: [PT.T1_IOS] },
      },
      "push_tokens:학생A android": { select: selectToken(PT.SA_ANDROID) },
      "notifications:학생A 안 읽음": {
        select: selectNotification(N.SA_UNREAD),
        insert: {
          sql: `insert into public.notifications (user_id, type, payload) values ($1, 'b6_client', '{}')`,
          params: [U.SA],
        },
        delete: { sql: `delete from public.notifications where id = $1`, params: [N.SA_UNREAD] },
      },
      "notifications:T1 안 읽음": { select: selectNotification(N.T1_UNREAD) },
    },
    rows: [
      // 역할      테이블                          select   insert   update   delete
      ["T1", "push_tokens:T1 ios", "allow", "deny", "deny", "deny"],
      ["T1", "push_tokens:학생A android", "deny", "-", "-", "-"],
      ["학생A", "push_tokens:T1 ios", "deny", "-", "deny", "deny"],
      ["학생A", "push_tokens:학생A android", "allow", "-", "-", "-"],
      ["T2", "push_tokens:T1 ios", "deny", "-", "-", "-"],
      ["운영자", "push_tokens:T1 ios", "deny", "deny", "deny", "deny"],
      ["anon", "push_tokens:T1 ios", "deny", "deny", "deny", "deny"],

      ["학생A", "notifications:학생A 안 읽음", "allow", "deny", "-", "deny"],
      ["학생A", "notifications:T1 안 읽음", "deny", "-", "-", "-"],
      ["T1", "notifications:T1 안 읽음", "allow", "-", "-", "-"],
      ["T1", "notifications:학생A 안 읽음", "deny", "deny", "-", "deny"],
      ["학생B", "notifications:학생A 안 읽음", "deny", "-", "-", "-"],
      ["운영자", "notifications:학생A 안 읽음", "deny", "deny", "-", "deny"],
      ["anon", "notifications:학생A 안 읽음", "deny", "deny", "-", "deny"],
    ],
  },
  { db: getDb },
);

describe("#41 알림 읽음 — NOTI-02, C-06, AUTH-07 (팀장 결정 1, 6)", () => {
  it.each<[string, ActorName, OpCase, "allow" | "reject"]>([
    [
      "C-06: 학생A는 안 읽은 자기 알림에 read_at을 채운다",
      "학생A",
      updateNotification(N.SA_UNREAD, `read_at = now()`),
      "allow",
    ],
    [
      "NOTI-02: 학생A는 이미 읽은 알림의 read_at을 다시 쓰지 못한다",
      "학생A",
      updateNotification(N.SA_READ, `read_at = now()`),
      "reject",
    ],
    [
      "NOTI-02: 학생A는 읽은 알림을 안 읽음(read_at 비우기)으로 되돌리지 못한다",
      "학생A",
      updateNotification(N.SA_READ, `read_at = null`),
      "reject",
    ],
    [
      "NOTI-02: 학생A는 자기 알림의 type을 고치지 못한다",
      "학생A",
      updateNotification(N.SA_UNREAD, `type = 'b6_changed'`),
      "reject",
    ],
    [
      "NOTI-02: 학생A는 자기 알림의 payload를 고치지 못한다",
      "학생A",
      updateNotification(N.SA_UNREAD, `payload = '{"screen": "X"}'`),
      "reject",
    ],
    [
      "NOTI-02: 학생A는 읽으면서 payload를 함께 고치지 못한다",
      "학생A",
      updateNotification(N.SA_UNREAD, `read_at = now(), payload = '{"screen": "X"}'`),
      "reject",
    ],
    [
      "NOTI-02: 학생A는 T1의 알림을 읽음 처리하지 못한다",
      "학생A",
      updateNotification(N.T1_UNREAD, `read_at = now()`),
      "reject",
    ],
    [
      "NOTI-02: 운영자는 학생A의 알림을 읽음 처리하지 못한다",
      "운영자",
      updateNotification(N.SA_UNREAD, `read_at = now()`),
      "reject",
    ],
    [
      "AUTH-07: 탈퇴 학생A는 알림을 읽음 처리하지 못한다",
      "학생A",
      updateNotification(N.SA_UNREAD, `read_at = now()`, withdrawSA),
      "reject",
    ],
  ])("%s", async (_, actor, opCase, expected) => {
    expect(await attemptWrite(db, ACTORS[actor] as Actor, opCase)).toBe(expected);
  });
});

// ===========================================================================
// 요구사항 ID를 넣은 대표 칸 (매트릭스 title은 요구사항 추적이 세지 않는다)
// ===========================================================================

describe("#41 후기·차단·신고·알림 권한 대표 칸 — REV-02, REV-03, REV-05, REV-06, CHAT-07, DM-05, ADM-02, ADM-04, NOTI-01, NOTI-02", () => {
  it.each<[string, ActorName, Op, OpCase, "allow" | "deny"]>([
    ["REV-03: anon은 RV1을 읽는다", "anon", "select", selectReview(RV.RV1), "allow"],
    ["REV-06: anon은 RV1의 답글을 읽는다", "anon", "select", selectReply(RV.RV1), "allow"],
    [
      "ADM-02: anon은 정지 T1의 후기를 읽지 못한다",
      "anon",
      "select",
      selectReview(RV.RV1, suspendT1),
      "deny",
    ],
    [
      "ADM-02: 학생B는 정지 T1의 답글을 읽지 못한다",
      "학생B",
      "select",
      selectReply(RV.RV1, suspendT1),
      "deny",
    ],
    [
      "ADM-02: 학생A(수강 관계)는 정지 T1의 후기를 읽는다",
      "학생A",
      "select",
      selectReview(RV.RV1, suspendT1),
      "allow",
    ],
    [
      "ADM-02: 정지 T1 본인은 자기 후기를 읽는다",
      "T1",
      "select",
      selectReview(RV.RV1, suspendT1),
      "allow",
    ],
    ["REV-05: 학생C(작성자)는 가린 RV2를 읽는다", "학생C", "select", selectReview(RV.RV2), "allow"],
    ["REV-05: T1은 가린 RV2를 읽지 못한다", "T1", "select", selectReview(RV.RV2), "deny"],
    ["ADM-04: 운영자는 가린 RV2를 읽는다", "운영자", "select", selectReview(RV.RV2), "allow"],
    ["REV-05: anon은 가린 RV2의 답글을 읽지 못한다", "anon", "select", selectReply(RV.RV2), "deny"],
    ["REV-02: 학생G는 후기를 직접 넣지 못한다(서버만)", "학생G", "insert", insertReviewSG, "deny"],
    [
      "REV-06: T1은 답글을 고치지 못한다",
      "T1",
      "update",
      {
        sql: `update public.review_replies set body = '묶음6 고친 답글' where review_id = $1`,
        params: [RV.RV1],
      },
      "deny",
    ],
    [
      "REV-06: T1은 답글을 지우지 못한다",
      "T1",
      "delete",
      { sql: `delete from public.review_replies where review_id = $1`, params: [RV.RV1] },
      "deny",
    ],
    ["CHAT-07: 학생G는 자기 차단 줄을 읽는다", "학생G", "select", selectBlock(BL.G_H), "allow"],
    [
      "CHAT-07: 학생H(차단당한 사람)는 차단 줄을 읽지 못한다",
      "학생H",
      "select",
      selectBlock(BL.G_H),
      "deny",
    ],
    ["DM-05: 운영자는 차단 줄을 읽지 못한다", "운영자", "select", selectBlock(BL.G_H), "deny"],
    [
      "ADM-04: 신고된 학생G는 자기에 대한 신고를 읽지 못한다",
      "학생G",
      "select",
      selectReport(RP.DM2_MSG),
      "deny",
    ],
    [
      "ADM-04: T1은 자기 후기에 대한 신고를 읽지 못한다",
      "T1",
      "select",
      selectReport(RP.RV1),
      "deny",
    ],
    ["ADM-04: 운영자는 신고를 읽는다", "운영자", "select", selectReport(RP.USER_H), "allow"],
    ["NOTI-01: T1은 자기 기기 토큰을 읽는다", "T1", "select", selectToken(PT.T1_IOS), "allow"],
    [
      "NOTI-01: 학생A는 T1의 기기 토큰을 읽지 못한다",
      "학생A",
      "select",
      selectToken(PT.T1_IOS),
      "deny",
    ],
    [
      "NOTI-01: T1은 기기 토큰을 직접 등록하지 못한다(서버만)",
      "T1",
      "insert",
      {
        sql: `insert into public.push_tokens (user_id, token, platform) values ($1, 'b6-client-token', 'ios')`,
        params: [U.T1],
      },
      "deny",
    ],
    [
      "NOTI-02: 학생A는 자기 알림을 읽는다",
      "학생A",
      "select",
      selectNotification(N.SA_UNREAD),
      "allow",
    ],
    [
      "NOTI-02: 운영자는 남의 알림을 읽지 못한다",
      "운영자",
      "select",
      selectNotification(N.SA_UNREAD),
      "deny",
    ],
    [
      "NOTI-02: 학생A는 자기 알림을 지우지 못한다",
      "학생A",
      "delete",
      { sql: `delete from public.notifications where id = $1`, params: [N.SA_UNREAD] },
      "deny",
    ],
  ])("%s", async (_, actor, op, opCase, expected) => {
    expect(await attempt(db, ACTORS[actor] as Actor, op, opCase)).toBe(expected);
  });
});
