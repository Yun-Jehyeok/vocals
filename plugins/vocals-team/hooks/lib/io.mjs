// 훅 입출력 공용. 종료 코드 2 = 차단(stderr가 Claude에게 전달됨), 0 = 허용.
import { readFileSync } from "node:fs";
import { logBlock } from "./log.mjs";

/** 지금 처리 중인 훅 입력. 차단 로그(세션·역할·도구)에 쓴다 */
let current = null;

/** stdin의 훅 입력 JSON. 읽지 못하면 null */
export function readInput() {
  try {
    current = JSON.parse(readFileSync(0, "utf8") || "{}");
    return current;
  } catch {
    return null;
  }
}

/**
 * 차단 메시지를 "무엇 / 왜 / 대신 할 일" 형식으로 내고 종료 코드 2로 끝낸다.
 * 그 전에 `.claude/logs/`에 차단 이벤트를 남긴다(lib/log.mjs, 이슈 #17 6단계).
 * - rule: 규칙 id(lib/log.mjs의 RULE_IDS)
 * - logTarget: 로그에 남길 경로나 MCP 도구 이름. 명령 원문·인자 값은 넘기지 않는다. 없으면 null
 * - root: 로그를 쓸 저장소를 고를 경로(대상 파일의 저장소, 명령의 작업 디렉터리). 없으면 훅 입력의 cwd
 * @param {{ summary: string, why: string, instead: string, target?: string, rule: string, logTarget?: string | null, root?: string | null }} message
 */
export function block({ summary, why, instead, target, rule, logTarget = null, root = null }) {
  logBlock({ input: current, rule, target: logTarget, root });
  const lines = [`차단됨(vocals-team 훅): ${summary}`];
  if (target) lines.push(`대상: ${target.length > 300 ? `${target.slice(0, 300)}…` : target}`);
  lines.push(`왜: ${why}`, `대신 할 일: ${instead}`);
  process.stderr.write(`${lines.join("\n")}\n`);
  process.exit(2);
}

/** 훅 자체가 실패하면 막지 않는다(종료 코드 1 = 차단하지 않는 오류). 최종 보증은 CI다. */
export function run(main) {
  try {
    main();
    process.exit(0);
  } catch (error) {
    process.stderr.write(
      `vocals-team 훅 내부 오류(차단하지 않음): ${String(error?.stack ?? error)}\n`,
    );
    process.exit(1);
  }
}
