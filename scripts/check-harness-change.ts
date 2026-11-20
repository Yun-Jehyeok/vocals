// check-harness-change — 하네스 자체를 바꾸는 PR은 팀장이 `harness` 라벨을 붙여야 한다(이슈 #17 2단계, 팀장 결정).
//
// 하네스(훅, CI, 검사·센서, 보호 목록, 검사를 부르는 package.json scripts)를 바꾸면 차단과 검사가 함께 약해질 수 있다.
// 개발이 하네스 작업도 하므로 훅으로 막지 않고, PR에 사람이 보고 붙인 라벨이 있는지만 본다.
//   --labels a,b: PR 라벨(CI가 이벤트 페이로드에서 넘긴다). 없으면(로컬) 바뀐 하네스 파일을 경고로만 알린다.
//
// 사용: node scripts/check-harness-change.ts [--base origin/main] [--head HEAD] [--strict] [--labels a,b]
import { readFileSync } from "node:fs";
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

export function isHarnessPath(file: string): boolean {
  if ((HARNESS_EXCLUDE as readonly string[]).includes(file)) return false;
  if (HARNESS_FILE_PATTERNS.some((pattern) => pattern.test(file))) return true;
  return HARNESS_PATHS.some((area) => (area.endsWith("/") ? file.startsWith(area) : file === area));
}

export interface HarnessResult {
  status: "pass" | "fail" | "skip" | "warn";
  lines: string[];
  files: string[];
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
  options: BaseArgs & { cwd: string; labels: string[] | null },
): HarnessResult {
  const { cwd, base, head, strict, labels } = options;
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
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--labels") {
      labels = (rest[++i] ?? "")
        .split(",")
        .map((label) => label.trim())
        .filter(Boolean);
    } else throw new Error(`알 수 없는 인자: ${rest[i]}`);
  }
  const result = runHarnessChange({ cwd, ...options, labels });
  (result.status === "fail" ? console.error : console.log)(result.lines.join("\n"));
  process.exit(result.status === "fail" ? 1 : 0);
}
