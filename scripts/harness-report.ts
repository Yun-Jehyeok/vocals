// harness-report — 하네스 측정 보고(이슈 #17 6단계). 최근 N일(기본 7)을 마크다운으로 출력한다.
//
// - 훅 차단: `.claude/logs/*.jsonl`(플러그인 훅이 세션별로 남기고 작업 PR에 커밋한 로그)을 규칙별·역할별로 센다.
// - PM 개입: 이슈·PR 댓글(리뷰 포함)의 `받는 역할: PM` 수. 코드 블록·인라인 코드 안의 글자는 세지 않는다.
// - QA 반려: 첫 줄이 `[QA 반려]`로 시작하는 댓글 수.
// - CI 실패 원인: 실패한 워크플로 실행의 실패 job·step 이름별 횟수.
// - 반복된 실수(같은 규칙·같은 실패 step 2회 이상) → 린트·훅·테스트 승격 제안.
// - 한 번도 걸리지 않은 규칙 → 정리 제안. 로그가 쌓인 기간이 짧으면 판단 보류.
//
// GitHub는 `gh api`(REST)로 읽는다. 클라우드 세션은 GraphQL을 막는다. gh가 실패하면 그 절만 "조회 실패"로 쓴다.
// 로그에는 경로·도구 이름만 있고, 보고에는 규칙·역할·횟수만 쓴다(명령 원문·댓글 본문은 옮기지 않는다).
//
// 사용: node scripts/harness-report.ts [--days 7] [--no-github] [--now <ISO 시각>]
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEFAULT_DAYS = 7;
/** 이보다 짧게 쌓인 로그로는 "한 번도 안 걸린 규칙"을 정리하자고 하지 않는다 */
export const MIN_DAYS_FOR_UNUSED = 28;
const DAY_MS = 24 * 60 * 60 * 1000;
const REPO = "repos/{owner}/{repo}"; // gh가 현재 레포의 origin으로 채운다
const MAX_PAGES = 10;
const MAX_RUNS = 50;
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
  /** 모든 로그(기간 무관) 중 가장 이른 시각. 로그가 없으면 null */
  firstTs: string | null;
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
        if (data.firstTs === null || event.ts < data.firstTs) data.firstTs = event.ts;
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

const asArray = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? (value as Record<string, unknown>[]) : [];

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

/** 기간 안에 쓴 이슈·PR 댓글, PR 리뷰 코멘트, PR 리뷰 본문 */
export function fetchComments(gh: Gh, since: Date): Comment[] | null {
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

  const prs = gh(`${REPO}/pulls?state=all&sort=updated&direction=desc&per_page=${MAX_PRS}`);
  if (prs === null || prs === undefined) return null;
  for (const pr of asArray(prs)) {
    if (typeof pr.updated_at !== "string" || Date.parse(pr.updated_at) < since.getTime()) continue;
    const reviews = pages(gh, `${REPO}/pulls/${String(pr.number)}/reviews`, asArray);
    if (reviews === null) return null;
    for (const review of reviews as Record<string, unknown>[]) {
      if (!inWindow(review.submitted_at) || !review.body) continue;
      out.push({
        body: String(review.body),
        ref: `#${String(pr.number)}`,
        created: String(review.submitted_at),
      });
    }
  }
  return out;
}

export interface CiData {
  failedRuns: number;
  /** "job › step" → 횟수 */
  steps: Map<string, number>;
  truncated: boolean;
}

export function fetchCiFailures(gh: Gh, since: Date): CiData | null {
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
  const data: CiData = { failedRuns: recent.length, steps: new Map(), truncated: false };
  if (recent.length > MAX_RUNS) data.truncated = true;
  for (const run of recent.slice(0, MAX_RUNS)) {
    const jobs = gh(`${REPO}/actions/runs/${String(run.id)}/jobs?filter=latest&per_page=100`);
    if (jobs === null || jobs === undefined) return null;
    for (const job of asArray((jobs as { jobs?: unknown }).jobs)) {
      if (job.conclusion !== "failure") continue;
      const failed = asArray(job.steps).filter((step) => step.conclusion === "failure");
      const names = failed.length > 0 ? failed.map((step) => String(step.name)) : ["(step 없음)"];
      for (const name of names) {
        const key = `${String(job.name)} › ${name}`;
        data.steps.set(key, (data.steps.get(key) ?? 0) + 1);
      }
    }
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
    return "대부분 라벨을 붙이기 전 push라 예상된 실패다. 하네스 PR은 열자마자 팀장이 라벨을 붙이고, 라벨 없이 하네스를 바꾼 작업 PR이 섞였는지만 본다";
  }
  if (/acceptance|migration|harness|trace|erd/i.test(step)) {
    return "같은 규칙을 PreToolUse 훅에서 먼저 막을 수 있는지 검토(지금은 CI에서야 걸림)";
  }
  if (/typecheck|test/i.test(step)) {
    return "실패 원인을 공유 규칙 함수·테스트로 고정하고, 개발 정의에 끝내기 전 `pnpm check` 확인을 강조";
  }
  return "실패 원인을 테스트로 고정하거나 훅으로 앞당길지 검토";
}

