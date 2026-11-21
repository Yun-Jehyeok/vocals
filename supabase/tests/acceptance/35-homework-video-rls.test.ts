// 인수 테스트: 이슈 #35 묶음 4 — videos, homeworks, homework_targets, homework_videos, submissions,
// feedback_comments, trainer_profile_videos 권한
// (QA가 개발 전에 쓴다. 개발은 고치지 않는다. 틀렸다고 보면 `[질문] 받는 역할: QA`)
//
// 준비 데이터와 역할은 35-fixture.ts.
// 쓰기 경로(팀장 결정 1): videos 행 만들기·지우기와 상태·길이·키·보관 기한은 서버만. 클라이언트 직접은
//   트레이너의 자기 예시 영상 hidden_in_library, 숙제·대상·예시 영상 연결 만들기와 숙제 description·due_at 고치기,
//   학생의 제출 만들기, 트레이너의 피드백 달기, 트레이너의 프로필 영상 연결(붙이기·빼기·순서)
// 읽기(팀장 결정 2·3, PM 질문 2 추천 A): 예시 영상 = 올린 트레이너 + 붙은 숙제의 대상 학생 + 운영자,
//   연습 영상 = 올린 학생 + 붙은 제출의 숙제 트레이너 + 운영자(제출 전 영상은 학생·운영자만, 끝난 수강권도 계속),
//   프로필 영상 = 붙어 있으면 그 트레이너 프로필을 읽을 수 있는 사람(정지 기준 포함), 붙지 않으면 올린 트레이너·운영자,
//   homework_targets = 학생은 자기 줄만
// 수정·삭제(팀장 결정 6): 숙제 description·due_at만 고친다. 나머지는 고치기·지우기 없음(프로필 영상 연결은 예외)
// 정지 트레이너는 숙제·피드백·프로필 영상을 쓴다(팀장 결정 7). 탈퇴 사용자는 쓰지 못한다(AUTH-07, is_active_user)
// 권한은 RLS 매트릭스(attempt)로, 관계·컬럼 단위 쓰기는 attemptWrite(허용 짝과 함께)로 판정한다.
// 매트릭스 title은 요구사항 추적이 세지 않으므로 대표 칸을 맨 아래에서 ID를 넣은 이름으로 한 번 더 둔다.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "../helpers/db.ts";
import { anon, asUser, service, withActor } from "../helpers/db.ts";
import { attempt, attemptWrite, describeRlsMatrix } from "../helpers/rls-matrix.ts";
import type { Op, OpCase } from "../helpers/rls-matrix.ts";
import type { Setup } from "./35-fixture.ts";
import {
  FB,
  HW,
  LS,
  SUB,
  TK,
  U,
  V,
  createBundle4Db,
  suspendT1,
  withdrawSA,
  withdrawT1,
} from "./35-fixture.ts";

let db: PGlite;

