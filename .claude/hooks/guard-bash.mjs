// PreToolUse(Bash): 되돌리기 어려운 명령을 막는다. 종료 코드 2 = 차단.
import { readFileSync } from "node:fs";

const input = JSON.parse(readFileSync(0, "utf8") || "{}");
const command = String(input?.tool_input?.command ?? "");

const rules = [
  {
    test: /\bgit\b[^\n;&|]*\bpush\b[^\n;&|]*\s(--force(?!-with-lease)|-f)(?=\s|$)/,
    reason: "강제 push(--force)는 금지다. 기록을 덮어쓰면 되돌리기 어렵다.",
  },
  {
    test: /\bgit\b[^\n;&|]*\bpush\b[^\n;&|]*[\s:](refs\/heads\/)?main(?![\w./-])/,
    reason: "main에 직접 push하지 않는다. 브랜치를 만들고 PR을 연다.",
  },
  {
    test: /\bsupabase\s+db\s+reset\b[^\n;&|]*--linked/,
    reason: "연결된(원격) Supabase DB 초기화는 금지다. 데이터가 모두 지워진다.",
  },
];

for (const rule of rules) {
  if (rule.test.test(command)) {
    process.stderr.write(`차단됨: ${rule.reason}\n명령: ${command}\n`);
    process.exit(2);
  }
}
process.exit(0);
