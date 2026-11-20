// acceptance-guard — 인수 테스트는 QA만 바꾼다(이슈 #17).
//
// 기준 브랜치(origin/main)와의 merge-base 이후 인수 테스트 파일이 바뀌었으면,
// 그 파일의 지금 내용이 `Acceptance: qa` 트레일러가 달린 마지막 커밋의 내용과 같아야 한다.
// 트레일러 없는 커밋이 인수 테스트를 바꾼 채로 남아 있으면 실패한다.
// 잘못 바꾼 커밋은 되돌리면(git revert) 다시 통과한다.
//
// 사용: node scripts/acceptance-guard.ts [--base origin/main] [--head HEAD] [--strict]
//   --strict: 기준 브랜치나 merge-base를 찾지 못하면 실패한다(CI). 없으면 경고만 하고 통과.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** 인수 테스트 경로. DB 인수 테스트와, 앱이 생기면 쓸 E2E 자리 */
export const ACCEPTANCE_PATHS = ["supabase/tests/acceptance/", "tests/acceptance/"] as const;
export const TRAILER_KEY = "Acceptance";
export const TRAILER_VALUE = "qa";

export interface GuardOptions {
  cwd: string;
  base: string;
  head: string;
  strict: boolean;
}

export interface Violation {
  file: string;
  /** 트레일러 없이 이 파일을 바꾼 커밋 (마지막 QA 커밋 이후) */
  commits: string[];
}

export interface GuardResult {
  status: "pass" | "fail" | "skip";
  lines: string[];
  violations: Violation[];
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function tryGit(cwd: string, args: string[]): string | null {
  try {
    return git(cwd, args);
  } catch {
    return null;
  }
}

/** rev:path의 blob id. 파일이 없으면 null */
function blobAt(cwd: string, rev: string, file: string): string | null {
  return tryGit(cwd, ["rev-parse", "--verify", "--quiet", `${rev}:${file}`])?.trim() ?? null;
}

export function isAcceptancePath(file: string): boolean {
  return ACCEPTANCE_PATHS.some((prefix) => file.startsWith(prefix));
}

export function hasQaTrailer(trailerValues: string): boolean {
  return trailerValues
    .split("\n")
    .map((value) => value.trim().toLowerCase())
    .includes(TRAILER_VALUE);
}

const HOW_TO_FIX = [
  "왜: 인수 테스트는 QA 담당입니다. 개발·디자인이 바꾸면 완료 기준을 스스로 바꾸는 셈이 됩니다.",
  "대신 할 일:",
  "  - 개발·디자인: 인수 테스트를 고치지 말고 되돌리세요(`git revert <커밋>`). 테스트가 틀렸다고 보면 `[질문] 받는 역할: QA`로 보고하세요.",
  "  - QA: 커밋 메시지 끝에 빈 줄을 두고 `Acceptance: qa` 트레일러를 달아 커밋하세요.",
];

export function runGuard(options: GuardOptions): GuardResult {
  const { cwd, base, head, strict } = options;
  const skip = (reason: string): GuardResult =>
    strict
      ? {
          status: "fail",
          lines: [
            `acceptance-guard: 실패 — ${reason}`,
            "CI에서는 checkout에 fetch-depth: 0이 필요합니다.",
          ],
          violations: [],
        }
      : {
          status: "skip",
          lines: [
            `acceptance-guard: 경고 — ${reason} 검사를 건너뜁니다(CI에서는 검사합니다).`,
            `기준 브랜치를 받으려면: git fetch origin +main:refs/remotes/origin/main`,
          ],
          violations: [],
        };

  if (tryGit(cwd, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`]) === null) {
    return skip(`기준 브랜치 ${base}가 없습니다.`);
  }
  const mergeBase = tryGit(cwd, ["merge-base", base, head])?.trim();
  if (!mergeBase) {
    return skip(`${base}와 ${head}의 merge-base를 찾지 못했습니다(얕은 clone일 수 있음).`);
  }

  const changed = git(cwd, [
    "diff",
    "--name-only",
    "--no-renames",
    mergeBase,
    head,
    "--",
    ...ACCEPTANCE_PATHS,
  ])
    .split("\n")
    .filter(Boolean);

  const violations: Violation[] = [];
  for (const file of changed) {
    // 이 파일을 바꾼 커밋, 새것부터. 형식: <sha>\0<짧은 sha> <제목>\0<트레일러 값들>\x01
    const log = git(cwd, [
      "log",
      "--full-history",
      "--topo-order",
      `--format=%H%x00%h %s%x00%(trailers:key=${TRAILER_KEY},valueonly)%x01`,
      `${mergeBase}..${head}`,
      "--",
      file,
    ]);
    const commits = log
      .split("\x01")
      .map((entry) => entry.replace(/^\n/, ""))
      .filter(Boolean)
      .map((entry) => {
        const [sha = "", summary = "", trailers = ""] = entry.split("\0");
        return { sha, summary, qa: hasQaTrailer(trailers) };
      });
    const lastQaIndex = commits.findIndex((commit) => commit.qa);
    const unapproved = (lastQaIndex === -1 ? commits : commits.slice(0, lastQaIndex)).filter(
      (commit) => !commit.qa,
    );

    const approvedRev = lastQaIndex === -1 ? mergeBase : (commits[lastQaIndex]?.sha ?? mergeBase);
    if (blobAt(cwd, approvedRev, file) !== blobAt(cwd, head, file)) {
      violations.push({ file, commits: unapproved.map((commit) => commit.summary) });
    }
  }

  if (violations.length === 0) {
    const lines = [
      changed.length === 0
        ? `acceptance-guard: 통과 — ${base} 이후 바뀐 인수 테스트 없음`
        : `acceptance-guard: 통과 — 바뀐 인수 테스트 ${changed.length}개 모두 QA 커밋 내용과 같음`,
    ];
    const dirty = tryGit(cwd, ["status", "--porcelain", "--", ...ACCEPTANCE_PATHS]);
    if (dirty?.trim()) {
      lines.push(
        "경고: 커밋하지 않은 인수 테스트 변경이 있습니다. QA가 아니면 되돌리세요.",
        ...dirty.trimEnd().split("\n"),
      );
    }
    return { status: "pass", lines, violations };
  }

  return {
    status: "fail",
    lines: [
      `acceptance-guard: 실패 — \`Acceptance: qa\` 커밋 없이 바뀐 인수 테스트가 있습니다 (기준 ${base}).`,
      ...violations.flatMap((violation) => [
        `- ${violation.file}`,
        ...(violation.commits.length > 0
          ? violation.commits.map((commit) => `    ${commit}`)
          : ["    (트레일러 없는 커밋 또는 merge 커밋에서 바뀜)"]),
      ]),
      ...HOW_TO_FIX,
    ],
    violations,
  };
}

function parseArgs(argv: string[]): Omit<GuardOptions, "cwd"> {
  const options = { base: "origin/main", head: "HEAD", strict: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--strict") options.strict = true;
    else if (arg === "--base") options.base = argv[++i] ?? options.base;
    else if (arg === "--head") options.head = argv[++i] ?? options.head;
    else throw new Error(`알 수 없는 인자: ${arg}`);
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cwd = fileURLToPath(new URL("..", import.meta.url));
  const result = runGuard({ cwd, ...parseArgs(process.argv.slice(2)) });
  const out = result.status === "fail" ? console.error : console.log;
  for (const line of result.lines) out(line);
  process.exit(result.status === "fail" ? 1 : 0);
}
