// 인수 테스트: 이슈 #35 묶음 4 — 값·관계 제약(서버 쓰기에도 걸린다), 제출 시각, 여러 번 제출, 보관 기한
// (QA가 개발 전에 쓴다. 개발은 고치지 않는다. 틀렸다고 보면 `[질문] 받는 역할: QA`)
//
// 준비 데이터와 역할은 35-fixture.ts. 값·관계 제약은 서버(service_role) insert·update에도 걸린다(팀장 결정 4).
// 값 검사는 attemptWrite(제약·트리거 거부도 거부)로 판정하고, 거부마다 허용되는 짝(바른 값)을 둔다.
// DB는 purge_after를 계산하거나 채우지 않는다(HW-14, AUTH-08, CLAUDE.md 도메인 규칙). 컬럼과 값 검사만 본다.
// 테스트로 쓰지 않는 것: visibility에 private 밖의 값을 넣는 시도(enum에 값이 없어 22P02가 나므로 거부 판정이 아니라
//   enum 값 판정으로 대신한다, 35-schema-seed.test.ts)
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, service, withActor } from "../helpers/db.ts";
import { attemptWrite } from "../helpers/rls-matrix.ts";
import type { OpCase } from "../helpers/rls-matrix.ts";
import type { Setup } from "./35-fixture.ts";
import {
  DURATION,
  FB,
  HW,
  LS,
  PC1_PURGE_AFTER,
  PC1_PURGE_NOTIFIED_AT,
  SUB,
  TK,
  U,
  V,
  createBundle4Db,
  fillT1Profile,
  withdrawSA,
} from "./35-fixture.ts";

let db: PGlite;

beforeAll(async () => {
  db = await createBundle4Db();
});

afterAll(async () => {
  await db?.close();
});

const sql = (text: string, setup?: Setup): OpCase => ({ sql: text, ...(setup ? { setup } : {}) });
const lit = (value: string | null) => (value === null ? "null" : `'${value}'`);

// ===========================================================================
// videos
// ===========================================================================

type VideoValues = {
  owner_id: string;
  purpose: string;
  storage_key: string | null;
  duration_sec: string;
  upload_status: string;
  ticket_id: string | null;
  purge_after: string | null;
  purge_notified_at: string | null;
};

let keySeq = 0;
/** 바른 영상: T1의 예시 영상, ready, 길이 60초, 새 storage_key */
const videoInsert = (overrides: Partial<VideoValues> = {}) => {
  keySeq += 1;
  const values: VideoValues = {
    owner_id: U.T1,
    purpose: "example",
    storage_key: `b4-integrity-${keySeq}`,
    duration_sec: "60",
    upload_status: "ready",
    ticket_id: null,
    purge_after: null,
    purge_notified_at: null,
    ...overrides,
  };
  return sql(`insert into public.videos
    (owner_id, purpose, storage_key, duration_sec, upload_status, ticket_id, purge_after, purge_notified_at)
    values (${lit(values.owner_id)}, ${lit(values.purpose)}, ${lit(values.storage_key)}, ${values.duration_sec},
            ${lit(values.upload_status)}, ${lit(values.ticket_id)}, ${lit(values.purge_after)},
            ${lit(values.purge_notified_at)})`);
};

