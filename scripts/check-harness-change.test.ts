import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isHarnessPath, runHarnessChange } from "./check-harness-change.ts";

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

function commit(message: string, files: Record<string, string>) {
  for (const [file, content] of Object.entries(files)) {
    const path = join(repo, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    git("add", file);
  }
  git("commit", "-q", "-m", message);
}

const PACKAGE = (scripts: Record<string, string>, deps: Record<string, string> = {}) =>
  JSON.stringify({ name: "x", scripts, devDependencies: deps }, null, 2);

const check = (labels: string[] | null, options: { base?: string; strict?: boolean } = {}) =>
  runHarnessChange({
    cwd: repo,
    base: options.base ?? "main",
    head: git("rev-parse", "HEAD").trim(),
    strict: !!options.strict,
    labels,
  });

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "harness-change-"));
  git("init", "-q");
  commit("chore: 시작", {
    "package.json": PACKAGE({ check: "pnpm test && pnpm check:harness" }),
    "scripts/acceptance-guard.ts": "export const PROTECTED_PATHS = ['a/'];",
    "scripts/req-trace-baseline.txt": "XYZ-01\n",
    "docs/prd.md": "# PRD",
    "packages/shared/src/rule.ts": "",
  });
  git("checkout", "-q", "-b", "work");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("하네스 변경 라벨 검사 (이슈 #17 하네스 2단계)", () => {
  it("하네스 경로 목록", () => {
    for (const file of [
      "scripts/acceptance-guard.ts",
      "scripts/plugin-hooks.test.ts",
      "supabase/scripts/check-erd-drift.ts",
      ".github/workflows/ci.yml",
      ".claude/settings.json",
      "plugins/vocals-team/hooks/lib/rules.mjs",
      "plugins/vocals-team/.claude-plugin/plugin.json",
      "pnpm-workspace.yaml",
    ]) {
      expect(isHarnessPath(file)).toBe(true);
    }
    for (const file of [
      "scripts/req-trace-baseline.txt",
      "docs/prd.md",
      "packages/shared/src/rule.ts",
      "supabase/migrations/1.sql",
      "supabase/seed.sql",
      "plugins/vocals-team/agents/qa.md",
    ]) {
      expect(isHarnessPath(file)).toBe(false);
    }
  });

  it("하네스 밖만 바뀌면 라벨 없이 통과한다", () => {
    commit("feat: x", {
      "packages/shared/src/rule.ts": "export {}",
      "scripts/req-trace-baseline.txt": "",
    });
    expect(check([]).status).toBe("pass");
  });

  it("보호 목록 정의 파일을 바꾸고 라벨이 없으면 실패한다", () => {
    commit("chore: 목록 줄임", {
      "scripts/acceptance-guard.ts": "export const PROTECTED_PATHS = [];",
    });
    const result = check(["bug"]);
    expect(result.status).toBe("fail");
    expect(result.files).toEqual(["scripts/acceptance-guard.ts"]);
    expect(result.lines.join("\n")).toContain("대신 할 일:");
  });

  it("harness 라벨이 있으면 통과한다", () => {
    commit("chore: CI", { ".github/workflows/ci.yml": "name: CI" });
    expect(check(["harness", "x"]).status).toBe("pass");
  });

  it("라벨을 모르면(로컬) 경고만 한다", () => {
    commit("chore: 훅", { "plugins/vocals-team/hooks/guard-bash.mjs": "" });
    expect(check(null).status).toBe("warn");
  });

  it("package.json은 scripts가 바뀔 때만 하네스로 본다", () => {
    commit("chore: 의존성", {
      "package.json": PACKAGE({ check: "pnpm test && pnpm check:harness" }, { a: "1" }),
    });
    expect(check([]).status).toBe("pass");
    commit("chore: check 약화", { "package.json": PACKAGE({ check: "echo ok" }, { a: "1" }) });
    expect(check([]).files).toEqual(["package.json"]);
  });

  it("기준 브랜치가 없으면 경고만 하고, --strict면 실패한다", () => {
    expect(check([], { base: "origin/nope" }).status).toBe("skip");
    expect(check([], { base: "origin/nope", strict: true }).status).toBe("fail");
  });
});
