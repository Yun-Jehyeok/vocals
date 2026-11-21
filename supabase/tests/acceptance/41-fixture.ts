// 인수 테스트 #41 묶음 6(채팅·후기·신고·알림)의 준비 데이터와 준비 작업. QA가 쓴다. 개발은 고치지 않는다.
//
// 사람·수강권·회차는 #32 준비 데이터를 그대로 쓰고(이슈 #41 완료 조건: "#32·#35와 같은 사람을 쓴다"),
// #35 준비 데이터(createBundle4Db) 위에 이번 묶음의 행을 서버(service_role)로 넣는다.
// 채팅방·참여 행·메시지·후기·답글·기기 토큰·알림은 서버만 쓴다는 전제다(이슈 #41 팀장 결정 1).
// 차단·신고는 클라이언트가 쓰지만 준비 데이터라 서버로 넣는다. 토큰·사진 주소는 가짜 값이다.
// 테이블이 아직 없으면(개발 전) 준비 데이터 적용이 실패하고, 그 파일의 테스트가 모두 실패한다. 정상이다.
//
// 역할 (이슈 #41 완료 조건의 표기, 사람은 #32와 같다)
//   T1 = 트레이너. 정지 T·탈퇴 T는 준비 작업(suspendT1, withdrawT1)으로 T1의 상태를 바꿔 만든다.
//   학생A = T1의 1:1 정기권 active(TK.A, 출석 차감 회차 있음), 학생G·학생H = R1 배정,
//   학생C = T1과의 수강권 모두 ended(TK.C, 출석 회차 있음), 학생B = T1과 수강 관계 없음(T2의 학생),
//   T2 = 다른 트레이너, 운영자 = seed의 활성 admin
// 방
//   방1(ROOM.R1) = T1의 단체 채팅방. 현재 참여: T1 admin(11-01), 학생A(11-01), 학생G(11-01),
//     학생H(11-10에 들어옴). 학생C는 ticket_ended로 나간 줄
//   방2(ROOM.R2) = T2의 단체 채팅방(T2 admin, 학생B). 신고된 메시지 없음
//   DM1(ROOM.DM1) = 학생B ↔ T1 1:1 대화(문의). 신고된 메시지 없음
//   DM2(ROOM.DM2) = 학생G ↔ 학생H 1:1 대화. 학생H가 학생G의 메시지를 신고함(RP.DM2_MSG)
// 후기
//   RV1 = 학생A가 TK.A에 쓴 후기(T1 답글 있음), RV2 = 학생C가 TK.C에 쓴 후기, 운영자가 가림(T1 답글 있음)
// 차단: 학생G → 학생H (BL.G_H)
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { SA as ATT, LS, TK, U } from "./32-fixture.ts";
import { createBundle4Db, suspendT1, withdrawSA, withdrawT1 } from "./35-fixture.ts";
import type { Setup } from "./35-fixture.ts";

export { LS, TK, U, suspendT1, withdrawSA, withdrawT1 };
export type { Setup };

const uuid = (suffix: string) => `00000000-0000-4000-8041-0000000000${suffix}`;

/** chat_rooms */
export const ROOM = {
  /** T1 단체 채팅방 */
  R1: uuid("01"),
  /** T2 단체 채팅방 */
  R2: uuid("02"),
  /** 학생B ↔ T1 1:1 대화 */
  DM1: uuid("03"),
  /** 학생G ↔ 학생H 1:1 대화 */
  DM2: uuid("04"),
} as const;

/** 참여 시각 (메시지 읽기 범위 판정, 팀장 결정 2) */
export const JOINED = {
  R1: "2026-11-01 09:00:00+09",
  /** 학생H는 방1에 늦게 들어왔다. M.R1_OLD(11-05)는 학생H가 들어오기 전 메시지다 */
  R1_SH: "2026-11-10 09:00:00+09",
  R1_SC: "2025-06-01 09:00:00+09",
  R1_SC_LEFT: "2026-06-01 09:00:00+09",
  R2: "2026-11-01 09:00:00+09",
  DM1: "2026-11-05 09:00:00+09",
  DM2: "2026-11-12 09:00:00+09",
} as const;