describe("#35 영상 값 검사 — HW-08, TRN-07, NFR-04, HW-14 (팀장 결정 4)", () => {
  it.each<[string, OpCase, "allow" | "reject"]>([
    ["HW-08: 길이 1초", videoInsert({ duration_sec: "1" }), "allow"],
    ["HW-08: 길이 300초", videoInsert({ duration_sec: "300" }), "allow"],
    ["HW-08: 길이 301초", videoInsert({ duration_sec: "301" }), "reject"],
    ["HW-08: 길이 0초", videoInsert({ duration_sec: "0" }), "reject"],
    [
      "TRN-07: 프로필 영상 길이 301초",
      videoInsert({ purpose: "profile", duration_sec: "301" }),
      "reject",
    ],
    [
      "TRN-07: 프로필 영상 길이 300초",
      videoInsert({ purpose: "profile", duration_sec: "300" }),
      "allow",
    ],
    [
      "HW-08: 연습 영상 길이 301초",
      videoInsert({ owner_id: U.SA, purpose: "practice", ticket_id: TK.A, duration_sec: "301" }),
      "reject",
    ],
    [
      "HW-09: uploading이면 길이·storage_key가 비어도 된다",
      videoInsert({ upload_status: "uploading", duration_sec: "null", storage_key: null }),
      "allow",
    ],
    ["HW-09: ready인데 길이가 없다", videoInsert({ duration_sec: "null" }), "reject"],
    ["NFR-04: ready인데 storage_key가 없다", videoInsert({ storage_key: null }), "reject"],
    [
      "NFR-04: storage_key가 다른 영상과 같다",
      videoInsert({ storage_key: `b4-${V.EX1}` }),
      "reject",
    ],
  ])("서버 × videos insert: %s → %s", async (_, opCase, expected) => {
    expect(await attemptWrite(db, service, opCase)).toBe(expected);
  });

  it.each<[string, string, "allow" | "reject"]>([
    [
      "HW-08: 길이를 300초로",
      `update public.videos set duration_sec = 300 where id = '${V.PA2}'`,
      "allow",
    ],
    [
      "HW-08: 길이를 301초로",
      `update public.videos set duration_sec = 301 where id = '${V.PA2}'`,
      "reject",
    ],
    [
      "HW-09: uploading 영상을 길이·키와 함께 ready로",
      `update public.videos set upload_status = 'ready', duration_sec = 90, storage_key = 'b4-upd-ok'
       where id = '${V.PA_UPLOADING}'`,
      "allow",
    ],
    [
      "HW-09: uploading 영상을 길이 없이 ready로",
      `update public.videos set upload_status = 'ready', storage_key = 'b4-upd-no-dur'
       where id = '${V.PA_UPLOADING}'`,
      "reject",
    ],
    [
      "NFR-04: storage_key를 다른 영상 것으로",
      `update public.videos set storage_key = 'b4-${V.EX1}' where id = '${V.PA2}'`,
      "reject",
    ],
  ])("서버 × videos update: %s → %s", async (_, text, expected) => {
    expect(await attemptWrite(db, service, sql(text))).toBe(expected);
  });

  it.each<[string, OpCase, "allow" | "reject"]>([
    [
      "HW-14: 학생A 연습 영상, 학생A의 수강권",
      videoInsert({ owner_id: U.SA, purpose: "practice", ticket_id: TK.A }),
      "allow",
    ],
    [
      "HW-14: 연습 영상인데 ticket_id가 없다",
      videoInsert({ owner_id: U.SA, purpose: "practice", ticket_id: null }),
      "reject",
    ],
    [
      "HW-14: 예시 영상인데 ticket_id가 있다",
      videoInsert({ purpose: "example", ticket_id: TK.A }),
      "reject",
    ],
    [
      "TRN-07: 프로필 영상인데 ticket_id가 있다",
      videoInsert({ purpose: "profile", ticket_id: TK.A }),
      "reject",
    ],
    [
      "HW-14: 학생A 연습 영상인데 학생G의 수강권",
      videoInsert({ owner_id: U.SA, purpose: "practice", ticket_id: TK.G }),
      "reject",
    ],
    [
      "HW-04: 예시 영상을 학생이 올림",
      videoInsert({ owner_id: U.SA, purpose: "example" }),
      "reject",
    ],
    [
      "TRN-07: 프로필 영상을 학생이 올림",
      videoInsert({ owner_id: U.SA, purpose: "profile" }),
      "reject",
    ],
    [
      "TRN-07: 프로필 영상을 트레이너가 올림",
      videoInsert({ owner_id: U.T1, purpose: "profile" }),
      "allow",
    ],
    [
      "HW-04: 예시 영상을 운영자가 올림",
      videoInsert({ owner_id: U.ADMIN, purpose: "example" }),
      "reject",
    ],
    [
      "HW-06: 연습 영상을 트레이너가 올림(그 트레이너의 학생 수강권)",
      videoInsert({ owner_id: U.T1, purpose: "practice", ticket_id: TK.A }),
      "reject",
    ],
  ])("서버 × videos insert: %s → %s", async (_, opCase, expected) => {
    expect(await attemptWrite(db, service, opCase)).toBe(expected);
  });

  it.each<[string, OpCase, "allow" | "reject"]>([
    [
      "purge_after만 있음(연습 영상)",
      videoInsert({
        owner_id: U.SA,
        purpose: "practice",
        ticket_id: TK.A,
        purge_after: "2027-12-01 00:00:00+09",
      }),
      "allow",
    ],
    [
      "purge_after·purge_notified_at 둘 다 있음",
      videoInsert({
        owner_id: U.SA,
        purpose: "practice",
        ticket_id: TK.A,
        purge_after: "2027-12-01 00:00:00+09",
        purge_notified_at: "2027-11-01 10:00:00+09",
      }),
      "allow",
    ],
    [
      "purge_notified_at만 있음",
      videoInsert({
        owner_id: U.SA,
        purpose: "practice",
        ticket_id: TK.A,
        purge_notified_at: "2027-11-01 10:00:00+09",
      }),
      "reject",
    ],
    [
      "AUTH-08: 예시 영상에도 purge_after를 넣을 수 있다(탈퇴 규칙, PM 질문 1)",
      videoInsert({ purpose: "example", purge_after: "2027-06-01 00:00:00+09" }),
      "allow",
    ],
    [
      "AUTH-08: 프로필 영상에도 purge_after를 넣을 수 있다(탈퇴 규칙, PM 질문 1)",
      videoInsert({ purpose: "profile", purge_after: "2027-06-01 00:00:00+09" }),
      "allow",
    ],
  ])("HW-14·AUTH-08: 서버 × videos insert: %s → %s", async (_, opCase, expected) => {
    expect(await attemptWrite(db, service, opCase)).toBe(expected);
  });

  it("AUTH-08: 서버는 붙어 있는 예시 영상(EX1)에 purge_after를 넣을 수 있다(탈퇴 트레이너, PM 질문 1)", async () => {
    expect(
      await attemptWrite(
        db,
        service,
        sql(
          `update public.videos set purge_after = '2027-06-01 00:00:00+09' where id = '${V.EX1}'`,
        ),
      ),
    ).toBe("allow");
  });

  it("HW-12: visibility를 주지 않고 넣으면 private이다", async () => {
    const rows = await withActor(
      db,
      service,
      async (tx) =>
        (
          await tx.query<{ visibility: string }>(
            `insert into public.videos (owner_id, purpose, storage_key, duration_sec, upload_status)
           values ($1, 'example', 'b4-visibility-default', 60, 'ready') returning visibility::text`,
            [U.T1],
          )
        ).rows,
    );
    expect(rows).toEqual([{ visibility: "private" }]);
  });
});

