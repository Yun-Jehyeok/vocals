// 인수 테스트: 이슈 #35 묶음 4 — 스키마, enum, 판정 함수, seed 더미 데이터
// (QA가 개발 전에 쓴다. 개발은 고치지 않는다. 틀렸다고 보면 `[질문] 받는 역할: QA`)
//
// 완료 조건 → 테스트
// - 스키마: 7개 테이블·컬럼 이름(erd 2·5장, 표기 규칙: 모든 테이블에 id·created_at), RLS, enum 3개(erd·domain.ts),
//   visibility 기본값 private, 숙제 상태 컬럼 없음, 필수 컬럼(not null)
// - 판정 함수: 새 판정은 private 스키마에 있고 anon은 security definer 판정 함수를 실행할 수 없다.
//   수강 관계·정지 트레이너 판정은 새로 만들지 않는다. 클라이언트 쓰기 정책에는 모두 is_active_user가 붙어 있다
// - 공통: seed에 이번 묶음 더미 데이터가 있다
// 테스트로 쓰지 않는 것(판정 때 코드·CI로 확인): 새 마이그레이션 파일(check:migrations),
//   빈 DB 적용(이 파일의 createTestDb가 shim → 마이그레이션 → seed를 적용한다), service role key 위치,
//   seed의 storage_key가 가짜 값인지(값의 출처라 DB로 판정할 수 없다. seed.sql을 읽고 본다)
import type { PGlite } from "@electric-sql/pglite";
import * as shared from "@vocals/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "../helpers/db.ts";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

const BUNDLE4_TABLES = [
  "videos",
  "homeworks",
  "homework_targets",
  "homework_videos",
  "submissions",
  "feedback_comments",
  "trainer_profile_videos",
] as const;

/** docs/erd.md 2·5장 컬럼 (표기 규칙: 모든 테이블에 id, created_at) */
const ERD_COLUMNS: Record<(typeof BUNDLE4_TABLES)[number], string[]> = {
  videos: [
    "id",
    "owner_id",
    "purpose",
    "storage_key",
    "duration_sec",
    "upload_status",
    "visibility",
    "hidden_in_library",
    "ticket_id",
    "purge_after",
    "purge_notified_at",
    "created_at",
  ],
  homeworks: ["id", "session_id", "trainer_id", "description", "due_at", "created_at"],
  homework_targets: ["id", "homework_id", "student_id", "created_at"],
  homework_videos: ["id", "homework_id", "video_id", "created_at"],
  submissions: [
    "id",
    "homework_id",
    "student_id",
    "video_id",
    "question",
    "submitted_at",
    "created_at",
  ],
  feedback_comments: ["id", "submission_id", "author_id", "body", "at_sec", "created_at"],
  trainer_profile_videos: ["id", "trainer_id", "video_id", "sort_order", "created_at"],
};

/** erd 5장 enum 값 (erd 1장 표기: 타입 이름은 <테이블>_<컬럼>) */
const ERD_ENUMS: Record<string, string[]> = {
  videos_purpose: ["profile", "example", "practice"],
  videos_upload_status: ["uploading", "ready", "failed"],
  videos_visibility: ["private"],
};

const COLUMN_TYPES: [table: string, column: string, type: string][] = [
  ["videos", "purpose", "videos_purpose"],
  ["videos", "upload_status", "videos_upload_status"],
  ["videos", "visibility", "videos_visibility"],
];

