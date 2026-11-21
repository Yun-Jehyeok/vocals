import type { PGlite, Transaction } from "@electric-sql/pglite";
import {
  ATTENDANCE_STATUSES,
  BUSINESS_TYPES,
  CANCELED_BY,
  ENROLLMENT_SOURCES,
  LESSON_SESSION_KINDS,
  LESSON_SESSION_MODES,
  LESSON_SESSION_STATUSES,
  LESSON_TYPES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  REFUND_REQUEST_STATUSES,
  TICKET_END_REASONS,
  TICKET_STATUSES,
  TICKET_TYPES,
  TRAINER_APPROVAL_STATUSES,
  USER_ROLES,
  USER_STATUSES,
  VIDEO_PURPOSES,
  VIDEO_UPLOAD_STATUSES,
  VIDEO_VISIBILITIES,
} from "@vocals/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, createTestDb, queryAs, service, withActor } from "./helpers/db.ts";
import { NEW_USER_ID, SEED } from "./helpers/seed-ids.ts";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

/** 서버(가입 함수)가 만든 것처럼 프로필 없는 트레이너 사용자를 만든다. */
async function createTrainerUser(tx: Transaction) {
  await tx.query(`insert into auth.users (id) values ($1)`, [NEW_USER_ID]);
  await tx.query(
    `insert into public.users (id, role, nickname) values ($1, 'trainer', '새트레이너')`,
    [NEW_USER_ID],
  );
}

/** 관리자(postgres)로 실행하고 되돌린다. 제약 조건 확인용. */
async function asOwner(sql: string, params: unknown[] = []) {
  await db.exec("begin");
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("rollback");
  }
}

/**
 * DB enum 이름 → packages/shared/src/domain.ts 값.
 * DB에 enum을 추가하면 여기에도 추가해야 테스트가 통과한다. (CLAUDE.md 이름)
 */
const DOMAIN_ENUMS: Record<string, readonly string[]> = {
  users_role: USER_ROLES,
  users_status: USER_STATUSES,
  trainer_profiles_approval_status: TRAINER_APPROVAL_STATUSES,
  trainer_business_profiles_business_type: BUSINESS_TYPES,
  lesson_products_lesson_type: LESSON_TYPES,
  lesson_products_ticket_type: TICKET_TYPES,
  enrollments_source: ENROLLMENT_SOURCES,
  payments_method: PAYMENT_METHODS,
  payments_status: PAYMENT_STATUSES,
  tickets_lesson_type: LESSON_TYPES,
  tickets_ticket_type: TICKET_TYPES,
  tickets_status: TICKET_STATUSES,
  tickets_end_reason: TICKET_END_REASONS,
  refund_requests_status: REFUND_REQUEST_STATUSES,
  fee_policies_source: ENROLLMENT_SOURCES,
  lesson_sessions_kind: LESSON_SESSION_KINDS,
  lesson_sessions_mode: LESSON_SESSION_MODES,
  lesson_sessions_status: LESSON_SESSION_STATUSES,
  session_attendees_attendance: ATTENDANCE_STATUSES,
  session_attendees_canceled_by: CANCELED_BY,
  // 이슈 #35
  videos_purpose: VIDEO_PURPOSES,
  videos_upload_status: VIDEO_UPLOAD_STATUSES,
  videos_visibility: VIDEO_VISIBILITIES,
};

/**
 * docs/erd.md 2·3·4·5·6장 컬럼 (id 또는 1:1 FK PK, created_at 포함). 로그인 수단은 Supabase Auth가 저장한다.
 * 4장은 이슈 #28·#32, 6장은 이슈 #28에서 만든 fee_policies만.
 */
