// 인수 테스트: 이슈 #38 — 무결성 트리거 오류 코드로 관계가 드러나는 문제 (#35, PR #37 후속)
// (QA가 개발 전에 쓴다. 개발은 고치지 않는다. 틀렸다고 보면 `[질문] 받는 역할: QA`)
//
// 문제: 클라이언트 insert에서 BEFORE 무결성 트리거(security definer)가 RLS with check보다 먼저 돈다.
// 권한 없는 사람이 남의 부모 행(숙제·제출·트레이너)에 쓰려 할 때, 대상이 관계 조건을 만족하면 트리거를
// 지나 RLS에서 42501, 만족하지 않으면 트리거에서 23514가 난다. 오류 코드로 읽을 수 없는 관계가 드러난다.
//
// 완료 조건
//   1. 권한 없는 쓰기는 대상의 관계(참여 학생인가, 누구의 영상인가, 회차 상태, 영상 길이, 행이 있는가)와
//      관계없이 같은 코드 42501로 거부된다.
//   2. 권한 있는 사람의 무결성 위반은 기존 코드(23514)를 유지하고, 바른 값은 그대로 허용된다(짝 테스트).
//      28-·32-·35- 인수 테스트는 그대로 통과해야 한다(이 파일 밖, 판정 때 실행한다).
//
// 점검 결과 (묶음 2~4, supabase/migrations/20261121*.sql)
//   관계에 따라 코드가 달라지는 곳(클라이언트 insert, 트리거가 with check보다 먼저 돈다):
//     homework_targets, homeworks, homework_videos, submissions, feedback_comments, trainer_profile_videos
//   코드가 달라지지 않는 곳(아래 "회귀 방지"로 지금 동작을 고정한다):
//     tickets·lesson_sessions·videos·lesson_products·group_classes의 클라이언트 update — RLS using이 먼저
//     행을 걸러 권한 없는 사람에게는 트리거가 돌지 않는다(항상 0행).
//   제외: 클라이언트 쓰기 권한(grant)이 없는 테이블·컬럼은 실행 전에 42501로 막힌다
//     (enrollments, payments, refunds, fee_policies, fixed_schedules, session_attendees, lesson_sessions의
//     insert·delete, videos insert, homeworks의 session_id·trainer_id update 등).
//   제외: 탈퇴한 본인(자기 숙제·회차)의 쓰기 — 코드가 갈려도 그 사람이 이미 RLS로 읽을 수 있는 관계라 새로
//     드러나는 정보가 없다.
//
// 준비 데이터와 역할은 35-fixture.ts(#32 사람 그대로). 권한 없는 사람 = T2(다른 트레이너), 학생B(T1과 수강 관계 없음).
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "../helpers/db.ts";
import { asUser, queryAs } from "../helpers/db.ts";
import { GC } from "./32-fixture.ts";
import { DURATION, HW, LS, SUB, TK, U, V, createBundle4Db } from "./35-fixture.ts";

let db: PGlite;

beforeAll(async () => {
  db = await createBundle4Db();
});

afterAll(async () => {
  await db?.close();
});

/** 없는 행 id (어느 테이블에도 없다) */
const MISSING = "00000000-0000-4000-8038-000000000001";

/**
 * actor로 쓰기를 시도하고 결과를 돌려준다. 항상 되돌린다.
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

const OUTSIDERS: [string, Actor][] = [
  ["T2(다른 트레이너)", asUser(U.T2)],
  ["학생B(수강 관계 없음)", asUser(U.SB)],
];
const T1 = asUser(U.T1);

/** 권한 없는 사람마다 × 대상 변형마다 42501인지 본다 */
const leakCases = <P extends unknown[]>(variants: [string, ...P][]) =>
  OUTSIDERS.flatMap(([who, actor]) =>
    variants.map(([what, ...params]) => [who, what, actor, params] as [string, string, Actor, P]),
  );

// ===========================================================================
// homework_targets — #35에서 발견된 곳
// ===========================================================================

const targetInsert = `insert into public.homework_targets (homework_id, student_id) values ($1, $2)`;

