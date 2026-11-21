// 인수 테스트: 이슈 #41 묶음 6 — chat_rooms, chat_members, messages 권한
// (QA가 개발 전에 쓴다. 개발은 고치지 않는다. 틀렸다고 보면 `[질문] 받는 역할: QA`)
//
// 준비 데이터와 역할은 41-fixture.ts.
// 쓰기 경로(팀장 결정 1): 채팅방·참여 행 만들기·다시 들어오기·ticket_ended, 메시지 보내기는 서버만.
//   클라이언트 직접은 자기 참여 행의 muted와 나가기(self), 트레이너의 내보내기(kicked), 트레이너(자기 단체 채팅방)·
//   운영자의 메시지 가리기(hidden_by = 자기 자신)뿐
// 읽기(팀장 결정 2, PM 질문 1 A): 방·참여 행은 그 방의 현재 참여자, 나간 사람은 자기 참여 행만. 메시지는 현재 참여자가
//   자기 joined_at 이후만. 가린 메시지는 운영자·그 단체 채팅방 트레이너만. 차단한 사람에게 차단당한 사람의 메시지는 숨김.
//   운영자는 신고된 메시지가 있는 방(방1, DM2)만
// 나가기·내보내기(팀장 결정 5), 수정 범위(팀장 결정 6: 가리기 되돌리기·메시지 수정 없음)
// 정지 트레이너는 내보내기·가리기를 한다(팀장 결정 7). 탈퇴 사용자는 쓰지 못한다(AUTH-07, is_active_user)
// 권한(읽기, grant가 없는 insert·delete)은 RLS 매트릭스(attempt)로, 값·관계에 따라 갈리는 update는 attemptWrite로
// 판정한다(막는 방법이 정책·컬럼 권한·트리거 중 무엇이든 거부). update 거부마다 같은 줄을 고치는 허용 짝이 있다.
// 매트릭스 title은 요구사항 추적이 세지 않으므로 대표 칸을 맨 아래에서 ID를 넣은 이름으로 한 번 더 둔다.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "../helpers/db.ts";
import { anon, asUser, queryAs, service } from "../helpers/db.ts";
import { attempt, attemptWrite, describeRlsMatrix } from "../helpers/rls-matrix.ts";
import type { Op, OpCase } from "../helpers/rls-matrix.ts";
import type { Setup } from "./41-fixture.ts";
import {
  M,
  ROOM,
  U,
  createBundle6Db,
  suspendT1,
  waitingTicketForSC,
  withdrawSA,
  withdrawT1,
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

// ===========================================================================
// 시도 (OpCase)
// ===========================================================================

const selectRoom = (id: string): OpCase => ({
  sql: `select 1 from public.chat_rooms where id = $1`,
  params: [id],
});
const selectMember = (room: string, user: string): OpCase => ({
  sql: `select 1 from public.chat_members where room_id = $1 and user_id = $2`,
  params: [room, user],
});
const updateMember = (room: string, user: string, set: string, setup?: Setup): OpCase =>
  withSetup(
    {
      sql: `update public.chat_members set ${set} where room_id = $1 and user_id = $2`,
      params: [room, user],
    },
    setup,
  );
const mute = (room: string, user: string, setup?: Setup) =>
  updateMember(room, user, `muted = not muted`, setup);
const leave = (room: string, user: string, setup?: Setup) =>
  updateMember(room, user, `left_at = now(), left_reason = 'self'`, setup);
const kick = (room: string, user: string, setup?: Setup) =>
  updateMember(room, user, `left_at = now(), left_reason = 'kicked'`, setup);
const ticketEnded = (room: string, user: string) =>
  updateMember(room, user, `left_at = now(), left_reason = 'ticket_ended'`);
const rejoin = (room: string, user: string, setup?: Setup) =>
  updateMember(room, user, `left_at = null, left_reason = null`, setup);

const selectMessage = (id: string): OpCase => ({
  sql: `select 1 from public.messages where id = $1`,
  params: [id],
});
const updateMessage = (id: string, set: string, setup?: Setup): OpCase =>
  withSetup({ sql: `update public.messages set ${set} where id = $1`, params: [id] }, setup);
const hide = (id: string, by: string, setup?: Setup) =>
  updateMessage(id, `hidden_by = '${by}'`, setup);

// ===========================================================================
// chat_rooms
// ===========================================================================

describeRlsMatrix(
  {
    title: "#41 chat_rooms 권한 — CHAT-02, CHAT-03, CHAT-04, DM-01, DM-03, ADM-07",
    actors: ACTORS,
    cases: {
      "chat_rooms:방1": {
        select: selectRoom(ROOM.R1),
        insert: {
          sql: `insert into public.chat_rooms (type, trainer_id) values ('direct', null)`,
        },
        update: {
          sql: `update public.chat_rooms set trainer_id = $2 where id = $1`,
          params: [ROOM.R1, U.T1],
        },
        delete: { sql: `delete from public.chat_rooms where id = $1`, params: [ROOM.R1] },
      },
      "chat_rooms:방2": { select: selectRoom(ROOM.R2) },
      "chat_rooms:DM1": {
        select: selectRoom(ROOM.DM1),
        delete: { sql: `delete from public.chat_rooms where id = $1`, params: [ROOM.DM1] },
      },
      "chat_rooms:DM2": { select: selectRoom(ROOM.DM2) },
    },
    rows: [
      // 역할      테이블              select   insert   update   delete
      ["T1", "chat_rooms:방1", "allow", "deny", "deny", "deny"],
      ["T1", "chat_rooms:방2", "deny", "-", "-", "-"],
      ["T1", "chat_rooms:DM1", "allow", "-", "-", "deny"],
      ["T1", "chat_rooms:DM2", "deny", "-", "-", "-"],
      ["학생A", "chat_rooms:방1", "allow", "deny", "deny", "deny"],
      ["학생A", "chat_rooms:DM1", "deny", "-", "-", "-"],
      ["학생A", "chat_rooms:DM2", "deny", "-", "-", "-"],
      ["학생G", "chat_rooms:방1", "allow", "-", "-", "-"],
      ["학생G", "chat_rooms:DM2", "allow", "-", "-", "-"],
      ["학생H", "chat_rooms:방1", "allow", "-", "-", "-"],
      ["학생H", "chat_rooms:DM2", "allow", "-", "-", "-"],
      ["학생C", "chat_rooms:방1", "deny", "deny", "-", "-"],
      ["학생B", "chat_rooms:방1", "deny", "deny", "deny", "deny"],
      ["학생B", "chat_rooms:방2", "allow", "-", "-", "-"],
      ["학생B", "chat_rooms:DM1", "allow", "-", "-", "deny"],
      ["학생B", "chat_rooms:DM2", "deny", "-", "-", "-"],
      ["T2", "chat_rooms:방1", "deny", "deny", "deny", "deny"],
      ["T2", "chat_rooms:방2", "allow", "-", "-", "-"],
      ["anon", "chat_rooms:방1", "deny", "deny", "deny", "deny"],
      ["anon", "chat_rooms:DM1", "deny", "-", "-", "-"],
      ["운영자", "chat_rooms:방1", "allow", "deny", "deny", "deny"],
      ["운영자", "chat_rooms:방2", "deny", "-", "-", "-"],
      ["운영자", "chat_rooms:DM1", "deny", "-", "-", "-"],
      ["운영자", "chat_rooms:DM2", "allow", "-", "-", "-"],
    ],
  },
  { db: getDb },
);

// ===========================================================================
// chat_members
// ===========================================================================

describeRlsMatrix(
  {
    title: "#41 chat_members 권한 — CHAT-02, CHAT-03, CHAT-04, CHAT-06, DM-01, DM-03, ADM-07",
    actors: ACTORS,
    cases: {
      "chat_members:방1 학생A": {
        select: selectMember(ROOM.R1, U.SA),
        delete: {
          sql: `delete from public.chat_members where room_id = $1 and user_id = $2`,
          params: [ROOM.R1, U.SA],
        },
      },
      "chat_members:방1 학생H": { select: selectMember(ROOM.R1, U.SH) },
      "chat_members:방1 T1": { select: selectMember(ROOM.R1, U.T1) },
      "chat_members:방1 학생C(나감)": {
        select: selectMember(ROOM.R1, U.SC),
        delete: {
          sql: `delete from public.chat_members where room_id = $1 and user_id = $2`,
          params: [ROOM.R1, U.SC],
        },
      },
      "chat_members:방1에 학생B 넣기": {
        insert: {
          sql: `insert into public.chat_members (room_id, user_id, member_role) values ($1, $2, 'member')`,
          params: [ROOM.R1, U.SB],
        },
      },
      "chat_members:DM1에 학생A 넣기": {
        insert: {
          sql: `insert into public.chat_members (room_id, user_id, member_role) values ($1, $2, 'member')`,
          params: [ROOM.DM1, U.SA],
        },
      },
      "chat_members:방2 학생B": { select: selectMember(ROOM.R2, U.SB) },
      "chat_members:DM1 학생B": { select: selectMember(ROOM.DM1, U.SB) },
      "chat_members:DM2 학생G": { select: selectMember(ROOM.DM2, U.SG) },
    },
    rows: [
      // 역할      테이블                              select   insert   update   delete
      ["T1", "chat_members:방1 학생A", "allow", "-", "-", "deny"],
      ["T1", "chat_members:방1 학생H", "allow", "-", "-", "-"],
      ["T1", "chat_members:방1 T1", "allow", "-", "-", "-"],
      ["T1", "chat_members:방1 학생C(나감)", "-", "-", "-", "deny"],
      ["T1", "chat_members:방1에 학생B 넣기", "-", "deny", "-", "-"],
      ["T1", "chat_members:방2 학생B", "deny", "-", "-", "-"],
      ["T1", "chat_members:DM1 학생B", "allow", "-", "-", "-"],
      ["T1", "chat_members:DM2 학생G", "deny", "-", "-", "-"],
      ["학생A", "chat_members:방1 학생A", "allow", "-", "-", "deny"],
      ["학생A", "chat_members:방1 학생H", "allow", "-", "-", "-"],
      ["학생A", "chat_members:방1 T1", "allow", "-", "-", "-"],
      ["학생A", "chat_members:DM1에 학생A 넣기", "-", "deny", "-", "-"],
      ["학생A", "chat_members:DM1 학생B", "deny", "-", "-", "-"],
      ["학생A", "chat_members:DM2 학생G", "deny", "-", "-", "-"],
      ["학생A", "chat_members:방2 학생B", "deny", "-", "-", "-"],
      ["학생G", "chat_members:방1 학생H", "allow", "-", "-", "-"],
      ["학생G", "chat_members:DM2 학생G", "allow", "-", "-", "-"],
      ["학생G", "chat_members:DM1 학생B", "deny", "-", "-", "-"],
      ["학생H", "chat_members:방1 학생A", "allow", "-", "-", "-"],
      ["학생H", "chat_members:DM2 학생G", "allow", "-", "-", "-"],
      ["학생C", "chat_members:방1 학생C(나감)", "allow", "-", "-", "deny"],
      ["학생C", "chat_members:방1 학생A", "deny", "-", "-", "-"],
      ["학생C", "chat_members:방1 T1", "deny", "-", "-", "-"],
      ["학생B", "chat_members:방1 학생A", "deny", "-", "-", "deny"],
      ["학생B", "chat_members:방1에 학생B 넣기", "-", "deny", "-", "-"],
      ["학생B", "chat_members:방2 학생B", "allow", "-", "-", "-"],
      ["학생B", "chat_members:DM1 학생B", "allow", "-", "-", "-"],
      ["학생B", "chat_members:DM2 학생G", "deny", "-", "-", "-"],
      ["T2", "chat_members:방1 학생A", "deny", "-", "-", "deny"],
      ["T2", "chat_members:방2 학생B", "allow", "-", "-", "-"],
      ["anon", "chat_members:방1 학생A", "deny", "-", "-", "deny"],
      ["anon", "chat_members:DM1 학생B", "deny", "-", "-", "-"],
      ["anon", "chat_members:방1에 학생B 넣기", "-", "deny", "-", "-"],
      ["운영자", "chat_members:방1 학생A", "allow", "-", "-", "deny"],
      ["운영자", "chat_members:방1에 학생B 넣기", "-", "deny", "-", "-"],
      ["운영자", "chat_members:방2 학생B", "deny", "-", "-", "-"],
      ["운영자", "chat_members:DM1 학생B", "deny", "-", "-", "-"],
      ["운영자", "chat_members:DM2 학생G", "allow", "-", "-", "-"],
    ],
  },
  { db: getDb },
);

// ===========================================================================
// messages
// ===========================================================================

const insertMessage = (room: string, sender: string): OpCase => ({
  sql: `insert into public.messages (room_id, sender_id, kind, body) values ($1, $2, 'text', '묶음6 클라이언트 메시지')`,
  params: [room, sender],
});
const deleteMessage = (id: string): OpCase => ({
  sql: `delete from public.messages where id = $1`,
  params: [id],
});

describeRlsMatrix(
  {
    title:
      "#41 messages 권한 — CHAT-02, CHAT-03, CHAT-04, CHAT-05, CHAT-06, CHAT-07, DM-01, DM-04, DM-05, ADM-04, ADM-07",
    actors: ACTORS,
    cases: {
      "messages:방1 11-05 학생A(R1_OLD)": { select: selectMessage(M.R1_OLD) },
      "messages:방1 학생A(R1_A)": {
        select: selectMessage(M.R1_A),
        delete: deleteMessage(M.R1_A),
      },
      "messages:방1 학생G(R1_G)": { select: selectMessage(M.R1_G) },
      "messages:방1 학생H(R1_H)": { select: selectMessage(M.R1_H) },
      "messages:방1 T1 사진(R1_IMG)": { select: selectMessage(M.R1_IMG) },
      "messages:방1 가린 메시지(R1_HIDDEN)": { select: selectMessage(M.R1_HIDDEN) },
      "messages:방2 학생B(R2_B)": { select: selectMessage(M.R2_B) },
      "messages:DM1 학생B(DM1_B)": {
        select: selectMessage(M.DM1_B),
        delete: deleteMessage(M.DM1_B),
      },
      "messages:DM1 T1(DM1_T)": { select: selectMessage(M.DM1_T) },
      "messages:DM2 학생G(DM2_G, 신고됨)": { select: selectMessage(M.DM2_G) },
      "messages:DM2 학생H(DM2_H)": { select: selectMessage(M.DM2_H) },
      "messages:방1에 학생A로 보내기": { insert: insertMessage(ROOM.R1, U.SA) },
      "messages:방1에 T1로 보내기": { insert: insertMessage(ROOM.R1, U.T1) },
      "messages:DM1에 학생B로 보내기": { insert: insertMessage(ROOM.DM1, U.SB) },
    },
    rows: [
      // 역할      테이블                                          select   insert   update   delete
      ["T1", "messages:방1 11-05 학생A(R1_OLD)", "allow", "-", "-", "-"],
      ["T1", "messages:방1 학생A(R1_A)", "allow", "-", "-", "deny"],
      ["T1", "messages:방1 학생H(R1_H)", "allow", "-", "-", "-"],
      ["T1", "messages:방1 가린 메시지(R1_HIDDEN)", "allow", "-", "-", "-"],
      ["T1", "messages:방1에 T1로 보내기", "-", "deny", "-", "-"],
      ["T1", "messages:방2 학생B(R2_B)", "deny", "-", "-", "-"],
      ["T1", "messages:DM1 학생B(DM1_B)", "allow", "-", "-", "deny"],
      ["T1", "messages:DM2 학생G(DM2_G, 신고됨)", "deny", "-", "-", "-"],

      ["학생A", "messages:방1 11-05 학생A(R1_OLD)", "allow", "-", "-", "-"],
      ["학생A", "messages:방1 학생A(R1_A)", "allow", "-", "-", "deny"],
      ["학생A", "messages:방1 학생H(R1_H)", "allow", "-", "-", "-"],
      ["학생A", "messages:방1 T1 사진(R1_IMG)", "allow", "-", "-", "-"],
      ["학생A", "messages:방1 가린 메시지(R1_HIDDEN)", "deny", "-", "-", "-"],
      ["학생A", "messages:방1에 학생A로 보내기", "-", "deny", "-", "-"],
      ["학생A", "messages:DM1 학생B(DM1_B)", "deny", "-", "-", "-"],
      ["학생A", "messages:DM1 T1(DM1_T)", "deny", "-", "-", "-"],
      ["학생A", "messages:DM2 학생G(DM2_G, 신고됨)", "deny", "-", "-", "-"],
      ["학생A", "messages:DM2 학생H(DM2_H)", "deny", "-", "-", "-"],

      ["학생G", "messages:방1 학생A(R1_A)", "allow", "-", "-", "-"],
      ["학생G", "messages:방1 학생H(R1_H)", "deny", "-", "-", "-"],
      ["학생G", "messages:방1 가린 메시지(R1_HIDDEN)", "deny", "-", "-", "-"],
      ["학생G", "messages:DM2 학생G(DM2_G, 신고됨)", "allow", "-", "-", "-"],
      ["학생G", "messages:DM2 학생H(DM2_H)", "deny", "-", "-", "-"],

      ["학생H", "messages:방1 11-05 학생A(R1_OLD)", "deny", "-", "-", "-"],
      ["학생H", "messages:방1 학생A(R1_A)", "allow", "-", "-", "-"],
      ["학생H", "messages:방1 학생G(R1_G)", "allow", "-", "-", "-"],
      ["학생H", "messages:DM2 학생G(DM2_G, 신고됨)", "allow", "-", "-", "-"],
      ["학생H", "messages:DM2 학생H(DM2_H)", "allow", "-", "-", "-"],

      ["학생C", "messages:방1 11-05 학생A(R1_OLD)", "deny", "-", "-", "-"],
      ["학생C", "messages:방1 학생A(R1_A)", "deny", "-", "-", "-"],

      ["학생B", "messages:방1 학생A(R1_A)", "deny", "-", "-", "deny"],
      ["학생B", "messages:방2 학생B(R2_B)", "allow", "-", "-", "-"],
      ["학생B", "messages:DM1 학생B(DM1_B)", "allow", "-", "-", "deny"],
      ["학생B", "messages:DM1 T1(DM1_T)", "allow", "-", "-", "-"],
      ["학생B", "messages:DM1에 학생B로 보내기", "-", "deny", "-", "-"],

      ["T2", "messages:방1 학생A(R1_A)", "deny", "-", "-", "deny"],
      ["T2", "messages:방2 학생B(R2_B)", "allow", "-", "-", "-"],

      ["anon", "messages:방1 학생A(R1_A)", "deny", "-", "-", "deny"],
      ["anon", "messages:DM1 학생B(DM1_B)", "deny", "-", "-", "-"],
      ["anon", "messages:방1에 학생A로 보내기", "-", "deny", "-", "-"],

      ["운영자", "messages:방1 학생A(R1_A)", "allow", "-", "-", "deny"],
      ["운영자", "messages:방1 가린 메시지(R1_HIDDEN)", "allow", "-", "-", "-"],
      ["운영자", "messages:방2 학생B(R2_B)", "deny", "-", "-", "-"],
      ["운영자", "messages:DM1 학생B(DM1_B)", "deny", "-", "-", "deny"],
      ["운영자", "messages:DM2 학생G(DM2_G, 신고됨)", "allow", "-", "-", "-"],
      ["운영자", "messages:DM2 학생H(DM2_H)", "allow", "-", "-", "-"],
    ],
  },
  { db: getDb },
);

// ===========================================================================
// 참여 행 쓰기 (값에 따라 갈리므로 attemptWrite, 허용 짝과 함께)
// ===========================================================================

describe("#41 참여 행 쓰기: 알림 끄기·나가기·내보내기·다시 들어오기 — CHAT-03, CHAT-06, CHAT-08, DM-06, S-21, ADM-02, AUTH-07 (팀장 결정 1, 5, 7)", () => {
  it.each<[string, ActorName, OpCase, "allow" | "reject"]>([
    ["CHAT-08: 학생A는 방1에서 자기 알림을 끈다", "학생A", mute(ROOM.R1, U.SA), "allow"],
    ["CHAT-08: 학생G는 방1에서 자기 알림을 다시 켠다", "학생G", mute(ROOM.R1, U.SG), "allow"],
    ["CHAT-08: 학생A는 학생G의 방1 알림을 바꾸지 못한다", "학생A", mute(ROOM.R1, U.SG), "reject"],
    ["CHAT-08: T1은 학생A의 방1 알림을 바꾸지 못한다", "T1", mute(ROOM.R1, U.SA), "reject"],
    ["DM-06: 학생B는 DM1에서 자기 알림을 끈다", "학생B", mute(ROOM.DM1, U.SB), "allow"],
    ["DM-06: T1은 학생B의 DM1 알림을 바꾸지 못한다", "T1", mute(ROOM.DM1, U.SB), "reject"],

    ["CHAT-03: 학생A는 방1에서 스스로 나간다(self)", "학생A", leave(ROOM.R1, U.SA), "allow"],
    ["CHAT-03: 학생G는 학생A를 대신 나가게 하지 못한다", "학생G", leave(ROOM.R1, U.SA), "reject"],
    ["CHAT-03·S-21: 학생B는 DM1에서 나가지 못한다", "학생B", leave(ROOM.DM1, U.SB), "reject"],
    ["CHAT-03·S-21: 학생G는 DM2에서 나가지 못한다", "학생G", leave(ROOM.DM2, U.SG), "reject"],
    ["CHAT-03: T1은 방1을 나가지 못한다", "T1", leave(ROOM.R1, U.T1), "reject"],
    [
      "CHAT-03: 학생A는 자기 참여 행에 ticket_ended를 쓰지 못한다",
      "학생A",
      ticketEnded(ROOM.R1, U.SA),
      "reject",
    ],
    [
      "CHAT-03: T1은 학생A의 참여 행에 ticket_ended를 쓰지 못한다",
      "T1",
      ticketEnded(ROOM.R1, U.SA),
      "reject",
    ],
    [
      "CHAT-03: 학생C는 방1 참여 행을 다시 참여 상태로 바꾸지 못한다",
      "학생C",
      rejoin(ROOM.R1, U.SC),
      "reject",
    ],
    [
      "CHAT-03: 일정 대기 수강권이 생겨도 학생C는 스스로 다시 들어오지 못한다(서버만)",
      "학생C",
      rejoin(ROOM.R1, U.SC, waitingTicketForSC),
      "reject",
    ],
    [
      "CHAT-03: T1은 학생C를 다시 참여 상태로 바꾸지 못한다",
      "T1",
      rejoin(ROOM.R1, U.SC, waitingTicketForSC),
      "reject",
    ],

    ["CHAT-06: T1은 방1의 학생A를 내보낸다(kicked)", "T1", kick(ROOM.R1, U.SA), "allow"],
    ["CHAT-06: T1은 DM1에서 학생B를 내보내지 못한다", "T1", kick(ROOM.DM1, U.SB), "reject"],
    ["CHAT-06: T2는 방1의 학생A를 내보내지 못한다", "T2", kick(ROOM.R1, U.SA), "reject"],
    ["CHAT-06: 학생G는 방1의 학생A를 내보내지 못한다", "학생G", kick(ROOM.R1, U.SA), "reject"],
    ["CHAT-06: 운영자는 방1의 학생A를 내보내지 못한다", "운영자", kick(ROOM.R1, U.SA), "reject"],
    [
      "CHAT-06: 학생A는 자기 참여 행에 kicked를 쓰지 못한다(내보내기는 트레이너)",
      "학생A",
      kick(ROOM.R1, U.SA),
      "reject",
    ],

    [
      "CHAT-03: 학생A는 자기 참여 행의 member_role을 고치지 못한다",
      "학생A",
      updateMember(ROOM.R1, U.SA, `member_role = 'admin'`),
      "reject",
    ],
    [
      "CHAT-03: 학생H는 자기 참여 행의 joined_at을 앞당기지 못한다",
      "학생H",
      updateMember(ROOM.R1, U.SH, `joined_at = '2026-10-01 00:00:00+09'`),
      "reject",
    ],
    [
      "CHAT-03: 학생A는 자기 참여 행의 room_id를 바꾸지 못한다",
      "학생A",
      updateMember(ROOM.R1, U.SA, `room_id = '${ROOM.R2}'`),
      "reject",
    ],
    [
      "CHAT-03: 학생A는 자기 참여 행의 user_id를 바꾸지 못한다",
      "학생A",
      updateMember(ROOM.R1, U.SA, `user_id = '${U.SB}'`),
      "reject",
    ],
    [
      "CHAT-06: T1은 학생A의 member_role을 고치지 못한다",
      "T1",
      updateMember(ROOM.R1, U.SA, `member_role = 'admin'`),
      "reject",
    ],
    [
      "CHAT-06: T1은 학생H의 joined_at을 고치지 못한다",
      "T1",
      updateMember(ROOM.R1, U.SH, `joined_at = '2026-10-01 00:00:00+09'`),
      "reject",
    ],

    ["ADM-02: 정지 T1은 방1의 학생A를 내보낸다", "T1", kick(ROOM.R1, U.SA, suspendT1), "allow"],
    [
      "AUTH-07: 탈퇴 T1은 방1의 학생A를 내보내지 못한다",
      "T1",
      kick(ROOM.R1, U.SA, withdrawT1),
      "reject",
    ],
    [
      "AUTH-07: 탈퇴 T1은 자기 방1 알림을 바꾸지 못한다",
      "T1",
      mute(ROOM.R1, U.T1, withdrawT1),
      "reject",
    ],
    ["CHAT-08: T1은 자기 방1 알림을 바꾼다(탈퇴 짝)", "T1", mute(ROOM.R1, U.T1), "allow"],
    [
      "AUTH-07: 탈퇴 학생A는 방1 알림을 바꾸지 못한다",
      "학생A",
      mute(ROOM.R1, U.SA, withdrawSA),
      "reject",
    ],
    [
      "AUTH-07: 탈퇴 학생A는 방1에서 나가지 못한다",
      "학생A",
      leave(ROOM.R1, U.SA, withdrawSA),
      "reject",
    ],
  ])("%s", async (_, actor, opCase, expected) => {
    expect(await attemptWrite(db, ACTORS[actor] as Actor, opCase)).toBe(expected);
  });

  it("CHAT-03: 학생A가 나가면 그 줄에 left_at과 left_reason = self가 남는다", async () => {
    const { rows } = await queryAs<{ left: boolean; reason: string | null }>(
      db,
      ACTORS.학생A,
      `update public.chat_members set left_at = now(), left_reason = 'self'
       where room_id = $1 and user_id = $2
       returning left_at is not null as left, left_reason::text as reason`,
      [ROOM.R1, U.SA],
    );
    expect(rows).toEqual([{ left: true, reason: "self" }]);
  });
});

// ===========================================================================
// 메시지 가리기 (값에 따라 갈리므로 attemptWrite, 허용 짝과 함께)
// ===========================================================================

describe("#41 메시지 가리기 — CHAT-06, ADM-04, ADM-02, AUTH-07 (팀장 결정 1, 6, 7)", () => {
  it.each<[string, ActorName, OpCase, "allow" | "reject"]>([
    ["CHAT-06: T1은 방1의 메시지를 가린다", "T1", hide(M.R1_A, U.T1), "allow"],
    ["CHAT-06: T1은 방1의 사진 메시지를 가린다", "T1", hide(M.R1_IMG, U.T1), "allow"],
    [
      "CHAT-06: T1은 가린 사람을 운영자로 적지 못한다(hidden_by는 자기 자신)",
      "T1",
      hide(M.R1_A, U.ADMIN),
      "reject",
    ],
    ["CHAT-06: T1은 DM1의 메시지를 가리지 못한다", "T1", hide(M.DM1_B, U.T1), "reject"],
    ["CHAT-06: T1은 DM2의 메시지를 가리지 못한다", "T1", hide(M.DM2_G, U.T1), "reject"],
    ["CHAT-06: T2는 방1의 메시지를 가리지 못한다", "T2", hide(M.R1_A, U.T2), "reject"],
    ["CHAT-06: 학생A는 방1의 메시지를 가리지 못한다", "학생A", hide(M.R1_G, U.SA), "reject"],
    ["CHAT-06: 학생B는 DM1의 메시지를 가리지 못한다", "학생B", hide(M.DM1_T, U.SB), "reject"],
    ["ADM-04: 운영자는 방1(신고된 방)의 메시지를 가린다", "운영자", hide(M.R1_A, U.ADMIN), "allow"],
    [
      "ADM-04: 운영자는 DM2(신고된 대화)의 메시지를 가린다",
      "운영자",
      hide(M.DM2_G, U.ADMIN),
      "allow",
    ],
    [
      "ADM-04: 운영자는 읽을 수 없는 DM1의 메시지를 가리지 못한다",
      "운영자",
      hide(M.DM1_B, U.ADMIN),
      "reject",
    ],
    [
      "ADM-04: 운영자는 읽을 수 없는 방2의 메시지를 가리지 못한다",
      "운영자",
      hide(M.R2_B, U.ADMIN),
      "reject",
    ],
    [
      "CHAT-06: T1은 가리기를 되돌리지 못한다",
      "T1",
      updateMessage(M.R1_HIDDEN, `hidden_by = null`),
      "reject",
    ],
    [
      "ADM-04: 운영자는 가리기를 되돌리지 못한다",
      "운영자",
      updateMessage(M.R1_HIDDEN, `hidden_by = null`),
      "reject",
    ],
    [
      "CHAT-06: 운영자는 이미 가린 메시지의 hidden_by를 바꾸지 못한다",
      "운영자",
      hide(M.R1_HIDDEN, U.ADMIN),
      "reject",
    ],
    [
      "CHAT-06: T1은 메시지 body를 고치지 못한다",
      "T1",
      updateMessage(M.R1_A, `body = '고침'`),
      "reject",
    ],
    [
      "CHAT-06: T1은 메시지 image_url을 고치지 못한다",
      "T1",
      updateMessage(M.R1_IMG, `image_url = 'https://example.test/b6/changed.jpg'`),
      "reject",
    ],
    [
      "CHAT-06: T1은 메시지 kind를 고치지 못한다",
      "T1",
      updateMessage(M.R1_A, `kind = 'image', image_url = 'https://example.test/b6/k.jpg'`),
      "reject",
    ],
    [
      "CHAT-05: 학생A는 자기 메시지 body를 고치지 못한다",
      "학생A",
      updateMessage(M.R1_A, `body = '고침'`),
      "reject",
    ],
    [
      "CHAT-06: T1은 가리면서 body를 함께 고치지 못한다",
      "T1",
      updateMessage(M.R1_A, `hidden_by = '${U.T1}', body = '고침'`),
      "reject",
    ],
    ["ADM-02: 정지 T1은 방1의 메시지를 가린다", "T1", hide(M.R1_A, U.T1, suspendT1), "allow"],
    [
      "AUTH-07: 탈퇴 T1은 방1의 메시지를 가리지 못한다",
      "T1",
      hide(M.R1_A, U.T1, withdrawT1),
      "reject",
    ],
  ])("%s", async (_, actor, opCase, expected) => {
    expect(await attemptWrite(db, ACTORS[actor] as Actor, opCase)).toBe(expected);
  });
});

// ===========================================================================
// 준비 상태 확인
// ===========================================================================

describe("#41 준비 상태 확인 — ADM-02, AUTH-07, ADM-07", () => {
  it("ADM-02: suspendT1 뒤 T1은 suspended다", async () => {
    const { rows } = await queryAs<{ approval_status: string }>(
      db,
      service,
      `select approval_status::text as approval_status from public.trainer_profiles where user_id = $1`,
      [U.T1],
      { setup: suspendT1 },
    );
    expect(rows).toEqual([{ approval_status: "suspended" }]);
  });

  it("AUTH-07: withdrawT1·withdrawSA 뒤 그 사용자는 withdrawn이다", async () => {
    for (const [setup, id] of [
      [withdrawT1, U.T1],
      [withdrawSA, U.SA],
    ] as const) {
      const { rows } = await queryAs<{ status: string }>(
        db,
        service,
        `select status::text as status from public.users where id = $1`,
        [id],
        { setup },
      );
      expect(rows).toEqual([{ status: "withdrawn" }]);
    }
  });

  it("ADM-07: 준비 데이터에서 방1·DM2에는 신고된 메시지가 있고 방2·DM1에는 없다", async () => {
    const { rows } = await queryAs<{ room_id: string }>(
      db,
      service,
      `select distinct m.room_id from public.reports r
       join public.messages m on m.id = r.target_id
       where r.target_type = 'message' order by m.room_id`,
    );
    expect(rows.map((row) => row.room_id).sort()).toEqual([ROOM.R1, ROOM.DM2].sort());
  });
});

// ===========================================================================
// 요구사항 ID를 넣은 대표 칸 (매트릭스 title은 요구사항 추적이 세지 않는다)
// ===========================================================================

describe("#41 채팅 권한 대표 칸 — CHAT-02, CHAT-03, CHAT-04, CHAT-05, CHAT-07, DM-01, DM-03, DM-04, DM-05, ADM-07", () => {
  it.each<[string, ActorName, Op, OpCase, "allow" | "deny"]>([
    ["CHAT-04: 학생H(현재 참여자)는 방1을 읽는다", "학생H", "select", selectRoom(ROOM.R1), "allow"],
    [
      "CHAT-02: T1은 방1의 현재 참여 행을 읽는다",
      "T1",
      "select",
      selectMember(ROOM.R1, U.SH),
      "allow",
    ],
    [
      "CHAT-03: 학생C(나간 사람)는 방1을 읽지 못한다",
      "학생C",
      "select",
      selectRoom(ROOM.R1),
      "deny",
    ],
    [
      "CHAT-03: 학생C는 자기 참여 행을 읽는다",
      "학생C",
      "select",
      selectMember(ROOM.R1, U.SC),
      "allow",
    ],
    [
      "CHAT-04: 학생C는 방1의 다른 사람 참여 행을 읽지 못한다",
      "학생C",
      "select",
      selectMember(ROOM.R1, U.SA),
      "deny",
    ],
    ["CHAT-04: 학생B는 방1을 읽지 못한다", "학생B", "select", selectRoom(ROOM.R1), "deny"],
    ["CHAT-04: anon은 방1을 읽지 못한다", "anon", "select", selectRoom(ROOM.R1), "deny"],
    ["DM-01: 학생B는 DM1을 읽는다", "학생B", "select", selectRoom(ROOM.DM1), "allow"],
    ["DM-03: 학생G는 DM2를 읽는다", "학생G", "select", selectRoom(ROOM.DM2), "allow"],
    ["DM-03: 학생A는 DM2를 읽지 못한다", "학생A", "select", selectRoom(ROOM.DM2), "deny"],
    [
      "ADM-07: 운영자는 신고된 메시지가 있는 DM2를 읽는다",
      "운영자",
      "select",
      selectRoom(ROOM.DM2),
      "allow",
    ],
    [
      "ADM-07: 운영자는 신고가 없는 DM1을 읽지 못한다",
      "운영자",
      "select",
      selectRoom(ROOM.DM1),
      "deny",
    ],
    [
      "ADM-07: 운영자는 신고가 없는 방2를 읽지 못한다",
      "운영자",
      "select",
      selectRoom(ROOM.R2),
      "deny",
    ],
    [
      "CHAT-03: 학생H는 들어오기 전(11-05) 방1 메시지를 읽지 못한다",
      "학생H",
      "select",
      selectMessage(M.R1_OLD),
      "deny",
    ],
    [
      "CHAT-02: 학생H는 들어온 뒤 방1 메시지를 읽는다",
      "학생H",
      "select",
      selectMessage(M.R1_A),
      "allow",
    ],
    [
      "CHAT-03: 학생C는 나간 방1의 메시지를 읽지 못한다",
      "학생C",
      "select",
      selectMessage(M.R1_A),
      "deny",
    ],
    [
      "DM-01: 학생A는 DM1의 메시지를 읽지 못한다",
      "학생A",
      "select",
      selectMessage(M.DM1_B),
      "deny",
    ],
    [
      "CHAT-07: 학생G는 차단한 학생H의 방1 메시지를 읽지 못한다",
      "학생G",
      "select",
      selectMessage(M.R1_H),
      "deny",
    ],
    [
      "DM-05: 학생G는 차단한 학생H의 DM2 메시지를 읽지 못한다",
      "학생G",
      "select",
      selectMessage(M.DM2_H),
      "deny",
    ],
    [
      "CHAT-07: 학생H(차단당한 사람)는 학생G의 방1 메시지를 계속 읽는다",
      "학생H",
      "select",
      selectMessage(M.R1_G),
      "allow",
    ],
    [
      "DM-05: 학생H는 학생G의 DM2 메시지를 계속 읽는다",
      "학생H",
      "select",
      selectMessage(M.DM2_G),
      "allow",
    ],
    [
      "CHAT-06: 가린 메시지는 보낸 학생A도 읽지 못한다",
      "학생A",
      "select",
      selectMessage(M.R1_HIDDEN),
      "deny",
    ],
    [
      "CHAT-06: 가린 메시지를 방1의 트레이너 T1은 읽는다",
      "T1",
      "select",
      selectMessage(M.R1_HIDDEN),
      "allow",
    ],
    [
      "ADM-07: 운영자는 신고된 메시지가 있는 DM2의 메시지를 읽는다",
      "운영자",
      "select",
      selectMessage(M.DM2_H),
      "allow",
    ],
    [
      "ADM-07: 운영자는 신고가 없는 DM1의 메시지를 읽지 못한다",
      "운영자",
      "select",
      selectMessage(M.DM1_T),
      "deny",
    ],
    [
      "CHAT-05: 학생A는 방1에 메시지를 직접 넣지 못한다(서버만)",
      "학생A",
      "insert",
      insertMessage(ROOM.R1, U.SA),
      "deny",
    ],
    [
      "DM-04: 학생B는 DM1에 메시지를 직접 넣지 못한다(서버만)",
      "학생B",
      "insert",
      insertMessage(ROOM.DM1, U.SB),
      "deny",
    ],
    [
      "CHAT-07: 학생A는 자기 메시지를 지우지 못한다",
      "학생A",
      "delete",
      deleteMessage(M.R1_A),
      "deny",
    ],
    [
      "DM-05: 학생B는 자기 DM1 메시지를 지우지 못한다",
      "학생B",
      "delete",
      deleteMessage(M.DM1_B),
      "deny",
    ],
    [
      "CHAT-03: T1은 방1 참여 행을 만들지 못한다",
      "T1",
      "insert",
      {
        sql: `insert into public.chat_members (room_id, user_id, member_role) values ($1, $2, 'member')`,
        params: [ROOM.R1, U.SB],
      },
      "deny",
    ],
    [
      "CHAT-03: 학생C는 자기 참여 행을 지우지 못한다",
      "학생C",
      "delete",
      {
        sql: `delete from public.chat_members where room_id = $1 and user_id = $2`,
        params: [ROOM.R1, U.SC],
      },
      "deny",
    ],
    [
      "CHAT-03: 학생A는 채팅방을 만들지 못한다",
      "학생A",
      "insert",
      { sql: `insert into public.chat_rooms (type, trainer_id) values ('direct', null)` },
      "deny",
    ],
  ])("%s", async (_, actor, op, opCase, expected) => {
    expect(await attempt(db, ACTORS[actor] as Actor, op, opCase)).toBe(expected);
  });
});