// ===========================================================================
// homeworks · homework_targets · homework_videos
// ===========================================================================

const homeworkInsert = (
  sessionId: string,
  trainerId: string,
  description = "'묶음4 무결성 숙제'",
  dueAt = "'2026-12-10 19:00:00+09'",
) =>
  sql(`insert into public.homeworks (session_id, trainer_id, description, due_at)
       values ('${sessionId}', '${trainerId}', ${description}, ${dueAt})`);

describe("#35 숙제 무결성 — HW-01, HW-02 (팀장 결정 4)", () => {
  it.each<[string, OpCase, "allow" | "reject"]>([
    ["HW-01: T1이 자기 1:1 회차(LS.A2)에", homeworkInsert(LS.A2, U.T1), "allow"],
    ["HW-01: 한 회차에 숙제를 하나 더(LS.R1A에 세 번째)", homeworkInsert(LS.R1A, U.T1), "allow"],
    ["HW-01: trainer_id가 T2인데 T1의 회차", homeworkInsert(LS.A2, U.T2), "reject"],
    ["HW-01: trainer_id가 T1인데 T2의 회차(LS.B1)", homeworkInsert(LS.B1, U.T1), "reject"],
    ["HW-01: 취소된 회차(LS.A_CANCELED)", homeworkInsert(LS.A_CANCELED, U.T1), "reject"],
    ["HW-02: 설명이 빈 문자열", homeworkInsert(LS.A2, U.T1, "''"), "reject"],
    [
      "HW-02: 마감이 지난 날짜여도 된다(기본값·검사 없음)",
      homeworkInsert(LS.A2, U.T1, undefined, "'2026-01-01 00:00:00+09'"),
      "allow",
    ],
  ])("서버 × homeworks insert: %s → %s", async (_, opCase, expected) => {
    expect(await attemptWrite(db, service, opCase)).toBe(expected);
  });

  it.each<[string, string, "allow" | "reject"]>([
    [
      "HW-01: 숙제를 T2의 회차로 옮김",
      `update public.homeworks set session_id = '${LS.B1}' where id = '${HW.HW1}'`,
      "reject",
    ],
    [
      "HW-01: 숙제를 취소된 회차로 옮김",
      `update public.homeworks set session_id = '${LS.A_CANCELED}' where id = '${HW.HW1}'`,
      "reject",
    ],
    [
      "HW-01: trainer_id를 T2로",
      `update public.homeworks set trainer_id = '${U.T2}' where id = '${HW.HW1}'`,
      "reject",
    ],
    [
      "HW-02: 설명을 빈 문자열로",
      `update public.homeworks set description = '' where id = '${HW.HW1}'`,
      "reject",
    ],
    [
      "HW-02: 설명을 다른 글로",
      `update public.homeworks set description = '묶음4 고친 설명' where id = '${HW.HW1}'`,
      "allow",
    ],
  ])("서버 × homeworks update: %s → %s", async (_, text, expected) => {
    expect(await attemptWrite(db, service, sql(text))).toBe(expected);
  });
});

