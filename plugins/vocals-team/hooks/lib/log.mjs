// 차단 이벤트 로그. 이슈 #17 하네스 6단계(측정).
//
// 훅이 막을 때마다 `<메인 체크아웃>/.claude/logs/<YYYY-MM-DD>-<세션 앞 8자>-<브랜치>.jsonl`에 한 줄을 더한다.
// 메인 체크아웃: 세션 프로젝트(CLAUDE_PROJECT_DIR)의 git common dir 기준. 수동 worktree·/tmp 복사본에서 막혀도 여기 남는다.
// 브랜치: 막힌 체크아웃의 브랜치. 브랜치마다 파일이 달라 여러 PR이 같은 파일을 고치지 않는다(이슈 #48).
// 클라우드는 세션이 끝나면 파일이 사라지므로 팀장이 그 브랜치의 작업 PR에 커밋한다(PM 결정, docs/decisions.md 2026-11-20).
// 집계는 `pnpm harness:report`(scripts/harness-report.ts).
//
// 승인 요청도 같은 파일에 남긴다(이슈 #61): `hooks/log-approval.mjs`(PermissionRequest)가 `event: "approval"`,
// `rule: "approval.wait"`, 역할, 도구 이름만 쓴다(target은 null). 차단이 아니라서 RULE_IDS에는 넣지 않는다.
//
// - 남기는 것: ts, session, event, rule, role, tool, target(저장소 기준 경로나 MCP 도구 이름).
// - 남기지 않는 것: 명령 원문, 파일 내용, 도구 인자 값(시크릿·개인정보가 들어갈 수 있다).
// - 쓰기 실패는 조용히 무시한다. 차단 판정에 영향을 주지 않는다.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { findRepoRoot, realPath, roleOf } from "./rules.mjs";

/**
 * 훅이 낼 수 있는 규칙 id와 한 줄 설명. 안정적인 id라서 바꾸면 지난 로그와 집계가 끊긴다.
 * 새 차단을 더하면 여기에 id를 더한다(단위 테스트가 훅 소스와 이 목록이 같은지 본다).
 */
export const RULE_IDS = {
  "file.env": ".env 파일 수정",
  "file.migration": "기존 마이그레이션 수정·삭제",
  "developer.docs": "개발이 docs/ 수정",
  "developer.acceptance": "개발이 인수 테스트·판정 헬퍼 수정",
  "developer.opaque-write": "개발: 훅이 풀 수 없는 쓰기와 보호 경로가 한 명령에",
  "qa.scope": "QA가 테스트·기준선·QA 메모리 밖 수정",
  "planner.scope": "기획이 docs/·팀 규칙 문서 밖 수정",
  "designer.code": "디자인이 코드(apps/, packages/, supabase/, scripts/) 수정",
  "bash.force-push": "강제 push",
  "bash.push-main": "main 직접 push",
  "supabase.db-reset-remote": "원격 DB 초기화(db reset --linked/--db-url)",
  "supabase.db-push": "supabase db push",
  "supabase.migration-remote": "원격 마이그레이션 기록 변경",
  "supabase.remote-command": "원격 Supabase 프로젝트를 바꾸는 CLI",
  "supabase.psql-remote": "psql로 원격 Supabase DB 접속",
  "commit.acceptance-text": "QA가 아닌 역할의 명령에 `Acceptance:`",
  "commit.git-config": "QA가 아닌 역할의 git 편집기·템플릿·트레일러 설정",
  "commit.message-source": "QA가 아닌 역할의 메시지를 미리 볼 수 없는 커밋",
  "mcp.supabase": "위험한 Supabase MCP 도구",
};

/** 승인 요청 이벤트의 규칙 id(이슈 #61). 차단 규칙이 아니라 RULE_IDS 밖에 둔다 */
export const APPROVAL_RULE = "approval.wait";

const PLUGIN_MARKER = join("plugins", "vocals-team", ".claude-plugin", "plugin.json");
export const LOG_DIR = join(".claude", "logs");

function git(cwd, args) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
    }).trim();
  } catch {
    return "";
  }
}

