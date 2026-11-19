import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, asUser, createTestDb, queryAs, withActor } from "./helpers/db.ts";
import { ALL_SEED_USER_IDS, SEED, USER_PRIVATE_COLUMNS } from "./helpers/seed-ids.ts";

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

describe("users 읽기", () => {
  it.each([
    ["anon", anon],
    ["학생", student],
    ["트레이너", trainer],
  ])(
    "%s는 모든 사용자의 nickname, profile_image_url을 읽는다 — AUTH-06, S-01",
    async (_, actor) => {
      const { rows } = await queryAs<{ id: string }>(
        db,
        actor,
        `select id, nickname, profile_image_url from public.users`,
      );
      expect(rows.map((row) => row.id).sort()).toEqual([...ALL_SEED_USER_IDS].sort());
    },
  );

  describe.each([
    ["anon", anon],
    ["학생(다른 학생의 정보)", student],
    ["트레이너(학생의 정보, 결정 필요 3 추천안)", trainer],
  ])("%s", (_, actor) => {
    it.each(USER_PRIVATE_COLUMNS)("남의 %s를 읽을 수 없다 — AUTH-06, CHAT-04", async (column) => {
      await expect(
        queryAs(db, actor, `select ${column} from public.users where id = $1`, [SEED.student2]),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it("select *는 개인정보 컬럼 때문에 거부된다 (클라이언트는 컬럼을 골라 읽는다)", async () => {
    await expect(queryAs(db, student, `select * from public.users`)).rejects.toThrow(
      /permission denied/,
    );
  });

  // 기획 질문 대기: 본인·운영자가 개인정보 컬럼을 읽는 방법(뷰·별도 테이블·함수 중 무엇, 이름)이 정해지면 구현한다.
  it.todo("로그인한 사용자는 자기 행의 실명·생년월일·휴대폰·연계정보를 읽는다 — AUTH-03");
  it.todo("운영자는 모든 사용자의 모든 컬럼을 읽는다 — ADM-07, A-01");
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
    ["legal_name", "'다른이름'"],
    ["birth_date", "'2010-01-01'"],
    ["phone", "'01099999999'"],
    ["identity_key", "'dummy-other'"],
    ["withdrawn_at", "now()"],
    ["purge_after", "now()"],
  ])(
    "사용자는 자기 것이라도 %s를 고칠 수 없다 — AUTH-02, AUTH-03, AUTH-08",
    async (column, value) => {
      await expect(
        queryAs(db, student, `update public.users set ${column} = ${value} where id = $1`, [
          SEED.student1,
        ]),
      ).rejects.toThrow(/permission denied/);
    },
  );

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
