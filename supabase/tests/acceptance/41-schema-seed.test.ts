// 인수 테스트: 이슈 #41 묶음 6 — 스키마, enum, 판정 함수, seed 더미 데이터
// (QA가 개발 전에 쓴다. 개발은 고치지 않는다. 틀렸다고 보면 `[질문] 받는 역할: QA`)
//
// 완료 조건 → 테스트
// - 스키마: 9개 테이블·컬럼 이름(erd 7·8장, 표기 규칙: review_replies는 review_id가 PK, 나머지는 id·created_at),
//   RLS, enum 7개(erd·domain.ts), 후기 별점 컬럼 없음, notifications.type은 enum이 아닌 문자열·payload는 JSON,
//   필수 컬럼(not null)
// - 판정 함수: 새 판정은 private 스키마에 있고 anon은 security definer 판정 함수를 실행할 수 없다.
//   수강 관계는 기존 함수를 다시 쓴다(새 함수가 enrollments를 직접 조회하지 않는다). 후기·답글 읽기는
//   trainer_profiles 읽기 정책을 거친다(새 함수가 approval_status를 판정하지 않는다).
//   클라이언트 쓰기 정책에는 모두 is_active_user가 붙어 있다.
//   클라이언트 insert가 있는 blocks·reports는 <테이블>_authorize_insert 트리거가 다른 BEFORE INSERT 트리거보다 먼저 돈다(#38)
// - 공통: seed에 이번 묶음 더미 데이터가 있다
// 테이블이 없을 때도 참인 단언(정책 for-loop, "별점 컬럼 없음")은 개발 전에도 통과한다. 같은 describe의
//   "컬럼이 erd와 같다"·"쓰기 정책이 있다"가 짝이다(QA 메모리, #35).
// 테스트로 쓰지 않는 것(판정 때 코드·CI로 확인): 새 마이그레이션 파일(check:migrations), 빈 DB 적용(createTestDb가
//   shim → 마이그레이션 → seed를 적용한다), service role key 위치, seed의 토큰·사진 주소가 가짜 값인지(seed.sql을 읽고 본다)
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

const BUNDLE6_TABLES = [
  "chat_rooms",
  "chat_members",
  "messages",
  "reviews",
  "review_replies",
  "blocks",
  "reports",
  "push_tokens",
  "notifications",
] as const;
type Bundle6Table = (typeof BUNDLE6_TABLES)[number];

/** docs/erd.md 7·8장 컬럼 (표기 규칙: review_replies는 review_id가 PK, 나머지는 id·created_at) */
const ERD_COLUMNS: Record<Bundle6Table, string[]> = {
  chat_rooms: ["id", "type", "trainer_id", "created_at"],
  chat_members: [
    "id",
    "room_id",
    "user_id",
    "member_role",
    "muted",
    "joined_at",
    "left_at",
    "left_reason",
    "created_at",
  ],
  messages: ["id", "room_id", "sender_id", "kind", "body", "image_url", "hidden_by", "created_at"],
  reviews: [
    "id",
    "trainer_id",
    "student_id",
    "ticket_id",
    "body",
    "hidden",
    "updated_at",
    "created_at",
  ],
  review_replies: ["review_id", "body", "created_at"],
  blocks: ["id", "blocker_id", "blocked_id", "created_at"],
  reports: [
    "id",
    "reporter_id",
    "target_type",
    "target_id",
    "reason",
    "status",
    "handled_by",
    "created_at",
  ],
  push_tokens: ["id", "user_id", "token", "platform", "created_at"],
  notifications: ["id", "user_id", "type", "payload", "read_at", "created_at"],
};

/** erd 7·8장 enum 값 (erd 1장 표기: 타입 이름은 <테이블>_<컬럼>) */
const ERD_ENUMS: Record<string, string[]> = {
  chat_rooms_type: ["group", "direct"],
  chat_members_member_role: ["admin", "member"],
  chat_members_left_reason: ["self", "kicked", "ticket_ended"],
  messages_kind: ["text", "image"],
  reports_target_type: ["message", "review", "user"],
  reports_status: ["open", "resolved"],
  push_tokens_platform: ["ios", "android"],
};

