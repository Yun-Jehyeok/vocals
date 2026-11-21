// 인수 테스트: 이슈 #41 묶음 6 — 값·관계 DB 제약(서버 쓰기에도 걸린다, 팀장 결정 4)
// (QA가 개발 전에 쓴다. 개발은 고치지 않는다. 틀렸다고 보면 `[질문] 받는 역할: QA`)
//
// 준비 데이터와 역할은 41-fixture.ts. 값 검사는 attemptWrite(제약·트리거 거부도 거부)로 판정하고,
// 거부마다 허용되는 짝(바른 값)을 둔다. 막는 방법(check, unique, 트리거)은 개발이 고른다.
// 테스트로 쓰지 않는 것:
//   - "답글은 그 후기의 트레이너가 아닌 사람이 쓰면 서버 insert도 실패한다"(REV-06): review_replies에 쓴 사람
//     컬럼이 없고 서버(service_role)에는 auth.uid()가 없어 DB가 쓴 사람을 알 수 없다. [질문] 받는 역할: 기획으로 올렸다.
//   - "1:1 대화를 열 수 있는 사이"와 차단 판정(DM-01~03, DM-05): 서버 함수가 판정한다(팀장 결정 4, erd 7장)
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { queryAs, service } from "../helpers/db.ts";
import { attemptWrite } from "../helpers/rls-matrix.ts";
import type { OpCase } from "../helpers/rls-matrix.ts";
import type { Setup } from "./41-fixture.ts";
import {
  BL,
  JOINED,
  M,
  NEW,
  ROOM,
  RP,
  RV,
  TK,
  U,
  absentForSB,
  createBundle6Db,
  directRoomSASG,
  directRoomSBT1Again,
  makeupForSG,
  preCanceledForSB,
  presentForSB,
  removeSGFromR1,
  reviewForSG,
  waitingTicketForSC,
} from "./41-fixture.ts";
import { SEED } from "../helpers/seed-ids.ts";

let db: PGlite;

beforeAll(async () => {
  db = await createBundle6Db();
});

afterAll(async () => {
  await db?.close();
});

const sql = (text: string, setup?: Setup): OpCase => ({ sql: text, ...(setup ? { setup } : {}) });
type Expected = "allow" | "reject";
const serverCases = (cases: [string, OpCase, Expected][]) =>
  it.each(cases)("서버 × %s → %s", async (_, opCase, expected) => {
    expect(await attemptWrite(db, service, opCase)).toBe(expected);
  });

// ===========================================================================
// chat_rooms
// ===========================================================================

describe("#41 chat_rooms 값 검사 — CHAT-01, DM-01 (팀장 결정 4)", () => {
  serverCases([
    [
      "CHAT-01: T1의 두 번째 단체 채팅방",
      sql(`insert into public.chat_rooms (type, trainer_id) values ('group', '${U.T1}')`),
      "reject",
    ],
    [
      "CHAT-01: 단체 채팅방이 없는 트레이너(seed 승인 트레이너)의 단체 채팅방",
      sql(
        `insert into public.chat_rooms (type, trainer_id) values ('group', '${SEED.trainerApproved}')`,
      ),
      "allow",
    ],
    [
      "CHAT-01: trainer_id가 없는 단체 채팅방",
      sql(`insert into public.chat_rooms (type, trainer_id) values ('group', null)`),
      "reject",
    ],
    [
      "DM-01: trainer_id가 있는 1:1 대화",
      sql(`insert into public.chat_rooms (type, trainer_id) values ('direct', '${U.T1}')`),
      "reject",
    ],
    [
      "DM-01: trainer_id가 없는 1:1 대화",
      sql(`insert into public.chat_rooms (type, trainer_id) values ('direct', null)`),
      "allow",
    ],
  ]);
});

// ===========================================================================
// chat_members
// ===========================================================================

