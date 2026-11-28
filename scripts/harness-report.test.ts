// harness-report 단위 테스트 (이슈 #17 하네스 6단계, #61 확장): 가짜 로그와 가짜 gh 응답으로 보고 내용을 확인한다.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Gh } from "./harness-report.ts";
import type { IssueInfo, PrInfo, WorkData } from "./harness-report.ts";
import {
  afterAcceptance,
  buildReport,
  classifyStep,
  countPmMarkers,
  countPmQuestions,
  draftDeferSince,
  escapedOrigin,
  fetchCiFailures,
  fetchComments,
  fetchWork,
  isQaRejection,
  issueRows,
  loadRuleIds,
  parseIssueFilter,
  periodsOf,
  prIssueRefs,
  readLogs,
  runReport,
  scopeIssues,
  summarize,
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

const approval = (ts: string, role: string, tool: string) =>
  JSON.stringify({
    ts,
    session: "aaaa1111",
    event: "approval",
    rule: "approval.wait",
    role,
    tool,
    target: null,
  });

function pr(number: number, extra: Partial<PrInfo> = {}): PrInfo {
  return {
    number,
    title: `PR ${number}`,
    body: "",
    state: "closed",
    created: "2026-11-01T00:00:00Z",
    updated: "2026-11-20T00:00:00Z",
    merged: null,
    headRef: `b/${number}`,
    labels: [],
    ...extra,
  };
}

function issue(number: number, created: string, extra: Partial<IssueInfo> = {}): IssueInfo {
  return {
    number,
    title: `이슈 ${number}`,
    body: "",
    state: "open",
    created,
    closed: null,
    labels: [],
    ...extra,
  };
}

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

const ACC = "Acceptance: qa";

describe("harness-report: CI 실패 — 예상된 실패와 실제 실패 (이슈 #17 6단계, #61)", () => {
  const prs: PrInfo[] = [
    pr(58, { state: "open", headRef: "feat/58" }),
    pr(50, { merged: "2026-11-20T10:00:00Z", labels: ["harness"], headRef: "fix/50" }),
    pr(47, { merged: "2026-11-20T10:00:00Z", headRef: "feat/47" }),
  ];
  const failing = (name: string) => ({ name, conclusion: "failure" });
  const gh = fakeGh({
    [`${R}/actions/runs?`]: {
      workflow_runs: [
        // 1: 열린 PR의 라벨 단계(예상) + Format(실제)
        {
          id: 1,
          created_at: "2026-11-20T00:00:00Z",
          head_sha: "h1",
          pull_requests: [{ number: 58 }],
        },
        // 2: 라벨이 붙은 PR의 harness-guard job(예상). PR 번호는 head_branch로 찾는다
        { id: 2, created_at: "2026-11-19T00:00:00Z", head_sha: "h2", head_branch: "fix/50" },
        // 3: 인수 테스트 커밋 뒤 merge 커밋이 head인 Test 실패(예상)
        {
          id: 3,
          created_at: "2026-11-19T01:00:00Z",
          head_sha: "c3",
          pull_requests: [{ number: 47 }],
        },
        // 4: 구현 커밋이 head인 Test(실제), 라벨 없이 merge된 PR의 라벨 단계(실제)
        {
          id: 4,
          created_at: "2026-11-19T02:00:00Z",
          head_sha: "c4",
          pull_requests: [{ number: 47 }],
        },
        // 5: 기간 밖
        { id: 5, created_at: "2026-11-01T00:00:00Z", head_sha: "x" },
      ],
    },
    [`${R}/actions/runs/1/jobs`]: {
      jobs: [
        {
          name: "check",
          conclusion: "failure",
          steps: [
            failing("Format"),
            failing("Harness change label"),
            { name: "Lint", conclusion: "skipped" },
          ],
        },
      ],
    },
    [`${R}/actions/runs/2/jobs`]: {
      jobs: [{ name: "harness-change", conclusion: "failure", steps: [] }],
    },
    [`${R}/actions/runs/3/jobs`]: {
      jobs: [{ name: "check", conclusion: "failure", steps: [failing("Test")] }],
    },
    [`${R}/actions/runs/4/jobs`]: {
      jobs: [
        {
          name: "check",
          conclusion: "failure",
          steps: [failing("Test"), failing("Harness change label")],
        },
      ],
    },
    [`${R}/pulls/47/commits`]: [
      { sha: "c1", commit: { message: `test: #47 인수 테스트\n\n${ACC}\nCo-Authored-By: x` } },
      { sha: "c2", commit: { message: "chore: #47 QA 메모리" } },
      { sha: "c3", commit: { message: "Merge remote-tracking branch 'origin/main' into feat/47" } },
      { sha: "c4", commit: { message: "feat: #47 구현" } },
    ],
  });
  const since = new Date(NOW.getTime() - 7 * 86_400_000);

  it("실패 step을 라벨 단계·인수 테스트 직후 Test·실제 실패로 나눈다", () => {
    const ci = fetchCiFailures(gh, since, prs);
    expect(
      ci?.runs.map((run) => [run.id, run.pr, run.steps.map((s) => `${s.key}=${s.kind}`)]),
    ).toEqual([
      [1, 58, ["check › Format=real", "check › Harness change label=label"]],
      [2, 50, ["harness-change › (step 없음)=label"]],
      [3, 47, ["check › Test=acceptance"]],
      [4, 47, ["check › Test=real", "check › Harness change label=real"]],
    ]);
    // PR 커밋 목록은 PR마다 한 번만 읽는다
    expect(gh.calls.filter((c) => c.includes("pulls/47/commits"))).toHaveLength(1);
    expect(gh.calls.some((c) => c.includes("runs/5/jobs"))).toBe(false);
    expect(gh.calls[0]).toContain("created=%3E%3D2026-11-14");

    const report = buildReport({
      now: NOW,
      days: 7,
      logs: readLogs(dir),
      ruleIds: {},
      comments: "skip",
      ci,
    });
    expect(report).toContain(
      "실패한 실행 4개 — 예상된 실패만 있는 실행 2개, 실제 실패가 있는 실행 2개",
    );
    expect(report).toContain(
      "실패 step 6건 — 라벨 단계 2건, 인수 테스트 직후 Test 1건(예상된 실패), 실제 실패 3건",
    );
    expect(report).toContain("| check › Test | 1 (인수 테스트 직후 Test) | 1 |");
    expect(report).toContain("| check › Harness change label | 1 (라벨 단계) | 1 |");
    expect(report).toContain("| check › Format | 0 | 1 |");
    // 승격 제안은 실제 실패가 2회 이상인 step만
    expect(report).not.toContain("- CI `check › Format`");
  });

  it("실제 실패가 2회 이상인 step만 승격을 제안한다", () => {
    const run = (id: number, kind: "real" | "label") => ({
      id,
      created: "2026-11-20T00:00:00Z",
      pr: 1,
      steps: [{ key: "check › Format", kind }],
    });
    const report = buildReport({
      now: NOW,
      days: 7,
      logs: readLogs(dir),
      ruleIds: {},
      comments: "skip",
      ci: { runs: [run(1, "real"), run(2, "real"), run(3, "label")], truncated: false },
    });
    expect(report).toContain("- CI `check › Format` 실제 실패 2회: 파일을 고친 뒤 `pnpm format`");
  });

  it("afterAcceptance: head부터 거슬러 인수 테스트 커밋을 구현 커밋보다 먼저 만나야 참", () => {
    const commits = [
      { sha: "a", message: "feat: 앞 구현" },
      { sha: "b", message: `test: 인수 테스트\n\n${ACC}` },
      { sha: "c", message: "docs: 메모" },
      { sha: "d", message: "fix(shared): 구현" },
    ];
    expect(afterAcceptance(commits, "c")).toBe(true);
    expect(afterAcceptance(commits, "b")).toBe(true);
    expect(afterAcceptance(commits, "d")).toBe(false);
    expect(afterAcceptance(commits, "a")).toBe(false);
    expect(afterAcceptance(commits, "없음")).toBe(false); // 못 찾으면 마지막 커밋(d)부터
    expect(afterAcceptance([{ sha: "x", message: `본문에 ${ACC}라고 씀` }], "x")).toBe(false);
  });

  it("classifyStep: 라벨 단계는 라벨이 있거나 열린 PR일 때만 예상된 실패", () => {
    const label = (p: { state: string; labels: string[] } | null) =>
      classifyStep("check", "Harness change label", { pr: p, afterAcceptance: false });
    expect(label({ state: "open", labels: [] })).toBe("label");
    expect(label({ state: "closed", labels: ["harness"] })).toBe("label");
    expect(label({ state: "closed", labels: [] })).toBe("real");
    expect(label(null)).toBe("real");
    expect(classifyStep("check", "Test", { pr: null, afterAcceptance: true })).toBe("acceptance");
    expect(classifyStep("check", "Lint", { pr: null, afterAcceptance: true })).toBe("real");
  });

  it("PR 커밋 목록을 못 읽으면 CI 절을 조회 실패로 둔다(부분 결과 없음)", () => {
    const broken = fakeGh({
      [`${R}/actions/runs?`]: {
        workflow_runs: [
          {
            id: 3,
            created_at: "2026-11-19T01:00:00Z",
            head_sha: "c3",
            pull_requests: [{ number: 47 }],
          },
        ],
      },
      [`${R}/actions/runs/3/jobs`]: {
        jobs: [{ name: "check", conclusion: "failure", steps: [failing("Test")] }],
      },
    });
    expect(fetchCiFailures(broken, since, prs)).toBeNull();
  });
});

describe("harness-report: 이슈별 지표 (이슈 #61)", () => {
  const work: WorkData = {
    issues: [
      issue(61, "2026-11-20T00:00:00Z"),
      issue(56, "2026-11-18T00:00:00Z"),
      issue(41, "2026-11-10T00:00:00Z", { state: "closed", closed: "2026-11-11T00:00:00Z" }),
      issue(70, "2026-11-20T06:00:00Z", {
        labels: ["escaped", "bug"],
        body: "증상\n\n원래 이슈: #43\n관련: #56",
      }),
      issue(71, "2026-11-20T07:00:00Z", { labels: ["escaped"], body: "원래 이슈 표시 없음" }),
    ],
    prs: [
      pr(62, { title: "chore: #61 측정", merged: "2026-11-21T00:00:00Z" }),
      pr(63, {
        title: "fix: 후속",
        body: "- 이슈: #61 (근거: #17)",
        merged: "2026-11-20T12:00:00Z",
      }),
      pr(57, { title: "docs: #56 문서", merged: "2026-11-19T00:00:00Z" }),
      pr(58, { title: "feat: #56 앱", state: "open" }),
      pr(43, { title: "feat: 묶음 6", body: "Closes #41", merged: "2026-11-10T12:00:00Z" }),
      pr(44, { title: "docs: #43 PR을 가리킴", merged: "2026-11-10T13:00:00Z" }),
    ],
  };
  const comments = [
    { body: "[QA 반려] ATT-02", ref: "#62", created: "2026-11-20T20:00:00Z" },
    { body: "[QA 반려] 다시", ref: "#61", created: "2026-11-20T21:00:00Z" },
    {
      body: "회의록 — 개발 단계\n- 개발→QA: …\nPM 질문: 2건",
      ref: "#61",
      created: "2026-11-20T22:00:00Z",
    },
    {
      body: "회의록\n- PM 질문: 1건\n```\nPM 질문: 9건\n```",
      ref: "#56",
      created: "2026-11-19T00:00:00Z",
    },
    { body: "[QA 반려] 오래된 반려", ref: "#43", created: "2026-11-10T11:00:00Z" },
  ];

  it("PR 제목의 #번호, 본문의 `이슈: #번호`·Closes만 연결로 본다", () => {
    expect(prIssueRefs({ title: "docs: #35·#38 결정", body: "근거 #17" })).toEqual([35, 38]);
    expect(
      prIssueRefs({ title: "fix: x", body: "- 이슈: #48 (근거: #17, #23)\nCloses #49" }),
    ).toEqual([48, 49]);
    expect(prIssueRefs({ title: "x", body: "이슈 #49. 관련 #12" })).toEqual([49]);
    expect(prIssueRefs({ title: "x", body: "`이슈: #5`는 예시" })).toEqual([]);
  });

  it("escaped 이슈의 원래 이슈는 `원래 이슈: #번호`", () => {
    expect(escapedOrigin({ body: "원래 이슈: #41" })).toBe(41);
    expect(escapedOrigin({ body: "- 원래 이슈 #41" })).toBe(41);
    expect(escapedOrigin({ body: "#41에서 샘" })).toBeNull();
  });

  it("`PM 질문: n건` 줄을 합하고 코드·줄 중간의 글자는 세지 않는다", () => {
    expect(countPmQuestions("회의록\n- PM 질문: 2건\nPM 질문: 1건")).toBe(3);
    expect(countPmQuestions("형식은 `PM 질문: 3건`\n```\nPM 질문: 4건\n```")).toBe(0);
    expect(countPmQuestions("오늘 PM 질문: 5건이 있었다")).toBe(0);
    expect(countPmQuestions("- PM 질문: 0건")).toBe(0);
  });

  it("리드타임(이슈 생성 → 마지막 연결 PR merge), QA 반려, PM 질문, merge 뒤 결함을 이슈마다 낸다", () => {
    const rows = issueRows(work, comments, [61, 56, 41]);
    expect(
      rows.map((r) => [
        r.number,
        r.mergedPrs,
        r.openPrs,
        r.leadMs,
        r.qaRejections,
        r.pmQuestions,
        r.escaped,
      ]),
    ).toEqual([
      [61, [62, 63], [], 86_400_000, 2, 2, []],
      [56, [57], [58], 86_400_000, 0, 1, []],
      // escaped #70은 PR #43을 가리켜 그 PR의 이슈 #41로 센다. #44 제목의 #43은 PR이라 연결하지 않는다
      [41, [43], [], 12 * 3_600_000, 1, 0, [70]],
    ]);
  });

  it("이슈 범위: 기간 안 생성·닫힘·연결 PR merge, 또는 --issues", () => {
    const period = { start: new Date("2026-11-19T00:00:00Z"), end: NOW };
    expect(scopeIssues(work, period, null).sort((a, b) => a - b)).toEqual([56, 61, 70, 71]);
    expect(scopeIssues(work, period, [41, 99])).toEqual([41]);
    expect(parseIssueFilter("50-52,17,#61")).toEqual([17, 50, 51, 52, 61]);
    expect(() => parseIssueFilter("abc")).toThrow("--issues");
  });

  it("보고에 승인 대기, 이슈별 표, escaped 원래 이슈 누락, 지난 보고 대비 표가 나온다", () => {
    const report = buildReport({
      now: NOW,
      days: 3,
      logs: readLogs(
        writeLogs({
          "a.jsonl": [
            event("2026-11-20T01:00:00Z", "qa.scope", "qa"),
            event("2026-11-20T02:00:00Z", "qa.scope", "qa"),
            event("2026-11-16T02:00:00Z", "planner.scope", "planner"),
            approval("2026-11-20T03:00:00Z", "developer", "Edit"),
            approval("2026-11-20T04:00:00Z", "developer", "Edit"),
            approval("2026-11-17T04:00:00Z", "qa", "Bash"),
          ],
        }),
      ),
      ruleIds: RULES,
      comments,
      ci: { runs: [], truncated: false },
      work,
    });
    expect(report).toContain("## 하네스 측정 보고 — 2026-11-18 ~ 2026-11-21 (최근 3일)");
    expect(report).toContain("`approval.wait` 2회");
    expect(report).toContain("역할: developer 2");
    expect(report).toContain("| `Edit` | 2 |");
    expect(report).toContain("회의록 `PM 질문: n건` 합 3건 — #61 2, #56 1");
    expect(report).toContain("| #61 | 열림 | #62 #63 | 1.0일 | 2 | 2 | 0 |");
    expect(report).toContain("| #56 | 열림 | #57 #58(열림) | 1.0일 | 0 | 1 | 0 |");
    expect(report).toContain("본문에 `원래 이슈: #번호`가 없는 것 1개: #71");
    expect(report).toContain(
      "| 지표 | 이번 (2026-11-18 ~ 2026-11-21) | 지난 (2026-11-15 ~ 2026-11-18) | 변화 |",
    );
    expect(report).toContain("| 훅 차단 (건) | 2 | 1 | +1 |");
    expect(report).toContain("| └ 2회 이상 반복된 규칙의 차단 (건) | 2 | 0 | +2 |");
    expect(report).toContain("| 승인 대기 `approval.wait` (회)¹ | 2 | 1 | +1 |");
    expect(report).toContain("| QA 반려 (건) | 2 | 0 | +2 |");
    expect(report).toContain("| merge 뒤 결함 `escaped` 이슈 (건)¹ | 2 | 0 | +2 |");
    expect(report).toContain("| 완료 이슈 (개) | 2 | 0 | +2 |");
    expect(report).toContain("| 완료 이슈 리드타임 중앙값 | 1.0일 | 없음 | — |");
    expect(report).toContain("첫 기록 — 승인 대기: 2026-11-17, 회의록 PM 질문: 2026-11-19");
    // 승인 대기는 차단 집계에 섞이지 않는다
    expect(report).toContain("총 2건, 세션 1개");
    expect(report).not.toContain("| `approval.wait` |");
  });

  it("--since는 그날부터 지금까지, 지난 기간은 같은 길이의 바로 앞", () => {
    const since = new Date("2026-11-19T00:00:00Z");
    const { current, previous } = periodsOf({ now: NOW, days: 7, since });
    expect(current.start.toISOString()).toBe("2026-11-19T00:00:00.000Z");
    expect(previous.start.toISOString()).toBe("2026-11-16T12:00:00.000Z");
    expect(previous.end.toISOString()).toBe("2026-11-19T00:00:00.000Z");
    const report = buildReport({
      now: NOW,
      days: 7,
      since,
      logs: readLogs(dir),
      ruleIds: {},
      comments: "skip",
      ci: "skip",
    });
    expect(report).toContain(
      "## 하네스 측정 보고 — 2026-11-19 ~ 2026-11-21 (2026-11-19부터 2.5일)",
    );
  });

  it("summarize: 조회 실패한 지표는 null, 완료 이슈 리드타임 중앙값", () => {
    const period = { start: new Date("2026-11-01T00:00:00Z"), end: NOW };
    const summary = summarize(period, { logs: readLogs(dir), comments: null, ci: null, work });
    expect(summary.pmMarkers).toBeNull();
    expect(summary.ciRuns).toBeNull();
    expect(summary.doneIssues).toBe(3);
    expect(summary.medianLeadMs).toBe(86_400_000);
  });

  it("fetchWork: 이슈 목록의 PR은 빼고 라벨 이름만 남긴다", () => {
    const gh = fakeGh({
      [`${R}/pulls?state=all`]: [
        {
          number: 62,
          title: "chore: #61",
          body: null,
          state: "closed",
          created_at: "c",
          updated_at: "u",
          merged_at: "m",
          head: { ref: "chore/61" },
          labels: [{ name: "harness" }],
        },
      ],
      [`${R}/issues?state=all`]: [
        { number: 62, pull_request: {}, title: "PR", created_at: "c" },
        {
          number: 61,
          title: "측정",
          body: "b",
          state: "open",
          created_at: "c",
          closed_at: null,
          labels: [{ name: "escaped" }],
        },
      ],
    });
    expect(fetchWork(gh)).toEqual({
      prs: [
        pr(62, {
          title: "chore: #61",
          created: "c",
          updated: "u",
          merged: "m",
          headRef: "chore/61",
          labels: ["harness"],
        }),
      ],
      issues: [issue(61, "c", { title: "측정", body: "b", labels: ["escaped"] })],
    });
    expect(fetchWork(fakeGh({}))).toBeNull();
  });
});

describe("harness-report: draft 판정 보류 뒤의 CI 집계 (이슈 #61, PM 승인 A안)", () => {
  it("판정 보류가 main에 들어간 뒤의 라벨 단계 실패는 ready에서 라벨이 없던 것이라 실제 실패", () => {
    const open = { state: "open", labels: [] };
    const step = (draftDeferred: boolean) =>
      classifyStep("harness-change", "Harness change label", {
        pr: open,
        afterAcceptance: false,
        draftDeferred,
      });
    expect(step(false)).toBe("label");
    expect(step(true)).toBe("real");
    // Test 분류는 그대로
    expect(
      classifyStep("check", "Test", { pr: open, afterAcceptance: true, draftDeferred: true }),
    ).toBe("acceptance");
  });

  it("fetchCiFailures는 보류 시작 뒤의 실행만 새 기준으로 나누고 보고에 시작일을 적는다", () => {
    const gh = fakeGh({
      [`${R}/actions/runs?`]: {
        workflow_runs: [
          { id: 1, created_at: "2026-11-18T00:00:00Z", pull_requests: [{ number: 58 }] },
          { id: 2, created_at: "2026-11-20T00:00:00Z", pull_requests: [{ number: 58 }] },
        ],
      },
      [`${R}/actions/runs/`]: {
        jobs: [{ name: "harness-change", conclusion: "failure", steps: [] }],
      },
    });
    const since = new Date(NOW.getTime() - 7 * 86_400_000);
    const prs = [pr(58, { state: "open" })];
    const ci = fetchCiFailures(gh, since, prs, new Date("2026-11-19T00:00:00Z"));
    expect(ci?.runs.map((run) => run.steps[0]?.kind)).toEqual(["label", "real"]);
    const base = { now: NOW, days: 7, logs: readLogs(dir), ruleIds: {}, comments: "skip" as const };
    expect(buildReport({ ...base, ci })).toContain(
      "draft 판정 보류(#61)가 2026-11-19부터 main에 있다",
    );
    expect(buildReport({ ...base, ci: fetchCiFailures(gh, since, prs) })).toContain(
      "draft 판정 보류(#61)는 아직 main에 없다",
    );
  });

  it("draftDeferSince: main의 harness-guard.yml에 --draft가 들어간 merge 시각(first-parent)", () => {
    const repo = mkdtempSync(join(tmpdir(), "defer-since-"));
    const run = (args: string[], date?: string) =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
        cwd: repo,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: date ? { ...process.env, GIT_COMMITTER_DATE: date } : process.env,
      });
    const file = join(repo, ".github", "workflows", "harness-guard.yml");
    mkdirSync(join(repo, ".github", "workflows"), { recursive: true });
    try {
      run(["init", "-q", "-b", "main"]);
      writeFileSync(file, '--labels "$PR_LABELS" --strict\n');
      run(["add", "-A"]);
      run(["commit", "-qm", "init"], "2026-11-10T00:00:00Z");
      run(["update-ref", "refs/remotes/origin/main", "HEAD"]);
      expect(draftDeferSince(repo)).toBeNull();
      run(["checkout", "-qb", "work"]);
      writeFileSync(file, '--labels "$PR_LABELS" --draft "$PR_DRAFT" --strict\n');
      run(["commit", "-qam", "chore: draft"], "2026-11-15T00:00:00Z");
      run(["checkout", "-q", "main"]);
      run(["merge", "-q", "--no-ff", "-m", "Merge", "work"], "2026-11-20T00:00:00Z");
      run(["update-ref", "refs/remotes/origin/main", "HEAD"]);
      // 브랜치 커밋 시각(11-15)이 아니라 main에 merge된 시각
      expect(draftDeferSince(repo)?.toISOString()).toBe("2026-11-20T00:00:00.000Z");
      expect(draftDeferSince(join(repo, "없음"))).toBeNull();
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
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
