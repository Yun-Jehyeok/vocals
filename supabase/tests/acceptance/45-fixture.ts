// 인수 테스트 #45 사용자 이용 제한(ADM-04)의 준비 데이터와 준비 작업. QA가 쓴다. 개발은 고치지 않는다.
//
// 사람·방·수강권·후기는 #41 준비 데이터(createBundle6Db, #32·#35 포함)를 그대로 쓰고(이슈 #45 완료 조건:
// "#41과 같은 사람을 쓴다"), 그 위에 이번 이슈의 행을 서버(service_role)로 넣는다.
// 제한 줄은 운영자 클라이언트가 쓰는 테이블이지만 준비 데이터라 서버로 넣는다.
// 판정에 쓰는 행은 seed와 겹치지 않는 id(…-8045-…)로 만들고, seed 사용자에게는 제한 줄을 넣지 않는다.
// 준비 상태 확인은 이 파일의 id·사람 범위 안에서만 본다(seed가 바뀌어도 흔들리지 않게, #41에서 배운 것).
// 테이블이 아직 없으면(개발 전) 준비 데이터 적용이 실패하고, 그 파일의 테스트가 모두 실패(skipped)한다. 정상이다.
//
// 역할 (이슈 #45 완료 조건의 표기, 사람은 #41과 같다)
//   T1 = 트레이너, 학생A = T1의 1:1 정기권 active(출석 차감 회차 있음), 학생G·학생H = T1의 그룹 반 R1 학생,
//   학생B = T2의 학생, T2 = 다른 트레이너, 정지 T = suspendT1로 T1을 정지한 상태,
//   운영자 = seed의 활성 admin, 운영자2 = 이 파일이 만드는 다른 활성 admin,
//   탈퇴 운영자 = 이 파일이 만드는 users.status = withdrawn인 admin, 서버 = service_role
// 방: 방1 = ROOM.R1(T1·학생A·학생G·학생H), 방2 = ROOM.R2(T2·학생B), DM2 = ROOM.DM2(학생G ↔ 학생H)
// 제한 줄
//   제한G(RS.G)     = 학생G의 풀리지 않은 줄
//   지난G(RS.G_OLD) = 학생G의 풀린 지난 줄(같은 사용자의 지난 줄·새 줄)
//   제한T2(RS.T2)   = T2의 풀리지 않은 줄
//   해제H(RS.H)     = 학생H의 풀린 줄(학생H는 지금 제한 중이 아님)
//   학생A·T1·학생B에게는 제한 줄이 없다.
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { TK, U, createBundle6Db } from "./41-fixture.ts";
import type { Setup } from "./41-fixture.ts";
import { LS } from "./32-fixture.ts";
import { HW, V } from "./35-fixture.ts";

export {
  BL,
  M,
  NEW,
  ROOM,
  RV,
  TK,
  U,
  both,
  directRoomSASG,
  makeupForSG,
  presentForSB,
  removeSGFromR1,
  suspendT1,
} from "./41-fixture.ts";
export { HW, LS, V };
export type { Setup };

const uuid = (suffix: string) => `00000000-0000-4000-8045-0000000000${suffix}`;

/** 이 파일이 만드는 사용자 */
export const U45 = {
  /** 다른 활성 운영자 */
  ADMIN2: uuid("01"),
  /** 탈퇴한 운영자 (users.status = withdrawn) */
  ADMIN_W: uuid("02"),
} as const;

/** user_restrictions */
export const RS = {
  /** 제한G: 학생G, 풀리지 않음 */
  G: uuid("11"),
  /** 지난G: 학생G, 풀림 */
  G_OLD: uuid("12"),
  /** 제한T2: T2, 풀리지 않음 */
  T2: uuid("13"),
  /** 해제H: 학생H, 풀림 */
  H: uuid("14"),
} as const;

/** 준비 데이터의 제한 줄 id 전부 */
export const ALL_RS: readonly string[] = Object.values(RS);

/** 이 파일의 준비 데이터 범위의 사람 (준비 상태 확인용) */
export const FIXTURE_USERS: readonly string[] = [
  U.T1,
  U.T2,
  U.SA,
  U.SB,
  U.SC,
  U.SG,
  U.SH,
  U45.ADMIN2,
  U45.ADMIN_W,
];

/** 준비 작업이 만드는 행 */
export const NEW45 = {
  /** restrictSA가 만드는 학생A의 제한 줄 */
  RS_SA: uuid("21"),
  /** reviewForSBOnT2가 만드는 학생B의 T2 후기(TK.B, 출석 기록) */
  RV_B: uuid("31"),
  /** submissionForT2가 만드는 T2의 숙제(LS.B1)·학생B 제출(V.PB) */
  HW_T2: uuid("41"),
  SUB_B: uuid("42"),
} as const;

