// 판정 헬퍼: QA만 고친다 (acceptance-guard, 이슈 #17). 바꿔야 하면 `[질문] 받는 역할: QA`.
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "./db.ts";
import { createTestDb, queryAs } from "./db.ts";

/**
 * RLS 권한 매트릭스 (이슈 #17)
 *
 * `역할 × 테이블 × 동작(select/insert/update/delete) → 허용/차단` 표를 데이터로 쓰면 테스트를 만든다.
 * 사용법은 supabase/README.md "RLS 권한 매트릭스".
 */

export const OPS = ["select", "insert", "update", "delete"] as const;
export type Op = (typeof OPS)[number];

/** allow = 허용, deny = 차단, "-" = 이 매트릭스에서 보지 않음 */
export type Expectation = "allow" | "deny" | "-";

export interface OpCase {
  /** 시도할 SQL 하나. 대상 행은 seed에 있는 행으로 고정한다. */
  sql: string;
  params?: unknown[];
  /** 역할을 바꾸기 전에 관리자로 실행할 준비 작업 */
  setup?: (tx: Transaction) => Promise<void>;
  /**
   * 권한 오류(42501: 권한 없음, RLS 위반)가 아닌데도 차단으로 볼 오류 메시지.
   * 예: 트리거가 raise로 막는 경우. 지정하지 않은 다른 오류(중복 키, FK 등)는 판정하지 않고 테스트를 실패시킨다.
   */
  deniedBy?: RegExp;
}

/** 테이블 → 동작 → 시도. 같은 테이블의 다른 행을 따로 보려면 키를 `테이블:설명`으로 쓴다. */
export type MatrixCases = Record<string, Partial<Record<Op, OpCase>>>;

/** [역할, 테이블, select, insert, update, delete] */
export type MatrixRow = [
  actor: string,
  table: string,
  select: Expectation,
  insert: Expectation,
  update: Expectation,
  del: Expectation,
];

export interface RlsMatrix {
  /** describe 이름. 이슈 번호와 요구사항 ID를 넣는다(요구사항 추적 센서가 읽는다). */
  title: string;
  /** 역할 이름 → 실행할 사용자 */
  actors: Record<string, Actor>;
  cases: MatrixCases;
  rows: MatrixRow[];
}

const DENIED_CODE = "42501"; // insufficient_privilege: 권한 없음, RLS 정책 위반

/**
 * actor로 시도하고 허용/차단을 판정한다. 항상 되돌린다.
 * - select: 행이 1개 이상 보이면 허용, 0개이거나 권한 오류면 차단
 * - insert/update/delete: 1행 이상 바뀌면 허용, 0행이거나 권한 오류면 차단
 * - 그 밖의 오류는 권한 때문인지 알 수 없으므로 던진다(차단으로 치지 않는다).
 */
export async function attempt(
  db: PGlite,
  actor: Actor,
  op: Op,
  opCase: OpCase,
): Promise<"allow" | "deny"> {
  try {
    const result = await queryAs(
      db,
      actor,
      opCase.sql,
      opCase.params ?? [],
      opCase.setup ? { setup: opCase.setup } : {},
    );
    const touched = op === "select" ? result.rows.length : result.affectedRows;
    return touched > 0 ? "allow" : "deny";
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    const message = error instanceof Error ? error.message : String(error);
    if (code === DENIED_CODE || opCase.deniedBy?.test(message)) return "deny";
    throw new Error(`권한 오류가 아니라서 판정할 수 없다 (${String(code)}): ${message}`, {
      cause: error,
    });
  }
}

/**
 * 값 검사·무결성 판정에서 "거부"로 보는 오류 (이슈 #28).
 * - 23xxx: 제약 위반(check, unique, FK, exclusion). 단 23502(not null)는 시도 SQL이 컬럼을 빠뜨린
 *   실수일 수 있어 거부로 치지 않는다.
 * - 42501: 권한 없음, RLS 위반
 * - P0001: 트리거·함수의 raise exception 기본 코드
 */
