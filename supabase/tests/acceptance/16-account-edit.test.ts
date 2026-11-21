// 인수 테스트: 이슈 #16 계정 수정 권한 보완 (QA가 개발 전에 쓴다. 개발은 고치지 않는다)
//
// 완료 조건 → 테스트
// - 정지 트레이너 (ADM-02, ADM-01~03, AUTH-04): 현재 정책과 맞다. 테스트로 고정한다.
// - 탈퇴 사용자 (AUTH-07): 개발 대상. 개발 전에는 "탈퇴 … → 차단" 칸 일부가 실패하는 것이 정상이다.
// - active 사용자의 기존 허용 동작은 그대로 (#11): 같은 동작을 active 상태로 시도해 허용을 확인한다.
// - 서버(service_role)는 탈퇴 사용자 행을 고칠 수 있다 (AUTH-08)
// - 탈퇴 사용자의 읽기 권한은 바꾸지 않는다: 탈퇴 사용자 본인의 select는 허용 그대로
// - "새 마이그레이션으로만", "활성 판정을 한 곳에"는 테스트로 쓰지 않는다. 판정 때 코드와
//   `pnpm check:migrations`로 확인한다.
//
// 필요한 사용자 상태(탈퇴 학생·트레이너, 행이 없는 상태)는 seed를 고치지 않고 각 시도의 setup에서
// 서버(service_role)로 만든다. 시도는 항상 되돌린다.
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "../helpers/db.ts";
import { anon, asUser, createTestDb, service, withActor } from "../helpers/db.ts";
import { attempt, describeRlsMatrix } from "../helpers/rls-matrix.ts";
import type { OpCase } from "../helpers/rls-matrix.ts";
import { NEW_USER_ID, SEED } from "../helpers/seed-ids.ts";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

const getDb = () => db;

// ---------------------------------------------------------------------------
// 준비 작업: 서버(service_role)가 처리한 것처럼 상태를 만든다.
// ---------------------------------------------------------------------------

type Setup = (tx: Transaction) => Promise<void>;

/** setup 안에서 service_role로 실행하고 원래 역할로 돌아온다. */
async function asServer(tx: Transaction, fn: () => Promise<unknown>): Promise<void> {
  await tx.exec("set local role service_role");
  await fn();
  await tx.exec("reset role");
}

const chain =
  (...setups: Setup[]): Setup =>
  async (tx) => {
    for (const setup of setups) await setup(tx);
  };

/** 서버가 탈퇴 처리한 상태 (AUTH-07, AUTH-08: 삭제 전 보관 중) */
const withdraw =
  (userId: string): Setup =>
  (tx) =>
    asServer(tx, () =>
      tx.query(`update public.users set status = 'withdrawn' where id = $1`, [userId]),
    );

/** 가입 함수가 만든 것처럼 프로필 없는 트레이너 사용자를 만든다. */
const createTrainerUser =
  (status: "active" | "withdrawn"): Setup =>
  (tx) =>
    asServer(tx, async () => {
      await tx.query(`insert into auth.users (id) values ($1)`, [NEW_USER_ID]);
      await tx.query(
        `insert into public.users (id, role, nickname, status) values ($1, 'trainer', '새트레이너', $2)`,
        [NEW_USER_ID, status],
      );
    });

/** 사업자 정보 행이 아직 없는 상태 (insert를 중복 키가 아니라 권한으로만 판정하기 위해) */
const removeBusinessProfile =
  (trainerId: string): Setup =>
  (tx) =>
    asServer(tx, () =>
      tx.query(`delete from public.trainer_business_profiles where trainer_id = $1`, [trainerId]),
    );

// ---------------------------------------------------------------------------
// 시도
// ---------------------------------------------------------------------------

const PROFILE_CONTENT: [column: string, value: string][] = [
  ["display_name", "'바꾼 이름'"],
  ["bio", "'바꾼 소개'"],
  ["career", "'바꾼 경력'"],
  ["lesson_place", "'바꾼 연습실'"],
  ["region_id", "2"],
  ["listed", "not listed"],
];

