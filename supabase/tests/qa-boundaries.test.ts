// QA 보강 테스트 (이슈 #11, PR #13): 카탈로그 검사와 권한 경계값
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, asUser, createTestDb, queryAs, withActor } from "./helpers/db.ts";
import { NEW_USER_ID, SEED } from "./helpers/seed-ids.ts";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

const student = asUser(SEED.student1);
const trainer = asUser(SEED.trainerApproved);
const pending = asUser(SEED.trainerPending);
const admin = asUser(SEED.admin);

const PRIVATE_TABLES = [
  "user_private_profiles",
  "user_account_records",
  "trainer_business_profiles",
] as const;

/** 테이블별 본인 키 컬럼 */
const OWNER_COLUMN: Record<(typeof PRIVATE_TABLES)[number], string> = {
  user_private_profiles: "user_id",
  user_account_records: "user_id",
  trainer_business_profiles: "trainer_id",
};

/** 서버(가입 함수)가 만든 것처럼 프로필 없는 트레이너 사용자를 만든다. */
async function createTrainerUser(tx: Transaction) {
  await tx.query(`insert into auth.users (id) values ($1)`, [NEW_USER_ID]);
  await tx.query(
    `insert into public.users (id, role, nickname) values ($1, 'trainer', '새트레이너')`,
    [NEW_USER_ID],
  );
}

/** 서버가 운영자 계정을 탈퇴 처리한 상태 (AUTH-07) */
async function withdrawAdmin(tx: Transaction) {
  await tx.query(`update public.users set status = 'withdrawn' where id = $1`, [SEED.admin]);
}

describe("카탈로그 검사 (tech-stack 3.11, CLAUDE.md 보안)", () => {
  it("public 스키마의 모든 테이블에 RLS 정책이 1개 이상 있다", async () => {
    const { rows } = await db.query<{ table_name: string }>(
      `select c.relname as table_name
       from pg_class c
       where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
         and not exists (
           select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname
         )`,
    );
    expect(rows).toEqual([]);
  });

  it("SECURITY DEFINER 함수는 모두 search_path가 고정돼 있고 public 스키마에는 없다", async () => {
    const { rows } = await db.query<{ schema: string; name: string; config: string[] | null }>(
      `select n.nspname as schema, p.proname as name, p.proconfig as config
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where p.prosecdef and n.nspname not in ('pg_catalog', 'information_schema')`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.schema, row.name).not.toBe("public");
      expect(row.config ?? [], row.name).toContain('search_path=""');
    }
  });

  it("anon은 public 테이블에 SELECT 외의 권한이 없고, 개인정보 3개 테이블에는 아무 권한도 없다", async () => {
    const { rows } = await db.query<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and grantee = 'anon'
       union
       select table_name, privilege_type from information_schema.column_privileges
       where table_schema = 'public' and grantee = 'anon'`,
    );
    expect(rows.filter((row) => row.privilege_type !== "SELECT")).toEqual([]);
    expect(
      rows.filter((row) => (PRIVATE_TABLES as readonly string[]).includes(row.table_name)),
    ).toEqual([]);
  });

  it("authenticated의 테이블 단위 쓰기 권한은 trainer_genres·group_classes DELETE뿐이다 (나머지는 컬럼 단위)", async () => {
    const { rows } = await db.query<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and grantee = 'authenticated' and privilege_type <> 'SELECT'
       order by table_name`,
    );
    // group_classes: 배정된 수강권이 없는 반은 트레이너가 지운다(#28 팀장 결정 8, erd 4장)
    expect(rows).toEqual([
      { table_name: "group_classes", privilege_type: "DELETE" },
      { table_name: "trainer_genres", privilege_type: "DELETE" },
    ]);
  });

  it("클라이언트는 서버만 쓰는 컬럼에 INSERT·UPDATE 권한이 없다 — AUTH-02, AUTH-03, AUTH-08, ADM-01, PLT-01, TRN-02", async () => {
    const { rows } = await db.query<{ col: string }>(
      `select distinct table_name || '.' || column_name as col
       from information_schema.column_privileges
       where table_schema = 'public' and grantee in ('anon', 'authenticated')
         and privilege_type in ('INSERT', 'UPDATE')`,
    );
    const writable = rows.map((row) => row.col);
    for (const col of [
      "users.id",
      "users.role",
      "users.status",
      "trainer_profiles.link_slug",
      "trainer_profiles.approved_at",
      "trainer_business_profiles.payout_seller_id",
      "trainer_business_profiles.payout_account_masked",
    ]) {
      expect(writable, col).not.toContain(col);
    }
    expect(
      writable.filter((col) => /^user_(private_profiles|account_records)\./.test(col)),
    ).toEqual([]);
  });
});

