// 인수 테스트: 이슈 #45 사용자 이용 제한 — user_restrictions 권한
// (QA가 개발 전에 쓴다. 개발은 고치지 않는다. 틀렸다고 보면 `[질문] 받는 역할: QA`)
//
// 준비 데이터와 역할은 45-fixture.ts(#41 사람 그대로, 제한G·지난G·제한T2·해제H, 운영자2·탈퇴 운영자).
// 쓰기 경로(팀장 결정 후보 2·3): 탈퇴하지 않은 운영자가 직접 쓴다. 제한하기(새 줄, restricted_by = 자기 자신,
//   lifted_* 없음)와 풀기(빈 lifted_at·lifted_by를 한 번 채움, lifted_by = 자기 자신)뿐. user_id·reason·restricted_by
//   고치기, 해제 되돌리기, 지우기 없음. 학생·트레이너·anon은 쓰지 못한다.
// 읽기(PM 질문 1): 운영자는 모두, 본인은 자기 줄(지난 줄 포함), 그 밖의 사람(그 사용자의 트레이너·학생 포함)은 못 본다.
// 권한(읽기, 동작별 허용·차단)은 RLS 매트릭스(attempt)로, 값에 따라 갈리는 운영자 쓰기는 attemptWrite로,
// 오류 코드가 갈리는지는 SQLSTATE를 그대로 돌려주는 outcome()으로 판정한다(#38).
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "../helpers/db.ts";
import { anon, asUser, queryAs } from "../helpers/db.ts";
import { attemptWrite, describeRlsMatrix } from "../helpers/rls-matrix.ts";
import type { OpCase } from "../helpers/rls-matrix.ts";
import { ALL_RS, RS, U, U45, createBundle7Db } from "./45-fixture.ts";

let db: PGlite;

beforeAll(async () => {
  db = await createBundle7Db();
});

afterAll(async () => {
  await db?.close();
});

const getDb = () => db;

const ACTORS = {
  anon,
  운영자: asUser(U.ADMIN),
  운영자2: asUser(U45.ADMIN2),
  탈퇴운영자: asUser(U45.ADMIN_W),
  학생G: asUser(U.SG),
  학생H: asUser(U.SH),
  학생A: asUser(U.SA),
  학생B: asUser(U.SB),
  T1: asUser(U.T1),
  T2: asUser(U.T2),
};

const select = (id: string): OpCase => ({
  sql: `select 1 from public.user_restrictions where id = $1`,
  params: [id],
});
/** 풀기: lifted_by = 자기 자신 */
const lift = (id: string): OpCase => ({
  sql: `update public.user_restrictions set lifted_at = now(), lifted_by = auth.uid() where id = $1`,
  params: [id],
});
const remove = (id: string): OpCase => ({
  sql: `delete from public.user_restrictions where id = $1`,
  params: [id],
});
/** 제한하기: 제한 줄이 없는 T1을 restricted_by = 자기 자신으로 */
const restrictT1: OpCase = {
  sql: `insert into public.user_restrictions (user_id, reason, restricted_by) values ($1, '#45 T1 제한', auth.uid())`,
  params: [U.T1],
};