const REJECTED_CODE = /^(23(?!502)\d{3}|42501|P0001)$/;

/**
 * 쓰기 시도가 받아들여지는지 판정한다. 항상 되돌린다. (이슈 #28)
 * 권한 매트릭스(attempt)와 달리 제약·트리거로 막힌 것도 거부로 본다. 값 검사, 정원, 중복 같은
 * "막는 방법은 개발이 고르는" 완료 조건에 쓴다.
 * - 1행 이상 바뀌면 allow, 0행이거나 REJECTED_CODE 오류면 reject
 * - 그 밖의 오류(없는 테이블·컬럼, 문법, not null)는 판정하지 않고 던진다.
 * 거부 판정은 같은 시도의 허용되는 짝(바른 값)과 함께 쓴다. 그래야 준비 데이터가 틀려서 거부되는 것을 가린다.
 */
export async function attemptWrite(
  db: PGlite,
  actor: Actor,
  opCase: OpCase,
): Promise<"allow" | "reject"> {
  try {
    const result = await queryAs(
      db,
      actor,
      opCase.sql,
      opCase.params ?? [],
      opCase.setup ? { setup: opCase.setup } : {},
    );
    return result.affectedRows > 0 ? "allow" : "reject";
  } catch (error) {
    const code = String((error as { code?: unknown }).code);
    const message = error instanceof Error ? error.message : String(error);
    if (REJECTED_CODE.test(code) || opCase.deniedBy?.test(message)) return "reject";
    throw new Error(`제약·권한 거부가 아니라서 판정할 수 없다 (${code}): ${message}`, {
      cause: error,
    });
  }
}

/** 매트릭스가 정의되지 않은 역할·테이블·동작을 가리키면 테스트를 만들기 전에 멈춘다. */
export function validateMatrix(matrix: RlsMatrix): void {
  for (const [actor, table, ...expectations] of matrix.rows) {
    if (!(actor in matrix.actors)) throw new Error(`${matrix.title}: 정의되지 않은 역할 ${actor}`);
    const cases = matrix.cases[table];
    if (!cases) throw new Error(`${matrix.title}: 정의되지 않은 테이블 ${table}`);
    OPS.forEach((op, index) => {
      if (expectations[index] !== "-" && !cases[op]) {
        throw new Error(`${matrix.title}: ${table}의 ${op} 시도(cases)가 없다`);
      }
    });
  }
}

const LABEL = { allow: "허용", deny: "차단" } as const;

/**
 * 매트릭스의 칸마다 it 하나를 만든다. 이름: "<역할> × <테이블> × <동작> → 허용|차단"
 * db를 주지 않으면 describe 안에서 새 테스트 DB(shim → 마이그레이션 → seed)를 띄운다.
 */
export function describeRlsMatrix(matrix: RlsMatrix, options: { db?: () => PGlite } = {}): void {
  validateMatrix(matrix);
  describe(matrix.title, () => {
    let ownDb: PGlite | undefined;
    if (!options.db) {
      beforeAll(async () => {
        ownDb = await createTestDb();
      });
      afterAll(async () => {
        await ownDb?.close();
      });
    }
    const getDb = () => options.db?.() ?? (ownDb as PGlite);

    for (const [actor, table, ...expectations] of matrix.rows) {
      OPS.forEach((op, index) => {
        const expected = expectations[index];
        const opCase = matrix.cases[table]?.[op];
        if (!expected || expected === "-" || !opCase) return;
        it(`${actor} × ${table} × ${op} → ${LABEL[expected]}`, async () => {
          const actual = await attempt(getDb(), matrix.actors[actor] as Actor, op, opCase);
          expect(actual, `${actor} × ${table} × ${op}`).toBe(expected);
        });
      });
    }
  });
}
