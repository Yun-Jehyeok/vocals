// 요구사항 추적 센서 (이슈 #17)
//
// docs/prd.md의 요구사항 ID(`- \`AUTH-01\` …` 형식으로 정의된 것)마다
// 그 ID가 이름(describe/it/test의 첫 인자 문자열)에 들어간 테스트가 하나 이상 있는지 본다.
// 아직 테스트가 없는 ID는 기준선 파일에 둔다. 기준선은 줄어들기만 한다(래칫).
//   - 기준선에 없는 ID에 테스트가 없으면 실패
//   - 기준선에 있는 ID에 테스트가 생겼으면(또는 문서에서 사라졌으면) 실패 → --update로 기준선을 줄인다
//   - 기준선이 기준 브랜치(merge-base)보다 늘었으면 실패(2단계). 단 그 브랜치에서 prd.md에 새로 생긴 ID는 허용
//
// 사용: node scripts/check-req-trace.ts [--update] [--base origin/main] [--head HEAD] [--strict]
//   --strict: 기준 브랜치를 찾지 못하면 실패한다(CI). 없으면 증가 검사만 건너뛰고 경고한다.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { BaseArgs } from "./git-base.ts";
import { findMergeBase, missingBase, parseBaseArgs, tryGit } from "./git-base.ts";

export const PRD_PATH = "docs/prd.md";
export const BASELINE_PATH = "scripts/req-trace-baseline.txt";

/** prd.md의 요구사항 정의 줄: 목록 항목이 백틱 ID로 시작한다. 예: "- `AUTH-01` 카카오, …" */
const ID_DEFINITION = /^\s*[-*]\s+`([A-Z]{2,5}-\d{2,3})`/gm;
/** 테스트 이름 안의 ID 후보 */
const ID_IN_TEXT = /(?<![A-Z0-9])([A-Z]{2,5}-\d{2,3})(?!\d)/g;

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "coverage",
  ".expo",
  ".next",
  ".pglite",
]);
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

/** 정의된 요구사항 ID를 문서 순서대로, 중복 없이 */
export function parseRequirementIds(markdown: string): string[] {
  const ids = new Set<string>();
  for (const match of markdown.matchAll(ID_DEFINITION)) ids.add(match[1] as string);
  return [...ids];
}

/** 문자열은 그대로 두고 주석만 공백으로 바꾼다. 주석 안의 it("…")를 세지 않기 위해 */
export function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i] as string;
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
    } else if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      const end = skipString(source, i);
      out += source.slice(i, end);
      i = end;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

/** source[start]의 따옴표로 시작하는 문자열 끝 다음 위치 */
function skipString(source: string, start: number): number {
  const quote = source[start];
  let i = start + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") i += 2;
    else if (ch === quote) return i + 1;
    else if (quote === "`" && ch === "$" && source[i + 1] === "{") i = skipBalanced(source, i + 1);
    else i++;
  }
  return i;
}

/** source[start]의 여는 괄호와 짝이 맞는 닫는 괄호 다음 위치 */
function skipBalanced(source: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < source.length) {
    const ch = source[i] as string;
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(source, i);
      continue;
    }
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return i;
}

function skipSpace(source: string, i: number): number {
  while (i < source.length && /\s/.test(source[i] as string)) i++;
  return i;
}

export interface TestName {
  name: string;
  /** skip·todo는 테스트가 있는 것으로 치지 않는다 */
  skipped: boolean;
}

/** describe/it/test(와 .each·.skip 등)의 첫 인자 문자열을 뽑는다. */
export function extractTestNames(source: string): TestName[] {
  const code = stripComments(source);
  const names: TestName[] = [];
  for (const match of code.matchAll(/(?<![\w.$])(describe|it|test)\b/g)) {
    let i = (match.index ?? 0) + match[0].length;
    let skipped = false;
    for (;;) {
      i = skipSpace(code, i);
      if (code[i] !== ".") break;
      const modifier = /^\.\s*(\w+)/.exec(code.slice(i));
      if (!modifier) break;
      const name = modifier[1] as string;
      if (name === "skip" || name === "todo" || name === "skipIf") skipped = true;
      i = skipSpace(code, i + modifier[0].length);
      // .each([...])(…), .for([...])(…), .skipIf(cond)(…), .each`table`(…)
      if (["each", "for", "skipIf", "runIf"].includes(name)) {
        if (code[i] === "(") i = skipBalanced(code, i);
        else if (code[i] === "`") i = skipString(code, i);
      }
    }
    if (code[i] !== "(") continue;
    i = skipSpace(code, i + 1);
    const quote = code[i];
    if (quote !== '"' && quote !== "'" && quote !== "`") continue;
    const end = skipString(code, i);
    names.push({ name: code.slice(i + 1, end - 1), skipped });
  }
  return names;
}

