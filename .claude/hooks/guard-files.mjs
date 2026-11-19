// PreToolUse(Edit|MultiEdit|Write): 건드리면 안 되는 파일을 막는다. 종료 코드 2 = 차단.
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";

const input = JSON.parse(readFileSync(0, "utf8") || "{}");
const tool = String(input?.tool_name ?? "");
const filePath = String(input?.tool_input?.file_path ?? "");
const name = basename(filePath);

function block(reason) {
  process.stderr.write(`차단됨: ${reason}\n파일: ${filePath}\n`);
  process.exit(2);
}

// 비밀 값 파일은 사람이 직접 관리한다. 예시 파일(.env.example)만 허용.
if (/^\.env(\..+)?$/.test(name) && name !== ".env.example") {
  block(".env 파일은 수정하지 않는다. 필요한 값은 .env.example에 키 이름만 적고 사람에게 알린다.");
}

// 이미 적용됐을 수 있는 마이그레이션은 고치지 않고 새 마이그레이션을 만든다.
if (/[\\/]supabase[\\/]migrations[\\/]/.test(filePath)) {
  const editsExisting = tool === "Edit" || tool === "MultiEdit" || existsSync(filePath);
  if (editsExisting) {
    block("기존 마이그레이션 파일은 고치지 않는다. 변경 사항은 새 마이그레이션 파일로 만든다.");
  }
}

process.exit(0);
