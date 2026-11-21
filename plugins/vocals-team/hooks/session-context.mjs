// SessionStart: 팀장(메인 세션) 컨텍스트에 열린 이슈·PR, 블로커, 최근 결정을 30줄 이내로 넣는다. 이슈 #17 하네스 3단계.
//
// - 서브에이전트는 SessionStart가 아니라 SubagentStart를 받으므로 여기서는 출력할 일이 없다.
//   `claude --agent <이름>`으로 시작한 세션(입력에 agent_type이 있음)도 팀장이 아니므로 출력하지 않는다.
// - 이슈·PR은 `gh api`(REST)로 읽는다. Claude Code 클라우드 세션은 GraphQL(`gh issue list`, `gh pr list`)을 막는다.
//   gh가 없거나 인증·네트워크가 실패하면 한 줄 안내만 내고 끝낸다(세션을 막지 않는다).
// - 블로커: 열린 이슈·PR 중 라벨 `blocked`, 또는 본문·최근 댓글 3개에 `막힘: 예`가 있는 것.
// - 최근 결정: 레포의 docs/decisions.md `## 결정` 표에서 위 10줄(최근이 맨 위). 파일이 없으면 건너뛴다.
// 항상 종료 코드 0으로 끝낸다.
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findRepoRoot } from "./lib/rules.mjs";

const MAX_LINES = 30;
const LIMITS = { prs: 5, issues: 6, blockers: 3, decisions: 10 };
const GH_TIMEOUT_MS = Number(process.env.VOCALS_SESSION_GH_TIMEOUT_MS) || 5000;
const PLUGIN_MARKER = join("plugins", "vocals-team", ".claude-plugin", "plugin.json");
const BLOCKED_TEXT = /막힘\s*:\s*예/;
const RECENT_COMMENTS = 3;
const REPO = "repos/{owner}/{repo}"; // gh가 현재 레포의 origin으로 채운다

/** `gh api <path>`의 JSON. 실패(gh 없음·인증·네트워크·타임아웃·JSON 아님)하면 null */
function api(path, cwd) {
  return new Promise((done) => {
    execFile(
      "gh",
      ["api", path],
      { cwd, timeout: GH_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, encoding: "utf8" },
      (error, stdout) => {
        if (error) return done(null);
        try {
          done(JSON.parse(stdout));
        } catch {
          done(null);
        }
      },
    );
  });
}

const short = (text, max) => {
  const flat = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};
const labelNames = (item) =>
  (Array.isArray(item?.labels) ? item.labels : [])
    .map((l) => String(l?.name ?? ""))
    .filter(Boolean);

/** PR head 커밋의 체크(check-runs는 이름마다 가장 최근 실행만)와 상태(statuses). 둘 다 실패하면 null */
async function checksOf(sha, cwd) {
  if (!sha) return null;
  const [runs, status] = await Promise.all([
    api(`${REPO}/commits/${sha}/check-runs?per_page=100`, cwd),
    api(`${REPO}/commits/${sha}/status`, cwd),
  ]);
  if (runs === null && status === null) return null;
  const latest = new Map();
  for (const run of Array.isArray(runs?.check_runs) ? runs.check_runs : []) {
    const name = String(run?.name ?? "?");
    if (!latest.has(name) || Number(run?.id) > Number(latest.get(name)?.id)) latest.set(name, run);
  }
  const statuses = Array.isArray(status?.statuses) ? status.statuses : [];
  return [...latest.values(), ...statuses];
}

/** 체크 목록 → "CI 통과" / "CI 실패(이름)" / "CI 진행 중" / "CI 없음" / "CI 확인 못 함" */
function ciSummary(checks) {
  if (checks === null || checks === undefined) return "CI 확인 못 함";
  if (checks.length === 0) return "CI 없음";
  const failed = [];
  let pending = false;
  for (const check of checks) {
    const name = String(check?.name ?? check?.context ?? "?");
    const conclusion = String(check?.conclusion ?? "").toLowerCase();
    const state = String(check?.state ?? "").toLowerCase();
    const status = String(check?.status ?? "").toLowerCase();
    if (
      ["failure", "timed_out", "cancelled", "action_required", "startup_failure"].includes(
        conclusion,
      ) ||
      ["failure", "error"].includes(state)
    ) {
      failed.push(name);
    } else if ((status && status !== "completed") || state === "pending") {
      pending = true;
    }
  }
  if (failed.length > 0) return `CI 실패(${[...new Set(failed)].join(", ")})`;
  return pending ? "CI 진행 중" : "CI 통과";
}