describe("#38 homework_targets: 권한 없는 대상 넣기는 참여 학생이든 아니든 42501 — HW-01, HW-03, HW-11", () => {
  it.each(
    leakCases<[string, string]>([
      ["HW1에 회차 참여 학생A", HW.HW1, U.SA],
      ["HW1에 회차 참여가 아닌 학생B", HW.HW1, U.SB],
      ["없는 숙제에 학생A", MISSING, U.SA],
    ]),
  )("HW-01: %s × %s → 42501", async (_who, _what, actor, params) => {
    expect(await outcome(actor, targetInsert, params)).toBe("42501");
  });
});

describe("#38 homework_targets 짝: 숙제 트레이너(T1)의 무결성 판정은 그대로 — HW-01, HW-03", () => {
  it("HW-03: T1이 HW1에 참여가 아닌 학생B → 23514", async () => {
    expect(await outcome(T1, targetInsert, [HW.HW1, U.SB])).toBe("23514");
  });
  it("HW-03: T1이 HW3에 회차 참여 학생H → 허용", async () => {
    expect(await outcome(T1, targetInsert, [HW.HW3, U.SH])).toBe("허용");
  });
});

// ===========================================================================
// homeworks — 남의 trainer_id로 쓰면 회차 주인·취소 상태가 드러난다
// ===========================================================================

const homeworkInsert = `insert into public.homeworks (session_id, trainer_id, description, due_at)
  values ($1, $2, '#38 숙제', '2026-12-31 19:00:00+09')`;

describe("#38 homeworks: T1 이름으로 숙제 내기는 회차 주인·상태와 관계없이 42501 — HW-01", () => {
  it.each(
    leakCases<[string, string]>([
      ["T1의 다가오는 회차 LS.A3", LS.A3, U.T1],
      ["T1의 취소된 회차 LS.A_CANCELED", LS.A_CANCELED, U.T1],
      ["T2의 회차 LS.B1", LS.B1, U.T1],
    ]),
  )("HW-01: %s × %s → 42501", async (_who, _what, actor, params) => {
    expect(await outcome(actor, homeworkInsert, params)).toBe("42501");
  });
});

describe("#38 homeworks 짝: 회차 트레이너(T1)의 무결성 판정은 그대로 — HW-01", () => {
  it("HW-01: T1이 취소된 회차 LS.A_CANCELED에 → 23514", async () => {
    expect(await outcome(T1, homeworkInsert, [LS.A_CANCELED, U.T1])).toBe("23514");
  });
  it("HW-01: T1이 T2의 회차 LS.B1에 → 23514", async () => {
    expect(await outcome(T1, homeworkInsert, [LS.B1, U.T1])).toBe("23514");
  });
  it("HW-01: T1이 자기 다가오는 회차 LS.A3에 → 허용", async () => {
    expect(await outcome(T1, homeworkInsert, [LS.A3, U.T1])).toBe("허용");
  });
});

// ===========================================================================
// homework_videos — 영상이 T1의 예시 영상인지 드러난다
// ===========================================================================

const homeworkVideoInsert = `insert into public.homework_videos (homework_id, video_id) values ($1, $2)`;

describe("#38 homework_videos: 남의 숙제에 영상 붙이기는 영상 주인·용도와 관계없이 42501 — HW-04", () => {
  it.each(
    leakCases<[string, string]>([
      ["HW1에 T1 예시 영상 EX_FREE", HW.HW1, V.EX_FREE],
      ["HW1에 T2 예시 영상 EX_T2", HW.HW1, V.EX_T2],
      ["HW1에 T1 프로필 영상 PR3", HW.HW1, V.PR3],
    ]),
  )("HW-04: %s × %s → 42501", async (_who, _what, actor, params) => {
    expect(await outcome(actor, homeworkVideoInsert, params)).toBe("42501");
  });
});

