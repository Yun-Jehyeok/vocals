// check-migrations — 기존 마이그레이션은 고치지 않는다(CLAUDE.md 보안, 이슈 #17 하네스 2단계).
//
// 기준 브랜치(origin/main)와의 merge-base에 있던 supabase/migrations/ 아래 파일이
// head에서 바뀌었거나 없어졌으면(수정·삭제·이름 변경) 실패한다. 새 파일 추가는 괜찮다.
// head가 HEAD면(로컬) 커밋하지 않은 작업 트리 변경도 본다.
//
// 사용: node scripts/check-migrations.ts [--base origin/main] [--head HEAD] [--strict]
//   --strict: 기준 브랜치나 merge-base를 찾지 못하면 실패한다(CI). 없으면 경고만 하고 통과.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BaseArgs } from "./git-base.ts";
import { blobAt, findMergeBase, git, missingBase, parseBaseArgs, tryGit } from "./git-base.ts";

export const MIGRATIONS_DIR = "supabase/migrations/";

export interface MigrationViolation {
  file: string;
  change: "수정" | "삭제·이름 변경" | "수정(커밋 전)" | "삭제·이름 변경(커밋 전)";
}

export interface MigrationResult {
  status: "pass" | "fail" | "skip";
  lines: string[];
  violations: MigrationViolation[];
}

export function runMigrationGuard(options: BaseArgs & { cwd: string }): MigrationResult {
  const { cwd, base, head, strict } = options;
  const found = findMergeBase(cwd, base, head);
  if (!found.ok)
    return { ...missingBase("check:migrations", found.reason, strict), violations: [] };

  const existing = git(cwd, ["ls-tree", "-r", "--name-only", found.mergeBase, "--", MIGRATIONS_DIR])
    .split("\n")
    .filter(Boolean);

  const violations: MigrationViolation[] = [];
  for (const file of existing) {
    const before = blobAt(cwd, found.mergeBase, file);
    const after = blobAt(cwd, head, file);
    if (after === null) violations.push({ file, change: "삭제·이름 변경" });
    else if (after !== before) violations.push({ file, change: "수정" });
    else if (head === "HEAD") {
      // 로컬: 커밋하지 않은 변경
      if (!existsSync(join(cwd, file)))
        violations.push({ file, change: "삭제·이름 변경(커밋 전)" });
      else if (tryGit(cwd, ["hash-object", "--", file])?.trim() !== before) {
        violations.push({ file, change: "수정(커밋 전)" });
      }
    }
  }

  if (violations.length === 0) {
    return {
      status: "pass",
      lines: [
        `check:migrations: 통과 — 기존 마이그레이션 ${existing.length}개 그대로 (기준 ${base})`,
      ],
      violations,
    };
  }
  return {
    status: "fail",
    lines: [
      `check:migrations: 실패 — 기존 마이그레이션이 바뀌었습니다 (기준 ${base}).`,
      ...violations.map((v) => `- ${v.file}: ${v.change}`),
      "왜: main에 들어간 마이그레이션은 이미 어딘가에 적용됐을 수 있어, 고치면 DB마다 스키마가 달라집니다.",
      `대신 할 일: 그 파일을 되돌리고(\`git checkout ${base} -- <파일>\`), 바꿀 내용은 \`supabase/migrations/<타임스탬프>_<이름>.sql\` 새 파일로 만드세요.`,
    ],
    violations,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cwd = fileURLToPath(new URL("..", import.meta.url));
  const { rest, ...options } = parseBaseArgs(process.argv.slice(2));
  if (rest.length > 0) throw new Error(`알 수 없는 인자: ${rest.join(" ")}`);
  const result = runMigrationGuard({ cwd, ...options });
  (result.status === "fail" ? console.error : console.log)(result.lines.join("\n"));
  process.exit(result.status === "fail" ? 1 : 0);
}
