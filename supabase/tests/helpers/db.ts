import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import type { Transaction } from "@electric-sql/pglite";

/** supabase/ 디렉터리 */
export const SUPABASE_DIR = fileURLToPath(new URL("../..", import.meta.url));

const SHIM_PATH = join(SUPABASE_DIR, "tests", "supabase-shim.sql");
const MIGRATIONS_DIR = join(SUPABASE_DIR, "migrations");
const SEED_PATH = join(SUPABASE_DIR, "seed.sql");

/** supabase/migrations/의 SQL 파일을 파일 이름(타임스탬프) 순서로 돌려준다. */
export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => join(MIGRATIONS_DIR, name));
}

async function execFile(db: PGlite, path: string): Promise<void> {
  try {
    await db.exec(readFileSync(path, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${path} 적용 실패: ${message}`, { cause: error });
  }
}

/** 빈 DB에 Supabase shim → 마이그레이션 전체 → seed 순서로 적용한다. */
export async function applyAll(db: PGlite, options: { seed?: boolean } = {}): Promise<void> {
  await execFile(db, SHIM_PATH);
  for (const path of migrationFiles()) {
    await execFile(db, path);
  }
  if (options.seed ?? true) {
    await execFile(db, SEED_PATH);
  }
}

/** 메모리 안의 새 Postgres(PGlite)에 마이그레이션과 seed를 적용해 돌려준다. */
export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();
  await applyAll(db);
  return db;
}

/**
 * 누구로 실행할지.
 * - anon: 로그인하지 않은 앱 사용자
 * - user: 그 사용자로 로그인한 앱 사용자 (authenticated 역할 + JWT sub)
 * - service: 서버 함수(service role key). RLS를 거치지 않는다.
 */
export type Actor = { kind: "anon" } | { kind: "user"; id: string } | { kind: "service" };

export const anon: Actor = { kind: "anon" };
export const service: Actor = { kind: "service" };
export const asUser = (id: string): Actor => ({ kind: "user", id });

function roleAndClaims(actor: Actor): { role: string; claims: Record<string, string> } {
  switch (actor.kind) {
    case "anon":
      return { role: "anon", claims: { role: "anon" } };
    case "user":
      return { role: "authenticated", claims: { role: "authenticated", sub: actor.id } };
    case "service":
      return { role: "service_role", claims: { role: "service_role" } };
  }
}

export interface WithActorOptions {
  /** 역할을 바꾸기 전에 관리자(postgres)로 실행할 준비 작업. 예: 새 사용자 만들기 */
  setup?: (tx: Transaction) => Promise<void>;
}

/**
 * actor로 fn을 실행하고, 결과와 상관없이 트랜잭션을 되돌린다.
 * 그래서 테스트끼리 seed 데이터가 바뀌지 않는다.
 */
export async function withActor<T>(
  db: PGlite,
  actor: Actor,
  fn: (tx: Transaction) => Promise<T>,
  options: WithActorOptions = {},
): Promise<T> {
  const { role, claims } = roleAndClaims(actor);
  let result: T | undefined;
  let failure: unknown;
  let failed = false;
  await db.transaction(async (tx) => {
    try {
      if (options.setup) await options.setup(tx);
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      await tx.exec(`set local role ${role}`);
      result = await fn(tx);
    } catch (error) {
      failed = true;
      failure = error;
    }
    await tx.rollback();
  });
  if (failed) throw failure;
  return result as T;
}

/** actor로 SQL 하나를 실행하고 행을 돌려준다. 항상 되돌린다. */
export async function queryAs<R = Record<string, unknown>>(
  db: PGlite,
  actor: Actor,
  sql: string,
  params: unknown[] = [],
  options: WithActorOptions = {},
): Promise<{ rows: R[]; affectedRows: number }> {
  return withActor(
    db,
    actor,
    async (tx) => {
      const result = await tx.query<R>(sql, params);
      return { rows: result.rows, affectedRows: result.affectedRows ?? 0 };
    },
    options,
  );
}