/** `막힘: 예`가 있나. 인라인 코드(`막힘: 예`)는 규칙을 설명하는 글이라 세지 않는다 */
const saysBlocked = (text) => BLOCKED_TEXT.test(String(text ?? "").replace(/`[^`\n]*`/g, ""));

/** 이슈·PR이 블로커인 이유. 아니면 null. comments는 최근 댓글(최대 3개) */
function blockerReason(item) {
  if (labelNames(item).some((name) => name.toLowerCase() === "blocked")) return "라벨 blocked";
  if (saysBlocked(item.body)) return "본문에 `막힘: 예`";
  if (item.comments.some(saysBlocked)) return "최근 댓글에 `막힘: 예`";
  return null;
}

/** docs/decisions.md의 `## 결정` 표에서 위 limit줄. 표가 없으면 [] */
function recentDecisions(markdown, limit = LIMITS.decisions) {
  const lines = String(markdown ?? "").split("\n");
  const start = lines.findIndex((line) => /^##\s+결정\s*$/.test(line.trim()));
  if (start === -1) return [];
  const rows = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,2}\s/.test(line)) break;
    if (line.trim().startsWith("|")) rows.push(line.trim());
  }
  const cells = (row) =>
    row
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split(/(?<!\\)\|/)
      .map((cell) => cell.replace(/\\\|/g, "|").trim());
  const [header, ...rest] = rows;
  if (!header) return [];
  const names = cells(header);
  const col = (name, fallback) => {
    const index = names.findIndex((n) => n.includes(name));
    return index === -1 ? fallback : index;
  };
  // "결정" 열은 "결정한 사람"과 헷갈리지 않게 이름이 정확히 같은 열을 쓴다
  const what = names.indexOf("결정");
  const at = {
    date: col("날짜", 0),
    what: what === -1 ? 1 : what,
    who: col("결정한", 4),
    src: col("출처", 5),
  };
  return rest
    .filter((row) => !/^\|?\s*:?-{2,}/.test(row))
    .slice(0, limit)
    .map((row) => {
      const c = cells(row);
      const meta = [c[at.who], c[at.src]].filter(Boolean).join(", ");
      return short(`- ${c[at.date] ?? ""} ${c[at.what] ?? ""}${meta ? ` (${meta})` : ""}`, 140);
    });
}

/** 열린 이슈·PR과 최근 댓글, 보여 줄 PR의 CI. 이슈·PR 목록을 못 읽으면 null */
async function fetchState(cwd) {
  const [rawIssues, rawPulls, rawComments] = await Promise.all([
    api(`${REPO}/issues?state=open&per_page=50`, cwd),
    api(`${REPO}/pulls?state=open&per_page=30`, cwd),
    api(`${REPO}/issues/comments?sort=created&direction=desc&per_page=100`, cwd),
  ]);
  if (!Array.isArray(rawIssues) || !Array.isArray(rawPulls)) return null;
  /** @type {Map<number, string[]>} 이슈·PR 번호 → 최근 댓글 본문(최신부터) */
  const comments = new Map();
  for (const c of Array.isArray(rawComments) ? rawComments : []) {
    const number = Number(/\/issues\/(\d+)$/.exec(String(c?.issue_url ?? ""))?.[1]);
    if (!number) continue;
    const list = comments.get(number) ?? [];
    if (list.length < RECENT_COMMENTS) list.push(String(c?.body ?? ""));
    comments.set(number, list);
  }
  const base = (item) => ({
    number: item?.number,
    title: String(item?.title ?? ""),
    labels: item?.labels,
    body: String(item?.body ?? ""),
    comments: comments.get(Number(item?.number)) ?? [],
  });
  const issues = rawIssues.filter((item) => !item?.pull_request).map(base);
  const prs = await Promise.all(
    rawPulls.map(async (pr, index) => ({
      ...base(pr),
      draft: Boolean(pr?.draft),
      checks: index < LIMITS.prs ? await checksOf(pr?.head?.sha, cwd) : null,
    })),
  );
  return { issues, prs };
}

function buildContext(state, decisions) {
  const lines = ["## vocals 현황 (vocals-team SessionStart 훅)"];
  const section = (title, items, limit) => {
    const more = items.length > limit ? ` (위 ${limit}개만)` : "";
    lines.push(`${title} ${items.length}개${more}:`);
    lines.push(...items.slice(0, limit));
  };
  if (state === null) {
    lines.push(
      "- gh로 이슈·PR을 읽지 못했습니다(gh 없음·인증·네트워크). 필요하면 `gh api repos/{owner}/{repo}/issues`로 직접 보세요.",
    );
  } else {
    const { issues, prs } = state;
    section(
      "열린 PR",
      prs.map((pr) => {
        const tags = [pr.draft ? "draft" : "ready", ...labelNames(pr)].join(", ");
        return `- #${pr.number} ${short(pr.title, 70)} [${tags}] ${ciSummary(pr.checks)}`;
      }),
      LIMITS.prs,
    );
    section(
      "열린 이슈",
      issues.map((issue) => `- #${issue.number} ${short(issue.title, 80)}`),
      LIMITS.issues,
    );
    const blockers = [
      ...issues.map((item) => ({ kind: "이슈", item })),
      ...prs.map((item) => ({ kind: "PR", item })),
    ]
      .map(({ kind, item }) => ({ kind, item, reason: blockerReason(item) }))
      .filter((b) => b.reason)
      .map((b) => `- ${b.kind} #${b.item.number} ${short(b.item.title, 50)} — ${b.reason}`);
    if (blockers.length > 0) section("블로커", blockers, LIMITS.blockers);
    else lines.push("블로커: 없음");
  }
  const recent = recentDecisions(decisions);
  if (recent.length > 0) {
    lines.push(`최근 결정 (docs/decisions.md, 위 ${recent.length}개):`);
    lines.push(...recent);
  }
  return lines.slice(0, MAX_LINES).join("\n");
}

function readInput() {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

async function main() {
  const input = readInput();
  if (input?.agent_type) return; // 팀장(메인 세션)만
  const cwd = String(input?.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
  const root = findRepoRoot(cwd);
  if (!root || !existsSync(join(root, PLUGIN_MARKER))) return; // vocals 레포에서만

  const state = await fetchState(root);
  let decisions = "";
  try {
    decisions = readFileSync(join(root, "docs", "decisions.md"), "utf8");
  } catch {
    // 아직 없으면 건너뛴다
  }
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: buildContext(state, decisions),
      },
    }),
  );
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
