// Stop: 코드가 바뀐 채로 턴을 끝내려 하면 pnpm check를 돌리고, 실패하면 끝내지 못하게 한다.
// 종료 코드 2 = 차단(stderr가 Claude에게 전달됨).
import { execSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();

function changedFiles() {
  try {
    const out = execSync("git status --porcelain", { cwd: root, encoding: "utf8" });
    return out
      .split("\n")
      .map((line) => line.slice(3).trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

// 문서만 바뀌었거나 아무것도 안 바뀌었으면 검사하지 않는다.
const codeChanged = changedFiles().some((f) => !f.startsWith("docs/") && !f.endsWith(".md"));
if (!codeChanged) process.exit(0);

if (!existsSync(join(root, "node_modules"))) {
  process.stderr.write(
    "참고: node_modules가 없어 pnpm check를 건너뜁니다. pnpm install 후 pnpm check로 확인하세요.\n",
  );
  process.exit(0);
}

const result = spawnSync("pnpm", ["-s", "check"], { cwd: root, encoding: "utf8" });
if (result.status !== 0) {
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.split("\n").slice(-40).join("\n");
  process.stderr.write(
    [
      "pnpm check가 실패했습니다.",
      "왜: 코드가 바뀐 채로 끝내면 CI에서도 실패하고, 다음 사람이 깨진 상태에서 시작합니다.",
      "대신 할 일: 아래 출력을 보고 고친 뒤 끝내세요. 포맷은 pnpm format으로 고칩니다. QA 인수 테스트 직후의 예상된 Test 실패라면 pnpm check:harness가 통과하는지 확인하고 [보고]에 적으세요.",
      output,
      "",
    ].join("\n"),
  );
  process.exit(2);
}
process.exit(0);
