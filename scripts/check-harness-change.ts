// check-harness-change — 하네스 자체를 바꾸는 PR은 팀장이 `harness` 라벨을 붙여야 한다(이슈 #17 2단계, 팀장 결정).
//
// 하네스(훅, CI, 검사·센서, 보호 목록, 검사를 부르는 package.json scripts)를 바꾸면 차단과 검사가 함께 약해질 수 있다.
// 개발이 하네스 작업도 하므로 훅으로 막지 않고, PR에 사람이 보고 붙인 라벨이 있는지만 본다.
//   --labels a,b: PR 라벨(CI가 이벤트 페이로드에서 넘긴다). 없으면(로컬) 바뀐 하네스 파일을 경고로만 알린다.
//   --draft true: draft PR(이슈 #61, PM 승인 2026-11-28 A안). 라벨이 없어도 실패 대신 "판정 보류" 경고로 두고
//     GitHub 어노테이션·job 요약에 남긴다. ready 전환(ready_for_review)·ready 상태의 push·라벨 변경 때는 draft가 false라
//     지금처럼 실패한다. "true" 밖의 값(빈 값 포함)은 ready로 본다(모르면 강제).
//
// 사용: node scripts/check-harness-change.ts [--base origin/main] [--head HEAD] [--strict] [--labels a,b] [--draft true|false]
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BaseArgs } from "./git-base.ts";
import { findMergeBase, git, missingBase, parseBaseArgs, tryGit } from "./git-base.ts";

export const HARNESS_LABEL = "harness";

/** 하네스 경로. "/"로 끝나면 디렉터리 */
export const HARNESS_PATHS = [
  "scripts/", // acceptance-guard(보호 목록 정의), check-migrations, check-req-trace, 이 검사, 훅 단위 테스트
  "supabase/scripts/check-erd-drift.ts", // ERD 드리프트 센서와 예외 목록(ERD_DRIFT_EXCEPTIONS)
  ".github/", // CI 워크플로, PR 템플릿
  ".claude/", // 로컬 훅·permissions·팀 규칙
  ".claude-plugin/", // 마켓플레이스
  "plugins/vocals-team/hooks/",
  "plugins/vocals-team/.claude-plugin/",
  "pnpm-workspace.yaml", // 어떤 패키지의 테스트가 도는지
] as const;
/**
 * 위치와 상관없이 하네스인 파일: 테스트 범위를 정하는 vitest 설정(include를 줄이면 테스트가 조용히 빠진다).
 * 새로 만든 설정도 잡는다. 예: packages/shared/vitest.config.ts, supabase/vitest.config.ts
 */
export const HARNESS_FILE_PATTERNS = [/(^|\/)vitest\.(config|workspace)\.[cm]?[jt]s$/] as const;
/** 하네스 디렉터리 안이지만 평소 작업에서 바뀌는 파일 */
export const HARNESS_EXCLUDE = ["scripts/req-trace-baseline.txt"] as const;
/**
 * 하네스 디렉터리 안이지만 평소 작업에서 바뀌는 디렉터리. 작업 PR에 같이 커밋하고 내용은 PR diff로 리뷰한다.
 * - `.claude/agent-memory/`: 개발·QA 에이전트의 프로젝트 메모리(`memory: project`, 이슈 #17 3단계)
 * - `.claude/logs/`: 훅 차단 로그(세션별 JSONL, 이슈 #17 6단계)
 */
export const HARNESS_EXCLUDE_DIRS = [".claude/agent-memory/", ".claude/logs/"] as const;

export function isHarnessPath(file: string): boolean {
  if ((HARNESS_EXCLUDE as readonly string[]).includes(file)) return false;
  if (HARNESS_EXCLUDE_DIRS.some((dir) => file.startsWith(dir))) return false;
  if (HARNESS_FILE_PATTERNS.some((pattern) => pattern.test(file))) return true;
  return HARNESS_PATHS.some((area) => (area.endsWith("/") ? file.startsWith(area) : file === area));
}

export interface HarnessResult {
  status: "pass" | "fail" | "skip" | "warn";
  lines: string[];
  files: string[];
  /** draft라 라벨 판정을 미뤘다(#61). CI에서 어노테이션으로 드러낸다 */
  deferred?: boolean;
}

/** `--draft` 값. 정확히 "true"일 때만 draft(빈 값·오타·"TRUE"는 ready로 보고 강제한다) */
export function parseDraft(value: string | undefined): boolean {
  return value === "true";
}

/** 판정 보류 경고를 GitHub Actions 어노테이션으로 낸다. Actions 밖이면 아무것도 내지 않는다 */
export function draftAnnotation(
  result: HarnessResult,
  env: Record<string, string | undefined>,
): string[] {
  if (!result.deferred || env.GITHUB_ACTIONS !== "true") return [];
  const message = `draft라 판정 보류: 하네스 파일 ${result.files.length}개가 바뀌었고 ${HARNESS_LABEL} 라벨이 없습니다. ready로 바꾸면 다시 돌고 라벨이 없으면 실패합니다. 이 통과는 merge 근거가 아닙니다.`;
  return [`::warning title=harness 라벨 판정 보류(draft)::${message}`];
}

