import type { PGlite, Transaction } from "@electric-sql/pglite";
import {
  BUSINESS_TYPES,
  TRAINER_APPROVAL_STATUSES,
  USER_ROLES,
  USER_STATUSES,
} from "@vocals/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, queryAs, service, withActor } from "./helpers/db.ts";
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
  trainer_profiles_business_type: BUSINESS_TYPES,
};

/** docs/erd.md 2장 컬럼 (id·created_at 포함). auth_identities는 Supabase Auth로 대신한다. */
const ERD_COLUMNS: Record<string, string[]> = {
  users: [
    "id",
    "role",
    "nickname",
    "profile_image_url",
    "legal_name",
    "birth_date",
    "phone",
    "identity_key",
    "status",
    "withdrawn_at",
    "purge_after",
    "created_at",
  ],
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
    "business_type",
    "business_registration_no",
    "payout_seller_id",
    "payout_account_masked",
    "approved_at",
    "created_at",
  ],
  regions: ["id", "sido", "sigungu", "created_at"],
  genres: ["id", "name", "created_at"],
  trainer_genres: ["id", "trainer_id", "genre_id", "created_at"],
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

  it("테이블과 컬럼 이름이 erd 2장과 같고 모두 created_at이 있다", async () => {
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
  it("users.identity_key는 중복될 수 없다", async () => {
    await expect(
      asOwner(
        `update public.users set identity_key = 'dummy-identity-key-student-1' where id = $1`,
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
            `insert into public.trainer_profiles (user_id, business_type, link_slug)
             values ($1, 'individual', 'seed-approved')`,
            [NEW_USER_ID],
          ),
        { setup: createTrainerUser },
      ),
    ).rejects.toThrow(/duplicate key/);
  });

  it("link_slug는 서버·마이그레이션도 바꿀 수 없다 — 결정 필요 5 추천안", async () => {
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
      queryAs(
        db,
        service,
        `insert into public.trainer_profiles (user_id, business_type) values ($1, 'individual')`,
        [SEED.student1],
      ),
    ).rejects.toThrow(/role = trainer/);
  });

  it("사용자당 trainer_profiles는 최대 1개다 — AUTH-02", async () => {
    await expect(
      queryAs(
        db,
        service,
        `insert into public.trainer_profiles (user_id, business_type) values ($1, 'individual')`,
        [SEED.trainerApproved],
      ),
    ).rejects.toThrow(/duplicate key/);
  });

  it("같은 트레이너에게 같은 장르를 두 번 붙일 수 없다", async () => {
    await expect(
      asOwner(`insert into public.trainer_genres (trainer_id, genre_id) values ($1, 1)`, [
        SEED.trainerApproved,
      ]),
    ).rejects.toThrow(/duplicate key/);
  });

  it("개인(individual)은 사업자등록번호가 없고, 사업자는 반드시 있다", async () => {
    await expect(
      asOwner(
        `update public.trainer_profiles set business_registration_no = '000-00-99999' where user_id = $1`,
        [SEED.trainerApproved],
      ),
    ).rejects.toThrow(/business_registration_no_check/);
    await expect(
      asOwner(
        `update public.trainer_profiles set business_registration_no = null where user_id = $1`,
        [SEED.trainerUnlisted],
      ),
    ).rejects.toThrow(/business_registration_no_check/);
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

  it("link_slug는 지정하지 않아도 서버가 만든다 — 결정 필요 5 추천안", async () => {
    const { rows } = await withActor(
      db,
      service,
      (tx) =>
        tx.query<{ link_slug: string }>(
          `insert into public.trainer_profiles (user_id, business_type)
           values ($1, 'individual') returning link_slug`,
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
      `select approval_status::text, listed, is_pilot, business_type::text from public.trainer_profiles`,
    );
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

  it("seed의 개인정보는 더미 형식이다", async () => {
    const { rows } = await db.query<{ legal_name: string; phone: string; identity_key: string }>(
      `select legal_name, phone, identity_key from public.users`,
    );
    for (const row of rows) {
      expect(row.legal_name).toMatch(/^가짜/);
      expect(row.phone).toMatch(/^010000000\d\d$/);
      expect(row.identity_key).toMatch(/^dummy-/);
    }
  });
});