/** messages */
export const M = {
  /** 방1, 학생A 텍스트, 11-05 — 학생H가 들어오기 전 */
  R1_OLD: uuid("11"),
  /** 방1, 학생A 텍스트, 11-15 */
  R1_A: uuid("12"),
  /** 방1, 학생G 텍스트, 11-15 — 학생A가 신고함(RP.R1_MSG) */
  R1_G: uuid("13"),
  /** 방1, 학생H 텍스트, 11-16 — 학생G가 학생H를 차단해서 학생G에게 보이지 않는다 */
  R1_H: uuid("14"),
  /** 방1, T1 사진, 11-16 */
  R1_IMG: uuid("15"),
  /** 방1, 학생A 텍스트, 11-17, T1이 가림 */
  R1_HIDDEN: uuid("16"),
  /** 방2, 학생B 텍스트 */
  R2_B: uuid("21"),
  /** DM1, 학생B 텍스트(문의) */
  DM1_B: uuid("31"),
  /** DM1, T1 텍스트(답) */
  DM1_T: uuid("32"),
  /** DM2, 학생G 텍스트 — 학생H가 신고함(RP.DM2_MSG) */
  DM2_G: uuid("41"),
  /** DM2, 학생H 텍스트 — 학생G가 차단해서 학생G에게 보이지 않는다 */
  DM2_H: uuid("42"),
} as const;

/** reviews */
export const RV = {
  /** 학생A, TK.A, T1 답글 있음 */
  RV1: uuid("51"),
  /** 학생C, TK.C, hidden = true, T1 답글 있음 */
  RV2: uuid("52"),
} as const;

/** blocks */
export const BL = {
  /** 학생G가 학생H를 차단 */
  G_H: uuid("61"),
} as const;

/** reports */
export const RP = {
  /** 학생H가 DM2의 학생G 메시지(M.DM2_G)를 신고, open */
  DM2_MSG: uuid("71"),
  /** 학생A가 방1의 학생G 메시지(M.R1_G)를 신고, open */
  R1_MSG: uuid("72"),
  /** 학생B가 RV1을 신고, resolved(운영자 처리) */
  RV1: uuid("73"),
  /** 학생G가 사용자 학생H를 신고, open */
  USER_H: uuid("74"),
} as const;

/** push_tokens */
export const PT = {
  T1_IOS: uuid("81"),
  SA_ANDROID: uuid("82"),
} as const;

/** notifications */
export const N = {
  /** 학생A, 읽지 않음 */
  SA_UNREAD: uuid("91"),
  /** 학생A, 읽음 */
  SA_READ: uuid("92"),
  /** T1, 읽지 않음 */
  T1_UNREAD: uuid("93"),
} as const;

/** 준비 작업이 만드는 행 */
export const NEW = {
  /** waitingTicketForSC가 만드는 학생C의 결제·일정 대기 수강권 */
  PAY_SC: uuid("a1"),
  TK_SC_WAITING: uuid("a2"),
  /** reviewForSG가 만드는 학생G의 후기(TK.G, 보강 기록 있음) */
  RV_G: uuid("a3"),
  /** directRoomSASG가 만드는 학생A ↔ 학생G 1:1 대화 */
  DM_SA_SG: uuid("a4"),
  /** directRoomSBT1Again이 만드는 학생B ↔ T1의 두 번째 1:1 대화 */
  DM_SB_T1_AGAIN: uuid("a5"),
} as const;

/** 없는 행 id (어느 테이블에도 없다) */
export const MISSING = "00000000-0000-4000-8041-0000000000ff";

