// vocals-team 플러그인 SessionStart 훅 단위 테스트 (이슈 #17 하네스 3단계)
// PATH에 가짜 gh를 두고 훅을 실행해, 팀장 컨텍스트 요약(30줄 이내)과 실패 시 종료 코드 0을 확인한다.
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const HOOK = fileURLToPath(
  new URL("../plugins/vocals-team/hooks/session-context.mjs", import.meta.url),
);

// gh api <경로>를 흉내 낸다(REST). 데이터는 FAKE_GH_DATA(JSON)에서 읽는다.
const FAKE_GH = `#!/usr/bin/env node
const data = JSON.parse(process.env.FAKE_GH_DATA || "{}");
const path = process.argv[3] || "";
const out = (v) => process.stdout.write(typeof v === "string" ? v : JSON.stringify(v));
if (process.env.FAKE_GH_SLEEP) setTimeout(() => {}, 60000);
else if (process.env.FAKE_GH_FAIL) { process.stderr.write("HTTP 403\\n"); process.exit(1); }
else if (process.argv[2] !== "api") process.exit(1);
else if (/\\/issues\\/comments\\?/.test(path)) out(data.comments ?? []);
else if (/\\/issues\\?/.test(path)) out(data.issues ?? []);
else if (/\\/pulls\\?/.test(path)) out(data.pulls ?? []);
else if (/\\/check-runs/.test(path)) {
  const sha = path.split("/commits/")[1].split("/")[0];
  if (data.checks?.[sha] === "fail") process.exit(1);
  out({ check_runs: data.checks?.[sha] ?? [] });
} else if (/\\/status$/.test(path)) {
  const sha = path.split("/commits/")[1].split("/")[0];
  if (data.statuses?.[sha] === "fail") process.exit(1);
  out({ state: "pending", statuses: data.statuses?.[sha] ?? [] });
} else process.exit(1);
`;

const DECISIONS = [
  "# 결정 기록",
  "",
  "## 결정",
  "",
  "| 날짜 | 결정 | 이유 | 되돌릴 수 있음 | 결정한 사람 | 출처 |",
  "| --- | --- | --- | --- | --- | --- |",
  ...Array.from(
    { length: 12 },
    (_, i) =>
      `| 2026-11-${String(30 - i).padStart(2, "0")} | 결정 ${i + 1} | 이유 ${i + 1} | 예 | PM | #${i + 1} |`,
  ),
  "",
  "## 참고",
  "| 날짜 | 결정 |",
  "| 2000-01-01 | 표 밖 |",
].join("\n");

const issue = (number: number, title: string, extra: Record<string, unknown> = {}) => ({
  number,
  title,
  labels: [],
  body: "",
  ...extra,
});
const pull = (number: number, title: string, sha: string, extra: Record<string, unknown> = {}) => ({
  ...issue(number, title),
  draft: true,
  head: { sha },
  ...extra,
});
const commentOn = (number: number, body: string) => ({
  issue_url: `https://api.github.com/repos/o/r/issues/${number}`,
  body,
});
const run = (id: number, name: string, status: string, conclusion: string | null) => ({
  id,
  name,
  status,
  conclusion,
});

const DATA = {
  issues: [
    issue(36, "[기능] 기타 6"),
    ...Array.from({ length: 6 }, (_, i) => issue(35 - i, `[기능] 기타 ${5 - i}`)),
    issue(19, "[버그] 출결", { body: "막힘: 아니오" }),
    issue(18, "[기능] 수강권", { labels: [{ name: "blocked" }] }),
    issue(17, "[기능] 하네스"),
    issue(16, "[기능] 계정"),
    issue(15, "[하네스] 계획", { body: "SessionStart 훅이 `막힘: 예`를 찾는다" }),
    // REST issues 목록에는 PR도 들어 있다: 빼야 한다
    issue(22, "chore: 하네스 3단계", { pull_request: { url: "x" } }),
  ],
  pulls: [
    pull(22, "chore: 하네스 3단계", "a1", { labels: [{ name: "harness" }] }),
    pull(23, "feat: 수강권", "b2", { draft: false }),
    pull(24, "docs: 결정 기록", "c3"),
    pull(25, "chore: 빈 CI", "d4"),
    pull(26, "chore: CI 조회 실패", "e5"),
    pull(27, "chore: 여섯째", "f6"),
  ],
  comments: [
    // 최신부터. #17은 최근 3개 안에 막힘: 예, #16은 4번째(오래된) 댓글에만 있어 블로커가 아니다
    commentOn(17, "[질문] 받는 역할: 기획 | 이슈: #17 | 막힘: 예"),
    commentOn(24, "[질문] 받는 역할: PM | 막힘: 예"),
    commentOn(16, "a"),
    commentOn(16, "b"),
    commentOn(16, "c"),
    commentOn(16, "막힘: 예"),
  ],
  checks: {
    // 같은 이름은 가장 최근(id가 큰) 실행만 본다
    a1: [
      run(2, "check", "completed", "success"),
      run(3, "harness-change", "completed", "failure"),
      run(1, "harness-change", "completed", "success"),
    ],
    b2: [run(5, "check", "in_progress", null)],
    c3: [run(7, "check", "completed", "success"), run(6, "check", "completed", "failure")],
    e5: "fail",
  },
  statuses: { e5: "fail" },
};

