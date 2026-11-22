// vocals-team 플러그인 훅 단위 테스트 (이슈 #17 하네스 2단계)
// 임시 git 저장소에 vocals 레포 모양을 만들고, 훅 스크립트에 입력 JSON을 넣어
// 차단(종료 코드 2 + "왜/대신 할 일" 메시지)과 허용(종료 코드 0)을 표로 확인한다.
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PROTECTED_PATHS } from "./acceptance-guard.ts";

const PLUGIN = fileURLToPath(new URL("../plugins/vocals-team/", import.meta.url));
const HOOKS = join(PLUGIN, "hooks");
const ACCEPTANCE_GUARD = fileURLToPath(new URL("./acceptance-guard.ts", import.meta.url));

const OLD_MIGRATION = "supabase/migrations/20260101000000_init.sql";
const BRANCH_MIGRATION = "supabase/migrations/20260201000000_branch.sql";
const QA_COMMIT = "test: 인수 테스트\n\nAcceptance: qa\nCo-Authored-By: test <t@example.com>";

let repo: string;
let outside: string;
let worktree: string;

function git(...args: string[]) {
  return execFileSync(
    "git",
    [
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "init.defaultBranch=main",
      ...args,
    ],
    { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

function write(file: string, content: string) {
  const path = join(repo, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "plugin-hooks-"));
  outside = mkdtempSync(join(tmpdir(), "plugin-hooks-outside-"));
  git("init", "-q");
  const files: Record<string, string> = {
    "plugins/vocals-team/.claude-plugin/plugin.json": "{}",
    "plugins/vocals-team/agents/qa.md": "# qa",
    "plugins/vocals-team/hooks/guard-bash.mjs": "",
    "scripts/acceptance-guard.ts": readFileSync(ACCEPTANCE_GUARD, "utf8"),
    "scripts/req-trace-baseline.txt": "",
    "docs/prd.md": "# PRD",
    "CLAUDE.md": "# CLAUDE",
    ".claude/rules/team.md": "# team",
    ".env.example": "KEY=",
    [OLD_MIGRATION]: "create table a ();",
    "supabase/seed.sql": "",
    "supabase/tests/acceptance/17-example.test.ts": "",
    "supabase/tests/helpers/db.ts": "",
    "supabase/tests/helpers/rls-matrix.ts": "",
    "supabase/tests/helpers/seed-ids.ts": "",
    "supabase/tests/users.test.ts": "",
    "packages/shared/src/rule.ts": "",
    "packages/shared/src/rule.test.ts": "",
    "apps/mobile/App.tsx": "",
  };
  for (const [file, content] of Object.entries(files)) write(file, content);
  git("add", "-A");
  git("commit", "-q", "-m", "chore: 시작");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("checkout", "-q", "-b", "work");
  write(BRANCH_MIGRATION, "create table b ();");
  git("add", "-A");
  git("commit", "-q", "-m", "feat: 브랜치 마이그레이션");
  write("supabase/tests/acceptance/17-example.test.ts", "// qa");
  git("add", "-A");
  git("commit", "-q", "-m", QA_COMMIT);
  write("msg.txt", "feat: x\n\nAcceptance: qa\n");
  write("clean-msg.txt", "feat: x\n\nCo-Authored-By: a <a@example.com>\n");
  write("tmpl.txt", "feat: x\n");
  write("w.py", "open('docs/prd.md', 'w').write('x')\n");
  write("w.sh", "echo x > docs/prd.md\n");
  write(
    "fix.patch",
    "diff --git a/docs/prd.md b/docs/prd.md\n--- a/docs/prd.md\n+++ b/docs/prd.md\n@@ -1 +1 @@\n-# PRD\n+# X\n",
  );
  write(
    "src.patch",
    "--- a/packages/shared/src/rule.ts\n+++ b/packages/shared/src/rule.ts\n@@ -0,0 +1 @@\n+x\n",
  );
  symlinkSync("docs", join(repo, "d"));
  symlinkSync(join(repo, "docs"), join(outside, "docs-link"));
  worktree = join(outside, "wt");
  git("worktree", "add", "-q", worktree, "main");
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

interface HookResult {
  status: number | null;
  stderr: string;
}

function runHook(script: string, input: unknown): HookResult {
  const result = spawnSync(process.execPath, [join(HOOKS, script)], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
  });
  return { status: result.status, stderr: result.stderr };
}

function expectVerdict(result: HookResult, expected: "차단" | "허용", reason?: string) {
  if (expected === "허용") {
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    return;
  }
  expect(result.status).toBe(2);
  expect(result.stderr).toContain("차단됨(vocals-team 훅)");
  expect(result.stderr).toContain("왜: ");
  expect(result.stderr).toContain("대신 할 일: ");
  if (reason) expect(result.stderr).toContain(reason);
}

const roleInput = (role: string | undefined) => (role ? { agent_type: role } : {});

// 차단 사유를 가리키는 메시지 조각
const DOCS = "docs/는 기획 담당";
const ACCEPT = "인수 테스트와 판정 헬퍼는 QA 담당";
const MIGRATION = "기존 마이그레이션";
const ENV = ".env 파일";
const QA_ONLY = "QA는 테스트 파일";
const PLANNER = "기획은 docs/";
const DESIGNER = "코드(apps/";
const TRAILER = "트레일러는 QA만 답니다";
const QA_CODE = "왜: 기능 코드는 개발 담당";
const QA_DOCS = "왜: 문서는 기획 담당";
const QA_SEED = "왜: seed(더미 데이터)는 개발 담당";
const HARNESS = "왜: CI·훅·검사 스크립트(하네스)";

type Row = [role: string | undefined, path: string, verdict: "차단" | "허용", reason?: string];

describe("guard-files: 파일 쓰기 도구의 역할별·전역 차단 (이슈 #17)", () => {
  const rows: Row[] = [
    // 메인 세션(팀장): 역할 차단 없음, 전역 규칙만
    [undefined, "docs/prd.md", "허용"],
    [undefined, "packages/shared/src/rule.ts", "허용"],
    [undefined, OLD_MIGRATION, "차단", MIGRATION],
    [undefined, ".env", "차단", ENV],
    [undefined, ".env.local", "차단", ENV],
    [undefined, ".env.example", "허용"],
    [undefined, BRANCH_MIGRATION, "허용"],
    // 역할이 아닌 에이전트(general-purpose 등)
    ["general-purpose", "docs/prd.md", "허용"],
    ["general-purpose", OLD_MIGRATION, "차단", MIGRATION],
    // developer
    ["developer", "docs/prd.md", "차단", DOCS],
    ["vocals-team:developer", "docs/new.md", "차단", DOCS],
    ["developer", "supabase/tests/acceptance/17-example.test.ts", "차단", ACCEPT],
    ["developer", "supabase/tests/acceptance/21-new.test.ts", "차단", ACCEPT],
    ["developer", "tests/acceptance/e2e/login.spec.ts", "차단", ACCEPT],
    ["developer", "supabase/tests/helpers/db.ts", "차단", ACCEPT],
    ["developer", OLD_MIGRATION, "차단", MIGRATION],
    ["developer", BRANCH_MIGRATION, "허용"],
    ["developer", "supabase/migrations/20260301000000_next.sql", "허용"],
    ["developer", "supabase/seed.sql", "허용"],
    ["developer", "supabase/tests/helpers/seed-ids.ts", "허용"],
    ["developer", "supabase/tests/users.test.ts", "허용"],
    ["developer", "packages/shared/src/rule.ts", "허용"],
    ["developer", ".env", "차단", ENV],
    // qa
    ["qa", "supabase/tests/acceptance/17-example.test.ts", "허용"],
    ["vocals-team:qa", "supabase/tests/helpers/db.ts", "허용"],
    ["qa", "packages/shared/src/rule.test.ts", "허용"],
    ["qa", "tests/acceptance/e2e/login.spec.ts", "허용"],
    ["qa", "scripts/req-trace-baseline.txt", "허용"],
    ["qa", "packages/shared/src/rule.ts", "차단", QA_ONLY],
    ["qa", "supabase/seed.sql", "차단", QA_ONLY],
    ["qa", "supabase/migrations/20260301000000_next.sql", "차단", QA_ONLY],
    ["qa", "docs/prd.md", "차단", QA_ONLY],
    ["qa", "scripts/acceptance-guard.ts", "차단", QA_ONLY],
    // 차단의 "왜"는 대상에 맞게(이슈 #17 3단계)
    ["qa", "packages/shared/src/rule.ts", "차단", QA_CODE],
    ["qa", "docs/prd.md", "차단", QA_DOCS],
    ["qa", "CLAUDE.md", "차단", QA_DOCS],
    ["qa", "supabase/seed.sql", "차단", QA_SEED],
    ["qa", "scripts/acceptance-guard.ts", "차단", HARNESS],
    ["qa", ".github/workflows/ci.yml", "차단", HARNESS],
    // QA 프로젝트 메모리(memory: project)
    ["qa", ".claude/agent-memory/qa/MEMORY.md", "허용"],
    ["vocals-team:qa", ".claude/agent-memory/vocals-team-qa/MEMORY.md", "허용"],
    ["qa", ".claude/agent-memory/developer/MEMORY.md", "차단", QA_ONLY],
    ["qa", ".claude/agent-memory/qa-other.md", "차단", QA_ONLY],
    ["developer", ".claude/agent-memory/developer/MEMORY.md", "허용"],
    // planner
    ["planner", "docs/prd.md", "허용"],
    ["planner", "docs/decisions.md", "허용"],
    ["planner", "CLAUDE.md", "허용"],
    ["planner", ".claude/rules/team.md", "허용"],
    ["planner", "plugins/vocals-team/agents/qa.md", "허용"],
    ["planner", "plugins/vocals-team/hooks/guard-bash.mjs", "차단", PLANNER],
    ["planner", "packages/shared/src/rule.ts", "차단", PLANNER],
    ["planner", ".github/workflows/ci.yml", "차단", PLANNER],
    ["planner", ".github/workflows/ci.yml", "차단", "CI 변경은 PM 승인"],
    ["planner", "packages/shared/src/rule.ts", "차단", "코드와 설정은 개발 담당"],
    // designer
    ["designer", "docs/design.md", "허용"],
    ["designer", "CLAUDE.md", "허용"],
    ["designer", "apps/mobile/App.tsx", "차단", DESIGNER],
    ["designer", "packages/shared/src/rule.ts", "차단", DESIGNER],
    ["designer", "supabase/seed.sql", "차단", DESIGNER],
    ["designer", "scripts/check-migrations.ts", "차단", DESIGNER],
    // 대소문자: 대소문자를 구분하지 않는 파일 시스템(macOS) 우회와 agent_type 표기
    ["developer", "Docs/prd.md", "차단", DOCS],
    ["developer", "DOCS/new.md", "차단", DOCS],
    ["developer", "Supabase/Tests/Acceptance/17-example.test.ts", "차단", ACCEPT],
    [undefined, "supabase/migrations/20260101000000_INIT.sql", "차단", MIGRATION],
    ["Developer", "docs/prd.md", "차단", DOCS],
    ["vocals-team:Developer", "docs/prd.md", "차단", DOCS],
    ["QA", "packages/shared/src/rule.ts", "차단", QA_ONLY],
    ["qa", "packages/shared/src/Rule.Test.ts", "허용"],
    // 심볼릭 링크: 레포 안 링크 d -> docs
    ["developer", "d/prd.md", "차단", DOCS],
    ["developer", "d/new.md", "차단", DOCS],
  ];

  it.each(rows)("%s · Edit %s → %s", (role, path, verdict, reason) => {
    const result = runHook("guard-files.mjs", {
      tool_name: "Edit",
      cwd: repo,
      ...roleInput(role),
      tool_input: { file_path: join(repo, path) },
    });
    expectVerdict(result, verdict, reason);
  });

  it.each([
    ["Write", { file_path: "docs/new.md" }],
    ["MultiEdit", { file_path: "docs/prd.md" }],
    ["NotebookEdit", { notebook_path: "docs/a.ipynb" }],
  ])("developer · %s도 같은 규칙(상대 경로 포함)으로 차단", (tool, toolInput) => {
    const result = runHook("guard-files.mjs", {
      tool_name: tool,
      cwd: repo,
      agent_type: "developer",
      tool_input: toolInput,
    });
    expectVerdict(result, "차단", DOCS);
  });

  it("레포 밖에서 docs/를 가리키는 링크로 써도 막는다", () => {
    const result = runHook("guard-files.mjs", {
      tool_name: "Write",
      cwd: repo,
      agent_type: "developer",
      tool_input: { file_path: join(outside, "docs-link", "prd.md") },
    });
    expectVerdict(result, "차단", DOCS);
  });

  it("worktree 안에서도 같은 규칙을 적용한다", () => {
    const result = runHook("guard-files.mjs", {
      tool_name: "Edit",
      cwd: worktree,
      agent_type: "developer",
      tool_input: { file_path: join(worktree, "docs/prd.md") },
    });
    expectVerdict(result, "차단", DOCS);
  });

  it("vocals 레포 밖의 경로에는 역할 규칙을 적용하지 않는다", () => {
    const result = runHook("guard-files.mjs", {
      tool_name: "Write",
      cwd: repo,
      agent_type: "qa",
      tool_input: { file_path: join(outside, "docs/a.md") },
    });
    expectVerdict(result, "허용");
  });

  it("acceptance-guard.ts의 PROTECTED_PATHS를 모두 developer에게 막는다", () => {
    for (const area of PROTECTED_PATHS) {
      const path = area.endsWith("/") ? `${area}x.test.ts` : area;
      const result = runHook("guard-files.mjs", {
        tool_name: "Edit",
        cwd: repo,
        agent_type: "developer",
        tool_input: { file_path: join(repo, path) },
      });
      expectVerdict(result, "차단", ACCEPT);
    }
  });

  it("acceptance-guard.ts가 없으면 같은 내용의 내장 목록으로 막는다", () => {
    const original = join(repo, "scripts/acceptance-guard.ts");
    renameSync(original, `${original}.bak`);
    try {
      for (const area of PROTECTED_PATHS) {
        const path = area.endsWith("/") ? `${area}x.test.ts` : area;
        const result = runHook("guard-files.mjs", {
          tool_name: "Edit",
          cwd: repo,
          agent_type: "developer",
          tool_input: { file_path: join(repo, path) },
        });
        expectVerdict(result, "차단", ACCEPT);
      }
    } finally {
      renameSync(`${original}.bak`, original);
    }
  });

  it("입력 JSON이 깨졌으면 막지 않는다", () => {
    expectVerdict(runHook("guard-files.mjs", "{not json"), "허용");
  });
});

type BashRow = [
  role: string | undefined,
  command: string,
  verdict: "차단" | "허용",
  reason?: string,
];

describe("guard-bash: 명령 규칙과 Bash 파일 쓰기 (이슈 #17)", () => {
  const rows: BashRow[] = [
    // 모든 세션: 되돌리기 어려운 명령
    [undefined, "git push --force origin feat/x", "차단", "강제 push"],
    [undefined, "git push -f origin feat/x", "차단", "강제 push"],
    [undefined, "git push --force-with-lease origin feat/x", "허용"],
    [undefined, "git push origin main", "차단", "main에 직접 push"],
    [undefined, "git push origin HEAD:main", "차단", "main에 직접 push"],
    [undefined, "git push -u origin chore/harness-2-hooks", "허용"],
    [undefined, "supabase db reset --linked", "차단", "원격"],
    [undefined, "supabase db reset", "허용"],
    [undefined, `echo x > ${OLD_MIGRATION}`, "차단", MIGRATION],
    [undefined, "rm -rf supabase/migrations", "차단", MIGRATION],
    [
      undefined,
      `git mv ${OLD_MIGRATION} supabase/migrations/20260102000000_init.sql`,
      "차단",
      MIGRATION,
    ],
    [undefined, "echo SECRET=1 >> .env", "차단", ENV],
    [undefined, "echo x > docs/a.md", "허용"],
    // developer: 읽기는 허용
    ["developer", "cat docs/prd.md", "허용"],
    ["developer", "grep -rn PAY docs/ | head", "허용"],
    ["developer", "sed -n '1,20p' docs/prd.md", "허용"],
    ["developer", "cp docs/prd.md /tmp/prd-copy.md", "허용"],
    ["developer", "pnpm test > /tmp/out.txt 2>&1", "허용"],
    ["developer", "echo x > /dev/null", "허용"],
    ["developer", "git checkout main", "허용"],
    ["developer", "git checkout -b feat/21-tickets", "허용"],
    ["developer", `echo x > ${BRANCH_MIGRATION}`, "허용"],
    ["developer", "echo 'export {}' > packages/shared/src/new.ts", "허용"],
    // developer: docs/ 쓰기
    ["developer", "echo x > docs/a.md", "차단", DOCS],
    ["developer", "echo x >> docs/prd.md", "차단", DOCS],
    ["developer", "cat <<'EOF' > docs/a.md\n내용\nEOF", "차단", DOCS],
    ["developer", "echo x | tee -a docs/prd.md", "차단", DOCS],
    ["developer", "sed -i 's/a/b/' docs/prd.md", "차단", DOCS],
    ["developer", "sed -i.bak -e 's/a/b/' docs/prd.md", "차단", DOCS],
    ["developer", "perl -pi -e 's/a/b/' docs/prd.md", "차단", DOCS],
    ["developer", "cp /tmp/x.md docs/", "차단", DOCS],
    ["developer", "mv docs/prd.md docs/old.md", "차단", DOCS],
    ["developer", "rm -rf docs", "차단", DOCS],
    ["developer", "rm docs/*.md", "차단", DOCS],
    ["developer", "touch docs/new.md", "차단", DOCS],
    ["developer", "git rm docs/prd.md", "차단", DOCS],
    ["developer", "git mv docs/prd.md docs/b.md", "차단", DOCS],
    ["developer", "git checkout origin/main docs/prd.md", "차단", DOCS],
    ["developer", "git checkout HEAD~1 -- docs/prd.md", "차단", DOCS],
    ["developer", "git restore --source=origin/main docs/prd.md", "차단", DOCS],
    ["developer", "git restore -s HEAD~1 supabase/tests/acceptance/", "차단", ACCEPT],
    // HEAD·index로 되돌리기는 커밋된 내용으로 돌아갈 뿐이라 허용(오탐 수정)
    ["developer", "git checkout -- docs/prd.md", "허용"],
    ["developer", "git restore docs/prd.md", "허용"],
    ["developer", "git restore .", "허용"],
    [undefined, "git restore .", "허용"],
    [undefined, "git checkout -- docs/erd.md supabase/", "허용"],
    [undefined, "git restore --staged supabase/migrations/", "허용"],
    ["developer", "cd docs && echo x > a.md", "차단", DOCS],
    ["developer", 'bash -c "echo x > docs/a.md"', "차단", DOCS],
    ["developer", "find docs -name '*.bak' -delete", "차단", DOCS],
    ["developer", `node -e "require('fs').writeFileSync('docs/a.md', 'x')"`, "차단", DOCS],
    ["developer", `python3 -c "open('docs/a.md', 'w').write('x')"`, "차단", DOCS],
    [
      "developer",
      `node -e "console.log(require('fs').readFileSync('docs/prd.md', 'utf8'))"`,
      "허용",
    ],
    // developer: 인수 테스트·판정 헬퍼, 기존 마이그레이션
    ["developer", "echo x > supabase/tests/acceptance/17-example.test.ts", "차단", ACCEPT],
    ["developer", "rm supabase/tests/helpers/rls-matrix.ts", "차단", ACCEPT],
    ["developer", "sed -i 's/a/b/' supabase/tests/helpers/db.ts", "차단", ACCEPT],
    ["developer", "rm -rf supabase/tests", "차단", ACCEPT],
    ["developer", "echo x > supabase/tests/helpers/seed-ids.ts", "허용"],
    ["developer", "rm supabase/migrations/*.sql", "차단", MIGRATION],
    // qa
    ["qa", "sed -i 's/a/b/' packages/shared/src/rule.test.ts", "허용"],
    ["qa", "echo x > supabase/tests/acceptance/21-new.test.ts", "허용"],
    ["qa", "echo x > scripts/req-trace-baseline.txt", "허용"],
    ["qa", "pnpm check:req-trace --update", "허용"],
    ["qa", "echo x > packages/shared/src/rule.ts", "차단", QA_ONLY],
    ["qa", "cd packages && sed -i 's/a/b/' shared/src/*.ts", "차단", QA_ONLY],
    ["qa", "echo x > supabase/seed.sql", "차단", QA_ONLY],
    ["qa", "rm -rf supabase", "차단", MIGRATION],
    // planner
    ["planner", "echo x > docs/decisions.md", "허용"],
    ["planner", "echo x > packages/shared/src/a.ts", "차단", PLANNER],
    ["planner", "mv docs/a.md scripts/a.md", "차단", PLANNER],
    // designer
    ["designer", "echo x > docs/design.md", "허용"],
    ["designer", "echo x > apps/mobile/a.tsx", "차단", DESIGNER],
    ["designer", "cp /tmp/tokens.ts packages/shared/src/tokens.ts", "차단", DESIGNER],
    // Acceptance 트레일러: QA가 아닌 역할은 못 단다
    ["developer", 'git commit -m "feat: x\n\nAcceptance: qa"', "차단", TRAILER],
    [
      "developer",
      "git commit -m \"$(cat <<'EOF'\nfeat: x\n\nAcceptance: qa\nCo-Authored-By: a\nEOF\n)\"",
      "차단",
      TRAILER,
    ],
    ["developer", 'git commit -m "feat: x" -m "Acceptance: qa"', "차단", TRAILER],
    ["developer", 'git commit --trailer "Acceptance: qa" -m "feat: x"', "차단", TRAILER],
    ["developer", 'git commit --trailer=Acceptance=qa -m "feat: x"', "차단", TRAILER],
    ["developer", "git commit -F msg.txt", "차단", TRAILER],
    ["developer", "printf 'feat: x\\n\\nAcceptance: qa\\n' | git commit -F -", "차단", TRAILER],
    ["developer", "git commit -C HEAD", "차단", TRAILER],
    ["developer", "git commit --amend --no-edit", "차단", TRAILER],
    ["developer", 'git commit --amend -m "fix: 새 메시지"', "허용"],
    ["developer", 'git commit -m "feat: x\n\nCo-Authored-By: a"', "허용"],
    ["developer", 'git commit -m "docs: Acceptance: qa 트레일러 설명"', "차단", "`Acceptance:`"],
    [
      "developer",
      "printf 'x\\n\\nAcceptance: qa\\n' > m && git commit -F m",
      "차단",
      "`Acceptance:`",
    ],
    ["developer", "grep -rn 'Acceptance:' scripts/", "차단", "`Acceptance:`"],
    ["developer", `git commit -m "$(printf 'x')"`, "차단", "$(…)"],
    ["developer", 'git commit -m "$(cat msg2.txt)"', "차단", "$(…)"],
    ["developer", 'git commit -m "`cat msg2.txt`"', "차단", "백틱"],
    ["developer", "git commit -t tmpl.txt", "차단", "--template"],
    ["developer", "git commit --template=tmpl.txt", "차단", "--template"],
    ["developer", "git -c core.editor=true commit", "차단", "편집기"],
    ["developer", "GIT_EDITOR=true git commit", "차단", "편집기"],
    ["developer", "EDITOR=/tmp/e.sh git commit", "차단", "편집기"],
    ["developer", "git config core.editor /tmp/e.sh", "차단", "편집기"],
    ["developer", "echo 'feat: x' > m2 && git commit -F m2", "차단", "아직 없는"],
    ["developer", "git -c trailer.a.key=Acc commit --trailer a=qa -m x", "차단", "트레일러"],
    ["developer", 'git commit --trailer "Reviewed-by: x" -m "feat: x"', "차단", "--trailer"],
    ["developer", "git interpret-trailers --trailer a=qa < clean-msg.txt", "차단", "트레일러"],
    ["developer", "git commit-tree HEAD^{tree} -F msg.txt", "차단", "메시지 파일"],
    ["developer", "git commit -F clean-msg.txt", "허용"],
    ["developer", 'git commit --trailer "Co-Authored-By: a <a@example.com>" -m "feat: x"', "허용"],
    ["developer", "git commit -F - <<'EOF'\nfeat: x\n\nCo-Authored-By: a\nEOF", "허용"],
    ["developer", 'git merge -m "merge: main" main', "허용"],
    ["qa", "git commit -t tmpl.txt", "허용"],
    // 강제 push 변형, main으로 가는 push
    [undefined, "git push -fu origin feat/x", "차단", "강제 push"],
    [undefined, "git push -uf origin feat/x", "차단", "강제 push"],
    [undefined, "git push origin +HEAD:feat/x", "차단", "강제 push"],
    [undefined, "git push origin +main", "차단", "push"],
    [undefined, "git push --mirror origin", "차단", "강제 push"],
    [undefined, "git push --all origin", "차단", "main에 직접 push"],
    [undefined, "git push origin HEAD:refs/heads/main", "차단", "main에 직접 push"],
    [undefined, "git push --force-if-includes --force-with-lease origin feat/x", "허용"],
    [undefined, "git push", "허용"],
    [undefined, "git push origin HEAD", "허용"],
    [undefined, "git push -u origin work", "허용"],
    // 원격 DB를 바꾸는 supabase CLI
    [undefined, "supabase db push", "차단", "db push"],
    [undefined, "npx supabase db push --linked", "차단", "db push"],
    [undefined, "supabase db reset --db-url postgres://u@h/db", "차단", "초기화"],
    [
      undefined,
      "supabase migration repair --status applied 20260101000000",
      "차단",
      "마이그레이션 기록",
    ],
    [undefined, "supabase migration up --linked", "차단", "마이그레이션 기록"],
    [undefined, "supabase functions deploy hello", "차단", "원격 Supabase 프로젝트"],
    [undefined, "supabase secrets set A=b", "차단", "원격 Supabase 프로젝트"],
    [undefined, "supabase projects create x", "차단", "원격 Supabase 프로젝트"],
    [undefined, "supabase branches delete x", "차단", "원격 Supabase 프로젝트"],
    [
      undefined,
      'psql "postgresql://postgres@db.abc.supabase.co:5432/postgres" -c "drop table a"',
      "차단",
      "psql",
    ],
    [undefined, "supabase migration repair --local --status applied 20260101000000", "허용"],
    [undefined, "supabase migration up", "허용"],
    [undefined, "supabase start", "허용"],
    [undefined, "supabase db diff --linked", "허용"],
    [undefined, "supabase gen types typescript --local", "허용"],
    [undefined, "psql -h localhost -U postgres -c 'select 1'", "허용"],
    // 심볼릭 링크·대소문자
    ["developer", "ln -s docs d2", "차단", DOCS],
    ["developer", "ln -s ../docs packages/d", "차단", DOCS],
    ["developer", "ln -sf /tmp/x docs/prd.md", "차단", DOCS],
    ["developer", "echo x > d/prd.md", "차단", DOCS],
    ["developer", "echo x > Docs/prd.md", "차단", DOCS],
    ["developer", "ln -s ../packages/shared/src/rule.ts packages/r.ts", "허용"],
    // 훅이 대상을 풀 수 있게 된 쓰기
    ["developer", "rsync -a /tmp/a docs/prd.md", "차단", DOCS],
    ["developer", "tar -xf a.tar -C docs", "차단", DOCS],
    ["developer", "unzip a.zip -d docs", "차단", DOCS],
    ["developer", "patch docs/prd.md < p.diff", "차단", DOCS],
    ["developer", "patch -p1 < fix.patch", "차단", DOCS],
    ["developer", "git apply fix.patch", "차단", DOCS],
    ["developer", "ex -sc '%s/a/b/|x' docs/prd.md", "차단", DOCS],
    ["developer", "awk -i inplace '{print}' docs/prd.md", "차단", DOCS],
    ["developer", "rm {docs,x}/prd.md", "차단", DOCS],
    // 훅이 풀 수 없는 쓰기 + 보호 경로 문자열 → 개발 역할만 보수적으로 차단
    [
      "developer",
      "cd $(git rev-parse --show-toplevel)/docs && echo x > prd.md",
      "차단",
      "풀 수 없는 쓰기",
    ],
    ["developer", "D=docs; echo x > $D/prd.md", "차단", "풀 수 없는 쓰기"],
    ["developer", "ls docs | xargs rm", "차단", "풀 수 없는 쓰기"],
    ["developer", "node scripts/gen.js docs/prd.md", "차단", "풀 수 없는 쓰기"],
    ["developer", "bash ./x.sh docs", "차단", "풀 수 없는 쓰기"],
    ["developer", "./x.sh supabase/tests/acceptance/17-example.test.ts", "차단", "풀 수 없는 쓰기"],
    ["developer", "pnpm exec prettier --write docs/", "차단", "풀 수 없는 쓰기"],
    ["developer", "git apply < fix.patch && cat supabase/migrations/x", "차단", "풀 수 없는 쓰기"],
    // 같은 종류의 명령이라도 보호 경로를 건드리지 않으면 허용(오탐 확인)
    ["developer", "grep -rln PAY docs/ | xargs echo", "허용"],
    ["developer", "ls docs | xargs wc -l", "허용"],
    ["developer", "tar -czf /tmp/d.tgz docs", "허용"],
    ["developer", "tar -tf /tmp/d.tgz", "허용"],
    ["developer", "rsync -a docs/ /tmp/docs-copy/", "허용"],
    ["developer", "git log --oneline -- docs/", "허용"],
    ["developer", "git diff origin/main -- docs/ supabase/migrations/", "허용"],
    ["developer", "git apply --check fix.patch", "허용"],
    ["developer", "patch -p1 < src.patch", "허용"],
    ["developer", "pnpm check", "허용"],
    ["developer", "pnpm format && git add -A", "허용"],
    ["developer", "node --experimental-strip-types scripts/check-req-trace.ts", "허용"],
    ["developer", 'pnpm test && git commit -m "feat: 수강권"', "허용"],
    ["developer", 'pnpm format && git commit -m "docs: README 고침"', "허용"],
    ["developer", "/usr/bin/rm -f packages/shared/src/old.ts", "허용"],
    ["qa", "node scripts/gen.js docs/prd.md", "허용"],
    // 인터프리터 표준 입력 코드(heredoc, here-string, < 파일, 파이프)도 -c/-e처럼 본다
    ["developer", "python3 - <<'EOF'\nopen('docs/prd.md', 'w').write('x')\nEOF", "차단", DOCS],
    [
      "developer",
      "python3 <<'EOF'\nfrom pathlib import Path\nPath('docs/prd.md').write_text('x')\nEOF",
      "차단",
      DOCS,
    ],
    [
      "developer",
      "node <<'EOF'\nrequire('fs').writeFileSync('docs/prd.md', 'x')\nEOF",
      "차단",
      DOCS,
    ],
    [
      "developer",
      "node - <<'EOF'\nrequire('fs').appendFileSync('supabase/tests/helpers/db.ts', 'x')\nEOF",
      "차단",
      ACCEPT,
    ],
    ["developer", "ruby <<'EOF'\nFile.write('docs/prd.md', 'x')\nEOF", "차단", DOCS],
    [
      "developer",
      "perl <<'EOF'\nopen(my $f, '>', 'docs/prd.md'); unlink('docs/prd.md');\nEOF",
      "차단",
      DOCS,
    ],
    ["developer", "bash <<'EOF'\necho x > docs/prd.md\nEOF", "차단", DOCS],
    ["developer", "sh -s <<'EOF'\nrm -rf docs\nEOF", "차단", DOCS],
    ["developer", "python3 <<< \"open('docs/prd.md', 'w').write('x')\"", "차단", DOCS],
    ["developer", "python3 < w.py", "차단", DOCS],
    ["developer", "bash < w.sh", "차단", DOCS],
    ["developer", "echo \"require('fs').writeFileSync('docs/prd.md', 'x')\" | node", "차단", DOCS],
    ["developer", "cat w.py | python3 -", "차단", DOCS],
    ["developer", "cat <<'EOF' | python3\nopen('docs/prd.md', 'w').write('x')\nEOF", "차단", DOCS],
    ["developer", "python3 - <<'EOF'\nprint(open('docs/prd.md').read())\nEOF", "허용"],
    ["developer", "node <<'EOF'\nrequire('fs').writeFileSync('/tmp/out.txt', 'x')\nEOF", "허용"],
    ["developer", "bash <<'EOF'\necho x > packages/shared/src/new.ts\nEOF", "허용"],
    [
      "qa",
      "python3 - <<'EOF'\nopen('packages/shared/src/rule.ts', 'w').write('x')\nEOF",
      "차단",
      QA_ONLY,
    ],
    // cp -l(하드 링크)·-s(심볼릭 링크)는 ln처럼 원본도 본다
    ["developer", "cp -l docs/prd.md /tmp/h", "차단", DOCS],
    ["developer", "cp --link docs/prd.md /tmp/h", "차단", DOCS],
    ["developer", "cp -al docs /tmp/docs-hard", "차단", DOCS],
    ["developer", "cp -s $PWD/docs/prd.md /tmp/s", "차단", "풀 수 없는 쓰기"],
    ["developer", "cp -l supabase/tests/helpers/db.ts /tmp/h", "차단", ACCEPT],
    ["developer", "cp -a docs /tmp/docs-copy", "허용"],
    ["developer", "cp -l packages/shared/src/rule.ts /tmp/h", "허용"],
    // 데이터 heredoc 본문(파일 내용·커밋 메시지·PR 본문)의 글자는 push·원격 DB 규칙에서 뺀다(이슈 #17 3단계 오탐)
    [undefined, "cat > /tmp/note.md <<'EOF'\n- 막힌 명령: git push origin main\nEOF", "허용"],
    [undefined, "cat <<'EOF' > /tmp/note.md\nsupabase db push --linked\nEOF", "허용"],
    [undefined, "cat <<'EOF' | tee /tmp/note.md\ngit push --force origin x\nEOF", "허용"],
    [undefined, "git commit -F - <<'EOF'\nchore: x\n\ngit push origin main 오탐 수정\nEOF", "허용"],
    [undefined, "gh pr create --draft --body-file - <<'EOF'\nsupabase db push 차단\nEOF", "허용"],
    [
      undefined,
      "cat > /tmp/a.md <<'EOF'\nx\nEOF\ngit push origin main",
      "차단",
      "main에 직접 push",
    ],
    [
      undefined,
      "cat > /tmp/a.sh <<'EOF' && git push origin main\nx\nEOF",
      "차단",
      "main에 직접 push",
    ],
    // 인터프리터·셸이 표준 입력으로 실행하는 heredoc은 계속 검사한다
    [undefined, "bash <<'EOF'\ngit push origin main\nEOF", "차단", "main에 직접 push"],
    [undefined, "cat <<'EOF' | bash\ngit push origin main\nEOF", "차단", "main에 직접 push"],
    [undefined, "cat <<'EOF' | tee /tmp/x | sh\nsupabase db push\nEOF", "차단", "db push"],
    [
      undefined,
      "python3 - <<'EOF'\nimport os\nos.system('supabase db push')\nEOF",
      "차단",
      "db push",
    ],
    [undefined, "ssh host <<'EOF'\nsupabase db push\nEOF", "차단", "db push"],
    // 따옴표 없는 구분자는 셸이 본문의 $(…)·백틱을 실행하므로 남긴다
    [undefined, "cat > /tmp/a <<EOF\n$(git push origin main)\nEOF", "차단", "main에 직접 push"],
    [undefined, "cat > /tmp/a <<EOF\n`supabase db push`\nEOF", "차단", "db push"],
    [undefined, "cat > /tmp/a <<'EOF'\n$(git push origin main) `supabase db push`\nEOF", "허용"],
    [undefined, "cat > /tmp/a <<EOF\n$HOME 에서 git push origin main 금지\nEOF", "허용"],
    // 트레일러 규칙은 명령 전체를 본다: 나눠서 실행하라고 안내한다
    ["developer", "git log --grep 'Acceptance: qa' --oneline; git status", "차단", "나눠서"],
    ["designer", 'git commit -m "feat: x\n\nAcceptance: qa"', "차단", TRAILER],
    ["planner", 'git commit -m "docs: x\n\nAcceptance: qa"', "차단", TRAILER],
    ["qa", 'git commit -m "test: x\n\nAcceptance: qa"', "허용"],
    [undefined, 'git commit -m "test: x\n\nAcceptance: qa"', "허용"],
  ];

  it("main을 checkout한 worktree에서 refspec 없이 push하면 막는다", () => {
    const result = runHook("guard-bash.mjs", {
      tool_name: "Bash",
      cwd: worktree,
      tool_input: { command: "git push" },
    });
    expectVerdict(result, "차단", "main에 직접 push");
  });

  it.each(rows)("%s · %s → %s", (role, command, verdict, reason) => {
    const result = runHook("guard-bash.mjs", {
      tool_name: "Bash",
      cwd: repo,
      ...roleInput(role),
      tool_input: { command },
    });
    expectVerdict(result, verdict, reason);
  });
});

describe("guard-bash: 오탐 정리 (이슈 #48)", () => {
  const OPAQUE = "풀 수 없는 쓰기";
  // 실제 차단 기록(.claude/logs, #17 댓글, #23·#32·#38·#41)과 같은 종류의 명령. 이제 허용한다
  const allowed: BashRow[] = [
    // 1. 테스트·검사 실행 + 보호 경로 문자열(developer.opaque-write, 로그 target tests/acceptance/·supabase/migrations/)
    ["developer", "pnpm vitest run supabase/tests/acceptance/17-example.test.ts", "허용"],
    ["developer", "cd supabase && pnpm vitest run tests/acceptance/17-example.test.ts", "허용"],
    ["developer", "pnpm --filter @vocals/supabase exec vitest run tests/acceptance", "허용"],
    ["developer", "pnpm -C supabase test -- tests/acceptance/17-example.test.ts", "허용"],
    ["developer", "npx vitest run supabase/tests/acceptance/", "허용"],
    ["developer", "pnpm test 2>&1 | tail -20; ls supabase/migrations/", "허용"],
    ["developer", "pnpm check && git diff --stat origin/main -- supabase/migrations/", "허용"],
    ["developer", "pnpm check:migrations; cat supabase/migrations/20260101000000_init.sql", "허용"],
    ["developer", "pnpm run check:req-trace && grep -n PAY docs/prd.md", "허용"],
    ["developer", "pnpm db:reset && ls supabase/migrations/", "허용"],
    ["developer", 'pnpm db:query "select 1" && cat supabase/tests/helpers/db.ts', "허용"],
    ["developer", "pnpm typecheck && pnpm lint && cat docs/prd.md", "허용"],
    ["developer", "pnpm exec prettier --check docs/ supabase/tests/acceptance/", "허용"],
    ["developer", "npx tsc --noEmit -p supabase && ls supabase/tests/acceptance", "허용"],
    [
      "developer",
      "node --experimental-strip-types scripts/acceptance-guard.ts && ls supabase/tests/acceptance",
      "허용",
    ],
    [
      "developer",
      "ls supabase/tests/acceptance | xargs -I{} git log -1 --format=%s -- supabase/tests/acceptance/{}",
      "허용",
    ],
    ["developer", "ls supabase/tests/acceptance | xargs pnpm vitest run", "허용"],
    ["developer", 'cd "$(git rev-parse --show-toplevel)" && cat docs/prd.md', "허용"],
    // 2. 데이터 인자·heredoc의 경로 글자(gh api -f, jq, printf, git commit -m, gh --body-file -)
    [
      "developer",
      "pnpm format && gh api repos/o/r/pulls/1 -X PATCH -f body='docs/prd.md 확인, supabase/migrations/ 추가'",
      "허용",
    ],
    ["developer", 'pnpm format && git commit -m "fix: supabase/migrations/ 이름 확인"', "허용"],
    [
      "developer",
      "pnpm format && gh pr create --draft --body-file - <<'EOF'\n- docs/prd.md 참고\nEOF",
      "허용",
    ],
    [
      "developer",
      "pnpm format; gh api x --jq '.[] | select(.filename | startswith(\"supabase/migrations/\"))'",
      "허용",
    ],
    [
      "developer",
      "pnpm format && jq -r '.files[] | select(startswith(\"docs/\"))' /tmp/pr.json",
      "허용",
    ],
    ["developer", "pnpm format; printf '%s\\n' 'docs/prd.md'", "허용"],
    // 명령 규칙(push·원격 DB)도 데이터 인자의 글자는 보지 않는다
    [
      undefined,
      "gh api repos/o/r/issues/1/comments -f body='막힌 명령: git push origin main'",
      "허용",
    ],
    [undefined, 'git commit -m "fix: git push origin main 오탐 수정"', "허용"],
    [undefined, "grep -rn 'supabase db push' plugins/", "허용"],
    [undefined, "jq -n --arg cmd 'supabase db push --linked' '{cmd: $cmd}'", "허용"],
    [undefined, "echo 'git push --force origin x 는 막힌다'", "허용"],
    [undefined, "printf '%s\\n' 'git push origin main' > /tmp/note.md", "허용"],
    [undefined, "gh api x -f body='`code` 안의 git push origin main'", "허용"],
    // 3. 인터프리터 코드의 글(PR 본문·문서 내용)에 든 경로(qa.scope #38·#41, planner.scope packages/shared)
    [
      "qa",
      "python3 - <<'EOF'\nbody = open('/tmp/pr.md').read()\nbody = body.replace('vitest run tests/acceptance', 'pnpm vitest run supabase/tests/acceptance')\nopen('/tmp/pr.md', 'w').write(body)\nEOF",
      "허용",
    ],
    [
      "qa",
      "python3 - <<'EOF'\nbody = '''\n## 확인\n- `20261122090000_client_insert_authorization.sql` 정책\n- 'supabase/seed.sql' 더미 사용자\n'''\nopen('/tmp/body.md', 'w').write(body)\nEOF",
      "허용",
    ],
    [
      "qa",
      "python3 - <<'EOF'\nimport json\nb = json.load(open('/tmp/pr.json'))['body']\nb = b.replace('supabase/migrations/20261122090000_client_insert_authorization.sql', 'x')\nopen('/tmp/body.md', 'w').write(b)\nEOF",
      "허용",
    ],
    [
      "qa",
      "python3 -c \"import json; json.dump({'body': 'packages/shared/src/rule.ts 수정 필요'}, open('/tmp/b.json', 'w'))\"",
      "허용",
    ],
    ["qa", "python3 -c \"open('/tmp/n.md', 'w').write('packages/shared/src/rule.ts')\"", "허용"],
    [
      "qa",
      "node -e \"require('fs').writeFileSync('/tmp/b.md', 'packages/shared/src/rule.ts')\"",
      "허용",
    ],
    [
      "qa",
      "python3 - <<'EOF'\n# don't touch packages/shared/src/rule.ts\nopen('/tmp/x', 'w').write('x')\nEOF",
      "허용",
    ],
    [
      "planner",
      // replace의 바꿀 글자가 공백 없는 경로 모양이면 결과가 경로일 수 있어 경로로 본다(QA 반려). 문장은 허용
      "python3 - <<'EOF'\np = 'docs/erd.md'\ns = open(p).read()\ns = s.replace('packages/shared/ 규칙', 'packages/shared/src/ 순수 함수')\nopen(p, 'w').write(s)\nEOF",
      "허용",
    ],
    // 4. find -exec 읽기 명령(planner.scope packages/shared)
    ["planner", "find packages/shared -name '*.ts' -exec sed -n '1,5p' {} \\;", "허용"],
    ["planner", "find packages/shared -type f -exec perl -ne 'print if /PAY/' {} +", "허용"],
    ["planner", "find packages/shared -name '*.ts' -exec cp {} /tmp/ \\;", "허용"],
    ["developer", "find docs -name '*.md' -exec grep -l PAY {} +", "허용"],
  ];

  // 진짜 쓰기는 그대로 막는다
  const blocked: BashRow[] = [
    // 파일을 쓰는 러너 인자: 스냅샷 갱신, --write, --fix, --update, 포맷
    ["developer", "pnpm vitest run -u supabase/tests/acceptance/", "차단", OPAQUE],
    [
      "developer",
      "pnpm test -- --update supabase/tests/acceptance/17-example.test.ts",
      "차단",
      OPAQUE,
    ],
    ["developer", "npx prettier --write docs/prd.md", "차단", OPAQUE],
    ["developer", "pnpm exec eslint --fix supabase/tests/acceptance/", "차단", OPAQUE],
    ["developer", "pnpm format && cat docs/prd.md", "차단", OPAQUE],
    ["developer", "npx -c 'vitest run' docs/", "차단", OPAQUE],
    ["developer", "node scripts/check-req-trace.ts --update docs/", "차단", OPAQUE],
    ["developer", "pnpm vitest init docs/", "차단", OPAQUE],
    // 모르는 곳으로 cd한 뒤의 쓰기
    ["developer", 'cd "$(git rev-parse --show-toplevel)" && echo x > docs/prd.md', "차단", OPAQUE],
    ["developer", "cd $X && git -C docs rm prd.md", "차단", OPAQUE],
    // 파일로 쓴 데이터(나중에 실행될 수 있다)와 파이프로 쓰기 명령에 넘기는 데이터
    ["developer", "printf 'rm -rf docs\\n' > /tmp/x.sh && bash /tmp/x.sh", "차단", OPAQUE],
    ["developer", "cat > /tmp/x.sh <<'EOF'\nrm -rf docs\nEOF\nbash /tmp/x.sh", "차단", OPAQUE],
    ["developer", "echo docs/prd.md | xargs rm", "차단", OPAQUE],
    [
      "developer",
      "gh api x --jq '.[].filename' > /tmp/l && xargs rm < /tmp/l; ls docs",
      "차단",
      OPAQUE,
    ],
    // 명령 규칙: 실행되는 데이터
    [undefined, "echo 'git push origin main' | sh", "차단", "main에 직접 push"],
    [undefined, 'echo "$(git push origin main)"', "차단", "main에 직접 push"],
    [undefined, 'gh api x -f body="$(supabase db push)"', "차단", "db push"],
    [undefined, "gh api x -f body=`supabase db push`", "차단", "db push"],
    [undefined, 'git commit -m "x" && git push origin main', "차단", "main에 직접 push"],
    [undefined, 'git commit -m "$(git push origin main)"', "차단", "main에 직접 push"],
    [undefined, "grep -l x docs/*.md | xargs -I{} sh -c 'supabase db push'", "차단", "db push"],
    // 인터프리터 코드의 진짜 쓰기(변수·목록·경로 인자, 공백 있는 경로)
    [
      "qa",
      "python3 - <<'EOF'\np = 'packages/shared/src/rule.ts'\nopen(p, 'w').write('x')\nEOF",
      "차단",
      QA_ONLY,
    ],
    [
      "developer",
      "python3 - <<'EOF'\nfor f in ['docs/a.md', 'docs/b.md']:\n    open(f, 'w').write('x')\nEOF",
      "차단",
      DOCS,
    ],
    ["developer", "python3 -c \"open('docs/my notes.md', 'w').write('x')\"", "차단", DOCS],
    ["developer", "node -e \"require('fs').writeFileSync('docs/a b.md', 'x')\"", "차단", DOCS],
    [
      "developer",
      "python3 - <<'EOF'\nimport shutil\nshutil.copy('/tmp/x', 'docs/prd.md')\nEOF",
      "차단",
      DOCS,
    ],
    [
      "developer",
      "python3 - <<'EOF'\nimport os\nos.replace('/tmp/x', 'docs/prd.md')\nEOF",
      "차단",
      DOCS,
    ],
    [
      "developer",
      "python3 - <<'EOF'\nbody = open('docs/prd.md').read().replace('a', 'b')\nopen('docs/prd.md', 'w').write(body)\nEOF",
      "차단",
      DOCS,
    ],
    [
      "developer",
      "python3 - <<'EOF'\nfrom pathlib import Path\nPath('docs/prd.md').write_text('packages/shared')\nEOF",
      "차단",
      DOCS,
    ],
    ["developer", 'perl -e \'open(my $f, ">", "docs/prd.md")\'', "차단", DOCS],
    ["developer", "perl -e 'open(F, \">docs/prd.md\")'", "차단", DOCS],
    ["developer", "ruby -e \"File.write('docs/prd.md', 'packages')\"", "차단", DOCS],
    [
      "developer",
      "node -e \"const p = 'docs/prd.md'; require('fs').appendFileSync(p, 'x')\"",
      "차단",
      DOCS,
    ],
    // find의 진짜 쓰기
    ["developer", "find docs -name '*.md' -exec sed -i 's/a/b/' {} +", "차단", DOCS],
    ["developer", "find /tmp/src -name '*.md' -exec cp {} docs/ \\;", "차단", DOCS],
    ["developer", "find docs -exec mv {} /tmp/ \\;", "차단", DOCS],
    ["developer", "find docs -name '*.md' -exec cp /tmp/x {} \\;", "차단", DOCS],
    ["developer", "find /tmp -name x -fprint docs/list.txt", "차단", DOCS],
    ["developer", "find docs -name '*.md' -exec sh -c 'echo x > \"$1\"' _ {} \\;", "차단", OPAQUE],
    ["planner", "find packages/shared -name '*.ts' -exec sed -i 's/a/b/' {} +", "차단", PLANNER],
    // QA 반려 뒤 더한 것: 직접 부른 도구·다운로드·셸 표준 입력
    ["developer", "pnpm check && tsc --outDir docs", "차단", OPAQUE],
    ["developer", "pnpm exec tsc --noEmit=false --outDir docs", "차단", OPAQUE],
    ["developer", "curl -O https://example.com/prd.md && ls docs", "차단", OPAQUE],
    ["developer", "cd docs && wget https://example.com/prd.md", "차단", OPAQUE],
    ["qa", "curl -sSo packages/shared/src/rule.ts https://example.com", "차단", QA_ONLY],
    ["qa", "wget -P packages/shared https://example.com/x.ts", "차단", QA_ONLY],
    ["developer", "git log -1 --format=%B | sh; ls docs", "차단", OPAQUE],
    ["developer", "awk 'BEGIN{system(\"rm docs/prd.md\")}'", "차단", OPAQUE],
    [
      "qa",
      "node -e \"require('fs').writeFileSync(process.argv[1], 'x')\" packages/shared/src/rule.ts",
      "차단",
      QA_ONLY,
    ],
    ["developer", "bash -c 'echo x > docs/a.md; echo $HOME'", "차단", DOCS],
    [
      "developer",
      "python3 -c \"import sys; f = open('/tmp/o', 'w'); f.write('docs/x'.replace('x', 'y'))\"",
      "허용",
    ],
    ["developer", "awk '{print $1}' docs/prd.md", "허용"],
    ["developer", "curl -s https://example.com | jq . > /tmp/x.json; cat docs/prd.md", "허용"],
    ["developer", "wget -qO- https://example.com | head; ls docs", "허용"],
    [undefined, "echo 'git push origin main 오탐' > /tmp/note.md", "허용"],
  ];

  it.each([...allowed, ...blocked])("%s · %s → %s", (role, command, verdict, reason) => {
    const result = runHook("guard-bash.mjs", {
      tool_name: "Bash",
      cwd: repo,
      ...roleInput(role),
      tool_input: { command },
    });
    expectVerdict(result, verdict, reason);
  });
});

// QA 독립 검증(이슈 #48): main 훅은 막았는데 #48의 새 허용(readOnlyTool, TEXT_FNS, 데이터 인자 제거,
// 검사 실행의 opaque 제외)으로 열린 진짜 쓰기·실행. 모두 main 훅에서 차단되던 명령이다.
describe("guard-bash: #48 새 허용으로 열린 우회 (QA 재현)", () => {
  const rows: BashRow[] = [
    // readOnlyTool: `--noEmit false`는 tsc가 실제로 출력 파일을 쓴다
    ["developer", "pnpm exec tsc --noEmit false --outDir docs", "차단"],
    ["developer", "npx tsc --noEmit --noEmit false --outDir docs", "차단"],
    // TEXT_FNS: replace·sub의 바꿀 글자가 그대로 쓰기 경로가 된다
    ["developer", "python3 -c \"open('x'.replace('x', 'docs/prd.md'), 'w')\"", "차단"],
    [
      "developer",
      "python3 -c \"import re; p = re.sub('x', 'docs/prd.md', 'x'); open(p, 'w')\"",
      "차단",
    ],
    [
      "developer",
      "node -e \"require('fs').writeFileSync('a'.replace('a', 'docs/prd.md'), 'x')\"",
      "차단",
    ],
    // 데이터 인자 제거: 파일로 쓴 데이터·커밋 메시지를 같은 명령에서 실행한다
    [undefined, "echo 'supabase db push' > /tmp/x.sh && sh /tmp/x.sh", "차단", "db push"],
    [undefined, "printf 'git push --force origin main' > /tmp/x.sh; bash /tmp/x.sh", "차단"],
    [undefined, "echo 'supabase db push' | tee /tmp/x.sh && sh /tmp/x.sh", "차단", "db push"],
    [
      undefined,
      "git commit -m 'supabase db push' && git log -1 --format=%s | sh",
      "차단",
      "db push",
    ],
    // 검사 실행이 opaque에서 빠지면서, 뒤에 붙은 쓰기를 잡던 보호 경로 언급 검사가 꺼진다
    ["developer", "pnpm check && prettier --write docs/prd.md", "차단"],
    ["developer", "pnpm check && awk 'BEGIN{print 1 > \"docs/prd.md\"}'", "차단"],
    ["developer", "pnpm check && curl -o docs/prd.md https://example.com", "차단"],
    ["developer", "pnpm check && wget -O docs/prd.md https://example.com", "차단"],
    [
      "developer",
      "pnpm test && python3 -c \"import sys; open(sys.argv[1], 'w')\" docs/prd.md",
      "차단",
    ],
    ["developer", 'pnpm check && bash -c "$X" docs/prd.md', "차단"],
    // 2차 재판정(bae3a23): 글 자리(print·log·write) 안에서 부른 쓰기 호출
    ["developer", "python3 -c \"print(open('x'.replace('x', 'docs/prd.md'), 'w'))\"", "차단"],
    [
      "developer",
      "node -e \"console.log(require('fs').writeFileSync('a'.replace('a', 'docs/prd.md'), 'x'))\"",
      "차단",
    ],
    // 2차: 읽기 모드 도구의 쓰기 옵션(트레이스·캐시·커버리지 파일을 실제로 쓴다)
    ["developer", "pnpm exec tsc --noEmit --generateTrace docs", "차단"],
    ["developer", "pnpm exec tsc --noEmit --incremental --tsBuildInfoFile docs/prd.md", "차단"],
    ["developer", "pnpm exec tsc --noEmit --generateCpuProfile docs/prd.md", "차단"],
    ["developer", "pnpm exec vitest run --coverage --coverage.reportsDirectory docs", "차단"],
    ["developer", "pnpm exec eslint --cache --cache-location docs/prd.md .", "차단"],
    ["developer", "pnpm exec prettier --check --cache --cache-location docs/prd.md .", "차단"],
    // 2차: executes()가 못 보는 실행(파일로 쓴 데이터·커밋 메시지를 같은 명령에서 실행)
    [
      undefined,
      "echo 'supabase db push' > /tmp/x.sh && find /tmp -name x.sh -exec sh {} \\;",
      "차단",
      "db push",
    ],
    [
      undefined,
      "echo 'supabase db push' > /tmp/x.sh; awk 'BEGIN{system(\"sh /tmp/x.sh\")}'",
      "차단",
      "db push",
    ],
    [undefined, "echo 'supabase db push' > /tmp/x.sh; timeout 5 sh /tmp/x.sh", "차단", "db push"],
    [
      undefined,
      "echo 'supabase db push' > /tmp/x.sh; script -qc 'sh /tmp/x.sh' /dev/null",
      "차단",
      "db push",
    ],
    [
      undefined,
      "echo 'supabase db push' > /tmp/x.sh; git -c alias.z='!sh /tmp/x.sh' z",
      "차단",
      "db push",
    ],
    [undefined, "git commit -m 'supabase db push' && $(git log -1 --format=%s)", "차단", "db push"],
    // 2차: 검사 실행 뒤 쓰기(새 규칙이 못 보는 출력 옵션·argv)
    [
      "developer",
      "pnpm check && python3 -c \"import sys; open(sys.orig_argv[-1], 'w')\" docs/prd.md",
      "차단",
    ],
    ["developer", "pnpm check && curl -D docs/prd.md https://example.com", "차단"],
    ["developer", "pnpm check && curl -c docs/prd.md https://example.com", "차단"],
    ["developer", "pnpm check && curl --trace docs/prd.md https://example.com", "차단"],
    ["developer", "pnpm check && curl --stderr docs/prd.md https://example.com", "차단"],
    ["developer", "pnpm check && wget -a docs/prd.md -O- https://example.com", "차단"],
    ["developer", "pnpm check && wget --output-file=docs/prd.md -O- https://example.com", "차단"],
    ["developer", "pnpm check && wget -qO- https://example.com --save-cookies docs/prd.md", "차단"],
    [
      "developer",
      "pnpm check && node -e \"require('fs').writeFileSync(require('path').join('docs', 'prd.md'), 'x')\"",
      "차단",
    ],
  ];

  it.each(rows)("%s · %s → %s", (role, command, verdict, reason) => {
    const result = runHook("guard-bash.mjs", {
      tool_name: "Bash",
      cwd: repo,
      ...roleInput(role),
      tool_input: { command },
    });
    expectVerdict(result, verdict, reason);
  });
});

describe("guard-mcp: 위험한 Supabase MCP 도구 (이슈 #17)", () => {
  const dangerous = [
    "create_project",
    "pause_project",
    "restore_project",
    "create_branch",
    "delete_branch",
    "merge_branch",
    "reset_branch",
    "rebase_branch",
    "apply_migration",
    "execute_sql",
    "deploy_edge_function",
    "create_edge_function_secret",
    "confirm_cost",
    "run_notebook",
    "create_notebook",
    "delete_notebook",
  ];
  const prefixes = [
    "mcp__Supabase__",
    "mcp__claude_ai_Supabase__",
    "mcp__plugin_supabase_supabase__",
  ];
  const matcher = (() => {
    const config = JSON.parse(readFileSync(join(HOOKS, "hooks.json"), "utf8"));
    const entry = config.hooks.PreToolUse.find((e: { hooks: { command: string }[] }) =>
      e.hooks.some((h) => h.command.includes("guard-mcp.mjs")),
    );
    return new RegExp(entry.matcher);
  })();

  it.each(prefixes.flatMap((prefix) => dangerous.map((tool) => [`${prefix}${tool}`])))(
    "%s → 차단 (matcher도 걸린다)",
    (toolName) => {
      expect(matcher.test(toolName)).toBe(true);
      for (const role of [undefined, "developer", "qa"]) {
        const result = runHook("guard-mcp.mjs", {
          tool_name: toolName,
          ...roleInput(role),
          tool_input: { project_id: "p" },
        });
        expectVerdict(result, "차단", "Supabase");
      }
    },
  );

  it.each([
    ["mcp__0f3a9c__create_project", { name: "x", organization_id: "o", region: "ap" }],
    ["mcp__0f3a9c__merge_branch", { branch_id: "b" }],
    ["mcp__0f3a9c__execute_sql", { query: "select 1" }],
  ])("서버 이름을 몰라도 Supabase 모양이면 차단: %s", (toolName, toolInput) => {
    expectVerdict(runHook("guard-mcp.mjs", { tool_name: toolName, tool_input: toolInput }), "차단");
  });

  it.each([
    ["mcp__Figma__create_branch", { fileKey: "f", branchName: "b" }],
    ["mcp__github__create_branch", { owner: "o", repo: "r", branch: "b" }],
    ["mcp__github__merge_branch", { owner: "o", repo: "r", base: "main" }],
  ])("다른 커넥터의 같은 이름은 허용: %s", (toolName, toolInput) => {
    expectVerdict(runHook("guard-mcp.mjs", { tool_name: toolName, tool_input: toolInput }), "허용");
  });

  it.each([
    "mcp__Supabase__list_tables",
    "mcp__Supabase__list_migrations",
    "mcp__Supabase__get_project",
    "mcp__Supabase__generate_typescript_types",
    "mcp__Supabase__search_docs",
    "mcp__Supabase__get_notebook",
    "mcp__Supabase__list_notebooks",
  ])("읽기 도구는 matcher에 걸리지 않고 허용: %s", (toolName) => {
    expect(matcher.test(toolName)).toBe(false);
    expectVerdict(
      runHook("guard-mcp.mjs", { tool_name: toolName, tool_input: { project_id: "p" } }),
      "허용",
    );
  });
});

describe("로컬 .claude/settings.json (이슈 #17)", () => {
  const settings = JSON.parse(
    readFileSync(fileURLToPath(new URL("../.claude/settings.json", import.meta.url)), "utf8"),
  );
  const plugin = JSON.parse(readFileSync(join(HOOKS, "hooks.json"), "utf8"));

  it("PreToolUse 훅은 레포의 플러그인 스크립트를 그대로 부르고 matcher가 같다", () => {
    const local = settings.hooks.PreToolUse.map(
      (e: { matcher: string; hooks: { command: string }[] }) => [
        e.matcher,
        e.hooks[0]?.command.replace(
          "$CLAUDE_PROJECT_DIR/plugins/vocals-team",
          "${CLAUDE_PLUGIN_ROOT}",
        ),
      ],
    );
    const fromPlugin = plugin.hooks.PreToolUse.map(
      (e: { matcher: string; hooks: { command: string }[] }) => [e.matcher, e.hooks[0]?.command],
    );
    expect(local).toEqual(fromPlugin);
  });

  it("permissions deny에 위험한 Supabase 도구가 있다", () => {
    for (const tool of ["execute_sql", "apply_migration", "create_project", "run_notebook"]) {
      expect(settings.permissions.deny).toContain(`mcp__Supabase__${tool}`);
    }
  });
});

describe("hooks.json (이슈 #17)", () => {
  const config = JSON.parse(readFileSync(join(HOOKS, "hooks.json"), "utf8"));

  it("명령이 가리키는 스크립트가 플러그인 안에 있다", () => {
    for (const entry of config.hooks.PreToolUse) {
      for (const hook of entry.hooks) {
        const script = /\$\{CLAUDE_PLUGIN_ROOT\}\/(\S+?\.mjs)/.exec(hook.command)?.[1];
        expect(script).toBeTruthy();
        expect(() => readFileSync(join(PLUGIN, script as string))).not.toThrow();
      }
    }
  });

  it("파일 쓰기 도구와 Bash에 훅이 걸린다", () => {
    const matchers: string[] = config.hooks.PreToolUse.map((e: { matcher: string }) => e.matcher);
    const covered = (tool: string) =>
      matchers.some((m) =>
        /^[\w|]+$/.test(m) ? m.split("|").includes(tool) : new RegExp(m).test(tool),
      );
    for (const tool of ["Edit", "Write", "MultiEdit", "NotebookEdit", "Bash"]) {
      expect(covered(tool)).toBe(true);
    }
  });
});
