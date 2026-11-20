// Bash 명령에서 "파일을 쓰거나 지우는 대상"과 git commit 호출을 뽑는다. 이슈 #17 하네스 2단계.
//
// 완벽한 셸 해석기가 아니다. 에이전트가 흔히 쓰는 경로만 본다:
//   리다이렉트(>, >>, &>), tee, sed -i, perl -i, awk -i inplace, ex/vi/ed, cp/mv/install/ln/rsync,
//   rm/rmdir/unlink/shred, touch, truncate, dd of=, tar -x, unzip, patch·git apply(패치 파일을 읽음),
//   git mv/rm/checkout <커밋>/restore --source, find -delete/-exec, bash -c/eval 안의 명령,
//   node -e·python -c 같은 한 줄 코드 안의 파일 쓰기 API와 경로 문자열, {a,b}와 glob.
// 무엇을 쓰는지 풀 수 없는 것(스크립트 실행, xargs, pnpm/npx, 변수 경로, 동적 cd)은 opaque로 모은다.
// guard-bash는 개발 역할에서 opaque와 보호 경로 문자열이 함께 나오면 보수적으로 막는다. 최종 보증은 CI다.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

/**
 * @typedef {{ words: string[], redirects: { op: string, target: string }[], heredocs: string[] }} Segment
 * @typedef {{ path: string, kind: "write" | "tree", via: string }} Target
 *   kind: write = 그 경로 하나를 쓴다, tree = 그 경로와 아래 전체를 바꾸거나 지운다
 * @typedef {{ cwd: string, sub: string, args: string[], heredocs: string[], raw: string, config: string[], env: string[] }} CommitCall
 * @typedef {{ cwd: string, args: string[] }} PushCall
 */

const newSegment = () => /** @type {Segment} */ ({ words: [], redirects: [], heredocs: [] });

