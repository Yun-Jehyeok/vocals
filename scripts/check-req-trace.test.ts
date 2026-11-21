import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BASELINE_PATH,
  checkBaselineGrowth,
  extractTestNames,
  formatBaseline,
  parseBaseline,
  parseRequirementIds,
  trace,
} from "./check-req-trace.ts";

// 픽스처는 실제 prd.md에 없는 접두어(XYZ)만 쓴다. 이 파일도 센서가 읽기 때문이다.
const PRD = [
  "# PRD",
  "### 7.1 (XYZ)",
  "- `XYZ-01` 첫째",
  "- `XYZ-02` 둘째. `XYZ-01`을 참고한다.",
  "  - 하위 항목 `XYZ-09`는 정의가 아니다",
  "- `XYZ-03` 셋째",
  "본문의 `XYZ-04`도 정의가 아니다.",
].join("\n");

let root: string;

function write(file: string, content: string) {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "req-trace-"));
  write("docs/prd.md", PRD);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("요구사항 ID 파싱 (이슈 #17)", () => {
  it("목록 항목 맨 앞의 백틱 ID만 정의로 본다", () => {
    expect(parseRequirementIds(PRD)).toEqual(["XYZ-01", "XYZ-02", "XYZ-03"]);
  });

  it("기준선 파일은 주석과 빈 줄을 무시하고, 쓴 그대로 다시 읽힌다", () => {
    expect(parseBaseline(formatBaseline(["XYZ-01", "XYZ-03"]))).toEqual(["XYZ-01", "XYZ-03"]);
  });
});

describe("테스트 이름 추출 (이슈 #17)", () => {
  it("describe/it/test와 .each·.only·.concurrent의 이름을 읽는다", () => {
    const source = [
      'describe("묶음 — XYZ-01", () => {',
      "  it('작은따옴표', () => {});",
      "  test(`템플릿 ${1 + 1}`, () => {});",
      '  it.each([["a", 1], ["b", (2)]])("each %s", () => {});',
      '  it.concurrent.only("체인", () => {});',
      '  describe.each`a | b`("테이블", () => {});',
      "});",
    ].join("\n");
    expect(extractTestNames(source).map((test) => test.name)).toEqual([
      "묶음 — XYZ-01",
      "작은따옴표",
      "템플릿 ${1 + 1}",
      "each %s",
      "체인",
      "테이블",
    ]);
  });

  it("skip·todo는 건너뛴 것으로 표시하고, 주석과 다른 메서드(.test 등)는 세지 않는다", () => {
    const source = [
      'it.skip("건너뜀", () => {});',
      'it.todo("할 일");',
      '// it("주석")',
      '/* test("블록 주석") */',
      'const ok = /x/.test("문자열");',
      'expect.it("아님");',
      'it("진짜", () => {});',
    ].join("\n");
    expect(extractTestNames(source)).toEqual([
      { name: "건너뜀", skipped: true },
      { name: "할 일", skipped: true },
      { name: "진짜", skipped: false },
    ]);
  });
});