const COLUMN_TYPES: [table: string, column: string, type: string][] = [
  ["chat_rooms", "type", "chat_rooms_type"],
  ["chat_members", "member_role", "chat_members_member_role"],
  ["chat_members", "left_reason", "chat_members_left_reason"],
  ["messages", "kind", "messages_kind"],
  ["reports", "target_type", "reports_target_type"],
  ["reports", "status", "reports_status"],
  ["push_tokens", "platform", "push_tokens_platform"],
];

/** 비어 있으면 안 되는 컬럼 (erd 7·8장, 완료 조건 "스키마") */
const NOT_NULL_COLUMNS: [table: string, column: string, id: string][] = [
  ["chat_rooms", "type", "CHAT-01"],
  ["chat_members", "room_id", "CHAT-02"],
  ["chat_members", "user_id", "CHAT-02"],
  ["chat_members", "member_role", "CHAT-06"],
  ["chat_members", "muted", "CHAT-08"],
  ["chat_members", "joined_at", "CHAT-03"],
  ["messages", "room_id", "CHAT-05"],
  ["messages", "sender_id", "CHAT-05"],
  ["messages", "kind", "CHAT-05"],
  ["messages", "created_at", "CHAT-03"],
  ["reviews", "trainer_id", "REV-02"],
  ["reviews", "student_id", "REV-02"],
  ["reviews", "ticket_id", "REV-02"],
  ["reviews", "body", "REV-01"],
  ["reviews", "hidden", "REV-05"],
  ["review_replies", "review_id", "REV-06"],
  ["review_replies", "body", "REV-06"],
  ["blocks", "blocker_id", "CHAT-07"],
  ["blocks", "blocked_id", "CHAT-07"],
  ["reports", "reporter_id", "CHAT-07"],
  ["reports", "target_type", "CHAT-07"],
  ["reports", "target_id", "CHAT-07"],
  ["reports", "reason", "DM-07"],
  ["reports", "status", "ADM-04"],
  ["push_tokens", "user_id", "NOTI-01"],
  ["push_tokens", "token", "NOTI-01"],
  ["push_tokens", "platform", "NOTI-01"],
  ["notifications", "user_id", "NOTI-02"],
  ["notifications", "type", "NOTI-02"],
  ["notifications", "payload", "NOTI-02"],
];