const targetInsert = (homeworkId: string, studentId: string) =>
  sql(
    `insert into public.homework_targets (homework_id, student_id) values ('${homeworkId}', '${studentId}')`,
  );

describe("#35 숙제 대상 무결성 — HW-01, HW-03 (팀장 결정 4)", () => {
  it.each<[string, OpCase, "allow" | "reject"]>([
    ["HW-03: HW3에 같은 회차 참여 학생H", targetInsert(HW.HW3, U.SH), "allow"],
    ["HW-03: HW3에 수강 관계 없는 학생B", targetInsert(HW.HW3, U.SB), "reject"],
    [
      "HW-03: HW3에 같은 트레이너의 다른 학생(회차 참여 행 없는 학생A)",
      targetInsert(HW.HW3, U.SA),
      "reject",
    ],
    [
      "HW-01: HW1에 같은 트레이너의 학생C(그 회차 참여 행 없음)",
      targetInsert(HW.HW1, U.SC),
      "reject",
    ],
    ["HW-03: (HW2, 학생G)를 한 번 더", targetInsert(HW.HW2, U.SG), "reject"],
    ["HW-03: 트레이너를 대상으로", targetInsert(HW.HW3, U.T1), "reject"],
  ])("서버 × homework_targets insert: %s → %s", async (_, opCase, expected) => {
    expect(await attemptWrite(db, service, opCase)).toBe(expected);
  });
});

const homeworkVideoInsert = (homeworkId: string, videoId: string) =>
  sql(
    `insert into public.homework_videos (homework_id, video_id) values ('${homeworkId}', '${videoId}')`,
  );