describe.each(PRIVATE_TABLES)("%s: anon과 다른 사용자의 쓰기 차단", (table) => {
  const owner = OWNER_COLUMN[table];
  const target = table === "trainer_business_profiles" ? SEED.trainerPending : SEED.student1;

  it("anon은 고치거나 지울 수 없다", async () => {
    await expect(
      queryAs(db, anon, `update public.${table} set created_at = now() where ${owner} = $1`, [
        target,
      ]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      queryAs(db, anon, `delete from public.${table} where ${owner} = $1`, [target]),
    ).rejects.toThrow(/permission denied/);
  });

  it("다른 트레이너는 남의 행을 지울 수 없다", async () => {
    await expect(
      queryAs(db, trainer, `delete from public.${table} where ${owner} = $1`, [target]),
    ).rejects.toThrow(/permission denied/);
  });

  it("다른 트레이너는 조건 없이 조회해도 남의 행이 보이지 않는다", async () => {
    const { rows } = await queryAs<Record<string, string>>(
      db,
      trainer,
      `select ${owner} as owner from public.${table}`,
    );
    expect(rows.map((row) => row.owner)).toEqual([SEED.trainerApproved]);
  });
});

describe("anon은 개인정보 행을 만들 수 없다", () => {
  it.each([
    [
      "user_private_profiles",
      `insert into public.user_private_profiles (user_id, legal_name, birth_date, phone)
       values ($1, '가짜', '2000-01-01', '01000000000')`,
    ],
    [
      "user_account_records",
      `insert into public.user_account_records (user_id, identity_key) values ($1, 'dummy-anon')`,
    ],
    [
      "trainer_business_profiles",
      `insert into public.trainer_business_profiles (trainer_id, business_type) values ($1, 'individual')`,
    ],
  ])("%s", async (_, sql) => {
    await expect(queryAs(db, anon, sql, [SEED.student1])).rejects.toThrow(/permission denied/);
  });
});

describe("trainer_business_profiles 경계 — AUTH-04", () => {
  it("pending 트레이너도 trainer_id를 다른 트레이너로 바꿀 수 없다", async () => {
    await expect(
      queryAs(
        db,
        pending,
        `update public.trainer_business_profiles set trainer_id = $2 where trainer_id = $1`,
        [SEED.trainerPending, SEED.trainerApproved],
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("trainer_profiles 경계 — ADM-01, ADM-03, PLT-01", () => {
  it("트레이너가 조건 없이 is_pilot을 바꾸려 하면 거부된다", async () => {
    await expect(
      queryAs(db, pending, `update public.trainer_profiles set is_pilot = not is_pilot`),
    ).rejects.toThrow(/운영자만/);
  });

  it("학생은 다른 트레이너 사용자의 trainer_profiles 행을 대신 만들 수 없다 — AUTH-02", async () => {
    await expect(
      withActor(
        db,
        student,
        (tx) =>
          tx.query(`insert into public.trainer_profiles (user_id) values ($1)`, [NEW_USER_ID]),
        { setup: createTrainerUser },
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it.each([
    ["admin", "'admin'"],
    ["trainer", "'trainer'"],
  ])("학생은 자기 역할을 %s로 바꿀 수 없다 — AUTH-02", async (_, value) => {
    await expect(
      queryAs(db, student, `update public.users set role = ${value} where id = $1`, [
        SEED.student1,
      ]),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("운영자 권한 범위 — ADM-01~03, ADM-06, ADM-07", () => {
  it.each([
    ["approved_at", "now()"],
    ["link_slug", "'admin-slug'"],
  ])("운영자도 trainer_profiles.%s는 바꿀 수 없다", async (column, value) => {
    await expect(
      queryAs(
        db,
        admin,
        `update public.trainer_profiles set ${column} = ${value} where user_id = $1`,
        [SEED.trainerPending],
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it.each([
    ["role", "'trainer'"],
    ["status", "'withdrawn'"],
  ])("운영자도 남의 users.%s를 바꿀 수 없다 (서버가 처리)", async (column, value) => {
    await expect(
      queryAs(db, admin, `update public.users set ${column} = ${value} where id = $1`, [
        SEED.student1,
      ]),
    ).rejects.toThrow(/permission denied/);
  });

  it("운영자는 트레이너의 프로필을 대신 만들 수 없다", async () => {
    await expect(
      withActor(
        db,
        admin,
        (tx) =>
          tx.query(`insert into public.trainer_profiles (user_id) values ($1)`, [NEW_USER_ID]),
        { setup: createTrainerUser },
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("탈퇴한 운영자는 운영자 권한을 잃는다 — AUTH-07", () => {
  it.each([
    ["user_private_profiles", "user_id", []],
    ["user_account_records", "user_id", []],
    ["trainer_business_profiles", "trainer_id", []],
  ])("%s의 남의 행을 읽지 못한다", async (table, owner, expected) => {
    const rows = await withActor(
      db,
      admin,
      async (tx) => (await tx.query(`select ${owner} from public.${table}`)).rows,
      { setup: withdrawAdmin },
    );
    expect(rows).toEqual(expected);
  });

  it("pending·rejected·suspended 프로필을 읽지 못한다", async () => {
    const rows = await withActor(
      db,
      admin,
      async (tx) =>
        (
          await tx.query(
            `select user_id from public.trainer_profiles where approval_status <> 'approved'`,
          )
        ).rows,
      { setup: withdrawAdmin },
    );
    expect(rows).toEqual([]);
  });

  it("승인 상태를 바꾸지 못한다 (0행)", async () => {
    const affected = await withActor(
      db,
      admin,
      async (tx) =>
        (
          await tx.query(
            `update public.trainer_profiles set approval_status = 'suspended' where user_id = $1`,
            [SEED.trainerApproved],
          )
        ).affectedRows,
      { setup: withdrawAdmin },
    );
    expect(affected).toBe(0);
  });
});