describe("#41 스키마 — erd 7·8장, tech-stack 3.11, CHAT-01, CHAT-05, DM-04, REV-01, NOTI-01, NOTI-02", () => {
  it.each(BUNDLE6_TABLES)("CHAT-01·REV-01·NOTI-02: %s의 컬럼이 erd와 같다", async (table) => {
    const { rows } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = $1`,
      [table],
    );
    expect(rows.map((row) => row.column_name).sort()).toEqual([...ERD_COLUMNS[table]].sort());
  });

  it.each(BUNDLE6_TABLES)("CHAT-04·NOTI-02: %s에 RLS가 켜져 있다", async (table) => {
    const { rows } = await db.query<{ relrowsecurity: boolean }>(
      `select c.relrowsecurity from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = $1 and c.relkind = 'r'`,
      [table],
    );
    expect(rows).toEqual([{ relrowsecurity: true }]);
  });

  it("REV-06: review_replies의 PK는 review_id 하나다 (후기마다 답글 하나)", async () => {
    const { rows } = await db.query<{ column_name: string }>(
      `select a.attname as column_name
       from pg_index i
       join pg_class c on c.oid = i.indrelid
       join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey)
       where n.nspname = 'public' and c.relname = 'review_replies' and i.indisprimary`,
    );
    expect(rows.map((row) => row.column_name)).toEqual(["review_id"]);
  });

  it.each(Object.entries(ERD_ENUMS))(
    "CHAT-05·DM-04·NOTI-01: enum %s의 값이 erd와 같다",
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
    "CHAT-05·DM-04·NOTI-01: enum %s의 값이 packages/shared/src/domain.ts의 상수 하나와 같다",
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

  it.each(COLUMN_TYPES)("CHAT-05: %s.%s의 타입은 %s다", async (table, column, type) => {
    const { rows } = await db.query<{ udt_name: string }>(
      `select udt_name from information_schema.columns
       where table_schema = 'public' and table_name = $1 and column_name = $2`,
      [table, column],
    );
    expect(rows).toEqual([{ udt_name: type }]);
  });

  it("REV-01: 후기에 별점 컬럼이 없다 (짝: reviews의 컬럼이 erd와 같다)", async () => {
    const { rows } = await db.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
       where table_schema = 'public' and table_name in ('reviews', 'review_replies')
         and column_name ~ '(rating|score|star|grade|point)'`,
    );
    expect(rows).toEqual([]);
  });

  it("NOTI-02: notifications.type은 enum이 아니라 문자열이다 (erd 8장)", async () => {
    const { rows } = await db.query<{ data_type: string }>(
      `select data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'notifications' and column_name = 'type'`,
    );
    expect(rows.length).toBe(1);
    expect(["text", "character varying"]).toContain(rows[0]?.data_type);
  });

  it("NOTI-02: notifications.payload는 JSON이다 (erd 8장)", async () => {
    const { rows } = await db.query<{ udt_name: string }>(
      `select udt_name from information_schema.columns
       where table_schema = 'public' and table_name = 'notifications' and column_name = 'payload'`,
    );
    expect(rows.length).toBe(1);
    expect(["json", "jsonb"]).toContain(rows[0]?.udt_name);
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

/** 묶음 1~4와 #38(마이그레이션 20261119170000 ~ 20261122090000)까지의 private 함수 */
const EXISTING_PRIVATE_FUNCTIONS = new Set([
  "authorize_client_insert",
  "can_read_homework_video",
  "can_request_refund",
  "enrollment_student_id",
  "enrollment_trainer_id",
  "feedback_comments_before_write",
  "fixed_schedule_group_class_id",
  "fixed_schedule_trainer_id",
  "fixed_schedules_before_write",
  "generate_link_slug",
  "group_class_student_count",
  "group_class_trainer_id",
  "group_classes_before_update",
  "has_enrollment_with",
  "homework_targets_before_write",
  "homework_trainer_id",
  "homework_videos_before_write",
  "homeworks_before_write",
  "is_active_user",
  "is_admin",
  "is_assigned_to_group_class",
  "is_enrollment_member",
  "is_homework_target",
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
  "submissions_before_write",
  "tickets_before_write",
  "trainer_approval_status",
  "trainer_can_edit_business_info",
  "trainer_profile_is_public",
  "trainer_profile_videos_before_write",
  "trainer_profiles_before_write",
  "user_role",
  "videos_before_write",
]);

describe("#41 판정 함수는 private 스키마에 있고 기존 판정을 다시 쓴다 — CHAT-04, ADM-02, AUTH-07, 묶음 1~4 권한 원칙", () => {
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

  const BUNDLE6_TABLE_PATTERN =
    /\bpublic\.(chat_rooms|chat_members|messages|reviews|review_replies|blocks|reports)\b/;

  it("CHAT-04·ADM-07: 묶음 6 테이블을 조회하는 새 private 함수가 있다(방 참여 여부, 방의 트레이너, 메시지 읽기, 신고 대상 읽기 등)", async () => {
    const functions = (await newPrivateFunctions()).filter((fn) =>
      BUNDLE6_TABLE_PATTERN.test(fn.definition),
    );
    expect(functions.length).toBeGreaterThan(0);
  });

  it("CHAT-04: 새 security definer private 함수는 anon이 실행할 수 없다", async () => {
    const functions = await newPrivateFunctions();
    expect(functions.length).toBeGreaterThan(0);
    expect(functions.filter((fn) => fn.secdef && fn.anon_exec).map((fn) => fn.name)).toEqual([]);
  });

  it("CHAT-02·REV-02: 새 private 함수는 수강 관계(enrollments)를 직접 조회하지 않는다 (기존 enrollment_*·is_ticket_member 등을 다시 쓴다)", async () => {
    const functions = await newPrivateFunctions();
    expect(functions.length).toBeGreaterThan(0);
    expect(
      functions.filter((fn) => /\bpublic\.enrollments\b/.test(fn.definition)).map((fn) => fn.name),
    ).toEqual([]);
  });

  it("REV-03·ADM-02: 새 private 함수는 트레이너 승인 상태(approval_status)를 판정하지 않는다 (후기·답글 읽기는 trainer_profiles 읽기 정책을 거친다)", async () => {
    const functions = await newPrivateFunctions();
    expect(functions.length).toBeGreaterThan(0);
    expect(
      functions.filter((fn) => /approval_status/.test(fn.definition)).map((fn) => fn.name),
    ).toEqual([]);
  });

  it.each(BUNDLE6_TABLES)(
    "CHAT-04: %s의 authenticated 정책은 enrollments·tickets·group_classes를 직접 조회하지 않는다(판정은 private 함수)",
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

  it.each(["reviews", "review_replies"])(
    "REV-03·ADM-02: %s의 anon select 정책은 trainer_profiles 읽기 정책을 거친다(trainer_genres_select와 같은 방식)",
    async (table) => {
      const { rows } = await db.query<{ policyname: string; qual: string | null }>(
        `select policyname, qual from pg_policies
         where schemaname = 'public' and tablename = $1 and cmd in ('SELECT', 'ALL')
           and 'anon' = any(roles)`,
        [table],
      );
      expect(rows.length).toBeGreaterThan(0);
      // review_replies는 reviews 읽기 정책을 거쳐도 된다(reviews가 trainer_profiles를 거친다)
      const pattern =
        table === "reviews" ? /\btrainer_profiles\b/ : /\b(trainer_profiles|reviews)\b/;
      expect(rows.some((row) => pattern.test(row.qual ?? ""))).toBe(true);
    },
  );

  it.each(BUNDLE6_TABLES)(
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

  it("AUTH-07: 클라이언트가 쓰는 테이블(참여 행·메시지 가리기·후기 지우기·가리기·차단·신고·알림 읽음)에 쓰기 정책이 있다 (짝: 위 for-loop)", async () => {
    const { rows } = await db.query<{ tablename: string }>(
      `select distinct tablename from pg_policies
       where schemaname = 'public' and 'authenticated' = any(roles)
         and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
         and tablename = any($1)`,
      [[...BUNDLE6_TABLES]],
    );
    expect(rows.map((row) => row.tablename).sort()).toEqual(
      ["blocks", "chat_members", "messages", "notifications", "reports", "reviews"].sort(),
    );
  });

  it.each(["chat_rooms", "review_replies", "push_tokens"])(
    "CHAT-03·REV-06·NOTI-01: %s에는 클라이언트 쓰기 권한(insert·update·delete grant)이 없다 (서버만 쓴다, 팀장 결정 1)",
    async (table) => {
      const { rows: exists } = await db.query(
        `select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = $1 and c.relkind = 'r'`,
        [table],
      );
      expect(exists.length, `${table} 테이블이 있다`).toBe(1);
      const { rows } = await db.query<{ privilege_type: string }>(
        `select privilege_type from information_schema.role_table_grants
         where table_schema = 'public' and table_name = $1
           and grantee in ('anon', 'authenticated')
           and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
         union
         select privilege_type from information_schema.column_privileges
         where table_schema = 'public' and table_name = $1
           and grantee in ('anon', 'authenticated')
           and privilege_type in ('INSERT', 'UPDATE')`,
        [table],
      );
      expect(rows).toEqual([]);
    },
  );
});

describe("#41 클라이언트 insert의 권한 판정이 무결성 트리거보다 먼저 돈다 — CHAT-07, REV-05, #38", () => {
  type Trigger = { name: string };
  const beforeInsertTriggers = async (table: string) =>
    (
      await db.query<Trigger>(
        // tgtype 비트: 1 = ROW, 2 = BEFORE, 4 = INSERT
        `select t.tgname as name
         from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
         join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = $1 and not t.tgisinternal
           and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 4) = 4
         order by t.tgname`,
        [table],
      )
    ).rows.map((row) => row.name);

  it.each(["blocks", "reports"])(
    "CHAT-07: %s에 <테이블>_authorize_insert BEFORE INSERT 트리거가 있다",
    async (table) => {
      expect(await beforeInsertTriggers(table)).toContain(`${table}_authorize_insert`);
    },
  );

  it.each(["blocks", "reports"])(
    "CHAT-07: %s의 BEFORE INSERT 트리거 중 <테이블>_authorize_insert가 이름순 맨 앞이다(같은 시점 트리거는 이름순으로 돈다)",
    async (table) => {
      const names = await beforeInsertTriggers(table);
      expect(names[0]).toBe(`${table}_authorize_insert`);
    },
  );
});

// ===========================================================================
// seed
// ===========================================================================

describe("#41 seed에 이번 묶음 더미 데이터가 있다 — #10 공통, CHAT-01~08, DM-01~07, REV-01~06, NOTI-01, NOTI-02", () => {
  it.each<[string, string]>([
    [
      "CHAT-01: 단체 채팅방 2개 이상",
      `select 1 from public.chat_rooms where type = 'group' having count(*) >= 2`,
    ],
    [
      "CHAT-06: 단체 채팅방의 트레이너가 admin으로 참여",
      `select 1 from public.chat_members m join public.chat_rooms r on r.id = m.room_id
       where r.type = 'group' and m.user_id = r.trainer_id and m.member_role = 'admin' and m.left_at is null`,
    ],
    [
      "CHAT-02: 단체 채팅방의 현재 학생(member)",
      `select 1 from public.chat_members m join public.chat_rooms r on r.id = m.room_id
       where r.type = 'group' and m.member_role = 'member' and m.left_at is null`,
    ],
    [
      "CHAT-03: 스스로 나간 학생(self)",
      `select 1 from public.chat_members where left_reason = 'self' and left_at is not null`,
    ],
    [
      "CHAT-06: 내보내진 학생(kicked)",
      `select 1 from public.chat_members where left_reason = 'kicked' and left_at is not null`,
    ],
    [
      "CHAT-03: 수강권이 끝나 나간 학생(ticket_ended)",
      `select 1 from public.chat_members where left_reason = 'ticket_ended' and left_at is not null`,
    ],
    [
      "CHAT-08·DM-06: 알림을 끈 참여자",
      `select 1 from public.chat_members where muted and left_at is null`,
    ],
    [
      "DM-01: 학생 ↔ 트레이너 문의 1:1 대화",
      `select 1 from public.chat_rooms r
       where r.type = 'direct'
         and exists (select 1 from public.chat_members m join public.users u on u.id = m.user_id
                     where m.room_id = r.id and u.role = 'trainer')
         and exists (select 1 from public.chat_members m join public.users u on u.id = m.user_id
                     where m.room_id = r.id and u.role = 'student')`,
    ],
    [
      "DM-03: 학생끼리 1:1 대화",
      `select 1 from public.chat_rooms r
       where r.type = 'direct'
         and (select count(*) from public.chat_members m join public.users u on u.id = m.user_id
              where m.room_id = r.id and u.role = 'student') = 2`,
    ],
    ["CHAT-05: 텍스트 메시지", `select 1 from public.messages where kind = 'text'`],
    [
      "CHAT-05: 사진 메시지",
      `select 1 from public.messages where kind = 'image' and image_url is not null`,
    ],
    ["CHAT-06: 가린 메시지", `select 1 from public.messages where hidden_by is not null`],
    [
      "REV-06: 답글이 있는 후기",
      `select 1 from public.reviews r join public.review_replies p on p.review_id = r.id
       where not r.hidden`,
    ],
    [
      "REV-03: 답글이 없는 후기",
      `select 1 from public.reviews r
       where not exists (select 1 from public.review_replies p where p.review_id = r.id)`,
    ],
    ["REV-05: 가린 후기", `select 1 from public.reviews where hidden`],
    ["CHAT-07: 차단", `select 1 from public.blocks`],
    ["CHAT-07: 메시지 신고", `select 1 from public.reports where target_type = 'message'`],
    ["REV-05: 후기 신고", `select 1 from public.reports where target_type = 'review'`],
    ["DM-05: 사용자 신고", `select 1 from public.reports where target_type = 'user'`],
    ["ADM-04: 처리 대기 신고", `select 1 from public.reports where status = 'open'`],
    [
      "ADM-04: 처리된 신고(handled_by 있음)",
      `select 1 from public.reports where status = 'resolved' and handled_by is not null`,
    ],
    ["NOTI-01: ios 기기 토큰", `select 1 from public.push_tokens where platform = 'ios'`],
    ["NOTI-01: android 기기 토큰", `select 1 from public.push_tokens where platform = 'android'`],
    ["NOTI-02: 읽은 알림", `select 1 from public.notifications where read_at is not null`],
    ["NOTI-02: 안 읽은 알림", `select 1 from public.notifications where read_at is null`],
  ])("%s", async (_, sql) => {
    const { rows } = await db.query(sql);
    expect(rows.length).toBeGreaterThan(0);
  });
});