describe("#35 숙제 예시 영상 무결성 — HW-04, HW-05 (팀장 결정 4)", () => {
  it.each<[string, OpCase, "allow" | "reject"]>([
    [
      "HW-05: HW3에 T1의 예시 영상 EX1(다른 숙제에 쓴 것을 다시 씀)",
      homeworkVideoInsert(HW.HW3, V.EX1),
      "allow",
    ],
    ["HW-05: HW3에 T1의 숨긴 예시 영상", homeworkVideoInsert(HW.HW3, V.EX_HIDDEN), "allow"],
    ["HW-04: HW3에 T1의 보관함 예시 영상", homeworkVideoInsert(HW.HW3, V.EX_FREE), "allow"],
    ["HW-04: HW3에 학생G의 연습 영상", homeworkVideoInsert(HW.HW3, V.PG2), "reject"],
    ["HW-04: HW3에 T1의 프로필 영상", homeworkVideoInsert(HW.HW3, V.PR3), "reject"],
    ["HW-04: HW3에 T2의 예시 영상", homeworkVideoInsert(HW.HW3, V.EX_T2), "reject"],
    ["HW-04: (HW2, EX2)를 한 번 더", homeworkVideoInsert(HW.HW2, V.EX2), "reject"],
  ])("서버 × homework_videos insert: %s → %s", async (_, opCase, expected) => {
    expect(await attemptWrite(db, service, opCase)).toBe(expected);
  });
});

// ===========================================================================
// submissions
// ===========================================================================

const submissionInsert = (homeworkId: string, studentId: string, videoId: string, setup?: Setup) =>
  sql(
    `insert into public.submissions (homework_id, student_id, video_id)
     values ('${homeworkId}', '${studentId}', '${videoId}')`,
    setup,
  );