/** src[start]가 "("일 때 짝이 맞는 ")" 다음 위치. 따옴표와 heredoc 본문은 건너뛴다. */
function skipBalanced(src, start) {
  let depth = 0;
  let i = start;
  /** @type {{ delim: string, strip: boolean }[]} */
  const heredocs = [];
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "'") {
      const end = src.indexOf("'", i + 1);
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    if (c === '"') {
      i = skipDouble(src, i + 1);
      continue;
    }
    if (c === "<" && src[i + 1] === "<" && src[i + 2] !== "<") {
      const m = /^<<(-?)\s*(['"]?)([\w.-]+)\2/.exec(src.slice(i));
      if (m) {
        heredocs.push({ delim: m[3] ?? "", strip: m[1] === "-" });
        i += m[0].length;
        continue;
      }
    }
    if (c === "\n" && heredocs.length > 0) {
      i = skipHeredocBodies(src, i + 1, heredocs.splice(0)).end;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return i;
}

/** 큰따옴표 안(src[start]부터)을 건너뛰고 닫는 따옴표 다음 위치를 돌려준다. */
function skipDouble(src, start) {
  let i = start;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") i += 2;
    else if (c === '"') return i + 1;
    else if (c === "$" && src[i + 1] === "(") i = skipBalanced(src, i + 1);
    else i++;
  }
  return i;
}

/** start부터 heredoc 본문들을 차례로 읽는다. */
function skipHeredocBodies(src, start, heredocs) {
  let i = start;
  const bodies = [];
  for (const heredoc of heredocs) {
    const lines = [];
    while (i < src.length) {
      const nl = src.indexOf("\n", i);
      const line = src.slice(i, nl === -1 ? src.length : nl);
      i = nl === -1 ? src.length : nl + 1;
      if ((heredoc.strip ? line.replace(/^\t+/, "") : line) === heredoc.delim) break;
      lines.push(line);
    }
    bodies.push(lines.join("\n"));
  }
  return { end: i, bodies };
}

/**
 * 명령 문자열을 단순 명령(세그먼트) 목록으로 나눈다.
 * 따옴표를 벗긴 단어, 리다이렉트 대상, heredoc 본문을 담는다. $(…)와 `…`는 원문 그대로 단어에 남긴다.
 * @param {string} src
 * @returns {Segment[]}
 */
export function parseShell(src) {
  /** @type {Segment[]} */
  const segments = [];
  let seg = newSegment();
  let word = "";
  let inWord = false;
  /** @type {string | null} */
  let pendingRedirect = null;
  /** @type {{ delim: string, strip: boolean, seg: Segment }[]} */
  const pendingHeredocs = [];

  const endWord = () => {
    if (!inWord) return;
    if (pendingRedirect === "<<" || pendingRedirect === "<<-") {
      pendingHeredocs.push({ delim: word, strip: pendingRedirect === "<<-", seg });
    } else if (pendingRedirect) {
      seg.redirects.push({ op: pendingRedirect, target: word });
    } else {
      seg.words.push(word);
    }
    pendingRedirect = null;
    word = "";
    inWord = false;
  };
  const endSegment = () => {
    endWord();
    if (seg.words.length || seg.redirects.length) segments.push(seg);
    seg = newSegment();
  };

  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "\\") {
      if (next !== "\n") {
        word += next ?? "";
        inWord = true;
      }
      i += 2;
    } else if (c === "'") {
      const end = src.indexOf("'", i + 1);
      const stop = end === -1 ? src.length : end;
      word += src.slice(i + 1, stop);
      inWord = true;
      i = stop + 1;
    } else if (c === '"') {
      i++;
      inWord = true;
      while (i < src.length && src[i] !== '"') {
        const d = src[i];
        if (d === "\\" && '$`"\\\n'.includes(src[i + 1] ?? "")) {
          if (src[i + 1] !== "\n") word += src[i + 1];
          i += 2;
        } else if (d === "$" && src[i + 1] === "(") {
          const end = skipBalanced(src, i + 1);
          word += src.slice(i, end);
          i = end;
        } else {
          word += d;
          i++;
        }
      }
      i++;
    } else if (c === "$" && next === "(") {
      const end = skipBalanced(src, i + 1);
      word += src.slice(i, end);
      inWord = true;
      i = end;
    } else if (c === "`") {
      const end = src.indexOf("`", i + 1);
      const stop = end === -1 ? src.length : end + 1;
      word += src.slice(i, stop);
      inWord = true;
      i = stop;
    } else if (c === "#" && !inWord) {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === " " || c === "\t") {
      endWord();
      i++;
    } else if (c === "\n") {
      endSegment();
      const heredocs = pendingHeredocs.splice(0);
      if (heredocs.length > 0) {
        const { end, bodies } = skipHeredocBodies(src, i + 1, heredocs);
        heredocs.forEach((heredoc, index) => heredoc.seg.heredocs.push(bodies[index] ?? ""));
        i = end;
      } else {
        i++;
      }
    } else if (c === ">" || c === "<" || (c === "&" && next === ">")) {
      if (inWord && /^\d+$/.test(word) && !pendingRedirect) {
        // 2>file 같은 파일 설명자 번호
        word = "";
        inWord = false;
      } else {
        endWord();
      }
      const op = /^(&>>|&>|>>|>\||>&|<<<|<<-|<<|<&|<>|>|<)/.exec(src.slice(i))?.[0] ?? c;
      i += op.length;
      if ((op === ">" || op === "<") && src[i] === "(") {
        // 프로세스 치환 >(…) <(…)
        i = skipBalanced(src, i);
        continue;
      }
      pendingRedirect = op;
    } else if (c === ";" || c === "&" || c === "|" || c === "(" || c === ")") {
      endSegment();
      i += (c === "&" && next === "&") || (c === "|" && (next === "|" || next === "&")) ? 2 : 1;
    } else {
      word += c;
      inWord = true;
      i++;
    }
  }
  endSegment();
  const heredocs = pendingHeredocs.splice(0);
  for (const heredoc of heredocs) heredoc.seg.heredocs.push("");
  return segments;
}

