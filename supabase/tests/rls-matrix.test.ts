// 판정 헬퍼: QA만 고친다 (acceptance-guard, 이슈 #17). 바꿔야 하면 `[질문] 받는 역할: QA`.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, asUser, createTestDb, service } from "./helpers/db.ts";
import { attempt, describeRlsMatrix, validateMatrix } from "./helpers/rls-matrix.ts";
import type { RlsMatrix } from "./helpers/rls-matrix.ts";
import { SEED } from "./helpers/seed-ids.ts";

// 사용 예 — supabase/README.md "RLS 권한 매트릭스"와 같은 내용.
// 묶음별 전체 매트릭스는 QA가 supabase/tests/acceptance/에 쓴다.
const genres = {
  select: {
    sql: `select 1 from public.trainer_genres where trainer_id = $1`,
    params: [SEED.trainerApproved],
  },
  insert: {
    sql: `insert into public.trainer_genres (trainer_id, genre_id) values ($1, 3)`,
    params: [SEED.trainerApproved],
  },
  update: {
    sql: `update public.trainer_genres set genre_id = 5 where trainer_id = $1`,
    params: [SEED.trainerApproved],
  },
  delete: {
    sql: `delete from public.trainer_genres where trainer_id = $1`,
    params: [SEED.trainerApproved],
  },
};

describeRlsMatrix({
  title: "RLS 매트릭스 사용 예 — trainer_genres (TRN-08)",
  actors: {
    anon,
    학생: asUser(SEED.student1),
    "트레이너(본인)": asUser(SEED.trainerApproved),
    "다른 트레이너": asUser(SEED.trainerPilot),
    "pending 트레이너": asUser(SEED.trainerPending),
    운영자: asUser(SEED.admin),
  },
  cases: {
    // approved 트레이너(seed 11)의 장르
    trainer_genres: genres,
    // 같은 테이블의 다른 행: pending 트레이너(seed 14)의 장르
    "trainer_genres:pending": {
      select: {
        sql: `select 1 from public.trainer_genres where trainer_id = $1`,
        params: [SEED.trainerPending],
      },
    },
  },
  rows: [
    // 역할                 테이블                    select   insert   update   delete
    ["anon", "trainer_genres", "allow", "deny", "deny", "deny"],
    ["학생", "trainer_genres", "allow", "deny", "deny", "deny"],
    ["트레이너(본인)", "trainer_genres", "allow", "allow", "deny", "allow"],
    ["다른 트레이너", "trainer_genres", "allow", "deny", "deny", "deny"],
    ["운영자", "trainer_genres", "allow", "deny", "deny", "deny"],
    ["anon", "trainer_genres:pending", "deny", "-", "-", "-"],
    ["학생", "trainer_genres:pending", "deny", "-", "-", "-"],
    ["pending 트레이너", "trainer_genres:pending", "allow", "-", "-", "-"],
    ["운영자", "trainer_genres:pending", "allow", "-", "-", "-"],
  ],
});

describe("RLS 매트릭스 헬퍼 판정 (이슈 #17)", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  it("권한 없음(42501)과 RLS 위반은 차단, 0행도 차단, 1행 이상은 허용", async () => {
    expect(await attempt(db, anon, "insert", genres.insert)).toBe("deny"); // permission denied
    expect(await attempt(db, asUser(SEED.student1), "insert", genres.insert)).toBe("deny"); // RLS
    expect(await attempt(db, asUser(SEED.trainerPilot), "delete", genres.delete)).toBe("deny"); // 0행
    expect(await attempt(db, asUser(SEED.trainerApproved), "delete", genres.delete)).toBe("allow");
    expect(await attempt(db, service, "select", genres.select)).toBe("allow");
  });

  it("권한이 아닌 오류(중복 키 등)는 차단으로 치지 않고 던진다", async () => {
    const duplicate = {
      sql: `insert into public.trainer_genres (trainer_id, genre_id) values ($1, 1)`,
      params: [SEED.trainerApproved],
    };
    await expect(attempt(db, asUser(SEED.trainerApproved), "insert", duplicate)).rejects.toThrow(
      /판정할 수 없다.*duplicate key/,
    );
  });

  it("deniedBy로 지정한 트리거 오류는 차단으로 본다", async () => {
    // 트리거가 check_violation(23514)으로 막는 경우: 학생에게 트레이너 프로필 만들기 — AUTH-02
    const studentProfile = {
      sql: `insert into public.trainer_profiles (user_id) values ($1)`,
      params: [SEED.student1],
    };
    await expect(attempt(db, service, "insert", studentProfile)).rejects.toThrow(/판정할 수 없다/);
    expect(
      await attempt(db, service, "insert", { ...studentProfile, deniedBy: /role = trainer/ }),
    ).toBe("deny");
  });

  it("시도가 끝나면 항상 되돌린다", async () => {
    await attempt(db, asUser(SEED.trainerApproved), "delete", genres.delete);
    expect(await attempt(db, anon, "select", genres.select)).toBe("allow");
  });

  it("정의되지 않은 역할·테이블·시도를 가리키면 멈춘다", () => {
    const base: RlsMatrix = {
      title: "t",
      actors: { anon },
      cases: { trainer_genres: { select: genres.select } },
      rows: [],
    };
    expect(() =>
      validateMatrix({ ...base, rows: [["학생", "trainer_genres", "allow", "-", "-", "-"]] }),
    ).toThrow(/정의되지 않은 역할/);
    expect(() =>
      validateMatrix({ ...base, rows: [["anon", "users", "allow", "-", "-", "-"]] }),
    ).toThrow(/정의되지 않은 테이블/);
    expect(() =>
      validateMatrix({ ...base, rows: [["anon", "trainer_genres", "allow", "deny", "-", "-"]] }),
    ).toThrow(/insert 시도/);
  });
});