describe("#38 homework_videos 짝: 숙제 트레이너(T1)의 무결성 판정은 그대로 — HW-04", () => {
  it("HW-04: T1이 HW1에 T2 예시 영상 EX_T2 → 23514", async () => {
    expect(await outcome(T1, homeworkVideoInsert, [HW.HW1, V.EX_T2])).toBe("23514");
  });
  it("HW-04: T1이 HW1에 자기 프로필 영상 PR3 → 23514", async () => {
    expect(await outcome(T1, homeworkVideoInsert, [HW.HW1, V.PR3])).toBe("23514");
  });
  it("HW-04: T1이 HW1에 자기 예시 영상 EX_FREE → 허용", async () => {
    expect(await outcome(T1, homeworkVideoInsert, [HW.HW1, V.EX_FREE])).toBe("허용");
  });
});

// ===========================================================================
// submissions — 남의 student_id로 쓰면 숙제 대상 여부·영상 상태가 드러난다
// ===========================================================================

const submissionInsert = `insert into public.submissions (homework_id, student_id, video_id) values ($1, $2, $3)`;

describe("#38 submissions: 학생H 이름으로 제출하기는 숙제 대상·영상과 관계없이 42501 — HW-03, HW-06", () => {
  it.each(
    leakCases<[string, string, string]>([
      ["학생H가 대상인 HW2에 학생H의 PH2", HW.HW2, U.SH, V.PH2],
      ["학생H가 대상이 아닌 HW3에 학생H의 PH2", HW.HW3, U.SH, V.PH2],
      ["HW2에 학생G의 PG2", HW.HW2, U.SH, V.PG2],
    ]),
  )("HW-06: %s × %s → 42501", async (_who, _what, actor, params) => {
    expect(await outcome(actor, submissionInsert, params)).toBe("42501");
  });
});

describe("#38 submissions 짝: 학생 본인(학생H)의 무결성 판정은 그대로 — HW-03, HW-06", () => {
  const SH = asUser(U.SH);
  it("HW-03: 학생H가 대상이 아닌 HW3에 PH2 → 23514", async () => {
    expect(await outcome(SH, submissionInsert, [HW.HW3, U.SH, V.PH2])).toBe("23514");
  });
  it("HW-06: 학생H가 HW2에 학생G의 PG2 → 23514", async () => {
    expect(await outcome(SH, submissionInsert, [HW.HW2, U.SH, V.PG2])).toBe("23514");
  });
  it("HW-06: 학생H가 HW2에 자기 PH2 → 허용", async () => {
    expect(await outcome(SH, submissionInsert, [HW.HW2, U.SH, V.PH2])).toBe("허용");
  });
});

// ===========================================================================
// feedback_comments — 남의 author_id로 쓰면 제출의 트레이너·영상 길이가 드러난다
// ===========================================================================

const feedbackInsert = `insert into public.feedback_comments (submission_id, author_id, body, at_sec)
  values ($1, $2, '#38 코멘트', $3)`;

describe("#38 feedback_comments: T1 이름으로 피드백 달기는 제출·시점과 관계없이 42501 — HW-10", () => {
  it.each(
    leakCases<[string, string, number | null]>([
      ["T1 숙제의 제출 SUB.H에 텍스트 코멘트", SUB.H, U.T1, null],
      ["SUB.H에 영상 끝(DURATION초) 시점 코멘트", SUB.H, U.T1, DURATION],
      ["SUB.H에 영상 길이를 넘는(DURATION+1초) 시점 코멘트", SUB.H, U.T1, DURATION + 1],
      ["없는 제출에 텍스트 코멘트", MISSING, U.T1, null],
    ]),
  )("HW-10: %s × %s → 42501", async (_who, _what, actor, params) => {
    expect(await outcome(actor, feedbackInsert, params)).toBe("42501");
  });
});

describe("#38 feedback_comments 짝: 숙제 트레이너(T1)의 무결성 판정은 그대로 — HW-10", () => {
  it("HW-10: T1이 SUB.H에 DURATION+1초 → 23514", async () => {
    expect(await outcome(T1, feedbackInsert, [SUB.H, U.T1, DURATION + 1])).toBe("23514");
  });
  it("HW-10: T1이 SUB.H에 DURATION초 → 허용", async () => {
    expect(await outcome(T1, feedbackInsert, [SUB.H, U.T1, DURATION])).toBe("허용");
  });
  it("HW-10: T1이 SUB.H에 텍스트 코멘트 → 허용", async () => {
    expect(await outcome(T1, feedbackInsert, [SUB.H, U.T1, null])).toBe("허용");
  });
});

