// harness-guard.yml(pull_request_target) 보안 규칙과 하네스 라벨 절차 (이슈 #17 2단계 후속)
// pull_request_target은 포크 PR에서도 기준 브랜치의 권한으로 돌아서, 아래 규칙이 깨지면 바로 위험해진다.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const raw = read("../.github/workflows/harness-guard.yml");
const lines = raw.split("\n");
/** 주석을 뺀 본문(줄 전체 주석과 줄 끝 " # …" 주석) */
const code = lines
  .filter((line) => !line.trim().startsWith("#"))
  .map((line) => line.replace(/\s+#\s.*$/, ""))
  .join("\n");

/** run: 키와 그 아래 들여쓰기된 줄들 */
function runBlocks(): string[] {
  const blocks: string[] = [];
  const codeLines = code.split("\n");
  for (let i = 0; i < codeLines.length; i++) {
    const match = /^(\s*)(- )?run:/.exec(codeLines[i] ?? "");
    if (!match) continue;
    const indent = (match[1] ?? "").length + (match[2] ? 2 : 0);
    const block = [codeLines[i] ?? ""];
    while (i + 1 < codeLines.length) {
      const next = codeLines[i + 1] ?? "";
      if (next.trim() !== "" && next.search(/\S/) <= indent) break;
      block.push(next);
      i++;
    }
    blocks.push(block.join("\n"));
  }
  return blocks;
}

describe("harness-guard.yml 보안 규칙 (이슈 #17 2단계 후속)", () => {
  it("pull_request_target으로 라벨 변경에도 돈다", () => {
    expect(code).toMatch(/pull_request_target:\s*\n\s*types: \[[^\]]*labeled[^\]]*unlabeled/);
  });

  it("액션은 커밋 SHA로 고정하고 주석에 버전을 적는다", () => {
    const uses = lines.filter((line) => /^\s*(- )?uses:/.test(line));
    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses) expect(line).toMatch(/@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
  });

  it("run: 안에 ${{ }} 보간이 없다", () => {
    const blocks = runBlocks();
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) expect(block).not.toContain("${{");
  });

  it("PR 코드를 checkout·설치·실행하지 않는다", () => {
    expect(code).toMatch(/ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
    expect(code).not.toMatch(/head\.(sha|ref)|pull_request\.title|pull_request\.body/);
    expect(code).not.toMatch(/\b(pnpm|npm|yarn)\s+(install|ci|i)\b|\bnpx\b/);
    expect(code).toMatch(/persist-credentials: false/);
  });

  it("권한은 contents: read뿐이고 시크릿·토큰·캐시를 쓰지 않는다", () => {
    const permissions = /^permissions:\n((?:[ \t]+.+\n)+)/m.exec(code)?.[1] ?? "";
    expect(permissions.trim()).toBe("contents: read");
    expect(code).not.toMatch(/permissions:\s*write|:\s*write\b/);
    expect(code).not.toMatch(/secrets\.|GITHUB_TOKEN|\bcache:/);
  });
});

describe("하네스 라벨 절차 (이슈 #17 2단계 후속)", () => {
  it("팀장 스킬에 merge 요청 직전 하네스 diff 재확인이 있다", () => {
    const skill = read("../plugins/vocals-team/skills/team-lead/SKILL.md");
    expect(skill).toMatch(/merge 요청 직전에[^\n]*하네스 diff를 다시 보고/);
    expect(skill).toMatch(/라벨을 붙인 뒤 바뀐 하네스 파일이 있으면 PM 보고에 적는다/);
  });
});
