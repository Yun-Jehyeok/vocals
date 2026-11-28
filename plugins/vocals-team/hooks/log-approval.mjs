// PermissionRequest: 사람의 승인을 기다리는 도구 호출을 `.claude/logs/`에 남긴다(이슈 #61, 승인 대기 측정).
//
// - 남기는 것: `event: "approval"`, `rule: "approval.wait"`, 역할, 도구 이름. target은 null.
// - 남기지 않는 것: 명령 원문, 도구 인자(tool_input), 권한 제안(permission_suggestions). 시크릿·개인정보가 들어갈 수 있다.
// - 결정을 내지 않는다: stdout에 아무것도 쓰지 않고 종료 코드 0. 승인 흐름(프롬프트, 프롬프트를 못 띄우는 세션의 자동 거부)은 그대로다.
//
// Notification(`permission_prompt`)이 아니라 PermissionRequest를 쓰는 이유(Claude Code 훅 문서):
// Notification 입력에는 도구 이름이 없고(message·title·notification_type만), 프롬프트가 약 6초 기다린 뒤에만 온다.
// PermissionRequest는 승인을 물으려 할 때마다 tool_name과 함께 오고, 프롬프트를 못 띄우는 백그라운드 서브에이전트에서도 돈다.
import { readFileSync } from "node:fs";
import { APPROVAL_RULE, logEvent } from "./lib/log.mjs";

try {
  const input = JSON.parse(readFileSync(0, "utf8") || "{}");
  logEvent({ input, event: "approval", rule: APPROVAL_RULE, target: null, root: input?.cwd });
} catch {
  // 측정용이다. 실패해도 승인 흐름에 영향을 주지 않는다
}
process.exit(0);