const ALL_CONTENT_SET = PROFILE_CONTENT.map(([column, value]) => `${column} = ${value}`).join(", ");

const selectUser = (id: string, setup?: Setup): OpCase => ({
  sql: `select 1 from public.users where id = $1`,
  params: [id],
  ...(setup ? { setup } : {}),
});

const updateUserColumn = (id: string, column: string, setup?: Setup): OpCase => ({
  sql: `update public.users set ${column} = 'https://example.test/new.png' where id = $1`,
  params: [id],
  ...(setup ? { setup } : {}),
});

const updateNickname = (id: string, setup?: Setup): OpCase => ({
  sql: `update public.users set nickname = '바꾼닉네임' where id = $1`,
  params: [id],
  ...(setup ? { setup } : {}),
});

const selectProfile = (id: string, setup?: Setup): OpCase => ({
  sql: `select 1 from public.trainer_profiles where user_id = $1`,
  params: [id],
  ...(setup ? { setup } : {}),
});

const updateProfileContent = (id: string, setup?: Setup): OpCase => ({
  sql: `update public.trainer_profiles set ${ALL_CONTENT_SET} where user_id = $1`,
  params: [id],
  ...(setup ? { setup } : {}),
});

const insertProfile = (id: string, setup: Setup): OpCase => ({
  sql: `insert into public.trainer_profiles (user_id, display_name) values ($1, '새 프로필')`,
  params: [id],
  setup,
});

const selectGenres = (id: string, setup?: Setup): OpCase => ({
  sql: `select 1 from public.trainer_genres where trainer_id = $1`,
  params: [id],
  ...(setup ? { setup } : {}),
});

/** genre 3(팝)은 seed의 11·14·16 트레이너에게 없다 */
const insertGenre = (id: string, setup?: Setup): OpCase => ({
  sql: `insert into public.trainer_genres (trainer_id, genre_id) values ($1, 3)`,
  params: [id],
  ...(setup ? { setup } : {}),
});

const deleteGenre = (id: string, genreId: number, setup?: Setup): OpCase => ({
  sql: `delete from public.trainer_genres where trainer_id = $1 and genre_id = ${genreId}`,
  params: [id],
  ...(setup ? { setup } : {}),
});

const selectBusiness = (id: string, setup?: Setup): OpCase => ({
  sql: `select 1 from public.trainer_business_profiles where trainer_id = $1`,
  params: [id],
  ...(setup ? { setup } : {}),
});

const insertBusiness = (id: string, setup: Setup): OpCase => ({
  sql: `insert into public.trainer_business_profiles (trainer_id, business_type, business_registration_no)
        values ($1, 'sole_proprietor', '000-00-99999')`,
  params: [id],
  setup,
});

const updateBusiness = (id: string, setup?: Setup): OpCase => ({
  sql: `update public.trainer_business_profiles
        set business_type = 'sole_proprietor', business_registration_no = '000-00-99999'
        where trainer_id = $1`,
  params: [id],
  ...(setup ? { setup } : {}),
});

// ===========================================================================
// 정지 트레이너 (ADM-02) — 현재 맞음, 테스트로 고정
// ===========================================================================

const SUSPENDED = SEED.trainerSuspended;