const memberInsert = (room: string, user: string, role: "admin" | "member", setup?: Setup) =>
  sql(
    `insert into public.chat_members (room_id, user_id, member_role) values ('${room}', '${user}', '${role}')`,
    setup,
  );
const memberUpdate = (room: string, user: string, set: string, setup?: Setup) =>
  sql(
    `update public.chat_members set ${set} where room_id = '${room}' and user_id = '${user}'`,
    setup,
  );

describe("#41 chat_members 값 검사 — CHAT-02, CHAT-03, CHAT-06, DM-01, DM-03 (팀장 결정 3, 4)", () => {
  serverCases([
    ["CHAT-03: (방1, 학생A) 참여 행을 하나 더", memberInsert(ROOM.R1, U.SA, "member"), "reject"],
    [
      "CHAT-03: 나가기 — left_at과 left_reason(self)을 함께",
      memberUpdate(ROOM.R1, U.SA, `left_at = now(), left_reason = 'self'`),
      "allow",
    ],
    [
      "CHAT-03: left_at 없이 left_reason만",
      memberUpdate(ROOM.R1, U.SA, `left_reason = 'self'`),
      "reject",
    ],
    [
      "CHAT-03: left_reason 없이 left_at만",
      memberUpdate(ROOM.R1, U.SA, `left_at = now()`),
      "reject",
    ],
    [
      "CHAT-06: T2(다른 트레이너)를 방1에 member로",
      memberInsert(ROOM.R1, U.T2, "member"),
      "reject",
    ],
    ["CHAT-06: 운영자를 방1에 member로", memberInsert(ROOM.R1, U.ADMIN, "member"), "reject"],
    [
      "CHAT-06: 학생G를 방1에 admin으로 (참여 행을 지운 뒤)",
      memberInsert(ROOM.R1, U.SG, "admin", removeSGFromR1),
      "reject",
    ],
    [
      "CHAT-02: 학생G를 방1에 member로 (참여 행을 지운 뒤, 허용 짝)",
      memberInsert(ROOM.R1, U.SG, "member", removeSGFromR1),
      "allow",
    ],
    [
      "CHAT-06: 방1의 학생A를 admin으로",
      memberUpdate(ROOM.R1, U.SA, `member_role = 'admin'`),
      "reject",
    ],
    ["CHAT-02: 수강 관계가 없는 학생B를 방1에", memberInsert(ROOM.R1, U.SB, "member"), "reject"],
    [
      "CHAT-03: 수강권이 모두 ended인 학생C를 방1에 다시 들이기",
      memberUpdate(ROOM.R1, U.SC, `left_at = null, left_reason = null, joined_at = now()`),
      "reject",
    ],
    [
      "CHAT-03·S-03: 일정 대기 수강권만 생긴 학생C를 방1에 다시 들이기",
      memberUpdate(
        ROOM.R1,
        U.SC,
        `left_at = null, left_reason = null, joined_at = now()`,
        waitingTicketForSC,
      ),
      "allow",
    ],
    [
      "CHAT-02: 일정 대기 수강권만 생긴 학생C를 방1에 다시 들이며 admin으로",
      memberUpdate(
        ROOM.R1,
        U.SC,
        `left_at = null, left_reason = null, joined_at = now(), member_role = 'admin'`,
        waitingTicketForSC,
      ),
      "reject",
    ],
    [
      "DM-01: 두 사람이 있는 DM1에 학생A를 세 번째로",
      memberInsert(ROOM.DM1, U.SA, "member"),
      "reject",
    ],
    [
      "DM-03: 새 1:1 대화(학생A만 있음)에 학생G를 member로",
      memberInsert(NEW.DM_SA_SG, U.SG, "member", directRoomSASG),
      "allow",
    ],
    [
      "DM-03: 새 1:1 대화(학생A만 있음)에 학생G를 admin으로",
      memberInsert(NEW.DM_SA_SG, U.SG, "admin", directRoomSASG),
      "reject",
    ],
    [
      "DM-01: 학생B ↔ T1의 두 번째 1:1 대화에 T1을 (DM1이 이미 있다)",
      memberInsert(NEW.DM_SB_T1_AGAIN, U.T1, "member", directRoomSBT1Again),
      "reject",
    ],
  ]);

  it("CHAT-03: 준비 상태 확인 — waitingTicketForSC 뒤 학생C에게 T1의 waiting_schedule 수강권이 있다", async () => {
    const { rows } = await queryAs(
      db,
      service,
      `select status from public.tickets where id = $1`,
      [NEW.TK_SC_WAITING],
      { setup: waitingTicketForSC },
    );
    expect(rows).toEqual([{ status: "waiting_schedule" }]);
  });

  it("CHAT-06: 준비 상태 확인 — removeSGFromR1 뒤 방1에 학생G의 참여 행이 없다", async () => {
    const { rows } = await queryAs(
      db,
      service,
      `select 1 from public.chat_members where room_id = $1 and user_id = $2`,
      [ROOM.R1, U.SG],
      { setup: removeSGFromR1 },
    );
    expect(rows).toEqual([]);
  });

  it("DM-03: 준비 상태 확인 — directRoomSASG 뒤 새 1:1 대화에 학생A 한 명이 있다", async () => {
    const { rows } = await queryAs(
      db,
      service,
      `select user_id from public.chat_members where room_id = $1`,
      [NEW.DM_SA_SG],
      { setup: directRoomSASG },
    );
    expect(rows).toEqual([{ user_id: U.SA }]);
  });

  it("CHAT-03: 준비 상태 확인 — 참여 시각이 준비 데이터대로다(학생H는 11-10에 들어왔다, 메시지 읽기 범위의 전제)", async () => {
    const { rows } = await queryAs<{ same: boolean }>(
      db,
      service,
      `select joined_at = $3::timestamptz as same from public.chat_members
       where room_id = $1 and user_id = $2`,
      [ROOM.R1, U.SH, JOINED.R1_SH],
    );
    expect(rows).toEqual([{ same: true }]);
  });
});

