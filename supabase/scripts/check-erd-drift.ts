// ERD 드리프트 센서 (이슈 #17)
//
// docs/erd.md의 mermaid erDiagram에서 테이블·컬럼·enum 값을 읽고,
// 빈 PGlite에 shim → 마이그레이션을 적용한 실제 public 스키마와 비교한다.
//   - 마이그레이션에 있는 테이블: 컬럼 이름 집합, enum 값, enum 타입 이름(<테이블>_<컬럼>)이 같아야 한다
//   - 마이그레이션에만 있는 테이블: 실패
//   - erd에만 있는 테이블: "미구현"으로 출력만
//
// 사용: pnpm check:erd-drift  (supabase/에서는 pnpm check:erd-drift)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { SUPABASE_DIR, applyAll } from "../tests/helpers/db.ts";

export const ERD_PATH = join(SUPABASE_DIR, "..", "docs", "erd.md");

/**
 * 임시 예외: erd와 다른 것을 알고 있고 기획에 질문한 테이블 → 사유(이슈·질문 링크).
 * 답이 나와 문서나 마이그레이션이 고쳐지면 지운다. 차이가 없어졌는데 남아 있으면 실패한다.
 */
export const ERD_DRIFT_EXCEPTIONS: Readonly<Record<string, string>> = {};

export interface ErdTable {
  name: string;
  /** 다이어그램에 적은 컬럼 + 생략된 id·created_at (erd.md 표기 규칙) */
  columns: string[];
  /** enum 컬럼 → 값. 주석에서 값을 읽을 수 없으면 null */
  enums: Record<string, string[] | null>;
}

export interface ActualColumn {
  name: string;
  /** enum이면 타입 이름과 값 */
  enumType?: { name: string; labels: string[] };
  typeName: string;
}

export interface ActualTable {
  name: string;
  columns: ActualColumn[];
}

const ENTITY_START = /^\s*([a-z_][a-z0-9_]*)\s*\{\s*$/;
const ENTITY_END = /^\s*\}\s*$/;
const ATTRIBUTE =
  /^\s*(\w+)\s+(\w+)(?:\s+((?:PK|FK|UK)(?:\s*,\s*(?:PK|FK|UK))*))?(?:\s+"([^"]*)")?\s*$/;
const ENUM_VALUE = /^[a-z][a-z0-9_]*$/;

/** enum 주석에서 값 목록을 읽는다. "offline, online — 2단계 대비" → [offline, online] */
export function parseEnumValues(comment: string | undefined): string[] | null {
  if (!comment) return null;
  const head = comment.split("—")[0] ?? "";
  const values = head
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length > 0 && values.every((value) => ENUM_VALUE.test(value)) ? values : null;
}

/**
 * erd.md의 mermaid erDiagram 블록에서 테이블을 읽는다.
 * 표기 규칙(erd.md 머리말): 모든 테이블에 id(PK)와 created_at이 있다고 보고 다이어그램에서 생략한다.
 * 다른 컬럼이 PK인 1:1 테이블에는 id가 없다.
 */
export function parseErd(markdown: string): Map<string, ErdTable> {
  const tables = new Map<string, ErdTable>();
  const lines = markdown.split("\n");
  let inDiagram = false;
  let current: {
    name: string;
    listed: string[];
    hasOtherPk: boolean;
    enums: ErdTable["enums"];
  } | null = null;

  for (const line of lines) {
    if (/^```mermaid\s*$/.test(line)) {
      inDiagram = true;
      continue;
    }
    if (/^```\s*$/.test(line)) {
      inDiagram = false;
      continue;
    }
    if (!inDiagram) continue;

    if (!current) {
      const start = ENTITY_START.exec(line);
      if (start) current = { name: start[1] as string, listed: [], hasOtherPk: false, enums: {} };
      continue;
    }
    if (ENTITY_END.test(line)) {
      const columns = [...current.listed];
      if (!current.hasOtherPk && !columns.includes("id")) columns.unshift("id");
      if (!columns.includes("created_at")) columns.push("created_at");
      if (tables.has(current.name))
        throw new Error(`erd.md: ${current.name} 테이블이 두 번 나온다`);
      tables.set(current.name, { name: current.name, columns, enums: current.enums });
      current = null;
      continue;
    }
    const attribute = ATTRIBUTE.exec(line);
    if (!attribute) {
      if (line.trim())
        throw new Error(`erd.md: ${current.name}의 컬럼 줄을 읽을 수 없다: ${line.trim()}`);
      continue;
    }
    const [, type, column, keys = "", comment] = attribute as unknown as [
      string,
      string,
      string,
      string | undefined,
      string | undefined,
    ];
    current.listed.push(column);
    if (keys.includes("PK") && column !== "id") current.hasOtherPk = true;
    if (type === "enum") current.enums[column] = parseEnumValues(comment);
  }
  return tables;
}

