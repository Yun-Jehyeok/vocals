// harness-report — 하네스 측정 보고(이슈 #17 6단계, #61 확장). 기간을 정해 마크다운으로 출력한다.
//
// - 훅 차단: `.claude/logs/*.jsonl`(플러그인 훅이 세션별로 남기고 작업 PR에 커밋한 로그)의 `event: "block"`을 규칙별·역할별로 센다.
// - 승인 대기(#61): 같은 로그의 `event: "approval"`(`rule: "approval.wait"`, PermissionRequest 훅)을 역할별·도구별로 센다.
// - PM 개입: 이슈·PR 댓글(리뷰 포함)의 `받는 역할: PM` 수. 코드 블록·인라인 코드 안의 글자는 세지 않는다.
// - PM 질문(#61): 회의록 댓글의 `PM 질문: n건` 줄의 합(team-lead 스킬 6장).
// - QA 반려: 첫 줄이 `[QA 반려]`로 시작하는 댓글 수.
// - CI 실패(#61): 실패한 워크플로 실행의 실패 job·step을 "예상된 실패"(라벨 단계, `Acceptance: qa` 커밋 뒤 구현 전의 Test)와
//   "실제 실패"로 나눠 센다.
// - 이슈별(#61): 리드타임(이슈 생성 → 그 이슈를 가리키는 마지막 PR merge), QA 반려, PM 질문, merge 뒤 결함(`escaped` 라벨 이슈).
// - 지난 보고 대비(#61): 같은 길이의 바로 앞 기간을 같은 방법으로 다시 계산해 나란히 쓴다.
// - 반복된 실수(같은 규칙·같은 실제 실패 step 2회 이상) → 린트·훅·테스트 승격 제안.
// - 한 번도 걸리지 않은 규칙 → 정리 제안. 로그가 쌓인 기간이 짧으면 판단 보류.
//
// GitHub는 `gh api`(REST)로 읽는다. 클라우드 세션은 GraphQL을 막는다. gh가 실패하면 그 절만 "조회 실패"로 쓴다.
// 로그에는 경로·도구 이름만 있고, 보고에는 규칙·역할·도구·횟수·번호만 쓴다(명령 원문·댓글 본문은 옮기지 않는다).
//
// 사용: node scripts/harness-report.ts [--days 7 | --since 2026-11-19] [--issues 50-61,17] [--no-github] [--now <ISO 시각>]
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEFAULT_DAYS = 7;
/** 이보다 짧게 쌓인 로그로는 "한 번도 안 걸린 규칙"을 정리하자고 하지 않는다 */
export const MIN_DAYS_FOR_UNUSED = 28;
export const APPROVAL_RULE = "approval.wait";
export const ESCAPED_LABEL = "escaped";
export const HARNESS_LABEL = "harness";
const DAY_MS = 24 * 60 * 60 * 1000;
const REPO = "repos/{owner}/{repo}"; // gh가 현재 레포의 origin으로 채운다
const MAX_PAGES = 10;
export const MAX_RUNS = 150;
const MAX_PRS = 50;

export interface BlockEvent {
  ts: string;
  session: string;
  event: string;
  rule: string;
  role: string;
  tool: string;
  target: string | null;
}

/** `gh api <path>`의 JSON. 실패하면 null */
export type Gh = (path: string) => unknown;

export interface LogData {
  events: BlockEvent[];
  files: number;
  badLines: number;
  /** 모든 차단 로그(기간 무관) 중 가장 이른 시각. 로그가 없으면 null */
  firstTs: string | null;
}

export interface Period {
  start: Date;
  end: Date;
}

export function readLogs(dir: string): LogData {
  const data: LogData = { events: [], files: 0, badLines: 0, firstTs: null };
  if (!existsSync(dir)) return data;
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".jsonl")) continue;
    data.files++;
    for (const line of readFileSync(join(dir, name), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as Partial<BlockEvent>;
        if (typeof event.ts !== "string" || Number.isNaN(Date.parse(event.ts))) throw new Error();
        data.events.push({
          ts: event.ts,
          session: String(event.session ?? ""),
          event: String(event.event ?? ""),
          rule: String(event.rule ?? "unknown"),
          role: String(event.role ?? "main"),
          tool: String(event.tool ?? ""),
          target: typeof event.target === "string" ? event.target : null,
        });
        if (event.event === "block" && (data.firstTs === null || event.ts < data.firstTs)) {
          data.firstTs = event.ts;
        }
      } catch {
        data.badLines++;
      }
    }
  }
  return data;
}

/** 코드 블록(```)과 인라인 코드(`…`)를 뺀 본문. 형식 설명에 든 표식을 세지 않으려고 */
export function stripCode(body: string): string {
  return body.replace(/```[\s\S]*?(```|$)/g, "").replace(/`[^`\n]*`/g, "");
}

export function countPmMarkers(body: string): number {
  return stripCode(body).match(/받는\s*역할\s*:\s*PM(?![A-Za-z])/g)?.length ?? 0;
}

/** 회의록의 `PM 질문: n건` 줄의 합(team-lead 스킬 6장, #61). 줄 맨 앞(목록 기호 허용)에 있을 때만 센다 */
export function countPmQuestions(body: string): number {
  let total = 0;
  for (const line of stripCode(body).split("\n")) {
    const match = /^\s*(?:[-*]\s*)?PM\s*질문\s*:\s*(\d+)\s*건/.exec(line);
    if (match) total += Number(match[1]);
  }
  return total;
}

export function isQaRejection(body: string): boolean {
  const first = body.split("\n").find((line) => line.trim() !== "");
  return first?.trim().startsWith("[QA 반려]") ?? false;
}

export interface Comment {
  body: string;
  /** "#17"처럼 이슈·PR 번호. 모르면 "?" */
  ref: string;
  created: string;
}

export interface PrInfo {
  number: number;
  title: string;
  body: string;
  state: string;
  created: string;
  updated: string;
  merged: string | null;
  headRef: string;
  labels: string[];
}

export interface IssueInfo {
  number: number;
  title: string;
  body: string;
  state: string;
  created: string;
  closed: string | null;
  labels: string[];
}

export interface WorkData {
  issues: IssueInfo[];
  prs: PrInfo[];
}

const asArray = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? (value as Record<string, unknown>[]) : [];

const str = (value: unknown) => (typeof value === "string" ? value : "");
const strOrNull = (value: unknown) => (typeof value === "string" ? value : null);
const labelsOf = (value: unknown) =>
  asArray(value)
    .map((label) => str(label.name))
    .filter(Boolean);

/** 페이지를 이어 읽는다. 한 페이지라도 실패하면 null(부분 결과로 세지 않는다) */
function pages(gh: Gh, path: string, pick: (page: unknown) => unknown[]): unknown[] | null {
  const all: unknown[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const result = gh(`${path}${sep}per_page=100&page=${page}`);
    if (result === null || result === undefined) return null;
    const items = pick(result);
    all.push(...items);
    if (items.length < 100) break;
  }
  return all;
}

function refOf(url: unknown): string {
  const match = /\/(?:issues|pull)\/(\d+)/.exec(String(url ?? ""));
  return match ? `#${match[1]}` : "?";
}