export function idsInText(text: string): string[] {
  return [...text.matchAll(ID_IN_TEXT)].map((match) => match[1] as string);
}

export function findTestFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name));
      } else if (TEST_FILE.test(entry.name)) {
        files.push(join(dir, entry.name));
      }
    }
  };
  walk(root);
  return files.sort();
}

export function parseBaseline(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

export function formatBaseline(ids: string[]): string {
  return [
    "# 요구사항 추적 기준선 — 아직 이름에 이 ID가 들어간 테스트가 없는 요구사항 (이슈 #17)",
    "# 줄어들기만 한다. 테스트를 추가했으면 `pnpm check:req-trace --update`로 지운다.",
    ...ids,
    "",
  ].join("\n");
}

export interface TraceResult {
  ok: boolean;
  defined: string[];
  covered: string[];
  missing: string[];
  /** 기준선에 없는데 테스트가 없음 */
  newlyMissing: string[];
  /** 기준선에 있는데 테스트가 생겼거나 문서에서 사라짐 */
  stale: string[];
  /** 테스트 이름에 있지만 prd.md에 정의되지 않은 ID (경고) */
  unknown: string[];
}

export function trace(root: string, baseline: string[]): TraceResult {
  const defined = parseRequirementIds(readFileSync(join(root, PRD_PATH), "utf8"));
  const definedSet = new Set(defined);
  const prefixes = new Set(defined.map((id) => id.split("-")[0]));
  const found = new Set<string>();
  for (const file of findTestFiles(root)) {
    for (const test of extractTestNames(readFileSync(file, "utf8"))) {
      if (!test.skipped) for (const id of idsInText(test.name)) found.add(id);
    }
  }
  // 접두어는 문서에 나온 순서, 같은 접두어 안에서는 번호 순서
  const prefixOrder = [...prefixes];
  const byPrefixThenNumber = (a: string, b: string) => {
    const [pa = "", na = ""] = a.split("-");
    const [pb = "", nb = ""] = b.split("-");
    return prefixOrder.indexOf(pa) - prefixOrder.indexOf(pb) || Number(na) - Number(nb);
  };
  const covered = defined.filter((id) => found.has(id)).sort(byPrefixThenNumber);
  const missing = defined.filter((id) => !found.has(id)).sort(byPrefixThenNumber);
  const baselineSet = new Set(baseline);
  const newlyMissing = missing.filter((id) => !baselineSet.has(id));
  const stale = baseline.filter((id) => !definedSet.has(id) || found.has(id));
  const unknown = [...found]
    .filter((id) => !definedSet.has(id) && prefixes.has(id.split("-")[0]))
    .sort();
  return {
    ok: newlyMissing.length === 0 && stale.length === 0,
    defined,
    covered,
    missing,
    newlyMissing,
    stale,
    unknown,
  };
}

function groupByPrefix(ids: string[]): string[] {
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const [prefix = "", number = ""] = id.split("-");
    groups.set(prefix, [...(groups.get(prefix) ?? []), number]);
  }
  return [...groups].map(([prefix, numbers]) => `  ${prefix}: ${numbers.join(" ")}`);
}

export function report(result: TraceResult): string[] {
  const lines = [
    `check:req-trace: 요구사항 ${result.defined.length}개 중 테스트 있음 ${result.covered.length}개, 빠짐 ${result.missing.length}개`,
  ];
  if (result.missing.length > 0) lines.push("빠진 ID:", ...groupByPrefix(result.missing));
  if (result.unknown.length > 0) {
    lines.push(`경고: prd.md에 없는 ID가 테스트 이름에 있음: ${result.unknown.join(" ")}`);
  }
  if (result.newlyMissing.length > 0) {
    lines.push(
      `실패: 기준선에 없는데 테스트가 없는 ID: ${result.newlyMissing.join(" ")}`,
      "  왜: 요구사항마다 이름에 ID가 들어간 테스트가 있어야 합니다. 기준선은 줄어들기만 합니다.",
      '  대신 할 일: 테스트 이름에 ID를 넣으세요(예: it("… — PAY-03")). 문서에 새로 생긴 ID라 아직 테스트가 없으면',
      "  `pnpm check:req-trace --update`로 기준선에 넣고 PR 설명에 적으세요.",
    );
  }
  if (result.stale.length > 0) {
    lines.push(
      `실패: 테스트가 생겼거나 문서에서 사라졌는데 기준선에 남은 ID: ${result.stale.join(" ")}`,
      "  대신 할 일: `pnpm check:req-trace --update`로 기준선에서 지우고 같이 커밋하세요.",
    );
  }
  return lines;
}

