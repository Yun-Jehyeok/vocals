// PreToolUse(Bash): 되돌리기 어려운 명령, 전역·역할별 경로 규칙을 어기는 파일 쓰기,
// QA가 아닌 역할의 `Acceptance:` 트레일러 커밋을 막는다. 이슈 #17.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { block, readInput, run } from "./lib/io.mjs";
import { PathRules, roleOf } from "./lib/rules.mjs";
import { analyzeCommand, commitSources, TRAILER_LINE, TRAILER_OPTION } from "./lib/shell.mjs";

/** 모든 세션에 적용하는 명령 규칙 */
const COMMAND_RULES = [
  {
    test: /\bgit\b[^\n;&|]*\bpush\b[^\n;&|]*\s(--force(?!-with-lease)|-f)(?=\s|$)/,
    summary: "강제 push(--force)는 하지 않습니다.",
    why: "원격 기록을 덮어쓰면 다른 사람의 커밋이 사라지고 되돌리기 어렵습니다.",
    instead:
      "새 커밋을 더해 push하세요. 기록을 꼭 고쳐야 하면 `--force-with-lease`를 쓰고 PR에 이유를 적으세요.",
  },
  {
    test: /\bgit\b[^\n;&|]*\bpush\b[^\n;&|]*[\s:](refs\/heads\/)?main(?![\w./-])/,
    summary: "main에 직접 push하지 않습니다.",
    why: "main은 사람이 PR을 merge할 때만 바뀝니다(CLAUDE.md 작업 방식).",
    instead: "작업 브랜치(`feat/…`, `fix/…`, `chore/…`)에 push하고 draft PR을 여세요.",
  },
  {
    test: /\bsupabase\s+db\s+reset\b[^\n;&|]*--linked/,
    summary: "연결된(원격) Supabase DB는 초기화하지 않습니다.",
    why: "원격 DB의 데이터가 모두 지워지고 되돌릴 수 없습니다.",
    instead:
      "로컬 DB는 `pnpm db:reset`으로 초기화하세요. 원격 작업이 필요하면 `[질문] 받는 역할: PM`.",
  },
];

const TRAILER = {
  summary: "`Acceptance:` 트레일러는 QA만 답니다.",
  why: "다른 역할이 달면 acceptance-guard가 인수 테스트 변경을 QA 승인으로 잘못 봅니다.",
  instead:
    "트레일러를 빼고 커밋하세요. 인수 테스트를 바꿔야 한다고 보면 `[질문] 받는 역할: QA`로 보고하세요.",
};
/** 표준 입력(-F -)으로 넘기는 메시지는 명령 전체에서 찾는다 */
const TRAILER_LOOSE = /(^|\n|\\n|['"])[ \t]*Acceptance[ \t]*:/i;

function commitMessage(cwd, rev) {
  try {
    return execFileSync("git", ["log", "-1", "--format=%B", rev], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}

/** git commit 호출이 Acceptance 트레일러를 만드는가 */
function addsTrailer(commit) {
  const sources = commitSources(commit.args);
  if (sources.messages.some((m) => TRAILER_LINE.test(m))) return true;
  if (sources.trailers.some((t) => TRAILER_OPTION.test(t))) return true;
  for (const file of sources.files) {
    if (file === "-") {
      if (commit.heredocs.some((h) => TRAILER_LINE.test(h)) || TRAILER_LOOSE.test(commit.raw))
        return true;
    } else {
      const path = resolve(commit.cwd, file);
      if (existsSync(path) && TRAILER_LINE.test(readFileSync(path, "utf8"))) return true;
    }
  }
  if (sources.reuse.some((rev) => TRAILER_LINE.test(commitMessage(commit.cwd, rev)))) return true;
  const keepsMessage =
    sources.messages.length === 0 && sources.files.length === 0 && sources.reuse.length === 0;
  // QA 커밋을 --amend로 고치면 트레일러가 그대로 남는다
  return sources.amend && keepsMessage && TRAILER_LINE.test(commitMessage(commit.cwd, "HEAD"));
}

run(() => {
  const input = readInput();
  if (!input) return;
  const command = String(input.tool_input?.command ?? "");
  if (!command.trim()) return;

  for (const rule of COMMAND_RULES) {
    if (rule.test.test(command)) block({ ...rule, target: command });
  }

  const role = roleOf(input.agent_type);
  const cwd = String(input.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
  const { targets, commits } = analyzeCommand(command, cwd);

  const rules = new PathRules({ role });
  for (const target of targets) {
    const violation = rules.check(target.path, target.kind);
    if (violation) block({ ...violation, target: `${violation.file} (${target.via})` });
  }

  if (role && role !== "qa" && commits.some(addsTrailer)) block({ ...TRAILER, target: command });
});