/** path가 속한 vocals 저장소 루트(수동 worktree면 그 worktree). 아니면 null */
function vocalsRoot(path) {
  if (!path) return null;
  const root = findRepoRoot(realPath(resolve(String(path))));
  return root && existsSync(join(root, PLUGIN_MARKER)) ? root : null;
}

/** worktree의 메인 체크아웃(git common dir의 부모). 알 수 없으면 root 그대로 */
export function mainCheckout(root) {
  const common = git(root, ["rev-parse", "--git-common-dir"]);
  if (!common) return root;
  const dir = resolve(root, common);
  return basename(dir) === ".git" && existsSync(dirname(dir)) ? dirname(dir) : root;
}

/** 파일 이름에 쓸 브랜치 이름. `fix/48-x` → `fix-48-x`, 브랜치가 없으면(detached) `detached` */
export function branchSlug(branch) {
  const name = String(branch ?? "").trim();
  if (!name || name === "HEAD") return "detached";
  const slug = name
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return slug || "detached";
}

/** 파일 이름에 쓸 세션 앞 8자. `session_` 접두어와 영숫자가 아닌 글자는 뺀다 */
export function shortSession(sessionId) {
  const id = String(sessionId ?? "")
    .replace(/^session[_-]?/i, "")
    .replace(/[^A-Za-z0-9]/g, "");
  return id.slice(0, 8) || "unknown";
}

/** target을 저장소 기준 경로로 줄인다. 저장소 밖 절대 경로는 파일 이름만 남긴다(홈 디렉터리 이름 등을 남기지 않음) */
function shownTarget(target, root) {
  if (target === null || target === undefined || target === "") return null;
  let text = String(target);
  if (isAbsolute(text)) {
    const rel = relative(root, realPath(text));
    text = rel.startsWith("..") || isAbsolute(rel) ? basename(text) : rel.split(sep).join("/");
  }
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

/**
 * `<날짜>-<세션 앞 8자>-<브랜치>.jsonl`. 브랜치마다 파일이 달라서 같은 세션의 여러 PR이 같은 파일을 고치지 않는다(이슈 #48).
 * @param {string} dir @param {string} ts @param {string} session @param {string} branch
 */
export function logFileName(dir, ts, session, branch) {
  return join(dir, `${ts.slice(0, 10)}-${session}-${branch}.jsonl`);
}

/**
 * 이벤트 한 줄을 쓴다. 실패하면 아무것도 하지 않는다.
 * @param {{ input: any, event: "block" | "approval", rule: string | undefined, target?: string | null, root?: string | null }} entry
 */
export function logEvent({ input, event, rule, target, root }) {
  try {
    const project = vocalsRoot(process.env.CLAUDE_PROJECT_DIR);
    // 막힌 곳: 대상 파일·명령의 저장소(수동 worktree나 /tmp 복사본일 수 있다). 브랜치 이름과 target 기준
    const repo = vocalsRoot(root) ?? vocalsRoot(input?.cwd) ?? project;
    if (!repo) return;
    // 쓰는 곳: 세션 프로젝트(없으면 막힌 저장소)의 메인 체크아웃. worktree를 지워도 기록이 남는다(이슈 #48)
    const logRepo = mainCheckout(project ?? repo);
    const branch = branchSlug(git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]));
    const ts = new Date().toISOString();
    const session = shortSession(input?.session_id);
    const line = {
      ts,
      session,
      event,
      rule: rule ?? "unknown",
      role: roleOf(input?.agent_type) ?? (input?.agent_type ? String(input.agent_type) : "main"),
      tool: String(input?.tool_name ?? "").slice(0, 120),
      target: shownTarget(target, repo),
    };
    const dir = join(logRepo, LOG_DIR);
    mkdirSync(dir, { recursive: true });
    appendFileSync(logFileName(dir, ts, session, branch), `${JSON.stringify(line)}\n`);
  } catch {
    // 로그는 측정용이다. 실패해도 차단·승인 흐름은 그대로다
  }
}

/**
 * 차단 이벤트 한 줄을 쓴다. 실패하면 아무것도 하지 않는다.
 * @param {{ input: any, rule: string | undefined, target?: string | null, root?: string | null }} event
 */
export function logBlock({ input, rule, target, root }) {
  logEvent({ input, event: "block", rule, target, root });
}
