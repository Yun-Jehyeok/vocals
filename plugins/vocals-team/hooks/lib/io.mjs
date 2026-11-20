// 훅 입출력 공용. 종료 코드 2 = 차단(stderr가 Claude에게 전달됨), 0 = 허용.
import { readFileSync } from "node:fs";

/** stdin의 훅 입력 JSON. 읽지 못하면 null */
export function readInput() {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return null;
  }
}

/**
 * 차단 메시지를 "무엇 / 왜 / 대신 할 일" 형식으로 내고 종료 코드 2로 끝낸다.
 * @param {{ summary: string, why: string, instead: string, target?: string }} message
 */
export function block({ summary, why, instead, target }) {
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
