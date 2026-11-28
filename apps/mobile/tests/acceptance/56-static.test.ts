/// <reference types="node" />
// #56 앱 기본 틀 인수 테스트(QA) — 코드·설정을 읽어 판정하는 검사.
// 근거: 이슈 #56 완료 조건 "자동 확인 — 기본 틀·검사", "자동 확인 — 테마", docs/tech-stack.md 3.11·3.12, docs/design.md 2.1~2.5, CLAUDE.md 보안.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const APP_DIR = join(__dirname, "..", "..");
const REPO_DIR = join(APP_DIR, "..", "..");
const SOURCE_DIRS = ["app", "src"];
const SKIP = new Set(["node_modules", ".expo", "tests", "ios", "android"]);

/** 앱 코드 파일(테스트 제외): app/, src/ 아래 .ts/.tsx/.js/.jsx, 그리고 앱 설정 파일 */
function appSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (SKIP.has(name)) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.[cm]?[jt]sx?$/.test(name) && !/\.(test|spec)\./.test(name)) out.push(path);
    }
  };
  for (const d of SOURCE_DIRS) walk(join(APP_DIR, d));
  for (const name of [
    "app.json",
    "app.config.js",
    "app.config.ts",
    "eas.json",
    "babel.config.js",
  ]) {
    const path = join(APP_DIR, name);
    if (existsSync(path)) out.push(path);
  }
  return out;
}

/** 문자열은 남기고 주석만 지운다(주석 속 설명 문구를 세지 않기 위해) */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

const read = (path: string) => readFileSync(path, "utf8");
const rel = (path: string) => relative(REPO_DIR, path);

