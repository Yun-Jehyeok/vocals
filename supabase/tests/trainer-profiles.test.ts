import type { PGlite, Transaction } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, asUser, createTestDb, queryAs, withActor } from "./helpers/db.ts";
import {
  ALL_TRAINER_IDS,
  APPROVED_TRAINER_IDS,
  NEW_USER_ID,
  SEED,
  TRAINER_PRIVATE_COLUMNS,
} from "./helpers/seed-ids.ts";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

const student = asUser(SEED.student1);
const admin = asUser(SEED.admin);

async function visibleProfileIds(actor: ReturnType<typeof asUser> | typeof anon) {
  const { rows } = await queryAs<{ user_id: string }>(
    db,
    actor,
    `select user_id from public.trainer_profiles`,
  );
  return rows.map((row) => row.user_id).sort();
}

/** 서버(가입 함수)가 만든 것처럼 트레이너 사용자를 하나 만든다. 프로필은 없다. */
async function createTrainerUser(tx: Transaction) {
  await tx.query(`insert into auth.users (id) values ($1)`, [NEW_USER_ID]);
  await tx.query(
    `insert into public.users (id, role, nickname) values ($1, 'trainer', '새트레이너')`,
    [NEW_USER_ID],
  );
}

describe("trainer_profiles 읽기", () => {
  it.each([
    ["anon", anon],
    ["학생", student],
    ["다른 트레이너", asUser(SEED.trainerApproved)],
  ])(
    "%s는 approved 프로필만 읽는다. listed = false여도 읽힌다 — TRN-02, MKT-01, MKT-07",
    async (_, actor) => {
      const ids = await visibleProfileIds(actor);
      // trainerApproved 본인은 approved라 목록이 같다.
      expect(ids).toEqual([...APPROVED_TRAINER_IDS].sort());
    },
  );

  it("anon은 listed = false인 프로필을 링크(link_slug)로 연다 — MKT-07, S-01", async () => {
    const { rows } = await queryAs<{ user_id: string }>(
      db,
      anon,
      `select user_id from public.trainer_profiles where link_slug = 'seed-unlisted'`,
    );
    expect(rows.map((row) => row.user_id)).toEqual([SEED.trainerUnlisted]);
  });

  it.each([
    ["pending", SEED.trainerPending],
    ["rejected", SEED.trainerRejected],
    ["suspended (결정 필요 2 추천안)", SEED.trainerSuspended],
  ])("%s 프로필은 본인과 운영자만 읽는다 — AUTH-05, T-02", async (_, trainerId) => {
    expect(await visibleProfileIds(anon)).not.toContain(trainerId);
    expect(await visibleProfileIds(student)).not.toContain(trainerId);
    expect(await visibleProfileIds(asUser(SEED.trainerApproved))).not.toContain(trainerId);
    expect(await visibleProfileIds(asUser(trainerId))).toContain(trainerId);
    expect(await visibleProfileIds(admin)).toContain(trainerId);
  });

  it("운영자는 모든 상태의 프로필을 읽는다 — ADM-01, ADM-07", async () => {
    expect(await visibleProfileIds(admin)).toEqual([...ALL_TRAINER_IDS].sort());
  });

  describe.each([
    ["anon", anon],
    ["학생", student],
    ["다른 트레이너", asUser(SEED.trainerPilot)],
  ])("%s", (_, actor) => {
    it.each(TRAINER_PRIVATE_COLUMNS)("%s를 읽을 수 없다 — S-01, T-23, A-05", async (column) => {
      await expect(
        queryAs(db, actor, `select ${column} from public.trainer_profiles where user_id = $1`, [
          SEED.trainerApproved,
        ]),
      ).rejects.toThrow(/permission denied/);
    });
  });

  // 기획 질문 대기: users 개인정보와 같은 방식으로 정한다.
  it.todo("트레이너 본인은 자기 사업자 유형·번호·정산 계좌(마스킹)를 읽는다 — T-23");
  it.todo("운영자는 사업자 유형·번호·정산 정보를 읽는다 — A-01, A-05, ADM-07");
});