/** 비어 있으면 안 되는 컬럼 (erd 5장 "video_id 필수", 완료 조건 "description은 비어 있지 않고 due_at은 있다") */
const NOT_NULL_COLUMNS: [table: string, column: string, id: string][] = [
  ["homeworks", "session_id", "HW-01"],
  ["homeworks", "trainer_id", "HW-01"],
  ["homeworks", "description", "HW-02"],
  ["homeworks", "due_at", "HW-02"],
  ["homework_targets", "homework_id", "HW-03"],
  ["homework_targets", "student_id", "HW-03"],
  ["homework_videos", "homework_id", "HW-04"],
  ["homework_videos", "video_id", "HW-04"],
  ["submissions", "homework_id", "HW-06"],
  ["submissions", "student_id", "HW-06"],
  ["submissions", "video_id", "HW-06"],
  ["submissions", "submitted_at", "HW-07"],
  ["feedback_comments", "submission_id", "HW-10"],
  ["feedback_comments", "author_id", "HW-10"],
  ["feedback_comments", "body", "HW-10"],
  ["videos", "owner_id", "HW-04"],
  ["videos", "purpose", "HW-04"],
  ["videos", "upload_status", "HW-09"],
  ["videos", "visibility", "HW-12"],
  ["trainer_profile_videos", "trainer_id", "TRN-07"],
  ["trainer_profile_videos", "video_id", "TRN-07"],
  ["trainer_profile_videos", "sort_order", "TRN-07"],
];

describe("#35 스키마 — erd 2·5장, tech-stack 3.11, HW-04, HW-12, TRN-07", () => {
  it.each(BUNDLE4_TABLES)("HW-11·TRN-07: %s의 컬럼이 erd와 같다", async (table) => {
    const { rows } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = $1`,
      [table],
    );
    expect(rows.map((row) => row.column_name).sort()).toEqual([...ERD_COLUMNS[table]].sort());
  });

  it.each(BUNDLE4_TABLES)("HW-12: %s에 RLS가 켜져 있다", async (table) => {
    const { rows } = await db.query<{ relrowsecurity: boolean }>(
      `select c.relrowsecurity from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = $1 and c.relkind = 'r'`,
      [table],
    );
    expect(rows).toEqual([{ relrowsecurity: true }]);
  });

  it.each(Object.entries(ERD_ENUMS))(
    "HW-04·HW-12: enum %s의 값이 erd와 같다",
    async (type, values) => {
      const { rows } = await db.query<{ enumlabel: string }>(
        `select e.enumlabel from pg_enum e
       join pg_type t on t.oid = e.enumtypid
       join pg_namespace n on n.oid = t.typnamespace
       where n.nspname = 'public' and t.typname = $1
       order by e.enumsortorder`,
        [type],
      );
      expect(rows.map((row) => row.enumlabel)).toEqual(values);
    },
  );

  it.each(Object.entries(ERD_ENUMS))(
    "HW-04·HW-12: enum %s의 값이 packages/shared/src/domain.ts의 상수 하나와 같다",
    (type, values) => {
      const constants = Object.values(shared as Record<string, unknown>).filter(
        (value): value is readonly string[] => Array.isArray(value),
      );
      expect(
        constants.some((constant) => JSON.stringify(constant) === JSON.stringify(values)),
        `${type}: ${values.join(", ")}`,
      ).toBe(true);
    },
  );

  it.each(COLUMN_TYPES)("HW-04: %s.%s의 타입은 %s다", async (table, column, type) => {
    const { rows } = await db.query<{ udt_name: string }>(
      `select udt_name from information_schema.columns
       where table_schema = 'public' and table_name = $1 and column_name = $2`,
      [table, column],
    );
    expect(rows).toEqual([{ udt_name: type }]);
  });

  it("HW-12: videos.visibility의 기본값은 private이다 (1단계에는 다른 값이 없다, erd 9장)", async () => {
    const { rows } = await db.query<{ column_default: string | null }>(
      `select column_default from information_schema.columns
       where table_schema = 'public' and table_name = 'videos' and column_name = 'visibility'`,
    );
    expect(rows.length).toBe(1);
    expect(rows[0]?.column_default ?? "").toMatch(/^'private'::/);
  });

  it("HW-11: 숙제 상태 컬럼이 없다 — 제출됨/미제출은 submissions 유무로 판단한다", async () => {
    const { rows } = await db.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
       where table_schema = 'public'
         and table_name in ('homeworks', 'homework_targets')
         and column_name ~ '(status|state|submitted|checked|done)'`,
    );
    expect(rows).toEqual([]);
  });

  it.each(NOT_NULL_COLUMNS)("%s.%s는 비어 있을 수 없다 (%s)", async (table, column) => {
    const { rows } = await db.query<{ is_nullable: string }>(
      `select is_nullable from information_schema.columns
       where table_schema = 'public' and table_name = $1 and column_name = $2`,
      [table, column],
    );
    expect(rows).toEqual([{ is_nullable: "NO" }]);
  });
});

