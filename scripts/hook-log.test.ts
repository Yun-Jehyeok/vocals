// 훅 차단 로그 단위 테스트 (이슈 #17 하네스 6단계, #48 위치·이름)
// 임시 vocals 모양 저장소에서 훅을 돌리고 `.claude/logs/<날짜>-<세션>-<브랜치>.jsonl`에 남는 줄을 확인한다.
// 명령 원문·파일 내용·도구 인자 값이 로그에 들어가지 않는지가 핵심이다.
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const HOOKS = fileURLToPath(new URL("../plugins/vocals-team/hooks/", import.meta.url));
const ACCEPTANCE_GUARD = fileURLToPath(new URL("./acceptance-guard.ts", import.meta.url));
const SESSION = "abcd1234-5678-90ef-aaaa-bbbbccccdddd";

let repo: string;
let outside: string;
let worktree: string;
let copy: string;

function git(cwd: string, ...args: string[]) {
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
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

function write(root: string, file: string, content: string) {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "hook-log-"));
  outside = mkdtempSync(join(tmpdir(), "hook-log-outside-"));
  git(repo, "init", "-q");
  const files: Record<string, string> = {
    "plugins/vocals-team/.claude-plugin/plugin.json": "{}",
    "scripts/acceptance-guard.ts": readFileSync(ACCEPTANCE_GUARD, "utf8"),
    "docs/prd.md": "# PRD",
    "supabase/migrations/20260101000000_init.sql": "create table a ();",
    "packages/shared/src/rule.ts": "",
  };
  for (const [file, content] of Object.entries(files)) write(repo, file, content);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "chore: 시작");
  git(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(repo, "checkout", "-q", "-b", "work");
  worktree = join(outside, "wt-17");
  git(repo, "worktree", "add", "-q", worktree, "main");
  // worktree가 아닌 /tmp 복사본(별도 clone)
  copy = join(outside, "copy");
  git(outside, "clone", "-q", "--branch", "work", repo, copy);
  git(copy, "checkout", "-q", "-b", "qa/probe");
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(repo, ".claude"), { recursive: true, force: true });
  rmSync(join(worktree, ".claude"), { recursive: true, force: true });
  rmSync(join(copy, ".claude"), { recursive: true, force: true });
});

function runHook(script: string, input: Record<string, unknown>, env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [join(HOOKS, script)], {
    input: JSON.stringify({ session_id: SESSION, cwd: repo, ...input }),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo, ...env },
  });
  return { status: result.status, stderr: result.stderr };
}

interface LogLine {
  ts: string;
  session: string;
  event: string;
  rule: string;
  role: string;
  tool: string;
  target: string | null;
}

function logFiles(root: string) {
  const dir = join(root, ".claude", "logs");
  return existsSync(dir) ? readdirSync(dir).map((name) => join(dir, name)) : [];
}

function logLines(root: string): LogLine[] {
  return logFiles(root).flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as LogLine),
  );
}

function rawLog(root: string) {
  return logFiles(root)
    .map((file) => readFileSync(file, "utf8"))
    .join("");
}