describeRlsMatrix(
  {
    title: "#16 정지 트레이너의 자기 정보 수정과 공개 범위 — ADM-02, ADM-01, ADM-03, AUTH-04",
    actors: {
      anon,
      학생: asUser(SEED.student1),
      "다른 트레이너": asUser(SEED.trainerApproved),
      "정지 트레이너(본인)": asUser(SUSPENDED),
      운영자: asUser(SEED.admin),
    },
    cases: {
      // ADM-02: 프로필 내용 6컬럼을 한 번에 고친다. 컬럼별은 아래 it.each
      "trainer_profiles:정지": {
        select: selectProfile(SUSPENDED),
        update: updateProfileContent(SUSPENDED),
      },
      // ADM-01, ADM-03: 승인 상태·파일럿은 운영자만 (트리거가 42501로 막는다)
      "trainer_profiles.approval_status:정지": {
        update: {
          sql: `update public.trainer_profiles set approval_status = 'approved' where user_id = $1`,
          params: [SUSPENDED],
        },
      },
      "trainer_profiles.is_pilot:정지": {
        update: {
          sql: `update public.trainer_profiles set is_pilot = true where user_id = $1`,
          params: [SUSPENDED],
        },
      },
      // ADM-02: 장르 추가·삭제 (seed 16의 장르는 9 힙합)
      "trainer_genres:정지": {
        select: selectGenres(SUSPENDED),
        insert: insertGenre(SUSPENDED),
        delete: deleteGenre(SUSPENDED, 9),
      },
      // AUTH-04 확정 4: 사업자 정보는 pending 동안만 본인이 고친다
      "trainer_business_profiles:정지": {
        select: selectBusiness(SUSPENDED),
        insert: insertBusiness(SUSPENDED, removeBusinessProfile(SUSPENDED)),
        update: updateBusiness(SUSPENDED),
      },
    },
    rows: [
      // 역할                   테이블                                   select   insert   update   delete
      ["anon", "trainer_profiles:정지", "deny", "-", "-", "-"],
      ["학생", "trainer_profiles:정지", "deny", "-", "deny", "-"],
      ["다른 트레이너", "trainer_profiles:정지", "deny", "-", "deny", "-"],
      ["정지 트레이너(본인)", "trainer_profiles:정지", "allow", "-", "allow", "-"],
      ["운영자", "trainer_profiles:정지", "allow", "-", "-", "-"],

      ["정지 트레이너(본인)", "trainer_profiles.approval_status:정지", "-", "-", "deny", "-"],
      ["정지 트레이너(본인)", "trainer_profiles.is_pilot:정지", "-", "-", "deny", "-"],
      ["운영자", "trainer_profiles.approval_status:정지", "-", "-", "allow", "-"],

      ["anon", "trainer_genres:정지", "deny", "deny", "-", "deny"],
      ["학생", "trainer_genres:정지", "deny", "deny", "-", "deny"],
      ["다른 트레이너", "trainer_genres:정지", "deny", "deny", "-", "deny"],
      ["정지 트레이너(본인)", "trainer_genres:정지", "allow", "allow", "-", "allow"],
      ["운영자", "trainer_genres:정지", "allow", "deny", "-", "deny"],

      ["학생", "trainer_business_profiles:정지", "deny", "deny", "deny", "-"],
      ["다른 트레이너", "trainer_business_profiles:정지", "deny", "deny", "deny", "-"],
      ["정지 트레이너(본인)", "trainer_business_profiles:정지", "allow", "deny", "deny", "-"],
      ["운영자", "trainer_business_profiles:정지", "allow", "-", "allow", "-"],
    ],
  },
  { db: getDb },
);

describe("#16 정지 트레이너는 프로필 내용을 컬럼마다 고칠 수 있다 — ADM-02", () => {
  it.each(PROFILE_CONTENT)(
    "정지 트레이너(본인) × trainer_profiles.%s × update → 허용",
    async (column, value) => {
      const result = await attempt(db, asUser(SUSPENDED), "update", {
        sql: `update public.trainer_profiles set ${column} = ${value} where user_id = $1`,
        params: [SUSPENDED],
      });
      expect(result).toBe("allow");
    },
  );
});

// ===========================================================================
// 탈퇴 사용자 (AUTH-07) — 개발 대상
// ===========================================================================

const STUDENT = SEED.student1;
const TRAINER = SEED.trainerApproved; // approved, 장르 1·2
const PENDING = SEED.trainerPending; // pending, 장르 1

const withdrawnStudent = withdraw(STUDENT);
const withdrawnTrainer = withdraw(TRAINER);
const withdrawnPending = withdraw(PENDING);