/** 모든 PR과 이슈(PR 제외). 리드타임·이슈 연결·escaped·CI 분류에 쓴다 */
export function fetchWork(gh: Gh): WorkData | null {
  const prs = pages(gh, `${REPO}/pulls?state=all&sort=created&direction=desc`, asArray);
  if (prs === null) return null;
  const issues = pages(gh, `${REPO}/issues?state=all&sort=created&direction=desc`, asArray);
  if (issues === null) return null;
  return {
    prs: (prs as Record<string, unknown>[]).map((pr) => ({
      number: Number(pr.number),
      title: str(pr.title),
      body: str(pr.body),
      state: str(pr.state),
      created: str(pr.created_at),
      updated: str(pr.updated_at),
      merged: strOrNull(pr.merged_at),
      headRef: str((pr.head as Record<string, unknown> | undefined)?.ref),
      labels: labelsOf(pr.labels),
    })),
    issues: (issues as Record<string, unknown>[])
      .filter((issue) => !issue.pull_request)
      .map((issue) => ({
        number: Number(issue.number),
        title: str(issue.title),
        body: str(issue.body),
        state: str(issue.state),
        created: str(issue.created_at),
        closed: strOrNull(issue.closed_at),
        labels: labelsOf(issue.labels),
      })),
  };
}

/**
 * 기간 안에 쓴 이슈·PR 댓글, PR 리뷰 코멘트, PR 리뷰 본문.
 * prs를 주면 그 목록에서 리뷰를 읽을 PR을 고른다(없으면 최근 갱신 PR 50개).
 */
export function fetchComments(gh: Gh, since: Date, prs?: PrInfo[]): Comment[] | null {
  const iso = since.toISOString();
  const inWindow = (created: unknown) =>
    typeof created === "string" && Date.parse(created) >= since.getTime();
  const out: Comment[] = [];

  for (const kind of ["issues/comments", "pulls/comments"]) {
    const items = pages(gh, `${REPO}/${kind}?since=${encodeURIComponent(iso)}`, asArray);
    if (items === null) return null;
    for (const item of items as Record<string, unknown>[]) {
      if (!inWindow(item.created_at)) continue;
      const url = item.issue_url ?? item.pull_request_url ?? item.html_url;
      out.push({
        body: String(item.body ?? ""),
        ref: refOf(String(url ?? "").replace("/pulls/", "/pull/")),
        created: String(item.created_at),
      });
    }
  }

  let candidates: { number: number; updated: string }[];
  if (prs) candidates = prs;
  else {
    const list = gh(`${REPO}/pulls?state=all&sort=updated&direction=desc&per_page=${MAX_PRS}`);
    if (list === null || list === undefined) return null;
    candidates = asArray(list).map((pr) => ({
      number: Number(pr.number),
      updated: str(pr.updated_at),
    }));
  }
  for (const pr of candidates) {
    if (!pr.updated || Date.parse(pr.updated) < since.getTime()) continue;
    const reviews = pages(gh, `${REPO}/pulls/${pr.number}/reviews`, asArray);
    if (reviews === null) return null;
    for (const review of reviews as Record<string, unknown>[]) {
      if (!inWindow(review.submitted_at) || !review.body) continue;
      out.push({
        body: String(review.body),
        ref: `#${pr.number}`,
        created: String(review.submitted_at),
      });
    }
  }
  return out;
}

// ---------- 이슈 연결 ----------

/**
 * PR이 가리키는 이슈 번호 후보: 제목의 모든 `#번호`, 본문의 `이슈: #번호`(PR 템플릿, 콜론 뒤 첫 번호),
 * 줄 맨 앞의 `이슈 #번호`, `Closes|Fixes|Resolves #번호`. 문장 속 `이슈 #번호`와 다른 `#번호`(근거·관련 PR)는
 * 연결로 보지 않는다.
 */