export interface ReportInput {
  now: Date;
  days: number;
  logs: LogData;
  ruleIds: Record<string, string>;
  /** null = 조회 실패, "skip" = --no-github */
  comments: Comment[] | null | "skip";
  ci: CiData | null | "skip";
}

const day = (date: Date) => date.toISOString().slice(0, 10);

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

export function buildReport(input: ReportInput): string {
  const { now, days, logs, ruleIds, comments, ci } = input;
  const since = new Date(now.getTime() - days * DAY_MS);
  const events = logs.events.filter(
    (e) =>
      e.event === "block" &&
      Date.parse(e.ts) >= since.getTime() &&
      Date.parse(e.ts) <= now.getTime(),
  );
  const out: string[] = [];
  out.push(`## 하네스 측정 보고 — ${day(since)} ~ ${day(now)} (최근 ${days}일)`, "");

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

  // PM 개입·QA 반려
  const githubLine = (value: unknown) =>
    value === "skip" ? "건너뜀(--no-github)" : "조회 실패(gh api)";
  out.push("### PM 개입", "");
  if (Array.isArray(comments)) {
    const total = comments.reduce((sum, c) => sum + countPmMarkers(c.body), 0);
    const refs = refsSummary(comments, (c) => countPmMarkers(c.body));
    out.push(
      `\`받는 역할: PM\` ${total}건 (댓글 ${comments.length}개 중)${refs ? ` — ${refs}` : ""}`,
    );
  } else out.push(githubLine(comments));
  out.push("", "### QA 반려", "");
  if (Array.isArray(comments)) {
    const rejected = comments.filter((c) => isQaRejection(c.body));
    const refs = refsSummary(rejected, () => 1);
    out.push(`\`[QA 반려]\` ${rejected.length}건${refs ? ` — ${refs}` : ""}`);
  } else out.push(githubLine(comments));
  out.push("");

  // CI 실패 원인
  out.push("### CI 실패 원인", "");
  const ciSteps =
    ci && ci !== "skip"
      ? [...ci.steps.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      : [];
  if (ci && ci !== "skip") {
    out.push(`실패한 실행 ${ci.failedRuns}개${ci.truncated ? ` (앞 ${MAX_RUNS}개만 봄)` : ""}`);
    if (ciSteps.length > 0) {
      out.push("", "| job › 실패 step | 횟수 |", "| --- | --- |");
      for (const [step, n] of ciSteps) out.push(`| ${step} | ${n} |`);
    }
  } else out.push(githubLine(ci));
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
  for (const [step, n] of ciSteps) {
    if (n >= 2) repeated.push(`- CI \`${step}\` ${n}회: ${ciSuggestion(step)}`);
  }
  out.push(
    ...(repeated.length > 0 ? repeated : ["없음(같은 규칙·같은 실패 step 2회 이상이 없음)"]),
  );
  out.push("");

  // 한 번도 걸리지 않은 규칙
  out.push("### 한 번도 걸리지 않은 규칙", "");
  const hit = new Set(events.map((e) => e.rule));
  const unused = Object.keys(ruleIds)
    .filter((id) => !hit.has(id))
    .sort();
  const covered = logs.firstTs
    ? Math.min(days, Math.floor((now.getTime() - Date.parse(logs.firstTs)) / DAY_MS) + 1)
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
  now: Date;
  gh: Gh | null;
}): Promise<string> {
  const { root, days, now, gh } = options;
  const since = new Date(now.getTime() - days * DAY_MS);
  return buildReport({
    now,
    days,
    logs: readLogs(join(root, ".claude", "logs")),
    ruleIds: await loadRuleIds(root),
    comments: gh ? fetchComments(gh, since) : "skip",
    ci: gh ? fetchCiFailures(gh, since) : "skip",
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const args = process.argv.slice(2);
  let days = DEFAULT_DAYS;
  let now = new Date();
  let github = true;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--days") days = Number(args[++i]);
    else if (arg === "--now") now = new Date(String(args[++i]));
    else if (arg === "--no-github") github = false;
    else throw new Error(`알 수 없는 인자: ${arg}`);
  }
  if (!Number.isInteger(days) || days < 1) throw new Error("--days는 1 이상의 정수");
  if (Number.isNaN(now.getTime())) throw new Error("--now는 ISO 시각");
  console.log(await runReport({ root, days, now, gh: github ? realGh(root) : null }));
}
