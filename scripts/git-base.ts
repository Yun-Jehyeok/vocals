// 하네스 검사가 함께 쓰는 git 도우미: 기준 브랜치와의 merge-base 찾기. 이슈 #17.
import { execFileSync } from "node:child_process";

export function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

export function tryGit(cwd: string, args: string[]): string | null {
  try {
    return git(cwd, args);
  } catch {
    return null;
  }
}

/** rev:path의 blob id. 파일이 없으면 null */
export function blobAt(cwd: string, rev: string, file: string): string | null {
  return tryGit(cwd, ["rev-parse", "--verify", "--quiet", `${rev}:${file}`])?.trim() ?? null;
}

export type MergeBase = { ok: true; mergeBase: string } | { ok: false; reason: string };

export function findMergeBase(cwd: string, base: string, head: string): MergeBase {
  if (tryGit(cwd, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`]) === null) {
    return { ok: false, reason: `기준 브랜치 ${base}가 없습니다.` };
  }
  const mergeBase = tryGit(cwd, ["merge-base", base, head])?.trim();
  if (!mergeBase) {
    return {
      ok: false,
      reason: `${base}와 ${head}의 merge-base를 찾지 못했습니다(얕은 clone일 수 있음).`,
    };
  }
  return { ok: true, mergeBase };
}

/** 기준을 못 찾았을 때: --strict(CI)면 실패, 아니면 경고만 */
export function missingBase(
  name: string,
  reason: string,
  strict: boolean,
): { status: "fail" | "skip"; lines: string[] } {
  return strict
    ? {
        status: "fail",
        lines: [`${name}: 실패 — ${reason}`, "CI에서는 checkout에 fetch-depth: 0이 필요합니다."],
      }
    : {
        status: "skip",
        lines: [
          `${name}: 경고 — ${reason} 검사를 건너뜁니다(CI에서는 검사합니다).`,
          "기준 브랜치를 받으려면: git fetch origin +main:refs/remotes/origin/main",
        ],
      };
}

export interface BaseArgs {
  base: string;
  head: string;
  strict: boolean;
}

/** --base, --head, --strict를 읽고 나머지 인자를 돌려준다 */
export function parseBaseArgs(argv: string[]): BaseArgs & { rest: string[] } {
  const options = { base: "origin/main", head: "HEAD", strict: false, rest: [] as string[] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--strict") options.strict = true;
    else if (arg === "--base") options.base = argv[++i] ?? options.base;
    else if (arg === "--head") options.head = argv[++i] ?? options.head;
    else options.rest.push(arg);
  }
  return options;
}
