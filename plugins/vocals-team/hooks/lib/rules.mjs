// 경로 규칙: 모든 세션에 적용하는 전역 규칙과, 훅 입력의 agent_type으로 고르는 역할별 규칙. 이슈 #17 하네스 2단계.
//
// 전역(메인 세션 포함): .env 수정 금지, 기존 마이그레이션(main에 이미 있는 supabase/migrations/*) 수정·삭제 금지.
// 역할별(서브에이전트에서만, 메인 세션=팀장은 역할 차단 없음):
//   developer  docs/, 인수 테스트·판정 헬퍼(scripts/acceptance-guard.ts의 PROTECTED_PATHS) 수정 금지
//   qa         테스트 파일과 요구사항 추적 기준선 밖 수정 금지
//   planner    docs/와 팀 규칙 문서(CLAUDE.md, .claude/rules/, 플러그인 md) 밖 수정 금지
//   designer   코드 경로(apps/, packages/, supabase/, scripts/) 수정 금지
// 규칙은 vocals 레포(루트에 plugins/vocals-team이 있는 git 저장소, worktree 포함) 안의 경로에만 적용한다.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";

export const ROLES = /** @type {const} */ (["developer", "qa", "planner", "designer"]);

/**
 * 훅 입력의 agent_type에서 역할을 고른다. 플러그인 에이전트는 "vocals-team:developer"처럼 접두어가 붙을 수 있다.
 * 메인 세션(agent_type 없음)과 다른 에이전트(general-purpose 등)는 null.
 * @param {unknown} agentType
 * @returns {"developer" | "qa" | "planner" | "designer" | null}
 */
export function roleOf(agentType) {
  const match = /(?:^|:)(developer|qa|planner|designer)$/.exec(String(agentType ?? ""));
  return /** @type {any} */ (match?.[1] ?? null);
}

/** scripts/acceptance-guard.ts를 못 읽을 때 쓰는 사본. 단위 테스트가 원본과 같은지 확인한다. */
export const FALLBACK_PROTECTED_PATHS = [
  "supabase/tests/acceptance/",
  "tests/acceptance/",
  "supabase/tests/helpers/db.ts",
  "supabase/tests/helpers/rls-matrix.ts",
  "supabase/tests/rls-matrix.test.ts",
];

export const MIGRATIONS_DIR = "supabase/migrations/";
const PLUGIN_MARKER = join("plugins", "vocals-team", ".claude-plugin", "plugin.json");
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

/** @typedef {{ summary: string, why: string, instead: string }} Violation */
/** @typedef {"write" | "tree"} Kind */

const MESSAGES = {
  env: {
    summary: ".env 파일은 수정하지 않습니다.",
    why: ".env에는 비밀 값이 들어 있고 사람이 직접 관리합니다(CLAUDE.md 보안).",
    instead: "필요한 키 이름만 `.env.example`에 적고, 값이 필요하다고 [보고]로 사람에게 알리세요.",
  },
  migration: {
    summary: "기존 마이그레이션 파일은 고치거나 지우지 않습니다.",
    why: "main에 들어간 마이그레이션은 이미 어딘가에 적용됐을 수 있어, 고치면 DB마다 스키마가 달라집니다.",
    instead: "바꿀 내용은 `supabase/migrations/<타임스탬프>_<이름>.sql` 새 파일로 만드세요.",
  },
  developerDocs: {
    summary: "docs/는 기획 담당입니다.",
    why: "문서가 기준이고, 개발이 문서를 고치면 기준을 스스로 바꾸는 셈입니다.",
    instead: "변경이 필요하면 `[질문] 받는 역할: 기획`으로 보고하세요.",
  },
  developerAcceptance: {
    summary: "인수 테스트와 판정 헬퍼는 QA 담당입니다.",
    why: "개발이 바꾸면 완료 기준을 스스로 바꾸는 셈입니다(CI의 acceptance-guard도 실패합니다).",
    instead:
      "테스트가 틀렸거나 문서와 다르다고 보면 고치지 말고 `[질문] 받는 역할: QA`로 보고하세요.",
  },
  qa: {
    summary: "QA는 테스트 파일과 요구사항 추적 기준선만 바꿉니다.",
    why: "기능 코드는 개발 담당입니다. QA가 고치면 판정이 독립적이지 않게 됩니다.",
    instead:
      "테스트(`*.test.ts`, `supabase/tests/`, `tests/`)로 재현하고 `[질문] 받는 역할: 개발`로 보고하세요. 문서 문제는 `[질문] 받는 역할: 기획`.",
  },
  planner: {
    summary: "기획은 docs/와 팀 규칙 문서(CLAUDE.md, .claude/rules/, 플러그인 md)만 바꿉니다.",
    why: "코드와 설정은 개발 담당입니다.",
    instead:
      "필요한 변경을 이슈의 완료 조건·데이터 변경에 적고, [보고]에서 개발에 맡길 일로 넘기세요.",
  },
  designer: {
    summary: "코드(apps/, packages/, supabase/, scripts/)는 개발 담당입니다.",
    why: "디자인은 Figma와 디자인 문서로 전달하고, 코드는 개발이 그것을 보고 구현합니다.",
    instead:
      "화면은 Figma와 `docs/design.md`에 반영하고, 코드 반영이 필요하면 [보고]에서 개발에 맡길 일로 넘기세요.",
  },
};