const ERD_COLUMNS: Record<string, string[]> = {
  users: ["id", "role", "nickname", "profile_image_url", "status", "created_at"],
  user_private_profiles: ["user_id", "legal_name", "birth_date", "phone", "created_at"],
  user_account_records: ["user_id", "identity_key", "withdrawn_at", "purge_after", "created_at"],
  trainer_profiles: [
    "user_id",
    "display_name",
    "bio",
    "career",
    "lesson_place",
    "region_id",
    "link_slug",
    "approval_status",
    "is_pilot",
    "listed",
    "approved_at",
    "created_at",
  ],
  trainer_business_profiles: [
    "trainer_id",
    "business_type",
    "business_registration_no",
    "payout_seller_id",
    "payout_account_masked",
    "created_at",
  ],
  regions: ["id", "sido", "sigungu", "created_at"],
  genres: ["id", "name", "created_at"],
  trainer_genres: ["id", "trainer_id", "genre_id", "created_at"],
  lesson_products: [
    "id",
    "trainer_id",
    "lesson_type",
    "ticket_type",
    "session_count",
    "price",
    "duration_min",
    "active",
    "created_at",
  ],
  enrollments: ["id", "student_id", "trainer_id", "source", "pilot_free", "created_at"],
  payments: [
    "id",
    "student_id",
    "product_id",
    "amount",
    "method",
    "pg_transaction_id",
    "status",
    "paid_at",
    "created_at",
  ],
  tickets: [
    "id",
    "enrollment_id",
    "product_id",
    "payment_id",
    "lesson_type",
    "ticket_type",
    "total_sessions",
    "remaining_sessions",
    "price_paid",
    "fee_rate",
    "valid_until",
    "group_class_id",
    "status",
    "end_reason",
    "created_at",
  ],
  refund_requests: ["id", "ticket_id", "reason", "status", "created_at"],
  refunds: [
    "id",
    "ticket_id",
    "payment_id",
    "refund_request_id",
    "sessions_canceled",
    "amount",
    "processed_by",
    "processed_at",
    "created_at",
  ],
  group_classes: ["id", "trainer_id", "name", "capacity", "duration_min", "created_at"],
  fee_policies: ["id", "source", "rate", "effective_from", "created_at"],
  fixed_schedules: [
    "id",
    "ticket_id",
    "group_class_id",
    "effective_from",
    "effective_to",
    "created_at",
  ],
  fixed_schedule_slots: ["id", "fixed_schedule_id", "weekday", "start_time", "created_at"],
  lesson_sessions: [
    "id",
    "trainer_id",
    "group_class_id",
    "fixed_schedule_id",
    "kind",
    "mode",
    "starts_at",
    "ends_at",
    "status",
    "created_at",
  ],
  session_attendees: [
    "id",
    "session_id",
    "ticket_id",
    "student_id",
    "attendance",
    "canceled_by",
    "deducted",
    "session_amount",
    "checked_at",
    "created_at",
  ],
  // 이슈 #35: erd 2장 trainer_profile_videos, 5장
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

describe("공통 (tech-stack 3.11, CLAUDE.md 보안·이름)", () => {
  it("public 스키마의 모든 테이블에 RLS가 켜져 있다", async () => {
    const { rows } = await db.query<{ table_name: string; rls: boolean }>(
      `select c.relname as table_name, c.relrowsecurity as rls
       from pg_class c
       where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
       order by 1`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((row) => !row.rls).map((row) => row.table_name)).toEqual([]);
  });

  it("private 함수 실행 권한은 필요한 역할에만 있다 (anon은 공개 프로필 판정만)", async () => {
    const { rows } = await db.query<{ fn: string; anon: boolean; authenticated: boolean }>(
      `select p.proname as fn,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated
       from pg_proc p
       where p.pronamespace = 'private'::regnamespace
       order by 1`,
    );
    const byName = Object.fromEntries(rows.map((row) => [row.fn, row]));
    expect(rows.filter((row) => row.anon).map((row) => row.fn)).toEqual([
      "trainer_profile_is_public",
    ]);
    for (const fn of [
      "is_admin",
      "is_active_user",
      "user_role",
      "trainer_approval_status",
      "trainer_can_edit_business_info",
      "generate_link_slug",
      // 이슈 #28
      "has_enrollment_with",
      "is_own_student",
      "is_enrollment_member",
      "enrollment_trainer_id",
      "enrollment_student_id",
      "lesson_product_trainer_id",
      "group_class_trainer_id",
      "is_assigned_to_group_class",
      "group_class_student_count",
      "can_request_refund",
      // 이슈 #32
      "is_ticket_member",
      "fixed_schedule_trainer_id",
      "fixed_schedule_group_class_id",
      "lesson_session_trainer_id",
      "is_session_attendee",
      "session_has_deducted_attendee",
      // 이슈 #35
      "homework_trainer_id",
      "is_homework_target",
      "can_read_homework_video",
    ]) {
      expect(byName[fn]?.authenticated, fn).toBe(true);
    }
    // 트리거 함수는 트리거로만 실행된다.
    for (const fn of [
      "trainer_profiles_before_write",
      "lesson_products_before_update",
      "group_classes_before_update",
      "tickets_before_write",
      "fixed_schedules_before_write",
      "lesson_sessions_before_write",
      "lesson_sessions_before_delete",
      "session_attendees_before_write",
      // 이슈 #38
      "authorize_client_insert",
    ]) {
      expect(byName[fn]?.authenticated, fn).toBe(false);
    }
  });

  it("anon은 SECURITY DEFINER 함수로 비공개 프로필의 승인 상태를 알아낼 수 없다", async () => {
    await expect(
      queryAs(db, anon, `select private.trainer_approval_status($1)`, [SEED.trainerPending]),
    ).rejects.toThrow(/permission denied/);
  });

  it("DB enum 값이 packages/shared/src/domain.ts의 값과 같다", async () => {
    const { rows } = await db.query<{ name: string; labels: string[] }>(
      `select t.typname as name, array_agg(e.enumlabel order by e.enumsortorder) as labels
       from pg_type t join pg_enum e on e.enumtypid = t.oid
       where t.typnamespace = 'public'::regnamespace
       group by t.typname
       order by t.typname`,
    );
    const dbEnums = Object.fromEntries(rows.map((row) => [row.name, row.labels]));
    expect(Object.keys(dbEnums).sort()).toEqual(Object.keys(DOMAIN_ENUMS).sort());
    for (const [name, values] of Object.entries(DOMAIN_ENUMS)) {
      expect(dbEnums[name], name).toEqual([...values]);
    }
  });

  it("users.id는 Supabase Auth 사용자(auth.users.id)를 가리키고, 로그인 수단 테이블은 public에 없다 — AUTH-01", async () => {
    const { rows } = await db.query<{ target: string }>(
      `select confrelid::regclass::text as target
       from pg_constraint
       where conrelid = 'public.users'::regclass and contype = 'f'`,
    );
    expect(rows.map((row) => row.target)).toEqual(["auth.users"]);
    await expect(
      asOwner(
        `insert into public.users (id, role, nickname) values (gen_random_uuid(), 'student', 'x')`,
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it("테이블과 컬럼 이름이 erd와 같고 모두 created_at이 있다", async () => {
    const { rows } = await db.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name
       from information_schema.columns
       where table_schema = 'public'
       order by table_name, ordinal_position`,
    );
    const actual: Record<string, string[]> = {};
    for (const row of rows) (actual[row.table_name] ??= []).push(row.column_name);
    expect(Object.keys(actual).sort()).toEqual(Object.keys(ERD_COLUMNS).sort());
    for (const [table, columns] of Object.entries(ERD_COLUMNS)) {
      expect(actual[table]?.slice().sort(), table).toEqual(columns.slice().sort());
      expect(columns).toContain("created_at");
    }
  });
});

describe("스키마 제약 (erd 2장)", () => {
  it("user_account_records.identity_key는 중복될 수 없다", async () => {
    await expect(
      asOwner(
        `update public.user_account_records set identity_key = 'dummy-identity-key-student-1' where user_id = $1`,
        [SEED.student2],
      ),
    ).rejects.toThrow(/duplicate key/);
  });

  it("trainer_profiles.link_slug는 중복될 수 없다", async () => {
    await expect(
      withActor(
        db,
        service,
        (tx) =>
          tx.query(
            `insert into public.trainer_profiles (user_id, link_slug) values ($1, 'seed-approved')`,
            [NEW_USER_ID],
          ),
        { setup: createTrainerUser },
      ),
    ).rejects.toThrow(/duplicate key/);
  });

  it("link_slug는 서버·마이그레이션도 바꿀 수 없다 — TRN-02(확정 5)", async () => {
    await expect(
      asOwner(`update public.trainer_profiles set link_slug = 'changed' where user_id = $1`, [
        SEED.trainerPilot,
      ]),
    ).rejects.toThrow(/바꿀 수 없다/);
  });

  it("users.role은 student, trainer, admin 중 하나다 — AUTH-02", async () => {
    await expect(
      asOwner(`update public.users set role = 'operator' where id = $1`, [SEED.student1]),
    ).rejects.toThrow(/invalid input value for enum/);
  });

  it("role이 trainer가 아닌 사용자는 trainer_profiles를 가질 수 없다 (서버로 넣어도 막힌다) — AUTH-02", async () => {
    await expect(
      queryAs(db, service, `insert into public.trainer_profiles (user_id) values ($1)`, [
        SEED.student1,
      ]),
    ).rejects.toThrow(/role = trainer/);
  });

  it("사용자당 trainer_profiles는 최대 1개다 — AUTH-02", async () => {
    await expect(
      queryAs(db, service, `insert into public.trainer_profiles (user_id) values ($1)`, [
        SEED.trainerApproved,
      ]),
    ).rejects.toThrow(/duplicate key/);
  });

  it("같은 트레이너에게 같은 장르를 두 번 붙일 수 없다", async () => {
    await expect(
      asOwner(`insert into public.trainer_genres (trainer_id, genre_id) values ($1, 1)`, [
        SEED.trainerApproved,
      ]),
    ).rejects.toThrow(/duplicate key/);
  });

  it("개인(individual)은 사업자등록번호가 없고, 사업자는 반드시 있다 — erd 2장, AUTH-04", async () => {
    await expect(
      asOwner(
        `update public.trainer_business_profiles set business_registration_no = '000-00-99999' where trainer_id = $1`,
        [SEED.trainerApproved],
      ),
    ).rejects.toThrow(/business_registration_no_check/);
    await expect(
      asOwner(
        `update public.trainer_business_profiles set business_registration_no = null where trainer_id = $1`,
        [SEED.trainerUnlisted],
      ),
    ).rejects.toThrow(/business_registration_no_check/);
  });

  it("trainer_business_profiles는 트레이너 프로필이 있어야 만들 수 있다", async () => {
    await expect(
      asOwner(
        `insert into public.trainer_business_profiles (trainer_id, business_type) values ($1, 'individual')`,
        [SEED.student1],
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it("genres에 TRN-08의 10개 장르가 들어 있다", async () => {
    const { rows } = await db.query<{ name: string }>(`select name from public.genres order by id`);
    expect(rows.map((row) => row.name)).toEqual([
      "발라드",
      "R&B",
      "팝",
      "록",
      "인디",
      "재즈",
      "뮤지컬",
      "트로트",
      "힙합",
      "입시·오디션",
    ]);
  });

  it("link_slug는 지정하지 않아도 서버가 만든다 — TRN-02(확정 5)", async () => {
    const { rows } = await withActor(
      db,
      service,
      (tx) =>
        tx.query<{ link_slug: string }>(
          `insert into public.trainer_profiles (user_id) values ($1) returning link_slug`,
          [NEW_USER_ID],
        ),
      { setup: createTrainerUser },
    );
    expect(rows[0]?.link_slug).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("seed (이슈 #11 완료 조건)", () => {
  it("학생 2명, 트레이너 approved 3명·pending·rejected·suspended 각 1명, 운영자 1명이 있다", async () => {
    const { rows } = await db.query<{ role: string; count: number }>(
      `select role::text, count(*)::int as count from public.users group by role order by role`,
    );
    expect(Object.fromEntries(rows.map((row) => [row.role, row.count]))).toEqual({
      admin: 1,
      student: 2,
      trainer: 6,
    });

    const profiles = await db.query<{
      approval_status: string;
      listed: boolean;
      is_pilot: boolean;
      business_type: string;
    }>(
      `select tp.approval_status::text, tp.listed, tp.is_pilot, tbp.business_type::text
       from public.trainer_profiles tp
       join public.trainer_business_profiles tbp on tbp.trainer_id = tp.user_id`,
    );
    expect(profiles.rows).toHaveLength(6);
    const approved = profiles.rows.filter((row) => row.approval_status === "approved");
    expect(approved).toHaveLength(3);
    expect(approved.filter((row) => !row.listed)).toHaveLength(1);
    expect(approved.filter((row) => row.is_pilot)).toHaveLength(1);
    expect(approved.some((row) => row.business_type === "individual")).toBe(true);
    for (const status of ["pending", "rejected", "suspended"]) {
      expect(
        profiles.rows.filter((row) => row.approval_status === status),
        status,
      ).toHaveLength(1);
    }
  });

  it("seed의 개인정보·연계정보·계좌는 더미 형식이다", async () => {
    const privateRows = await db.query<{ legal_name: string; phone: string }>(
      `select legal_name, phone from public.user_private_profiles`,
    );
    expect(privateRows.rows).toHaveLength(8);
    for (const row of privateRows.rows) {
      expect(row.legal_name).toMatch(/^가짜/);
      expect(row.phone).toMatch(/^010000000\d\d$/);
    }
    const records = await db.query<{ identity_key: string }>(
      `select identity_key from public.user_account_records`,
    );
    for (const row of records.rows) expect(row.identity_key).toMatch(/^dummy-/);
    const business = await db.query<{ payout_account_masked: string | null }>(
      `select payout_account_masked from public.trainer_business_profiles`,
    );
    for (const row of business.rows) {
      if (row.payout_account_masked)
        expect(row.payout_account_masked).toMatch(/^테스트은행 00\d\d$/);
    }
  });
});