// ===========================================================================
// messages
// ===========================================================================

const messageInsert = (
  room: string,
  sender: string,
  kind: "text" | "image",
  body: string | null,
  imageUrl: string | null,
) =>
  sql(`insert into public.messages (room_id, sender_id, kind, body, image_url)
       values ('${room}', '${sender}', '${kind}', ${body === null ? "null" : `'${body}'`},
               ${imageUrl === null ? "null" : `'${imageUrl}'`})`);
const IMG = "https://example.test/b6/new.jpg";
const hideMessage = (id: string, by: string) =>
  sql(`update public.messages set hidden_by = '${by}' where id = '${id}'`);

describe("#41 messages 값 검사 — CHAT-02, CHAT-03, CHAT-05, CHAT-06, DM-04, ADM-04 (팀장 결정 4)", () => {
  serverCases([
    [
      "CHAT-02: 방1의 현재 참여자 학생A가 텍스트를",
      messageInsert(ROOM.R1, U.SA, "text", "묶음6 새 메시지", null),
      "allow",
    ],
    [
      "CHAT-03: 나간 학생C가 방1에",
      messageInsert(ROOM.R1, U.SC, "text", "묶음6 나간 학생", null),
      "reject",
    ],
    [
      "CHAT-02: 참여하지 않은 학생B가 방1에",
      messageInsert(ROOM.R1, U.SB, "text", "묶음6 남의 방", null),
      "reject",
    ],
    [
      "DM-04: DM1의 학생B가 텍스트를",
      messageInsert(ROOM.DM1, U.SB, "text", "묶음6 DM 새 메시지", null),
      "allow",
    ],
    [
      "DM-01: DM1에 참여하지 않은 학생A가",
      messageInsert(ROOM.DM1, U.SA, "text", "묶음6 남의 DM", null),
      "reject",
    ],
    [
      "CHAT-05: text인데 body가 비어 있다",
      messageInsert(ROOM.R1, U.SA, "text", "", null),
      "reject",
    ],
    ["CHAT-05: text인데 body가 없다", messageInsert(ROOM.R1, U.SA, "text", null, null), "reject"],
    [
      "CHAT-05: text인데 image_url이 있다",
      messageInsert(ROOM.R1, U.SA, "text", "묶음6 글", IMG),
      "reject",
    ],
    [
      "CHAT-05: image에 image_url이 있다",
      messageInsert(ROOM.R1, U.SA, "image", null, IMG),
      "allow",
    ],
    [
      "CHAT-05·DM-04: image인데 image_url이 없다",
      messageInsert(ROOM.DM1, U.SB, "image", null, null),
      "reject",
    ],
    ["CHAT-06: 방1 메시지를 방1의 트레이너 T1이 가림", hideMessage(M.R1_A, U.T1), "allow"],
    ["ADM-04: 방1 메시지를 운영자가 가림", hideMessage(M.R1_A, U.ADMIN), "allow"],
    ["CHAT-06: 방1 메시지를 T2가 가림", hideMessage(M.R1_A, U.T2), "reject"],
    ["CHAT-06: 방1 메시지를 학생G가 가림", hideMessage(M.R1_A, U.SG), "reject"],
    [
      "CHAT-06: DM1 메시지를 T1(DM1 참여자, 단체 채팅방 트레이너 아님)이 가림",
      hideMessage(M.DM1_B, U.T1),
      "reject",
    ],
    ["ADM-04: DM1 메시지를 운영자가 가림", hideMessage(M.DM1_B, U.ADMIN), "allow"],
  ]);
});