describe("#35 제출 무결성 — HW-03, HW-06, HW-07, HW-12, HW-14 (팀장 결정 4·5)", () => {
  it.each<[string, OpCase, "allow" | "reject"]>([
    [
      "HW-06: 학생A가 HW1에 자기 연습 영상 PA2(TK.A)",
      submissionInsert(HW.HW1, U.SA, V.PA2),
      "allow",
    ],
    ["HW-07: 마감(due_at)이 지난 HW1에도 제출한다", submissionInsert(HW.HW1, U.SA, V.PA2), "allow"],
    [
      "HW-07: 학생C가 끝난 수강권 회차의 HW_C에 PC2",
      submissionInsert(HW.HW_C, U.SC, V.PC2),
      "allow",
    ],
    ["HW-12: 학생G가 HW3에 PG2", submissionInsert(HW.HW3, U.SG, V.PG2), "allow"],
    ["HW-12: 대상이 아닌 학생H가 HW3에 PH2", submissionInsert(HW.HW3, U.SH, V.PH2), "reject"],
    ["HW-03: 대상이 아닌 학생B가 HW1에 PB", submissionInsert(HW.HW1, U.SB, V.PB), "reject"],
    ["HW-06: 학생A가 학생G의 연습 영상 PG2로", submissionInsert(HW.HW1, U.SA, V.PG2), "reject"],
    ["HW-06: 학생A가 uploading 영상으로", submissionInsert(HW.HW1, U.SA, V.PA_UPLOADING), "reject"],
    ["HW-06: 학생A가 failed 영상으로", submissionInsert(HW.HW1, U.SA, V.PA_FAILED), "reject"],
    ["HW-06: 학생A가 이미 제출에 쓴 PA1로", submissionInsert(HW.HW1, U.SA, V.PA1), "reject"],
    ["HW-06: 학생A가 예시 영상 EX1로", submissionInsert(HW.HW1, U.SA, V.EX1), "reject"],
    [
      "HW-14: 학생A가 다른 수강권(일회권 TK.AS)의 연습 영상으로 HW1(회차 참여 수강권 TK.A)에",
      submissionInsert(HW.HW1, U.SA, V.PA_AS),
      "reject",
    ],
  ])("서버 × submissions insert: %s → %s", async (_, opCase, expected) => {
    expect(await attemptWrite(db, service, opCase)).toBe(expected);
  });

  it("HW-06: 영상 하나는 제출 하나에만 쓰인다 — PA2로 HW1에 두 번 제출하면 두 번째가 거부된다", async () => {
    const results = await withActor(db, service, async (tx) => {
      const first = await tx.query(
        `insert into public.submissions (homework_id, student_id, video_id) values ($1, $2, $3)`,
        [HW.HW1, U.SA, V.PA2],
      );
      await tx.exec("savepoint second");
      try {
        await tx.query(
          `insert into public.submissions (homework_id, student_id, video_id) values ($1, $2, $3)`,
          [HW.HW1, U.SA, V.PA2],
        );
        return { first: first.affectedRows, second: "allow" };
      } catch (error) {
        await tx.exec("rollback to savepoint second");
        return { first: first.affectedRows, second: String((error as { code?: unknown }).code) };
      }
    });
    expect(results.first).toBe(1);
    expect(results.second).toMatch(/^(23\d{3}|P0001)$/);
  });

  it("HW-07: 같은 숙제에 다시 제출하면 줄이 쌓이고 앞 제출은 그대로다(학생A, 클라이언트)", async () => {
    const result = await withActor(db, asUser(U.SA), async (tx) => {
      const inserted = await tx.query(
        `insert into public.submissions (homework_id, student_id, video_id) values ($1, $2, $3)`,
        [HW.HW1, U.SA, V.PA2],
      );
      const rows = await tx.query<{ id: string; video_id: string }>(
        `select id, video_id from public.submissions where homework_id = $1 and student_id = $2
         order by video_id`,
        [HW.HW1, U.SA],
      );
      return { inserted: inserted.affectedRows, rows: rows.rows };
    });
    expect(result.inserted).toBe(1);
    expect(result.rows.length).toBe(2);
    expect(result.rows.find((row) => row.id === SUB.A1)?.video_id).toBe(V.PA1);
  });

  it("HW-07·HW-11: submitted_at은 DB가 넣는다 — 학생이 과거 시각을 넣으면 거부되거나 DB 시각으로 바뀐다", async () => {
    const outcome = await withActor(db, asUser(U.SA), async (tx) => {
      await tx.exec("savepoint try_submit");
      try {
        const { rows } = await tx.query<{ near_now: boolean }>(
          `insert into public.submissions (homework_id, student_id, video_id, submitted_at)
           values ($1, $2, $3, '2020-01-01 00:00:00+09')
           returning abs(extract(epoch from (submitted_at - now()))) < 600 as near_now`,
          [HW.HW1, U.SA, V.PA2],
        );
        return rows[0]?.near_now === true ? "db-time" : "client-time";
      } catch (error) {
        await tx.exec("rollback to savepoint try_submit");
        const code = String((error as { code?: unknown }).code);
        return /^(23(?!502)\d{3}|42501|P0001)$/.test(code) ? "rejected" : `error ${code}`;
      }
    });
    expect(["db-time", "rejected"]).toContain(outcome);
  });

  it("HW-07: 학생이 submitted_at을 주지 않으면 DB가 지금 시각을 넣는다", async () => {
    const rows = await withActor(
      db,
      asUser(U.SA),
      async (tx) =>
        (
          await tx.query<{ near_now: boolean }>(
            `insert into public.submissions (homework_id, student_id, video_id) values ($1, $2, $3)
           returning abs(extract(epoch from (submitted_at - now()))) < 600 as near_now`,
            [HW.HW1, U.SA, V.PA2],
          )
        ).rows,
    );
    expect(rows).toEqual([{ near_now: true }]);
  });
});

// ===========================================================================
// feedback_comments
// ===========================================================================

const feedbackInsert = (submissionId: string, authorId: string, body: string, atSec: string) =>
  sql(`insert into public.feedback_comments (submission_id, author_id, body, at_sec)
       values ('${submissionId}', '${authorId}', ${body}, ${atSec})`);