// ===========================================================================
// 판정 함수
// ===========================================================================

/** 묶음 1~3(마이그레이션 20261119170000·20261121120000·20261121150000·20261121180000)까지의 private 함수 */
const EXISTING_PRIVATE_FUNCTIONS = new Set([
  "can_request_refund",
  "enrollment_student_id",
  "enrollment_trainer_id",
  "fixed_schedule_group_class_id",
  "fixed_schedule_trainer_id",
  "fixed_schedules_before_write",
  "generate_link_slug",
  "group_class_student_count",
  "group_class_trainer_id",
  "group_classes_before_update",
  "has_enrollment_with",
  "is_active_user",
  "is_admin",
  "is_assigned_to_group_class",
  "is_enrollment_member",
  "is_own_student",
  "is_session_attendee",
  "is_ticket_member",
  "lesson_product_trainer_id",
  "lesson_products_before_update",
  "lesson_session_trainer_id",
  "lesson_sessions_before_delete",
  "lesson_sessions_before_write",
  "session_attendees_before_write",
  "session_has_deducted_attendee",
  "tickets_before_write",
  "trainer_approval_status",
  "trainer_can_edit_business_info",
  "trainer_profile_is_public",
  "trainer_profiles_before_write",
  "user_role",
]);

describe("#35 판정 함수는 private 스키마에 있고 기존 판정을 다시 쓴다 — HW-12, NFR-04, AUTH-07, TRN-07, 묶음 1~3 권한 원칙", () => {
  type Fn = { name: string; definition: string; anon_exec: boolean; secdef: boolean };
  const newPrivateFunctions = async () =>
    (
      await db.query<Fn>(
        `select p.proname as name, pg_get_functiondef(p.oid) as definition,
                has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
                p.prosecdef as secdef
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'private' and p.prokind = 'f'`,
      )
    ).rows.filter((fn) => !EXISTING_PRIVATE_FUNCTIONS.has(fn.name));

  const BUNDLE4_TABLE_PATTERN =
    /\bpublic\.(videos|homeworks|homework_targets|homework_videos|submissions|feedback_comments|trainer_profile_videos)\b/;

  it("HW-12·NFR-04: 묶음 4 테이블을 조회하는 새 private 함수가 있다(숙제의 트레이너, 숙제 대상 여부, 영상 읽기 등)", async () => {
    const functions = (await newPrivateFunctions()).filter((fn) =>
      BUNDLE4_TABLE_PATTERN.test(fn.definition),
    );
    expect(functions.length).toBeGreaterThan(0);
  });

  it("HW-12·NFR-04: 새 security definer private 함수는 anon이 실행할 수 없다", async () => {
    const functions = await newPrivateFunctions();
    expect(functions.length).toBeGreaterThan(0);
    expect(functions.filter((fn) => fn.secdef && fn.anon_exec).map((fn) => fn.name)).toEqual([]);
  });

  it("HW-12: 새 private 함수는 수강 관계(enrollments)를 직접 조회하지 않는다 (기존 enrollment_*·is_ticket_member 함수를 다시 쓴다)", async () => {
    const functions = await newPrivateFunctions();
    expect(functions.length).toBeGreaterThan(0);
    expect(
      functions.filter((fn) => /\bpublic\.enrollments\b/.test(fn.definition)).map((fn) => fn.name),
    ).toEqual([]);
  });

  it("TRN-07·ADM-02: 새 private 함수는 트레이너 승인 상태(approval_status)를 판정하지 않는다 (정지 기준은 trainer_profiles 읽기 정책을 거친다)", async () => {
    const functions = await newPrivateFunctions();
    expect(functions.length).toBeGreaterThan(0);
    expect(
      functions
        .filter((fn) => /approval_status|has_enrollment_with/.test(fn.definition))
        .map((fn) => fn.name),
    ).toEqual([]);
  });

  it.each(BUNDLE4_TABLES)(
    "HW-12: %s의 authenticated 정책은 enrollments·tickets·group_classes를 직접 조회하지 않는다(판정은 private 함수)",
    async (table) => {
      const { rows } = await db.query<{
        policyname: string;
        qual: string | null;
        with_check: string | null;
      }>(
        `select policyname, qual, with_check from pg_policies
         where schemaname = 'public' and tablename = $1 and 'authenticated' = any(roles)`,
        [table],
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const body = `${row.qual ?? ""} ${row.with_check ?? ""}`;
        expect(body, row.policyname).not.toMatch(/\b(enrollments|tickets|group_classes)\b/);
      }
    },
  );

  it("TRN-07·ADM-02: trainer_profile_videos의 select 정책은 trainer_profiles 읽기 정책을 거친다(trainer_genres_select와 같은 방식)", async () => {
    const { rows } = await db.query<{ policyname: string; qual: string | null }>(
      `select policyname, qual from pg_policies
       where schemaname = 'public' and tablename = 'trainer_profile_videos' and cmd in ('SELECT', 'ALL')
         and 'anon' = any(roles)`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => /\btrainer_profiles\b/.test(row.qual ?? ""))).toBe(true);
  });

  it.each(BUNDLE4_TABLES)(
    "AUTH-07: %s의 클라이언트(authenticated) 쓰기 정책은 모두 private.is_active_user로 탈퇴를 판정한다",
    async (table) => {
      const { rows } = await db.query<{
        policyname: string;
        qual: string | null;
        with_check: string | null;
      }>(
        `select policyname, qual, with_check from pg_policies
         where schemaname = 'public' and tablename = $1 and 'authenticated' = any(roles)
           and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')`,
        [table],
      );
      for (const row of rows) {
        expect(`${row.qual ?? ""} ${row.with_check ?? ""}`, row.policyname).toMatch(
          /is_active_user/,
        );
      }
    },
  );

  it("AUTH-07: 클라이언트가 쓰는 테이블(숙제·대상·예시 영상 연결·제출·피드백·프로필 영상·영상 숨김)에 쓰기 정책이 있다", async () => {
    const { rows } = await db.query<{ tablename: string }>(
      `select distinct tablename from pg_policies
       where schemaname = 'public' and 'authenticated' = any(roles)
         and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
         and tablename = any($1)`,
      [[...BUNDLE4_TABLES]],
    );
    expect(rows.map((row) => row.tablename).sort()).toEqual([...BUNDLE4_TABLES].sort());
  });

  it("HW-14·AUTH-08: 수강권·사용자 테이블에 묶음 4 테이블을 쓰는 트리거가 없다(DB는 purge_after를 계산하지 않는다)", async () => {
    const { rows } = await db.query<{ trigger: string; definition: string }>(
      `select t.tgname as trigger, pg_get_functiondef(t.tgfoid) as definition
       from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname in ('tickets', 'users') and not t.tgisinternal`,
    );
    expect(
      rows.filter((row) => /\b(videos|purge_after|purge_notified_at)\b/.test(row.definition)),
    ).toEqual([]);
  });
});