function tryGit(cwd, args) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

/** 경로가 속한 git 저장소 루트(.git 파일·디렉터리가 있는 가장 가까운 조상). 없으면 null */
export function findRepoRoot(path) {
  let dir = path;
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** 저장소마다 한 번만 계산하는 정보 */
class RepoInfo {
  constructor(root) {
    this.root = root;
    this.isVocals = existsSync(join(root, PLUGIN_MARKER));
    /** @type {string[] | null} */
    this._protected = null;
    /** @type {string[] | null} */
    this._migrations = null;
  }

  /** 인수 테스트 보호 경로. scripts/acceptance-guard.ts의 PROTECTED_PATHS를 읽어 같은 목록을 쓴다. */
  get protectedPaths() {
    if (this._protected) return this._protected;
    let paths = null;
    try {
      const source = readFileSync(join(this.root, "scripts", "acceptance-guard.ts"), "utf8");
      const body = /PROTECTED_PATHS\s*=\s*\[([\s\S]*?)\]/.exec(source)?.[1];
      if (body) {
        const found = [...body.matchAll(/["'`]([^"'`]+)["'`]/g)].map((m) => m[1] ?? "");
        if (found.length > 0) paths = found;
      }
    } catch {
      // 파일이 없으면 사본을 쓴다
    }
    this._protected = paths ?? FALLBACK_PROTECTED_PATHS;
    return this._protected;
  }

  /** main에 이미 있는 마이그레이션 파일. origin/main과 merge-base 기준, origin/main이 없으면 HEAD 기준 */
  get baseMigrations() {
    if (this._migrations) return this._migrations;
    const refs = [];
    if (tryGit(this.root, ["rev-parse", "--verify", "--quiet", "origin/main^{commit}"]) !== null) {
      refs.push("origin/main");
      const mergeBase = tryGit(this.root, ["merge-base", "HEAD", "origin/main"])?.trim();
      if (mergeBase) refs.push(mergeBase);
    } else {
      refs.push("HEAD");
    }
    const files = new Set();
    for (const ref of refs) {
      const out = tryGit(this.root, ["ls-tree", "-r", "--name-only", ref, "--", MIGRATIONS_DIR]);
      for (const file of out?.split("\n") ?? []) if (file) files.add(file);
    }
    this._migrations = [...files];
    return this._migrations;
  }
}

/**
 * file(저장소 기준 상대 경로)이 area 안인가. area가 "/"로 끝나면 디렉터리, 아니면 파일 하나.
 * kind가 tree면(rm -r 등) file이 area의 조상이어도 area를 건드리는 것으로 본다.
 */
export function touches(file, area, kind) {
  const inside = area.endsWith("/") ? file.startsWith(area) || `${file}/` === area : file === area;
  const ancestor = kind === "tree" && (file === "" || area.startsWith(`${file}/`));
  return inside || ancestor;
}

const ALLOWED = {
  qa: (file) =>
    TEST_FILE.test(file) ||
    touches(file, "supabase/tests/", "write") ||
    touches(file, "tests/", "write") ||
    file === "scripts/req-trace-baseline.txt",
  planner: (file) =>
    touches(file, "docs/", "write") ||
    file === "CLAUDE.md" ||
    touches(file, ".claude/rules/", "write") ||
    (file.startsWith("plugins/vocals-team/") && file.endsWith(".md")),
};

export class PathRules {
  /** @param {{ role: ReturnType<typeof roleOf> }} options */
  constructor({ role }) {
    this.role = role;
    /** @type {Map<string, RepoInfo>} */
    this.repos = new Map();
  }

  repo(root) {
    let info = this.repos.get(root);
    if (!info) {
      info = new RepoInfo(root);
      this.repos.set(root, info);
    }
    return info;
  }

  /**
   * 절대 경로 하나를 검사한다.
   * @param {string} abs
   * @param {Kind} kind
   * @returns {(Violation & { file: string }) | null}
   */
  check(abs, kind) {
    const name = basename(abs);
    if (/^\.env(\..+)?$/.test(name) && name !== ".env.example")
      return { ...MESSAGES.env, file: abs };

    const root = findRepoRoot(abs);
    if (!root) return null;
    const repo = this.repo(root);
    if (!repo.isVocals) return null;
    const file = relative(root, abs).split(sep).join("/");
    if (file.startsWith("../")) return null;
    const hit = (violation) => ({ ...violation, file: file || "." });

    if (repo.baseMigrations.some((migration) => touches(file, migration, kind))) {
      return hit(MESSAGES.migration);
    }

    switch (this.role) {
      case "developer":
        if (touches(file, "docs/", kind)) return hit(MESSAGES.developerDocs);
        if (repo.protectedPaths.some((area) => touches(file, area, kind))) {
          return hit(MESSAGES.developerAcceptance);
        }
        return null;
      case "designer":
        if (
          ["apps/", "packages/", "supabase/", "scripts/"].some((area) => touches(file, area, kind))
        ) {
          return hit(MESSAGES.designer);
        }
        return null;
      case "qa":
      case "planner":
        return ALLOWED[this.role](file) ? null : hit(MESSAGES[this.role]);
      default:
        return null;
    }
  }
}
