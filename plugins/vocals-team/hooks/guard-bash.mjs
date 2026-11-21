// PreToolUse(Bash): 되돌리기 어려운 명령, 전역·역할별 경로 규칙을 어기는 파일 쓰기,
// QA가 아닌 역할의 `Acceptance:` 트레일러 커밋을 막는다. 이슈 #17.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { block, readInput, run } from "./lib/io.mjs";
import { findRepoRoot, mentionsProtected, PathRules, roleOf } from "./lib/rules.mjs";
import {
  analyzeCommand,
  commitSources,
  pushInfo,
  stripDataHeredocs,
  TRAILER_LINE,
} from "./lib/shell.mjs";

const REMOTE_DB = {
  why: "원격 Supabase 프로젝트의 스키마·데이터·설정을 바로 바꾸고 되돌리기 어렵습니다. 스키마는 마이그레이션 파일과 PR로만 바꿉니다(CLAUDE.md).",
  instead:
    "로컬 DB(`pnpm db:reset`, `pnpm db:query`)로 개발·검증하세요. 원격 작업이 꼭 필요하면 `[질문] 받는 역할: PM`으로 보고하세요.",
};
const SB = String.raw`\bsupabase\b[^\n;&|]*`;

/** 모든 세션에 적용하는 명령 규칙(원문 정규식) */
const COMMAND_RULES = [
  {
    test: /\bgit\b[^\n;&|]*\bpush\b[^\n;&|]*\s(--force(?!-with-lease|-if-includes)|-f)(?=\s|$)/,
    ...forcePush(),
  },
  {
    test: /\bgit\b[^\n;&|]*\bpush\b[^\n;&|]*[\s:+](refs\/heads\/)?main(?![\w./-])/,
    ...pushMain(),
  },
  {
    rule: "supabase.db-reset-remote",
    test: new RegExp(String.raw`${SB}\bdb\s+reset\b[^\n;&|]*--(linked|db-url)`),
    summary: "원격 Supabase DB는 초기화하지 않습니다(`--linked`, `--db-url`).",
    why: "원격 DB의 데이터가 모두 지워지고 되돌릴 수 없습니다.",
    instead: REMOTE_DB.instead,
  },
  {
    rule: "supabase.db-push",
    test: new RegExp(String.raw`${SB}\bdb\s+push\b`),
    summary: "`supabase db push`로 원격 DB에 마이그레이션을 적용하지 않습니다.",
    ...REMOTE_DB,
  },
  {
    rule: "supabase.migration-remote",
    test: new RegExp(
      String.raw`${SB}\bmigration\s+(up|down|fetch)\b[^\n;&|]*--(linked|db-url)|${SB}\bmigration\s+repair\b(?![^\n;&|]*--local)`,
    ),
    summary: "원격 DB의 마이그레이션 기록을 바꾸는 supabase 명령은 쓰지 않습니다.",
    ...REMOTE_DB,
  },
  {
    rule: "supabase.remote-command",
    test: new RegExp(
      String.raw`${SB}\b(functions\s+(deploy|delete)|secrets\s+(set|unset)|projects\s+(create|delete)|branches\s+(create|delete|update|disable)|config\s+push|postgres-config\s+(update|delete)|orgs\s+create|storage\s+(rm|cp|mv)|seed\s+buckets[^\n;&|]*--linked)\b`,
    ),
    summary: "원격 Supabase 프로젝트를 바꾸는 supabase 명령은 쓰지 않습니다.",
    ...REMOTE_DB,
  },
  {
    rule: "supabase.psql-remote",
    test: /\bpsql\b[^\n;&|]*(supabase\.(co|com|net)|pooler\.supabase)/i,
    summary: "psql로 원격 Supabase DB에 접속하지 않습니다.",
    ...REMOTE_DB,
  },
];