export const FIXTURE_SQL = `
insert into public.chat_rooms (id, type, trainer_id) values
  ('${ROOM.R1}', 'group', '${U.T1}'),
  ('${ROOM.R2}', 'group', '${U.T2}'),
  ('${ROOM.DM1}', 'direct', null),
  ('${ROOM.DM2}', 'direct', null);

insert into public.chat_members (room_id, user_id, member_role, muted, joined_at, left_at, left_reason) values
  ('${ROOM.R1}', '${U.T1}', 'admin', false, '${JOINED.R1}', null, null),
  ('${ROOM.R1}', '${U.SA}', 'member', false, '${JOINED.R1}', null, null),
  ('${ROOM.R1}', '${U.SG}', 'member', true, '${JOINED.R1}', null, null),
  ('${ROOM.R1}', '${U.SH}', 'member', false, '${JOINED.R1_SH}', null, null),
  ('${ROOM.R1}', '${U.SC}', 'member', false, '${JOINED.R1_SC}', '${JOINED.R1_SC_LEFT}', 'ticket_ended'),
  ('${ROOM.R2}', '${U.T2}', 'admin', false, '${JOINED.R2}', null, null),
  ('${ROOM.R2}', '${U.SB}', 'member', false, '${JOINED.R2}', null, null),
  ('${ROOM.DM1}', '${U.SB}', 'member', false, '${JOINED.DM1}', null, null),
  ('${ROOM.DM1}', '${U.T1}', 'member', false, '${JOINED.DM1}', null, null),
  ('${ROOM.DM2}', '${U.SG}', 'member', false, '${JOINED.DM2}', null, null),
  ('${ROOM.DM2}', '${U.SH}', 'member', false, '${JOINED.DM2}', null, null);

insert into public.messages (id, room_id, sender_id, kind, body, image_url, hidden_by, created_at) values
  ('${M.R1_OLD}', '${ROOM.R1}', '${U.SA}', 'text', '묶음6 방1 오래된 메시지', null, null, '2026-11-05 10:00:00+09'),
  ('${M.R1_A}', '${ROOM.R1}', '${U.SA}', 'text', '묶음6 방1 학생A', null, null, '2026-11-15 10:00:00+09'),
  ('${M.R1_G}', '${ROOM.R1}', '${U.SG}', 'text', '묶음6 방1 학생G', null, null, '2026-11-15 10:05:00+09'),
  ('${M.R1_H}', '${ROOM.R1}', '${U.SH}', 'text', '묶음6 방1 학생H', null, null, '2026-11-16 10:00:00+09'),
  ('${M.R1_IMG}', '${ROOM.R1}', '${U.T1}', 'image', null, 'https://example.test/b6/r1-img.jpg', null, '2026-11-16 11:00:00+09'),
  ('${M.R1_HIDDEN}', '${ROOM.R1}', '${U.SA}', 'text', '묶음6 방1 가린 메시지', null, '${U.T1}', '2026-11-17 10:00:00+09'),
  ('${M.R2_B}', '${ROOM.R2}', '${U.SB}', 'text', '묶음6 방2 학생B', null, null, '2026-11-15 10:00:00+09'),
  ('${M.DM1_B}', '${ROOM.DM1}', '${U.SB}', 'text', '묶음6 DM1 문의', null, null, '2026-11-06 10:00:00+09'),
  ('${M.DM1_T}', '${ROOM.DM1}', '${U.T1}', 'text', '묶음6 DM1 답', null, null, '2026-11-06 11:00:00+09'),
  ('${M.DM2_G}', '${ROOM.DM2}', '${U.SG}', 'text', '묶음6 DM2 학생G', null, null, '2026-11-13 10:00:00+09'),
  ('${M.DM2_H}', '${ROOM.DM2}', '${U.SH}', 'text', '묶음6 DM2 학생H', null, null, '2026-11-14 10:00:00+09');

insert into public.reviews (id, trainer_id, student_id, ticket_id, body, hidden) values
  ('${RV.RV1}', '${U.T1}', '${U.SA}', '${TK.A}', '묶음6 RV1 후기', false),
  ('${RV.RV2}', '${U.T1}', '${U.SC}', '${TK.C}', '묶음6 RV2 가린 후기', true);

insert into public.review_replies (review_id, body) values
  ('${RV.RV1}', '묶음6 RV1 답글'),
  ('${RV.RV2}', '묶음6 RV2 답글');

insert into public.blocks (id, blocker_id, blocked_id) values
  ('${BL.G_H}', '${U.SG}', '${U.SH}');

insert into public.reports (id, reporter_id, target_type, target_id, reason, status, handled_by) values
  ('${RP.DM2_MSG}', '${U.SH}', 'message', '${M.DM2_G}', '묶음6 DM2 신고', 'open', null),
  ('${RP.R1_MSG}', '${U.SA}', 'message', '${M.R1_G}', '묶음6 방1 신고', 'open', null),
  ('${RP.RV1}', '${U.SB}', 'review', '${RV.RV1}', '묶음6 후기 신고', 'resolved', '${U.ADMIN}'),
  ('${RP.USER_H}', '${U.SG}', 'user', '${U.SH}', '묶음6 사용자 신고', 'open', null);

insert into public.push_tokens (id, user_id, token, platform) values
  ('${PT.T1_IOS}', '${U.T1}', 'b6-fake-token-t1-ios', 'ios'),
  ('${PT.SA_ANDROID}', '${U.SA}', 'b6-fake-token-sa-android', 'android');

insert into public.notifications (id, user_id, type, payload, read_at) values
  ('${N.SA_UNREAD}', '${U.SA}', 'homework_created', '{"screen": "S-14"}', null),
  ('${N.SA_READ}', '${U.SA}', 'feedback_added', '{"screen": "S-16"}', '2026-11-20 10:00:00+09'),
  ('${N.T1_UNREAD}', '${U.T1}', 'homework_submitted', '{"screen": "T-17"}', null);
`;

