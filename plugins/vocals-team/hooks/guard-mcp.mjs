// PreToolUse(mcp__*): Supabase 커넥터의 위험한 도구를 모든 세션에서 막는다. 이슈 #17.
//
// 커넥터 도구 이름의 접두어(mcp__Supabase__, mcp__claude_ai_Supabase__, mcp__plugin_…)는 환경마다 달라서
// 마지막 "__" 뒤 도구 이름으로 판단한다.
//   - Supabase에만 있는 이름: 서버가 무엇이든 막는다.
//   - 다른 커넥터에도 흔한 이름(create_branch 등, Figma·GitHub에도 있음): 서버 이름에 supabase가 있거나
//     입력이 Supabase 모양(project_id, organization_id, branch_id, confirm_cost_id)일 때만 막는다.
import { block, readInput, run } from "./lib/io.mjs";

const SUPABASE_ONLY = [
  "pause_project",
  "restore_project",
  "reset_branch",
  "rebase_branch",
  "apply_migration",
  "execute_sql",
  "deploy_edge_function",
  "create_edge_function_secret",
  "confirm_cost",
];
const SHARED_NAMES = [
  "create_project",
  "create_branch",
  "delete_branch",
  "merge_branch",
  // 노트북: run_notebook은 원격 DB에 SQL을 실행하고(확인 후 쓰기도 됨), create는 프로젝트 공유 상태에 SQL을 저장하고,
  // delete는 되돌릴 수 없다. get_notebook·list_notebooks는 읽기라 허용한다.
  "run_notebook",
  "create_notebook",
  "delete_notebook",
];
const SUPABASE_KEYS = ["project_id", "organization_id", "branch_id", "confirm_cost_id"];

const INSTEAD = {
  run_notebook:
    "조회는 로컬 DB(`pnpm db:query`)로 하세요. 원격 조회가 꼭 필요하면 `[질문] 받는 역할: PM`으로 보고하세요.",
  execute_sql:
    "조회는 `list_tables`·`list_migrations` 같은 읽기 도구나 로컬 DB(`pnpm db:query`)로 하세요. 데이터·스키마 변경은 마이그레이션 파일과 seed로 합니다.",
  apply_migration:
    "`supabase/migrations/<타임스탬프>_<이름>.sql` 새 파일로 만들고 로컬(`pnpm db:reset`)과 CI에서 검증하세요.",
  deploy_edge_function:
    "`supabase/functions/`에 코드로 두고 PR로 올리세요. 배포는 사람이 정합니다.",
  create_edge_function_secret: "필요한 키 이름을 `.env.example`에 적고 [보고]로 사람에게 알리세요.",
};
const DEFAULT_INSTEAD =
  "로컬 DB와 seed로 개발·검증하세요(`pnpm db:reset`). 원격 작업이 꼭 필요하면 `[질문] 받는 역할: PM`으로 보고하세요.";

run(() => {
  const input = readInput();
  if (!input) return;
  const toolName = String(input.tool_name ?? "");
  const match = /^mcp__(.+)__([^_].*)$/.exec(toolName);
  if (!match) return;
  const server = match[1] ?? "";
  const tool = match[2] ?? "";
  const toolInput = input.tool_input ?? {};
  const looksSupabase =
    /supabase/i.test(server) || SUPABASE_KEYS.some((key) => Object.hasOwn(toolInput, key));
  if (SUPABASE_ONLY.includes(tool) || (SHARED_NAMES.includes(tool) && looksSupabase)) {
    block({
      summary: `Supabase \`${tool}\`은(는) 쓰지 않습니다.`,
      target: toolName,
      rule: "mcp.supabase",
      logTarget: toolName, // 도구 이름만. 인자 값(project_id, SQL 등)은 남기지 않는다
      why: "원격 DB·비용·스키마에 바로 영향을 주고 되돌리기 어렵습니다. 스키마는 마이그레이션 파일로만 바꾸고, 원격 프로젝트는 새로 만들지 않습니다(CLAUDE.md).",
      instead: INSTEAD[tool] ?? DEFAULT_INSTEAD,
    });
  }
});