export interface GrowthResult {
  status: "pass" | "fail" | "skip";
  lines: string[];
  /** merge-base에서 이미 정의돼 있었는데 기준선에 새로 들어간 ID (테스트가 빠졌다는 뜻) */
  grown: string[];
  /** 이 브랜치에서 prd.md에 새로 생겨 기준선에 들어간 ID (허용) */
  newIds: string[];
}

/** 기준선 래칫의 반대쪽: 기준선은 기준 브랜치보다 늘어나면 안 된다(이슈 #17 1단계 후속). */
export function checkBaselineGrowth(
  cwd: string,
  baseline: string[],
  options: BaseArgs,
): GrowthResult {
  const found = findMergeBase(cwd, options.base, options.head);
  if (!found.ok) {
    return {
      ...missingBase("check:req-trace 기준선 증가 검사", found.reason, options.strict),
      grown: [],
      newIds: [],
    };
  }
  const baseBaseline = tryGit(cwd, ["show", `${found.mergeBase}:${BASELINE_PATH}`]);
  if (baseBaseline === null) {
    return {
      status: "pass",
      lines: ["기준선 증가 검사: 기준 브랜치에 기준선 파일이 없어 건너뜀"],
      grown: [],
      newIds: [],
    };
  }
  const before = new Set(parseBaseline(baseBaseline));
  const definedBefore = new Set(
    parseRequirementIds(tryGit(cwd, ["show", `${found.mergeBase}:${PRD_PATH}`]) ?? ""),
  );
  const added = baseline.filter((id) => !before.has(id));
  const grown = added.filter((id) => definedBefore.has(id));
  const newIds = added.filter((id) => !definedBefore.has(id));
  const lines: string[] = [];
  if (newIds.length > 0) {
    lines.push(
      `참고: prd.md에 새로 생겨 기준선에 들어간 ID: ${newIds.join(" ")} — PR 설명에 적으세요.`,
    );
  }
  if (grown.length > 0) {
    lines.push(
      `실패: 기준선이 ${options.base}보다 늘었습니다: ${grown.join(" ")}`,
      "  왜: 이미 있던 요구사항을 기준선에 다시 넣으면 그 요구사항의 테스트가 빠진 것입니다. 기준선은 줄어들기만 합니다.",
      "  대신 할 일: 지우거나 이름을 바꾼 테스트를 되살려 이름에 ID를 넣고, `pnpm check:req-trace --update`로 기준선을 다시 줄이세요.",
    );
  }
  return { status: grown.length > 0 ? "fail" : "pass", lines, grown, newIds };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const baselinePath = join(root, BASELINE_PATH);
  const { rest, ...baseArgs } = parseBaseArgs(process.argv.slice(2));
  const update = rest.includes("--update");
  const unknownArgs = rest.filter((arg) => arg !== "--update");
  if (unknownArgs.length > 0) throw new Error(`알 수 없는 인자: ${unknownArgs.join(" ")}`);
  let baseline: string[] = [];
  try {
    baseline = parseBaseline(readFileSync(baselinePath, "utf8"));
  } catch {
    if (!update) console.error(`기준선 파일이 없습니다: ${BASELINE_PATH}`);
  }
  const result = trace(root, baseline);
  if (update) {
    writeFileSync(baselinePath, formatBaseline(result.missing));
    console.log(
      `check:req-trace: 기준선을 갱신했습니다 (${relative(root, baselinePath)}, ${baseline.length}개 → ${result.missing.length}개)`,
    );
    if (result.newlyMissing.length > 0) {
      console.log(
        `  새로 들어간 ID: ${result.newlyMissing.join(" ")} — PR 설명에 이유를 적으세요.`,
      );
    }
    process.exit(0);
  }
  const lines = report(result);
  const growth = checkBaselineGrowth(root, baseline, baseArgs);
  const ok = result.ok && growth.status !== "fail";
  (ok ? console.log : console.error)([...lines, ...growth.lines].join("\n"));
  process.exit(ok ? 0 : 1);
}