// ===========================================================================
// reviews
// ===========================================================================

const reviewInsert = (
  trainer: string,
  student: string,
  ticket: string,
  body: string,
  setup?: Setup,
) =>
  sql(
    `insert into public.reviews (trainer_id, student_id, ticket_id, body)
     values ('${trainer}', '${student}', '${ticket}', '${body}')`,
    setup,
  );

describe("#41 reviews 값 검사 — REV-01, REV-02, REV-04 (팀장 결정 4)", () => {
  serverCases([
    [
      "REV-02: TK.A(이미 RV1 있음)에 두 번째 후기",
      reviewInsert(U.T1, U.SA, TK.A, "묶음6 두 번째 후기"),
      "reject",
    ],
    [
      "REV-02: 보강 기록이 있는 TK.G에 학생G의 후기",
      reviewInsert(U.T1, U.SG, TK.G, "묶음6 보강 후기", makeupForSG),
      "allow",
    ],
    [
      "REV-02: TK.G에 트레이너를 T2로",
      reviewInsert(U.T2, U.SG, TK.G, "묶음6 트레이너 불일치", makeupForSG),
      "reject",
    ],
    [
      "REV-02: TK.G에 학생을 학생A로",
      reviewInsert(U.T1, U.SA, TK.G, "묶음6 학생 불일치", makeupForSG),
      "reject",
    ],
    [
      "REV-02: 출결 기록이 없는 일정 대기 수강권 TK.A_RE",
      reviewInsert(U.T1, U.SA, TK.A_RE, "묶음6 일정 대기"),
      "reject",
    ],
    [
      "REV-02: 미체크(none) 참여 행만 있는 일회권 TK.AS",
      reviewInsert(U.T1, U.SA, TK.AS, "묶음6 미체크"),
      "reject",
    ],
    [
      "REV-02: 사전 취소만 있는 TK.B",
      reviewInsert(U.T2, U.SB, TK.B, "묶음6 사전 취소", preCanceledForSB),
      "reject",
    ],
    [
      "REV-02: 결석만 있는 TK.B",
      reviewInsert(U.T2, U.SB, TK.B, "묶음6 결석", absentForSB),
      "reject",
    ],
    [
      "REV-02: 출석이 있는 TK.B (허용 짝)",
      reviewInsert(U.T2, U.SB, TK.B, "묶음6 출석", presentForSB),
      "allow",
    ],
    ["REV-01: body가 비어 있다", reviewInsert(U.T1, U.SG, TK.G, "", makeupForSG), "reject"],
  ]);

  it("REV-02: 준비 상태 확인 — makeupForSG·preCanceledForSB·absentForSB·presentForSB가 출결을 바꾼다", async () => {
    const read = async (setup: Setup, ticket: string) =>
      (
        await queryAs<{ attendance: string }>(
          db,
          service,
          `select attendance::text as attendance from public.session_attendees where ticket_id = $1`,
          [ticket],
          { setup },
        )
      ).rows.map((row) => row.attendance);
    expect(await read(makeupForSG, TK.G)).toEqual(["makeup"]);
    expect(await read(preCanceledForSB, TK.B)).toEqual(["pre_canceled"]);
    expect(await read(absentForSB, TK.B)).toEqual(["absent"]);
    expect(await read(presentForSB, TK.B)).toEqual(["present"]);
  });

  it("REV-04: 후기를 고치면 DB가 updated_at을 넣는다(서버가 준 값을 쓰지 않는다)", async () => {
    const { rows } = await queryAs<{ stale: boolean; recent: boolean }>(
      db,
      service,
      `with changed as (
         update public.reviews set body = '묶음6 고친 후기', updated_at = '2000-01-01 00:00:00+09'
         where id = $1 returning updated_at
       )
       select updated_at = '2000-01-01 00:00:00+09'::timestamptz as stale,
              updated_at >= now() - interval '1 minute' as recent
       from changed`,
      [RV.RV1],
    );
    expect(rows).toEqual([{ stale: false, recent: true }]);
  });
});