function scriptsField(text: string | null): string {
  if (text === null) return "null";
  try {
    return JSON.stringify((JSON.parse(text) as { scripts?: unknown }).scripts ?? null);
  } catch {
    return `parse-error:${text}`;
  }
}

export function runHarnessChange(
  options: BaseArgs & { cwd: string; labels: string[] | null; draft?: boolean | undefined },
): HarnessResult {
  const { cwd, base, head, strict, labels, draft = false } = options;
  const found = findMergeBase(cwd, base, head);
  if (!found.ok) return { ...missingBase("check:harness-change", found.reason, strict), files: [] };

  // 로컬(head=HEAD)은 커밋 전 변경도 본다
  const range = head === "HEAD" ? [found.mergeBase] : [found.mergeBase, head];
  const changed = git(cwd, ["diff", "--name-only", "--no-renames", ...range])
    .split("\n")
    .filter(Boolean);
  const read = (file: string) =>
    head === "HEAD"
      ? (() => {
          try {
            return readFileSync(join(cwd, file), "utf8");
          } catch {
            return null;
          }
        })()
      : tryGit(cwd, ["show", `${head}:${file}`]);

  const files = changed.filter(
    (file) =>
      isHarnessPath(file) ||
      // 검사를 부르는 scripts 필드가 바뀐 package.json (의존성만 바뀐 것은 아님)
      (/(^|\/)package\.json$/.test(file) &&
        scriptsField(tryGit(cwd, ["show", `${found.mergeBase}:${file}`])) !==
          scriptsField(read(file))),
  );

  if (files.length === 0) {
    return { status: "pass", lines: ["check:harness-change: 통과 — 바뀐 하네스 파일 없음"], files };
  }
  const list = files.map((file) => `  - ${file}`);
  if (labels === null) {
    return {
      status: "warn",
      lines: [
        `check:harness-change: 경고 — 하네스 파일이 바뀌었습니다. PR에 \`${HARNESS_LABEL}\` 라벨이 있어야 CI가 통과합니다(팀장이 붙임).`,
        ...list,
      ],
      files,
    };
  }
  if (labels.includes(HARNESS_LABEL)) {
    return {
      status: "pass",
      lines: [
        `check:harness-change: 통과 — \`${HARNESS_LABEL}\` 라벨 있음. 바뀐 하네스 파일:`,
        ...list,
      ],
      files,
    };
  }
  if (draft) {
    return {
      status: "warn",
      deferred: true,
      lines: [
        `check:harness-change: 판정 보류(draft) — 하네스 파일이 바뀌었는데 PR에 \`${HARNESS_LABEL}\` 라벨이 없습니다. ready로 바꾸면 다시 돌고, 그때 라벨이 없으면 실패합니다.`,
        ...list,
        `대신 할 일: ready로 바꾸기 전에 팀장이 \`${HARNESS_LABEL}\` 라벨을 붙입니다. 하네스 변경이 의도한 것이 아니면 그 파일을 되돌리세요.`,
      ],
      files,
    };
  }
  return {
    status: "fail",
    lines: [
      `check:harness-change: 실패 — 하네스 파일이 바뀌었는데 PR에 \`${HARNESS_LABEL}\` 라벨이 없습니다.`,
      ...list,
      "왜: 훅·CI·검사·보호 목록을 바꾸면 차단과 검사가 함께 약해질 수 있어, 사람이 보고 승인해야 합니다.",
      `대신 할 일: 하네스 변경이 의도한 것이면 [보고]에 적어 팀장에게 \`${HARNESS_LABEL}\` 라벨을 요청하세요. 의도하지 않았으면 그 파일을 되돌리세요.`,
    ],
    files,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cwd = fileURLToPath(new URL("..", import.meta.url));
  const { rest, ...options } = parseBaseArgs(process.argv.slice(2));
  let labels: string[] | null = null;
  let draft = false;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--labels") {
      labels = (rest[++i] ?? "")
        .split(",")
        .map((label) => label.trim())
        .filter(Boolean);
    } else if (rest[i] === "--draft") draft = parseDraft(rest[++i]);
    else throw new Error(`알 수 없는 인자: ${rest[i]}`);
  }
  const result = runHarnessChange({ cwd, ...options, labels, draft });
  (result.status === "fail" ? console.error : console.log)(result.lines.join("\n"));
  for (const line of draftAnnotation(result, process.env)) console.log(line);
  if (result.deferred && process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### harness 라벨: draft라 판정 보류\n\n${result.lines.join("\n")}\n\n이 통과는 merge 근거가 아니다. ready로 바꾼 뒤 시작된 실행의 결과를 본다.\n`,
    );
  }
  process.exit(result.status === "fail" ? 1 : 0);
}
