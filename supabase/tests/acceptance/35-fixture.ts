// 인수 테스트 #35 묶음 4(숙제·영상·피드백)의 준비 데이터와 준비 작업. QA가 쓴다. 개발은 고치지 않는다.
//
// 사람·수강권·회차는 #32 준비 데이터(32-fixture.ts, createBundle3Db)를 그대로 쓴다(이슈 #35 완료 조건:
// "#32와 같은 사람을 쓴다"). 그 위에 이번 묶음의 영상·숙제·제출·피드백·프로필 영상을 서버(service_role)로 넣는다.
// 영상 행은 서버만 만든다는 전제다(이슈 #35 팀장 결정 1). storage_key는 가짜 값이다.
// 테이블이 아직 없으면(개발 전) 준비 데이터 적용이 실패하고, 그 파일의 테스트가 모두 실패한다. 정상이다.
//
// 역할 (이슈 #35 완료 조건의 표기, 사람은 #32와 같다)
//   T1 = 트레이너. 정지 T·탈퇴 T는 준비 작업(suspendT1, withdrawT1)으로 T1의 상태를 바꿔 만든다.
//   학생A = T1의 1:1 정기권 active(TK.A), 학생G·학생H = R1 배정, 학생C = T1과의 수강권 모두 ended,
//   학생B = T1과 수강 관계 없음(T2의 학생), T2 = 다른 트레이너, 운영자 = seed의 활성 admin
// 숙제
//   HW1 = T1이 학생A의 1:1 회차(LS.A1)에 낸 숙제, 예시 영상 EX1
//   HW2 = T1이 R1 회차(LS.R1A)에 학생G·학생H 모두에게 낸 숙제, 예시 영상 EX2·EX_HIDDEN(숨김)
//   HW3 = T1이 같은 R1 회차에 학생G에게만 낸 숙제, 예시 영상 EX3
//   HW_C = T1이 학생C의 지난 회차(LS.C1, 끝난 수강권)에 낸 숙제, 예시 영상 없음
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { LS, TK, U, createBundle3Db } from "./32-fixture.ts";

export { LS, TK, U };

const uuid = (suffix: string) => `00000000-0000-4000-8035-0000000000${suffix}`;

/** videos */
export const V = {
  /** T1 예시, ready, HW1에 붙음 */
  EX1: uuid("01"),
  /** T1 예시, ready, HW2에 붙음 */
  EX2: uuid("02"),
  /** T1 예시, ready, HW3에만 붙음 */
  EX3: uuid("03"),
  /** T1 예시, ready, 보관함에서 숨김(hidden_in_library), HW2에 붙음 */
  EX_HIDDEN: uuid("04"),
  /** T1 예시, ready, 어느 숙제에도 붙지 않음(보관함에만 있음) */
  EX_FREE: uuid("05"),
  /** T1 예시, uploading */
  EX_UPLOADING: uuid("06"),
  /** T2 예시, ready, 붙지 않음 */
  EX_T2: uuid("07"),
  /** 학생A 연습(TK.A), ready, 제출 SUB.A1에 쓰임 */
  PA1: uuid("11"),
  /** 학생A 연습(TK.A), ready, 제출에 붙지 않음 */
  PA2: uuid("12"),
  /** 학생A 연습(TK.A), uploading, 제출에 붙지 않음 */
  PA_UPLOADING: uuid("13"),
  /** 학생A 연습(TK.A), failed, 제출에 붙지 않음 */
  PA_FAILED: uuid("14"),
  /** 학생A 연습(일회권 TK.AS), ready, 제출에 붙지 않음 — HW1 회차 참여 수강권(TK.A)과 다르다 */
  PA_AS: uuid("15"),
  /** 학생G 연습(TK.G), ready, 제출 SUB.G에 쓰임 */
  PG1: uuid("16"),
  /** 학생G 연습(TK.G), ready, 제출에 붙지 않음 */
  PG2: uuid("17"),
  /** 학생H 연습(TK.H), ready, 제출 SUB.H에 쓰임 */
  PH1: uuid("18"),
  /** 학생H 연습(TK.H), ready, 제출에 붙지 않음 */
  PH2: uuid("19"),
  /** 학생C 연습(TK.C, ended), ready, 제출 SUB.C에 쓰임, purge_after·purge_notified_at 있음 */
  PC1: uuid("1a"),
  /** 학생C 연습(TK.C, ended), ready, 제출에 붙지 않음 */
  PC2: uuid("1b"),
  /** 학생B 연습(TK.B, T2 수강권), ready, 제출에 붙지 않음 */
  PB: uuid("1c"),
  /** T1 프로필, ready, sort_order 1로 붙음 */
  PR1: uuid("21"),
  /** T1 프로필, ready, sort_order 2로 붙음 */
  PR2: uuid("22"),
  /** T1 프로필, ready, 붙지 않음(프로필에서 뺀 영상) */
  PR3: uuid("23"),
  /** T1 프로필, ready, 붙지 않음 */
  PR4: uuid("24"),
  /** T1 프로필, uploading */
  PR_UPLOADING: uuid("25"),
  /** T2 프로필, ready, sort_order 1로 붙음 */
  PR_T2: uuid("26"),
} as const;