describeRlsMatrix(
  {
    title: "#16 탈퇴 사용자는 자기 정보를 고칠 수 없다 — AUTH-07",
    actors: {
      "탈퇴 학생(본인)": asUser(STUDENT),
      "탈퇴 트레이너(본인)": asUser(TRAINER),
      "탈퇴 pending 트레이너(본인)": asUser(PENDING),
      "탈퇴 신규 트레이너(본인)": asUser(NEW_USER_ID),
    },
    cases: {
      "users.nickname:탈퇴 학생": {
        select: selectUser(STUDENT, withdrawnStudent),
        update: updateNickname(STUDENT, withdrawnStudent),
      },
      "users.profile_image_url:탈퇴 학생": {
        update: updateUserColumn(STUDENT, "profile_image_url", withdrawnStudent),
      },
      "users.nickname:탈퇴 트레이너": {
        select: selectUser(TRAINER, withdrawnTrainer),
        update: updateNickname(TRAINER, withdrawnTrainer),
      },
      "users.profile_image_url:탈퇴 트레이너": {
        update: updateUserColumn(TRAINER, "profile_image_url", withdrawnTrainer),
      },
      "trainer_profiles:탈퇴 트레이너": {
        select: selectProfile(TRAINER, withdrawnTrainer),
        update: updateProfileContent(TRAINER, withdrawnTrainer),
      },
      "trainer_profiles:탈퇴 신규 트레이너(프로필 없음)": {
        insert: insertProfile(NEW_USER_ID, createTrainerUser("withdrawn")),
      },
      "trainer_genres:탈퇴 트레이너": {
        select: selectGenres(TRAINER, withdrawnTrainer),
        insert: insertGenre(TRAINER, withdrawnTrainer),
        delete: deleteGenre(TRAINER, 1, withdrawnTrainer),
      },
      "trainer_business_profiles:탈퇴 pending 트레이너": {
        select: selectBusiness(PENDING, withdrawnPending),
        update: updateBusiness(PENDING, withdrawnPending),
      },
      "trainer_business_profiles:탈퇴 pending 트레이너(행 없음)": {
        insert: insertBusiness(PENDING, chain(withdrawnPending, removeBusinessProfile(PENDING))),
      },
      // 읽기 권한은 이 이슈에서 바꾸지 않는다: 본인 개인정보·계정 기록은 그대로 읽는다
      "user_private_profiles:탈퇴 학생": {
        select: {
          sql: `select 1 from public.user_private_profiles where user_id = $1`,
          params: [STUDENT],
          setup: withdrawnStudent,
        },
      },
      "user_account_records:탈퇴 학생": {
        select: {
          sql: `select 1 from public.user_account_records where user_id = $1`,
          params: [STUDENT],
          setup: withdrawnStudent,
        },
      },
    },
    rows: [
      // 역할                           테이블                                                  select   insert   update   delete
      ["탈퇴 학생(본인)", "users.nickname:탈퇴 학생", "allow", "-", "deny", "-"],
      ["탈퇴 학생(본인)", "users.profile_image_url:탈퇴 학생", "-", "-", "deny", "-"],
      ["탈퇴 학생(본인)", "user_private_profiles:탈퇴 학생", "allow", "-", "-", "-"],
      ["탈퇴 학생(본인)", "user_account_records:탈퇴 학생", "allow", "-", "-", "-"],
      ["탈퇴 트레이너(본인)", "users.nickname:탈퇴 트레이너", "allow", "-", "deny", "-"],
      ["탈퇴 트레이너(본인)", "users.profile_image_url:탈퇴 트레이너", "-", "-", "deny", "-"],
      ["탈퇴 트레이너(본인)", "trainer_profiles:탈퇴 트레이너", "allow", "-", "deny", "-"],
      [
        "탈퇴 신규 트레이너(본인)",
        "trainer_profiles:탈퇴 신규 트레이너(프로필 없음)",
        "-",
        "deny",
        "-",
        "-",
      ],
      ["탈퇴 트레이너(본인)", "trainer_genres:탈퇴 트레이너", "allow", "deny", "-", "deny"],
      [
        "탈퇴 pending 트레이너(본인)",
        "trainer_business_profiles:탈퇴 pending 트레이너",
        "allow",
        "-",
        "deny",
        "-",
      ],
      [
        "탈퇴 pending 트레이너(본인)",
        "trainer_business_profiles:탈퇴 pending 트레이너(행 없음)",
        "-",
        "deny",
        "-",
        "-",
      ],
    ],
  },
  { db: getDb },
);