describe("훅 차단 로그 (이슈 #17 6단계)", () => {
  it("차단하면 .claude/logs/<날짜>-<세션 앞 8자>-<브랜치>.jsonl에 정해진 필드로 한 줄을 남긴다", () => {
    const result = runHook("guard-files.mjs", {
      agent_type: "vocals-team:developer",
      tool_name: "Edit",
      tool_input: { file_path: join(repo, "docs/prd.md"), old_string: "a", new_string: "b" },
    });
    expect(result.status).toBe(2);
    const files = logFiles(repo);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\/\.claude\/logs\/\d{4}-\d{2}-\d{2}-abcd1234-work\.jsonl$/);
    const [line] = logLines(repo);
    expect(line).toEqual({
      ts: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      session: "abcd1234",
      event: "block",
      rule: "developer.docs",
      role: "developer",
      tool: "Edit",
      target: "docs/prd.md",
    });
    expect(files[0]).toContain(line?.ts.slice(0, 10));
  });

  it("Bash 차단은 경로만 남기고 명령 원문은 남기지 않는다", () => {
    const result = runHook("guard-bash.mjs", {
      agent_type: "developer",
      tool_name: "Bash",
      tool_input: { command: "echo TOPSECRET-123 > docs/prd.md" },
    });
    expect(result.status).toBe(2);
    expect(logLines(repo)).toMatchObject([
      { rule: "developer.docs", tool: "Bash", target: "docs/prd.md" },
    ]);
    expect(rawLog(repo)).not.toContain("TOPSECRET");
    expect(rawLog(repo)).not.toContain("echo");
  });

  it("명령 규칙(main push)은 target 없이 남기고, 메인 세션의 역할은 main이다", () => {
    const result = runHook("guard-bash.mjs", {
      tool_name: "Bash",
      tool_input: { command: "git push origin main" },
    });
    expect(result.status).toBe(2);
    expect(logLines(repo)).toMatchObject([{ rule: "bash.push-main", role: "main", target: null }]);
  });

  it("MCP 차단은 도구 이름만 남기고 인자 값은 남기지 않는다", () => {
    const result = runHook("guard-mcp.mjs", {
      tool_name: "mcp__Supabase__execute_sql",
      tool_input: { project_id: "proj-secret-9", query: "select phone from users" },
    });
    expect(result.status).toBe(2);
    expect(logLines(repo)).toMatchObject([
      {
        rule: "mcp.supabase",
        tool: "mcp__Supabase__execute_sql",
        target: "mcp__Supabase__execute_sql",
      },
    ]);
    expect(rawLog(repo)).not.toContain("proj-secret");
    expect(rawLog(repo)).not.toContain("phone");
  });

  it("저장소 밖 절대 경로는 파일 이름만 남긴다", () => {
    const result = runHook("guard-files.mjs", {
      tool_name: "Write",
      tool_input: { file_path: join(outside, "private", ".env"), content: "KEY=secret" },
    });
    expect(result.status).toBe(2);
    expect(logLines(repo)).toMatchObject([{ rule: "file.env", target: ".env" }]);
    expect(rawLog(repo)).not.toContain(outside);
  });

  it("허용하면 아무것도 남기지 않는다", () => {
    const result = runHook("guard-files.mjs", {
      agent_type: "developer",
      tool_name: "Edit",
      tool_input: { file_path: join(repo, "packages/shared/src/rule.ts") },
    });
    expect(result.status).toBe(0);
    expect(logFiles(repo)).toEqual([]);
  });

  it("수동 worktree의 파일이면 메인 체크아웃의 .claude/logs/에 worktree 브랜치 이름으로 쓴다 (#48)", () => {
    const result = runHook("guard-files.mjs", {
      agent_type: "developer",
      tool_name: "Edit",
      tool_input: { file_path: join(worktree, "docs/prd.md") },
    });
    expect(result.status).toBe(2);
    expect(logLines(repo)).toMatchObject([{ rule: "developer.docs", target: "docs/prd.md" }]);
    expect(logFiles(repo)[0]).toMatch(/-abcd1234-main\.jsonl$/);
    expect(logFiles(worktree)).toEqual([]);
  });

  it("worktree 안에서 실행한 명령 규칙도 메인 체크아웃에 쓴다 (#48)", () => {
    const result = runHook("guard-bash.mjs", {
      cwd: worktree,
      tool_name: "Bash",
      tool_input: { command: "git push --force origin work" },
    });
    expect(result.status).toBe(2);
    expect(logLines(repo)).toMatchObject([{ rule: "bash.force-push" }]);
    expect(logFiles(worktree)).toEqual([]);
  });

  it("세션 프로젝트가 worktree여도 메인 체크아웃에 쓴다 (#48)", () => {
    const result = runHook(
      "guard-bash.mjs",
      { cwd: worktree, tool_name: "Bash", tool_input: { command: "git push origin main" } },
      { CLAUDE_PROJECT_DIR: worktree },
    );
    expect(result.status).toBe(2);
    expect(logLines(repo)).toMatchObject([{ rule: "bash.push-main" }]);
    expect(logFiles(worktree)).toEqual([]);
  });

  it("worktree가 아닌 /tmp 복사본에서 막혀도 세션 프로젝트의 메인 체크아웃에 쓴다 (#48)", () => {
    const result = runHook("guard-files.mjs", {
      cwd: copy,
      agent_type: "qa",
      tool_name: "Write",
      tool_input: { file_path: join(copy, "packages/shared/src/rule.ts") },
    });
    expect(result.status).toBe(2);
    expect(logLines(repo)).toMatchObject([
      { rule: "qa.scope", target: "packages/shared/src/rule.ts" },
    ]);
    expect(logFiles(repo)[0]).toMatch(/-abcd1234-qa-probe\.jsonl$/);
    expect(logFiles(copy)).toEqual([]);
  });

  it("같은 세션이라도 브랜치가 다르면 다른 파일에 쓴다(PR끼리 같은 파일을 고치지 않음) (#48)", () => {
    const push = { tool_name: "Bash", tool_input: { command: "git push origin main" } };
    runHook("guard-bash.mjs", push);
    runHook("guard-bash.mjs", { ...push, cwd: worktree });
    runHook("guard-bash.mjs", push);
    const names = logFiles(repo).map((file) => file.slice(file.lastIndexOf("/") + 1));
    expect(names).toHaveLength(2);
    expect(names.filter((name) => name.endsWith("-abcd1234-work.jsonl"))).toHaveLength(1);
    expect(names.filter((name) => name.endsWith("-abcd1234-main.jsonl"))).toHaveLength(1);
    expect(logLines(repo)).toHaveLength(3);
  });

  it("브랜치 이름은 파일 이름에 쓸 수 있게 바꾼다 (#48)", async () => {
    const url = pathToFileURL(join(HOOKS, "lib", "log.mjs")).href;
    const { branchSlug } = (await import(url)) as { branchSlug: (branch: string) => string };
    expect(branchSlug("fix/48-hook-false-positives")).toBe("fix-48-hook-false-positives");
    expect(branchSlug("feat/a b:c")).toBe("feat-a-b-c");
    expect(branchSlug("HEAD")).toBe("detached");
    expect(branchSlug("")).toBe("detached");
    expect(branchSlug("../../x")).toBe("x");
    expect(branchSlug("a".repeat(100))).toHaveLength(80);
  });

  it("session_ 접두어는 빼고 앞 8자를 쓴다", () => {
    runHook("guard-bash.mjs", {
      session_id: "session_018vooJ3cKU8gpkweGCztEz5",
      tool_name: "Bash",
      tool_input: { command: "git push origin main" },
    });
    expect(logLines(repo)).toMatchObject([{ session: "018vooJ3" }]);
    expect(logFiles(repo)[0]).toMatch(/-018vooJ3-work\.jsonl$/);
  });

  it("로그를 쓰지 못해도 차단은 그대로 한다", () => {
    write(repo, ".claude/logs", "디렉터리 자리에 파일");
    const result = runHook("guard-bash.mjs", {
      tool_name: "Bash",
      tool_input: { command: "git push origin main" },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("main에 직접 push하지 않습니다");
    expect(result.stderr).not.toContain("내부 오류");
  });

  it("vocals 저장소를 찾지 못하면 남기지 않고 차단만 한다", () => {
    const result = runHook(
      "guard-bash.mjs",
      { cwd: outside, tool_name: "Bash", tool_input: { command: "git push origin main" } },
      { CLAUDE_PROJECT_DIR: outside },
    );
    expect(result.status).toBe(2);
    expect(existsSync(join(outside, ".claude"))).toBe(false);
  });

  it("훅 소스의 규칙 id와 RULE_IDS가 같다", async () => {
    const url = pathToFileURL(join(HOOKS, "lib", "log.mjs")).href;
    const { RULE_IDS } = (await import(url)) as { RULE_IDS: Record<string, string> };
    const used = new Set<string>();
    for (const file of ["guard-bash.mjs", "guard-files.mjs", "guard-mcp.mjs", "lib/rules.mjs"]) {
      const source = readFileSync(join(HOOKS, file), "utf8");
      for (const match of source.matchAll(/\brule:\s*"([^"]+)"/g)) used.add(match[1] ?? "");
    }
    expect([...used].sort()).toEqual(Object.keys(RULE_IDS).sort());
  });
});