export function prIssueRefs(pr: Pick<PrInfo, "title" | "body">): number[] {
  const refs = new Set<number>();
  for (const match of pr.title.matchAll(/#(\d+)/g)) refs.add(Number(match[1]));
  const body = stripCode(pr.body);
  for (const match of body.matchAll(/이슈\s*:\s*#(\d+)|^[ \t]*(?:[-*][ \t]*)?이슈[ \t]+#(\d+)/gm)) {
    refs.add(Number(match[1] ?? match[2]));
  }
  for (const match of body.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi)) {
    refs.add(Number(match[1]));
  }
  return [...refs].sort((a, b) => a - b);
}

/** escaped 이슈의 원래 이슈: 본문의 `원래 이슈: #번호`(team-lead 스킬 6장). 없으면 null */
export function escapedOrigin(issue: Pick<IssueInfo, "body">): number | null {
  const match = /원래\s*이슈\s*:?\s*#(\d+)/.exec(stripCode(issue.body));
  return match ? Number(match[1]) : null;
}

export interface IssueRow {
  number: number;
  title: string;
  state: string;
  created: string;
  /** merge된 연결 PR 번호 */
  mergedPrs: number[];
  openPrs: number[];
  /** 마지막 연결 PR merge 시각 */
  lastMerge: string | null;
  leadMs: number | null;
  qaRejections: number;
  pmQuestions: number;
  escaped: number[];
}

/** 이슈 번호 → 연결 PR. PR 번호를 가리키는 링크(`#43`이 PR)는 버린다 */
export function linkPrs(work: WorkData): Map<number, PrInfo[]> {
  const issueNumbers = new Set(work.issues.map((issue) => issue.number));
  const map = new Map<number, PrInfo[]>();
  for (const pr of work.prs) {
    for (const ref of prIssueRefs(pr)) {
      if (!issueNumbers.has(ref)) continue;
      map.set(ref, [...(map.get(ref) ?? []), pr]);
    }
  }
  return map;
}

/** 이슈별 표의 줄. comments는 기간과 무관하게 그 이슈·연결 PR의 것을 모두 센다 */
export function issueRows(work: WorkData, comments: Comment[], numbers: number[]): IssueRow[] {
  const links = linkPrs(work);
  const byNumber = new Map(work.issues.map((issue) => [issue.number, issue]));
  const prIssues = new Map<number, number[]>();
  for (const [issue, prs] of links) {
    for (const pr of prs) prIssues.set(pr.number, [...(prIssues.get(pr.number) ?? []), issue]);
  }
  // escaped 이슈 → 원래 이슈(원래 번호가 PR이면 그 PR이 가리키는 이슈)
  const escapedBy = new Map<number, number[]>();
  for (const issue of work.issues) {
    if (!issue.labels.includes(ESCAPED_LABEL)) continue;
    const origin = escapedOrigin(issue);
    if (origin === null) continue;
    const targets = byNumber.has(origin) ? [origin] : (prIssues.get(origin) ?? []);
    for (const target of targets) {
      escapedBy.set(target, [...(escapedBy.get(target) ?? []), issue.number]);
    }
  }
  const rows: IssueRow[] = [];
  for (const number of numbers) {
    const issue = byNumber.get(number);
    if (!issue) continue;
    const prs = links.get(number) ?? [];
    const merged = prs.filter((pr) => pr.merged).sort((a, b) => a.number - b.number);
    const lastMerge =
      merged
        .map((pr) => pr.merged as string)
        .sort()
        .at(-1) ?? null;
    const refs = new Set([`#${number}`, ...prs.map((pr) => `#${pr.number}`)]);
    const mine = comments.filter((c) => refs.has(c.ref));
    rows.push({
      number,
      title: issue.title,
      state: issue.state,
      created: issue.created,
      mergedPrs: merged.map((pr) => pr.number),
      openPrs: prs.filter((pr) => !pr.merged && pr.state === "open").map((pr) => pr.number),
      lastMerge,
      leadMs: lastMerge ? Date.parse(lastMerge) - Date.parse(issue.created) : null,
      qaRejections: mine.filter((c) => isQaRejection(c.body)).length,
      pmQuestions: mine.reduce((sum, c) => sum + countPmQuestions(c.body), 0),
      escaped: (escapedBy.get(number) ?? []).sort((a, b) => a - b),
    });
  }
  return rows.sort((a, b) => b.number - a.number);
}

const inPeriod = (ts: string | null | undefined, period: Period) =>
  typeof ts === "string" &&
  Date.parse(ts) >= period.start.getTime() &&
  Date.parse(ts) < period.end.getTime();

/**
 * 이슈 범위. filter가 있으면 그 번호들, 없으면 기간 안에 만들어졌거나 닫혔거나 연결 PR이 merge된 이슈.
 * escaped 이슈 자체는 결함 기록이라 범위에 넣되, 원래 이슈 쪽 칸에서도 센다.
 */
export function scopeIssues(work: WorkData, period: Period, filter: number[] | null): number[] {
  if (filter) return filter.filter((n) => work.issues.some((issue) => issue.number === n));
  const links = linkPrs(work);
  return work.issues
    .filter(
      (issue) =>
        inPeriod(issue.created, period) ||
        inPeriod(issue.closed, period) ||
        (links.get(issue.number) ?? []).some((pr) => inPeriod(pr.merged, period)),
    )
    .map((issue) => issue.number);
}

/** `50-61,17` → [17, 50, …, 61] */
export function parseIssueFilter(text: string): number[] {
  const out = new Set<number>();
  for (const part of text.split(",")) {
    const range = /^\s*#?(\d+)\s*(?:-\s*#?(\d+))?\s*$/.exec(part);
    if (!range) throw new Error(`--issues 형식: 50-61,17 (받은 값: ${part})`);
    const from = Number(range[1]);
    const to = range[2] === undefined ? from : Number(range[2]);
    for (let n = Math.min(from, to); n <= Math.max(from, to); n++) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

// ---------- CI ----------

export type CiKind = "label" | "acceptance" | "repro" | "real";

export interface CiStep {
  /** "job › step" */
  key: string;
  kind: CiKind;
}

export interface CiRun {
  id: number;
  created: string;
  pr: number | null;
  steps: CiStep[];
}

export interface CiData {
  runs: CiRun[];
  truncated: boolean;
  /** draft 판정 보류(#61)가 main에 들어간 시각. 아직이면 null */
  draftDeferSince?: string | null;
}

/**
 * draft 판정 보류(`--draft "$PR_DRAFT"`)가 main의 harness-guard.yml에 들어간 시각(first-parent의 merge 시각).
 * 그 뒤 draft PR의 라벨 누락은 실패가 아니라 경고라 CI 실패 목록에 나오지 않는다. git이 실패하거나 아직이면 null.
 */
export function draftDeferSince(cwd: string, ref = "origin/main"): Date | null {
  try {
    const out = execFileSync(
      "git",
      [
        "log",
        ref,
        "--first-parent",
        "-m",
        "--format=%cI",
        '-S--draft "$PR_DRAFT"',
        "--",
        ".github/workflows/harness-guard.yml",
      ],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 },
    )
      .trim()
      .split("\n")
      .filter(Boolean);
    const first = out.at(-1);
    return first ? new Date(first) : null;
  } catch {
    return null;
  }
}

export interface CommitInfo {
  sha: string;
  message: string;
  /** 커밋 시각(committer date). 모르면 "" */
  date?: string;
}

const TEST_COMMIT = /^test(\([^)]*\))?!?:/;

/**
 * head 커밋이 "QA 반려 뒤의 QA 재현 테스트 커밋"인가(#61 QA 반려 F3, QA 추천 A).
 * head가 `test:` 커밋이고(트레일러 없음도 포함) 그 PR에 그 커밋보다 먼저 쓴 `[QA 반려]`가 있으면 참.
 * 재현 테스트는 버그를 보이려고 일부러 실패하므로 그때의 Test 실패는 예상된 것이다.
 */
export function qaReproAfterRejection(
  commits: CommitInfo[],
  headSha: string,
  rejectedAt: string[],
): boolean {
  const head = commits.find((c) => c.sha === headSha) ?? commits.at(-1);
  if (!head || !TEST_COMMIT.test(head.message)) return false;
  const at = Date.parse(head.date ?? "");
  if (Number.isNaN(at)) return false;
  return rejectedAt.some((ts) => Date.parse(ts) < at);
}

export const ACCEPTANCE_TRAILER = /^Acceptance:\s*qa\s*$/im;
const IMPLEMENTATION = /^(feat|fix|refactor)(\([^)]*\))?!?:/;

/**
 * head 커밋이 "QA의 인수 테스트 커밋 뒤, 구현 커밋 전"인가(CLAUDE.md: 그때의 Test 실패는 예상된 것).
 * PR 커밋 목록(오래된 순)에서 head부터 거슬러 올라가 `Acceptance: qa` 커밋을 먼저 만나면 참,
 * 구현 커밋(feat·fix·refactor)을 먼저 만나거나 끝까지 없으면 거짓. chore·docs·test·merge 커밋은 건너뛴다.
 */
export function afterAcceptance(commits: CommitInfo[], headSha: string): boolean {
  let index = commits.findIndex((c) => c.sha === headSha);
  if (index < 0) index = commits.length - 1;
  for (let i = index; i >= 0; i--) {
    const message = commits[i]?.message ?? "";
    if (ACCEPTANCE_TRAILER.test(message)) return true;
    if (IMPLEMENTATION.test(message)) return false;
  }
  return false;
}

/**
 * 실패 step 하나의 분류.
 * - label: "Harness change label" 단계(또는 harness-guard job). PR이 지금 `harness` 라벨을 가졌거나 아직 열려 있으면
 *   라벨을 붙이기 전 push로 본다. 라벨 없이 닫히거나 merge된 PR, PR을 모르는 실행은 실제 실패.
 *   draftDeferred(#61: draft 판정 보류가 main에 들어간 뒤의 실행)면 draft는 실패하지 않으므로, 라벨 단계 실패는
 *   ready 상태에서 라벨이 없던 것(절차 누락)이라 실제 실패다.
 * - acceptance: check › Test이고 head가 인수 테스트 커밋 뒤 구현 전.
 * - repro: check › Test이고 head가 `[QA 반려]` 뒤의 QA 재현 `test:` 커밋(#61 F3).
 * - real: 나머지.
 */
export function classifyStep(
  job: string,
  step: string,
  ctx: {
    pr: Pick<PrInfo, "state" | "labels"> | null;
    afterAcceptance: boolean;
    qaRepro?: boolean;
    draftDeferred?: boolean;
  },
): CiKind {
  if (/harness change label/i.test(step) || (job === "harness-change" && step === "(step 없음)")) {
    if (ctx.draftDeferred) return "real";
    if (ctx.pr && (ctx.pr.labels.includes(HARNESS_LABEL) || ctx.pr.state === "open")) {
      return "label";
    }
    return "real";
  }
  if (job === "check" && step === "Test" && ctx.afterAcceptance) return "acceptance";
  if (job === "check" && step === "Test" && ctx.qaRepro) return "repro";
  return "real";
}

/**
 * comments: `[QA 반려]` 시각을 PR별로 찾는 데 쓴다(#61 F3). null이면 재현 커밋 분류를 하지 않는다.
 */
export function fetchCiFailures(
  gh: Gh,
  since: Date,
  prs: PrInfo[] | null = null,
  deferSince: Date | null = null,
  comments: Comment[] | null = null,
): CiData | null {
  const date = since.toISOString().slice(0, 10);
  const runs = pages(
    gh,
    `${REPO}/actions/runs?status=failure&created=${encodeURIComponent(`>=${date}`)}`,
    (page) => asArray((page as { workflow_runs?: unknown })?.workflow_runs),
  );
  if (runs === null) return null;
  const recent = (runs as Record<string, unknown>[]).filter(
    (run) => typeof run.created_at === "string" && Date.parse(run.created_at) >= since.getTime(),
  );
  const data: CiData = {
    runs: [],
    truncated: recent.length > MAX_RUNS,
    draftDeferSince: deferSince ? deferSince.toISOString() : null,
  };
  const commitCache = new Map<number, CommitInfo[] | null>();
  const prCommits = (number: number) => {
    if (!commitCache.has(number)) {
      const list = pages(gh, `${REPO}/pulls/${number}/commits`, asArray);
      commitCache.set(
        number,
        list === null
          ? null
          : (list as Record<string, unknown>[]).map((c) => ({
              sha: str(c.sha),
              message: str((c.commit as Record<string, unknown> | undefined)?.message),
              date: str(
                (
                  (c.commit as Record<string, unknown> | undefined)?.committer as
                    Record<string, unknown> | undefined
                )?.date,
              ),
            })),
      );
    }
    return commitCache.get(number) ?? null;
  };

  for (const run of recent.slice(0, MAX_RUNS)) {
    const jobs = gh(`${REPO}/actions/runs/${String(run.id)}/jobs?filter=latest&per_page=100`);
    if (jobs === null || jobs === undefined) return null;
    const fromRun = asArray(run.pull_requests)[0]?.number;
    const prNumber =
      typeof fromRun === "number"
        ? fromRun
        : (prs
            ?.filter((pr) => pr.headRef && pr.headRef === str(run.head_branch))
            .sort((a, b) => b.number - a.number)[0]?.number ?? null);
    const pr = prNumber === null ? null : (prs?.find((p) => p.number === prNumber) ?? null);
    const steps: CiStep[] = [];
    for (const job of asArray((jobs as { jobs?: unknown }).jobs)) {
      if (job.conclusion !== "failure") continue;
      const failed = asArray(job.steps).filter((step) => step.conclusion === "failure");
      const names = failed.length > 0 ? failed.map((step) => String(step.name)) : ["(step 없음)"];
      for (const name of names) {
        const jobName = String(job.name);
        let after = false;
        let repro = false;
        if (jobName === "check" && name === "Test" && prNumber !== null) {
          const commits = prCommits(prNumber);
          if (commits === null) return null;
          after = afterAcceptance(commits, str(run.head_sha));
          const rejectedAt = (comments ?? [])
            .filter((c) => c.ref === `#${prNumber}` && isQaRejection(c.body))
            .map((c) => c.created);
          repro = qaReproAfterRejection(commits, str(run.head_sha), rejectedAt);
        }
        steps.push({
          key: `${jobName} › ${name}`,
          kind: classifyStep(jobName, name, {
            pr,
            afterAcceptance: after,
            qaRepro: repro,
            draftDeferred:
              deferSince !== null && Date.parse(str(run.created_at)) >= deferSince.getTime(),
          }),
        });
      }
    }
    data.runs.push({ id: Number(run.id), created: str(run.created_at), pr: prNumber, steps });
  }
  return data;
}

/** 반복되는 CI 실패 step에 맞는 승격 제안 */
export function ciSuggestion(step: string): string {
  if (/format|prettier/i.test(step)) {
    return "파일을 고친 뒤 `pnpm format`을 돌리는 PostToolUse 훅이나 에이전트 정의의 끝내기 절차로 앞당기기";
  }
  if (/lint|eslint/i.test(step)) {
    return "바뀐 파일만 eslint하는 PostToolUse 훅으로 앞당기기";
  }
  if (/harness change label/i.test(step)) {
    return "라벨 없이 닫히거나 merge된 PR의 라벨 단계 실패다. 하네스를 바꾼 작업 PR이 라벨 없이 섞였는지 본다";
  }
  if (/acceptance|migration|harness|trace|erd/i.test(step)) {
    return "같은 규칙을 PreToolUse 훅에서 먼저 막을 수 있는지 검토(지금은 CI에서야 걸림)";
  }
  if (/typecheck|test/i.test(step)) {
    return "실패 원인을 공유 규칙 함수·테스트로 고정하고, 개발 정의에 끝내기 전 `pnpm check` 확인을 강조";
  }
  return "실패 원인을 테스트로 고정하거나 훅으로 앞당길지 검토";
}

// ---------- 보고 ----------

export interface ReportInput {
  now: Date;
  /** 기간 길이(일). since가 없을 때 시작 = now - days */
  days: number;
  /** 기간 시작(--since). 있으면 days 대신 쓴다 */
  since?: Date | undefined;
  logs: LogData;
  ruleIds: Record<string, string>;
  /** null = 조회 실패, "skip" = --no-github */
  comments: Comment[] | null | "skip";
  ci: CiData | null | "skip";
  /** 이슈·PR 목록. 없으면(undefined) "skip"과 같다 */
  work?: WorkData | null | "skip";
  /** --issues. null이면 기간으로 고른다 */
  issueFilter?: number[] | null;
}

const day = (date: Date) => date.toISOString().slice(0, 10);

/** 이번 기간과 같은 길이의 바로 앞 기간 */
export function periodsOf(input: Pick<ReportInput, "now" | "days" | "since">): {
  current: Period;
  previous: Period;
} {
  const end = input.now;
  const start = input.since ?? new Date(end.getTime() - input.days * DAY_MS);
  const length = end.getTime() - start.getTime();
  return {
    current: { start, end },
    previous: { start: new Date(start.getTime() - length), end: start },
  };
}

function countBy<T>(items: T[], key: (item: T) => string): [string, number][] {
  const map = new Map<string, number>();
  for (const item of items) map.set(key(item), (map.get(key(item)) ?? 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function refsSummary(comments: Comment[], count: (c: Comment) => number): string {
  const byRef = new Map<string, number>();
  for (const comment of comments) {
    const n = count(comment);
    if (n > 0) byRef.set(comment.ref, (byRef.get(comment.ref) ?? 0) + n);
  }
  return [...byRef.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([ref, n]) => `${ref} ${n}`)
    .join(", ");
}

/** 1.5일, 5.0시간 */
export function formatDuration(ms: number): string {
  return ms >= DAY_MS ? `${(ms / DAY_MS).toFixed(1)}일` : `${(ms / 3_600_000).toFixed(1)}시간`;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** 지난 보고 대비 표에 쓰는 지표. null = 조회 실패·건너뜀 */
export interface Summary {
  blocks: number;
  repeatedBlocks: number;
  approvals: number;
  ciRuns: number | null;
  ciExpectedRuns: number | null;
  ciRealRuns: number | null;
  ciRealSteps: number | null;
  pmMarkers: number | null;
  pmQuestions: number | null;
  qaRejections: number | null;
  escaped: number | null;
  doneIssues: number | null;
  medianLeadMs: number | null | undefined;
}

const runExpected = (run: CiRun) =>
  run.steps.length > 0 && run.steps.every((s) => s.kind !== "real");

export function summarize(
  period: Period,
  input: Pick<ReportInput, "logs" | "comments" | "ci" | "work" | "issueFilter">,
): Summary {
  const events = input.logs.events.filter((e) => inPeriod(e.ts, period));
  const blocks = events.filter((e) => e.event === "block");
  const byRule = countBy(blocks, (e) => e.rule);
  const comments = Array.isArray(input.comments)
    ? input.comments.filter((c) => inPeriod(c.created, period))
    : null;
  const ci = input.ci && input.ci !== "skip" ? input.ci : null;
  const runs = ci ? ci.runs.filter((run) => inPeriod(run.created, period)) : null;
  const work = input.work && input.work !== "skip" ? input.work : null;
  let doneIssues: number | null = null;
  let medianLeadMs: number | null | undefined;
  if (work) {
    const links = linkPrs(work);
    const filter = input.issueFilter ? new Set(input.issueFilter) : null;
    const leads: number[] = [];
    for (const issue of work.issues) {
      if (filter && !filter.has(issue.number)) continue;
      const last = (links.get(issue.number) ?? [])
        .map((pr) => pr.merged)
        .filter((m): m is string => m !== null)
        .sort()
        .at(-1);
      if (last && inPeriod(last, period)) leads.push(Date.parse(last) - Date.parse(issue.created));
    }
    doneIssues = leads.length;
    medianLeadMs = median(leads);
  }
  return {
    blocks: blocks.length,
    repeatedBlocks: byRule.filter(([, n]) => n >= 2).reduce((sum, [, n]) => sum + n, 0),
    approvals: events.filter((e) => e.event === "approval").length,
    ciRuns: runs ? runs.length : null,
    ciExpectedRuns: runs ? runs.filter(runExpected).length : null,
    ciRealRuns: runs ? runs.filter((run) => !runExpected(run)).length : null,
    ciRealSteps: runs ? runs.flatMap((r) => r.steps).filter((s) => s.kind === "real").length : null,
    pmMarkers: comments ? comments.reduce((sum, c) => sum + countPmMarkers(c.body), 0) : null,
    pmQuestions: comments ? comments.reduce((sum, c) => sum + countPmQuestions(c.body), 0) : null,
    qaRejections: comments ? comments.filter((c) => isQaRejection(c.body)).length : null,
    escaped: work
      ? work.issues.filter((i) => i.labels.includes(ESCAPED_LABEL) && inPeriod(i.created, period))
          .length
      : null,
    doneIssues,
    medianLeadMs: work ? medianLeadMs : undefined,
  };
}

function compareRows(current: Summary, previous: Summary): string[] {
  const num = (value: number | null) => (value === null ? "—" : String(value));
  const diff = (a: number | null, b: number | null) => {
    if (a === null || b === null) return "—";
    const d = a - b;
    return d > 0 ? `+${d}` : String(d);
  };
  const lead = (value: number | null | undefined) =>
    value === undefined ? "—" : value === null ? "없음" : formatDuration(value);
  const leadDiff = (a: number | null | undefined, b: number | null | undefined) => {
    if (typeof a !== "number" || typeof b !== "number") return "—";
    const d = a - b;
    return `${d > 0 ? "+" : d < 0 ? "−" : ""}${formatDuration(Math.abs(d))}`;
  };
  const rows: [string, number | null, number | null][] = [
    ["훅 차단 (건)", current.blocks, previous.blocks],
    ["└ 2회 이상 반복된 규칙의 차단 (건)", current.repeatedBlocks, previous.repeatedBlocks],
    ["승인 대기 `approval.wait` (회)¹", current.approvals, previous.approvals],
    ["CI 실패한 실행 (개)", current.ciRuns, previous.ciRuns],
    ["└ 예상된 실패만 있는 실행 (개)", current.ciExpectedRuns, previous.ciExpectedRuns],
    ["└ 실제 실패가 있는 실행 (개)", current.ciRealRuns, previous.ciRealRuns],
    ["CI 실제 실패 step (건)", current.ciRealSteps, previous.ciRealSteps],
    ["`받는 역할: PM` (건)", current.pmMarkers, previous.pmMarkers],
    ["회의록 PM 질문 (건)¹", current.pmQuestions, previous.pmQuestions],
    ["QA 반려 (건)", current.qaRejections, previous.qaRejections],
    ["merge 뒤 결함 `escaped` 이슈 (건)¹", current.escaped, previous.escaped],
    ["완료 이슈 (개)", current.doneIssues, previous.doneIssues],
  ];
  return [
    ...rows.map(([name, a, b]) => `| ${name} | ${num(a)} | ${num(b)} | ${diff(a, b)} |`),
    `| 완료 이슈 리드타임 중앙값 | ${lead(current.medianLeadMs)} | ${lead(previous.medianLeadMs)} | ${leadDiff(current.medianLeadMs, previous.medianLeadMs)} |`,
  ];
}

const KIND_LABEL: Record<CiKind, string> = {
  label: "라벨 단계",
  acceptance: "인수 테스트 직후 Test",
  repro: "QA 반려 뒤 재현 테스트",
  real: "실제 실패",
};
const EXPECTED_KINDS: CiKind[] = ["label", "acceptance", "repro"];

export function buildReport(input: ReportInput): string {
  const { now, logs, ruleIds, comments, ci } = input;
  const work = input.work ?? "skip";
  const { current, previous } = periodsOf(input);
  const since = current.start;
  const spanDays = (now.getTime() - since.getTime()) / DAY_MS;
  const inCurrent = (ts: string) =>
    Date.parse(ts) >= since.getTime() && Date.parse(ts) <= now.getTime();
  const allEvents = logs.events.filter((e) => inCurrent(e.ts));
  const events = allEvents.filter((e) => e.event === "block");
  const approvals = allEvents.filter((e) => e.event === "approval");
  const out: string[] = [];
  const label = input.since
    ? `${day(since)}부터 ${Number.isInteger(spanDays) ? spanDays : spanDays.toFixed(1)}일`
    : `최근 ${input.days}일`;
  out.push(`## 하네스 측정 보고 — ${day(since)} ~ ${day(now)} (${label})`, "");

  // 훅 차단
  out.push("### 훅 차단", "");
  const sessions = new Set(events.map((e) => e.session)).size;
  out.push(
    `총 ${events.length}건, 세션 ${sessions}개 (로그 파일 ${logs.files}개${logs.badLines ? `, 읽지 못한 줄 ${logs.badLines}개` : ""})`,
  );
  const byRule = countBy(events, (e) => e.rule);
  if (events.length > 0) {
    out.push("", "| 규칙 | 횟수 | 역할 | 설명 |", "| --- | --- | --- | --- |");
    for (const [rule, n] of byRule) {
      const roles = countBy(
        events.filter((e) => e.rule === rule),
        (e) => e.role,
      )
        .map(([role, k]) => `${role} ${k}`)
        .join(", ");
      out.push(`| \`${rule}\` | ${n} | ${roles} | ${ruleIds[rule] ?? "(목록에 없는 규칙)"} |`);
    }
    out.push("", "| 역할 | 횟수 |", "| --- | --- |");
    for (const [role, n] of countBy(events, (e) => e.role)) out.push(`| ${role} | ${n} |`);
  }
  out.push("");

  // 승인 대기
  out.push("### 승인 대기", "");
  out.push(
    `\`${APPROVAL_RULE}\` ${approvals.length}회 (PermissionRequest 훅, 역할·도구 이름만 기록)`,
  );
  if (approvals.length > 0) {
    const roles = countBy(approvals, (e) => e.role)
      .map(([role, n]) => `${role} ${n}`)
      .join(", ");
    out.push("", `역할: ${roles}`, "", "| 도구 | 횟수 |", "| --- | --- |");
    for (const [tool, n] of countBy(approvals, (e) => e.tool || "(없음)")) {
      out.push(`| \`${tool}\` | ${n} |`);
    }
  }
  out.push("");

  // PM 개입·QA 반려
  const githubLine = (value: unknown) =>
    value === "skip" ? "건너뜀(--no-github)" : "조회 실패(gh api)";
  const windowComments = Array.isArray(comments)
    ? comments.filter((c) => inCurrent(c.created))
    : null;
  out.push("### PM 개입", "");
  if (windowComments) {
    const total = windowComments.reduce((sum, c) => sum + countPmMarkers(c.body), 0);
    const refs = refsSummary(windowComments, (c) => countPmMarkers(c.body));
    out.push(
      `\`받는 역할: PM\` ${total}건 (댓글 ${windowComments.length}개 중)${refs ? ` — ${refs}` : ""}`,
    );
    const questions = windowComments.reduce((sum, c) => sum + countPmQuestions(c.body), 0);
    const qRefs = refsSummary(windowComments, (c) => countPmQuestions(c.body));
    out.push("", `회의록 \`PM 질문: n건\` 합 ${questions}건${qRefs ? ` — ${qRefs}` : ""}`);
  } else out.push(githubLine(comments));
  out.push("", "### QA 반려", "");
  if (windowComments) {
    const rejected = windowComments.filter((c) => isQaRejection(c.body));
    const refs = refsSummary(rejected, () => 1);
    out.push(`\`[QA 반려]\` ${rejected.length}건${refs ? ` — ${refs}` : ""}`);
  } else out.push(githubLine(comments));
  out.push("");

  // CI 실패 원인
  out.push("### CI 실패 원인", "");
  const runs = ci && ci !== "skip" ? ci.runs.filter((run) => inCurrent(run.created)) : [];
  const realSteps = new Map<string, number>();
  if (ci && ci !== "skip") {
    const expected = runs.filter(runExpected);
    const steps = runs.flatMap((run) => run.steps);
    const kindCount = (kind: CiKind) => steps.filter((s) => s.kind === kind).length;
    out.push(
      `실패한 실행 ${runs.length}개${ci.truncated ? ` (앞 ${MAX_RUNS}개만 봄)` : ""} — 예상된 실패만 있는 실행 ${expected.length}개, 실제 실패가 있는 실행 ${runs.length - expected.length}개`,
      "",
      `실패 step ${steps.length}건 — 라벨 단계 ${kindCount("label")}건, 인수 테스트 직후 Test ${kindCount("acceptance")}건, QA 반려 뒤 재현 테스트 ${kindCount("repro")}건(여기까지 예상된 실패), 실제 실패 ${kindCount("real")}건`,
    );
    const table = new Map<string, Record<CiKind, number>>();
    for (const step of steps) {
      const row = table.get(step.key) ?? { label: 0, acceptance: 0, repro: 0, real: 0 };
      row[step.kind]++;
      table.set(step.key, row);
      if (step.kind === "real") realSteps.set(step.key, (realSteps.get(step.key) ?? 0) + 1);
    }
    if (table.size > 0) {
      out.push("", "| job › 실패 step | 예상된 실패 | 실제 실패 |", "| --- | --- | --- |");
      const total = (r: Record<CiKind, number>) => r.label + r.acceptance + r.repro + r.real;
      for (const [key, row] of [...table.entries()].sort(
        (a, b) => total(b[1]) - total(a[1]) || a[0].localeCompare(b[0]),
      )) {
        const parts = EXPECTED_KINDS.filter((kind) => row[kind] > 0).map(
          (kind) => `${row[kind]} (${KIND_LABEL[kind]})`,
        );
        out.push(`| ${key} | ${parts.length > 0 ? parts.join(", ") : "0"} | ${row.real} |`);
      }
    }
    out.push(
      "",
      "예상된 실패: 라벨 단계는 PR이 `harness` 라벨을 가졌거나 아직 열려 있을 때(라벨 전 push). Test는 PR의 head가 `Acceptance: qa` 커밋 뒤·구현 커밋(feat·fix·refactor) 전일 때, 또는 head가 그 PR의 `[QA 반려]` 뒤에 올린 `test:` 커밋(QA 재현 테스트)일 때.",
      "",
      ci.draftDeferSince
        ? `draft 판정 보류(#61)가 ${day(new Date(ci.draftDeferSince))}부터 main에 있다. 그 뒤 draft PR의 라벨 누락은 실패가 아니라 경고(어노테이션)라 이 집계에 없고, 그 뒤의 라벨 단계 실패는 ready 상태에서 라벨이 없던 것이라 실제 실패로 센다.`
        : "draft 판정 보류(#61)는 아직 main에 없다. 라벨 단계 실패는 위 기준으로 나눈다.",
    );
  } else out.push(githubLine(ci));
  out.push("");

  // 이슈별
  out.push("### 이슈별", "");
  if (work !== "skip" && work !== null && Array.isArray(comments)) {
    const numbers = scopeIssues(work, current, input.issueFilter ?? null);
    const rows = issueRows(work, comments, numbers);
    out.push(
      input.issueFilter
        ? `범위: --issues로 고른 이슈 ${rows.length}개`
        : `범위: 기간 안에 만들어졌거나 닫혔거나 연결 PR이 merge된 이슈 ${rows.length}개`,
    );
    if (rows.length > 0) {
      out.push(
        "",
        "| 이슈 | 상태 | 연결 PR | 리드타임 | QA 반려 | PM 질문 | merge 뒤 결함 |",
        "| --- | --- | --- | --- | --- | --- | --- |",
      );
      for (const row of rows) {
        const prs = [
          ...row.mergedPrs.map((n) => `#${n}`),
          ...row.openPrs.map((n) => `#${n}(열림)`),
        ].join(" ");
        const lead =
          row.leadMs === null
            ? row.state === "open"
              ? "진행 중"
              : "merge 없음"
            : formatDuration(row.leadMs);
        const escaped = row.escaped.length
          ? `${row.escaped.length} (${row.escaped.map((n) => `#${n}`).join(" ")})`
          : "0";
        out.push(
          `| #${row.number} | ${row.state === "open" ? "열림" : "닫힘"} | ${prs || "없음"} | ${lead} | ${row.qaRejections} | ${row.pmQuestions} | ${escaped} |`,
        );
      }
    }
    const orphan = work.issues.filter(
      (i) => i.labels.includes(ESCAPED_LABEL) && escapedOrigin(i) === null,
    );
    if (orphan.length > 0) {
      out.push(
        "",
        `\`${ESCAPED_LABEL}\` 이슈 중 본문에 \`원래 이슈: #번호\`가 없는 것 ${orphan.length}개: ${orphan.map((i) => `#${i.number}`).join(", ")}`,
      );
    }
    out.push(
      "",
      "리드타임: 이슈 생성 → 그 이슈를 가리키는 마지막 PR merge(PR 제목의 `#번호`, 본문의 `이슈: #번호`·`Closes #번호`). QA 반려·PM 질문은 이슈와 연결 PR의 댓글·리뷰 전체(기간 무관, 댓글은 지난 기간 시작이나 범위 이슈 생성 중 이른 때부터 읽음).",
    );
  } else if (work === "skip" || comments === "skip") out.push(githubLine("skip"));
  else out.push(githubLine(null));
  out.push("");

  // 지난 보고 대비
  out.push("### 지난 보고 대비", "");
  const summaryInput = {
    logs,
    comments,
    ci,
    work,
    issueFilter: input.issueFilter ?? null,
  };
  // 이번 기간은 끝 시각을 포함한다(보고 시각에 찍힌 이벤트까지)
  const currentSummary = summarize(
    { start: current.start, end: new Date(now.getTime() + 1) },
    summaryInput,
  );
  const previousSummary = summarize(previous, summaryInput);
  out.push(
    `| 지표 | 이번 (${day(current.start)} ~ ${day(now)}) | 지난 (${day(previous.start)} ~ ${day(previous.end)}) | 변화 |`,
    "| --- | --- | --- | --- |",
    ...compareRows(currentSummary, previousSummary),
  );
  const firstApproval = logs.events
    .filter((e) => e.event === "approval")
    .map((e) => e.ts)
    .sort()[0];
  const firstQuestion = Array.isArray(comments)
    ? comments
        .filter((c) => countPmQuestions(c.body) > 0)
        .map((c) => c.created)
        .sort()[0]
    : undefined;
  out.push(
    "",
    `¹ #61부터 기록하는 지표다. 기록 전 기간의 0은 "측정 안 됨"이다. 첫 기록 — 승인 대기: ${firstApproval ? day(new Date(firstApproval)) : "없음"}, 회의록 PM 질문: ${firstQuestion ? day(new Date(firstQuestion)) : Array.isArray(comments) ? "없음" : "—"}.`,
    "같은 스크립트로 지난 기간을 다시 계산한다. 로그는 main에 merge된 것만 있어, 지난 기간 수치가 그 뒤 merge된 로그만큼 지난 보고보다 클 수 있다.",
  );
  out.push("");

  // 반복된 실수
  out.push("### 반복된 실수 → 승격 제안", "");
  const repeated: string[] = [];
  for (const [rule, n] of byRule) {
    if (n < 2) continue;
    repeated.push(
      `- 훅 \`${rule}\` ${n}회: 막히기 전에 알 수 있게 해당 역할 정의(\`plugins/vocals-team/agents/\`)·CLAUDE.md에 안내를 더하거나, 같은 실수가 CI까지 가는 경로가 있으면 테스트·린트로도 잡기`,
    );
  }
  for (const [step, n] of [...realSteps.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )) {
    if (n >= 2) repeated.push(`- CI \`${step}\` 실제 실패 ${n}회: ${ciSuggestion(step)}`);
  }
  out.push(
    ...(repeated.length > 0 ? repeated : ["없음(같은 규칙·같은 실제 실패 step 2회 이상이 없음)"]),
  );
  out.push("");

  // 한 번도 걸리지 않은 규칙
  out.push("### 한 번도 걸리지 않은 규칙", "");
  const hit = new Set(events.map((e) => e.rule));
  const unused = Object.keys(ruleIds)
    .filter((id) => !hit.has(id))
    .sort();
  const covered = logs.firstTs
    ? Math.min(
        Math.ceil(spanDays),
        Math.floor((now.getTime() - Date.parse(logs.firstTs)) / DAY_MS) + 1,
      )
    : 0;
  if (unused.length === 0) out.push("없음");
  else {
    out.push(
      covered < MIN_DAYS_FOR_UNUSED
        ? `판단 보류: 로그가 ${covered}일치뿐이다(정리 제안은 ${MIN_DAYS_FOR_UNUSED}일 이상, \`--days ${MIN_DAYS_FOR_UNUSED}\` 이상으로 본다). ${unused.length}개: ${unused.map((id) => `\`${id}\``).join(", ")}`
        : `정리 제안: 대상 경로·도구가 아직 있는지, 다른 검사(CI)와 겹치는지 보고 남길지 정한다. ${unused.length}개: ${unused.map((id) => `\`${id}\``).join(", ")}`,
    );
  }
  return out.join("\n");
}

/** 실제 gh. 5초가 아니라 30초 타임아웃(주간 작업이라 느려도 된다) */
export function realGh(cwd: string): Gh {
  return (path) => {
    try {
      const stdout = execFileSync("gh", ["api", path], {
        cwd,
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      });
      return JSON.parse(stdout) as unknown;
    } catch {
      return null;
    }
  };
}

export async function loadRuleIds(root: string): Promise<Record<string, string>> {
  const url = pathToFileURL(join(root, "plugins", "vocals-team", "hooks", "lib", "log.mjs")).href;
  const mod = (await import(url)) as { RULE_IDS?: Record<string, string> };
  return mod.RULE_IDS ?? {};
}

export async function runReport(options: {
  root: string;
  days: number;
  since?: Date | undefined;
  now: Date;
  gh: Gh | null;
  issueFilter?: number[] | null;
}): Promise<string> {
  const { root, days, since, now, gh, issueFilter = null } = options;
  const { current, previous } = periodsOf({ now, days, since });
  const base = {
    now,
    days,
    since,
    logs: readLogs(join(root, ".claude", "logs")),
    ruleIds: await loadRuleIds(root),
    issueFilter,
  };
  if (!gh) return buildReport({ ...base, comments: "skip", ci: "skip", work: "skip" });
  const work = fetchWork(gh);
  // 댓글은 지난 기간 시작부터. 이슈별 표가 범위 이슈의 전체 댓글을 세도록 범위 이슈 생성 시각까지 앞당긴다
  let commentsSince = previous.start.getTime();
  if (work) {
    for (const number of scopeIssues(work, current, issueFilter)) {
      const created = work.issues.find((issue) => issue.number === number)?.created;
      if (created) commentsSince = Math.min(commentsSince, Date.parse(created));
    }
  }
  const comments = fetchComments(gh, new Date(commentsSince), work?.prs);
  return buildReport({
    ...base,
    work,
    comments,
    // [QA 반려] 시각으로 QA 재현 커밋 뒤의 Test 실패를 예상된 실패로 나눈다(#61 F3)
    ci: fetchCiFailures(gh, previous.start, work?.prs ?? null, draftDeferSince(root), comments),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const args = process.argv.slice(2);
  let days = DEFAULT_DAYS;
  let daysGiven = false;
  let since: Date | undefined;
  let now = new Date();
  let github = true;
  let issueFilter: number[] | null = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--days") {
      days = Number(args[++i]);
      daysGiven = true;
    } else if (arg === "--since") since = new Date(String(args[++i]));
    else if (arg === "--now") now = new Date(String(args[++i]));
    else if (arg === "--issues") issueFilter = parseIssueFilter(String(args[++i]));
    else if (arg === "--no-github") github = false;
    else throw new Error(`알 수 없는 인자: ${arg}`);
  }
  if (!Number.isInteger(days) || days < 1) throw new Error("--days는 1 이상의 정수");
  if (Number.isNaN(now.getTime())) throw new Error("--now는 ISO 시각");
  if (since !== undefined) {
    if (daysGiven) throw new Error("--days와 --since는 함께 쓰지 않는다");
    if (Number.isNaN(since.getTime()) || since >= now)
      throw new Error("--since는 --now보다 이른 날짜(YYYY-MM-DD)");
  }
  console.log(
    await runReport({ root, days, since, now, gh: github ? realGh(root) : null, issueFilter }),
  );
}