describe("#35 피드백 무결성 — HW-10 (팀장 결정 4)", () => {
  it.each<[string, OpCase, "allow" | "reject"]>([
    ["텍스트 코멘트(at_sec 없음)", feedbackInsert(SUB.G, U.T1, "'좋아요'", "null"), "allow"],
    ["시점 코멘트 0초", feedbackInsert(SUB.G, U.T1, "'시작'", "0"), "allow"],
    [
      `시점 코멘트 = 영상 길이(${DURATION}초)`,
      feedbackInsert(SUB.G, U.T1, "'끝'", String(DURATION)),
      "allow",
    ],
    [
      `시점 코멘트 영상 길이 + 1초`,
      feedbackInsert(SUB.G, U.T1, "'넘침'", String(DURATION + 1)),
      "reject",
    ],
    ["시점 코멘트 -1초", feedbackInsert(SUB.G, U.T1, "'음수'", "-1"), "reject"],
    ["본문이 빈 문자열", feedbackInsert(SUB.G, U.T1, "''", "null"), "reject"],
    [
      "작성자가 T2(그 숙제의 트레이너 아님)",
      feedbackInsert(SUB.G, U.T2, "'남의 학생'", "null"),
      "reject",
    ],
    ["작성자가 학생G(제출한 학생)", feedbackInsert(SUB.G, U.SG, "'자기 피드백'", "null"), "reject"],
    ["작성자가 운영자", feedbackInsert(SUB.G, U.ADMIN, "'운영자'", "null"), "reject"],
  ])("HW-10: 서버 × feedback_comments insert: %s → %s", async (_, opCase, expected) => {
    expect(await attemptWrite(db, service, opCase)).toBe(expected);
  });
});

// ===========================================================================
// trainer_profile_videos
// ===========================================================================

const profileVideoInsert = (trainerId: string, videoId: string, sortOrder: number, setup?: Setup) =>
  sql(
    `insert into public.trainer_profile_videos (trainer_id, video_id, sort_order)
     values ('${trainerId}', '${videoId}', ${sortOrder})`,
    setup,
  );

describe("#35 프로필 영상 무결성 — TRN-07 (팀장 결정 4)", () => {
  it.each<[string, OpCase, "allow" | "reject"]>([
    ["T1의 ready 프로필 영상 PR3을 3번에", profileVideoInsert(U.T1, V.PR3, 3), "allow"],
    ["sort_order 0", profileVideoInsert(U.T1, V.PR3, 0), "reject"],
    ["sort_order 4", profileVideoInsert(U.T1, V.PR3, 4), "reject"],
    ["이미 쓴 sort_order 1", profileVideoInsert(U.T1, V.PR3, 1), "reject"],
    ["이미 붙은 PR1을 3번에 한 번 더", profileVideoInsert(U.T1, V.PR1, 3), "reject"],
    ["T2의 프로필 영상을 T1 프로필에", profileVideoInsert(U.T1, V.PR_T2, 3), "reject"],
    ["T1의 예시 영상을 프로필에", profileVideoInsert(U.T1, V.EX_FREE, 3), "reject"],
    ["T1의 uploading 프로필 영상", profileVideoInsert(U.T1, V.PR_UPLOADING, 3), "reject"],
    ["T1의 다른 ready 프로필 영상 PR4를 3번에", profileVideoInsert(U.T1, V.PR4, 3), "allow"],
    ["3개가 찬 뒤 4개째(PR4, 3번)", profileVideoInsert(U.T1, V.PR4, 3, fillT1Profile), "reject"],
    ["3개가 찬 뒤 4개째(PR4, 4번)", profileVideoInsert(U.T1, V.PR4, 4, fillT1Profile), "reject"],
  ])("TRN-07: 서버 × trainer_profile_videos insert: %s → %s", async (_, opCase, expected) => {
    expect(await attemptWrite(db, service, opCase)).toBe(expected);
  });

  it("TRN-07: 준비 상태 확인 — fillT1Profile 뒤 T1 프로필 영상은 3개다", async () => {
    const count = await withActor(
      db,
      service,
      async (tx) =>
        (
          await tx.query<{ n: number }>(
            `select count(*)::int as n from public.trainer_profile_videos where trainer_id = $1`,
            [U.T1],
          )
        ).rows[0]?.n,
      { setup: fillT1Profile },
    );
    expect(count).toBe(3);
  });
});