describe("#16 탈퇴 트레이너는 프로필 내용을 컬럼마다 고칠 수 없다 — AUTH-07", () => {
  it.each(PROFILE_CONTENT)(
    "탈퇴 트레이너(본인) × trainer_profiles.%s × update → 차단",
    async (column, value) => {
      const result = await attempt(db, asUser(TRAINER), "update", {
        sql: `update public.trainer_profiles set ${column} = ${value} where user_id = $1`,
        params: [TRAINER],
        setup: withdrawnTrainer,
      });
      expect(result).toBe("deny");
    },
  );
});

describe("#16 탈퇴 사용자는 자기 상태를 되돌릴 수 없다 — AUTH-07", () => {
  it("탈퇴 학생(본인) × users.status = active × update → 차단", async () => {
    const result = await attempt(db, asUser(STUDENT), "update", {
      sql: `update public.users set status = 'active' where id = $1`,
      params: [STUDENT],
      setup: withdrawnStudent,
    });
    expect(result).toBe("deny");
  });
});

// ===========================================================================
// active 사용자의 기존 허용 동작은 그대로 (#11) — 같은 시도를 active 상태로
// ===========================================================================

describeRlsMatrix(
  {
    title: "#16 active 사용자의 기존 수정 권한은 그대로다 — AUTH-06, AUTH-04, TRN-08",
    actors: {
      "학생(본인)": asUser(STUDENT),
      "트레이너(본인)": asUser(TRAINER),
      "pending 트레이너(본인)": asUser(PENDING),
      "신규 트레이너(본인)": asUser(NEW_USER_ID),
    },
    cases: {
      "users.nickname:학생": { update: updateNickname(STUDENT) },
      "users.profile_image_url:학생": { update: updateUserColumn(STUDENT, "profile_image_url") },
      "users.nickname:트레이너": { update: updateNickname(TRAINER) },
      "trainer_profiles:트레이너": { update: updateProfileContent(TRAINER) },
      "trainer_profiles:신규 트레이너(프로필 없음)": {
        insert: insertProfile(NEW_USER_ID, createTrainerUser("active")),
      },
      "trainer_genres:트레이너": {
        insert: insertGenre(TRAINER),
        delete: deleteGenre(TRAINER, 1),
      },
      "trainer_business_profiles:pending 트레이너": { update: updateBusiness(PENDING) },
      "trainer_business_profiles:pending 트레이너(행 없음)": {
        insert: insertBusiness(PENDING, removeBusinessProfile(PENDING)),
      },
    },
    rows: [
      // 역할                      테이블                                                select   insert   update   delete
      ["학생(본인)", "users.nickname:학생", "-", "-", "allow", "-"],
      ["학생(본인)", "users.profile_image_url:학생", "-", "-", "allow", "-"],
      ["트레이너(본인)", "users.nickname:트레이너", "-", "-", "allow", "-"],
      ["트레이너(본인)", "trainer_profiles:트레이너", "-", "-", "allow", "-"],
      [
        "신규 트레이너(본인)",
        "trainer_profiles:신규 트레이너(프로필 없음)",
        "-",
        "allow",
        "-",
        "-",
      ],
      ["트레이너(본인)", "trainer_genres:트레이너", "-", "allow", "-", "allow"],
      [
        "pending 트레이너(본인)",
        "trainer_business_profiles:pending 트레이너",
        "-",
        "-",
        "allow",
        "-",
      ],
      [
        "pending 트레이너(본인)",
        "trainer_business_profiles:pending 트레이너(행 없음)",
        "-",
        "allow",
        "-",
        "-",
      ],
    ],
  },
  { db: getDb },
);

// ===========================================================================
// 서버(service_role)는 탈퇴 사용자 행을 고칠 수 있다 (AUTH-08) — 탈퇴·삭제 처리용
// ===========================================================================

