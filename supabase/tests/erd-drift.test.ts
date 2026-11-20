import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ERD_PATH,
  compareSchema,
  loadActualSchema,
  parseEnumValues,
  parseErd,
} from "../scripts/check-erd-drift.ts";
import type { ActualTable } from "../scripts/check-erd-drift.ts";
import { applyAll } from "./helpers/db.ts";

const FIXTURE = [
  "# ERD",
  "```mermaid",
  "erDiagram",
  '    users ||--o| profiles : "1:1"',
  "",
  "    users {",
  '        uuid id PK "= Auth"',
  '        enum role "student, trainer"',
  "        string nickname",
  "    }",
  "    profiles {",
  "        uuid user_id PK, FK",
  '        enum mode "offline, online — 2단계 대비"',
  "    }",
  "    items {",
  "        uuid owner_id FK",
  '        enum kind "결제 당시 값"',
  "    }",
  "```",
  "",
  "```mermaid",
  "erDiagram",
  "    later {",
  "        string title",
  "    }",
  "```",
  "",
  "    outside {",
  "        string ignored",
  "    }",
].join("\n");

function actualTable(name: string, columns: [string, string?, string[]?][]): ActualTable {
  return {
    name,
    columns: columns.map(([column, enumType, labels]) => ({
      name: column,
      typeName: enumType ?? "text",
      ...(enumType ? { enumType: { name: enumType, labels: labels ?? [] } } : {}),
    })),
  };
}

const MATCHING = () =>
  new Map<string, ActualTable>([
    [
      "users",
      actualTable("users", [
        ["id"],
        ["role", "users_role", ["student", "trainer"]],
        ["nickname"],
        ["created_at"],
      ]),
    ],
    [
      "profiles",
      actualTable("profiles", [
        ["user_id"],
        ["mode", "profiles_mode", ["offline", "online"]],
        ["created_at"],
      ]),
    ],
  ]);

describe("erd.md 파싱 (이슈 #17)", () => {
  const erd = parseErd(FIXTURE);

  it("mermaid 블록 안의 테이블만 읽고, 생략된 id·created_at을 채운다", () => {
    expect([...erd.keys()]).toEqual(["users", "profiles", "items", "later"]);
    expect(erd.get("users")?.columns).toEqual(["id", "role", "nickname", "created_at"]);
    expect(erd.get("items")?.columns).toEqual(["id", "owner_id", "kind", "created_at"]);
  });

  it("id가 아닌 컬럼이 PK인 1:1 테이블에는 id를 넣지 않는다", () => {
    expect(erd.get("profiles")?.columns).toEqual(["user_id", "mode", "created_at"]);
  });

  it("enum 값은 주석의 쉼표 목록이고, '—' 뒤 설명은 버리고, 값이 아니면 null", () => {
    expect(erd.get("users")?.enums).toEqual({ role: ["student", "trainer"] });
    expect(erd.get("profiles")?.enums).toEqual({ mode: ["offline", "online"] });
    expect(erd.get("items")?.enums).toEqual({ kind: null });
    expect(parseEnumValues(undefined)).toBeNull();
  });

  it("읽을 수 없는 컬럼 줄이나 같은 테이블이 두 번 나오면 멈춘다", () => {
    expect(() => parseErd("```mermaid\nerDiagram\n  t {\n    uuid\n  }\n```")).toThrow(
      /읽을 수 없다/,
    );
    expect(() => parseErd("```mermaid\nerDiagram\n  t {\n  }\n  t {\n  }\n```")).toThrow(/두 번/);
  });
});

describe("erd와 스키마 비교 (이슈 #17)", () => {
  const erd = parseErd(FIXTURE);

  it("일치하면 통과하고 erd에만 있는 테이블은 미구현으로만 낸다", () => {
    const result = compareSchema(erd, MATCHING(), {});
    expect(result.ok).toBe(true);
    expect(result.matched).toEqual(["profiles", "users"]);
    expect(result.unimplemented).toEqual(["items", "later"]);
  });

  it("컬럼이 빠지거나 더 있으면 실패하고 차이를 낸다", () => {
    const actual = MATCHING();
    actual.set(
      "users",
      actualTable("users", [
        ["id"],
        ["role", "users_role", ["student", "trainer"]],
        ["nick_name"],
        ["created_at"],
      ]),
    );
    const result = compareSchema(erd, actual, {});
    expect(result.ok).toBe(false);
    expect(result.drift.get("users")).toEqual([
      "erd에만 있는 컬럼: nickname",
      "마이그레이션에만 있는 컬럼: nick_name",
    ]);
  });

  it("enum 값·타입 이름·enum 여부가 다르면 실패한다", () => {
    const actual = MATCHING();
    actual.set(
      "users",
      actualTable("users", [
        ["id"],
        ["role", "user_role", ["student", "admin"]],
        ["nickname", "users_nickname", ["a"]],
        ["created_at"],
      ]),
    );
    actual.set("profiles", actualTable("profiles", [["user_id"], ["mode"], ["created_at"]]));
    const result = compareSchema(erd, actual, {});
    expect(result.drift.get("users")).toEqual([
      "role: enum 타입 이름이 user_role (erd 규칙은 users_role)",
      "role: erd에만 있는 enum 값: trainer",
      "role: DB에만 있는 enum 값: admin",
      "nickname: DB는 enum(users_nickname), erd는 enum이 아님",
    ]);
    expect(result.drift.get("profiles")).toEqual(["mode: erd는 enum, DB는 text"]);
  });

  it("erd에서 enum 값을 읽을 수 없는 컬럼이 구현되면 실패한다", () => {
    const actual = MATCHING();
    actual.set(
      "items",
      actualTable("items", [["id"], ["owner_id"], ["kind", "items_kind", ["x"]], ["created_at"]]),
    );
    expect(compareSchema(erd, actual, {}).drift.get("items")).toEqual([
      "kind: erd 주석에서 enum 값을 읽을 수 없음",
    ]);
  });

  it("마이그레이션에만 있는 테이블은 실패한다", () => {
    const actual = MATCHING();
    actual.set("secret_table", actualTable("secret_table", [["id"]]));
    expect(compareSchema(erd, actual, {}).drift.get("secret_table")).toEqual([
      "erd.md에 없는 테이블 (마이그레이션에만 있음)",
    ]);
  });

  it("예외 목록의 테이블은 건너뛰고, 차이가 없어졌는데 남아 있으면 실패한다", () => {
    const actual = MATCHING();
    actual.set("secret_table", actualTable("secret_table", [["id"]]));
    const excepted = compareSchema(erd, actual, { secret_table: "#17 질문" });
    expect(excepted).toMatchObject({ ok: true, excepted: ["secret_table"] });

    const stale = compareSchema(erd, MATCHING(), { users: "#17 질문" });
    expect(stale).toMatchObject({ ok: false, staleExceptions: ["users"] });
  });
});

// 지금 스키마가 erd와 일치하는지는 센서(pnpm check:erd-drift)가 본다.
describe("실제 마이그레이션 스키마 읽기 (이슈 #17)", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await applyAll(db, { seed: false });
  });

  afterAll(async () => {
    await db.close();
  });

  it("마이그레이션에 erd에 없는 컬럼을 더하면 잡아낸다", async () => {
    const erd = parseErd(readFileSync(ERD_PATH, "utf8"));
    await db.exec("begin");
    try {
      await db.exec(`alter table public.users add column nick text`);
      const result = compareSchema(erd, await loadActualSchema(db));
      expect(result.drift.get("users")).toEqual(["마이그레이션에만 있는 컬럼: nick"]);
    } finally {
      await db.exec("rollback");
    }
  });
});