/** homeworks */
export const HW = {
  HW1: uuid("31"),
  HW2: uuid("32"),
  HW3: uuid("33"),
  HW_C: uuid("34"),
} as const;

/** submissions */
export const SUB = {
  /** HW1, 학생A, PA1 */
  A1: uuid("41"),
  /** HW2, 학생G, PG1 */
  G: uuid("42"),
  /** HW2, 학생H, PH1 */
  H: uuid("43"),
  /** HW_C, 학생C, PC1 */
  C: uuid("44"),
} as const;

/** feedback_comments */
export const FB = {
  /** SUB.H에 T1의 텍스트 코멘트 */
  H_TEXT: uuid("51"),
  /** SUB.H에 T1의 시점 코멘트(at_sec 10) */
  H_AT: uuid("52"),
  /** SUB.A1에 T1의 텍스트 코멘트 */
  A1_TEXT: uuid("53"),
} as const;

/** 준비 데이터 영상 길이(초). 시점 코멘트 범위 판정에 쓴다 */
export const DURATION = 120;

/** 학생C 연습 영상(PC1)의 보관 기한 값 — 서버가 넣은 값 그대로 남는지 본다 */
export const PC1_PURGE_AFTER = "2026-06-01 00:00:00+09";
export const PC1_PURGE_NOTIFIED_AT = "2026-05-01 10:00:00+09";

const video = (
  id: string,
  owner: string,
  purpose: "profile" | "example" | "practice",
  status: "uploading" | "ready" | "failed",
  ticket: string | null,
  extra: { hidden?: boolean; purgeAfter?: string; notifiedAt?: string } = {},
) => {
  const ready = status === "ready";
  return `('${id}', '${owner}', '${purpose}', ${ready || status === "failed" ? `'b4-${id}'` : "null"}, ${
    ready ? DURATION : "null"
  }, '${status}', ${extra.hidden ? "true" : "false"}, ${ticket ? `'${ticket}'` : "null"}, ${
    extra.purgeAfter ? `'${extra.purgeAfter}'` : "null"
  }, ${extra.notifiedAt ? `'${extra.notifiedAt}'` : "null"})`;
};