describe("#16 서버(service_role)는 탈퇴 사용자 행을 고칠 수 있다 — AUTH-08", () => {
  const server: Actor = service;

  it.each<[string, OpCase]>([
    ["users.nickname (탈퇴 학생)", updateNickname(STUDENT, withdrawnStudent)],
    [
      "users.profile_image_url (탈퇴 학생)",
      updateUserColumn(STUDENT, "profile_image_url", withdrawnStudent),
    ],
    ["trainer_profiles 내용 (탈퇴 트레이너)", updateProfileContent(TRAINER, withdrawnTrainer)],
    [
      "trainer_profiles.listed (탈퇴 트레이너)",
      {
        sql: `update public.trainer_profiles set listed = false where user_id = $1`,
        params: [TRAINER],
        setup: withdrawnTrainer,
      },
    ],
    [
      "trainer_business_profiles (탈퇴 pending 트레이너)",
      updateBusiness(PENDING, withdrawnPending),
    ],
    [
      "user_account_records.withdrawn_at·purge_after (탈퇴 학생)",
      {
        sql: `update public.user_account_records
              set withdrawn_at = now(), purge_after = now() + interval '6 months'
              where user_id = $1`,
        params: [STUDENT],
        setup: withdrawnStudent,
      },
    ],
  ])("서버 × %s × update → 허용", async (_, opCase) => {
    expect(await attempt(db, server, "update", opCase)).toBe("allow");
  });

  it("서버 × trainer_genres (탈퇴 트레이너) × delete → 허용", async () => {
    expect(await attempt(db, server, "delete", deleteGenre(TRAINER, 1, withdrawnTrainer))).toBe(
      "allow",
    );
  });

  it("서버 × trainer_genres (탈퇴 트레이너) × insert → 허용", async () => {
    expect(await attempt(db, server, "insert", insertGenre(TRAINER, withdrawnTrainer))).toBe(
      "allow",
    );
  });

  it("서버 × trainer_profiles (탈퇴 신규 트레이너) × insert → 허용", async () => {
    expect(
      await attempt(
        db,
        server,
        "insert",
        insertProfile(NEW_USER_ID, createTrainerUser("withdrawn")),
      ),
    ).toBe("allow");
  });

  it("서버 × users.status (탈퇴 학생) × update → 허용", async () => {
    expect(
      await attempt(db, server, "update", {
        sql: `update public.users set status = 'active' where id = $1`,
        params: [STUDENT],
        setup: withdrawnStudent,
      }),
    ).toBe("allow");
  });
});

// ===========================================================================
// 준비 작업 확인: setup이 실제로 상태를 만들었는지 (차단 칸이 엉뚱한 이유로 통과하지 않게)
// ===========================================================================

describe("#16 준비 작업이 의도한 상태를 만든다 — AUTH-07", () => {
  it.each([
    ["탈퇴 학생", STUDENT, withdrawnStudent],
    ["탈퇴 트레이너", TRAINER, withdrawnTrainer],
    ["탈퇴 pending 트레이너", PENDING, withdrawnPending],
    ["탈퇴 신규 트레이너", NEW_USER_ID, createTrainerUser("withdrawn")],
  ])("%s의 users.status는 withdrawn이다", async (_, id, setup) => {
    const rows = await withActor(
      db,
      service,
      async (tx) =>
        (await tx.query<{ status: string }>(`select status from public.users where id = $1`, [id]))
          .rows,
      { setup },
    );
    expect(rows).toEqual([{ status: "withdrawn" }]);
  });

  it("사업자 정보 행 없음 준비는 그 트레이너의 행을 지운다", async () => {
    const rows = await withActor(
      db,
      service,
      async (tx) =>
        (
          await tx.query(`select 1 from public.trainer_business_profiles where trainer_id = $1`, [
            PENDING,
          ])
        ).rows,
      { setup: removeBusinessProfile(PENDING) },
    );
    expect(rows).toEqual([]);
  });
});