describe("trainer_profiles 만들기", () => {
  it("트레이너는 자기 프로필을 만든다. pending, 파일럿 아님, 링크는 서버가 만든다 — AUTH-04, AUTH-05", async () => {
    const { rows } = await withActor(
      db,
      asUser(NEW_USER_ID),
      (tx) =>
        tx.query<{
          approval_status: string;
          is_pilot: boolean;
          listed: boolean;
          link_slug: string;
        }>(
          `insert into public.trainer_profiles (user_id, display_name, business_type)
           values ($1, '새 트레이너', 'individual')
           returning approval_status, is_pilot, listed, link_slug`,
          [NEW_USER_ID],
        ),
      { setup: createTrainerUser },
    );
    expect(rows[0]).toMatchObject({ approval_status: "pending", is_pilot: false, listed: true });
    expect(rows[0]?.link_slug).toMatch(/^[0-9a-f]{12}$/);
  });

  it.each([
    ["approval_status", "'approved'"],
    ["is_pilot", "true"],
    ["link_slug", "'my-slug'"],
    ["payout_seller_id", "'x'"],
    ["approved_at", "now()"],
  ])("트레이너는 프로필을 만들 때 %s를 넣을 수 없다", async (column, value) => {
    await expect(
      withActor(
        db,
        asUser(NEW_USER_ID),
        (tx) =>
          tx.query(
            `insert into public.trainer_profiles (user_id, business_type, ${column})
             values ($1, 'individual', ${value})`,
            [NEW_USER_ID],
          ),
        { setup: createTrainerUser },
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("트레이너는 남의 프로필을 만들 수 없다", async () => {
    await expect(
      withActor(
        db,
        asUser(SEED.trainerApproved),
        (tx) =>
          tx.query(
            `insert into public.trainer_profiles (user_id, business_type) values ($1, 'individual')`,
            [NEW_USER_ID],
          ),
        { setup: createTrainerUser },
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("학생은 trainer_profiles 행을 만들 수 없다 — AUTH-02", async () => {
    await expect(
      queryAs(
        db,
        student,
        `insert into public.trainer_profiles (user_id, business_type) values ($1, 'individual')`,
        [SEED.student1],
      ),
      // 트리거(role 확인)가 RLS 정책보다 먼저 막는다. 어느 쪽이든 거부되면 된다.
    ).rejects.toThrow(/role = trainer|row-level security/);
  });

  it("anon은 trainer_profiles 행을 만들 수 없다", async () => {
    await expect(
      queryAs(
        db,
        anon,
        `insert into public.trainer_profiles (user_id, business_type) values ($1, 'individual')`,
        [SEED.student1],
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("trainer_profiles 고치기: 트레이너", () => {
  const pending = asUser(SEED.trainerPending);

  it("pending 트레이너도 자기 프로필 내용과 목록 노출을 고친다 — AUTH-05, TRN-01, TRN-08, MKT-07", async () => {
    const { rows } = await withActor(db, pending, async (tx) => {
      await tx.query(
        `update public.trainer_profiles
         set display_name = '새 이름', bio = '새 소개', career = '새 경력',
             lesson_place = '새 장소', region_id = 1, listed = false
         where user_id = $1`,
        [SEED.trainerPending],
      );
      return tx.query(
        `select display_name, bio, career, lesson_place, region_id, listed
         from public.trainer_profiles where user_id = $1`,
        [SEED.trainerPending],
      );
    });
    expect(rows[0]).toEqual({
      display_name: "새 이름",
      bio: "새 소개",
      career: "새 경력",
      lesson_place: "새 장소",
      region_id: 1,
      listed: false,
    });
  });

  it.each([
    ["approval_status", "'approved'"],
    ["is_pilot", "true"],
  ])(
    "트레이너는 자기 것이라도 %s를 고칠 수 없다 — ADM-01, ADM-03, PLT-01",
    async (column, value) => {
      await expect(
        queryAs(
          db,
          pending,
          `update public.trainer_profiles set ${column} = ${value} where user_id = $1`,
          [SEED.trainerPending],
        ),
      ).rejects.toThrow(/운영자만/);
    },
  );

  it.each([
    ["approved_at", "now()"],
    ["payout_seller_id", "'x'"],
    ["payout_account_masked", "'x'"],
    ["link_slug", "'my-slug'"],
  ])("트레이너는 자기 것이라도 %s를 고칠 수 없다 — erd 2장, 결정 필요 5", async (column, value) => {
    await expect(
      queryAs(
        db,
        pending,
        `update public.trainer_profiles set ${column} = ${value} where user_id = $1`,
        [SEED.trainerPending],
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("pending 트레이너는 사업자 유형·번호를 고친다 — 결정 필요 4 추천안", async () => {
    const result = await queryAs(
      db,
      pending,
      `update public.trainer_profiles
       set business_type = 'sole_proprietor', business_registration_no = '000-00-00099'
       where user_id = $1`,
      [SEED.trainerPending],
    );
    expect(result.affectedRows).toBe(1);
  });

  it("승인된 트레이너는 사업자 유형·번호를 고칠 수 없다 — 결정 필요 4 추천안", async () => {
    await expect(
      queryAs(
        db,
        asUser(SEED.trainerApproved),
        `update public.trainer_profiles
         set business_type = 'sole_proprietor', business_registration_no = '000-00-00099'
         where user_id = $1`,
        [SEED.trainerApproved],
      ),
    ).rejects.toThrow(/운영자만/);
  });

  it("트레이너는 다른 트레이너의 프로필을 고칠 수 없다 (0행)", async () => {
    const result = await queryAs(
      db,
      asUser(SEED.trainerApproved),
      `update public.trainer_profiles set bio = '남이 바꿈' where user_id = $1`,
      [SEED.trainerPilot],
    );
    expect(result.affectedRows).toBe(0);
  });

  it("학생은 프로필을 고칠 수 없다 (0행)", async () => {
    const result = await queryAs(
      db,
      student,
      `update public.trainer_profiles set bio = '학생이 바꿈' where user_id = $1`,
      [SEED.trainerApproved],
    );
    expect(result.affectedRows).toBe(0);
  });

  it("anon은 프로필을 고칠 수 없다", async () => {
    await expect(
      queryAs(db, anon, `update public.trainer_profiles set bio = 'x' where user_id = $1`, [
        SEED.trainerApproved,
      ]),
    ).rejects.toThrow(/permission denied/);
  });

  it.each([
    ["트레이너 본인", asUser(SEED.trainerApproved)],
    ["운영자", admin],
  ])("%s도 프로필을 지울 수 없다", async (_, actor) => {
    await expect(
      queryAs(db, actor, `delete from public.trainer_profiles where user_id = $1`, [
        SEED.trainerApproved,
      ]),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("trainer_profiles 고치기: 운영자", () => {
  it("운영자는 pending을 승인하고, 승인 시각이 기록된다 — ADM-01", async () => {
    const { rows } = await withActor(db, admin, async (tx) => {
      await tx.query(
        `update public.trainer_profiles set approval_status = 'approved' where user_id = $1`,
        [SEED.trainerPending],
      );
      return tx.query<{ approval_status: string; approved_at: Date | null }>(
        `select approval_status, approved_at from public.trainer_profiles where user_id = $1`,
        [SEED.trainerPending],
      );
    });
    expect(rows[0]?.approval_status).toBe("approved");
    expect(rows[0]?.approved_at).not.toBeNull();
  });

  it.each([
    ["거절", SEED.trainerPending, "rejected"],
    ["정지", SEED.trainerApproved, "suspended"],
  ])("운영자는 트레이너를 %s한다 — ADM-01, ADM-02", async (_, trainerId, status) => {
    const result = await queryAs(
      db,
      admin,
      `update public.trainer_profiles set approval_status = $2 where user_id = $1`,
      [trainerId, status],
    );
    expect(result.affectedRows).toBe(1);
  });

  it("운영자는 파일럿을 지정·해제한다 — ADM-03, PLT-01", async () => {
    const result = await queryAs(
      db,
      admin,
      `update public.trainer_profiles set is_pilot = not is_pilot where user_id = any($1)`,
      [[SEED.trainerApproved, SEED.trainerPilot]],
    );
    expect(result.affectedRows).toBe(2);
  });

  it("운영자는 승인 뒤에도 사업자 유형·번호를 고친다 — 결정 필요 4 추천안", async () => {
    const result = await queryAs(
      db,
      admin,
      `update public.trainer_profiles
       set business_type = 'sole_proprietor', business_registration_no = '000-00-00099'
       where user_id = $1`,
      [SEED.trainerApproved],
    );
    expect(result.affectedRows).toBe(1);
  });

  it("운영자는 트레이너의 프로필 내용을 고칠 수 없다", async () => {
    await expect(
      queryAs(
        db,
        admin,
        `update public.trainer_profiles set bio = '운영자가 바꿈' where user_id = $1`,
        [SEED.trainerApproved],
      ),
    ).rejects.toThrow(/운영자는 트레이너 프로필 내용을 고칠 수 없다/);
  });

  it.each([
    ["payout_seller_id", "'x'"],
    ["payout_account_masked", "'x'"],
    ["link_slug", "'x'"],
  ])("운영자도 %s는 고칠 수 없다 (서버만)", async (column, value) => {
    await expect(
      queryAs(
        db,
        admin,
        `update public.trainer_profiles set ${column} = ${value} where user_id = $1`,
        [SEED.trainerApproved],
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("학생은 승인 상태를 바꿀 수 없다 (0행)", async () => {
    const result = await queryAs(
      db,
      student,
      `update public.trainer_profiles set approval_status = 'approved' where user_id = $1`,
      [SEED.trainerPending],
    );
    expect(result.affectedRows).toBe(0);
  });
});