describeRlsMatrix(
  {
    title: "#45 user_restrictions 권한 매트릭스 — ADM-04, AUTH-06, AUTH-07",
    actors: ACTORS,
    cases: {
      "user_restrictions:제한G": {
        select: select(RS.G),
        insert: restrictT1,
        update: lift(RS.G),
        delete: remove(RS.G),
      },
      "user_restrictions:지난G": { select: select(RS.G_OLD), delete: remove(RS.G_OLD) },
      "user_restrictions:제한T2": { select: select(RS.T2), update: lift(RS.T2) },
      "user_restrictions:해제H": { select: select(RS.H), delete: remove(RS.H) },
    },
    rows: [
      // 운영자: 모두 읽고, 제한하고, 푼다. 지우지 못한다
      ["운영자", "user_restrictions:제한G", "allow", "allow", "allow", "deny"],
      ["운영자", "user_restrictions:지난G", "allow", "-", "-", "deny"],
      ["운영자", "user_restrictions:제한T2", "allow", "-", "allow", "-"],
      ["운영자", "user_restrictions:해제H", "allow", "-", "-", "deny"],
      ["운영자2", "user_restrictions:제한G", "allow", "allow", "allow", "deny"],
      ["운영자2", "user_restrictions:해제H", "allow", "-", "-", "-"],
      // 탈퇴 운영자: 제한·해제를 하지 못한다 (AUTH-07)
      ["탈퇴운영자", "user_restrictions:제한G", "-", "deny", "deny", "deny"],
      ["탈퇴운영자", "user_restrictions:제한T2", "-", "-", "deny", "-"],
      // 본인: 자기 줄(지난 줄 포함)만 읽는다. 쓰지 못한다
      ["학생G", "user_restrictions:제한G", "allow", "deny", "deny", "deny"],
      ["학생G", "user_restrictions:지난G", "allow", "-", "-", "deny"],
      ["학생G", "user_restrictions:제한T2", "deny", "-", "deny", "-"],
      ["학생G", "user_restrictions:해제H", "deny", "-", "-", "-"],
      ["T2", "user_restrictions:제한T2", "allow", "-", "deny", "-"],
      ["T2", "user_restrictions:제한G", "deny", "deny", "deny", "deny"],
      ["학생H", "user_restrictions:해제H", "allow", "-", "-", "deny"],
      ["학생H", "user_restrictions:제한G", "deny", "deny", "deny", "deny"],
      // 다른 사람(학생G의 트레이너 T1, 같은 반 학생H, 학생A, 학생B, T2, anon)은 읽지 못한다
      ["T1", "user_restrictions:제한G", "deny", "deny", "deny", "deny"],
      ["T1", "user_restrictions:지난G", "deny", "-", "-", "-"],
      ["T1", "user_restrictions:제한T2", "deny", "-", "deny", "-"],
      ["학생A", "user_restrictions:제한G", "deny", "deny", "deny", "deny"],
      ["학생A", "user_restrictions:해제H", "deny", "-", "-", "-"],
      ["학생B", "user_restrictions:제한G", "deny", "deny", "deny", "deny"],
      ["학생B", "user_restrictions:제한T2", "deny", "-", "deny", "-"],
      ["anon", "user_restrictions:제한G", "deny", "deny", "deny", "deny"],
      ["anon", "user_restrictions:해제H", "deny", "-", "-", "-"],
    ],
  },
  { db: getDb },
);

describe("#45 user_restrictions 읽기 범위 — ADM-04, AUTH-06 (PM 질문 1)", () => {
  const visible = async (actor: Actor) =>
    (
      await queryAs<{ id: string }>(
        db,
        actor,
        `select id from public.user_restrictions where id = any($1) order by id`,
        [[...ALL_RS]],
      )
    ).rows.map((row) => row.id);

  it("ADM-04: 운영자는 준비 데이터의 제한 줄 4개(풀린 줄 포함)를 모두 읽는다", async () => {
    expect(await visible(ACTORS.운영자)).toEqual([...ALL_RS].sort());
  });

  it("ADM-04: 학생G는 준비 데이터 중 자기 줄(제한G·지난G)만 읽는다", async () => {
    expect(await visible(ACTORS.학생G)).toEqual([RS.G, RS.G_OLD].sort());
  });

  it("ADM-04: 학생G가 읽는 줄은 모두 자기 줄이다(seed 줄 포함 전체 조회)", async () => {
    const { rows } = await queryAs<{ user_id: string }>(
      db,
      ACTORS.학생G,
      `select distinct user_id from public.user_restrictions`,
    );
    expect(rows).toEqual([{ user_id: U.SG }]);
  });

  it.each<[string, Actor]>([
    ["T1(학생G의 트레이너)", ACTORS.T1],
    ["학생A(제한 없음)", ACTORS.학생A],
    ["학생B", ACTORS.학생B],
  ])("AUTH-06: 제한 줄이 없는 %s는 어떤 제한 줄도 읽지 못한다", async (_, actor) => {
    const { rows } = await queryAs(db, actor, `select 1 from public.user_restrictions`);
    expect(rows).toEqual([]);
  });

  it("AUTH-06: 학생G가 읽는 제한 줄의 컬럼(사유·제한 시각·해제 시각)이 보인다", async () => {
    const { rows } = await queryAs<{ reason: string; created_at: unknown; lifted_at: unknown }>(
      db,
      ACTORS.학생G,
      `select reason, created_at, lifted_at from public.user_restrictions where id = $1`,
      [RS.G_OLD],
    );
    expect(rows.length).toBe(1);
    expect(rows[0]?.reason).toBe("#45 학생G 지난 제한");
    expect(rows[0]?.lifted_at).not.toBeNull();
  });
});

// ===========================================================================
// 운영자 쓰기 (값에 따라 갈린다)
// ===========================================================================

const admin = ACTORS.운영자;
const write = (actor: Actor, sql: string, params: unknown[] = []) =>
  attemptWrite(db, actor, { sql, params });

