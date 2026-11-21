// 인수 테스트: 이슈 #32에 포함된 #31 — 끝난 수강권의 반 배정 해제·이동 막기
// (QA가 개발 전에 쓴다. 개발은 고치지 않는다. 틀렸다고 보면 `[질문] 받는 역할: QA`)
//
// 준비 데이터는 #28의 28-fixture.ts를 그대로 쓴다(묶음 3 테이블이 없어도 돈다).
//   TK.CG = 학생C의 그룹 수강권 ended(expired), 반 GC.T1_FULL 배정
//   TK.AG1 = 학생A의 그룹 수강권 active, 반 GC.T1_FULL 배정 / TK.D·TK.AG2 = waiting_schedule, 미배정
// 근거: #28 팀장 결정 8(배정된 반은 지우지 못한다 = 배정 기록 보존), #31 팀장 결정 A.
// "새 마이그레이션으로만 고친다"는 check:migrations(CI)가 본다.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "../helpers/db.ts";
import { anon, asUser, service, withActor } from "../helpers/db.ts";
import { attemptWrite } from "../helpers/rls-matrix.ts";
import type { OpCase } from "../helpers/rls-matrix.ts";
import type { Setup } from "./28-fixture.ts";
import { GC, TK, U, assign, createBundle2Db } from "./28-fixture.ts";

let db: PGlite;

beforeAll(async () => {
  db = await createBundle2Db();
});

afterAll(async () => {
  await db?.close();
});

const t1 = asUser(U.T1);

const setClass = (ticketId: string, groupClassId: string | null, setup?: Setup): OpCase => ({
  sql: `update public.tickets set group_class_id = $2 where id = $1`,
  params: [ticketId, groupClassId],
  ...(setup ? { setup } : {}),
});

/** 학생A의 active 수강권을 빈 반으로 옮겨, GC.T1_FULL에 학생C의 끝난 수강권만 남긴다 */
const onlyEndedInFull = assign(TK.AG1, GC.T1_EMPTY);

describe("#31 트레이너는 끝난 수강권의 반 배정을 바꾸지 못한다 — TRN-04, #28 팀장 결정 8", () => {
  it("TRN-04: T1 × 학생C의 ended 수강권 group_class_id → null → 거부", async () => {
    expect(await attemptWrite(db, t1, setClass(TK.CG, null))).toBe("reject");
  });

  it("TRN-04: T1 × 학생C의 ended 수강권 → 다른 자기 반(빈 반) → 거부", async () => {
    expect(await attemptWrite(db, t1, setClass(TK.CG, GC.T1_EMPTY))).toBe("reject");
  });

  it("TRN-04: T1 × 끝난 수강권만 남은 반의 ended 수강권 → null → 거부", async () => {
    expect(await attemptWrite(db, t1, setClass(TK.CG, null, onlyEndedInFull))).toBe("reject");
  });

  it.each<[string, Actor]>([
    ["T2", asUser(U.T2)],
    ["학생C", asUser(U.SC)],
    ["anon", anon],
  ])("TRN-04: %s × 학생C의 ended 수강권 → null → 거부", async (_, actor) => {
    expect(await attemptWrite(db, actor, setClass(TK.CG, null))).toBe("reject");
  });
});

describe("#31 트레이너는 끝나지 않은 수강권의 배정을 지금처럼 바꾼다 — TRN-04, #28", () => {
  it.each<[string, OpCase]>([
    ["active 수강권(학생A) → null (배정 해제)", setClass(TK.AG1, null)],
    ["active 수강권(학생A) → 다른 자기 반(빈 반)", setClass(TK.AG1, GC.T1_EMPTY)],
    ["waiting_schedule 수강권(학생D) → 빈 반", setClass(TK.D, GC.T1_EMPTY)],
    [
      "waiting_schedule 수강권(학생A 재결제, 빈 반 배정됨) → null",
      setClass(TK.AG2, null, assign(TK.AG2, GC.T1_EMPTY)),
    ],
  ])("TRN-04: T1 × %s → 허용", async (_, opCase) => {
    expect(await attemptWrite(db, t1, opCase)).toBe("allow");
  });
});

describe("#31 서버는 끝난 수강권의 배정을 바꿀 수 있다 — TRN-04, #31", () => {
  it("TRN-04: 서버 × 학생C의 ended 수강권 group_class_id → null → 허용", async () => {
    expect(await attemptWrite(db, service, setClass(TK.CG, null))).toBe("allow");
  });
});

describe("#31 끝난 수강권만 배정된 반은 계속 지울 수 없다(배정 해제 우회 포함) — TRN-04, #28 팀장 결정 8", () => {
  it("TRN-04: T1 × 끝난 수강권만 배정된 반 삭제 → 거부", async () => {
    expect(
      await attemptWrite(db, t1, {
        sql: `delete from public.group_classes where id = $1`,
        params: [GC.T1_FULL],
        setup: onlyEndedInFull,
      }),
    ).toBe("reject");
  });

  it("TRN-04: T1 × ended 수강권 배정 해제를 시도한 뒤 그 반 삭제 → 반이 남는다", async () => {
    // 한 트랜잭션 안에서 T1이 차례로 시도한다. 각 단계의 오류는 savepoint로 되돌리고 다음 단계로 간다.
    const result = await withActor(
      db,
      t1,
      async (tx) => {
        const step = async (sql: string, params: unknown[]) => {
          await tx.exec("savepoint step");
          try {
            const { affectedRows } = await tx.query(sql, params);
            await tx.exec("release savepoint step");
            return affectedRows ?? 0;
          } catch {
            await tx.exec("rollback to savepoint step");
            return 0;
          }
        };
        const unassigned = await step(
          `update public.tickets set group_class_id = null where id = $1`,
          [TK.CG],
        );
        const deleted = await step(`delete from public.group_classes where id = $1`, [GC.T1_FULL]);
        return { unassigned, deleted };
      },
      { setup: onlyEndedInFull },
    );
    expect(result).toEqual({ unassigned: 0, deleted: 0 });
  });

  it("준비 작업: 학생A를 옮기면 GC.T1_FULL에는 학생C의 ended 수강권만 남는다", async () => {
    const rows = await withActor(
      db,
      service,
      async (tx) =>
        (
          await tx.query(
            `select id, status::text as status from public.tickets where group_class_id = $1`,
            [GC.T1_FULL],
          )
        ).rows,
      { setup: onlyEndedInFull },
    );
    expect(rows).toEqual([{ id: TK.CG, status: "ended" }]);
  });
});
