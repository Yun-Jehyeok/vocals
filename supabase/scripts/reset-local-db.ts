// 빈 로컬 DB(PGlite, supabase/.pglite/)를 새로 만들고 shim → 마이그레이션 전체 → seed를 적용한다.
// 사용: pnpm db:reset
import { rmSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { SUPABASE_DIR, applyAll, migrationFiles } from "../tests/helpers/db.ts";

export const LOCAL_DB_DIR = join(SUPABASE_DIR, ".pglite");

rmSync(LOCAL_DB_DIR, { recursive: true, force: true });
const db = new PGlite(LOCAL_DB_DIR);
await applyAll(db);

const { rows } = await db.query<{ table_name: string; row_count: number }>(
  `select c.relname as table_name,
          (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text::int as row_count
   from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
   order by 1`,
);
await db.close();

console.log(`마이그레이션 ${migrationFiles().length}개와 seed를 적용했다: ${LOCAL_DB_DIR}`);
console.table(rows);