describe("#45 운영자의 제한하기 — ADM-04 (팀장 결정 후보 2)", () => {
  const insert = (userId: string, restrictedBy: string, lifted = false) =>
    write(
      admin,
      `insert into public.user_restrictions (user_id, reason, restricted_by, lifted_at, lifted_by)
       values ($1, '#45 제한', $2, ${lifted ? "now()" : "null"}, ${lifted ? "$2" : "null"})`,
      [userId, restrictedBy],
    );

  it("ADM-04: 운영자가 트레이너 T1을 restricted_by = 자기 자신으로 제한한다", async () => {
    expect(await insert(U.T1, U.ADMIN)).toBe("allow");
  });

  it("ADM-04: 운영자가 학생A를 restricted_by = 자기 자신으로 제한한다", async () => {
    expect(await insert(U.SA, U.ADMIN)).toBe("allow");
  });

  it("ADM-04: 운영자가 해제H만 있는 학생H를 다시 제한한다", async () => {
    expect(await insert(U.SH, U.ADMIN)).toBe("allow");
  });

  it("ADM-04: 운영자가 restricted_by에 다른 운영자(운영자2) id를 넣지 못한다", async () => {
    expect(await insert(U.T1, U45.ADMIN2)).toBe("reject");
  });

  it("ADM-04: 운영자가 처음부터 풀린 줄(lifted_at·lifted_by 있음)을 넣지 못한다", async () => {
    expect(await insert(U.T1, U.ADMIN, true)).toBe("reject");
  });

  it("ADM-04: 운영자가 제한G가 있는 학생G를 또 제한하지 못한다", async () => {
    expect(await insert(U.SG, U.ADMIN)).toBe("reject");
  });

  it("ADM-04: 운영자가 다른 운영자(운영자2)를 제한하지 못한다", async () => {
    expect(await insert(U45.ADMIN2, U.ADMIN)).toBe("reject");
  });

  it("ADM-04: 운영자가 reason이 빈 제한 줄을 넣지 못한다", async () => {
    expect(
      await write(
        admin,
        `insert into public.user_restrictions (user_id, reason, restricted_by) values ($1, '', auth.uid())`,
        [U.T1],
      ),
    ).toBe("reject");
  });
});

describe("#45 운영자의 풀기 — ADM-04 (팀장 결정 후보 3)", () => {
  const update = (actor: Actor, id: string, set: string) =>
    write(actor, `update public.user_restrictions set ${set} where id = $1`, [id]);

  it("ADM-04: 운영자가 제한T2를 lifted_by = 자기 자신으로 푼다", async () => {
    expect(await update(admin, RS.T2, `lifted_at = now(), lifted_by = auth.uid()`)).toBe("allow");
  });

  it("ADM-04: 운영자2가 운영자가 건 제한G를 푼다(제한한 운영자가 아니어도 된다)", async () => {
    expect(await update(ACTORS.운영자2, RS.G, `lifted_at = now(), lifted_by = auth.uid()`)).toBe(
      "allow",
    );
  });

  it("ADM-04: 운영자가 lifted_by에 다른 운영자(운영자2) id를 넣어 풀지 못한다", async () => {
    expect(await update(admin, RS.T2, `lifted_at = now(), lifted_by = '${U45.ADMIN2}'`)).toBe(
      "reject",
    );
  });

  it("ADM-04: 운영자가 lifted_at만 채우지 못한다", async () => {
    expect(await update(admin, RS.T2, `lifted_at = now()`)).toBe("reject");
  });

  it("ADM-04: 운영자가 풀린 해제H를 다시 고치지 못한다(lifted_at·lifted_by 다시 채우기)", async () => {
    expect(await update(admin, RS.H, `lifted_at = now(), lifted_by = auth.uid()`)).toBe("reject");
  });

  it("ADM-04: 운영자가 해제H의 해제를 되돌리지 못한다(lifted_* 비우기)", async () => {
    expect(await update(admin, RS.H, `lifted_at = null, lifted_by = null`)).toBe("reject");
  });

  it.each([
    ["user_id", `user_id = '${U.T1}'`],
    ["reason", `reason = '#45 고친 사유'`],
    ["restricted_by", `restricted_by = '${U45.ADMIN2}'`],
    ["created_at", `created_at = now()`],
  ])("ADM-04: 운영자가 제한G의 %s를 고치지 못한다", async (_, set) => {
    expect(await update(admin, RS.G, set)).toBe("reject");
  });

  it("ADM-04: 운영자가 풀면서 reason을 함께 고치지 못한다", async () => {
    expect(
      await update(admin, RS.T2, `lifted_at = now(), lifted_by = auth.uid(), reason = '#45 고침'`),
    ).toBe("reject");
  });

  it.each([
    ["제한G", RS.G],
    ["해제H", RS.H],
  ])("ADM-04: 운영자가 %s를 지우지 못한다", async (_, id) => {
    expect(await write(admin, `delete from public.user_restrictions where id = $1`, [id])).toBe(
      "reject",
    );
  });

  it("ADM-04: 학생G는 자기 제한G를 lifted_by = 운영자로 채워 풀지 못한다", async () => {
    expect(await update(ACTORS.학생G, RS.G, `lifted_at = now(), lifted_by = '${U.ADMIN}'`)).toBe(
      "reject",
    );
  });

  it("ADM-04: T2는 자기 제한T2의 reason을 고치지 못한다", async () => {
    expect(await update(ACTORS.T2, RS.T2, `reason = '#45 T2가 고침'`)).toBe("reject");
  });
});