describe("#56 기본 틀·검사 — NFR-01", () => {
  it("NFR-01 apps/mobile이 pnpm 워크스페이스 패키지이고, 루트 test·typecheck가 앱을 함께 돌린다", () => {
    const workspace = read(join(REPO_DIR, "pnpm-workspace.yaml"));
    expect(workspace).toMatch(/["']?apps\/\*["']?/);
    const appPkg = JSON.parse(read(join(APP_DIR, "package.json")));
    expect(appPkg.name).toBe("@vocals/mobile");
    expect(appPkg.scripts?.test).toMatch(/jest/);
    expect(appPkg.scripts?.typecheck).toMatch(/tsc/);
    const rootPkg = JSON.parse(read(join(REPO_DIR, "package.json")));
    expect(rootPkg.scripts.test).toMatch(/pnpm -r .*test/);
    expect(rootPkg.scripts.typecheck).toMatch(/pnpm -r .*typecheck/);
    expect(rootPkg.scripts.check).toMatch(/pnpm test/);
  });

  it("NFR-01 앱 테스트 실행기가 tests/acceptance의 인수 테스트를 포함한다", () => {
    const config = jest.requireActual(join(APP_DIR, "jest.config.js")) as { testMatch?: string[] };
    const patterns = (config.testMatch ?? []).join(" ");
    expect(patterns).toMatch(/tests/);
    expect(patterns).toMatch(/test\.\{?.*tsx/);
  });

  it("NFR-01 앱 코드가 있다(app/ 라우트와 앱 코드 파일)", () => {
    expect(existsSync(join(APP_DIR, "app", "_layout.tsx"))).toBe(true);
    expect(appSourceFiles().length).toBeGreaterThan(2);
  });
});

describe("#56 비밀 키·범위 — tech-stack 3.11, 이슈 범위", () => {
  it("tech-stack 3.11 앱 코드에 service_role, sb_secret_, SUPABASE_SERVICE 문자열이 없다", () => {
    const hits: string[] = [];
    for (const file of appSourceFiles()) {
      const text = read(file);
      for (const word of ["service_role", "sb_secret_", "SUPABASE_SERVICE"]) {
        if (text.includes(word)) hits.push(`${rel(file)}: ${word}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("tech-stack 3.11 앱 코드에 JWT 모양 키 값이 박혀 있지 않다", () => {
    const hits: string[] = [];
    for (const file of appSourceFiles()) {
      if (/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./.test(read(file))) hits.push(rel(file));
    }
    expect(hits).toEqual([]);
  });

  it("tech-stack 3.12 앱이 읽는 EXPO_PUBLIC_ 환경 변수는 SUPABASE_URL과 SUPABASE_PUBLISHABLE_KEY뿐이다(ANON_KEY 등 다른 키 없음)", () => {
    const names = new Set<string>();
    for (const file of appSourceFiles()) {
      for (const m of stripComments(read(file)).matchAll(/EXPO_PUBLIC_[A-Z0-9_]+/g))
        names.add(m[0]);
    }
    expect([...names].sort()).toEqual([
      "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "EXPO_PUBLIC_SUPABASE_URL",
    ]);
  });

  it("이슈 범위: 앱 코드가 DB 테이블을 읽거나 쓰지 않는다(.from( · .rpc( · .schema( 호출 없음)", () => {
    const BUILTINS = new Set([
      "Array",
      "Buffer",
      "Uint8Array",
      "Uint16Array",
      "Uint32Array",
      "Int8Array",
      "Int16Array",
      "Int32Array",
      "Float32Array",
      "Float64Array",
      "Object",
      "String",
      "Set",
      "Map",
    ]);
    const hits: string[] = [];
    for (const file of appSourceFiles()) {
      const text = stripComments(read(file));
      for (const m of text.matchAll(/([A-Za-z_$][\w$]*|\))\s*\??\.\s*from\s*\(/g)) {
        if (!BUILTINS.has(m[1] as string)) hits.push(`${rel(file)}: ${m[0]}`);
      }
      for (const m of text.matchAll(/\??\.\s*(rpc|schema)\s*\(/g))
        hits.push(`${rel(file)}: ${m[0]}`);
    }
    expect(hits).toEqual([]);
  });

  it("CLAUDE.md 보안: 앱 코드의 console 호출이 세션·토큰·사용자 정보를 넘기지 않는다", () => {
    const hits: string[] = [];
    for (const file of appSourceFiles()) {
      const text = stripComments(read(file));
      for (const m of text.matchAll(/console\s*\.\s*\w+\s*\(([^;]*)/g)) {
        if (/session|token|user|metadata|identit/i.test(m[1] as string)) {
          hits.push(`${rel(file)}: ${m[0].slice(0, 80)}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});

describe("#56 설정 파일 — CLAUDE.md 보안, tech-stack 3.12", () => {
  it("CLAUDE.md 보안: .env.example에 두 키 이름만 있고 값은 비어 있다", () => {
    const candidates = [join(APP_DIR, ".env.example"), join(REPO_DIR, ".env.example")];
    const entries = new Map<string, string>();
    for (const file of candidates) {
      if (!existsSync(file)) continue;
      for (const line of read(file).split("\n")) {
        const m = /^\s*(EXPO_PUBLIC_[A-Z0-9_]+)\s*=(.*)$/.exec(line);
        if (m) entries.set(m[1] as string, (m[2] as string).trim());
      }
    }
    expect([...entries.keys()].sort()).toEqual([
      "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "EXPO_PUBLIC_SUPABASE_URL",
    ]);
    for (const value of entries.values()) expect(value).toBe("");
  });

  it("CLAUDE.md 보안: .env 파일은 커밋되지 않고(.gitignore가 막고) .env.example만 추적된다", () => {
    const tracked = execFileSync("git", ["ls-files"], { cwd: REPO_DIR, encoding: "utf8" })
      .split("\n")
      .filter((f) => /(^|\/)\.env(\.|$)/.test(f));
    expect(tracked.filter((f) => !f.endsWith(".env.example"))).toEqual([]);
    for (const path of ["apps/mobile/.env", "apps/mobile/.env.local", ".env"]) {
      // 무시되면 종료 코드 0
      expect(() =>
        execFileSync("git", ["check-ignore", "-q", path], { cwd: REPO_DIR }),
      ).not.toThrow();
    }
  });

  it("tech-stack 3.12 앱 scheme은 vocals다(결정 5)", () => {
    const appJson = JSON.parse(read(join(APP_DIR, "app.json")));
    expect(appJson.expo?.scheme).toBe("vocals");
  });

  it("screens 1장 역할 값은 packages/shared의 USER_ROLES·UserRole을 가져다 쓴다", () => {
    const users = appSourceFiles().filter((file) => {
      const text = stripComments(read(file));
      return /from\s+["']@vocals\/shared["']/.test(text) && /\b(USER_ROLES|UserRole)\b/.test(text);
    });
    expect(users.map(rel)).not.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 테마 — design 2장 (2.1~2.5). 표 값을 그대로 옮겼다. 표가 바뀌면 아래 "문서와 같은가" 테스트가 알려 준다.
// ---------------------------------------------------------------------------

const COLORS: Record<string, string> = {
  primary: "#5B3FD0",
  "primary-pressed": "#4A31B0",
  "primary-soft": "#EFEBFC",
  "on-primary": "#FFFFFF",
  ink: "#18161D",
  "ink-muted": "#5C5866",
  "ink-disabled": "#A19CA8",
  surface: "#FFFFFF",
  "surface-sunken": "#F6F5F8",
  line: "#E6E3EA",
  "line-control": "#8C8794",
  "success-soft": "#E3F5EB",
  "success-ink": "#1B6B43",
  "warning-soft": "#FFF1DB",
  "warning-ink": "#8A4B00",
  danger: "#C9302C",
  "danger-soft": "#FDECEA",
  "danger-ink": "#A3221F",
  "neutral-soft": "#EEECF1",
  "video-bg": "#1E1B24",
  scrim: "rgba(24,22,29,0.64)",
  skeleton: "#ECEAF0",
  "sheet-scrim": "rgba(24,22,29,0.48)",
  "kakao-bg": "#FEE500",
  "kakao-ink": "#191919",
  "apple-bg": "#000000",
  "google-line": "#747775",
  "google-ink": "#1F1F1F",
};
const TYPOGRAPHY: Record<string, [number, number, number]> = {
  display: [26, 34, 700],
  "title-1": [22, 30, 700],
  "title-2": [18, 26, 700],
  body: [16, 24, 400],
  "body-strong": [16, 24, 700],
  label: [14, 20, 500],
  caption: [13, 18, 400],
  micro: [12, 16, 500],
};
const SPACING: Record<string, number> = {
  "space-1": 4,
  "space-2": 8,
  "space-3": 12,
  "space-4": 16,
  "screen-x": 20,
  "space-6": 24,
  "space-8": 32,
  "space-10": 40,
};
const SIZES: Record<string, number> = {
  "touch-min": 48,
  "button-lg": 52,
  "button-md": 48,
  "app-bar": 56,
  "tab-bar": 64,
  "list-item-min": 64,
  "avatar-sm": 40,
  "avatar-lg": 80,
  icon: 24,
  "play-button": 56,
};
const RADII: Record<string, number> = {
  "radius-sm": 6,
  "radius-md": 10,
  "radius-lg": 16,
  "radius-full": 999,
};

const camel = (token: string) => token.replace(/-([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
const normColor = (v: unknown) => String(v).replace(/\s+/g, "").toUpperCase();

/** design.md의 표(### 제목 아래 첫 표)를 토큰 → 칸 목록으로 */
function designTable(heading: string): Map<string, string[]> {
  const doc = read(join(REPO_DIR, "docs", "design.md"));
  const start = doc.indexOf(heading);
  expect(start).toBeGreaterThan(-1);
  const rest = doc.slice(start + heading.length);
  const end = rest.search(/\n#{2,3} /);
  const section = end === -1 ? rest : rest.slice(0, end);
  const rows = new Map<string, string[]>();
  for (const line of section.split("\n")) {
    const m = /^\|\s*`([^`]+)`\s*\|(.*)\|\s*$/.exec(line);
    if (m)
      rows.set(
        m[1] as string,
        (m[2] as string).split("|").map((c) => c.trim().replace(/`/g, "")),
      );
  }
  return rows;
}

/** 테마 모듈: src/ 아래 경로에 theme이 들어간 파일(예: src/theme.ts, src/theme/index.ts) */
function themeModules(): Record<string, unknown>[] {
  const files = appSourceFiles().filter(
    (f) => /[/\\]src[/\\]/.test(f) && /theme/i.test(relative(join(APP_DIR, "src"), f)),
  );
  return files.map((f) => jest.requireActual<Record<string, unknown>>(f));
}

/** 내보낸 값 전체를 "경로 → 값"으로 펼친다 */
function flatten(
  value: unknown,
  path: string[] = [],
  out = new Map<string, unknown>(),
  seen = new Set<unknown>(),
) {
  if (value && typeof value === "object") {
    if (seen.has(value)) return out;
    seen.add(value);
    for (const [k, v] of Object.entries(value)) flatten(v, [...path, k], out, seen);
  } else {
    out.set(path.join("."), value);
  }
  return out;
}

function themeValues(): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const mod of themeModules()) for (const [k, v] of flatten(mod)) out.set(k, v);
  return out;
}

/** 경로 끝이 name인 값들 */
function valuesNamed(values: Map<string, unknown>, ...suffix: string[]): unknown[] {
  const want = suffix.join(".");
  return [...values].filter(([k]) => k === want || k.endsWith(`.${want}`)).map(([, v]) => v);
}

describe("#56 테마 상수 — design 2장", () => {
  it("design 2장 인수 테스트에 옮긴 토큰 표가 docs/design.md 2.1~2.5 표와 같다(표가 바뀌면 QA가 고친다)", () => {
    const colors = designTable("### 2.1 색");
    expect([...colors.keys()]).toEqual(Object.keys(COLORS));
    for (const [k, cells] of colors) expect(normColor(cells[0])).toBe(normColor(COLORS[k]));

    const typo = designTable("### 2.2 글자");
    expect([...typo.keys()]).toEqual(Object.keys(TYPOGRAPHY));
    for (const [k, cells] of typo) {
      expect(cells.slice(0, 3).map(Number)).toEqual(TYPOGRAPHY[k]);
    }
    for (const [heading, table] of [
      ["### 2.3 간격", SPACING],
      ["### 2.4 크기", SIZES],
      ["### 2.5 모서리", RADII],
    ] as const) {
      const rows = designTable(heading);
      expect([...rows.keys()]).toEqual(Object.keys(table));
      for (const [k, cells] of rows) expect(Number(cells[0])).toBe(table[k]);
    }
  });

  it("design 2장 src/ 아래 테마 모듈이 있다", () => {
    expect(themeModules().length).toBeGreaterThan(0);
  });

  it.each(Object.entries(COLORS))("design 2.1 색 %s = %s (이름은 camelCase)", (token, hex) => {
    const found = valuesNamed(themeValues(), camel(token));
    expect(found.map(normColor)).toContain(normColor(hex));
  });

  it.each(Object.entries(TYPOGRAPHY))(
    "design 2.2 글자 %s = fontSize·lineHeight·fontWeight %j",
    (token, [fontSize, lineHeight, fontWeight]) => {
      const values = themeValues();
      const name = camel(token);
      expect(valuesNamed(values, name, "fontSize").map(Number)).toContain(fontSize);
      expect(valuesNamed(values, name, "lineHeight").map(Number)).toContain(lineHeight);
      expect(valuesNamed(values, name, "fontWeight").map(String)).toContain(String(fontWeight));
    },
  );

  it.each([
    ...Object.entries(SPACING).map(([k, v]) => ["2.3 간격", k, v] as const),
    ...Object.entries(SIZES).map(([k, v]) => ["2.4 크기", k, v] as const),
    ...Object.entries(RADII).map(([k, v]) => ["2.5 모서리", k, v] as const),
  ])("design %s %s = %d", (_group, token, value) => {
    expect(valuesNamed(themeValues(), camel(token)).map(Number)).toContain(value);
  });
});