function forcePush() {
  return {
    rule: "bash.force-push",
    summary: "강제 push(--force, -f, +refspec, --mirror)는 하지 않습니다.",
    why: "원격 기록을 덮어쓰면 다른 사람의 커밋이 사라지고 되돌리기 어렵습니다.",
    instead:
      "새 커밋을 더해 push하세요. 기록을 꼭 고쳐야 하면 `--force-with-lease`를 쓰고 PR에 이유를 적으세요.",
  };
}
function pushMain() {
  return {
    rule: "bash.push-main",
    summary: "main에 직접 push하지 않습니다.",
    why: "main은 사람이 PR을 merge할 때만 바뀝니다(CLAUDE.md 작업 방식).",
    instead: "작업 브랜치(`feat/…`, `fix/…`, `chore/…`)에 push하고 draft PR을 여세요.",
  };
}

const COMMIT_INSTEAD =
  "메시지는 `git commit -m \"…\"`(치환 없이) 또는 `git commit -F - <<'EOF' … EOF`로 쓰고, 트레일러는 `Co-Authored-By`·`Claude-Session`만 다세요. 이 검사는 명령 전체를 봅니다. 다른 명령과 `;`·`&&`로 이어 붙였다면(`git log --grep …; git commit …`, 파일을 고치는 python heredoc 등) 나눠서 따로 실행하세요. 인수 테스트를 바꿔야 한다고 보면 `[질문] 받는 역할: QA`로 보고하세요.";
const TRAILER_WHY =
  "`Acceptance: qa` 트레일러는 QA만 답니다. 다른 역할이 달면 acceptance-guard가 인수 테스트 변경을 QA 승인으로 잘못 봅니다.";
const SAFE_TRAILERS = /^\s*(co-authored-by|claude-session|signed-off-by)\s*[:=]/i;

function git(cwd, args) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}