describe("#45 탈퇴 운영자는 제한·해제를 하지 못한다 — AUTH-07", () => {
  it("AUTH-07: 탈퇴 운영자가 T1을 restricted_by = 자기 자신으로 제한하지 못한다", async () => {
    expect(
      await write(
        ACTORS.탈퇴운영자,
        `insert into public.user_restrictions (user_id, reason, restricted_by) values ($1, '#45 탈퇴', auth.uid())`,
        [U.T1],
      ),
    ).toBe("reject");
  });

  it("AUTH-07: 탈퇴 운영자가 제한T2를 lifted_by = 자기 자신으로 풀지 못한다", async () => {
    expect(
      await write(
        ACTORS.탈퇴운영자,
        `update public.user_restrictions set lifted_at = now(), lifted_by = auth.uid() where id = $1`,
        [RS.T2],
      ),
    ).toBe("reject");
  });
});

// ===========================================================================
// 권한 없는 insert는 대상과 값에 관계없이 같은 코드 42501 (#38)
// ===========================================================================

/**
 * actor로 쓰기를 시도하고 결과를 돌려준다. 항상 되돌린다.
 * 1행 이상 바뀌면 "허용", 0행이면 "0행", 오류면 SQLSTATE(예: "42501", "23514").
 */
async function outcome(actor: Actor, text: string, params: unknown[] = []): Promise<string> {
  try {
    const result = await queryAs(db, actor, text, params);
    return result.affectedRows > 0 ? "허용" : "0행";
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
    throw error;
  }
}

const insertSql = `insert into public.user_restrictions (user_id, reason, restricted_by, lifted_at, lifted_by)
  values ($1, $2, $3, $4, $5)`;

/** [대상 변형 설명, user_id, reason, restricted_by(null이면 본인), lifted_at, lifted_by] */
const VARIANTS: [string, string, string, string | null, string | null, string | null][] = [
  ["바른 값(대상 T1, restricted_by = 운영자)", U.T1, "#45", U.ADMIN, null, null],
  ["restricted_by = 본인", U.T1, "#45", null, null, null],
  ["대상이 운영자", U.ADMIN, "#45", U.ADMIN, null, null],
  ["대상이 이미 제한 중인 학생G", U.SG, "#45", U.ADMIN, null, null],
  ["대상이 해제H만 있는 학생H", U.SH, "#45", U.ADMIN, null, null],
  ["대상이 본인", "self", "#45", U.ADMIN, null, null],
  ["reason이 빈 값", U.T1, "", U.ADMIN, null, null],
  ["lifted_at만 있음", U.T1, "#45", U.ADMIN, "2026-11-20 10:00:00+09", null],
  ["처음부터 풀린 줄", U.T1, "#45", U.ADMIN, "2026-11-20 10:00:00+09", U.ADMIN],
  ["restricted_by가 학생A", U.T1, "#45", U.SA, null, null],
];

const OUTSIDERS: [string, string][] = [
  ["학생A(제한 없음)", U.SA],
  ["학생G(제한 중)", U.SG],
  ["T1(트레이너)", U.T1],
  ["T2(제한 중인 트레이너)", U.T2],
];

describe("#45 학생·트레이너·anon의 제한 줄 insert는 대상·값과 관계없이 42501 — ADM-04, #38 (팀장 결정 후보 2)", () => {
  const cases = OUTSIDERS.flatMap(([who, id]) =>
    VARIANTS.map(
      ([what, target, reason, by, liftedAt, liftedBy]) =>
        [
          who,
          what,
          id,
          [target === "self" ? id : target, reason, by ?? id, liftedAt, liftedBy],
        ] as [string, string, string, unknown[]],
    ),
  );

  it.each(cases)("ADM-04: %s × %s → 42501", async (_, __, id, params) => {
    expect(await outcome(asUser(id), insertSql, params)).toBe("42501");
  });

  it.each(VARIANTS)(
    "ADM-04: anon × %s → 42501",
    async (_, target, reason, by, liftedAt, liftedBy) => {
      const params = [target === "self" ? U.SA : target, reason, by ?? U.SA, liftedAt, liftedBy];
      expect(await outcome(anon, insertSql, params)).toBe("42501");
    },
  );

  it("ADM-04: 운영자의 바른 insert는 허용된다 (짝: 같은 SQL·값)", async () => {
    expect(await outcome(admin, insertSql, [U.T1, "#45", U.ADMIN, null, null])).toBe("허용");
  });
});