const WRAPPERS = new Set(["sudo", "command", "builtin", "nohup", "time", "exec", "nice", "stdbuf"]);
const KEYWORDS = new Set([
  "if",
  "then",
  "else",
  "elif",
  "do",
  "while",
  "until",
  "!",
  "{",
  "}",
  "fi",
  "done",
]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** 앞의 변수 대입, sudo·env 같은 감싸는 명령, 제어 키워드를 벗긴다. */
function stripPrefix(words) {
  let i = 0;
  while (i < words.length) {
    const w = words[i] ?? "";
    if (KEYWORDS.has(w) || WRAPPERS.has(w) || ASSIGNMENT.test(w)) i++;
    else if (w === "env") {
      i++;
      while (i < words.length && (/^-/.test(words[i] ?? "") || ASSIGNMENT.test(words[i] ?? "")))
        i++;
    } else break;
  }
  return words.slice(i);
}

/**
 * 플래그가 아닌 인자. valueFlags에 있는 플래그 바로 뒤 값은 뺀다. "--" 뒤는 모두 인자다.
 * @param {string[]} args
 * @param {string[]} [valueFlags]
 */
function positional(args, valueFlags = []) {
  const out = [];
  let rest = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (rest) out.push(a);
    else if (a === "--") rest = true;
    else if (valueFlags.includes(a)) i++;
    else if (!a.startsWith("-") || a === "-") out.push(a);
  }
  return out;
}

/** 경로로 볼 수 없는 값(빈 값, 장치 파일) */
function ignorable(p) {
  return !p || p.startsWith("/dev/") || p.startsWith("/proc/");
}

/** 변수·명령 치환이 들어 있어 훅이 풀 수 없는 경로 */
function dynamic(p) {
  return p.includes("$") || p.includes("`");
}

/** {a,b} 중괄호 확장(한 단계씩, 최대 64개) */
function expandBraces(p) {
  const out = [];
  const queue = [p];
  while (queue.length > 0 && out.length < 64) {
    const item = queue.shift() ?? "";
    const m = /\{([^{}]*,[^{}]*)\}/.exec(item);
    if (!m) out.push(item);
    else {
      for (const part of (m[1] ?? "").split(",")) {
        queue.push(item.slice(0, m.index) + part + item.slice(m.index + m[0].length));
      }
    }
  }
  return out;
}

/** ~와 상대 경로를 풀고, {a,b}와 간단한 glob(*, ?, [..])은 펼친다. glob이 아무것도 못 찾으면 그대로 둔다. */
function expandPath(cwd, p) {
  return expandBraces(p).flatMap((one) => expandGlob(cwd, one));
}