let root: string;
let repo: string;
let plainDir: string;
let withGh: string;
let withoutGh: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "session-context-"));
  repo = join(root, "repo");
  mkdirSync(join(repo, ".git"), { recursive: true });
  mkdirSync(join(repo, "plugins/vocals-team/.claude-plugin"), { recursive: true });
  writeFileSync(join(repo, "plugins/vocals-team/.claude-plugin/plugin.json"), "{}");
  mkdirSync(join(repo, "docs"));
  writeFileSync(join(repo, "docs/decisions.md"), DECISIONS);
  plainDir = join(root, "plain");
  mkdirSync(join(plainDir, ".git"), { recursive: true });

  // PATH에는 node와(있으면) 가짜 gh만 둔다
  withGh = join(root, "bin-gh");
  withoutGh = join(root, "bin-none");
  for (const dir of [withGh, withoutGh]) {
    mkdirSync(dir);
    symlinkSync(process.execPath, join(dir, "node"));
  }
  writeFileSync(join(withGh, "gh"), FAKE_GH);
  chmodSync(join(withGh, "gh"), 0o755);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function runHook(input: Record<string, unknown>, env: Record<string, string> = {}) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ hook_event_name: "SessionStart", source: "startup", ...input }),
    encoding: "utf8",
    timeout: 20000,
    env: {
      PATH: withGh,
      FAKE_GH_DATA: JSON.stringify(DATA),
      ...env,
    },
  });
  const context =
    result.stdout.trim() === ""
      ? null
      : (JSON.parse(result.stdout) as {
          hookSpecificOutput: { hookEventName: string; additionalContext: string };
        });
  return { status: result.status, context, elapsed: Date.now() - started };
}

