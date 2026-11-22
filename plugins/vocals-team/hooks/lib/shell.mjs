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
 * @typedef {{ words: string[], wordSpans: [number, number][], redirects: { op: string, target: string }[], heredocs: string[], heredocSpans: [number, number, boolean][], pipeIn: boolean }} Segment
 *   wordSpans: words[i]가 원문에서 차지하는 [시작, 끝) 위치(따옴표 포함)
 *   pipeIn: 앞 세그먼트와 파이프(|)로 이어져 표준 입력을 받는다
 *   heredocSpans: heredoc 본문이 원문에서 차지하는 [시작, 끝) 위치(구분자 줄 제외)와, 셸이 본문의 명령 치환을 실행하는지
 * @typedef {{ path: string, kind: "write" | "tree", via: string }} Target
 *   kind: write = 그 경로 하나를 쓴다, tree = 그 경로와 아래 전체를 바꾸거나 지운다
 * @typedef {{ cwd: string, sub: string, args: string[], heredocs: string[], raw: string, config: string[], env: string[] }} CommitCall
 * @typedef {{ cwd: string, args: string[] }} PushCall
 */

const newSegment = () =>
  /** @type {Segment} */ ({
    words: [],
    wordSpans: [],
    redirects: [],
    heredocs: [],
    heredocSpans: [],
    pipeIn: false,
  });

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