export const FIXTURE_SQL = `
insert into auth.users (id, email) values
  ('${U45.ADMIN2}', 'b45.admin2@example.test'),
  ('${U45.ADMIN_W}', 'b45.admin-w@example.test');

insert into public.users (id, role, nickname, status) values
  ('${U45.ADMIN2}', 'admin', '묶음45운영자2', 'active'),
  ('${U45.ADMIN_W}', 'admin', '묶음45탈퇴운영자', 'withdrawn');

insert into public.user_restrictions (id, user_id, reason, restricted_by, created_at, lifted_at, lifted_by) values
  ('${RS.G_OLD}', '${U.SG}', '#45 학생G 지난 제한', '${U.ADMIN}', '2026-11-01 10:00:00+09', '2026-11-05 10:00:00+09', '${U.ADMIN}'),
  ('${RS.G}', '${U.SG}', '#45 학생G 제한', '${U.ADMIN}', '2026-11-18 10:00:00+09', null, null),
  ('${RS.T2}', '${U.T2}', '#45 T2 제한', '${U.ADMIN}', '2026-11-18 11:00:00+09', null, null),
  ('${RS.H}', '${U.SH}', '#45 학생H 지난 제한', '${U.ADMIN}', '2026-11-02 10:00:00+09', '2026-11-06 10:00:00+09', '${U45.ADMIN2}');
`;

/**
 * #41 준비 데이터(#32·#35 포함)가 들어간 테스트 DB에 #45 준비 데이터를 서버(service_role)로 넣는다(커밋).
 * 실패하면(개발 전: 테이블 없음) 그 파일의 테스트가 모두 실패한다.
 */
export async function createBundle7Db(): Promise<PGlite> {
  const db = await createBundle6Db();
  try {
    await db.transaction(async (tx) => {
      await tx.exec("set local role service_role");
      await tx.exec(FIXTURE_SQL);
    });
  } catch (error) {
    await db.close();
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`#45 준비 데이터를 서버(service_role)로 넣지 못했다: ${message}`, {
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

/** 운영자가 제한G를 푼 상태 (학생G는 지난 줄 둘만 있다) */
export const liftG: Setup = (tx) =>
  asServer(
    tx,
    `update public.user_restrictions set lifted_at = '2026-11-21 10:00:00+09', lifted_by = '${U.ADMIN}'
     where id = '${RS.G}'`,
  );

/** 운영자가 제한T2를 푼 상태 */
export const liftT2: Setup = (tx) =>
  asServer(
    tx,
    `update public.user_restrictions set lifted_at = '2026-11-21 10:00:00+09', lifted_by = '${U.ADMIN}'
     where id = '${RS.T2}'`,
  );

/** 운영자가 학생A를 제한한 상태 (학생A는 후기 RV1을 이미 썼다) */
export const restrictSA: Setup = (tx) =>
  asServer(
    tx,
    `insert into public.user_restrictions (id, user_id, reason, restricted_by)
     values ('${NEW45.RS_SA}', '${U.SA}', '#45 학생A 제한', '${U.ADMIN}')`,
  );

/** 학생B가 TK.B(출석 기록)로 T2에게 후기를 쓴 상태 — 답글이 없다. 학생B는 제한 중이 아니다 */
export const reviewForSBOnT2: Setup = async (tx) => {
  await asServer(
    tx,
    `update public.session_attendees
     set attendance = 'present', deducted = true, session_amount = 40000,
         checked_at = '2026-12-04 21:00:00+09'
     where ticket_id = '${TK.B}'`,
  );
  await asServer(
    tx,
    `insert into public.reviews (id, trainer_id, student_id, ticket_id, body)
     values ('${NEW45.RV_B}', '${U.T2}', '${U.SB}', '${TK.B}', '#45 학생B의 T2 후기')`,
  );
};

/** T2가 LS.B1에 숙제를 내고 학생B가 V.PB로 제출한 상태 (피드백 대상) */
export const submissionForT2: Setup = (tx) =>
  asServer(
    tx,
    `insert into public.homeworks (id, session_id, trainer_id, description, due_at)
     values ('${NEW45.HW_T2}', '${LS.B1}', '${U.T2}', '#45 T2 숙제', '2026-12-11 20:00:00+09');
     insert into public.homework_targets (homework_id, student_id) values ('${NEW45.HW_T2}', '${U.SB}');
     insert into public.submissions (id, homework_id, student_id, video_id, question)
     values ('${NEW45.SUB_B}', '${NEW45.HW_T2}', '${U.SB}', '${V.PB}', null);`,
  );