// ===========================================================================
// review_replies
// ===========================================================================

describe("#41 review_replies 값 검사 — REV-06 (팀장 결정 4)", () => {
  serverCases([
    [
      "REV-06: 답글이 이미 있는 RV1에 두 번째 답글",
      sql(
        `insert into public.review_replies (review_id, body) values ('${RV.RV1}', '묶음6 두 번째')`,
      ),
      "reject",
    ],
    [
      "REV-06: 답글이 없는 학생G 후기에 답글",
      sql(
        `insert into public.review_replies (review_id, body) values ('${NEW.RV_G}', '묶음6 새 답글')`,
        reviewForSG,
      ),
      "allow",
    ],
    [
      "REV-06: body가 비어 있다",
      sql(
        `insert into public.review_replies (review_id, body) values ('${NEW.RV_G}', '')`,
        reviewForSG,
      ),
      "reject",
    ],
  ]);
});

// ===========================================================================
// blocks
// ===========================================================================

describe("#41 blocks 값 검사 — CHAT-07, DM-05 (팀장 결정 4)", () => {
  serverCases([
    [
      "CHAT-07: 학생G → 학생H 차단을 하나 더",
      sql(`insert into public.blocks (blocker_id, blocked_id) values ('${U.SG}', '${U.SH}')`),
      "reject",
    ],
    [
      "CHAT-07: 학생H → 학생G 차단(반대 방향, 허용 짝)",
      sql(`insert into public.blocks (blocker_id, blocked_id) values ('${U.SH}', '${U.SG}')`),
      "allow",
    ],
    [
      "DM-05: 자기 자신을 차단",
      sql(`insert into public.blocks (blocker_id, blocked_id) values ('${U.SA}', '${U.SA}')`),
      "reject",
    ],
  ]);

  it("CHAT-07: 준비 상태 확인 — BL.G_H가 있다", async () => {
    const { rows } = await queryAs(db, service, `select 1 from public.blocks where id = $1`, [
      BL.G_H,
    ]);
    expect(rows.length).toBe(1);
  });
});