// ===========================================================================
// seed
// ===========================================================================

describe("#35 seed에 이번 묶음 더미 데이터가 있다 — #10 공통, HW-01~HW-14, TRN-07", () => {
  it.each<[string, string]>([
    [
      "HW-04·HW-05: 한 트레이너의 예시 영상 3개 이상, 그중 숨긴 것이 숙제에 붙어 있다",
      `select 1 from public.videos v
       where v.purpose = 'example'
         and (select count(*) from public.videos o
              where o.owner_id = v.owner_id and o.purpose = 'example') >= 3
         and v.hidden_in_library
         and exists (select 1 from public.homework_videos hv where hv.video_id = v.id)`,
    ],
    [
      "HW-01·HW-02: 1:1 회차 숙제에 예시 영상이 1개 붙어 있다",
      `select 1 from public.homeworks h
       join public.lesson_sessions l on l.id = h.session_id
       where l.group_class_id is null
         and (select count(*) from public.homework_videos hv where hv.homework_id = h.id) = 1`,
    ],
    [
      "HW-03: 그룹 회차에 대상 2명 이상인 숙제(그룹 전체)와 같은 회차에 대상 1명인 숙제(일부)",
      `select 1 from public.homeworks h1
       join public.homeworks h2 on h2.session_id = h1.session_id and h2.id <> h1.id
       join public.lesson_sessions l on l.id = h1.session_id
       where l.group_class_id is not null
         and (select count(*) from public.homework_targets t where t.homework_id = h1.id) >= 2
         and (select count(*) from public.homework_targets t where t.homework_id = h2.id) = 1`,
    ],
    [
      "HW-02: 예시 영상이 없는 숙제",
      `select 1 from public.homeworks h
       where not exists (select 1 from public.homework_videos hv where hv.homework_id = h.id)`,
    ],
    [
      "HW-07: 한 학생이 1:1 숙제에 2번 이상 제출",
      `select 1 from public.submissions s
       join public.homeworks h on h.id = s.homework_id
       join public.lesson_sessions l on l.id = h.session_id
       where l.group_class_id is null
       group by s.homework_id, s.student_id having count(*) >= 2`,
    ],
    [
      "HW-12: 그룹 숙제 하나에 학생 2명 이상의 제출",
      `select 1 from public.submissions s
       join public.homeworks h on h.id = s.homework_id
       join public.lesson_sessions l on l.id = h.session_id
       where l.group_class_id is not null
       group by s.homework_id having count(distinct s.student_id) >= 2`,
    ],
    [
      "HW-10: 텍스트 코멘트(at_sec 없음)",
      `select 1 from public.feedback_comments where at_sec is null`,
    ],
    [
      "HW-10: 시점 코멘트(at_sec 있음)",
      `select 1 from public.feedback_comments where at_sec is not null`,
    ],
    [
      "HW-09: 제출에 붙지 않은 uploading 연습 영상",
      `select 1 from public.videos v
       where v.purpose = 'practice' and v.upload_status = 'uploading'
         and not exists (select 1 from public.submissions s where s.video_id = v.id)`,
    ],
    [
      "HW-14: 끝난 수강권의 연습 영상과 제출(purge_after·purge_notified_at 있음)",
      `select 1 from public.videos v
       join public.tickets t on t.id = v.ticket_id
       join public.submissions s on s.video_id = v.id
       where v.purpose = 'practice' and t.status = 'ended'
         and v.purge_after is not null and v.purge_notified_at is not null`,
    ],
    [
      "TRN-07: 프로필 영상 3개가 붙은 트레이너",
      `select 1 from public.trainer_profile_videos
       group by trainer_id having count(*) = 3`,
    ],
    [
      "TRN-07: 프로필에 붙지 않은 프로필 영상",
      `select 1 from public.videos v
       where v.purpose = 'profile'
         and not exists (select 1 from public.trainer_profile_videos p where p.video_id = v.id)`,
    ],
    [
      "TRN-07·ADM-02: 정지 트레이너의 프로필 영상",
      `select 1 from public.trainer_profile_videos p
       join public.trainer_profiles tp on tp.user_id = p.trainer_id
       where tp.approval_status = 'suspended'`,
    ],
  ])("%s", async (_, sql) => {
    const { rows } = await db.query(sql);
    expect(rows.length).toBeGreaterThan(0);
  });

  it.each(["uploading", "ready", "failed"])(
    "HW-09: seed에 upload_status %s인 영상이 있다",
    async (status) => {
      const { rows } = await db.query(
        `select 1 from public.videos where upload_status::text = $1`,
        [status],
      );
      expect(rows.length).toBeGreaterThan(0);
    },
  );
});
