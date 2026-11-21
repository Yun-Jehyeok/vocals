// 차단 이벤트 로그. 이슈 #17 하네스 6단계(측정).
//
// 훅이 막을 때마다 `<저장소 루트>/.claude/logs/<YYYY-MM-DD>-<세션 앞 8자>.jsonl`에 한 줄을 더한다.
// 클라우드는 세션이 끝나면 파일이 사라지므로 팀장이 작업 PR에 같이 커밋한다(PM 결정, docs/decisions.md 2026-11-20).
// 집계는 `pnpm harness:report`(scripts/harness-report.ts).
//
// - 남기는 것: ts, session, event, rule, role, tool, target(저장소 기준 경로나 MCP 도구 이름).
// - 남기지 않는 것: 명령 원문, 파일 내용, 도구 인자 값(시크릿·개인정보가 들어갈 수 있다).
// - 쓰기 실패는 조용히 무시한다. 차단 판정에 영향을 주지 않는다.
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
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

const PLUGIN_MARKER = join("plugins", "vocals-team", ".claude-plugin", "plugin.json");
export const LOG_DIR = join(".claude", "logs");

/** path가 속한 vocals 저장소 루트(수동 worktree면 그 worktree). 아니면 null */
function vocalsRoot(path) {
  if (!path) return null;
  const root = findRepoRoot(realPath(resolve(String(path))));
  return root && existsSync(join(root, PLUGIN_MARKER)) ? root : null;
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
 * 차단 이벤트 한 줄을 쓴다. 실패하면 아무것도 하지 않는다.
 * @param {{ input: any, rule: string | undefined, target?: string | null, root?: string | null }} event
 */
export function logBlock({ input, rule, target, root }) {
  try {
    const repo =
      vocalsRoot(root) ?? vocalsRoot(input?.cwd) ?? vocalsRoot(process.env.CLAUDE_PROJECT_DIR);
    if (!repo) return;
    const ts = new Date().toISOString();
    const session = shortSession(input?.session_id);
    const line = {
      ts,
      session,
      event: "block",
      rule: rule ?? "unknown",
      role: roleOf(input?.agent_type) ?? (input?.agent_type ? String(input.agent_type) : "main"),
      tool: String(input?.tool_name ?? ""),
      target: shownTarget(target, repo),
    };
    const dir = join(repo, LOG_DIR);
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, `${ts.slice(0, 10)}-${session}.jsonl`), `${JSON.stringify(line)}\n`);
  } catch {
    // 로그는 측정용이다. 실패해도 차단은 그대로 한다
  }
}