/** QA가 아닌 역할의 커밋 호출에서 트레일러를 몰래 넣을 수 있는 길. 문제 없으면 null */
function suspiciousCommit(commit) {
  const sources = commitSources(commit.args);
  if (sources.templates.length > 0) return "`-t/--template`으로 메시지를 만드는 커밋";
  if (commit.config.some((c) => /^core\.editor=|^commit\.template=|^trailer\./i.test(c))) {
    return "`-c core.editor`·`commit.template`·`trailer.*` 설정을 쓰는 커밋";
  }
  if (commit.env.some((e) => /^(GIT_EDITOR|EDITOR|VISUAL)=/.test(e))) {
    return "편집기(GIT_EDITOR·EDITOR·VISUAL)를 바꾼 커밋";
  }
  if (sources.messages.some((m) => /\$\(|`/.test(m))) return "`-m` 안에 `$(…)`·백틱이 있는 커밋";
  if (sources.trailers.some((t) => !SAFE_TRAILERS.test(t)))
    return "`--trailer`로 다른 트레일러를 다는 커밋";
  for (const file of sources.files) {
    if (file === "-" || file.startsWith("/dev/")) continue; // 표준 입력: 원문 검사로 본다
    const path = resolve(commit.cwd, file);
    if (!existsSync(path)) return "같은 명령에서 만든(아직 없는) 메시지 파일로 하는 커밋";
    if (TRAILER_LINE.test(readFileSync(path, "utf8")))
      return "메시지 파일에 `Acceptance:`가 있는 커밋";
  }
  for (const rev of sources.reuse) {
    if (TRAILER_LINE.test(git(commit.cwd, ["log", "-1", "--format=%B", rev]))) {
      return "`Acceptance:`가 있는 커밋 메시지를 재사용하는 커밋";
    }
  }
  const keepsMessage =
    sources.messages.length === 0 && sources.files.length === 0 && sources.reuse.length === 0;
  if (
    sources.amend &&
    keepsMessage &&
    TRAILER_LINE.test(git(commit.cwd, ["log", "-1", "--format=%B", "HEAD"]))
  ) {
    return "QA 커밋을 메시지 그대로 고치는 `--amend`";
  }
  return null;
}

run(() => {
  const input = readInput();
  if (!input) return;
  const command = String(input.tool_input?.command ?? "");
  if (!command.trim()) return;
  const role = roleOf(input.agent_type);
  const cwd = String(input.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());

  // `cat > 파일 <<'EOF'`, `git commit -F - <<'EOF'`의 본문(데이터)에 든 "git push origin main" 같은 글자는
  // 명령이 아니므로 뺀다. 인터프리터·셸 표준 입력의 heredoc은 남긴다.
  const ruleText = stripDataHeredocs(command);
  for (const rule of COMMAND_RULES) {
    if (rule.test.test(ruleText)) block({ ...rule, target: command, root: cwd });
  }

  const { targets, commits, pushes, opaque } = analyzeCommand(command, cwd);

  for (const push of pushes) {
    const info = pushInfo(push.args);
    if (info.force) block({ ...forcePush(), target: command, root: push.cwd });
    const current = git(push.cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
    const destinations = info.hasRefspec
      ? info.destinations.map((d) => (d === "HEAD" ? current : d))
      : [current];
    if (info.all || destinations.includes("main")) {
      block({ ...pushMain(), target: command, root: push.cwd });
    }
  }

  const rules = new PathRules({ role });
  for (const target of targets) {
    const violation = rules.check(target.path, target.kind);
    if (violation) block({ ...violation, target: `${violation.file} (${target.via})` });
  }

  if (role === "developer" && opaque.length > 0) {
    const root = findRepoRoot(cwd);
    const protectedPaths = root ? rules.repo(root).protectedPaths : [];
    const mentioned = mentionsProtected(command, protectedPaths);
    if (mentioned) {
      block({
        rule: "developer.opaque-write",
        logTarget: mentioned,
        root: cwd,
        summary: `훅이 풀 수 없는 쓰기(${opaque.slice(0, 3).join(", ")})와 보호 경로(${mentioned})가 한 명령에 있습니다.`,
        target: command,
        why: "이 명령이 어떤 파일을 쓰는지 훅이 알 수 없어, 개발 역할에서는 docs/·인수 테스트·마이그레이션을 건드릴 수 있으면 막습니다.",
        instead:
          "보호 경로를 바꾸려는 것이 아니면 명령을 나누세요(읽기는 cat·grep, 쓰기는 대상 파일을 직접 적은 Edit). 보호 경로 변경이 필요하면 담당(기획·QA)에게 `[질문]`으로 보고하세요.",
      });
    }
  }

  if (role && role !== "qa") {
    if (/Acceptance\s*:/i.test(command)) {
      block({
        rule: "commit.acceptance-text",
        root: cwd,
        summary: "명령에 `Acceptance:`가 있습니다.",
        target: command,
        why: TRAILER_WHY,
        instead: COMMIT_INSTEAD,
      });
    }
    if (
      /\bgit\b/.test(command) &&
      /core\.editor|\bGIT_EDITOR\b|commit\.template|\btrailer\.|interpret-trailers/i.test(command)
    ) {
      block({
        rule: "commit.git-config",
        root: cwd,
        summary: "git 편집기·템플릿·트레일러 설정을 바꾸는 명령은 쓰지 않습니다.",
        target: command,
        why: `${TRAILER_WHY} 편집기·템플릿·트레일러 설정으로 메시지에 트레일러를 넣을 수 있습니다.`,
        instead: COMMIT_INSTEAD,
      });
    }
    for (const commit of commits) {
      const reason = suspiciousCommit(commit);
      if (reason) {
        block({
          rule: "commit.message-source",
          root: commit.cwd,
          summary: `${reason}은(는) QA만 합니다.`,
          target: command,
          why: `${TRAILER_WHY} 이 방식은 훅이 메시지를 미리 볼 수 없습니다.`,
          instead: COMMIT_INSTEAD,
        });
      }
    }
  }
});