/** 빈 PGlite에 shim과 마이그레이션(seed 없이)을 적용하고 public 테이블을 읽는다. */
export async function loadActualSchema(db?: PGlite): Promise<Map<string, ActualTable>> {
  const ownDb = db ?? new PGlite();
  try {
    if (!db) await applyAll(ownDb, { seed: false });
    const { rows } = await ownDb.query<{
      table_name: string;
      column_name: string;
      type_name: string;
      is_enum: boolean;
      labels: string[] | null;
    }>(
      `select c.relname as table_name, a.attname as column_name, t.typname as type_name,
              t.typtype = 'e' as is_enum,
              (select array_agg(e.enumlabel::text order by e.enumsortorder)
                 from pg_enum e where e.enumtypid = t.oid) as labels
       from pg_class c
       join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
       join pg_type t on t.oid = a.atttypid
       where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
       order by c.relname, a.attnum`,
    );
    const tables = new Map<string, ActualTable>();
    for (const row of rows) {
      const table = tables.get(row.table_name) ?? { name: row.table_name, columns: [] };
      table.columns.push({
        name: row.column_name,
        typeName: row.type_name,
        ...(row.is_enum ? { enumType: { name: row.type_name, labels: row.labels ?? [] } } : {}),
      });
      tables.set(row.table_name, table);
    }
    return tables;
  } finally {
    if (!db) await ownDb.close();
  }
}

export interface DriftResult {
  ok: boolean;
  /** 테이블 → 차이 설명 */
  drift: Map<string, string[]>;
  /** 일치하는 구현 테이블 */
  matched: string[];
  /** erd에만 있는 테이블 */
  unimplemented: string[];
  /** 예외로 건너뛴 테이블 */
  excepted: string[];
  /** 예외인데 차이가 없어진 테이블 (예외 목록에서 지워야 함) */
  staleExceptions: string[];
}

function setDiff(a: string[], b: string[]): string[] {
  const other = new Set(b);
  return a.filter((value) => !other.has(value));
}

export function diffTable(expected: ErdTable, actual: ActualTable): string[] {
  const problems: string[] = [];
  const actualNames = actual.columns.map((column) => column.name);
  const missing = setDiff(expected.columns, actualNames);
  const extra = setDiff(actualNames, expected.columns);
  if (missing.length > 0) problems.push(`erd에만 있는 컬럼: ${missing.join(", ")}`);
  if (extra.length > 0) problems.push(`마이그레이션에만 있는 컬럼: ${extra.join(", ")}`);

  for (const column of actual.columns) {
    if (!expected.columns.includes(column.name)) continue;
    const erdIsEnum = column.name in expected.enums;
    const erdValues = expected.enums[column.name];
    if (!column.enumType) {
      if (erdIsEnum) problems.push(`${column.name}: erd는 enum, DB는 ${column.typeName}`);
      continue;
    }
    if (!erdIsEnum) {
      problems.push(`${column.name}: DB는 enum(${column.enumType.name}), erd는 enum이 아님`);
      continue;
    }
    const expectedType = `${expected.name}_${column.name}`;
    if (column.enumType.name !== expectedType) {
      problems.push(
        `${column.name}: enum 타입 이름이 ${column.enumType.name} (erd 규칙은 ${expectedType})`,
      );
    }
    if (!erdValues) {
      problems.push(`${column.name}: erd 주석에서 enum 값을 읽을 수 없음`);
      continue;
    }
    const missingValues = setDiff(erdValues, column.enumType.labels);
    const extraValues = setDiff(column.enumType.labels, erdValues);
    if (missingValues.length > 0) {
      problems.push(`${column.name}: erd에만 있는 enum 값: ${missingValues.join(", ")}`);
    }
    if (extraValues.length > 0) {
      problems.push(`${column.name}: DB에만 있는 enum 값: ${extraValues.join(", ")}`);
    }
  }
  return problems;
}