// ===========================================================================
// trainer_profile_videos — 남의 trainer_id로 쓰면 영상의 용도·업로드 상태가 드러난다
// ===========================================================================

const profileVideoInsert = `insert into public.trainer_profile_videos (trainer_id, video_id, sort_order)
  values ($1, $2, 3)`;

describe("#38 trainer_profile_videos: T1 프로필에 영상 붙이기는 영상과 관계없이 42501 — TRN-07", () => {
  it.each(
    leakCases<[string, string]>([
      ["T1의 ready 프로필 영상 PR4", U.T1, V.PR4],
      ["T1의 uploading 프로필 영상 PR_UPLOADING", U.T1, V.PR_UPLOADING],
      ["T1의 예시 영상 EX_FREE", U.T1, V.EX_FREE],
    ]),
  )("TRN-07: %s × %s → 42501", async (_who, _what, actor, params) => {
    expect(await outcome(actor, profileVideoInsert, params)).toBe("42501");
  });
});

describe("#38 trainer_profile_videos 짝: 트레이너 본인(T1)의 무결성 판정은 그대로 — TRN-07", () => {
  it("TRN-07: T1이 uploading 영상 PR_UPLOADING → 23514", async () => {
    expect(await outcome(T1, profileVideoInsert, [U.T1, V.PR_UPLOADING])).toBe("23514");
  });
  it("TRN-07: T1이 예시 영상 EX_FREE → 23514", async () => {
    expect(await outcome(T1, profileVideoInsert, [U.T1, V.EX_FREE])).toBe("23514");
  });
  it("TRN-07: T1이 ready 프로필 영상 PR4 → 허용", async () => {
    expect(await outcome(T1, profileVideoInsert, [U.T1, V.PR4])).toBe("허용");
  });
});

// ===========================================================================
// 회귀 방지: 클라이언트 update는 RLS using이 먼저 걸러 권한 없는 사람에게는 대상과 관계없이 0행이다.
// 지금 통과한다. 고친 뒤에도 트리거·정책 순서가 바뀌어 코드가 갈리지 않는지 본다.
// ===========================================================================

describe("#38 회귀 방지: 권한 없는 update는 대상과 관계없이 0행 — TRN-04, SCH-03, HW-05", () => {
  const T2 = asUser(U.T2);

  it.each<[string, string | null]>([
    ["T1의 반 R2로", GC.R2],
    ["T2 자기 반으로", GC.T2],
    ["배정 해제(null)", null],
  ])("TRN-04: T2 × T1 학생G 수강권 TK.G 반 배정 %s → 0행", async (_what, classId) => {
    expect(
      await outcome(T2, `update public.tickets set group_class_id = $1 where id = $2`, [
        classId,
        TK.G,
      ]),
    ).toBe("0행");
  });

  it.each<[string, string]>([
    ["차감 없는 다가오는 회차 LS.A2", LS.A2],
    ["차감된 지난 회차 LS.A1", LS.A1],
    ["취소된 회차 LS.A_CANCELED", LS.A_CANCELED],
  ])("SCH-03: T2 × T1 %s 시간 변경 → 0행", async (_what, sessionId) => {
    expect(
      await outcome(
        T2,
        `update public.lesson_sessions
           set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour'
         where id = $1`,
        [sessionId],
      ),
    ).toBe("0행");
  });

  it.each<[string, string]>([
    ["예시 영상 EX1", V.EX1],
    ["프로필 영상 PR1", V.PR1],
  ])("HW-05: T2 × T1 %s 보관함 숨김 → 0행", async (_what, videoId) => {
    expect(
      await outcome(T2, `update public.videos set hidden_in_library = true where id = $1`, [
        videoId,
      ]),
    ).toBe("0행");
  });
});
