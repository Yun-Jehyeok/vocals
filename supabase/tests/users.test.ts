import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, asUser, createTestDb, queryAs, withActor } from "./helpers/db.ts";
import { ALL_SEED_USER_IDS, SEED, VERIFIED_USER_IDS } from "./helpers/seed-ids.ts";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

const student = asUser(SEED.student1);
const trainer = asUser(SEED.trainerApproved);
const admin = asUser(SEED.admin);

const PRIVATE_TABLES = ["user_private_profiles", "user_account_records"] as const;

describe("users 읽기", () => {
  it.each([
    ["anon", anon],
    ["학생", student],
    ["트레이너", trainer],
    ["운영자", admin],
  ])(
    "%s는 모든 사용자의 users 행(닉네임·사진 등)을 읽는다 — AUTH-06, S-01, ADM-07",
    async (_, actor) => {
      const { rows } = await queryAs<{ id: string }>(db, actor, `select * from public.users`);
      expect(rows.map((row) => row.id).sort()).toEqual([...ALL_SEED_USER_IDS].sort());
    },
  );
});

describe.each(PRIVATE_TABLES)("%s 읽기", (table) => {
  it("로그인한 사용자는 자기 행을 읽는다 — AUTH-03", async () => {
    const { rows } = await queryAs<{ user_id: string }>(
      db,
      student,
      `select * from public.${table}`,
    );
    expect(rows.map((row) => row.user_id)).toEqual([SEED.student1]);
  });

  it("학생은 다른 학생의 행을 읽을 수 없다 — AUTH-06, CHAT-04", async () => {
    const { rows } = await queryAs(
      db,
      student,
      `select * from public.${table} where user_id = $1`,
      [SEED.student2],
    );
    expect(rows).toEqual([]);
  });

  it("트레이너는 학생의 행을 읽을 수 없다 (수강생 열람은 묶음 2) — AUTH-09", async () => {
    const { rows } = await queryAs<{ user_id: string }>(
      db,
      trainer,
      `select * from public.${table}`,
    );
    expect(rows.map((row) => row.user_id)).toEqual([SEED.trainerApproved]);
  });

  it("anon은 읽을 수 없다", async () => {
    await expect(queryAs(db, anon, `select * from public.${table}`)).rejects.toThrow(
      /permission denied/,
    );
  });

  it("운영자는 모든 사용자의 행을 읽는다 — ADM-07, A-01", async () => {
    const { rows } = await queryAs<{ user_id: string }>(db, admin, `select * from public.${table}`);
    expect(rows.map((row) => row.user_id).sort()).toEqual([...VERIFIED_USER_IDS].sort());
  });
});

describe("user_private_profiles·user_account_records 쓰기 (서버만) — AUTH-03, AUTH-08", () => {
  const writes: Record<
    (typeof PRIVATE_TABLES)[number],
    { insert: string; updates: [column: string, value: string][] }
  > = {
    user_private_profiles: {
      insert: `insert into public.user_private_profiles (user_id, legal_name, birth_date, phone)
               values ($1, '가짜이름', '2000-01-01', '01000000000')`,
      updates: [
        ["legal_name", "'다른이름'"],
        ["birth_date", "'2010-01-01'"],
        ["phone", "'01099999999'"],
      ],
    },
    user_account_records: {
      insert: `insert into public.user_account_records (user_id, identity_key) values ($1, 'dummy-x')`,
      updates: [
        ["identity_key", "'dummy-other'"],
        ["withdrawn_at", "now()"],
        ["purge_after", "now()"],
      ],
    },
  };

  describe.each(PRIVATE_TABLES)("%s", (table) => {
    it.each(writes[table].updates)("본인도 %s를 고칠 수 없다", async (column, value) => {
      await expect(
        queryAs(db, student, `update public.${table} set ${column} = ${value} where user_id = $1`, [
          SEED.student1,
        ]),
      ).rejects.toThrow(/permission denied/);
    });

    it.each([
      ["본인", student, SEED.student1],
      ["운영자", admin, SEED.admin],
    ])("%s도 행을 만들 수 없다", async (_, actor, userId) => {
      await expect(queryAs(db, actor, writes[table].insert, [userId])).rejects.toThrow(
        /permission denied/,
      );
    });

    it.each([
      ["본인", student],
      ["운영자", admin],
    ])("%s도 행을 지울 수 없다", async (_, actor) => {
      await expect(
        queryAs(db, actor, `delete from public.${table} where user_id = $1`, [SEED.student1]),
      ).rejects.toThrow(/permission denied/);
    });
  });
});

describe("users 쓰기", () => {
  it("사용자는 자기 nickname, profile_image_url을 고친다 — AUTH-06, C-05", async () => {
    const result = await withActor(db, student, async (tx) => {
      await tx.query(
        `update public.users set nickname = '바뀐닉네임', profile_image_url = 'https://example.test/a.png' where id = $1`,
        [SEED.student1],
      );
      return tx.query<{ nickname: string; profile_image_url: string }>(
        `select nickname, profile_image_url from public.users where id = $1`,
        [SEED.student1],
      );
    });
    expect(result.rows[0]).toEqual({
      nickname: "바뀐닉네임",
      profile_image_url: "https://example.test/a.png",
    });
  });

  it.each([
    ["role", "'admin'"],
    ["status", "'withdrawn'"],
  ])("사용자는 자기 것이라도 %s를 고칠 수 없다 — AUTH-02, AUTH-08", async (column, value) => {
    await expect(
      queryAs(db, student, `update public.users set ${column} = ${value} where id = $1`, [
        SEED.student1,
      ]),
    ).rejects.toThrow(/permission denied/);
  });

  it("로그인 사용자는 남의 users 행을 고칠 수 없다 (0행)", async () => {
    const result = await queryAs(
      db,
      trainer,
      `update public.users set nickname = '남이바꿈' where id = $1`,
      [SEED.student1],
    );
    expect(result.affectedRows).toBe(0);
  });

  it("운영자도 남의 users 행을 고칠 수 없다 (0행)", async () => {
    const result = await queryAs(
      db,
      admin,
      `update public.users set nickname = '운영자가바꿈' where id = $1`,
      [SEED.student1],
    );
    expect(result.affectedRows).toBe(0);
  });

  it("anon은 users를 고칠 수 없다", async () => {
    await expect(
      queryAs(db, anon, `update public.users set nickname = 'x' where id = $1`, [SEED.student1]),
    ).rejects.toThrow(/permission denied/);
  });

  it.each([
    ["anon", anon],
    ["학생 본인", student],
    ["트레이너", trainer],
    ["운영자", admin],
  ])("%s는 users 행을 지울 수 없다 (탈퇴는 서버가 처리) — AUTH-08", async (_, actor) => {
    await expect(
      queryAs(db, actor, `delete from public.users where id = $1`, [SEED.student1]),
    ).rejects.toThrow(/permission denied/);
  });

  it.each([
    ["anon", anon],
    ["학생", student],
    ["운영자", admin],
  ])(
    "%s는 users 행(role = admin 포함)을 만들 수 없다 (가입은 서버가 처리) — AUTH-02, AUTH-03",
    async (_, actor) => {
      await expect(
        queryAs(
          db,
          actor,
          `insert into public.users (id, role, nickname) values ($1, 'admin', '가짜운영자')`,
          [SEED.student1],
        ),
      ).rejects.toThrow(/permission denied/);
    },
  );
});
