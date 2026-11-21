// harness-report 단위 테스트 (이슈 #17 하네스 6단계): 가짜 로그와 가짜 gh 응답으로 보고 내용을 확인한다.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Gh } from "./harness-report.ts";
import {
  buildReport,
  countPmMarkers,
  fetchCiFailures,
  fetchComments,
  isQaRejection,
  loadRuleIds,
  readLogs,
  runReport,
} from "./harness-report.ts";

const NOW = new Date("2026-11-21T12:00:00Z");
const RULES = {
  "developer.docs": "개발이 docs/ 수정",
  "bash.push-main": "main 직접 push",
  "mcp.supabase": "위험한 Supabase MCP 도구",
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "harness-report-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const event = (ts: string, rule: string, role = "developer", session = "aaaa1111") =>
  JSON.stringify({ ts, session, event: "block", rule, role, tool: "Edit", target: "docs/prd.md" });

function writeLogs(files: Record<string, string[]>) {
  const logs = join(dir, ".claude", "logs");
  mkdirSync(logs, { recursive: true });
  for (const [name, lines] of Object.entries(files)) {
    writeFileSync(join(logs, name), `${lines.join("\n")}\n`);
  }
  return logs;
}

/** 경로 앞부분(쿼리 전)으로 응답을 고르는 가짜 gh. 없는 경로는 실패(null) */
function fakeGh(routes: Record<string, unknown>): Gh & { calls: string[] } {
  const calls: string[] = [];
  const gh = ((path: string) => {
    calls.push(path);
    const key = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((prefix) => path.startsWith(prefix));
    return key === undefined ? null : routes[key];
  }) as Gh & { calls: string[] };
  gh.calls = calls;
  return gh;
}

const R = "repos/{owner}/{repo}";
const comment = (body: string, ref: number, created = "2026-11-20T00:00:00Z") => ({
  body,
  created_at: created,
  issue_url: `https://api.github.com/repos/o/r/issues/${ref}`,
});

describe("harness-report: 훅 차단 로그 집계 (이슈 #17 6단계)", () => {
  it("기간 안의 차단만 규칙별·역할별로 세고, 읽지 못한 줄을 따로 센다", () => {
    const logs = writeLogs({
      "2026-11-20-aaaa1111.jsonl": [
        event("2026-11-20T01:00:00Z", "developer.docs"),
        event("2026-11-20T02:00:00Z", "developer.docs", "developer"),
        event("2026-11-20T03:00:00Z", "bash.push-main", "main"),
        "{not json",
      ],
      "2026-11-01-bbbb2222.jsonl": [
        event("2026-11-01T00:00:00Z", "mcp.supabase", "qa", "bbbb2222"),
      ],
      "readme.txt": ["무시"],
    });
    const data = readLogs(logs);
    expect(data.files).toBe(2);
    expect(data.badLines).toBe(1);
    expect(data.firstTs).toBe("2026-11-01T00:00:00Z");

    const report = buildReport({
      now: NOW,
      days: 7,
      logs: data,
      ruleIds: RULES,
      comments: "skip",
      ci: "skip",
    });
    expect(report).toContain("## 하네스 측정 보고 — 2026-11-14 ~ 2026-11-21 (최근 7일)");
    expect(report).toContain("총 3건, 세션 1개 (로그 파일 2개, 읽지 못한 줄 1개)");
    expect(report).toContain("| `developer.docs` | 2 | developer 2 | 개발이 docs/ 수정 |");
    expect(report).toContain("| `bash.push-main` | 1 | main 1 |");
    expect(report).not.toContain("| `mcp.supabase` |"); // 기간 밖
    expect(report).toContain("| developer | 2 |");
    expect(report).toContain("- 훅 `developer.docs` 2회:");
    expect(report).not.toContain("- 훅 `bash.push-main`");
    // 보고에는 경로(target)를 옮기지 않는다
    expect(report).not.toContain("docs/prd.md");
  });

  it("로그가 없으면 0건이고, 한 번도 안 걸린 규칙은 판단 보류로 쓴다", () => {
    const report = buildReport({
      now: NOW,
      days: 7,
      logs: readLogs(join(dir, "없음")),
      ruleIds: RULES,
      comments: "skip",
      ci: "skip",
    });
    expect(report).toContain("총 0건, 세션 0개 (로그 파일 0개)");
    expect(report).toContain("판단 보류: 로그가 0일치뿐이다");
    expect(report).toContain("`bash.push-main`, `developer.docs`, `mcp.supabase`");
    expect(report).toContain("건너뜀(--no-github)");
  });

  it("로그가 28일 이상 쌓였으면 안 걸린 규칙을 정리 제안한다", () => {
    const logs = writeLogs({
      "x.jsonl": [
        event("2026-10-01T00:00:00Z", "mcp.supabase"),
        event("2026-11-20T00:00:00Z", "developer.docs"),
      ],
    });
    const report = buildReport({
      now: NOW,
      days: 30,
      logs: readLogs(logs),
      ruleIds: RULES,
      comments: "skip",
      ci: "skip",
    });
    expect(report).toContain("정리 제안:");
    expect(report).toContain("2개: `bash.push-main`, `mcp.supabase`");
  });
});

describe("harness-report: 댓글 표식 (이슈 #17 6단계)", () => {
  it("`받는 역할: PM`을 세고 코드 블록·인라인 코드 안은 세지 않는다", () => {
    expect(countPmMarkers("[질문] 받는 역할: PM | 이슈: #17\n[질문] 받는 역할: PM")).toBe(2);
    expect(countPmMarkers("형식은 `[질문] 받는 역할: PM`이다")).toBe(0);
    expect(countPmMarkers("```\n[질문] 받는 역할: PM\n```\n받는 역할: QA")).toBe(0);
    expect(countPmMarkers("받는 역할: PMO")).toBe(0);
  });

  it("[QA 반려]는 첫 줄로만 인정한다", () => {
    expect(isQaRejection("\n[QA 반려] #21 ATT-02 실패\n- 근거")).toBe(true);
    expect(isQaRejection("판정\n[QA 반려]")).toBe(false);
  });

  it("이슈·PR 댓글, 리뷰 코멘트, 리뷰 본문을 기간으로 걸러 모은다", () => {
    const gh = fakeGh({
      [`${R}/issues/comments`]: [
        comment("[질문] 받는 역할: PM | 이슈: #17", 17),
        comment("[QA 반려] ATT-02", 21),
        comment("받는 역할: PM (오래됨)", 17, "2026-11-01T00:00:00Z"),
      ],
      [`${R}/pulls/comments`]: [
        {
          body: "받는 역할: PM",
          created_at: "2026-11-19T00:00:00Z",
          pull_request_url: "https://api.github.com/repos/o/r/pulls/21",
        },
      ],
      [`${R}/pulls?`]: [
        { number: 21, updated_at: "2026-11-20T00:00:00Z" },
        { number: 3, updated_at: "2026-10-01T00:00:00Z" },
      ],
      [`${R}/pulls/21/reviews`]: [
        { body: "[QA 반려] 근거 없음", submitted_at: "2026-11-20T05:00:00Z" },
        { body: "", submitted_at: "2026-11-20T06:00:00Z" },
      ],
    });
    const since = new Date(NOW.getTime() - 7 * 86_400_000);
    const comments = fetchComments(gh, since);
    expect(comments).toHaveLength(4);
    expect(gh.calls.some((c) => c.includes("pulls/3/reviews"))).toBe(false);
    expect(gh.calls[0]).toContain("since=2026-11-14T12%3A00%3A00.000Z");

    const report = buildReport({
      now: NOW,
      days: 7,
      logs: readLogs(dir),
      ruleIds: {},
      comments,
      ci: "skip",
    });
    expect(report).toContain("`받는 역할: PM` 2건 (댓글 4개 중) — #17 1, #21 1");
    expect(report).toContain("`[QA 반려]` 2건 — #21 2");
  });

  it("gh가 실패하면 PM 개입·QA 반려 절만 조회 실패로 쓴다", () => {
    const gh = fakeGh({});
    const since = new Date(NOW.getTime() - 7 * 86_400_000);
    const report = buildReport({
      now: NOW,
      days: 7,
      logs: readLogs(writeLogs({ "a.jsonl": [event("2026-11-20T00:00:00Z", "developer.docs")] })),
      ruleIds: RULES,
      comments: fetchComments(gh, since),
      ci: fetchCiFailures(gh, since),
    });
    expect(report.match(/조회 실패\(gh api\)/g)).toHaveLength(3);
    expect(report).toContain("총 1건");
  });

  it("두 번째 페이지가 실패하면 부분 결과로 세지 않는다", () => {
    const many = Array.from({ length: 100 }, (_, i) => comment(`c${i}`, 17));
    const gh = ((path: string) => (path.includes("page=1") ? many : null)) as Gh;
    expect(fetchComments(gh, new Date(NOW.getTime() - 7 * 86_400_000))).toBeNull();
  });
});

describe("harness-report: CI 실패 원인 (이슈 #17 6단계)", () => {
  const gh = fakeGh({
    [`${R}/actions/runs?`]: {
      workflow_runs: [
        { id: 1, created_at: "2026-11-20T00:00:00Z" },
        { id: 2, created_at: "2026-11-19T00:00:00Z" },
        { id: 3, created_at: "2026-11-01T00:00:00Z" },
      ],
    },
    [`${R}/actions/runs/1/jobs`]: {
      jobs: [
        {
          name: "check",
          conclusion: "failure",
          steps: [
            { name: "Format", conclusion: "failure" },
            { name: "Lint", conclusion: "skipped" },
          ],
        },
        { name: "harness-change", conclusion: "success", steps: [] },
      ],
    },
    [`${R}/actions/runs/2/jobs`]: {
      jobs: [
        {
          name: "check",
          conclusion: "failure",
          steps: [{ name: "Format", conclusion: "failure" }],
        },
        { name: "harness-change", conclusion: "failure", steps: [] },
      ],
    },
  });

  it("실패한 job의 실패 step별로 세고, 2회 이상이면 승격을 제안한다", () => {
    const since = new Date(NOW.getTime() - 7 * 86_400_000);
    const ci = fetchCiFailures(gh, since);
    expect(ci?.failedRuns).toBe(2);
    expect([...(ci?.steps ?? [])]).toEqual([
      ["check › Format", 2],
      ["harness-change › (step 없음)", 1],
    ]);
    expect(gh.calls.some((c) => c.includes("runs/3/jobs"))).toBe(false);
    expect(gh.calls[0]).toContain("created=%3E%3D2026-11-14");

    const report = buildReport({
      now: NOW,
      days: 7,
      logs: readLogs(dir),
      ruleIds: {},
      comments: "skip",
      ci,
    });
    expect(report).toContain("실패한 실행 2개");
    expect(report).toContain("| check › Format | 2 |");
    expect(report).toContain("- CI `check › Format` 2회: 파일을 고친 뒤 `pnpm format`");
    expect(report).not.toContain("- CI `harness-change");
  });
});

describe("harness-report: 실제 규칙 목록 (이슈 #17 6단계)", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));

  it("플러그인 훅의 RULE_IDS를 읽는다", async () => {
    const ids = await loadRuleIds(root);
    expect(Object.keys(ids)).toContain("developer.docs");
    expect(Object.keys(ids)).toContain("mcp.supabase");
  });

  it("--no-github로 저장소 로그만 집계한다", async () => {
    const report = await runReport({ root, days: 7, now: NOW, gh: null });
    expect(report).toContain("### 훅 차단");
    expect(report).toContain("### 한 번도 걸리지 않은 규칙");
  });
});