const FIXTURE_SQL = `
insert into public.videos
  (id, owner_id, purpose, storage_key, duration_sec, upload_status, hidden_in_library, ticket_id,
   purge_after, purge_notified_at) values
  ${[
    video(V.EX1, U.T1, "example", "ready", null),
    video(V.EX2, U.T1, "example", "ready", null),
    video(V.EX3, U.T1, "example", "ready", null),
    video(V.EX_HIDDEN, U.T1, "example", "ready", null, { hidden: true }),
    video(V.EX_FREE, U.T1, "example", "ready", null),
    video(V.EX_UPLOADING, U.T1, "example", "uploading", null),
    video(V.EX_T2, U.T2, "example", "ready", null),
    video(V.PA1, U.SA, "practice", "ready", TK.A),
    video(V.PA2, U.SA, "practice", "ready", TK.A),
    video(V.PA_UPLOADING, U.SA, "practice", "uploading", TK.A),
    video(V.PA_FAILED, U.SA, "practice", "failed", TK.A),
    video(V.PA_AS, U.SA, "practice", "ready", TK.AS),
    video(V.PG1, U.SG, "practice", "ready", TK.G),
    video(V.PG2, U.SG, "practice", "ready", TK.G),
    video(V.PH1, U.SH, "practice", "ready", TK.H),
    video(V.PH2, U.SH, "practice", "ready", TK.H),
    video(V.PC1, U.SC, "practice", "ready", TK.C, {
      purgeAfter: PC1_PURGE_AFTER,
      notifiedAt: PC1_PURGE_NOTIFIED_AT,
    }),
    video(V.PC2, U.SC, "practice", "ready", TK.C),
    video(V.PB, U.SB, "practice", "ready", TK.B),
    video(V.PR1, U.T1, "profile", "ready", null),
    video(V.PR2, U.T1, "profile", "ready", null),
    video(V.PR3, U.T1, "profile", "ready", null),
    video(V.PR4, U.T1, "profile", "ready", null),
    video(V.PR_UPLOADING, U.T1, "profile", "uploading", null),
    video(V.PR_T2, U.T2, "profile", "ready", null),
  ].join(",\n  ")};

insert into public.homeworks (id, session_id, trainer_id, description, due_at) values
  ('${HW.HW1}', '${LS.A1}', '${U.T1}', '묶음4 HW1 호흡 연습', '2026-11-05 19:00:00+09'),
  ('${HW.HW2}', '${LS.R1A}', '${U.T1}', '묶음4 HW2 그룹 전체 발성', '2026-12-12 10:00:00+09'),
  ('${HW.HW3}', '${LS.R1A}', '${U.T1}', '묶음4 HW3 학생G만 고음', '2026-12-12 10:00:00+09'),
  ('${HW.HW_C}', '${LS.C1}', '${U.T1}', '묶음4 학생C 지난 숙제', '2025-06-11 18:00:00+09');

insert into public.homework_targets (homework_id, student_id) values
  ('${HW.HW1}', '${U.SA}'),
  ('${HW.HW2}', '${U.SG}'),
  ('${HW.HW2}', '${U.SH}'),
  ('${HW.HW3}', '${U.SG}'),
  ('${HW.HW_C}', '${U.SC}');

insert into public.homework_videos (homework_id, video_id) values
  ('${HW.HW1}', '${V.EX1}'),
  ('${HW.HW2}', '${V.EX2}'),
  ('${HW.HW2}', '${V.EX_HIDDEN}'),
  ('${HW.HW3}', '${V.EX3}');

insert into public.submissions (id, homework_id, student_id, video_id, question) values
  ('${SUB.A1}', '${HW.HW1}', '${U.SA}', '${V.PA1}', '묶음4 학생A 질문'),
  ('${SUB.G}', '${HW.HW2}', '${U.SG}', '${V.PG1}', null),
  ('${SUB.H}', '${HW.HW2}', '${U.SH}', '${V.PH1}', null),
  ('${SUB.C}', '${HW.HW_C}', '${U.SC}', '${V.PC1}', null);

insert into public.feedback_comments (id, submission_id, author_id, body, at_sec) values
  ('${FB.H_TEXT}', '${SUB.H}', '${U.T1}', '묶음4 학생H 전체 코멘트', null),
  ('${FB.H_AT}', '${SUB.H}', '${U.T1}', '묶음4 학생H 10초 코멘트', 10),
  ('${FB.A1_TEXT}', '${SUB.A1}', '${U.T1}', '묶음4 학생A 전체 코멘트', null);

insert into public.trainer_profile_videos (trainer_id, video_id, sort_order) values
  ('${U.T1}', '${V.PR1}', 1),
  ('${U.T1}', '${V.PR2}', 2),
  ('${U.T2}', '${V.PR_T2}', 1);
`;

/**
 * #32 준비 데이터가 들어간 테스트 DB에 #35 준비 데이터를 서버(service_role)로 넣는다(커밋).
 * 실패하면(개발 전: 테이블 없음) 그 파일의 테스트가 모두 실패한다.
 */
export async function createBundle4Db(): Promise<PGlite> {
  const db = await createBundle3Db();
  try {
    await db.transaction(async (tx) => {
      await tx.exec("set local role service_role");
      await tx.exec(FIXTURE_SQL);
    });
  } catch (error) {
    await db.close();
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`#35 준비 데이터를 서버(service_role)로 넣지 못했다: ${message}`, {
      cause: error,
    });
  }
  return db;
}

// ---------------------------------------------------------------------------
// 준비 작업 (OpCase.setup / withActor setup). 관리자로 시작하므로 서버 역할로 바꿔 실행한다.
// ---------------------------------------------------------------------------

export type Setup = (tx: Transaction) => Promise<void>;

async function asServer(tx: Transaction, fn: () => Promise<unknown>): Promise<void> {
  await tx.exec("set local role service_role");
  await fn();
  await tx.exec("reset role");
}

/** 운영자가 T1을 정지한 상태 (ADM-02) */
export const suspendT1: Setup = (tx) =>
  asServer(tx, () =>
    tx.query(
      `update public.trainer_profiles set approval_status = 'suspended' where user_id = $1`,
      [U.T1],
    ),
  );

/** 서버가 탈퇴 처리한 상태 (AUTH-07) */
const withdraw =
  (userId: string): Setup =>
  (tx) =>
    asServer(tx, () =>
      tx.query(`update public.users set status = 'withdrawn' where id = $1`, [userId]),
    );

export const withdrawT1: Setup = withdraw(U.T1);
export const withdrawSA: Setup = withdraw(U.SA);

/** T1 프로필에 PR3을 sort_order 3으로 붙여 3개를 채운 상태 (TRN-07) */
export const fillT1Profile: Setup = (tx) =>
  asServer(tx, () =>
    tx.query(
      `insert into public.trainer_profile_videos (trainer_id, video_id, sort_order) values ($1, $2, 3)`,
      [U.T1, V.PR3],
    ),
  );

/** 여러 준비 작업을 차례로 */
export const both =
  (...setups: Setup[]): Setup =>
  async (tx) => {
    for (const setup of setups) await setup(tx);
  };
