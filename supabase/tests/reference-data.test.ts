import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, asUser, createTestDb, queryAs } from "./helpers/db.ts";
import { SEED } from "./helpers/seed-ids.ts";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

const actors = [
  ["anon", anon],
  ["학생", asUser(SEED.student1)],
  ["트레이너", asUser(SEED.trainerApproved)],
  ["운영자", asUser(SEED.admin)],
] as const;

describe.each(["regions", "genres"])("%s — TRN-08, MKT-02", (table) => {
  it.each(actors)("%s는 모두 읽는다", async (_, actor) => {
    const all = await db.query(`select id from public.${table}`);
    const { rows } = await queryAs(db, actor, `select * from public.${table}`);
    expect(rows).toHaveLength(all.rows.length);
    expect(rows.length).toBeGreaterThan(0);
  });

  const column = table === "regions" ? "sigungu" : "name";
  const writes = [
    [
      "추가",
      `insert into public.${table} (${table === "regions" ? "sido, sigungu" : "name"}) values (${table === "regions" ? "'가짜도', '가짜시'" : "'가짜장르'"})`,
    ],
    ["수정", `update public.${table} set ${column} = 'x'`],
    ["삭제", `delete from public.${table}`],
  ] as const;

  describe.each(actors)("%s", (_, actor) => {
    it.each(writes)("%s할 수 없다 (마이그레이션·seed로만 바뀜)", async (_label, sql) => {
      await expect(queryAs(db, actor, sql)).rejects.toThrow(/permission denied/);
    });
  });
});