describe("요구사항 추적 래칫 (이슈 #17)", () => {
  it("기준선과 맞으면 통과하고 빠진 ID를 알려 준다", () => {
    write("pkg/a.test.ts", 'it("첫째 — XYZ-01", () => {});');
    const result = trace(root, ["XYZ-02", "XYZ-03"]);
    expect(result).toMatchObject({
      ok: true,
      covered: ["XYZ-01"],
      missing: ["XYZ-02", "XYZ-03"],
    });
  });

  it("기준선에 없는 ID에 테스트가 없으면 실패한다 (새 누락)", () => {
    write("pkg/a.test.ts", 'it("첫째 — XYZ-01", () => {});');
    const result = trace(root, ["XYZ-02"]);
    expect(result.ok).toBe(false);
    expect(result.newlyMissing).toEqual(["XYZ-03"]);
  });

  it("기준선에 남은 ID에 테스트가 생겼으면 실패한다 (기준선 줄이기)", () => {
    write("pkg/a.test.ts", 'it("첫째 — XYZ-01", () => {});\nit("둘째 XYZ-02", () => {});');
    const result = trace(root, ["XYZ-02", "XYZ-03"]);
    expect(result.ok).toBe(false);
    expect(result.stale).toEqual(["XYZ-02"]);
  });

  it("문서에서 사라진 ID가 기준선에 남아 있으면 실패한다", () => {
    write("pkg/a.test.ts", 'it("XYZ-01", () => {});');
    expect(trace(root, ["XYZ-02", "XYZ-03", "XYZ-77"]).stale).toEqual(["XYZ-77"]);
  });

  it("skip한 테스트, 주석, 테스트 파일이 아닌 파일, node_modules는 세지 않는다", () => {
    write("pkg/a.test.ts", 'it.skip("XYZ-01", () => {});\n// it("XYZ-02")');
    write("pkg/a.ts", 'it("XYZ-03", () => {});');
    write("node_modules/x/b.test.ts", 'it("XYZ-03", () => {});');
    expect(trace(root, []).covered).toEqual([]);
  });

  it("서브에이전트 worktree(.claude/worktrees/)의 테스트는 세지 않는다", () => {
    write(".claude/worktrees/agent-1/pkg/a.test.ts", 'it("XYZ-01", () => {});');
    write("pkg/.claude/worktrees/b.test.ts", 'it("XYZ-02", () => {});');
    expect(trace(root, []).covered).toEqual(["XYZ-02"]);
  });

  it("describe 이름의 ID도 인정하고, ID 경계를 지킨다 (XYZ-010은 XYZ-01이 아님)", () => {
    write("pkg/a.spec.tsx", 'describe("XYZ-02(확정)", () => {});\nit("XYZ-010", () => {});');
    expect(trace(root, []).covered).toEqual(["XYZ-02"]);
  });

  it("prd.md에 없는 같은 접두어의 ID는 경고 목록에 모은다", () => {
    write("pkg/a.test.ts", 'it("XYZ-01, XYZ-99", () => {});');
    expect(trace(root, []).unknown).toEqual(["XYZ-99"]);
  });
});

describe("요구사항 기준선 증가 검사 (이슈 #17 하네스 2단계)", () => {
  const git = (...args: string[]) =>
    execFileSync(
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
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  const commitAll = (message: string) => {
    git("add", "-A");
    git("commit", "-q", "--allow-empty", "-m", message);
  };
  const growth = (baseline: string[], base = "main", strict = false) =>
    checkBaselineGrowth(root, baseline, { base, head: "HEAD", strict });

  beforeEach(() => {
    git("init", "-q");
    write(BASELINE_PATH, formatBaseline(["XYZ-02"]));
    commitAll("chore: 시작");
    git("checkout", "-q", "-b", "work");
  });

  it("기준선이 그대로거나 줄면 통과한다", () => {
    expect(growth(["XYZ-02"]).status).toBe("pass");
    expect(growth([]).status).toBe("pass");
  });

  it("이미 정의돼 있던 ID가 기준선에 새로 들어가면 실패한다(테스트가 빠짐)", () => {
    const result = growth(["XYZ-01", "XYZ-02"]);
    expect(result.status).toBe("fail");
    expect(result.grown).toEqual(["XYZ-01"]);
    expect(result.lines.join("\n")).toContain("대신 할 일:");
  });

  it("이 브랜치에서 prd.md에 새로 생긴 ID는 기준선에 들어가도 통과하고 알린다", () => {
    write("docs/prd.md", `${PRD}\n- \`XYZ-05\` 새 요구사항`);
    commitAll("docs: 새 요구사항");
    const result = growth(["XYZ-02", "XYZ-05"]);
    expect(result.status).toBe("pass");
    expect(result.newIds).toEqual(["XYZ-05"]);
  });

  it("기준 브랜치가 없으면 경고만 하고, --strict면 실패한다", () => {
    expect(growth(["XYZ-01"], "origin/nope").status).toBe("skip");
    expect(growth(["XYZ-01"], "origin/nope", true).status).toBe("fail");
  });
});