// ===========================================================================
// reports
// ===========================================================================

const reportInsert = (
  reporter: string,
  targetType: "message" | "review" | "user",
  target: string,
  reason: string,
  status: "open" | "resolved" = "open",
  handledBy: string | null = null,
) =>
  sql(`insert into public.reports (reporter_id, target_type, target_id, reason, status, handled_by)
       values ('${reporter}', '${targetType}', '${target}', '${reason}', '${status}',
               ${handledBy === null ? "null" : `'${handledBy}'`})`);

describe("#41 reports 값 검사 — CHAT-07, REV-05, DM-07, ADM-04 (팀장 결정 4, 8)", () => {
  serverCases([
    [
      "DM-07: 사유가 있는 open 신고",
      reportInsert(U.SA, "user", U.SB, "플랫폼 밖 결제 유도"),
      "allow",
    ],
    ["DM-07: 사유가 비어 있다", reportInsert(U.SA, "user", U.SB, ""), "reject"],
    [
      "ADM-04: resolved인데 handled_by가 없다",
      reportInsert(U.SA, "user", U.SB, "묶음6 사유", "resolved", null),
      "reject",
    ],
    [
      "ADM-04: resolved이고 handled_by가 운영자",
      reportInsert(U.SA, "user", U.SB, "묶음6 사유", "resolved", U.ADMIN),
      "allow",
    ],
    [
      "ADM-04: resolved이고 handled_by가 운영자가 아니다(T1)",
      reportInsert(U.SA, "user", U.SB, "묶음6 사유", "resolved", U.T1),
      "reject",
    ],
    [
      "CHAT-07: 학생H가 같은 메시지(M.DM2_G)에 open 신고를 하나 더",
      reportInsert(U.SH, "message", M.DM2_G, "묶음6 또 신고"),
      "reject",
    ],
    [
      "REV-05: 학생B가 RV1에 다시 신고(앞 신고는 resolved, 허용 짝)",
      reportInsert(U.SB, "review", RV.RV1, "묶음6 다시 신고"),
      "allow",
    ],
    [
      "ADM-04: open 신고 RP.DM2_MSG를 resolved로, handled_by 운영자",
      sql(
        `update public.reports set status = 'resolved', handled_by = '${U.ADMIN}' where id = '${RP.DM2_MSG}'`,
      ),
      "allow",
    ],
    [
      "ADM-04: open 신고 RP.DM2_MSG를 handled_by 없이 resolved로",
      sql(`update public.reports set status = 'resolved' where id = '${RP.DM2_MSG}'`),
      "reject",
    ],
  ]);
});

// ===========================================================================
// push_tokens · notifications
// ===========================================================================

describe("#41 push_tokens·notifications 값 검사 — NOTI-01, NOTI-02, erd 8장", () => {
  serverCases([
    [
      "NOTI-01: 다른 사용자에게 이미 있는 token",
      sql(
        `insert into public.push_tokens (user_id, token, platform) values ('${U.SB}', 'b6-fake-token-t1-ios', 'ios')`,
      ),
      "reject",
    ],
    [
      "NOTI-01: 새 token (허용 짝)",
      sql(
        `insert into public.push_tokens (user_id, token, platform) values ('${U.SB}', 'b6-fake-token-sb-ios', 'ios')`,
      ),
      "allow",
    ],
    [
      "NOTI-02: type이 비어 있다",
      sql(`insert into public.notifications (user_id, type, payload) values ('${U.SB}', '', '{}')`),
      "reject",
    ],
    [
      "NOTI-02: enum에 없는 새 type 문자열 (type은 enum이 아니다, 허용 짝)",
      sql(
        `insert into public.notifications (user_id, type, payload)
         values ('${U.SB}', 'b6_new_type', '{"screen": "C-06"}')`,
      ),
      "allow",
    ],
  ]);
});