describe("session-context: 팀장 세션 시작 현황 (이슈 #17 3단계)", () => {
  it("열린 PR·이슈, 블로커, 최근 결정 10개를 30줄 이내로 additionalContext에 넣는다", () => {
    const { status, context } = runHook({ cwd: repo });
    expect(status).toBe(0);
    expect(context?.hookSpecificOutput.hookEventName).toBe("SessionStart");
    const text = context?.hookSpecificOutput.additionalContext ?? "";
    const lines = text.split("\n");
    expect(lines.length).toBeLessThanOrEqual(30);

    expect(text).toContain("열린 PR 6개 (위 5개만):");
    expect(text).toContain("- #22 chore: 하네스 3단계 [draft, harness] CI 실패(harness-change)");
    expect(text).toContain("- #23 feat: 수강권 [ready] CI 진행 중");
    expect(text).toContain("- #24 docs: 결정 기록 [draft] CI 통과");
    expect(text).toContain("- #25 chore: 빈 CI [draft] CI 없음");
    expect(text).toContain("- #26 chore: CI 조회 실패 [draft] CI 확인 못 함");
    expect(text).not.toContain("#27");

    expect(text).toContain("열린 이슈 12개 (위 6개만):");
    expect(text).toContain("- #36 [기능] 기타 6");
    expect(text).toContain("- #31 [기능] 기타 1");
    expect(text).not.toContain("- #30 ");
    expect(lines.filter((line) => line.startsWith("- #22 "))).toHaveLength(1); // 이슈 목록의 PR은 뺀다

    expect(text).toContain("블로커 3개:");
    expect(text).toContain("이슈 #17 [기능] 하네스 — 최근 댓글에 `막힘: 예`");
    expect(text).toContain("이슈 #18 [기능] 수강권 — 라벨 blocked");
    expect(text).toContain("PR #24 docs: 결정 기록 — 최근 댓글에 `막힘: 예`");
    expect(text).not.toContain("#19 [버그] 출결 —");
    expect(text).not.toContain("#16 [기능] 계정 —");
    expect(text).not.toContain("#15 [하네스] 계획 —"); // 인라인 코드 속 `막힘: 예`는 세지 않는다

    expect(text).toContain("최근 결정 (docs/decisions.md, 위 10개):");
    const decisions = lines.filter((line) => /^- 2026-11-\d\d 결정/.test(line));
    expect(decisions).toHaveLength(10);
    expect(decisions[0]).toBe("- 2026-11-30 결정 1 (PM, #1)");
    expect(decisions[9]).toBe("- 2026-11-21 결정 10 (PM, #10)");
    expect(text).not.toContain("표 밖");
  });

  it("docs/decisions.md가 없으면 결정 부분만 건너뛴다", () => {
    const bare = join(root, "bare");
    mkdirSync(join(bare, ".git"), { recursive: true });
    mkdirSync(join(bare, "plugins/vocals-team/.claude-plugin"), { recursive: true });
    writeFileSync(join(bare, "plugins/vocals-team/.claude-plugin/plugin.json"), "{}");
    const { status, context } = runHook({ cwd: bare });
    expect(status).toBe(0);
    const text = context?.hookSpecificOutput.additionalContext ?? "";
    expect(text).toContain("열린 PR 6개");
    expect(text).not.toContain("최근 결정");
  });

  it("gh가 없으면 짧은 안내만 내고 종료 코드 0", () => {
    const { status, context } = runHook({ cwd: repo }, { PATH: withoutGh });
    expect(status).toBe(0);
    const text = context?.hookSpecificOutput.additionalContext ?? "";
    expect(text).toContain("gh로 이슈·PR을 읽지 못했습니다");
    expect(text).not.toContain("열린 PR");
    expect(text).toContain("최근 결정");
  });

  it("gh가 실패하면(네트워크·인증) 짧은 안내만 내고 종료 코드 0", () => {
    const { status, context } = runHook({ cwd: repo }, { FAKE_GH_FAIL: "1" });
    expect(status).toBe(0);
    expect(context?.hookSpecificOutput.additionalContext).toContain(
      "gh로 이슈·PR을 읽지 못했습니다",
    );
  });

  it("gh가 응답하지 않으면 타임아웃 뒤 안내만 내고 종료 코드 0", () => {
    const { status, context, elapsed } = runHook(
      { cwd: repo },
      { FAKE_GH_SLEEP: "1", VOCALS_SESSION_GH_TIMEOUT_MS: "300" },
    );
    expect(status).toBe(0);
    expect(elapsed).toBeLessThan(10000);
    expect(context?.hookSpecificOutput.additionalContext).toContain(
      "gh로 이슈·PR을 읽지 못했습니다",
    );
  });

  it("gh가 JSON이 아닌 것을 내면 안내만 낸다", () => {
    const { status, context } = runHook(
      { cwd: repo },
      { FAKE_GH_DATA: JSON.stringify({ ...DATA, issues: "oops" }) },
    );
    expect(status).toBe(0);
    expect(context?.hookSpecificOutput.additionalContext).toContain(
      "gh로 이슈·PR을 읽지 못했습니다",
    );
  });

  it("에이전트로 시작한 세션(agent_type 있음)에는 출력하지 않는다", () => {
    const { status, context } = runHook({ cwd: repo, agent_type: "vocals-team:developer" });
    expect(status).toBe(0);
    expect(context).toBeNull();
  });

  it("vocals 레포가 아니면 출력하지 않는다", () => {
    const { status, context } = runHook({ cwd: plainDir });
    expect(status).toBe(0);
    expect(context).toBeNull();
  });

  it("입력 JSON이 깨져도 종료 코드 0", () => {
    const result = spawnSync(process.execPath, [HOOK], {
      input: "{oops",
      encoding: "utf8",
      env: { PATH: withoutGh, CLAUDE_PROJECT_DIR: plainDir },
    });
    expect(result.status).toBe(0);
  });
});

describe("hooks.json SessionStart (이슈 #17 3단계)", () => {
  it("SessionStart 훅이 플러그인 안의 session-context.mjs를 짧은 타임아웃으로 부른다", () => {
    const plugin = fileURLToPath(new URL("../plugins/vocals-team/", import.meta.url));
    const config = JSON.parse(readFileSync(join(plugin, "hooks/hooks.json"), "utf8"));
    const hooks = config.hooks.SessionStart.flatMap((e: { hooks: unknown[] }) => e.hooks) as {
      command: string;
      timeout: number;
    }[];
    expect(hooks).toHaveLength(1);
    expect(hooks[0]?.command).toBe('node "${CLAUDE_PLUGIN_ROOT}/hooks/session-context.mjs"');
    expect(hooks[0]?.timeout).toBeLessThanOrEqual(20);
    expect(() => readFileSync(join(plugin, "hooks/session-context.mjs"))).not.toThrow();
  });
});
