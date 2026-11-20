import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hasQaTrailer, runGuard } from "./acceptance-guard.ts";

const ACCEPTANCE_FILE = "supabase/tests/acceptance/17-example.test.ts";
const QA = "\n\nAcceptance: qa";

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

const guard = (options: { base?: string; strict?: boolean } = {}) =>
  runGuard({ cwd: repo, base: options.base ?? "main", head: "HEAD", strict: !!options.strict });

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "acceptance-guard-"));
  git("init", "-q");
  commit("chore: 시작", { [ACCEPTANCE_FILE]: "v1", "src/app.ts": "a" });
  git("checkout", "-q", "-b", "work");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("acceptance-guard (이슈 #17)", () => {
  it("인수 테스트를 바꾸지 않은 브랜치는 통과한다", () => {
    commit("feat: 기능", { "src/app.ts": "b" });
    expect(guard().status).toBe("pass");
  });

  it("트레일러 없는 커밋이 인수 테스트를 바꾸면 실패하고, 이유와 대신 할 일을 출력한다", () => {
    commit("feat: 테스트도 같이 고침", { [ACCEPTANCE_FILE]: "v2" });
    const result = guard();
    expect(result.status).toBe("fail");
    expect(result.violations).toEqual([
      { file: ACCEPTANCE_FILE, commits: [expect.stringContaining("feat: 테스트도 같이 고침")] },
    ]);
    const output = result.lines.join("\n");
    expect(output).toContain("QA 담당입니다");
    expect(output).toContain("[질문] 받는 역할: QA");
  });

  it("인수 테스트 경로에 새 파일을 트레일러 없이 추가해도 실패한다", () => {
    commit("test: 새 인수 테스트", { "supabase/tests/acceptance/18-new.test.ts": "x" });
    expect(guard().status).toBe("fail");
  });

  it("E2E 자리(tests/acceptance/)도 보호한다", () => {
    commit("test: e2e", { "tests/acceptance/e2e/login.spec.ts": "x" });
    expect(guard().status).toBe("fail");
  });

  it("인수 테스트를 트레일러 없이 지워도 실패한다", () => {
    commit("chore: 정리", { [ACCEPTANCE_FILE]: null });
    expect(guard().status).toBe("fail");
  });

  it("브랜치에서 QA가 추가한 인수 테스트를 트레일러 없이 지우면 실패한다", () => {
    commit(`test: 18번 인수 테스트${QA}`, { "supabase/tests/acceptance/18-new.test.ts": "x" });
    commit("chore: 정리", { "supabase/tests/acceptance/18-new.test.ts": null });
    const result = guard();
    expect(result.status).toBe("fail");
    expect(result.violations).toEqual([
      {
        file: "supabase/tests/acceptance/18-new.test.ts",
        commits: [expect.stringContaining("chore: 정리")],
      },
    ]);
  });

  it("브랜치에서 개발이 추가했다가 지운 인수 테스트는 남은 변경이 없어 통과한다", () => {
    commit("test: 임시", { "supabase/tests/acceptance/18-new.test.ts": "x" });
    commit("chore: 되돌림", { "supabase/tests/acceptance/18-new.test.ts": null });
    expect(guard().status).toBe("pass");
  });

  it.each([
    "supabase/tests/helpers/rls-matrix.ts",
    "supabase/tests/helpers/db.ts",
    "supabase/tests/rls-matrix.test.ts",
  ])("판정 헬퍼 %s도 보호한다", (file) => {
    git("checkout", "-q", "main");
    commit(`test: 헬퍼${QA}`, { [file]: "v1" });
    git("checkout", "-q", "work");
    git("merge", "-q", "--no-edit", "main");
    commit("fix: 판정 완화", { [file]: "v2" });
    expect(guard().status).toBe("fail");
  });

  it("판정에 영향이 없는 헬퍼(seed-ids)와 seed는 보호하지 않는다", () => {
    commit("feat: seed", {
      "supabase/tests/helpers/seed-ids.ts": "x",
      "supabase/seed.sql": "x",
    });
    expect(guard().status).toBe("pass");
  });

  it("`Acceptance: qa` 트레일러가 있는 커밋은 통과한다", () => {
    commit(`test: 인수 테스트 추가${QA}`, {
      [ACCEPTANCE_FILE]: "v2",
      "supabase/tests/acceptance/18-new.test.ts": "x",
    });
    commit("feat: 구현", { "src/app.ts": "b" });
    expect(guard().status).toBe("pass");
  });

  it("QA 커밋 뒤에 트레일러 없는 커밋이 다시 바꾸면 실패한다", () => {
    commit(`test: 인수 테스트${QA}`, { [ACCEPTANCE_FILE]: "v2" });
    commit("fix: 테스트 기대값 조정", { [ACCEPTANCE_FILE]: "v3" });
    const result = guard();
    expect(result.status).toBe("fail");
    expect(result.violations[0]?.commits).toEqual([
      expect.stringContaining("fix: 테스트 기대값 조정"),
    ]);
  });

  it("잘못 바꾼 커밋을 되돌리면(revert) 다시 통과한다", () => {
    commit(`test: 인수 테스트${QA}`, { [ACCEPTANCE_FILE]: "v2" });
    commit("fix: 테스트 기대값 조정", { [ACCEPTANCE_FILE]: "v3" });
    git("revert", "--no-edit", "HEAD");
    expect(guard().status).toBe("pass");
  });

  it("QA가 한 파일만 승인했으면 다른 인수 테스트 파일의 변경은 실패한다", () => {
    commit(`test: 18번${QA}`, { "supabase/tests/acceptance/18-new.test.ts": "x" });
    commit("feat: 구현", { [ACCEPTANCE_FILE]: "v2" });
    const result = guard();
    expect(result.status).toBe("fail");
    expect(result.violations.map((violation) => violation.file)).toEqual([ACCEPTANCE_FILE]);
  });

  it("트레일러 값이 qa가 아니면 인정하지 않는다", () => {
    commit("test: 고침\n\nAcceptance: developer", { [ACCEPTANCE_FILE]: "v2" });
    expect(guard().status).toBe("fail");
  });

  it("기준 브랜치 이전(main)의 인수 테스트 커밋은 검사하지 않는다", () => {
    git("checkout", "-q", "main");
    commit("test: main에서 바뀜", { [ACCEPTANCE_FILE]: "v2" });
    git("checkout", "-q", "work");
    git("merge", "-q", "--no-edit", "main");
    expect(guard().status).toBe("pass");
  });

  it("기준 브랜치가 없으면 경고만 하고 통과한다", () => {
    commit("feat: 테스트도 같이 고침", { [ACCEPTANCE_FILE]: "v2" });
    const result = guard({ base: "origin/main" });
    expect(result.status).toBe("skip");
    expect(result.lines.join("\n")).toContain("경고");
  });

  it("--strict(CI)에서는 기준 브랜치가 없으면 실패한다", () => {
    expect(guard({ base: "origin/main", strict: true }).status).toBe("fail");
  });

  it("merge-base가 없으면(얕은 clone·무관한 이력) 경고만 하고 통과한다", () => {
    git("checkout", "-q", "--orphan", "orphan");
    commit("chore: 다른 이력", { "x.txt": "x" });
    expect(guard().status).toBe("skip");
  });

  it("트레일러 값 판정", () => {
    expect(hasQaTrailer("qa\n")).toBe(true);
    expect(hasQaTrailer("QA\n")).toBe(true);
    expect(hasQaTrailer("developer\nqa\n")).toBe(true);
    expect(hasQaTrailer("")).toBe(false);
    expect(hasQaTrailer("qa-ish\n")).toBe(false);
  });
});