export function compareSchema(
  erd: Map<string, ErdTable>,
  actual: Map<string, ActualTable>,
  exceptions: Readonly<Record<string, string>> = ERD_DRIFT_EXCEPTIONS,
): DriftResult {
  const drift = new Map<string, string[]>();
  const matched: string[] = [];
  const excepted: string[] = [];
  const staleExceptions: string[] = [];

  for (const table of [...actual.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    const expected = erd.get(table.name);
    const problems = expected
      ? diffTable(expected, table)
      : ["erd.md에 없는 테이블 (마이그레이션에만 있음)"];
    if (table.name in exceptions) {
      if (problems.length > 0) excepted.push(table.name);
      else staleExceptions.push(table.name);
      continue;
    }
    if (problems.length > 0) drift.set(table.name, problems);
    else matched.push(table.name);
  }
  const unimplemented = [...erd.keys()].filter((name) => !actual.has(name));
  return {
    ok: drift.size === 0 && staleExceptions.length === 0,
    drift,
    matched,
    unimplemented,
    excepted,
    staleExceptions,
  };
}

export function report(result: DriftResult, erdTableCount: number): string[] {
  const lines = [
    `check:erd-drift: erd 테이블 ${erdTableCount}개 — 구현·일치 ${result.matched.length}개, 미구현 ${result.unimplemented.length}개, 차이 ${result.drift.size}개, 예외 ${result.excepted.length}개`,
  ];
  if (result.unimplemented.length > 0) {
    lines.push(`미구현(erd에만 있음): ${result.unimplemented.join(", ")}`);
  }
  for (const name of result.excepted) {
    lines.push(`예외(차이 있음, 기획 답 대기): ${name} — ${ERD_DRIFT_EXCEPTIONS[name] ?? ""}`);
  }
  if (result.drift.size > 0) {
    lines.push("실패: docs/erd.md와 마이그레이션이 다릅니다.");
    for (const [table, problems] of result.drift) {
      lines.push(`- ${table}`, ...problems.map((problem) => `    ${problem}`));
    }
    lines.push(
      "  왜: 테이블·컬럼·enum 이름은 docs/erd.md가 기준입니다(CLAUDE.md 이름 규칙).",
      "  대신 할 일: 마이그레이션이 틀렸으면 새 마이그레이션으로 고치세요(기존 파일은 고치지 않음).",
      "  문서가 틀렸다고 보면 코드로 맞추지 말고 `[질문] 받는 역할: 기획`으로 보고하세요.",
    );
  }
  if (result.staleExceptions.length > 0) {
    lines.push(
      `실패: 차이가 없어졌는데 예외 목록에 남은 테이블: ${result.staleExceptions.join(", ")}`,
      "  대신 할 일: supabase/scripts/check-erd-drift.ts의 ERD_DRIFT_EXCEPTIONS에서 지우세요.",
    );
  }
  return lines;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const erd = parseErd(readFileSync(ERD_PATH, "utf8"));
  const result = compareSchema(erd, await loadActualSchema());
  const lines = report(result, erd.size);
  (result.ok ? console.log : console.error)(lines.join("\n"));
  process.exit(result.ok ? 0 : 1);
}
