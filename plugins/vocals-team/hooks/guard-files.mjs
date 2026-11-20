// PreToolUse(Edit|Write|MultiEdit|NotebookEdit): 전역 규칙과 역할별 규칙으로 파일 쓰기를 막는다. 이슈 #17.
import { resolve } from "node:path";
import { block, readInput, run } from "./lib/io.mjs";
import { PathRules, roleOf } from "./lib/rules.mjs";

run(() => {
  const input = readInput();
  if (!input) return;
  const toolInput = input.tool_input ?? {};
  const path = String(toolInput.file_path ?? toolInput.notebook_path ?? "");
  if (!path) return;
  const cwd = String(input.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
  const rules = new PathRules({ role: roleOf(input.agent_type) });
  const violation = rules.check(resolve(cwd, path), "write");
  if (violation) block({ ...violation, target: violation.file });
});