/**
 * #35 준비 데이터(#32 포함)가 들어간 테스트 DB에 #41 준비 데이터를 서버(service_role)로 넣는다(커밋).
 * 실패하면(개발 전: 테이블 없음) 그 파일의 테스트가 모두 실패한다.
 */
export async function createBundle6Db(): Promise<PGlite> {
  const db = await createBundle4Db();
  try {
    await db.transaction(async (tx) => {
      await tx.exec("set local role service_role");
      await tx.exec(FIXTURE_SQL);
    });
  } catch (error) {
    await db.close();
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`#41 준비 데이터를 서버(service_role)로 넣지 못했다: ${message}`, {
      cause: error,
    });
  }
  return db;
}

// ---------------------------------------------------------------------------
// 준비 작업 (OpCase.setup / withActor setup). 관리자로 시작하므로 서버 역할로 바꿔 실행한다.
// ---------------------------------------------------------------------------

async function asServer(tx: Transaction, sql: string): Promise<void> {
  await tx.exec("set local role service_role");
  await tx.exec(sql);
  await tx.exec("reset role");
}

/** 서버가 학생G를 탈퇴 처리한 상태 (AUTH-07) */
export const withdrawSG: Setup = (tx) =>
  asServer(tx, `update public.users set status = 'withdrawn' where id = '${U.SG}'`);

/** 학생C가 T1에게 다시 결제해 일정 대기 수강권만 생긴 상태 (CHAT-03 "다시 등록", S-03) */
export const waitingTicketForSC: Setup = (tx) =>
  asServer(
    tx,
    `
insert into public.payments (id, student_id, product_id, amount, method, pg_transaction_id, status, paid_at)
select '${NEW.PAY_SC}', '${U.SC}', p.id, p.price, 'card', 'b6-pg-sc-re', 'paid', '2026-11-21 10:00:00+09'
from public.lesson_products p
where p.trainer_id = '${U.T1}' and p.lesson_type = 'private' and p.ticket_type = 'regular';

insert into public.tickets
  (id, enrollment_id, product_id, payment_id, lesson_type, ticket_type, total_sessions,
   remaining_sessions, price_paid, fee_rate, valid_until, group_class_id, status, end_reason)
select '${NEW.TK_SC_WAITING}', e.id, pay.product_id, pay.id, 'private', 'regular', 4, 4, pay.amount, 0.08,
       '2027-11-21', null, 'waiting_schedule', null
from public.enrollments e, public.payments pay
where e.student_id = '${U.SC}' and e.trainer_id = '${U.T1}' and pay.id = '${NEW.PAY_SC}';
`,
  );