/** start부터 heredoc 본문들을 차례로 읽는다. spans는 본문마다 원문의 [시작, 끝) 위치 */
function skipHeredocBodies(src, start, heredocs) {
  let i = start;
  const bodies = [];
  /** @type {[number, number][]} */
  const spans = [];
  for (const heredoc of heredocs) {
    const lines = [];
    const bodyStart = i;
    let bodyEnd = src.length;
    while (i < src.length) {
      const nl = src.indexOf("\n", i);
      const line = src.slice(i, nl === -1 ? src.length : nl);
      const lineStart = i;
      i = nl === -1 ? src.length : nl + 1;
      if ((heredoc.strip ? line.replace(/^\t+/, "") : line) === heredoc.delim) {
        bodyEnd = lineStart;
        break;
      }
      lines.push(line);
    }
    bodies.push(lines.join("\n"));
    spans.push(/** @type {[number, number]} */ ([bodyStart, Math.max(bodyStart, bodyEnd)]));
  }
  return { end: i, bodies, spans };
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
  let quoted = false; // 단어에 따옴표·역슬래시가 있었나(heredoc 구분자가 따옴표면 본문을 펼치지 않는다)
  let wordStart = 0;
  /** @type {string | null} */
  let pendingRedirect = null;
  /** @type {{ delim: string, strip: boolean, quoted: boolean, seg: Segment }[]} */
  const pendingHeredocs = [];

  const endWord = () => {
    if (!inWord) return;
    if (pendingRedirect === "<<" || pendingRedirect === "<<-") {
      pendingHeredocs.push({ delim: word, strip: pendingRedirect === "<<-", quoted, seg });
    } else if (pendingRedirect) {
      seg.redirects.push({ op: pendingRedirect, target: word });
    } else {
      seg.words.push(word);
      seg.wordSpans.push([wordStart, i]);
    }
    pendingRedirect = null;
    word = "";
    inWord = false;
    quoted = false;
  };
  const endSegment = () => {
    endWord();
    if (seg.words.length || seg.redirects.length) segments.push(seg);
    seg = newSegment();
  };

  let i = 0;
  /** 단어를 시작한다(이미 단어 안이면 그대로) */
  const begin = () => {
    if (!inWord) wordStart = i;
    inWord = true;
  };
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "\\") {
      if (next !== "\n") {
        begin();
        word += next ?? "";
        quoted = true;
      }
      i += 2;
    } else if (c === "'") {
      const end = src.indexOf("'", i + 1);
      const stop = end === -1 ? src.length : end;
      begin();
      word += src.slice(i + 1, stop);
      quoted = true;
      i = stop + 1;
    } else if (c === '"') {
      begin();
      i++;
      quoted = true;
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
      begin();
      word += src.slice(i, end);
      i = end;
    } else if (c === "`") {
      const end = src.indexOf("`", i + 1);
      const stop = end === -1 ? src.length : end + 1;
      begin();
      word += src.slice(i, stop);
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
        const { end, bodies, spans } = skipHeredocBodies(src, i + 1, heredocs);
        heredocs.forEach((heredoc, index) => {
          const body = bodies[index] ?? "";
          heredoc.seg.heredocs.push(body);
          const span = spans[index];
          // 따옴표 없는 구분자(<<EOF)면 셸이 본문의 $(…)·백틱을 실행한다
          const live = !heredoc.quoted && /\$\(|`/.test(body);
          if (span) heredoc.seg.heredocSpans.push([span[0], span[1], live]);
        });
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
      const double = (c === "&" && next === "&") || (c === "|" && (next === "|" || next === "&"));
      if (c === "|" && next !== "|") seg.pipeIn = true;
      i += double ? 2 : 1;
    } else {
      begin();
      word += c;
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

/**
 * 명령 앞에 변수 대입이나 env가 붙었는가(`UPDATE_SNAPSHOT=all pnpm test`, `env X=1 vitest`).
 * 환경 변수는 도구의 동작(스냅샷 갱신, 설정 파일)을 바꿀 수 있어 검사 실행으로 보지 않는다(QA 반려 3차 #48)
 * @param {Segment} seg
 */
function hasEnvPrefix(seg) {
  const lead = seg.words.slice(0, seg.words.length - stripPrefix(seg.words).length);
  return lead.some((w) => ASSIGNMENT.test(w) || w === "env");
}

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

/** 코드(node -e, python -c, 표준 입력 코드)에 파일 쓰기 API가 있는가. 없으면 문자열을 경로로 보지 않는다 */
const WRITE_API =
  /\b(writeFile(Sync)?|appendFile(Sync)?|createWriteStream|rmSync|rmdirSync|unlink(Sync)?|rename(Sync)?|copyFile(Sync)?|cpSync|truncate(Sync)?|write_text|write_bytes|os\.remove|os\.unlink|os\.rename|os\.replace|shutil\.\w+|File\.(write|delete|rename)|open\s*\([^)]*['"]([wax][b+]?['"]|\+?>))/;

/** 받는 쪽이 이 이름이면 파일 API다(os.replace, fs.rename, File.write, Path(…) …). 인자는 모두 경로 후보 */
const FILE_RECEIVERS = new Set([
  "os",
  "path",
  "shutil",
  "fs",
  "fsp",
  "promises",
  "pathlib",
  "Path",
  "File",
  "FileUtils",
  "Dir",
  "IO",
]);
/** 인자가 경로인 함수. 이 인자는 공백이 있어도 경로로 본다 */
const PATH_FNS = new Set([
  "open",
  "Path",
  "PurePath",
  "unlink",
  "unlinkSync",
  "rename",
  "renameSync",
  "rmSync",
  "rmdirSync",
  "copyFile",
  "copyFileSync",
  "cpSync",
  "truncate",
  "truncateSync",
]);
/** 첫 인자만 경로이고 나머지는 써 넣을 내용인 함수 */
const PATH_FIRST_FNS = new Set([
  "writeFile",
  "writeFileSync",
  "appendFile",
  "appendFileSync",
  "createWriteStream",
]);
/**
 * 결과가 None·참거짓·숫자라 인자가 경로가 될 수 없는 함수(허용 목록): 출력·로그, 비교·검색(참·거짓·위치),
 * 파일에 써 넣는 내용(write). PR 본문·문서 내용을 고치는 코드의 글을 경로로 읽지 않으려고(#38, #41).
 * strip·split·encode·removesuffix·replace처럼 인자나 그 일부를 돌려주는 함수는 넣지 않는다(QA 반려 3차 #48).
 */
const SINK_FNS = new Set([
  "print",
  "println",
  "printf",
  "puts",
  "say",
  "warn",
  "die",
  "log",
  "info",
  "error",
  "debug",
  "startswith",
  "endswith",
  "startsWith",
  "endsWith",
  "find",
  "rfind",
  "index",
  "rindex",
  "count",
  "includes",
  "test",
  "indexOf",
  "lastIndexOf",
  "write",
  "writelines",
  "write_text",
  "write_bytes",
  "dump",
]);
/**
 * 바꾸는 함수: 찾을 글자(첫 인자)는 결과에 들어가지 않지만 바꿀 글자·대상 글(둘째 인자부터)은 결과(경로일 수 있다)에 들어간다.
 * `open('x'.replace('x', 'docs/a.md'), 'w')`, `re.sub('x', 'docs/a.md', 'x')`(QA 반려 #48). 둘째 인자부터는
 * 공백 없는 경로 모양이면 경로로 본다. 다만 출력·write 같은 글 자리 안에서 부른 것이면 보지 않는다.
 */
const REPLACE_FNS = new Set(["replace", "replaceAll", "sub", "subn", "gsub"]);

/** 경로로 볼 수 있는 문자열. loose면(경로 인자 자리) 공백을 허용한다 */
function pathLike(value, loose) {
  const shape = loose ? /^[\w.~/@-][\w./ @-]*$/ : /^[\w.~/@-][\w./@-]*$/;
  return shape.test(value) && (value.includes("/") || /\.\w{1,5}$/.test(value));
}

/** src[i]가 "("일 때 바로 앞의 호출 이름(`fs.writeFileSync`, `body.replace`, `open`). 없으면 "" */
function calleeBefore(src, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(src[j] ?? "")) j--;
  const end = j + 1;
  while (j >= 0 && /[\w.$]/.test(src[j] ?? "")) j--;
  return src.slice(j + 1, end);
}

/**
 * 코드의 문자열 리터럴과, 그 문자열이 어느 호출의 몇 번째 인자인지.
 * 언어별 따옴표만 본다(백틱은 JS만, 파이썬 ''' """는 여러 줄 한 덩어리). 주석은 건너뛴다.
 * @param {string} code
 * @param {"js" | "py" | "rb" | "pl"} lang
 */
function stringLiterals(code, lang) {
  const quotes = lang === "js" ? "'\"`" : "'\"";
  /** @type {{ callee: string, arg: number }[]} */
  const stack = [];
  /** @type {{ value: string, frames: { callee: string, arg: number }[] }[]} */
  const out = [];
  let i = 0;
  while (i < code.length) {
    const c = code[i] ?? "";
    const comment =
      lang === "js"
        ? c === "/" && code[i + 1] === "/"
        : c === "#" && (i === 0 || /\s/.test(code[i - 1] ?? ""));
    if (comment) {
      while (i < code.length && code[i] !== "\n") i++;
      continue;
    }
    if (lang === "js" && c === "/" && code[i + 1] === "*") {
      const end = code.indexOf("*/", i + 2);
      i = end === -1 ? code.length : end + 2;
      continue;
    }
    if (quotes.includes(c)) {
      const q = lang === "py" && code.startsWith(c.repeat(3), i) ? c.repeat(3) : c;
      const multiline = q.length === 3 || c === "`";
      let j = i + q.length;
      let value = "";
      while (j < code.length && !code.startsWith(q, j) && (multiline || code[j] !== "\n")) {
        if (code[j] === "\\") {
          value += code[j + 1] ?? "";
          j += 2;
        } else {
          value += code[j];
          j++;
        }
      }
      out.push({ value, frames: stack.map((frame) => ({ ...frame })) });
      i = code.startsWith(q, j) ? j + q.length : j;
      continue;
    }
    if (c === "(") stack.push({ callee: calleeBefore(code, i), arg: 0 });
    else if (c === "[" || c === "{") stack.push({ callee: "", arg: 0 });
    else if (c === ")" || c === "]" || c === "}") stack.pop();
    else if (c === "," && stack.length > 0) {
      const top = stack.at(-1);
      if (top) top.arg++;
    }
    i++;
  }
  return out;
}

/**
 * 코드에 파일 쓰기 API가 있으면 쓰기 대상일 수 있는 경로 문자열을 모은다.
 * - 경로 인자 자리(open·Path·fs.*·os.*·shutil.*·File.* 등의 인자, writeFileSync 등의 첫 인자): 공백이 있어도 경로
 * - 글 자리(print·startswith·write 등의 인자, writeFileSync 등의 둘째 인자부터, 그 안에서 부른 호출의 인자): 경로로 보지 않음
 * - replace·sub의 찾을 글자(첫 인자)는 경로로 보지 않고, 둘째 인자부터는 결과에 들어가므로 아래처럼 본다
 * - 그 밖(변수 대입, 목록 등): 공백 없는 경로 모양 문자열만. `p = 'docs/a.md'; open(p, 'w')`를 놓치지 않으려고
 * @param {string} code
 * @param {"js" | "py" | "rb" | "pl"} lang
 */
function inlineCodeTargets(code, lang) {
  if (!WRITE_API.test(code)) return [];
  /** @param {{ callee: string, arg: number }} frame */
  const kindOf = ({ callee, arg }) => {
    const parts = callee.split(".");
    const fn = parts.at(-1) ?? "";
    const receiver = parts.at(-2) ?? "";
    const pathFirst =
      PATH_FIRST_FNS.has(fn) || ((receiver === "File" || receiver === "IO") && fn === "write");
    if (pathFirst) return arg > 0 ? "text" : "path";
    if (FILE_RECEIVERS.has(receiver) || PATH_FNS.has(fn)) return "path";
    if (SINK_FNS.has(fn)) return "text";
    if (REPLACE_FNS.has(fn)) return arg > 0 ? "other" : "text";
    return "other";
  };
  const out = [];
  for (const { value: raw, frames } of stringLiterals(code, lang)) {
    // perl open의 모드가 붙은 경로(">docs/a.md", "+<docs/a.md")
    const value = lang === "pl" ? raw.replace(/^\+?(<|>{1,2})\s*/, "") : raw;
    const top = frames.at(-1);
    const kind = top ? kindOf(top) : "other";
    // 바로 감싼 자리만 본다. 글 자리 바깥(`print(open(…))`)이어도 안쪽 경로 자리는 경로다(QA 반려 2차)
    if (kind === "text") continue;
    if (pathLike(value, kind === "path")) out.push(value);
  }
  return out;
}

/**
 * 쓰기 API가 있는 코드가 경로를 조합하거나 바깥에서 받는가: join·resolve·format, 문자열 더하기, f-string,
 * 템플릿 `${}`, argv·환경 변수·입력·디렉터리 목록. 그러면 무엇을 쓰는지 모른다(opaque, QA 반려 2차 #48)
 */
const COMPOSED_PATH =
  /\b(join|resolve|normpath|abspath|expanduser|format|environ|getenv|input|readline|stdin|glob|rglob|listdir|readdir|readdirSync|scandir|iterdir|walk)\b|argv|ARGV|\bENV\b|\bf["']|\$\{|["'`]\s*\+|\+\s*["'`]|%\s*\(|["']\s*%\s*\w/;
function composesPath(code) {
  return WRITE_API.test(code) && COMPOSED_PATH.test(code);
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

/** 파일을 쓰게 하는 인자: 스냅샷·기준선 갱신, 포맷 쓰기, 자동 수정, 결과 파일 */
const WRITE_FLAGS = /^(-u|--update|--update=.*|-w|--write|--fix|--fix-type(=.*)?|--output.*|-o)$/;
/**
 * 저장소 파일을 쓰지 않는 package.json 스크립트: 검사·테스트, 로컬 DB(`supabase/.pglite/`만 씀).
 * `format`(prettier --write)과 그 밖의 스크립트는 계속 opaque다.
 */
const READ_ONLY_SCRIPTS =
  /^(check|check:[\w:-]+|test|test:[\w:-]+|lint|typecheck|format:check|harness:report|db:reset|db:query)$/;
/** 위 스크립트가 부르는 검사 스크립트 파일. `node scripts/check-req-trace.ts`처럼 직접 불러도 같다 */
const READ_ONLY_SCRIPT_FILES =
  /(^|\/)scripts\/(acceptance-guard|check-migrations|check-harness-change|check-req-trace|check-erd-drift|harness-report|reset-local-db|query-local-db)\.ts$/;
/** 직접 부를 수 있는 검사 도구. 읽기 모드(readOnlyTool)가 아니면 opaque */
const DIRECT_TOOLS = new Set(["vitest", "tsc", "eslint", "prettier"]);
/** pnpm·npm·yarn의 값을 받는 전역 플래그 */
const PM_VALUE_FLAGS = ["--filter", "-F", "-C", "--dir"];
/** pnpm·npm·yarn의 값 없는 전역 플래그 중 허용하는 것 */
const PM_SAFE_FLAGS = [
  "-r",
  "--recursive",
  "--silent",
  "-s",
  "--if-present",
  "--parallel",
  "--stream",
];
/** 파일을 쓰지 않는 git 하위 명령(xargs 뒤) */
const READ_GIT = new Set([
  "log",
  "show",
  "diff",
  "status",
  "blame",
  "ls-files",
  "ls-tree",
  "rev-parse",
  "cat-file",
  "grep",
  "shortlog",
  "describe",
]);

/**
 * 검사 도구마다 읽기 모드에서 허용하는 플래그(허용 목록, QA 반려 2차 #48). 여기 없는 플래그가 하나라도 있으면
 * 읽기 모드가 아니다: 트레이스·캐시·커버리지·프로파일·설정 파일·출력 경로 옵션은 파일을 쓰거나 코드를 실행한다.
 * flags: 값 없는 플래그, values: 값을 받는 플래그(`--x v`, `--x=v`), require: 꼭 있어야 하는 플래그 중 하나
 */
const TOOL_FLAGS = {
  vitest: {
    flags: ["--run", "--silent", "--passWithNoTests"],
    values: ["-t", "--testNamePattern", "--reporter", "--project", "--dir", "--bail"],
    require: [],
  },
  tsc: {
    flags: ["--noEmit", "--pretty", "--skipLibCheck"],
    values: ["-p", "--project"],
    require: ["--noEmit"],
  },
  eslint: { flags: ["--quiet", "--no-warn-ignored"], values: ["--max-warnings"], require: [] },
  prettier: {
    flags: ["--check", "-c", "--list-different", "-l"],
    values: ["--log-level"],
    require: ["--check", "-c", "--list-different", "-l"],
  },
};
/** 검사 스크립트를 node로 직접 부를 때 허용하는 node 플래그 */
const NODE_SAFE_FLAGS = /^(--experimental-strip-types|--no-warnings(=ExperimentalWarning)?)$/;

/**
 * args가 허용 목록 안의 플래그와 위치 인자만 갖는가. `true`·`false` 위치 인자(`--noEmit false`)는 허용하지 않는다
 * @param {string[]} args @param {{ flags: string[], values: string[] }} spec
 */
function onlyAllowedFlags(args, spec) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (/^(true|false)$/i.test(a)) return false;
    if (!a.startsWith("-") || a === "--") continue;
    if (spec.flags.includes(a)) continue;
    if (spec.values.includes(a)) i++;
    else if (!(a.includes("=") && spec.values.includes(a.slice(0, a.indexOf("="))))) return false;
  }
  return true;
}

/**
 * 검사·테스트 도구를 읽기 모드로 부르는가(허용 목록): vitest(run·list), tsc --noEmit, eslint, prettier --check,
 * 검사 스크립트 파일(플래그 없이).
 */
function readOnlyTool(tool, args) {
  const name = basename(tool);
  const spec = TOOL_FLAGS[/** @type {keyof typeof TOOL_FLAGS} */ (name)];
  if (!spec) return READ_ONLY_SCRIPT_FILES.test(tool) && args.every((a) => !a.startsWith("-"));
  if (name === "vitest" && !["run", "list", undefined].includes(positional(args, spec.values)[0])) {
    // vitest의 첫 위치 인자는 하위 명령(init·bench 등)이거나 파일 필터다. 필터는 경로 모양만 허용
    const first = positional(args, spec.values)[0] ?? "";
    if (!/[/.]/.test(first)) return false;
  }
  if (spec.require.length > 0 && !args.some((a) => spec.require.includes(a))) return false;
  return onlyAllowedFlags(args, spec);
}

/**
 * 러너(pnpm·npx 등)가 검사·테스트만 돌리는가(이슈 #48). `pnpm check`, `pnpm check:*`, `pnpm test`,
 * `pnpm vitest run …`, `pnpm --filter x exec vitest run …`, `npx tsc --noEmit` 같은 것.
 * 스냅샷 갱신(`-u`)·`--write`·`--fix`·`--update`가 있으면 아니다.
 * 테스트 코드 자체가 파일을 쓰는 것은 여기서 보지 않는다(테스트 파일 수정은 경로 규칙이 본다).
 */
function runsReadOnly(name, args) {
  if (args.some((a) => WRITE_FLAGS.test(a))) return false;
  if (name === "npx" || name === "bunx") {
    let i = 0;
    while (args[i] === "-y" || args[i] === "--yes") i++;
    return i < args.length && readOnlyTool(args[i] ?? "", args.slice(i + 1));
  }
  if (name === "tsx" || name === "ts-node") {
    return READ_ONLY_SCRIPT_FILES.test(args[0] ?? "") && args.every((a) => !a.startsWith("-"));
  }
  if (name !== "pnpm" && name !== "npm" && name !== "yarn") return false;
  // 전역 플래그도 허용 목록만(QA 반려 2차)
  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i] ?? "";
    if (!a.startsWith("-")) break;
    if (PM_VALUE_FLAGS.includes(a)) i++;
    else if (!PM_SAFE_FLAGS.includes(a) && !/^--filter=/.test(a)) return false;
  }
  const sub = args[i] ?? "";
  let rest = args.slice(i + 1);
  // 스크립트에 넘기는 인자는 위치 인자만(`pnpm test -- tests/x.test.ts`). 플래그가 있으면 읽기 전용으로 보지 않는다
  const plain = (/** @type {string[]} */ list) =>
    list.every((a) => a === "--" || !a.startsWith("-"));
  if (sub === "run" || sub === "run-script") {
    const script = rest[0] ?? "";
    rest = rest.slice(1);
    return READ_ONLY_SCRIPTS.test(script) && plain(rest);
  }
  if (sub === "exec") return readOnlyTool(rest[0] ?? "", rest.slice(1));
  if (["test", "t", "tst"].includes(sub) || READ_ONLY_SCRIPTS.test(sub)) return plain(rest);
  return name === "pnpm" && Object.hasOwn(TOOL_FLAGS, sub) && readOnlyTool(sub, rest); // pnpm vitest run
}

/**
 * 인터프리터가 표준 입력으로 받는 코드: heredoc(<<), here-string(<<<), 입력 리다이렉트(< 파일),
 * 앞 세그먼트에서 파이프로 넘어온 heredoc·echo/printf 인자·cat 파일.
 * @param {Segment} seg
 * @param {Segment | null} prev
 * @param {string} dir
 */
function stdinCode(seg, prev, dir) {
  const read = (file) => {
    try {
      return dynamic(file) ? "" : readFileSync(resolve(dir, file), "utf8");
    } catch {
      return "";
    }
  };
  const out = [...seg.heredocs];
  for (const redirect of seg.redirects) {
    if (redirect.op === "<<<") out.push(redirect.target);
    else if (redirect.op === "<") out.push(read(redirect.target));
  }
  if (seg.pipeIn && prev) {
    out.push(...prev.heredocs);
    const words = stripPrefix(prev.words);
    const name = basename(words[0] ?? "");
    if (name === "echo" || name === "printf") out.push(words.slice(1).join(" "));
    else if (name === "cat") for (const file of positional(words.slice(1))) out.push(read(file));
  }
  return out.filter(Boolean);
}

/** 셸·인터프리터가 훅이 읽을 수 없는 표준 입력(`git log … | sh`, `curl … | python3`)을 실행하는가 */
function unknownStdin(seg, prev) {
  if (!seg.pipeIn || !prev || prev.heredocs.length > 0) return false;
  return !["echo", "printf", "cat"].includes(basename(stripPrefix(prev.words)[0] ?? ""));
}

/**
 * Bash 명령을 분석한다.
 * @param {string} command
 * @param {string} cwd 명령을 실행하는 디렉터리
 * @returns {{ targets: Target[], commits: CommitCall[], pushes: PushCall[], opaque: string[], checks: string[] }}
 *   checks: 읽기 전용으로 본 검사·테스트 실행(pnpm check 등). main에서는 opaque였다. 다른 세그먼트와 섞이면 guard-bash가
 *   main처럼 보호 경로 언급 검사를 돌린다(QA 반려 2차 #48)
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
  /** @type {string[]} */
  const checks = [];
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
    // cp -l(하드 링크)·-s(심볼릭 링크)는 ln과 같이 원본도 본다
    const linkCopy =
      name === "cp" &&
      args.some(
        (a) => /^-[a-zA-Z]*[ls][a-zA-Z]*$/.test(a) || a === "--link" || a === "--symbolic-link",
      );
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
      if (name === "ln" || linkCopy) {
        // 링크로 보호 경로를 다른 이름으로 열지 못하게 링크 원본도 검사한다
        add(source, "tree", "ln 원본", base);
        if (!isAbsolute(source)) add(source, "tree", "ln 원본", resolve(base, dirname(dest)));
      }
    }
  };

  /** @type {Segment | null} */
  let prev = null;
  for (const seg of parseShell(command)) {
    const previous = prev;
    prev = seg;
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
          // 이동한 곳을 모를 뿐 쓰기는 아니다. 뒤의 상대 경로 쓰기는 add()가 opaque로 모은다(이슈 #48)
          dirKnown = false;
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
        if (index === -1 || !/inplace/.test(args[index + 1] ?? "")) {
          // 프로그램 안의 `print > "파일"`·`| "명령"`·system()도 쓰기다(QA 반려 #48)
          const program = args.some((a) => a === "-f" || a === "--file")
            ? null
            : positional(args, ["-v", "-F", "--assign", "--field-separator"])[0];
          if (program === null) opaque.push(`${name} -f`);
          else if (program && /[>|]|system\s*\(/.test(program)) {
            const files = [...program.matchAll(/>{1,2}\s*"([^"]+)"/g)].map((m) => m[1] ?? "");
            for (const p of files) add(p, "write", `${name} 리다이렉트`);
            if (files.length === 0 || /\||system\s*\(|>{1,2}\s*[^\s"]/.test(program)) {
              opaque.push(`${name} 쓰기`);
            }
          }
          break;
        }
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
          (next === "git" && READ_GIT.has(positional(nextArgs, ["-C", "-c"])[0] ?? "")) ||
          next === "";
        if (!readsOnly && !hasEnvPrefix(seg) && runsReadOnly(next, nextArgs)) {
          checks.push(`xargs ${next}`);
        } else if (!readsOnly) opaque.push(`xargs ${next}`);
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
        else if (hasCode) {
          for (const code of codes) {
            for (const p of inlineCodeTargets(code, "pl")) add(p, "write", name);
            if (composesPath(code)) opaque.push(`${name} 코드 경로`);
          }
        } else if (files.length > 0 && files[0] !== "-") opaque.push(`perl ${files[0]}`);
        else {
          for (const code of stdinCode(seg, previous, dir)) {
            for (const p of inlineCodeTargets(code, "pl")) add(p, "write", `${name} 표준 입력`);
            if (composesPath(code)) opaque.push(`${name} 코드 경로`);
          }
        }
        break;
      }
      case "node":
      case "deno":
      case "bun":
      case "python":
      case "python3":
      case "ruby": {
        const lang = name.startsWith("python") ? "py" : name === "ruby" ? "rb" : "js";
        const codeFlags = ["-e", "--eval", "-p", "--print", "-c"];
        let hasCode = false;
        for (let i = 0; i < args.length; i++) {
          if (codeFlags.includes(args[i] ?? "")) {
            hasCode = true;
            const code = args[i + 1] ?? "";
            for (const p of inlineCodeTargets(code, lang)) add(p, "write", name);
            if (composesPath(code)) opaque.push(`${name} 코드 경로`);
            // 코드가 인자(sys.argv, sys.orig_argv, process.argv, ARGV)로 받은 경로에 쓰면 뒤의 인자가 쓰기 대상이다
            if (WRITE_API.test(code) && /argv|ARGV/.test(code)) {
              for (const p of positional(args.slice(i + 2))) add(p, "write", `${name} 인자`);
            }
            i++;
          }
        }
        const script = positional(args).find((a) => a !== "-");
        if (!hasCode && script) {
          // 검사 스크립트(scripts/check-*.ts 등)는 갱신 플래그가 없으면 파일을 쓰지 않는다
          const at = args.indexOf(script);
          const checkScript =
            name === "node" &&
            READ_ONLY_SCRIPT_FILES.test(script) &&
            args.slice(0, at).every((a) => NODE_SAFE_FLAGS.test(a)) &&
            args.slice(at + 1).every((a) => !a.startsWith("-"));
          if (checkScript && !hasEnvPrefix(seg)) checks.push(`${name} ${script}`);
          else opaque.push(`${name} 스크립트`);
        } else if (args.includes("-m")) opaque.push(`${name} -m`);
        else if (!hasCode) {
          // python3 - <<'EOF', node <<'EOF', echo '…' | python3 같은 표준 입력 코드도 -c/-e처럼 본다
          if (unknownStdin(seg, previous)) opaque.push(`${name} 표준 입력`);
          for (const code of stdinCode(seg, previous, dir)) {
            for (const p of inlineCodeTargets(code, lang)) add(p, "write", `${name} 표준 입력`);
            if (composesPath(code)) opaque.push(`${name} 코드 경로`);
          }
        }
        break;
      }
      case "find": {
        // -exec 뒤 명령이 찾은 파일을 바꾸면 찾는 곳(roots) 전체를 쓰기 대상으로 본다.
        // sed·perl은 -i일 때만, cp·install·rsync는 복사 대상만 본다(읽기 명령 오탐, 이슈 #48).
        let destructive = args.includes("-delete");
        for (let i = 0; i < args.length; i++) {
          const a = args[i] ?? "";
          if (["-fprint", "-fprint0", "-fprintf", "-fls"].includes(a)) {
            add(args[i + 1] ?? "", "write", `find ${a}`);
            continue;
          }
          if (!["-exec", "-execdir", "-ok", "-okdir"].includes(a)) continue;
          const cmd = [];
          let j = i + 1;
          while (j < args.length && args[j] !== ";" && args[j] !== "+") cmd.push(args[j++] ?? "");
          i = j;
          const tool = basename(stripPrefix(cmd)[0] ?? "");
          const toolArgs = stripPrefix(cmd).slice(1);
          if (/^(rm|rmdir|mv|tee|truncate|shred|unlink|ln)$/.test(tool)) destructive = true;
          else if (tool === "sed" || tool === "perl") {
            if (toolArgs.some((x) => /^-[a-zA-Z]*i/.test(x) || x.startsWith("--in-place"))) {
              destructive = true;
            }
          } else if (tool === "cp" || tool === "install" || tool === "rsync") {
            const t = toolArgs.findIndex((x) => x === "-t" || x === "--target-directory");
            const dest = t !== -1 ? toolArgs[t + 1] : positional(toolArgs).at(-1);
            const linkCopy = toolArgs.some((x) => /^-[a-zA-Z]*[ls][a-zA-Z]*$/.test(x));
            if (!dest || dest.includes("{}") || linkCopy) destructive = true;
            else add(dest, "tree", `find -exec ${tool}`);
          } else if (
            RUNNERS.has(tool) ||
            /^(bash|sh|zsh|dash|node|deno|bun|python3?|ruby|awk|gawk|xargs|ex|vi|vim|ed|dd|patch)$/.test(
              tool,
            )
          ) {
            opaque.push(`find -exec ${tool}`);
          }
        }
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
        // bash -c "$X": 변수·치환이 든 코드는 무엇을 실행하는지 모른다(QA 반려 #48). 보이는 부분은 그대로 분석한다
        if (index !== -1 && dynamic(args[index + 1] ?? "")) opaque.push(`${name} -c 변수`);
        if (index !== -1 && depth < 3) {
          const inner = analyzeCommand(args[index + 1] ?? "", dir, depth + 1);
          targets.push(...inner.targets);
          commits.push(...inner.commits);
          pushes.push(...inner.pushes);
          opaque.push(...inner.opaque);
          checks.push(...inner.checks);
        } else if (index === -1 && positional(args).some((a) => a !== "-")) {
          opaque.push(`${name} 스크립트`);
        } else if (index === -1 && depth < 3) {
          // bash <<'EOF', bash -s < x.sh, echo '…' | sh: 표준 입력의 명령도 분석한다
          if (unknownStdin(seg, previous)) opaque.push(`${name} 표준 입력`);
          for (const code of stdinCode(seg, previous, dir)) {
            const inner = analyzeCommand(code, dir, depth + 1);
            targets.push(...inner.targets);
            commits.push(...inner.commits);
            pushes.push(...inner.pushes);
            opaque.push(...inner.opaque);
            checks.push(...inner.checks);
          }
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
          checks.push(...inner.checks);
        }
        break;
      case "git": {
        let gitDir = dir;
        const config = [];
        let i = 0;
        while (i < args.length && (args[i] ?? "").startsWith("-")) {
          const a = args[i] ?? "";
          if (a === "-C") {
            const to = args[i + 1] ?? ".";
            // 모르는 곳(cd $X) 기준의 상대 -C는 계속 모르는 곳이다: dir을 그대로 써서 add()가 opaque로 모으게 한다
            if (dirKnown || isAbsolute(to)) gitDir = resolve(gitDir, to);
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
      case "curl": {
        // -o 파일, --output-dir 디렉터리. -O(원격 이름)는 어디에 쓰는지 모른다(QA 반려 #48)
        for (let i = 0; i < args.length; i++) {
          const a = args[i] ?? "";
          const short = /^-([a-zA-Z]*?)([oO])(.*)$/.exec(a); // -o 파일, -sSo 파일, -ofile, -sSLO
          if (a === "--output") add(args[++i] ?? "", "write", "curl -o");
          else if (a.startsWith("--output=")) add(a.slice(9), "write", "curl -o");
          else if (a === "--output-dir") add(args[++i] ?? "", "tree", "curl --output-dir");
          else if (a === "--remote-name" || a === "--remote-name-all") opaque.push("curl -O");
          else if (short && !a.startsWith("--")) {
            if (short[2] === "O") opaque.push("curl -O");
            else add(short[3] || (args[++i] ?? ""), "write", "curl -o");
          }
        }
        break;
      }
      case "wget": {
        // -O 파일(-O -는 표준 출력), -P 디렉터리. 둘 다 없으면 현재 디렉터리에 쓴다(QA 반려 #48)
        let known = false;
        for (let i = 0; i < args.length; i++) {
          const a = args[i] ?? "";
          const short = /^-([a-zA-Z]*?)([OP])(.*)$/.exec(a); // -O 파일, -qO-, -qO 파일, -P 디렉터리
          let flag = null;
          let p = "";
          if (a === "--output-document" || a === "--directory-prefix") {
            flag = a === "--output-document" ? "O" : "P";
            p = args[++i] ?? "";
          } else if (/^--(output-document|directory-prefix)=/.test(a)) {
            flag = a.startsWith("--output") ? "O" : "P";
            p = a.slice(a.indexOf("=") + 1);
          } else if (short && !a.startsWith("--")) {
            flag = short[2] ?? null;
            p = short[3] || (args[++i] ?? "");
          }
          if (flag) {
            known = true;
            if (flag === "P") add(p, "tree", "wget -P");
            else if (p !== "-") add(p, "write", "wget -O");
          }
        }
        if (!known) opaque.push("wget");
        break;
      }
      default:
        // 변수 대입·env가 앞에 붙으면(`UPDATE_SNAPSHOT=all pnpm test`) 검사 실행으로 보지 않는다(QA 반려 3차)
        if (RUNNERS.has(name) && !hasEnvPrefix(seg) && runsReadOnly(name, args)) checks.push(name);
        else if (RUNNERS.has(name)) opaque.push(name);
        else if (DIRECT_TOOLS.has(name) && !hasEnvPrefix(seg) && readOnlyTool(name, args)) {
          checks.push(name);
        } else if (DIRECT_TOOLS.has(name) && hasEnvPrefix(seg)) opaque.push(name);
        // 직접 부른 검사 도구가 쓰기 모드면(prettier --write, eslint --fix, tsc 출력, vitest -u) 무엇을 쓰는지 모른다
        else if (DIRECT_TOOLS.has(name) && !readOnlyTool(name, args)) opaque.push(name);
        break;
    }
  }
  return { targets, commits, pushes, opaque, checks };
}

/**
 * 표준 입력을 코드로 실행하지 않는 명령. 이 명령의 heredoc 본문은 데이터(파일 내용, 커밋 메시지, PR 본문)다.
 * 인터프리터·셸(bash, python3, node, psql, ssh 등)은 넣지 않는다.
 */
const DATA_STDIN = new Set([
  "cat",
  "tee",
  "git",
  "gh",
  "head",
  "tail",
  "grep",
  "wc",
  "sort",
  "uniq",
  "jq",
  "diff",
  "base64",
  "true",
  ":",
]);

/** 인자가 데이터(출력할 글, API 요청 본문, 검색어·필터)인 명령. 명령 규칙 검사에서 인자를 뺀다 */
const DATA_ARGS = new Set(["echo", "printf", "gh", "jq", "grep", "egrep", "fgrep", "rg"]);
/** 보호 경로 언급 검사에서 인자를 빼는 명령. grep·rg·cat의 파일 인자는 읽는 경로라 남긴다(jq는 필터만 뺀다) */
const MENTION_DATA_ARGS = new Set(["echo", "printf", "gh"]);
const OUTPUT_OPS = new Set(["&>>", "&>", ">>", ">|", ">", "<>", ">&"]);

const nameOf = (/** @type {Segment} */ seg) => basename(stripPrefix(seg.words)[0] ?? "");

/** 작은따옴표 밖의 $(…)·백틱(셸이 실행하는 명령 치환)이 있는가 */
function hasLiveSubstitution(raw) {
  let inDouble = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === "\\") i++;
    else if (c === "'" && !inDouble) {
      const end = raw.indexOf("'", i + 1);
      if (end === -1) return false;
      i = end;
    } else if (c === '"') inDouble = !inDouble;
    else if (c === "`" || (c === "$" && raw[i + 1] === "(")) return true;
  }
  return false;
}

/** 세그먼트들이 파일에 쓰는가(출력 리다이렉트, tee 파일) */
function writesFile(segments) {
  return segments.some(
    (seg) =>
      seg.redirects.some(
        (r) =>
          OUTPUT_OPS.has(r.op) &&
          !ignorable(r.target) &&
          !(r.op === ">&" && /^(\d+|-)$/.test(r.target)),
      ) ||
      (nameOf(seg) === "tee" &&
        positional(stripPrefix(seg.words).slice(1)).some((p) => !ignorable(p))),
  );
}

/**
 * 데이터를 빼도 되는 명령(허용 목록, QA 반려 2차 #48). 한 명령의 모든 세그먼트가 여기 들면 데이터 인자·heredoc을 뺀다.
 * 하나라도 모르는 명령(셸·인터프리터·find·awk·timeout·script·./x·`$(…)` 명령 자리 등)이 있으면 아무것도 빼지 않는다:
 * 파일에 쓴 글이나 커밋 메시지가 같은 명령에서 실행될 수 있다.
 */
const SAFE_COMMANDS = new Set([
  "echo",
  "printf",
  "jq",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "cat",
  "head",
  "tail",
  "wc",
  "sort",
  "uniq",
  "diff",
  "ls",
  "pwd",
  "true",
  ":",
  "test",
  "base64",
  "tee",
  "cd",
  "pushd",
  "popd",
]);
/** 데이터를 빼도 되는 git 하위 명령. `-C` 밖의 전역 플래그(`-c alias.…` 등)가 있으면 안 된다 */
const SAFE_GIT = new Set([
  "add",
  "commit",
  "log",
  "show",
  "diff",
  "status",
  "rev-parse",
  "branch",
  "checkout",
  "switch",
  "fetch",
  "push",
  "pull",
  "restore",
  "ls-files",
  "ls-tree",
  "blame",
  "merge-base",
]);

/**
 * 데이터를 빼도 되는 gh 하위 명령(허용 목록, QA 반려 3차 #48): `gh api`와 PR·이슈·실행의 조회·작성.
 * download·clone·alias·extension·codespace 등 파일을 쓰거나 셸을 실행하는 하위 명령은 목록 밖이다.
 */
const SAFE_GH = {
  api: null,
  pr: [
    "view",
    "list",
    "create",
    "edit",
    "comment",
    "diff",
    "checks",
    "status",
    "ready",
    "close",
    "reopen",
    "review",
  ],
  issue: ["view", "list", "create", "edit", "comment", "status", "close", "reopen"],
  run: ["view", "list", "watch"],
  repo: ["view"],
  label: ["list"],
  search: null,
};
function safeGh(/** @type {string[]} */ args) {
  const valueFlags = ["-R", "--repo"];
  const pos = positional(args, valueFlags);
  const sub = pos[0] ?? "";
  if (!Object.hasOwn(SAFE_GH, sub)) return false;
  const allowed = SAFE_GH[/** @type {keyof typeof SAFE_GH} */ (sub)];
  return allowed === null || allowed.includes(pos[1] ?? "");
}

/** 검사·테스트만 돌리는 세그먼트인가(pnpm check, vitest run, node scripts/check-*.ts 등) */
function isCheckRun(/** @type {Segment} */ seg) {
  if (hasEnvPrefix(seg)) return false;
  const words = stripPrefix(seg.words);
  const name = basename(words[0] ?? "");
  const args = words.slice(1);
  if (RUNNERS.has(name)) return runsReadOnly(name, args);
  if (DIRECT_TOOLS.has(name)) return readOnlyTool(name, args);
  if (name !== "node") return false;
  const at = args.findIndex((a) => !a.startsWith("-"));
  return (
    at !== -1 &&
    READ_ONLY_SCRIPT_FILES.test(args[at] ?? "") &&
    args.slice(0, at).every((a) => NODE_SAFE_FLAGS.test(a)) &&
    args.slice(at + 1).every((a) => !a.startsWith("-"))
  );
}

/** 데이터를 빼도 되는 세그먼트인가 */
function safeSegment(/** @type {Segment} */ seg, /** @type {string} */ command) {
  const words = stripPrefix(seg.words);
  const raw = words[0] ?? "";
  // 변수 대입만 있는 세그먼트도 `X=$(…)`이면 실행한다
  const spans = seg.wordSpans.slice(0, seg.words.length - words.length);
  if (spans.some(([start, end]) => hasLiveSubstitution(command.slice(start, end)))) return false;
  if (!raw) return true;
  if (raw.includes("/") || raw.includes("$") || raw.includes("`")) return false;
  if (SAFE_COMMANDS.has(raw)) return true;
  if (raw === "git") {
    let i = 1;
    while ((words[i] ?? "").startsWith("-")) {
      if (words[i] !== "-C") return false;
      i += 2;
    }
    return SAFE_GIT.has(words[i] ?? "");
  }
  if (raw === "gh") return safeGh(words.slice(1));
  return isCheckRun(seg);
}

/**
 * 데이터로 볼 인자의 위치(words 기준, 0은 명령 이름).
 * @param {string} name
 * @param {string[]} words
 * @param {boolean} forMention
 */
function dataArgIndexes(name, words, forMention) {
  if ((forMention ? MENTION_DATA_ARGS : DATA_ARGS).has(name)) {
    return words.map((_, k) => k).slice(1);
  }
  if (name === "jq") {
    // 필터(첫 인자)와 --arg/--argjson 값만. 파일 인자는 읽는 경로라 남긴다
    const out = [];
    let filterSeen = words.some((w) => w === "-f" || w === "--from-file");
    for (let k = 1; k < words.length; k++) {
      const w = words[k] ?? "";
      if (w === "--arg" || w === "--argjson") {
        out.push(k + 1, k + 2);
        k += 2;
      } else if (!w.startsWith("-") && !filterSeen) {
        out.push(k);
        filterSeen = true;
      }
    }
    return out;
  }
  if (name === "git") {
    // git commit의 -m 메시지만. push 등 다른 하위 명령의 인자는 남긴다
    let k = 1;
    while (k < words.length && (words[k] ?? "").startsWith("-")) {
      k += ["-C", "-c", "--git-dir", "--work-tree", "--namespace"].includes(words[k] ?? "") ? 2 : 1;
    }
    if (words[k] !== "commit") return [];
    const out = [];
    for (k++; k < words.length; k++) {
      const w = words[k] ?? "";
      if (w === "--message" || /^-[a-zA-Z]*m$/.test(w)) out.push(++k);
      else if (w.startsWith("--message=") || (/^-[a-zA-Z]*m./.test(w) && !w.startsWith("--"))) {
        out.push(k);
      }
    }
    return out;
  }
  return [];
}

/**
 * 원문 정규식 검사 전에 데이터(실행되지 않는 글)를 뺀 원문을 만든다.
 * - 데이터 heredoc 본문: `cat > 파일 <<'EOF'`, `git commit -F - <<'EOF'`, `gh … --body-file - <<'EOF'`
 * - 데이터 인자: echo·printf·gh(`gh api -f body=…`)·jq·grep의 인자, `git commit -m`의 메시지(이슈 #48)
 * 남기는 것: 인터프리터·셸의 표준 입력, 파이프로 데이터 명령이 아닌 곳(`… | bash`, `… | xargs rm`)에 넘어가는 것,
 * 따옴표 없는 구분자(<<EOF) 본문과 인자의 $(…)·백틱(셸이 실행한다), $(…)·따옴표 안의 heredoc.
 * forMention(개발 역할의 보호 경로 언급 검사): 파일에 쓰는 세그먼트(나중에 스크립트로 실행될 수 있음)의 데이터는 남기고,
 * grep·rg·jq의 파일 인자처럼 읽는 경로도 남긴다.
 * @param {string} command
 * @param {{ forMention?: boolean }} [options]
 */
export function stripData(command, { forMention = false } = {}) {
  const segments = parseShell(command);
  // 모르는 명령이 하나라도 있으면 아무것도 빼지 않는다(허용 목록, QA 반려 2차 #48)
  if (!segments.every((seg) => safeSegment(seg, command))) return command;
  /** @type {[number, number][]} */
  const spans = [];
  segments.forEach((seg, index) => {
    const offset = seg.words.length - stripPrefix(seg.words).length;
    const words = seg.words.slice(offset);
    const name = basename(words[0] ?? "");
    // 보호 경로 언급 검사: 검사·테스트 실행 자신의 인자(`pnpm vitest run supabase/tests/acceptance/…`)는 보지 않는다
    if (forMention && isCheckRun(seg)) {
      for (const span of seg.wordSpans.slice(offset + 1)) spans.push(span);
      return;
    }
    const pipeline = [];
    for (let j = index + 1; j < segments.length; j++) {
      const next = /** @type {Segment} */ (segments[j]);
      if (!next.pipeIn) break;
      pipeline.push(next);
    }
    if (pipeline.some((next) => !DATA_STDIN.has(nameOf(next)))) return;
    if (forMention && writesFile([seg, ...pipeline])) return;
    if (DATA_STDIN.has(name)) {
      for (const [start, end, live] of seg.heredocSpans) if (!live) spans.push([start, end]);
    }
    for (const k of dataArgIndexes(name, words, forMention)) {
      const span = seg.wordSpans[offset + k];
      if (span && !hasLiveSubstitution(command.slice(span[0], span[1]))) spans.push(span);
    }
  });
  let out = command;
  for (const [start, end] of spans.sort((a, b) => b[0] - a[0])) {
    out = out.slice(0, start) + out.slice(end);
  }
  return out;
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
