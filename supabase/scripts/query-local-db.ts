// pnpm db:reset으로 만든 로컬 DB에 SQL을 실행한다. 실행 결과는 항상 되돌린다(rollback).
// 사용:
//   pnpm db:query "select id, nickname from public.users"                 # 관리자(postgres)
//   pnpm db:query --anon "select user_id from public.trainer_profiles"     # 로그인 안 한 상태
//   pnpm db:query --as 00000000-0000-4000-8000-000000000001 "select ..."   # 그 사용자로 로그인한 상태
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { Actor } from "../tests/helpers/db.ts";
import { SUPABASE_DIR, anon, asUser, queryAs } from "../tests/helpers/db.ts";

const dataDir = join(SUPABASE_DIR, ".pglite");
if (!existsSync(dataDir)) {
  console.error("로컬 DB가 없다. 먼저 pnpm db:reset을 실행한다.");
  process.exit(1);
}

const args = process.argv.slice(2);
let actor: Actor | undefined;
if (args[0] === "--anon") {
  actor = anon;
  args.shift();
} else if (args[0] === "--as" && args[1]) {
  actor = asUser(args[1]);
  args.splice(0, 2);
}
const sql = args.join(" ");
if (!sql) {
  console.error('사용: pnpm db:query [--anon | --as <user id>] "<SQL>"');
  process.exit(1);
}

const db = new PGlite(dataDir);
try {
  if (actor) {
    const { rows, affectedRows } = await queryAs(db, actor, sql);
    console.table(rows);
    console.log(`affectedRows: ${affectedRows} (되돌림)`);
  } else {
    await db.exec("begin");
    const result = await db.query(sql);
    await db.exec("rollback");
    console.table(result.rows);
    console.log(`affectedRows: ${result.affectedRows ?? 0} (되돌림)`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await db.close();
}