/** 학생G의 R1 회차(TK.G)를 보강(makeup)으로 기록한 상태 — 후기 자격 있음 (REV-02) */
export const makeupForSG: Setup = (tx) =>
  asServer(
    tx,
    `update public.session_attendees
     set attendance = 'makeup', deducted = true, session_amount = 30000,
         checked_at = '2026-12-05 11:00:00+09'
     where id = '${ATT.R1A_G}'`,
  );

/** 학생B의 T2 회차(TK.B)를 학생 사전 취소로 기록한 상태 — 후기 자격 없음 */
export const preCanceledForSB: Setup = (tx) =>
  asServer(
    tx,
    `update public.session_attendees
     set attendance = 'pre_canceled', canceled_by = 'student', checked_at = '2026-12-01 10:00:00+09'
     where id = '${ATT.B1}'`,
  );

/** 학생B의 T2 회차(TK.B)를 결석으로 기록한 상태 — 후기 자격 없음 */
export const absentForSB: Setup = (tx) =>
  asServer(
    tx,
    `update public.session_attendees
     set attendance = 'absent', deducted = true, session_amount = 40000,
         checked_at = '2026-12-04 21:00:00+09'
     where id = '${ATT.B1}'`,
  );

/** 학생B의 T2 회차(TK.B)를 출석으로 기록한 상태 — 후기 자격 있음(허용 짝) */
export const presentForSB: Setup = (tx) =>
  asServer(
    tx,
    `update public.session_attendees
     set attendance = 'present', deducted = true, session_amount = 40000,
         checked_at = '2026-12-04 21:00:00+09'
     where id = '${ATT.B1}'`,
  );

/** 학생G가 TK.G(보강 기록)에 후기를 쓴 상태 — 답글이 없다 */
export const reviewForSG: Setup = async (tx) => {
  await makeupForSG(tx);
  await asServer(
    tx,
    `insert into public.reviews (id, trainer_id, student_id, ticket_id, body)
     values ('${NEW.RV_G}', '${U.T1}', '${U.SG}', '${TK.G}', '묶음6 학생G 후기')`,
  );
};

/** 학생A ↔ 학생G 1:1 대화를 만들고 학생A만 넣은 상태 */
export const directRoomSASG: Setup = (tx) =>
  asServer(
    tx,
    `insert into public.chat_rooms (id, type, trainer_id) values ('${NEW.DM_SA_SG}', 'direct', null);
     insert into public.chat_members (room_id, user_id, member_role) values ('${NEW.DM_SA_SG}', '${U.SA}', 'member');`,
  );

/** 학생B ↔ T1의 두 번째 1:1 대화를 만들고 학생B만 넣은 상태 (DM1이 이미 있다) */
export const directRoomSBT1Again: Setup = (tx) =>
  asServer(
    tx,
    `insert into public.chat_rooms (id, type, trainer_id) values ('${NEW.DM_SB_T1_AGAIN}', 'direct', null);
     insert into public.chat_members (room_id, user_id, member_role) values ('${NEW.DM_SB_T1_AGAIN}', '${U.SB}', 'member');`,
  );

/** 서버가 학생G의 방1 참여 행을 지운 상태 (다시 넣기 판정용) */
export const removeSGFromR1: Setup = (tx) =>
  asServer(
    tx,
    `delete from public.chat_members where room_id = '${ROOM.R1}' and user_id = '${U.SG}'`,
  );

/** 여러 준비 작업을 차례로 */
export const both =
  (...setups: Setup[]): Setup =>
  async (tx) => {
    for (const setup of setups) await setup(tx);
  };
