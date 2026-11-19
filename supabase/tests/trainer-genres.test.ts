import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, asUser, createTestDb, queryAs, withActor } from "./helpers/db.ts";
import { ALL_TRAINER_IDS, APPROVED_TRAINER_IDS, SEED } from "./helpers/seed-ids.ts";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

const student = asUser(SEED.student1);
const admin = asUser(SEED.admin);

async function visibleTrainerIds(actor: typeof anon) {
  const { rows } = await queryAs<{ trainer_id: string }>(
    db,
    actor,
    `select distinct trainer_id from public.trainer_genres`,
  );
  return rows.map((row) => row.trainer_id).sort();
}

describe("trainer_genres 읽기 — TRN-08", () => {
  it.each([
    ["anon", anon],
    ["학생", student],
  ])("%s는 읽을 수 있는 프로필(approved)의 장르만 읽는다", async (_, actor) => {
    expect(await visibleTrainerIds(actor)).toEqual([...APPROVED_TRAINER_IDS].sort());
  });

  it("pending 트레이너는 자기 장르를 읽는다", async () => {
    expect(await visibleTrainerIds(asUser(SEED.trainerPending))).toContain(SEED.trainerPending);
  });

  it("운영자는 모든 트레이너의 장르를 읽는다", async () => {
    expect(await visibleTrainerIds(admin)).toEqual([...ALL_TRAINER_IDS].sort());
  });
});

describe("trainer_genres 쓰기 — TRN-08", () => {
  const trainer = asUser(SEED.trainerApproved);

  it("트레이너는 자기 장르를 추가하고 지운다", async () => {
    const counts = await withActor(db, trainer, async (tx) => {
      await tx.query(`insert into public.trainer_genres (trainer_id, genre_id) values ($1, 3)`, [
        SEED.trainerApproved,
      ]);
      const deleted = await tx.query(
        `delete from public.trainer_genres where trainer_id = $1 and genre_id = 1`,
        [SEED.trainerApproved],
      );
      const { rows } = await tx.query<{ genre_id: number }>(
        `select genre_id from public.trainer_genres where trainer_id = $1 order by genre_id`,
        [SEED.trainerApproved],
      );
      return { deleted: deleted.affectedRows, genres: rows.map((row) => row.genre_id) };
    });
    expect(counts).toEqual({ deleted: 1, genres: [2, 3] });
  });

  it("트레이너는 다른 트레이너에게 장르를 붙일 수 없다", async () => {
    await expect(
      queryAs(
        db,
        trainer,
        `insert into public.trainer_genres (trainer_id, genre_id) values ($1, 3)`,
        [SEED.trainerPilot],
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("트레이너는 다른 트레이너의 장르를 지울 수 없다 (0행)", async () => {
    const result = await queryAs(
      db,
      trainer,
      `delete from public.trainer_genres where trainer_id = $1`,
      [SEED.trainerPilot],
    );
    expect(result.affectedRows).toBe(0);
  });

  it("트레이너는 장르를 고칠(update) 수 없다 — 지우고 다시 추가한다", async () => {
    await expect(
      queryAs(db, trainer, `update public.trainer_genres set genre_id = 5 where trainer_id = $1`, [
        SEED.trainerApproved,
      ]),
    ).rejects.toThrow(/permission denied/);
  });

  it("학생은 장르를 붙일 수 없다 (프로필이 없다)", async () => {
    await expect(
      queryAs(
        db,
        student,
        `insert into public.trainer_genres (trainer_id, genre_id) values ($1, 1)`,
        [SEED.student1],
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it("운영자는 트레이너의 장르를 붙이거나 지울 수 없다", async () => {
    await expect(
      queryAs(
        db,
        admin,
        `insert into public.trainer_genres (trainer_id, genre_id) values ($1, 5)`,
        [SEED.trainerApproved],
      ),
    ).rejects.toThrow(/row-level security/);
    const result = await queryAs(
      db,
      admin,
      `delete from public.trainer_genres where trainer_id = $1`,
      [SEED.trainerApproved],
    );
    expect(result.affectedRows).toBe(0);
  });

  it("anon은 장르를 붙일 수 없다", async () => {
    await expect(
      queryAs(db, anon, `insert into public.trainer_genres (trainer_id, genre_id) values ($1, 1)`, [
        SEED.trainerApproved,
      ]),
    ).rejects.toThrow(/permission denied/);
  });
});