// ===========================================================================
// 보관 기한 (컬럼·값만)
// ===========================================================================

describe("#35 보관 기한 — HW-14, AUTH-08 (DB는 계산하지 않는다)", () => {
  it("HW-14: 서버가 넣은 purge_after·purge_notified_at은 넣은 값 그대로 저장된다", async () => {
    const { rows } = await db.query<{ same: boolean }>(
      `select purge_after = $2::timestamptz and purge_notified_at = $3::timestamptz as same
       from public.videos where id = $1`,
      [V.PC1, PC1_PURGE_AFTER, PC1_PURGE_NOTIFIED_AT],
    );
    expect(rows).toEqual([{ same: true }]);
  });

  type Snapshot = { videos: string; submissions: string; feedback: string };
  const snapshot = async (tx: Transaction): Promise<Snapshot> => {
    const one = async (text: string) =>
      ((await tx.query<{ s: string }>(text)).rows[0]?.s ?? "") as string;
    return {
      videos: await one(
        `select string_agg(id || ':' || coalesce(purge_after::text, '-') || ':' ||
                coalesce(purge_notified_at::text, '-') || ':' || upload_status, ',' order by id) as s
         from public.videos`,
      ),
      submissions: await one(
        `select string_agg(id || ':' || video_id || ':' || submitted_at::text, ',' order by id) as s
         from public.submissions`,
      ),
      feedback: await one(
        `select string_agg(id || ':' || body || ':' || coalesce(at_sec::text, '-'), ',' order by id) as s
         from public.feedback_comments`,
      ),
    };
  };

  it.each<[string, string]>([
    [
      "HW-14: 학생A의 수강권(TK.A)을 ended로 바꿔도",
      `update public.tickets set status = 'ended', end_reason = 'expired' where id = '${TK.A}'`,
    ],
    [
      "HW-14: 학생H의 그룹 수강권(TK.H)을 ended로 바꿔도",
      `update public.tickets set status = 'ended', end_reason = 'used_up' where id = '${TK.H}'`,
    ],
    [
      "AUTH-08: 학생A를 withdrawn으로 바꿔도",
      `update public.users set status = 'withdrawn' where id = '${U.SA}'`,
    ],
    [
      "AUTH-08: T1을 withdrawn으로 바꿔도",
      `update public.users set status = 'withdrawn' where id = '${U.T1}'`,
    ],
  ])(
    "%s 영상·제출·피드백 행은 지워지거나 바뀌지 않고 purge_after도 채워지지 않는다",
    async (_, change) => {
      const result = await withActor(db, service, async (tx) => {
        const before = await snapshot(tx);
        const changed = await tx.query(change);
        const after = await snapshot(tx);
        return { before, changed: changed.affectedRows, after };
      });
      expect(result.changed).toBe(1);
      expect(result.before.videos.length).toBeGreaterThan(0);
      expect(result.after).toEqual(result.before);
    },
  );

  it("AUTH-07: 준비 상태 확인 — withdrawSA 뒤 학생A는 withdrawn이다", async () => {
    const status = await withActor(
      db,
      service,
      async (tx) =>
        (
          await tx.query<{ status: string }>(
            `select status::text from public.users where id = $1`,
            [U.SA],
          )
        ).rows[0]?.status,
      { setup: withdrawSA },
    );
    expect(status).toBe("withdrawn");
  });

  it("HW-10: 준비 상태 확인 — 시점 코멘트 FB.H_AT는 준비 데이터대로 10초다(시점 코멘트 범위 판정의 전제)", async () => {
    const { rows } = await db.query<{ at_sec: number }>(
      `select at_sec from public.feedback_comments where id = $1`,
      [FB.H_AT],
    );
    expect(rows).toEqual([{ at_sec: 10 }]);
  });
});
