import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrationGuard } from "./check-migrations.ts";

const OLD = "supabase/migrations/20260101000000_init.sql";
let repo: string;

function git(...args: string[]): string {
  return execFileSync(
    "git",
    [
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "init.defaultBranch=main",
      ...args,
    ],
    { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

function write(file: string, content: string) {
  const path = join(repo, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function commit(message: string, files: Record<string, string | null>) {
  for (const [file, content] of Object.entries(files)) {
    if (content === null) git("rm", "-q", file);
    else {
      write(file, content);
      git("add", file);
    }
  }
  git("commit", "-q", "--allow-empty", "-m", message);
}

const guard = (options: { base?: string; head?: string; strict?: boolean } = {}) =>
  runMigrationGuard({
    cwd: repo,
    base: options.base ?? "main",
    head: options.head ?? "HEAD",
    strict: !!options.strict,
  });

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "check-migrations-"));
  git("init", "-q");
  commit("chore: 시작", { [OLD]: "create table a ();" });
  git("checkout", "-q", "-b", "work");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("기존 마이그레이션 보호 (이슈 #17 하네스 2단계)", () => {
  it("새 마이그레이션 추가는 통과한다", () => {
    commit("feat: 새 테이블", { "supabase/migrations/20260201000000_b.sql": "create table b ();" });
    expect(guard().status).toBe("pass");
  });

  it("브랜치에서 만든 마이그레이션은 브랜치 안에서 고쳐도 된다", () => {
    commit("feat: b", { "supabase/migrations/20260201000000_b.sql": "create table b ();" });
    commit("fix: b", { "supabase/migrations/20260201000000_b.sql": "create table b (id int);" });
    expect(guard().status).toBe("pass");
  });

  it("기존 마이그레이션을 수정하면 실패한다", () => {
    commit("fix: 고침", { [OLD]: "create table a (id int);" });
    const result = guard();
    expect(result.status).toBe("fail");
    expect(result.violations).toEqual([{ file: OLD, change: "수정" }]);
    expect(result.lines.join("\n")).toContain("대신 할 일:");
  });

  it("기존 마이그레이션을 지우면 실패한다", () => {
    commit("chore: 지움", { [OLD]: null });
    expect(guard().violations).toEqual([{ file: OLD, change: "삭제·이름 변경" }]);
  });

  it("기존 마이그레이션의 이름을 바꾸면 실패한다", () => {
    git("mv", OLD, "supabase/migrations/20260101000001_init.sql");
    git("commit", "-q", "-m", "chore: 이름 변경");
    expect(guard().violations).toEqual([{ file: OLD, change: "삭제·이름 변경" }]);
  });

  it("바꿨다가 원래대로 되돌리면 통과한다", () => {
    commit("fix: 고침", { [OLD]: "create table a (id int);" });
    commit("revert: 되돌림", { [OLD]: "create table a ();" });
    expect(guard().status).toBe("pass");
  });

  it("로컬(head=HEAD)에서는 커밋하지 않은 수정·삭제도 잡는다", () => {
    write(OLD, "drop table a;");
    expect(guard().violations).toEqual([{ file: OLD, change: "수정(커밋 전)" }]);
    unlinkSync(join(repo, OLD));
    expect(guard().violations).toEqual([{ file: OLD, change: "삭제·이름 변경(커밋 전)" }]);
  });

  it("head를 커밋으로 주면(CI) 작업 트리는 보지 않는다", () => {
    const head = git("rev-parse", "HEAD").trim();
    write(OLD, "drop table a;");
    expect(guard({ head }).status).toBe("pass");
  });

  it("main이 앞서 나가 새 마이그레이션이 생겨도 브랜치가 건드리지 않았으면 통과한다", () => {
    git("checkout", "-q", "main");
    commit("feat: main 쪽", { "supabase/migrations/20260115000000_c.sql": "create table c ();" });
    git("checkout", "-q", "work");
    expect(guard().status).toBe("pass");
  });

  it("기준 브랜치가 없으면 경고만 하고, --strict면 실패한다", () => {
    expect(guard({ base: "origin/nope" }).status).toBe("skip");
    expect(guard({ base: "origin/nope", strict: true }).status).toBe("fail");
  });
});