beforeAll(async () => {
  db = await createBundle4Db();
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

const selectVideo = (id: string, setup?: Setup): OpCase =>
  withSetup({ sql: `select 1 from public.videos where id = $1`, params: [id] }, setup);
const hideVideo = (id: string, setup?: Setup): OpCase =>
  withSetup(
    {
      sql: `update public.videos set hidden_in_library = not hidden_in_library where id = $1`,
      params: [id],
    },
    setup,
  );
const deleteVideo = (id: string): OpCase => ({
  sql: `delete from public.videos where id = $1`,
  params: [id],
});
/** 클라이언트가 예시 영상 행을 직접 만드는 시도 (서버만 만든다, NFR-03) */
const insertExampleVideo: OpCase = {
  sql: `insert into public.videos (owner_id, purpose, storage_key, duration_sec, upload_status)
        values ($1, 'example', 'b4-client-example', 60, 'ready')`,
  params: [U.T1],
};
/** 클라이언트가 연습 영상 행을 직접 만드는 시도 */
const insertPracticeVideo: OpCase = {
  sql: `insert into public.videos (owner_id, purpose, storage_key, duration_sec, upload_status, ticket_id)
        values ($1, 'practice', 'b4-client-practice', 60, 'ready', $2)`,
  params: [U.SH, TK.H],
};

const selectHomework = (id: string): OpCase => ({
  sql: `select 1 from public.homeworks where id = $1`,
  params: [id],
});
const insertHomework = (setup?: Setup): OpCase =>
  withSetup(
    {
      sql: `insert into public.homeworks (session_id, trainer_id, description, due_at)
            values ($1, $2, '묶음4 클라이언트 숙제', '2026-12-03 19:00:00+09')`,
      params: [LS.A2, U.T1],
    },
    setup,
  );
const updateHomework = (id: string, setup?: Setup): OpCase =>
  withSetup(
    {
      sql: `update public.homeworks set description = '묶음4 고친 설명', due_at = '2026-11-30 19:00:00+09'
            where id = $1`,
      params: [id],
    },
    setup,
  );

const selectTarget = (homeworkId: string, studentId: string): OpCase => ({
  sql: `select 1 from public.homework_targets where homework_id = $1 and student_id = $2`,
  params: [homeworkId, studentId],
});
/** HW3(학생G만)에 같은 회차 참여 학생H를 더한다 — 바른 값 */
const insertTargetHW3H = (setup?: Setup): OpCase =>
  withSetup(
    {
      sql: `insert into public.homework_targets (homework_id, student_id) values ($1, $2)`,
      params: [HW.HW3, U.SH],
    },
    setup,
  );

const selectHomeworkVideo = (homeworkId: string, videoId: string): OpCase => ({
  sql: `select 1 from public.homework_videos where homework_id = $1 and video_id = $2`,
  params: [homeworkId, videoId],
});
/** HW3에 T1의 예시 영상 EX1을 다시 붙인다(HW-05) — 바른 값 */
const insertHomeworkVideoHW3EX1 = (setup?: Setup): OpCase =>
  withSetup(
    {
      sql: `insert into public.homework_videos (homework_id, video_id) values ($1, $2)`,
      params: [HW.HW3, V.EX1],
    },
    setup,
  );

const selectSubmission = (id: string): OpCase => ({
  sql: `select 1 from public.submissions where id = $1`,
  params: [id],
});
const insertSubmission = (
  homeworkId: string,
  studentId: string,
  videoId: string,
  setup?: Setup,
): OpCase =>
  withSetup(
    {
      sql: `insert into public.submissions (homework_id, student_id, video_id, question)
            values ($1, $2, $3, '묶음4 질문')`,
      params: [homeworkId, studentId, videoId],
    },
    setup,
  );

const selectFeedback = (submissionId: string): OpCase => ({
  sql: `select 1 from public.feedback_comments where submission_id = $1`,
  params: [submissionId],
});
const insertFeedback = (atSec: number | null, setup?: Setup): OpCase =>
  withSetup(
    {
      sql: `insert into public.feedback_comments (submission_id, author_id, body, at_sec)
            values ($1, $2, '묶음4 클라이언트 코멘트', $3)`,
      params: [SUB.H, U.T1, atSec],
    },
    setup,
  );

const selectProfileVideo = (trainerId: string, videoId: string, setup?: Setup): OpCase =>
  withSetup(
    {
      sql: `select 1 from public.trainer_profile_videos where trainer_id = $1 and video_id = $2`,
      params: [trainerId, videoId],
    },
    setup,
  );
/** T1 프로필 3번 칸에 PR3을 붙인다 — 바른 값 */
const insertProfileVideo = (setup?: Setup): OpCase =>
  withSetup(
    {
      sql: `insert into public.trainer_profile_videos (trainer_id, video_id, sort_order) values ($1, $2, 3)`,
      params: [U.T1, V.PR3],
    },
    setup,
  );
const reorderProfileVideo = (setup?: Setup): OpCase =>
  withSetup(
    {
      sql: `update public.trainer_profile_videos set sort_order = 3 where trainer_id = $1 and video_id = $2`,
      params: [U.T1, V.PR2],
    },
    setup,
  );
const removeProfileVideo = (setup?: Setup): OpCase =>
  withSetup(
    {
      sql: `delete from public.trainer_profile_videos where trainer_id = $1 and video_id = $2`,
      params: [U.T1, V.PR2],
    },
    setup,
  );

// ===========================================================================
// videos
// ===========================================================================

describeRlsMatrix(
  {
    title:
      "#35 videos 권한 — HW-05, HW-09, HW-12, HW-14, TRN-07, NFR-03, NFR-04, ADM-02, ADM-07, AUTH-07",
    actors: ACTORS,
    cases: {
      "videos:예시 HW1(EX1)": {
        select: selectVideo(V.EX1),
        insert: insertExampleVideo,
        update: hideVideo(V.EX1),
        delete: deleteVideo(V.EX1),
      },
      "videos:예시 HW2(EX2)": { select: selectVideo(V.EX2) },
      "videos:예시 HW3만(EX3)": { select: selectVideo(V.EX3) },
      "videos:숨긴 예시 HW2(EX_HIDDEN)": {
        select: selectVideo(V.EX_HIDDEN),
        update: hideVideo(V.EX_HIDDEN),
      },
      "videos:붙지 않은 예시(EX_FREE)": { select: selectVideo(V.EX_FREE) },
      "videos:업로드 중 예시(EX_UPLOADING)": { select: selectVideo(V.EX_UPLOADING) },
      "videos:T2 예시(EX_T2)": { select: selectVideo(V.EX_T2), update: hideVideo(V.EX_T2) },
      "videos:예시 HW1 — T1 탈퇴": { update: hideVideo(V.EX1, withdrawT1) },
      "videos:학생H 연습 HW2 제출(PH1)": {
        select: selectVideo(V.PH1),
        insert: insertPracticeVideo,
        update: hideVideo(V.PH1),
        delete: deleteVideo(V.PH1),
      },
      "videos:학생G 연습 HW2 제출(PG1)": { select: selectVideo(V.PG1) },
      "videos:학생A 연습 제출 전 ready(PA2)": {
        select: selectVideo(V.PA2),
        update: hideVideo(V.PA2),
      },
      "videos:학생A 연습 업로드 중(PA_UPLOADING)": { select: selectVideo(V.PA_UPLOADING) },
      "videos:학생A 연습 실패(PA_FAILED)": { select: selectVideo(V.PA_FAILED) },
      "videos:학생C 끝난 수강권 제출(PC1)": { select: selectVideo(V.PC1) },
      "videos:T1 프로필 붙음(PR1)": { select: selectVideo(V.PR1) },
      "videos:T1 프로필 붙음(PR1) — T1 정지": { select: selectVideo(V.PR1, suspendT1) },
      "videos:T1 프로필 붙지 않음(PR3)": { select: selectVideo(V.PR3) },
    },
    rows: [
      // 역할      테이블                                       select   insert   update   delete
      ["T1", "videos:예시 HW1(EX1)", "allow", "deny", "allow", "deny"],
      ["T1", "videos:예시 HW2(EX2)", "allow", "-", "-", "-"],
      ["T1", "videos:예시 HW3만(EX3)", "allow", "-", "-", "-"],
      ["T1", "videos:숨긴 예시 HW2(EX_HIDDEN)", "allow", "-", "allow", "-"],
      ["T1", "videos:붙지 않은 예시(EX_FREE)", "allow", "-", "-", "-"],
      ["T1", "videos:업로드 중 예시(EX_UPLOADING)", "allow", "-", "-", "-"],
      ["T1", "videos:T2 예시(EX_T2)", "deny", "-", "deny", "-"],
      ["T1", "videos:예시 HW1 — T1 탈퇴", "-", "-", "deny", "-"],
      ["T1", "videos:학생H 연습 HW2 제출(PH1)", "allow", "deny", "deny", "deny"],
      ["T1", "videos:학생G 연습 HW2 제출(PG1)", "allow", "-", "-", "-"],
      ["T1", "videos:학생A 연습 제출 전 ready(PA2)", "deny", "-", "deny", "-"],
      ["T1", "videos:학생A 연습 업로드 중(PA_UPLOADING)", "deny", "-", "-", "-"],
      ["T1", "videos:학생C 끝난 수강권 제출(PC1)", "allow", "-", "-", "-"],
      ["T1", "videos:T1 프로필 붙음(PR1)", "allow", "-", "-", "-"],
      ["T1", "videos:T1 프로필 붙음(PR1) — T1 정지", "allow", "-", "-", "-"],
      ["T1", "videos:T1 프로필 붙지 않음(PR3)", "allow", "-", "-", "-"],

      ["운영자", "videos:예시 HW1(EX1)", "allow", "deny", "deny", "deny"],
      ["운영자", "videos:예시 HW3만(EX3)", "allow", "-", "-", "-"],
      ["운영자", "videos:붙지 않은 예시(EX_FREE)", "allow", "-", "-", "-"],
      ["운영자", "videos:업로드 중 예시(EX_UPLOADING)", "allow", "-", "-", "-"],
      ["운영자", "videos:T2 예시(EX_T2)", "allow", "-", "deny", "-"],
      ["운영자", "videos:학생H 연습 HW2 제출(PH1)", "allow", "deny", "deny", "deny"],
      ["운영자", "videos:학생A 연습 제출 전 ready(PA2)", "allow", "-", "deny", "-"],
      ["운영자", "videos:학생A 연습 업로드 중(PA_UPLOADING)", "allow", "-", "-", "-"],
      ["운영자", "videos:학생A 연습 실패(PA_FAILED)", "allow", "-", "-", "-"],
      ["운영자", "videos:학생C 끝난 수강권 제출(PC1)", "allow", "-", "-", "-"],
      ["운영자", "videos:T1 프로필 붙음(PR1) — T1 정지", "allow", "-", "-", "-"],
      ["운영자", "videos:T1 프로필 붙지 않음(PR3)", "allow", "-", "-", "-"],

      ["학생A", "videos:예시 HW1(EX1)", "allow", "deny", "deny", "deny"],
      ["학생A", "videos:예시 HW2(EX2)", "deny", "-", "-", "-"],
      ["학생A", "videos:숨긴 예시 HW2(EX_HIDDEN)", "deny", "-", "deny", "-"],
      ["학생A", "videos:붙지 않은 예시(EX_FREE)", "deny", "-", "-", "-"],
      ["학생A", "videos:학생H 연습 HW2 제출(PH1)", "deny", "deny", "deny", "deny"],
      ["학생A", "videos:학생A 연습 제출 전 ready(PA2)", "allow", "-", "deny", "-"],
      ["학생A", "videos:학생A 연습 업로드 중(PA_UPLOADING)", "allow", "-", "-", "-"],
      ["학생A", "videos:학생A 연습 실패(PA_FAILED)", "allow", "-", "-", "-"],
      ["학생A", "videos:학생C 끝난 수강권 제출(PC1)", "deny", "-", "-", "-"],
      ["학생A", "videos:T1 프로필 붙음(PR1)", "allow", "-", "-", "-"],
      ["학생A", "videos:T1 프로필 붙음(PR1) — T1 정지", "allow", "-", "-", "-"],
      ["학생A", "videos:T1 프로필 붙지 않음(PR3)", "deny", "-", "-", "-"],

      ["학생G", "videos:예시 HW1(EX1)", "deny", "-", "deny", "-"],
      ["학생G", "videos:예시 HW2(EX2)", "allow", "-", "-", "-"],
      ["학생G", "videos:예시 HW3만(EX3)", "allow", "-", "-", "-"],
      ["학생G", "videos:숨긴 예시 HW2(EX_HIDDEN)", "allow", "-", "-", "-"],
      ["학생G", "videos:학생H 연습 HW2 제출(PH1)", "deny", "deny", "deny", "deny"],
      ["학생G", "videos:학생G 연습 HW2 제출(PG1)", "allow", "-", "-", "-"],

      ["학생H", "videos:예시 HW2(EX2)", "allow", "-", "-", "-"],
      ["학생H", "videos:예시 HW3만(EX3)", "deny", "-", "-", "-"],
      ["학생H", "videos:숨긴 예시 HW2(EX_HIDDEN)", "allow", "-", "deny", "-"],
      ["학생H", "videos:학생H 연습 HW2 제출(PH1)", "allow", "deny", "deny", "deny"],
      ["학생H", "videos:학생G 연습 HW2 제출(PG1)", "deny", "-", "-", "-"],

      ["학생C", "videos:예시 HW1(EX1)", "deny", "-", "-", "-"],
      ["학생C", "videos:학생H 연습 HW2 제출(PH1)", "deny", "-", "-", "-"],
      ["학생C", "videos:학생C 끝난 수강권 제출(PC1)", "allow", "-", "-", "-"],
      ["학생C", "videos:T1 프로필 붙음(PR1) — T1 정지", "allow", "-", "-", "-"],

      ["학생B", "videos:예시 HW1(EX1)", "deny", "deny", "deny", "deny"],
      ["학생B", "videos:예시 HW2(EX2)", "deny", "-", "-", "-"],
      ["학생B", "videos:학생H 연습 HW2 제출(PH1)", "deny", "deny", "deny", "deny"],
      ["학생B", "videos:학생C 끝난 수강권 제출(PC1)", "deny", "-", "-", "-"],
      ["학생B", "videos:T1 프로필 붙음(PR1)", "allow", "-", "-", "-"],
      ["학생B", "videos:T1 프로필 붙음(PR1) — T1 정지", "deny", "-", "-", "-"],
      ["학생B", "videos:T1 프로필 붙지 않음(PR3)", "deny", "-", "-", "-"],

      ["T2", "videos:예시 HW1(EX1)", "deny", "deny", "deny", "deny"],
      ["T2", "videos:T2 예시(EX_T2)", "allow", "-", "allow", "-"],
      ["T2", "videos:학생H 연습 HW2 제출(PH1)", "deny", "deny", "deny", "deny"],
      ["T2", "videos:학생C 끝난 수강권 제출(PC1)", "deny", "-", "-", "-"],
      ["T2", "videos:T1 프로필 붙음(PR1)", "allow", "-", "-", "-"],
      ["T2", "videos:T1 프로필 붙음(PR1) — T1 정지", "deny", "-", "-", "-"],
      ["T2", "videos:T1 프로필 붙지 않음(PR3)", "deny", "-", "-", "-"],

      ["anon", "videos:예시 HW1(EX1)", "deny", "deny", "deny", "deny"],
      ["anon", "videos:붙지 않은 예시(EX_FREE)", "deny", "-", "-", "-"],
      ["anon", "videos:학생H 연습 HW2 제출(PH1)", "deny", "deny", "deny", "deny"],
      ["anon", "videos:학생A 연습 업로드 중(PA_UPLOADING)", "deny", "-", "-", "-"],
      ["anon", "videos:T1 프로필 붙음(PR1)", "allow", "-", "-", "-"],
      ["anon", "videos:T1 프로필 붙음(PR1) — T1 정지", "deny", "-", "-", "-"],
      ["anon", "videos:T1 프로필 붙지 않음(PR3)", "deny", "-", "-", "-"],
    ],
  },
  { db: getDb },
);

// ===========================================================================
// homeworks
// ===========================================================================

describeRlsMatrix(
  {
    title: "#35 homeworks 권한 — HW-01, HW-02, HW-03, HW-11, HW-12, ADM-02, ADM-07, AUTH-07",
    actors: ACTORS,
    cases: {
      "homeworks:HW1(학생A 1:1)": {
        select: selectHomework(HW.HW1),
        insert: insertHomework(),
        update: updateHomework(HW.HW1),
        delete: { sql: `delete from public.homeworks where id = $1`, params: [HW.HW1] },
      },
      "homeworks:HW2(그룹 전체)": {
        select: selectHomework(HW.HW2),
        update: updateHomework(HW.HW2),
        delete: { sql: `delete from public.homeworks where id = $1`, params: [HW.HW2] },
      },
      "homeworks:HW3(학생G만)": { select: selectHomework(HW.HW3) },
      "homeworks:HW_C(학생C 지난 숙제)": { select: selectHomework(HW.HW_C) },
      "homeworks:T1 정지": {
        insert: insertHomework(suspendT1),
        update: updateHomework(HW.HW1, suspendT1),
      },
      "homeworks:T1 탈퇴": {
        insert: insertHomework(withdrawT1),
        update: updateHomework(HW.HW1, withdrawT1),
      },
    },
    rows: [
      // 역할      테이블                                select   insert   update   delete
      ["T1", "homeworks:HW1(학생A 1:1)", "allow", "allow", "allow", "deny"],
      ["T1", "homeworks:HW2(그룹 전체)", "allow", "-", "allow", "deny"],
      ["T1", "homeworks:HW3(학생G만)", "allow", "-", "-", "-"],
      ["T1", "homeworks:HW_C(학생C 지난 숙제)", "allow", "-", "-", "-"],
      ["T1", "homeworks:T1 정지", "-", "allow", "allow", "-"],
      ["T1", "homeworks:T1 탈퇴", "-", "deny", "deny", "-"],
      ["운영자", "homeworks:HW1(학생A 1:1)", "allow", "deny", "deny", "deny"],
      ["운영자", "homeworks:HW3(학생G만)", "allow", "-", "-", "-"],
      ["학생A", "homeworks:HW1(학생A 1:1)", "allow", "deny", "deny", "deny"],
      ["학생A", "homeworks:HW2(그룹 전체)", "deny", "-", "-", "-"],
      ["학생G", "homeworks:HW1(학생A 1:1)", "deny", "-", "-", "-"],
      ["학생G", "homeworks:HW2(그룹 전체)", "allow", "-", "deny", "deny"],
      ["학생G", "homeworks:HW3(학생G만)", "allow", "-", "-", "-"],
      ["학생H", "homeworks:HW2(그룹 전체)", "allow", "-", "deny", "-"],
      ["학생H", "homeworks:HW3(학생G만)", "deny", "-", "-", "-"],
      ["학생C", "homeworks:HW_C(학생C 지난 숙제)", "allow", "-", "-", "-"],
      ["학생C", "homeworks:HW1(학생A 1:1)", "deny", "-", "-", "-"],
      ["학생B", "homeworks:HW1(학생A 1:1)", "deny", "deny", "deny", "deny"],
      ["학생B", "homeworks:HW2(그룹 전체)", "deny", "-", "-", "-"],
      ["T2", "homeworks:HW1(학생A 1:1)", "deny", "deny", "deny", "deny"],
      ["T2", "homeworks:HW2(그룹 전체)", "deny", "-", "deny", "-"],
      ["anon", "homeworks:HW1(학생A 1:1)", "deny", "deny", "deny", "deny"],
      ["anon", "homeworks:HW2(그룹 전체)", "deny", "-", "-", "-"],
    ],
  },
  { db: getDb },
);

// ===========================================================================
// homework_targets
// ===========================================================================

describeRlsMatrix(
  {
    title: "#35 homework_targets 권한 — HW-01, HW-03, HW-12, ADM-02, ADM-07, AUTH-07",
    actors: ACTORS,
    cases: {
      "homework_targets:HW1 학생A": {
        select: selectTarget(HW.HW1, U.SA),
        update: {
          sql: `update public.homework_targets set student_id = $2 where homework_id = $1 and student_id = $3`,
          params: [HW.HW1, U.SA, U.SA],
        },
        delete: {
          sql: `delete from public.homework_targets where homework_id = $1 and student_id = $2`,
          params: [HW.HW1, U.SA],
        },
      },
      "homework_targets:HW2 학생G": { select: selectTarget(HW.HW2, U.SG) },
      "homework_targets:HW2 학생H": { select: selectTarget(HW.HW2, U.SH) },
      "homework_targets:HW_C 학생C": { select: selectTarget(HW.HW_C, U.SC) },
      "homework_targets:HW3에 학생H 더하기": { insert: insertTargetHW3H() },
      "homework_targets:HW3에 학생H 더하기 — T1 정지": { insert: insertTargetHW3H(suspendT1) },
      "homework_targets:HW3에 학생H 더하기 — T1 탈퇴": { insert: insertTargetHW3H(withdrawT1) },
    },
    rows: [
      // 역할      테이블                                          select   insert   update   delete
      ["T1", "homework_targets:HW1 학생A", "allow", "-", "deny", "deny"],
      ["T1", "homework_targets:HW2 학생G", "allow", "-", "-", "-"],
      ["T1", "homework_targets:HW2 학생H", "allow", "-", "-", "-"],
      ["T1", "homework_targets:HW_C 학생C", "allow", "-", "-", "-"],
      ["T1", "homework_targets:HW3에 학생H 더하기", "-", "allow", "-", "-"],
      ["T1", "homework_targets:HW3에 학생H 더하기 — T1 정지", "-", "allow", "-", "-"],
      ["T1", "homework_targets:HW3에 학생H 더하기 — T1 탈퇴", "-", "deny", "-", "-"],
      ["운영자", "homework_targets:HW1 학생A", "allow", "-", "deny", "deny"],
      ["운영자", "homework_targets:HW2 학생H", "allow", "-", "-", "-"],
      ["운영자", "homework_targets:HW3에 학생H 더하기", "-", "deny", "-", "-"],
      ["학생A", "homework_targets:HW1 학생A", "allow", "-", "deny", "deny"],
      ["학생A", "homework_targets:HW2 학생G", "deny", "-", "-", "-"],
      ["학생G", "homework_targets:HW2 학생G", "allow", "-", "-", "-"],
      ["학생G", "homework_targets:HW2 학생H", "deny", "-", "-", "-"],
      ["학생G", "homework_targets:HW3에 학생H 더하기", "-", "deny", "-", "-"],
      ["학생H", "homework_targets:HW2 학생H", "allow", "-", "-", "-"],
      ["학생H", "homework_targets:HW2 학생G", "deny", "-", "-", "-"],
      ["학생H", "homework_targets:HW3에 학생H 더하기", "-", "deny", "-", "-"],
      ["학생C", "homework_targets:HW_C 학생C", "allow", "-", "-", "-"],
      ["학생B", "homework_targets:HW1 학생A", "deny", "-", "deny", "deny"],
      ["학생B", "homework_targets:HW2 학생G", "deny", "-", "-", "-"],
      ["T2", "homework_targets:HW1 학생A", "deny", "-", "deny", "deny"],
      ["T2", "homework_targets:HW3에 학생H 더하기", "-", "deny", "-", "-"],
      ["anon", "homework_targets:HW1 학생A", "deny", "-", "deny", "deny"],
      ["anon", "homework_targets:HW3에 학생H 더하기", "-", "deny", "-", "-"],
    ],
  },
  { db: getDb },
);

// ===========================================================================
// homework_videos
// ===========================================================================

describeRlsMatrix(
  {
    title: "#35 homework_videos 권한 — HW-02, HW-04, HW-05, HW-12, ADM-02, ADM-07, AUTH-07",
    actors: ACTORS,
    cases: {
      "homework_videos:HW1 EX1": {
        select: selectHomeworkVideo(HW.HW1, V.EX1),
        update: {
          sql: `update public.homework_videos set video_id = $2 where homework_id = $1 and video_id = $3`,
          params: [HW.HW1, V.EX_FREE, V.EX1],
        },
        delete: {
          sql: `delete from public.homework_videos where homework_id = $1 and video_id = $2`,
          params: [HW.HW1, V.EX1],
        },
      },
      "homework_videos:HW2 숨긴 예시": { select: selectHomeworkVideo(HW.HW2, V.EX_HIDDEN) },
      "homework_videos:HW3 EX3": { select: selectHomeworkVideo(HW.HW3, V.EX3) },
      "homework_videos:HW3에 EX1 붙이기": { insert: insertHomeworkVideoHW3EX1() },
      "homework_videos:HW3에 EX1 붙이기 — T1 정지": {
        insert: insertHomeworkVideoHW3EX1(suspendT1),
      },
      "homework_videos:HW3에 EX1 붙이기 — T1 탈퇴": {
        insert: insertHomeworkVideoHW3EX1(withdrawT1),
      },
    },
    rows: [
      // 역할      테이블                                          select   insert   update   delete
      ["T1", "homework_videos:HW1 EX1", "allow", "-", "deny", "deny"],
      ["T1", "homework_videos:HW2 숨긴 예시", "allow", "-", "-", "-"],
      ["T1", "homework_videos:HW3 EX3", "allow", "-", "-", "-"],
      ["T1", "homework_videos:HW3에 EX1 붙이기", "-", "allow", "-", "-"],
      ["T1", "homework_videos:HW3에 EX1 붙이기 — T1 정지", "-", "allow", "-", "-"],
      ["T1", "homework_videos:HW3에 EX1 붙이기 — T1 탈퇴", "-", "deny", "-", "-"],
      ["운영자", "homework_videos:HW1 EX1", "allow", "-", "deny", "deny"],
      ["운영자", "homework_videos:HW3에 EX1 붙이기", "-", "deny", "-", "-"],
      ["학생A", "homework_videos:HW1 EX1", "allow", "-", "deny", "deny"],
      ["학생A", "homework_videos:HW3 EX3", "deny", "-", "-", "-"],
      ["학생G", "homework_videos:HW2 숨긴 예시", "allow", "-", "-", "-"],
      ["학생G", "homework_videos:HW3 EX3", "allow", "-", "-", "-"],
      ["학생G", "homework_videos:HW3에 EX1 붙이기", "-", "deny", "-", "-"],
      ["학생H", "homework_videos:HW2 숨긴 예시", "allow", "-", "-", "-"],
      ["학생H", "homework_videos:HW3 EX3", "deny", "-", "-", "-"],
      ["학생B", "homework_videos:HW1 EX1", "deny", "-", "deny", "deny"],
      ["T2", "homework_videos:HW1 EX1", "deny", "-", "deny", "deny"],
      ["T2", "homework_videos:HW3에 EX1 붙이기", "-", "deny", "-", "-"],
      ["anon", "homework_videos:HW1 EX1", "deny", "-", "deny", "deny"],
      ["anon", "homework_videos:HW3에 EX1 붙이기", "-", "deny", "-", "-"],
    ],
  },
  { db: getDb },
);

// ===========================================================================
// submissions
// ===========================================================================

describeRlsMatrix(
  {
    title: "#35 submissions 권한 — HW-06, HW-07, HW-11, HW-12, HW-13, ADM-07, AUTH-07",
    actors: ACTORS,
    cases: {
      "submissions:학생H HW2(SUB.H)": {
        select: selectSubmission(SUB.H),
        update: {
          sql: `update public.submissions set question = '묶음4 고친 질문' where id = $1`,
          params: [SUB.H],
        },
        delete: { sql: `delete from public.submissions where id = $1`, params: [SUB.H] },
      },
      "submissions:학생G HW2(SUB.G)": { select: selectSubmission(SUB.G) },
      "submissions:학생A HW1(SUB.A1)": {
        select: selectSubmission(SUB.A1),
        update: {
          sql: `update public.submissions set question = '묶음4 고친 질문' where id = $1`,
          params: [SUB.A1],
        },
        delete: { sql: `delete from public.submissions where id = $1`, params: [SUB.A1] },
      },
      "submissions:학생C HW_C(SUB.C)": { select: selectSubmission(SUB.C) },
      "submissions:학생A가 HW1에 PA2로 제출": { insert: insertSubmission(HW.HW1, U.SA, V.PA2) },
      "submissions:학생A가 HW1에 PA2로 제출 — 학생A 탈퇴": {
        insert: insertSubmission(HW.HW1, U.SA, V.PA2, withdrawSA),
      },
      "submissions:학생G가 HW3에 PG2로 제출": { insert: insertSubmission(HW.HW3, U.SG, V.PG2) },
      "submissions:학생C가 HW_C에 PC2로 제출": { insert: insertSubmission(HW.HW_C, U.SC, V.PC2) },
    },
    rows: [
      // 역할      테이블                                                 select   insert   update   delete
      ["T1", "submissions:학생H HW2(SUB.H)", "allow", "-", "deny", "deny"],
      ["T1", "submissions:학생G HW2(SUB.G)", "allow", "-", "-", "-"],
      ["T1", "submissions:학생A HW1(SUB.A1)", "allow", "-", "deny", "deny"],
      ["T1", "submissions:학생C HW_C(SUB.C)", "allow", "-", "-", "-"],
      ["T1", "submissions:학생A가 HW1에 PA2로 제출", "-", "deny", "-", "-"],
      ["운영자", "submissions:학생H HW2(SUB.H)", "allow", "-", "deny", "deny"],
      ["운영자", "submissions:학생C HW_C(SUB.C)", "allow", "-", "-", "-"],
      ["운영자", "submissions:학생A가 HW1에 PA2로 제출", "-", "deny", "-", "-"],
      ["학생A", "submissions:학생A HW1(SUB.A1)", "allow", "-", "deny", "deny"],
      ["학생A", "submissions:학생H HW2(SUB.H)", "deny", "-", "deny", "deny"],
      ["학생A", "submissions:학생A가 HW1에 PA2로 제출", "-", "allow", "-", "-"],
      ["학생A", "submissions:학생A가 HW1에 PA2로 제출 — 학생A 탈퇴", "-", "deny", "-", "-"],
      ["학생G", "submissions:학생G HW2(SUB.G)", "allow", "-", "-", "-"],
      ["학생G", "submissions:학생H HW2(SUB.H)", "deny", "-", "deny", "deny"],
      ["학생G", "submissions:학생G가 HW3에 PG2로 제출", "-", "allow", "-", "-"],
      ["학생G", "submissions:학생A가 HW1에 PA2로 제출", "-", "deny", "-", "-"],
      ["학생H", "submissions:학생H HW2(SUB.H)", "allow", "-", "deny", "deny"],
      ["학생H", "submissions:학생G HW2(SUB.G)", "deny", "-", "-", "-"],
      ["학생C", "submissions:학생C HW_C(SUB.C)", "allow", "-", "-", "-"],
      ["학생C", "submissions:학생C가 HW_C에 PC2로 제출", "-", "allow", "-", "-"],
      ["학생B", "submissions:학생H HW2(SUB.H)", "deny", "-", "deny", "deny"],
      ["학생B", "submissions:학생A가 HW1에 PA2로 제출", "-", "deny", "-", "-"],
      ["T2", "submissions:학생H HW2(SUB.H)", "deny", "-", "deny", "deny"],
      ["T2", "submissions:학생A가 HW1에 PA2로 제출", "-", "deny", "-", "-"],
      ["anon", "submissions:학생H HW2(SUB.H)", "deny", "-", "deny", "deny"],
      ["anon", "submissions:학생A가 HW1에 PA2로 제출", "-", "deny", "-", "-"],
    ],
  },
  { db: getDb },
);

// ===========================================================================
// feedback_comments
// ===========================================================================

describeRlsMatrix(
  {
    title: "#35 feedback_comments 권한 — HW-10, HW-12, ADM-02, ADM-07, AUTH-07",
    actors: ACTORS,
    cases: {
      "feedback_comments:학생H 제출(SUB.H)": {
        select: selectFeedback(SUB.H),
        insert: insertFeedback(null),
        update: {
          sql: `update public.feedback_comments set body = '묶음4 고친 코멘트' where id = $1`,
          params: [FB.H_TEXT],
        },
        delete: { sql: `delete from public.feedback_comments where id = $1`, params: [FB.H_TEXT] },
      },
      "feedback_comments:학생H 제출에 시점 코멘트": { insert: insertFeedback(30) },
      "feedback_comments:학생A 제출(SUB.A1)": { select: selectFeedback(SUB.A1) },
      "feedback_comments:학생H 제출 — T1 정지": { insert: insertFeedback(null, suspendT1) },
      "feedback_comments:학생H 제출 — T1 탈퇴": { insert: insertFeedback(null, withdrawT1) },
    },
    rows: [
      // 역할      테이블                                              select   insert   update   delete
      ["T1", "feedback_comments:학생H 제출(SUB.H)", "allow", "allow", "deny", "deny"],
      ["T1", "feedback_comments:학생H 제출에 시점 코멘트", "-", "allow", "-", "-"],
      ["T1", "feedback_comments:학생A 제출(SUB.A1)", "allow", "-", "-", "-"],
      ["T1", "feedback_comments:학생H 제출 — T1 정지", "-", "allow", "-", "-"],
      ["T1", "feedback_comments:학생H 제출 — T1 탈퇴", "-", "deny", "-", "-"],
      ["운영자", "feedback_comments:학생H 제출(SUB.H)", "allow", "deny", "deny", "deny"],
      ["학생H", "feedback_comments:학생H 제출(SUB.H)", "allow", "deny", "deny", "deny"],
      ["학생H", "feedback_comments:학생A 제출(SUB.A1)", "deny", "-", "-", "-"],
      ["학생G", "feedback_comments:학생H 제출(SUB.H)", "deny", "deny", "deny", "deny"],
      ["학생A", "feedback_comments:학생A 제출(SUB.A1)", "allow", "-", "-", "-"],
      ["학생A", "feedback_comments:학생H 제출(SUB.H)", "deny", "-", "-", "-"],
      ["학생B", "feedback_comments:학생H 제출(SUB.H)", "deny", "deny", "deny", "deny"],
      ["T2", "feedback_comments:학생H 제출(SUB.H)", "deny", "deny", "deny", "deny"],
      ["anon", "feedback_comments:학생H 제출(SUB.H)", "deny", "deny", "deny", "deny"],
    ],
  },
  { db: getDb },
);

// ===========================================================================
// trainer_profile_videos
// ===========================================================================

describeRlsMatrix(
  {
    title: "#35 trainer_profile_videos 권한 — TRN-07, T-03, ADM-02, AUTH-07",
    actors: ACTORS,
    cases: {
      "trainer_profile_videos:T1": {
        select: selectProfileVideo(U.T1, V.PR1),
        insert: insertProfileVideo(),
        update: reorderProfileVideo(),
        delete: removeProfileVideo(),
      },
      "trainer_profile_videos:T1 정지": {
        select: selectProfileVideo(U.T1, V.PR1, suspendT1),
        insert: insertProfileVideo(suspendT1),
        update: reorderProfileVideo(suspendT1),
        delete: removeProfileVideo(suspendT1),
      },
      "trainer_profile_videos:T1 탈퇴": {
        insert: insertProfileVideo(withdrawT1),
        update: reorderProfileVideo(withdrawT1),
        delete: removeProfileVideo(withdrawT1),
      },
    },
    rows: [
      // 역할      테이블                              select   insert   update   delete
      ["T1", "trainer_profile_videos:T1", "allow", "allow", "allow", "allow"],
      ["T1", "trainer_profile_videos:T1 정지", "allow", "allow", "allow", "allow"],
      ["T1", "trainer_profile_videos:T1 탈퇴", "-", "deny", "deny", "deny"],
      ["운영자", "trainer_profile_videos:T1", "allow", "deny", "deny", "deny"],
      ["운영자", "trainer_profile_videos:T1 정지", "allow", "-", "-", "-"],
      ["학생A", "trainer_profile_videos:T1", "allow", "deny", "deny", "deny"],
      ["학생A", "trainer_profile_videos:T1 정지", "allow", "-", "-", "-"],
      ["학생C", "trainer_profile_videos:T1 정지", "allow", "-", "-", "-"],
      ["학생B", "trainer_profile_videos:T1", "allow", "deny", "deny", "deny"],
      ["학생B", "trainer_profile_videos:T1 정지", "deny", "-", "-", "-"],
      ["T2", "trainer_profile_videos:T1", "allow", "deny", "deny", "deny"],
      ["T2", "trainer_profile_videos:T1 정지", "deny", "deny", "deny", "deny"],
      ["anon", "trainer_profile_videos:T1", "allow", "deny", "deny", "deny"],
      ["anon", "trainer_profile_videos:T1 정지", "deny", "-", "-", "-"],
    ],
  },
  { db: getDb },
);

// ===========================================================================
// 준비 상태 확인 (setup이 상태를 바꾸는지)
// ===========================================================================

describe("#35 준비 상태 확인 — ADM-02, AUTH-07", () => {
  it("ADM-02: suspendT1 뒤 T1의 approval_status는 suspended다", async () => {
    const value = await withActor(
      db,
      service,
      async (tx) =>
        (
          await tx.query<{ s: string }>(
            `select approval_status::text as s from public.trainer_profiles where user_id = $1`,
            [U.T1],
          )
        ).rows[0]?.s,
      { setup: suspendT1 },
    );
    expect(value).toBe("suspended");
  });

  it.each<[string, Setup, string]>([
    ["withdrawT1 뒤 T1", withdrawT1, U.T1],
    ["withdrawSA 뒤 학생A", withdrawSA, U.SA],
  ])("AUTH-07: %s는 withdrawn이다", async (_, setup, userId) => {
    const value = await withActor(
      db,
      service,
      async (tx) =>
        (
          await tx.query<{ s: string }>(
            `select status::text as s from public.users where id = $1`,
            [userId],
          )
        ).rows[0]?.s,
      { setup },
    );
    expect(value).toBe("withdrawn");
  });
});

// ===========================================================================
// 컬럼 단위·관계 쓰기 (attemptWrite, 허용 짝과 함께)
// ===========================================================================

const write = (sql: string, params: unknown[], setup?: Setup): OpCase =>
  withSetup({ sql, params }, setup);

describe("#35 영상 컬럼 쓰기 — HW-05, HW-14, T-16, NFR-03 (팀장 결정 1)", () => {
  it.each<[string, ActorName, OpCase, "allow" | "reject"]>([
    [
      "HW-05: T1이 자기 예시 영상 EX1을 숨김",
      "T1",
      write(`update public.videos set hidden_in_library = true where id = $1`, [V.EX1]),
      "allow",
    ],
    [
      "HW-05: T1이 숨긴 예시 영상을 다시 보임",
      "T1",
      write(`update public.videos set hidden_in_library = false where id = $1`, [V.EX_HIDDEN]),
      "allow",
    ],
    [
      "NFR-03: T1이 자기 예시 영상의 upload_status를",
      "T1",
      write(`update public.videos set upload_status = 'failed' where id = $1`, [V.EX1]),
      "reject",
    ],
    [
      "HW-08: T1이 자기 예시 영상의 duration_sec을",
      "T1",
      write(`update public.videos set duration_sec = 10 where id = $1`, [V.EX1]),
      "reject",
    ],
    [
      "NFR-04: T1이 자기 예시 영상의 storage_key를",
      "T1",
      write(`update public.videos set storage_key = 'b4-client-key' where id = $1`, [V.EX1]),
      "reject",
    ],
    [
      "HW-14: T1이 자기 예시 영상의 purge_after를",
      "T1",
      write(`update public.videos set purge_after = '2030-01-01 00:00:00+09' where id = $1`, [
        V.EX1,
      ]),
      "reject",
    ],
    [
      "HW-14: T1이 자기 예시 영상의 purge_notified_at을",
      "T1",
      write(
        `update public.videos set purge_after = '2030-01-01 00:00:00+09', purge_notified_at = '2029-12-01 00:00:00+09' where id = $1`,
        [V.EX1],
      ),
      "reject",
    ],
    [
      "HW-04: T1이 자기 예시 영상의 purpose를",
      "T1",
      write(`update public.videos set purpose = 'profile' where id = $1`, [V.EX1]),
      "reject",
    ],
    [
      "HW-04: T1이 자기 예시 영상의 owner_id를",
      "T1",
      write(`update public.videos set owner_id = $2 where id = $1`, [V.EX1, U.T2]),
      "reject",
    ],
    [
      "HW-05: T1이 T2의 예시 영상을 숨김",
      "T1",
      write(`update public.videos set hidden_in_library = true where id = $1`, [V.EX_T2]),
      "reject",
    ],
    [
      "HW-12: 학생A가 자기 연습 영상을 숨김",
      "학생A",
      write(`update public.videos set hidden_in_library = true where id = $1`, [V.PA2]),
      "reject",
    ],
    [
      "HW-14: 학생C가 자기 연습 영상의 purge_after를",
      "학생C",
      write(`update public.videos set purge_after = '2030-01-01 00:00:00+09' where id = $1`, [
        V.PC1,
      ]),
      "reject",
    ],
    [
      "HW-14: 학생C가 자기 연습 영상의 purge_notified_at을 비움",
      "학생C",
      write(`update public.videos set purge_notified_at = null where id = $1`, [V.PC1]),
      "reject",
    ],
    [
      "AUTH-07: 탈퇴 T1이 자기 예시 영상을 숨김",
      "T1",
      write(`update public.videos set hidden_in_library = true where id = $1`, [V.EX1], withdrawT1),
      "reject",
    ],
  ])("%s → %s", async (_, actor, opCase, expected) => {
    expect(await attemptWrite(db, ACTORS[actor], opCase)).toBe(expected);
  });
});

describe("#35 숙제 컬럼·관계 쓰기 — HW-01, HW-02, HW-03, HW-04 (팀장 결정 1·4·6)", () => {
  it.each<[string, ActorName, OpCase, "allow" | "reject"]>([
    [
      "HW-02: T1이 HW1의 description을",
      "T1",
      write(`update public.homeworks set description = '묶음4 고친 설명' where id = $1`, [HW.HW1]),
      "allow",
    ],
    [
      "HW-02: T1이 HW1의 due_at을",
      "T1",
      write(`update public.homeworks set due_at = '2026-12-31 23:00:00+09' where id = $1`, [
        HW.HW1,
      ]),
      "allow",
    ],
    [
      "HW-02: T1이 HW1의 session_id를 자기 다른 회차로",
      "T1",
      write(`update public.homeworks set session_id = $2 where id = $1`, [HW.HW1, LS.A2]),
      "reject",
    ],
    [
      "HW-02: T1이 HW1의 trainer_id를 T2로",
      "T1",
      write(`update public.homeworks set trainer_id = $2 where id = $1`, [HW.HW1, U.T2]),
      "reject",
    ],
    [
      "HW-01: T2가 자기 이름으로 T1의 회차에 숙제",
      "T2",
      write(
        `insert into public.homeworks (session_id, trainer_id, description, due_at) values ($1, $2, '남의 회차', '2026-12-03 19:00:00+09')`,
        [LS.A2, U.T2],
      ),
      "reject",
    ],
    [
      "HW-01: T1이 T2의 회차에 숙제",
      "T1",
      write(
        `insert into public.homeworks (session_id, trainer_id, description, due_at) values ($1, $2, '남의 회차', '2026-12-04 21:00:00+09')`,
        [LS.B1, U.T1],
      ),
      "reject",
    ],
    [
      "HW-01: T1이 취소된 회차에 숙제",
      "T1",
      write(
        `insert into public.homeworks (session_id, trainer_id, description, due_at) values ($1, $2, '취소 회차', '2026-12-03 19:00:00+09')`,
        [LS.A_CANCELED, U.T1],
      ),
      "reject",
    ],
    [
      "HW-01: 운영자가 자기 이름으로 T1의 회차에 숙제",
      "운영자",
      write(
        `insert into public.homeworks (session_id, trainer_id, description, due_at) values ($1, $2, '운영자 숙제', '2026-12-03 19:00:00+09')`,
        [LS.A2, U.ADMIN],
      ),
      "reject",
    ],
    [
      "HW-03: T1이 HW3에 회차 참여 학생H를 대상으로",
      "T1",
      write(`insert into public.homework_targets (homework_id, student_id) values ($1, $2)`, [
        HW.HW3,
        U.SH,
      ]),
      "allow",
    ],
    [
      "HW-03: T1이 HW3에 수강 관계 없는 학생B를 대상으로",
      "T1",
      write(`insert into public.homework_targets (homework_id, student_id) values ($1, $2)`, [
        HW.HW3,
        U.SB,
      ]),
      "reject",
    ],
    [
      "HW-03: T1이 HW3에 회차 참여 행 없는 학생A를 대상으로",
      "T1",
      write(`insert into public.homework_targets (homework_id, student_id) values ($1, $2)`, [
        HW.HW3,
        U.SA,
      ]),
      "reject",
    ],
    [
      "HW-03: 학생H가 자기를 HW3 대상으로",
      "학생H",
      write(`insert into public.homework_targets (homework_id, student_id) values ($1, $2)`, [
        HW.HW3,
        U.SH,
      ]),
      "reject",
    ],
    [
      "HW-04: T1이 HW3에 자기 예시 영상 EX_FREE",
      "T1",
      write(`insert into public.homework_videos (homework_id, video_id) values ($1, $2)`, [
        HW.HW3,
        V.EX_FREE,
      ]),
      "allow",
    ],
    [
      "HW-04: T1이 HW3에 T2의 예시 영상",
      "T1",
      write(`insert into public.homework_videos (homework_id, video_id) values ($1, $2)`, [
        HW.HW3,
        V.EX_T2,
      ]),
      "reject",
    ],
    [
      "HW-04: T1이 HW3에 학생G의 연습 영상",
      "T1",
      write(`insert into public.homework_videos (homework_id, video_id) values ($1, $2)`, [
        HW.HW3,
        V.PG2,
      ]),
      "reject",
    ],
    [
      "HW-04: T2가 자기 예시 영상을 T1의 HW3에",
      "T2",
      write(`insert into public.homework_videos (homework_id, video_id) values ($1, $2)`, [
        HW.HW3,
        V.EX_T2,
      ]),
      "reject",
    ],
  ])("%s → %s", async (_, actor, opCase, expected) => {
    expect(await attemptWrite(db, ACTORS[actor], opCase)).toBe(expected);
  });
});

describe("#35 제출 쓰기 — HW-03, HW-06, HW-09, HW-12, HW-13 (팀장 결정 1·5)", () => {
  const submit = (homeworkId: string, studentId: string, videoId: string, setup?: Setup) =>
    write(
      `insert into public.submissions (homework_id, student_id, video_id, question) values ($1, $2, $3, '질문')`,
      [homeworkId, studentId, videoId],
      setup,
    );
  it.each<[string, ActorName, OpCase, "allow" | "reject"]>([
    ["HW-13: 학생A가 질문과 함께 HW1에 PA2로", "학생A", submit(HW.HW1, U.SA, V.PA2), "allow"],
    ["HW-06: 학생A가 student_id를 학생G로", "학생A", submit(HW.HW1, U.SG, V.PA2), "reject"],
    ["HW-06: 학생A가 학생G의 연습 영상으로", "학생A", submit(HW.HW1, U.SA, V.PG2), "reject"],
    ["HW-09: 학생A가 uploading 영상으로", "학생A", submit(HW.HW1, U.SA, V.PA_UPLOADING), "reject"],
    ["HW-09: 학생A가 failed 영상으로", "학생A", submit(HW.HW1, U.SA, V.PA_FAILED), "reject"],
    ["HW-06: 학생A가 이미 제출에 쓴 PA1로", "학생A", submit(HW.HW1, U.SA, V.PA1), "reject"],
    ["HW-12: 대상이 아닌 학생H가 HW3에 자기 PH2로", "학생H", submit(HW.HW3, U.SH, V.PH2), "reject"],
    ["HW-03: 학생B가 HW1에 자기 PB로", "학생B", submit(HW.HW1, U.SB, V.PB), "reject"],
    ["HW-06: T1이 자기 이름으로 제출", "T1", submit(HW.HW1, U.T1, V.EX1), "reject"],
    ["HW-06: 운영자가 자기 이름으로 제출", "운영자", submit(HW.HW1, U.ADMIN, V.PA2), "reject"],
  ])("%s → %s", async (_, actor, opCase, expected) => {
    expect(await attemptWrite(db, ACTORS[actor], opCase)).toBe(expected);
  });
});

describe("#35 피드백 쓰기 — HW-10 (팀장 결정 1·4, erd 9장)", () => {
  const comment = (submissionId: string, authorId: string, atSec: number | null) =>
    write(
      `insert into public.feedback_comments (submission_id, author_id, body, at_sec) values ($1, $2, '코멘트', $3)`,
      [submissionId, authorId, atSec],
    );
  it.each<[string, ActorName, OpCase, "allow" | "reject"]>([
    ["T1이 학생G 제출에 텍스트 코멘트", "T1", comment(SUB.G, U.T1, null), "allow"],
    ["T1이 학생G 제출에 시점 코멘트", "T1", comment(SUB.G, U.T1, 45), "allow"],
    ["T1이 author_id를 T2로", "T1", comment(SUB.G, U.T2, null), "reject"],
    ["T2가 자기 이름으로 T1 숙제의 제출에", "T2", comment(SUB.G, U.T2, null), "reject"],
    ["학생G가 자기 제출에 자기 이름으로", "학생G", comment(SUB.G, U.SG, null), "reject"],
    ["학생H가 학생G 제출에 자기 이름으로", "학생H", comment(SUB.G, U.SH, null), "reject"],
    ["운영자가 자기 이름으로", "운영자", comment(SUB.G, U.ADMIN, null), "reject"],
  ])("HW-10: %s → %s", async (_, actor, opCase, expected) => {
    expect(await attemptWrite(db, ACTORS[actor], opCase)).toBe(expected);
  });
});

describe("#35 프로필 영상 쓰기 — TRN-07, T-03 (팀장 결정 1·4)", () => {
  it.each<[string, ActorName, OpCase, "allow" | "reject"]>([
    ["T1이 PR3을 3번에", "T1", insertProfileVideo(), "allow"],
    [
      "T1이 T2의 프로필 영상을 자기 프로필에",
      "T1",
      write(
        `insert into public.trainer_profile_videos (trainer_id, video_id, sort_order) values ($1, $2, 3)`,
        [U.T1, V.PR_T2],
      ),
      "reject",
    ],
    [
      "T1이 자기 예시 영상을 프로필에",
      "T1",
      write(
        `insert into public.trainer_profile_videos (trainer_id, video_id, sort_order) values ($1, $2, 3)`,
        [U.T1, V.EX_FREE],
      ),
      "reject",
    ],
    [
      "T1이 업로드 중 프로필 영상을",
      "T1",
      write(
        `insert into public.trainer_profile_videos (trainer_id, video_id, sort_order) values ($1, $2, 3)`,
        [U.T1, V.PR_UPLOADING],
      ),
      "reject",
    ],
    [
      "T1이 sort_order를 4로",
      "T1",
      write(
        `update public.trainer_profile_videos set sort_order = 4 where trainer_id = $1 and video_id = $2`,
        [U.T1, V.PR2],
      ),
      "reject",
    ],
    [
      "T1이 PR2를 PR1과 같은 1번으로",
      "T1",
      write(
        `update public.trainer_profile_videos set sort_order = 1 where trainer_id = $1 and video_id = $2`,
        [U.T1, V.PR2],
      ),
      "reject",
    ],
    [
      "T1이 T2의 연결을 지움",
      "T1",
      write(`delete from public.trainer_profile_videos where trainer_id = $1`, [U.T2]),
      "reject",
    ],
    [
      "T2가 자기 이름으로 T1의 영상을",
      "T2",
      write(
        `insert into public.trainer_profile_videos (trainer_id, video_id, sort_order) values ($1, $2, 2)`,
        [U.T2, V.PR3],
      ),
      "reject",
    ],
  ])("TRN-07: %s → %s", async (_, actor, opCase, expected) => {
    expect(await attemptWrite(db, ACTORS[actor], opCase)).toBe(expected);
  });

  it("HW-14·TRN-07: T1이 프로필에서 PR2를 빼도 videos 행은 남는다", async () => {
    const result = await withActor(db, ACTORS.T1, async (tx) => {
      const removed = await tx.query(
        `delete from public.trainer_profile_videos where trainer_id = $1 and video_id = $2`,
        [U.T1, V.PR2],
      );
      await tx.exec("reset role");
      const left = await tx.query(`select 1 from public.videos where id = $1`, [V.PR2]);
      return { removed: removed.affectedRows, left: left.rows.length };
    });
    expect(result).toEqual({ removed: 1, left: 1 });
  });
});

// ===========================================================================
// 요구사항 ID별 대표 칸 (매트릭스와 같은 판정. 요구사항 추적용 이름)
// ===========================================================================

describe("#35 공개 범위·쓰기 대표 칸 — HW-01~HW-14, TRN-07, NFR-03, NFR-04, ADM-02, ADM-07, AUTH-07", () => {
  it.each<[string, ActorName, Op, OpCase, "allow" | "deny"]>([
    [
      "HW-09·ADM-07: 학생A는 자기 업로드 중 연습 영상을 읽는다",
      "학생A",
      "select",
      selectVideo(V.PA_UPLOADING),
      "allow",
    ],
    [
      "HW-09: T1은 자기 업로드 중 예시 영상을 읽는다",
      "T1",
      "select",
      selectVideo(V.EX_UPLOADING),
      "allow",
    ],
    [
      "ADM-07: 운영자는 학생A의 실패한 연습 영상을 읽는다",
      "운영자",
      "select",
      selectVideo(V.PA_FAILED),
      "allow",
    ],
    [
      "HW-12: 학생G는 HW3에만 붙은 예시 영상을 읽는다",
      "학생G",
      "select",
      selectVideo(V.EX3),
      "allow",
    ],
    [
      "HW-12: 학생H는 HW3에만 붙은 예시 영상을 읽지 못한다",
      "학생H",
      "select",
      selectVideo(V.EX3),
      "deny",
    ],
    [
      "HW-05: 학생H는 HW2에 붙은 숨긴 예시 영상을 계속 읽는다",
      "학생H",
      "select",
      selectVideo(V.EX_HIDDEN),
      "allow",
    ],
    [
      "HW-12: 학생A는 어느 숙제에도 붙지 않은 T1 예시 영상을 읽지 못한다",
      "학생A",
      "select",
      selectVideo(V.EX_FREE),
      "deny",
    ],
    [
      "HW-12: 학생G는 학생H의 HW2 연습 영상을 읽지 못한다",
      "학생G",
      "select",
      selectVideo(V.PH1),
      "deny",
    ],
    [
      "HW-12: T1은 자기 숙제에 제출된 학생H의 연습 영상을 읽는다",
      "T1",
      "select",
      selectVideo(V.PH1),
      "allow",
    ],
    [
      "NFR-04: T1은 제출에 붙지 않은 학생A의 업로드 중 연습 영상을 읽지 못한다",
      "T1",
      "select",
      selectVideo(V.PA_UPLOADING),
      "deny",
    ],
    [
      "NFR-04: T1은 제출에 붙지 않은 학생A의 ready 연습 영상을 읽지 못한다",
      "T1",
      "select",
      selectVideo(V.PA2),
      "deny",
    ],
    [
      "HW-14: 학생C는 끝난 수강권의 자기 연습 영상을 읽는다",
      "학생C",
      "select",
      selectVideo(V.PC1),
      "allow",
    ],
    [
      "HW-14: T1은 학생C의 지난 제출 영상을 계속 읽는다(PM 질문 2)",
      "T1",
      "select",
      selectVideo(V.PC1),
      "allow",
    ],
    [
      "TRN-07: anon은 T1 프로필에 붙은 영상을 읽는다",
      "anon",
      "select",
      selectVideo(V.PR1),
      "allow",
    ],
    [
      "ADM-02: anon은 정지 T1의 프로필 영상을 읽지 못한다",
      "anon",
      "select",
      selectVideo(V.PR1, suspendT1),
      "deny",
    ],
    [
      "ADM-02: 학생A(수강 관계)는 정지 T1의 프로필 영상을 읽는다",
      "학생A",
      "select",
      selectVideo(V.PR1, suspendT1),
      "allow",
    ],
    [
      "ADM-02: 학생B(수강 관계 없음)는 정지 T1의 프로필 영상을 읽지 못한다",
      "학생B",
      "select",
      selectVideo(V.PR1, suspendT1),
      "deny",
    ],
    [
      "TRN-07: 학생A는 T1 프로필에서 뺀 프로필 영상을 읽지 못한다",
      "학생A",
      "select",
      selectVideo(V.PR3),
      "deny",
    ],
    [
      "TRN-07: T1은 프로필에서 뺀 자기 프로필 영상을 읽는다",
      "T1",
      "select",
      selectVideo(V.PR3),
      "allow",
    ],
    ["NFR-04: 학생B는 T1의 예시 영상을 읽지 못한다", "학생B", "select", selectVideo(V.EX1), "deny"],
    ["NFR-04: T2는 T1 학생의 연습 영상을 읽지 못한다", "T2", "select", selectVideo(V.PH1), "deny"],
    ["NFR-04: anon은 T1의 예시 영상을 읽지 못한다", "anon", "select", selectVideo(V.EX1), "deny"],
    ["NFR-03: T1은 영상 행을 만들지 못한다", "T1", "insert", insertExampleVideo, "deny"],
    [
      "NFR-03: 학생H는 연습 영상 행을 만들지 못한다",
      "학생H",
      "insert",
      insertPracticeVideo,
      "deny",
    ],
    ["NFR-03: T1은 자기 예시 영상 행을 지우지 못한다", "T1", "delete", deleteVideo(V.EX1), "deny"],
    ["NFR-03: 운영자는 영상 행을 지우지 못한다", "운영자", "delete", deleteVideo(V.PH1), "deny"],
    ["HW-05: T1은 자기 예시 영상을 보관함에서 숨긴다", "T1", "update", hideVideo(V.EX1), "allow"],
    [
      "AUTH-07: 탈퇴 T1은 자기 예시 영상을 숨기지 못한다",
      "T1",
      "update",
      hideVideo(V.EX1, withdrawT1),
      "deny",
    ],
    [
      "HW-12: 학생은 영상을 고치지 못한다(학생H 자기 연습 영상)",
      "학생H",
      "update",
      hideVideo(V.PH1),
      "deny",
    ],

    ["HW-11: T1은 자기 숙제 HW3을 읽는다", "T1", "select", selectHomework(HW.HW3), "allow"],
    ["ADM-07: 운영자는 HW3을 읽는다", "운영자", "select", selectHomework(HW.HW3), "allow"],
    ["HW-03: 학생H는 HW3을 읽지 못한다", "학생H", "select", selectHomework(HW.HW3), "deny"],
    ["HW-03: 학생A는 HW2를 읽지 못한다", "학생A", "select", selectHomework(HW.HW2), "deny"],
    [
      "HW-11: 학생C는 끝난 수강권 회차의 지난 숙제를 읽는다",
      "학생C",
      "select",
      selectHomework(HW.HW_C),
      "allow",
    ],
    ["HW-12: 학생B는 T1의 숙제를 읽지 못한다", "학생B", "select", selectHomework(HW.HW1), "deny"],
    ["HW-12: T2는 T1의 숙제를 읽지 못한다", "T2", "select", selectHomework(HW.HW1), "deny"],
    ["HW-12: anon은 T1의 숙제를 읽지 못한다", "anon", "select", selectHomework(HW.HW1), "deny"],
    [
      "HW-12: 학생G는 HW2의 학생H 대상 줄을 읽지 못한다(팀장 결정 3)",
      "학생G",
      "select",
      selectTarget(HW.HW2, U.SH),
      "deny",
    ],
    [
      "HW-12: 학생G는 HW2의 자기 대상 줄을 읽는다",
      "학생G",
      "select",
      selectTarget(HW.HW2, U.SG),
      "allow",
    ],
    [
      "HW-11: T1은 HW2의 대상 줄을 모두 읽는다",
      "T1",
      "select",
      selectTarget(HW.HW2, U.SH),
      "allow",
    ],
    [
      "HW-02: 학생A는 자기 숙제 HW1의 예시 영상 연결을 읽는다",
      "학생A",
      "select",
      selectHomeworkVideo(HW.HW1, V.EX1),
      "allow",
    ],
    [
      "HW-12: 학생H는 HW3의 예시 영상 연결을 읽지 못한다",
      "학생H",
      "select",
      selectHomeworkVideo(HW.HW3, V.EX3),
      "deny",
    ],
    ["HW-01: T1은 자기 회차에 숙제를 만든다", "T1", "insert", insertHomework(), "allow"],
    [
      "HW-03: T1은 HW3에 회차 참여 학생H를 대상으로 넣는다",
      "T1",
      "insert",
      insertTargetHW3H(),
      "allow",
    ],
    [
      "HW-04: T1은 HW3에 자기 예시 영상을 붙인다",
      "T1",
      "insert",
      insertHomeworkVideoHW3EX1(),
      "allow",
    ],
    ["HW-02: T1은 HW1의 설명·마감을 고친다", "T1", "update", updateHomework(HW.HW1), "allow"],
    [
      "HW-01: T1은 HW1을 지우지 못한다",
      "T1",
      "delete",
      { sql: `delete from public.homeworks where id = $1`, params: [HW.HW1] },
      "deny",
    ],
    ["HW-01: T2는 T1의 숙제를 고치지 못한다", "T2", "update", updateHomework(HW.HW1), "deny"],
    [
      "ADM-07: 운영자는 T1의 숙제를 고치지 못한다",
      "운영자",
      "update",
      updateHomework(HW.HW1),
      "deny",
    ],
    ["HW-01: 학생G는 숙제를 고치지 못한다", "학생G", "update", updateHomework(HW.HW2), "deny"],
    ["HW-03: 학생은 대상 줄을 만들지 못한다", "학생H", "insert", insertTargetHW3H(), "deny"],
    [
      "HW-04: 학생은 예시 영상 연결을 만들지 못한다",
      "학생G",
      "insert",
      insertHomeworkVideoHW3EX1(),
      "deny",
    ],
    ["ADM-02: 정지 T1은 숙제를 만든다", "T1", "insert", insertHomework(suspendT1), "allow"],
    ["ADM-02: 정지 T1은 숙제를 고친다", "T1", "update", updateHomework(HW.HW1, suspendT1), "allow"],
    ["AUTH-07: 탈퇴 T1은 숙제를 만들지 못한다", "T1", "insert", insertHomework(withdrawT1), "deny"],
    [
      "AUTH-07: 탈퇴 T1은 숙제를 고치지 못한다",
      "T1",
      "update",
      updateHomework(HW.HW1, withdrawT1),
      "deny",
    ],
    [
      "AUTH-07: 탈퇴 T1은 숙제 대상을 넣지 못한다",
      "T1",
      "insert",
      insertTargetHW3H(withdrawT1),
      "deny",
    ],
    [
      "AUTH-07: 탈퇴 T1은 예시 영상을 붙이지 못한다",
      "T1",
      "insert",
      insertHomeworkVideoHW3EX1(withdrawT1),
      "deny",
    ],

    [
      "HW-12: 학생G는 학생H의 HW2 제출을 읽지 못한다",
      "학생G",
      "select",
      selectSubmission(SUB.H),
      "deny",
    ],
    ["HW-11: T1은 자기 숙제의 제출을 읽는다", "T1", "select", selectSubmission(SUB.H), "allow"],
    ["ADM-07: 운영자는 제출을 읽는다", "운영자", "select", selectSubmission(SUB.H), "allow"],
    [
      "HW-12: 학생B는 T1 숙제의 제출을 읽지 못한다",
      "학생B",
      "select",
      selectSubmission(SUB.H),
      "deny",
    ],
    ["HW-12: T2는 T1 숙제의 제출을 읽지 못한다", "T2", "select", selectSubmission(SUB.H), "deny"],
    [
      "HW-12: anon은 T1 숙제의 제출을 읽지 못한다",
      "anon",
      "select",
      selectSubmission(SUB.H),
      "deny",
    ],
    [
      "HW-06: 학생A는 자기 연습 영상으로 HW1에 제출한다",
      "학생A",
      "insert",
      insertSubmission(HW.HW1, U.SA, V.PA2),
      "allow",
    ],
    [
      "HW-07: 학생C는 끝난 수강권 회차의 숙제에 제출한다",
      "학생C",
      "insert",
      insertSubmission(HW.HW_C, U.SC, V.PC2),
      "allow",
    ],
    [
      "HW-07: 학생H는 자기 제출을 고치지 못한다",
      "학생H",
      "update",
      { sql: `update public.submissions set question = '고침' where id = $1`, params: [SUB.H] },
      "deny",
    ],
    [
      "HW-07: 학생H는 자기 제출을 지우지 못한다",
      "학생H",
      "delete",
      { sql: `delete from public.submissions where id = $1`, params: [SUB.H] },
      "deny",
    ],
    [
      "HW-07: T1은 제출을 지우지 못한다",
      "T1",
      "delete",
      { sql: `delete from public.submissions where id = $1`, params: [SUB.H] },
      "deny",
    ],
    [
      "HW-06: T1은 제출을 만들지 못한다",
      "T1",
      "insert",
      insertSubmission(HW.HW1, U.SA, V.PA2),
      "deny",
    ],
    [
      "HW-06: 운영자는 제출을 만들지 못한다",
      "운영자",
      "insert",
      insertSubmission(HW.HW1, U.SA, V.PA2),
      "deny",
    ],
    [
      "AUTH-07: 탈퇴 학생A는 제출하지 못한다",
      "학생A",
      "insert",
      insertSubmission(HW.HW1, U.SA, V.PA2, withdrawSA),
      "deny",
    ],

    [
      "HW-10: 학생H는 자기 제출의 피드백을 읽는다",
      "학생H",
      "select",
      selectFeedback(SUB.H),
      "allow",
    ],
    [
      "HW-10: 학생G는 학생H 제출의 피드백을 읽지 못한다",
      "학생G",
      "select",
      selectFeedback(SUB.H),
      "deny",
    ],
    [
      "HW-10: 학생B·T2·anon은 피드백을 읽지 못한다(학생B)",
      "학생B",
      "select",
      selectFeedback(SUB.H),
      "deny",
    ],
    ["HW-10: T2는 피드백을 읽지 못한다", "T2", "select", selectFeedback(SUB.H), "deny"],
    ["HW-10: anon은 피드백을 읽지 못한다", "anon", "select", selectFeedback(SUB.H), "deny"],
    [
      "HW-10: T1은 자기 숙제 제출에 텍스트 코멘트를 단다",
      "T1",
      "insert",
      insertFeedback(null),
      "allow",
    ],
    [
      "HW-10: T1은 자기 숙제 제출에 시점 코멘트를 단다",
      "T1",
      "insert",
      insertFeedback(30),
      "allow",
    ],
    [
      "HW-10: T1은 피드백을 고치지 못한다",
      "T1",
      "update",
      {
        sql: `update public.feedback_comments set body = '고침' where id = $1`,
        params: [FB.H_TEXT],
      },
      "deny",
    ],
    [
      "HW-10: T1은 피드백을 지우지 못한다",
      "T1",
      "delete",
      { sql: `delete from public.feedback_comments where id = $1`, params: [FB.H_TEXT] },
      "deny",
    ],
    ["ADM-02: 정지 T1은 피드백을 단다", "T1", "insert", insertFeedback(null, suspendT1), "allow"],
    [
      "AUTH-07: 탈퇴 T1은 피드백을 달지 못한다",
      "T1",
      "insert",
      insertFeedback(null, withdrawT1),
      "deny",
    ],

    [
      "TRN-07: anon은 T1의 프로필 영상 연결을 읽는다",
      "anon",
      "select",
      selectProfileVideo(U.T1, V.PR1),
      "allow",
    ],
    [
      "ADM-02: anon은 정지 T1의 프로필 영상 연결을 읽지 못한다",
      "anon",
      "select",
      selectProfileVideo(U.T1, V.PR1, suspendT1),
      "deny",
    ],
    [
      "ADM-02: 학생C(수강 관계)는 정지 T1의 프로필 영상 연결을 읽는다",
      "학생C",
      "select",
      selectProfileVideo(U.T1, V.PR1, suspendT1),
      "allow",
    ],
    ["TRN-07: T1은 프로필 영상을 붙인다", "T1", "insert", insertProfileVideo(), "allow"],
    ["TRN-07: T1은 프로필 영상 순서를 바꾼다", "T1", "update", reorderProfileVideo(), "allow"],
    ["TRN-07: T1은 프로필 영상을 뺀다", "T1", "delete", removeProfileVideo(), "allow"],
    [
      "TRN-07: T2는 T1의 프로필 영상 연결을 지우지 못한다",
      "T2",
      "delete",
      removeProfileVideo(),
      "deny",
    ],
    [
      "TRN-07: 운영자는 T1의 프로필 영상 연결을 고치지 못한다",
      "운영자",
      "update",
      reorderProfileVideo(),
      "deny",
    ],
    [
      "TRN-07: 학생A는 T1의 프로필 영상 연결을 만들지 못한다",
      "학생A",
      "insert",
      insertProfileVideo(),
      "deny",
    ],
    [
      "ADM-02: 정지 T1은 프로필 영상 순서를 바꾼다",
      "T1",
      "update",
      reorderProfileVideo(suspendT1),
      "allow",
    ],
    [
      "AUTH-07: 탈퇴 T1은 프로필 영상을 붙이지 못한다",
      "T1",
      "insert",
      insertProfileVideo(withdrawT1),
      "deny",
    ],
    [
      "AUTH-07: 탈퇴 T1은 프로필 영상을 빼지 못한다",
      "T1",
      "delete",
      removeProfileVideo(withdrawT1),
      "deny",
    ],
  ])("%s", async (_, actor, op, opCase, expected) => {
    expect(await attempt(db, ACTORS[actor] as Actor, op, opCase)).toBe(expected);
  });
});
