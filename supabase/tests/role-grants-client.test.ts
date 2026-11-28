// 이슈 #59 QA 독립 검증: 20261123120000_explicit_role_grants.sql이 클라이언트 권한과 함수 실행 권한을 바꾸지 않는다.
//
// - 클라이언트(anon·authenticated)의 테이블·컬럼 권한, RLS, 정책은 이 마이그레이션 전후로 같다. 바뀌는 것은 public
//   시퀀스 권한 회수뿐이다.
// - 시퀀스 권한 회수가 클라이언트 insert를 깨지 않는다: identity·serial(nextval) 기본값 컬럼이 있는 테이블에
//   anon·authenticated의 insert·update 권한이 없다.
// - public·private 함수의 실행 권한은 이 마이그레이션 전후, 옛·새 기본 권한에서 모두 같다.
// 옛 기본 권한 = supabase-shim.sql 그대로, 새 기본 권한 = shim에서 테이블·시퀀스 기본 권한 줄을 뺀 것(role-grants.test.ts와 같다).
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SUPABASE_DIR, migrationFiles } from "./helpers/db.ts";

const TARGET = "20261123120000_explicit_role_grants.sql";
const LEGACY_SHIM = readFileSync(join(SUPABASE_DIR, "tests", "supabase-shim.sql"), "utf8");
const NEW_SHIM = LEGACY_SHIM.replace(
  /^alter default privileges in schema public grant all on (tables|sequences) .*$/gm,
  "",
);

async function migratedDb(shim: string, options: { withTarget: boolean }): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(shim);
  for (const path of migrationFiles()) {
    if (!options.withTarget && basename(path) === TARGET) continue;
    await db.exec(readFileSync(path, "utf8"));
  }
  return db;
}

/** anon·authenticated의 테이블·컬럼 권한, RLS 켜짐, 정책 (시퀀스 제외) */
async function clientSurface(db: PGlite): Promise<string[]> {
  const { rows } = await db.query<{ g: string }>(`
    select 'table ' || grantee || ' ' || table_schema || '.' || table_name || ' ' || privilege_type as g
    from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated') and table_schema in ('public', 'private', 'auth')
    union all
    select 'column ' || grantee || ' ' || table_schema || '.' || table_name || '.' || column_name || ' ' || privilege_type
    from information_schema.column_privileges
    where grantee in ('anon', 'authenticated') and table_schema in ('public', 'private', 'auth')
    union all
    select 'rls ' || c.relname || ' ' || c.relrowsecurity || ' ' || c.relforcerowsecurity
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
    union all
    select 'policy ' || tablename || ' ' || policyname || ' ' || cmd || ' ' || array_to_string(roles, ',')
      || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '')
    from pg_policies where schemaname = 'public'
    order by 1
  `);
  return rows.map((row) => row.g);
}

/** 세 역할의 public·private 함수 실행 권한 */
async function functionExec(db: PGlite): Promise<string[]> {
  const { rows } = await db.query<{ g: string }>(`
    select r || ' ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') '
      || has_function_privilege(r, p.oid, 'EXECUTE') as g
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join unnest(array['anon', 'authenticated', 'service_role']) r
    where n.nspname in ('public', 'private')
    order by 1
  `);
  return rows.map((row) => row.g);
}

let legacyBefore: PGlite;
let legacyAfter: PGlite;
let newBefore: PGlite;
let newAfter: PGlite;

beforeAll(async () => {
  [legacyBefore, legacyAfter, newBefore, newAfter] = await Promise.all([
    migratedDb(LEGACY_SHIM, { withTarget: false }),
    migratedDb(LEGACY_SHIM, { withTarget: true }),
    migratedDb(NEW_SHIM, { withTarget: false }),
    migratedDb(NEW_SHIM, { withTarget: true }),
  ]);
});

afterAll(async () => {
  await Promise.all([legacyBefore, legacyAfter, newBefore, newAfter].map((db) => db?.close()));
});

describe("#59 explicit_role_grants는 클라이언트 권한을 넓히지 않는다 — QA 검증", () => {
  it("검증 대상 마이그레이션 파일이 있다 (짝: 아래 비교가 의미 있으려면 전후가 달라야 한다)", () => {
    expect(migrationFiles().map((path) => basename(path))).toContain(TARGET);
  });

  it("옛 기본 권한에서 anon·authenticated의 테이블·컬럼 권한, RLS, 정책이 마이그레이션 전후로 같다", async () => {
    const [before, after] = await Promise.all([
      clientSurface(legacyBefore),
      clientSurface(legacyAfter),
    ]);
    expect(after.length).toBeGreaterThan(0);
    expect(after).toEqual(before);
  });

  it("새 기본 권한에서 적용한 결과의 클라이언트 권한은 옛 기본 권한에서 적용한 결과와 같다", async () => {
    expect(await clientSurface(newAfter)).toEqual(await clientSurface(legacyAfter));
  });

  it("마이그레이션 전 옛 기본 권한에서는 anon·authenticated에 public 시퀀스 권한이 있었다 (회수 검사의 짝)", async () => {
    const { rows } = await legacyBefore.query(
      `select 1 from pg_class c cross join lateral aclexplode(c.relacl) p
       join pg_roles r on r.oid = p.grantee
       where c.relkind = 'S' and c.relnamespace = 'public'::regnamespace
         and r.rolname in ('anon', 'authenticated')`,
    );
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe("#59 시퀀스 권한 회수가 클라이언트 insert를 깨지 않는다 — QA 검증", () => {
  type Row = { table_name: string; column_name: string; role: string; ins: boolean; upd: boolean };

  it("identity·serial(nextval) 기본값 컬럼이 있는 public 테이블이 있다 (짝)", async () => {
    const { rows } = await legacyAfter.query(
      `select 1 from information_schema.columns
       where table_schema = 'public' and (is_identity = 'YES' or column_default like 'nextval(%')`,
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it("그 테이블들에 anon·authenticated의 insert·update 권한(테이블·컬럼)이 없다", async () => {
    for (const db of [legacyAfter, newAfter]) {
      const { rows } = await db.query<Row>(`
        select c.table_name, c.column_name, r as role,
               has_any_column_privilege(r, format('public.%I', c.table_name), 'insert') as ins,
               has_any_column_privilege(r, format('public.%I', c.table_name), 'update') as upd
        from information_schema.columns c
        cross join unnest(array['anon', 'authenticated']) r
        where c.table_schema = 'public' and (c.is_identity = 'YES' or c.column_default like 'nextval(%')
      `);
      expect(rows.filter((row) => row.ins || row.upd)).toEqual([]);
    }
  });
});

describe("#59 함수 실행 권한은 바뀌지 않는다 — QA 검증", () => {
  it("public·private 함수 실행 권한이 마이그레이션 전후로 같다(옛 기본 권한)", async () => {
    const [before, after] = await Promise.all([
      functionExec(legacyBefore),
      functionExec(legacyAfter),
    ]);
    expect(after.length).toBeGreaterThan(0);
    expect(after).toEqual(before);
  });

  it("public·private 함수 실행 권한이 마이그레이션 전후로 같다(새 기본 권한)", async () => {
    expect(await functionExec(newAfter)).toEqual(await functionExec(newBefore));
  });

  it("public·private 함수 실행 권한이 옛·새 기본 권한에서 같다", async () => {
    expect(await functionExec(newAfter)).toEqual(await functionExec(legacyAfter));
  });
});