function expandGlob(cwd, p) {
  const withHome = p === "~" ? homedir() : p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;
  const abs = isAbsolute(withHome) ? resolve(withHome) : resolve(cwd, withHome);
  if (!/[*?[]/.test(abs)) return [abs];
  const parts = abs.split(sep).filter(Boolean);
  let current = [sep];
  for (const part of parts) {
    if (!/[*?[]/.test(part)) {
      current = current.map((dir) => join(dir, part));
      continue;
    }
    const pattern = new RegExp(
      `^${part
        .replace(/[.+^${}()|\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".")}$`,
    );
    const nextLevel = [];
    for (const dir of current) {
      try {
        for (const name of readdirSync(dir)) {
          if (pattern.test(name) && (part.startsWith(".") || !name.startsWith("."))) {
            nextLevel.push(join(dir, name));
          }
        }
      } catch {
        // 디렉터리가 아니거나 없음
      }
    }
    current = nextLevel;
    if (current.length === 0) break;
  }
  return current.length > 0 ? current : [abs];
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** 한 줄 코드(node -e, python -c …)에서 파일 쓰기 API가 보이면 그 안의 경로 문자열 */
const WRITE_API =
  /\b(writeFile(Sync)?|appendFile(Sync)?|createWriteStream|rmSync|rmdirSync|unlink(Sync)?|rename(Sync)?|copyFile(Sync)?|cpSync|truncate(Sync)?|write_text|write_bytes|os\.remove|os\.unlink|os\.rename|os\.replace|shutil\.\w+|File\.(write|delete|rename)|open\s*\([^)]*['"][wax][b+]?['"])/;
function inlineCodeTargets(code) {
  if (!WRITE_API.test(code)) return [];
  const out = [];
  for (const m of code.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) {
    const value = m[2] ?? "";
    if (/^[\w.~/@-][\w./ @-]*$/.test(value) && (value.includes("/") || /\.\w{1,5}$/.test(value))) {
      out.push(value);
    }
  }
  return out;
}

/** patch 파일이 바꾸는 경로(a/·b/ 접두어를 뗀 상대 경로). 읽지 못하면 null */
function patchTargets(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const out = new Set();
  for (const m of text.matchAll(/^(?:diff --git a\/(\S+) b\/(\S+)|(?:---|\+\+\+) (\S+))/gm)) {
    for (const p of [m[1], m[2], m[3]]) {
      if (p && p !== "/dev/null") out.add(p.replace(/^[ab]\//, ""));
    }
  }
  return [...out];
}

/** xargs 뒤에 와도 파일을 쓰지 않는 명령 */
const READ_ONLY = new Set([
  "cat",
  "wc",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "head",
  "tail",
  "ls",
  "echo",
  "printf",
  "stat",
  "file",
  "du",
  "basename",
  "dirname",
  "realpath",
  "readlink",
  "sha256sum",
  "sha1sum",
  "md5sum",
  "diff",
  "cmp",
  "jq",
  "sort",
  "uniq",
  "test",
  "true",
]);
/** 다른 프로그램·스크립트를 실행해 무엇을 쓰는지 알 수 없는 명령 */
const RUNNERS = new Set([
  "npx",
  "pnpm",
  "npm",
  "yarn",
  "bunx",
  "tsx",
  "ts-node",
  "make",
  "just",
  "source",
  ".",
]);

/**
 * Bash 명령을 분석한다.
 * @param {string} command
 * @param {string} cwd 명령을 실행하는 디렉터리
 * @returns {{ targets: Target[], commits: CommitCall[], pushes: PushCall[], opaque: string[] }}
 *   opaque: 무엇을 쓰는지 훅이 풀 수 없는 쓰기(스크립트 실행, xargs, 변수 경로 등)
 */
export function analyzeCommand(command, cwd, depth = 0) {
  /** @type {Target[]} */
  const targets = [];
  /** @type {CommitCall[]} */
  const commits = [];
  /** @type {PushCall[]} */
  const pushes = [];
  /** @type {string[]} */
  const opaque = [];
  let dir = cwd;
  let dirKnown = true;

  /** @param {string} p @param {"write" | "tree"} kind @param {string} via @param {string} [base] */
  const add = (p, kind, via, base = dir) => {
    if (ignorable(p)) return;
    if (dynamic(p) || (!dirKnown && base === dir && !isAbsolute(p) && !p.startsWith("~"))) {
      opaque.push(`${via} ${p}`);
      return;
    }
    for (const path of expandPath(base, p)) targets.push({ path, kind, via });
  };

  /** cp·mv·install·ln·rsync: 대상 경로(디렉터리면 그 아래 원본 이름). mv는 원본도, ln은 링크가 가리키는 곳도 본다. */
  const copyLike = (name, args, base = dir) => {
    if (name === "install" && args.includes("-d")) return;
    let targetDir = null;
    const rest = [];
    let restOnly = false;
    for (let i = 0; i < args.length; i++) {
      const a = args[i] ?? "";
      if (restOnly) rest.push(a);
      else if (a === "--") restOnly = true;
      else if (a === "-t" || a === "--target-directory") targetDir = args[++i] ?? null;
      else if (a.startsWith("--target-directory="))
        targetDir = a.slice("--target-directory=".length);
      else if (
        ["-S", "--suffix", "-m", "--mode", "-o", "--owner", "-g", "--group"].includes(a) ||
        (name === "rsync" &&
          ["-e", "--rsh", "--exclude", "--include", "--filter", "-f"].includes(a))
      ) {
        i++;
      } else if (!a.startsWith("-")) rest.push(a);
    }
    const sources = targetDir ? rest : rest.slice(0, -1);
    const dest = targetDir ?? rest.at(-1);
    if (!dest || sources.length === 0) return;
    const destIsDir =
      Boolean(targetDir) ||
      dest.endsWith("/") ||
      sources.length > 1 ||
      (!dynamic(dest) && isDirectory(resolve(base, dest)));
    for (const source of sources) {
      const into = name === "rsync" ? dest : destIsDir ? join(dest, basename(source)) : dest;
      add(into, "tree", name, base);
      if (name === "mv") add(source, "tree", name, base);
      if (name === "ln") {
        // 링크로 보호 경로를 다른 이름으로 열지 못하게 링크 원본도 검사한다
        add(source, "tree", "ln 원본", base);
        if (!isAbsolute(source)) add(source, "tree", "ln 원본", resolve(base, dirname(dest)));
      }
    }
  };

  for (const seg of parseShell(command)) {
    for (const redirect of seg.redirects) {
      if (!["&>>", "&>", ">>", ">|", ">", "<>", ">&"].includes(redirect.op)) continue;
      if (redirect.op === ">&" && /^(\d+|-)$/.test(redirect.target)) continue;
      add(redirect.target, "write", `리다이렉트 ${redirect.op}`);
    }
    const inputFile = seg.redirects.find((r) => r.op === "<")?.target;

    const prefix = [];
    for (const w of seg.words) {
      if (!ASSIGNMENT.test(w)) break;
      prefix.push(w);
    }
    const words = stripPrefix(seg.words);
    const rawName = words[0] ?? "";
    const name = basename(rawName);
    const args = words.slice(1);

    if (/^(\.{1,2}\/|~)/.test(rawName)) {
      opaque.push(rawName); // ./script.sh 같은 실행 파일
      continue;
    }
    switch (name) {
      case "cd":
      case "pushd": {
        const to = args.find((a) => !a.startsWith("-"));
        if (!to) {
          dir = homedir();
          dirKnown = true;
        } else if (to === "-") dirKnown = false;
        else if (dynamic(to)) {
          dirKnown = false;
          opaque.push(`cd ${to}`);
        } else if (dirKnown || isAbsolute(to)) {
          dir = expandPath(dir, to)[0] ?? dir;
          dirKnown = true;
        }
        break;
      }
      case "rm":
      case "rmdir":
      case "unlink":
      case "shred":
        for (const p of positional(args)) add(p, "tree", name);
        break;
      case "touch":
        for (const p of positional(args, ["-d", "-t", "-r", "--date", "--reference"])) {
          add(p, "write", name);
        }
        break;
      case "truncate":
        for (const p of positional(args, ["-s", "--size", "-r", "--reference"]))
          add(p, "write", name);
        break;
      case "tee":
        for (const p of positional(args)) add(p, "write", name);
        break;
      case "cp":
      case "mv":
      case "install":
      case "ln":
      case "rsync":
        copyLike(name, args);
        break;
      case "dd":
        for (const a of args) if (a.startsWith("of=")) add(a.slice(3), "write", name);
        break;
      case "sed": {
        const inPlace = args.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith("--in-place"));
        if (!inPlace) break;
        const scriptFlags = ["-e", "--expression", "-f", "--file"];
        const files = positional(args, [...scriptFlags, "-l", "--line-length"]);
        const hasScriptFlag = args.some(
          (a) => scriptFlags.includes(a) || /^--(expression|file)=/.test(a),
        );
        for (const p of hasScriptFlag ? files : files.slice(1)) add(p, "write", "sed -i");
        break;
      }
      case "awk":
      case "gawk": {
        const index = args.indexOf("-i");
        if (index === -1 || !/inplace/.test(args[index + 1] ?? "")) break;
        const files = positional(args, ["-i", "-f", "-v", "-F", "-e", "--include", "--file"]);
        const hasProgramFlag = args.some((a) => a === "-f" || a === "-e" || a === "--file");
        for (const p of hasProgramFlag ? files : files.slice(1)) add(p, "write", "awk -i inplace");
        break;
      }
      case "ex":
      case "vi":
      case "vim":
      case "nvim":
      case "ed":
        for (const p of positional(args, ["-c", "-S", "-u", "-i", "--cmd", "-s", "-p"])) {
          if (!p.startsWith("+")) add(p, "write", name);
        }
        break;
      case "patch": {
        const pos = positional(args, [
          "-i",
          "--input",
          "-p",
          "-d",
          "--directory",
          "-o",
          "-r",
          "-B",
          "-D",
        ]);
        const patchFile =
          args[args.indexOf("-i") + 1] && args.includes("-i")
            ? args[args.indexOf("-i") + 1]
            : inputFile;
        if (pos[0]) add(pos[0], "write", "patch");
        else if (patchFile && !dynamic(patchFile)) {
          const paths = patchTargets(resolve(dir, patchFile));
          if (paths) for (const p of paths) add(p, "write", "patch");
          else opaque.push(`patch < ${patchFile}`);
        } else opaque.push("patch");
        break;
      }
      case "tar": {
        const extract = args.some(
          (a, i) =>
            a === "--extract" ||
            a === "--get" ||
            (/^-?[a-zA-Z]*x/.test(a) && (i === 0 || a.startsWith("-"))),
        );
        if (!extract) break;
        const index = args.findIndex((a) => a === "-C" || a === "--directory");
        const inline = args.find((a) => a.startsWith("--directory="));
        add(
          index !== -1 ? (args[index + 1] ?? ".") : inline ? inline.slice(12) : ".",
          "tree",
          "tar -x",
        );
        break;
      }
      case "unzip": {
        const index = args.indexOf("-d");
        if (args.includes("-l") || args.includes("-t")) break;
        add(index !== -1 ? (args[index + 1] ?? ".") : ".", "tree", "unzip");
        break;
      }
      case "xargs": {
        let i = 0;
        while (i < args.length && (args[i] ?? "").startsWith("-")) {
          i += ["-n", "-I", "-L", "-P", "-d", "-E", "-s", "-a"].includes(args[i] ?? "") ? 2 : 1;
        }
        const next = basename(args[i] ?? "");
        const nextArgs = args.slice(i + 1);
        const readsOnly =
          READ_ONLY.has(next) ||
          (next === "sed" && !nextArgs.some((a) => /^-[a-zA-Z]*i/.test(a))) ||
          next === "";
        if (!readsOnly) opaque.push(`xargs ${next}`);
        break;
      }
      case "perl": {
        const inPlace = args.some((a) => /^-[a-zA-Z]*i/.test(a));
        const files = [];
        const codes = [];
        let hasCode = false;
        for (let i = 0; i < args.length; i++) {
          const a = args[i] ?? "";
          if (/^-[a-zA-Z]*[eE]$/.test(a)) {
            hasCode = true;
            codes.push(args[++i] ?? "");
          } else if (!a.startsWith("-")) files.push(a);
        }
        if (inPlace) for (const p of hasCode ? files : files.slice(1)) add(p, "write", "perl -i");
        else if (hasCode)
          for (const code of codes) for (const p of inlineCodeTargets(code)) add(p, "write", name);
        else if (files.length > 0) opaque.push(`perl ${files[0]}`);
        break;
      }
      case "node":
      case "deno":
      case "bun":
      case "python":
      case "python3":
      case "ruby": {
        const codeFlags = ["-e", "--eval", "-p", "--print", "-c"];
        let hasCode = false;
        for (let i = 0; i < args.length; i++) {
          if (codeFlags.includes(args[i] ?? "")) {
            hasCode = true;
            for (const p of inlineCodeTargets(args[i + 1] ?? "")) add(p, "write", name);
          }
        }
        if (!hasCode && args.some((a) => !a.startsWith("-"))) opaque.push(`${name} 스크립트`);
        else if (args.includes("-m")) opaque.push(`${name} -m`);
        break;
      }
      case "find": {
        const destructive = args.some(
          (a, i) =>
            a === "-delete" ||
            (["-exec", "-execdir", "-ok"].includes(a) &&
              /^(rm|mv|sed|perl|tee|truncate|cp|shred|unlink)$/.test(basename(args[i + 1] ?? ""))),
        );
        if (!destructive) break;
        const roots = [];
        for (const a of args) {
          if (a.startsWith("-") || a === "(" || a === "!") break;
          roots.push(a);
        }
        for (const p of roots.length > 0 ? roots : ["."]) add(p, "tree", "find");
        break;
      }
      case "bash":
      case "sh":
      case "zsh":
      case "dash": {
        const index = args.indexOf("-c");
        if (index !== -1 && depth < 3) {
          const inner = analyzeCommand(args[index + 1] ?? "", dir, depth + 1);
          targets.push(...inner.targets);
          commits.push(...inner.commits);
          pushes.push(...inner.pushes);
          opaque.push(...inner.opaque);
        } else if (index === -1 && args.some((a) => !a.startsWith("-"))) {
          opaque.push(`${name} 스크립트`);
        }
        break;
      }
      case "eval":
        if (depth < 3) {
          const inner = analyzeCommand(args.join(" "), dir, depth + 1);
          targets.push(...inner.targets);
          commits.push(...inner.commits);
          pushes.push(...inner.pushes);
          opaque.push(...inner.opaque);
        }
        break;
      case "git": {
        let gitDir = dir;
        const config = [];
        let i = 0;
        while (i < args.length && (args[i] ?? "").startsWith("-")) {
          const a = args[i] ?? "";
          if (a === "-C") {
            gitDir = resolve(gitDir, args[i + 1] ?? ".");
            i += 2;
          } else if (a === "-c") {
            config.push(args[i + 1] ?? "");
            i += 2;
          } else if (["--git-dir", "--work-tree", "--namespace"].includes(a)) i += 2;
          else i++;
        }
        const sub = args[i];
        const subArgs = args.slice(i + 1);
        if (sub === "mv") copyLike("mv", subArgs, gitDir);
        else if (sub === "rm") {
          for (const p of positional(subArgs)) add(p, "tree", "git rm", gitDir);
        } else if (sub === "restore") {
          // --source 없이 HEAD·index로 되돌리는 것은 커밋된 내용으로 돌아갈 뿐이라 막지 않는다
          const hasSource = subArgs.some(
            (a) => a === "-s" || a === "--source" || a.startsWith("--source="),
          );
          if (hasSource) {
            for (const p of positional(subArgs, ["-s", "--source"]))
              add(p, "tree", "git restore --source", gitDir);
          }
        } else if (sub === "checkout") {
          const dd = subArgs.indexOf("--");
          const pos = positional(dd === -1 ? subArgs : subArgs.slice(0, dd), [
            "-b",
            "-B",
            "--orphan",
            "--conflict",
          ]);
          let paths = [];
          if (dd !== -1)
            paths = pos.length > 0 ? subArgs.slice(dd + 1) : []; // `-- 경로`만 있으면 index로 되돌림
          else if (pos.length >= 2) paths = pos.slice(1);
          for (const p of paths) add(p, "tree", "git checkout <커밋>", gitDir);
        } else if (sub === "apply" || sub === "am") {
          if (subArgs.some((a) => ["--check", "--stat", "--numstat", "--summary"].includes(a)))
            break;
          const files = positional(subArgs, ["-p", "-C", "--directory", "--exclude", "--include"]);
          if (files.length === 0) opaque.push(`git ${sub}`);
          for (const file of files) {
            const paths = dynamic(file) ? null : patchTargets(resolve(dir, file));
            if (paths) for (const p of paths) add(p, "write", `git ${sub}`, gitDir);
            else opaque.push(`git ${sub} ${file}`);
          }
        } else if (sub === "commit" || sub === "commit-tree" || sub === "merge") {
          commits.push({
            cwd: gitDir,
            sub,
            args: subArgs,
            heredocs: seg.heredocs,
            raw: command,
            config,
            env: prefix,
          });
        } else if (sub === "push") {
          pushes.push({ cwd: gitDir, args: subArgs });
        }
        break;
      }
      default:
        if (RUNNERS.has(name)) opaque.push(name);
        break;
    }
  }
  return { targets, commits, pushes, opaque };
}

/** 줄 첫머리의 `Acceptance:` 트레일러 */
export const TRAILER_LINE = /(^|\n)[ \t]*Acceptance[ \t]*:/i;

/**
 * git commit 인자에서 메시지 출처를 모은다.
 * @param {string[]} args
 */
export function commitSources(args) {
  /** @type {{ messages: string[], trailers: string[], files: string[], reuse: string[], templates: string[], amend: boolean }} */
  const out = { messages: [], trailers: [], files: [], reuse: [], templates: [], amend: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    const value = () => args[++i] ?? "";
    if (a === "-m" || a === "--message") out.messages.push(value());
    else if (a.startsWith("--message=")) out.messages.push(a.slice("--message=".length));
    else if (/^-[a-zA-Z]*m./.test(a) && !a.startsWith("--")) {
      out.messages.push(a.slice(a.indexOf("m") + 1));
    } else if (/^-[a-zA-Z]*m$/.test(a)) out.messages.push(value());
    else if (a === "--trailer") out.trailers.push(value());
    else if (a.startsWith("--trailer=")) out.trailers.push(a.slice("--trailer=".length));
    else if (a === "-F" || a === "--file") out.files.push(value());
    else if (a.startsWith("--file=")) out.files.push(a.slice("--file=".length));
    else if (/^-F./.test(a)) out.files.push(a.slice(2));
    else if (a === "-t" || a === "--template") out.templates.push(value());
    else if (a.startsWith("--template=")) out.templates.push(a.slice("--template=".length));
    else if (a === "-C" || a === "-c" || a === "--reuse-message" || a === "--reedit-message") {
      out.reuse.push(value());
    } else if (/^--re(use|edit)-message=/.test(a)) out.reuse.push(a.slice(a.indexOf("=") + 1));
    else if (a === "--amend") out.amend = true;
  }
  return out;
}

/**
 * git push 인자에서 강제 push 여부와 대상 브랜치를 본다.
 * @param {string[]} args
 */
export function pushInfo(args) {
  const valueFlags = ["--repo", "-o", "--push-option", "--receive-pack", "--exec"];
  let force = false;
  let all = false;
  for (const a of args) {
    if (a === "--force" || a === "--mirror" || (/^-[a-zA-Z]+$/.test(a) && a.includes("f")))
      force = true;
    if (a === "--all" || a === "--mirror") all = true;
  }
  const refspecs = positional(args, valueFlags).slice(1);
  if (refspecs.some((r) => r.startsWith("+"))) force = true;
  const destinations = refspecs.map((r) => {
    const spec = r.replace(/^\+/, "");
    const dst = spec.includes(":") ? spec.slice(spec.indexOf(":") + 1) : spec;
    return dst.replace(/^refs\/heads\//, "");
  });
  return { force, all, destinations, hasRefspec: refspecs.length > 0 };
}
