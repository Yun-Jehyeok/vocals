import type { PGlite, Transaction } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, asUser, createTestDb, queryAs, withActor } from "./helpers/db.ts";
import { ALL_TRAINER_IDS, NEW_USER_ID, SEED } from "./helpers/seed-ids.ts";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

const student = asUser(SEED.student1);
const admin = asUser(SEED.admin);

const SET_SOLE_PROPRIETOR = `update public.trainer_business_profiles
  set business_type = 'sole_proprietor', business_registration_no = '000-00-00099'
  where trainer_id = $1`;

/** 서버(가입 함수)가 만든 것처럼 트레이너 사용자와 pending 프로필을 만든다. 사업자 정보는 없다. */
async function createTrainerWithProfile(tx: Transaction) {
  await tx.query(`insert into auth.users (id) values ($1)`, [NEW_USER_ID]);
  await tx.query(
    `insert into public.users (id, role, nickname) values ($1, 'trainer', '새트레이너')`,
    [NEW_USER_ID],
  );
  await tx.query(`insert into public.trainer_profiles (user_id) values ($1)`, [NEW_USER_ID]);
}

describe("trainer_business_profiles 읽기 — T-23, A-01, A-05", () => {
  it.each(ALL_TRAINER_IDS)("트레이너(%s)는 자기 행만 읽는다", async (trainerId) => {
    const { rows } = await queryAs<{ trainer_id: string }>(
      db,
      asUser(trainerId),
      `select * from public.trainer_business_profiles`,
    );
    expect(rows.map((row) => row.trainer_id)).toEqual([trainerId]);
  });

  it("운영자는 모든 트레이너의 행을 읽는다 — ADM-07", async () => {
    const { rows } = await queryAs<{ trainer_id: string }>(
      db,
      admin,
      `select * from public.trainer_business_profiles`,
    );
    expect(rows.map((row) => row.trainer_id).sort()).toEqual([...ALL_TRAINER_IDS].sort());
  });

  it("학생은 읽을 수 없다 — S-01 표시 항목에 없음", async () => {
    const { rows } = await queryAs(db, student, `select * from public.trainer_business_profiles`);
    expect(rows).toEqual([]);
  });

  it("다른 트레이너의 행은 읽을 수 없다", async () => {
    const { rows } = await queryAs(
      db,
      asUser(SEED.trainerPilot),
      `select * from public.trainer_business_profiles where trainer_id = $1`,
      [SEED.trainerApproved],
    );
    expect(rows).toEqual([]);
  });

  it("anon은 읽을 수 없다", async () => {
    await expect(
      queryAs(db, anon, `select * from public.trainer_business_profiles`),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("trainer_business_profiles 만들기 — AUTH-04, T-01", () => {
  it("트레이너는 가입 신청 때 자기 사업자 유형·번호를 넣는다", async () => {
    const { rows } = await withActor(
      db,
      asUser(NEW_USER_ID),
      (tx) =>
        tx.query(
          `insert into public.trainer_business_profiles (trainer_id, business_type, business_registration_no)
           values ($1, 'sole_proprietor', '000-00-00077') returning business_type, payout_seller_id`,
          [NEW_USER_ID],
        ),
      { setup: createTrainerWithProfile },
    );
    expect(rows[0]).toEqual({ business_type: "sole_proprietor", payout_seller_id: null });
  });

  // QA 보고(PR #13): 행이 없을 때 insert로 확정 4를 우회하던 문제
  it.each([
    ["approved", SEED.trainerApproved],
    ["rejected", SEED.trainerRejected],
    ["suspended", SEED.trainerSuspended],
  ])(
    "%s 트레이너는 사업자 정보 행이 없어도 새로 넣을 수 없다 — AUTH-04 (확정 4)",
    async (_, trainerId) => {
      await expect(
        withActor(
          db,
          asUser(trainerId),
          (tx) =>
            tx.query(
              `insert into public.trainer_business_profiles (trainer_id, business_type, business_registration_no)
               values ($1, 'corporation', '000-00-99999')`,
              [trainerId],
            ),
          {
            setup: (tx) =>
              tx
                .query(`delete from public.trainer_business_profiles where trainer_id = $1`, [
                  trainerId,
                ])
                .then(() => undefined),
          },
        ),
      ).rejects.toThrow(/row-level security/);
    },
  );

  it.each([
    ["payout_seller_id", "'x'"],
    ["payout_account_masked", "'x'"],
  ])("트레이너는 %s를 넣을 수 없다 (서버만)", async (column, value) => {
    await expect(
      withActor(
        db,
        asUser(NEW_USER_ID),
        (tx) =>
          tx.query(
            `insert into public.trainer_business_profiles (trainer_id, business_type, ${column})
             values ($1, 'individual', ${value})`,
            [NEW_USER_ID],
          ),
        { setup: createTrainerWithProfile },
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("남의 사업자 정보 행을 만들 수 없다", async () => {
    await expect(
      withActor(
        db,
        asUser(SEED.trainerApproved),
        (tx) =>
          tx.query(
            `insert into public.trainer_business_profiles (trainer_id, business_type) values ($1, 'individual')`,
            [NEW_USER_ID],
          ),
        { setup: createTrainerWithProfile },
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("학생은 만들 수 없다 (트레이너 프로필이 없다)", async () => {
    await expect(
      queryAs(
        db,
        student,
        `insert into public.trainer_business_profiles (trainer_id, business_type) values ($1, 'individual')`,
        [SEED.student1],
      ),
    ) // 프로필이 없어 승인 상태가 없으므로 RLS가 먼저 막는다. FK도 막는다.
      .rejects.toThrow(/row-level security|foreign key/);
  });
});

describe("trainer_business_profiles 고치기 — AUTH-04 (확정 4)", () => {
  it("pending 트레이너는 자기 사업자 유형·번호를 고친다", async () => {
    const result = await queryAs(db, asUser(SEED.trainerPending), SET_SOLE_PROPRIETOR, [
      SEED.trainerPending,
    ]);
    expect(result.affectedRows).toBe(1);
  });

  it.each([
    ["approved", SEED.trainerApproved],
    ["rejected", SEED.trainerRejected],
    ["suspended", SEED.trainerSuspended],
  ])("%s 트레이너는 자기 사업자 유형·번호를 고칠 수 없다 (0행)", async (_, trainerId) => {
    const result = await queryAs(db, asUser(trainerId), SET_SOLE_PROPRIETOR, [trainerId]);
    expect(result.affectedRows).toBe(0);
  });

  it.each([
    ["pending", SEED.trainerPending],
    ["approved", SEED.trainerApproved],
    ["suspended", SEED.trainerSuspended],
  ])("운영자는 %s 트레이너의 사업자 유형·번호를 언제든 고친다", async (_, trainerId) => {
    const result = await queryAs(db, admin, SET_SOLE_PROPRIETOR, [trainerId]);
    expect(result.affectedRows).toBe(1);
  });

  it.each([
    ["payout_seller_id", "'x'"],
    ["payout_account_masked", "'x'"],
  ])("트레이너는 자기 것이라도 %s를 고칠 수 없다 — erd 2장", async (column, value) => {
    await expect(
      queryAs(
        db,
        asUser(SEED.trainerPending),
        `update public.trainer_business_profiles set ${column} = ${value} where trainer_id = $1`,
        [SEED.trainerPending],
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it.each([
    ["payout_seller_id", "'x'"],
    ["payout_account_masked", "'x'"],
  ])("운영자도 %s는 고칠 수 없다 (서버가 PG 등록 후 쓴다)", async (column, value) => {
    await expect(
      queryAs(
        db,
        admin,
        `update public.trainer_business_profiles set ${column} = ${value} where trainer_id = $1`,
        [SEED.trainerApproved],
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("트레이너는 다른 트레이너의 사업자 정보를 고칠 수 없다 (0행)", async () => {
    const result = await queryAs(db, asUser(SEED.trainerPending), SET_SOLE_PROPRIETOR, [
      SEED.trainerApproved,
    ]);
    expect(result.affectedRows).toBe(0);
  });

  it("학생은 고칠 수 없다 (0행)", async () => {
    const result = await queryAs(db, student, SET_SOLE_PROPRIETOR, [SEED.trainerPending]);
    expect(result.affectedRows).toBe(0);
  });

  it("anon은 고칠 수 없다", async () => {
    await expect(queryAs(db, anon, SET_SOLE_PROPRIETOR, [SEED.trainerPending])).rejects.toThrow(
      /permission denied/,
    );
  });

  it.each([
    ["트레이너 본인", asUser(SEED.trainerPending)],
    ["운영자", admin],
  ])("%s도 행을 지울 수 없다", async (_, actor) => {
    await expect(
      queryAs(db, actor, `delete from public.trainer_business_profiles where trainer_id = $1`, [
        SEED.trainerPending,
      ]),
    ).rejects.toThrow(/permission denied/);
  });
});
