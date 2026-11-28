// 소셜 로그인 뒤 앱으로 돌아온 주소 해석(결정 5). 예:
//   vocals://auth/callback?code=…           (개발용 빌드·출시 앱)
//   exp://192.168.0.2:8081/--/auth/callback?code=…   (Expo Go)
//   …?error=access_denied&error_description=…         (거절·실패. 오류 내용은 화면에 보여 주지 않는다)
// Supabase는 오류를 주소 뒤 # 쪽에 붙이기도 해서 ?와 # 양쪽을 본다.

export type AuthCallback = { kind: "code"; code: string } | { kind: "error" } | { kind: "none" };

function decode(part: string): string {
  try {
    return decodeURIComponent(part.replace(/\+/g, " "));
  } catch {
    return part;
  }
}

function params(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const pair of text.split("&")) {
    if (!pair) continue;
    const at = pair.indexOf("=");
    const name = decode(at === -1 ? pair : pair.slice(0, at));
    if (!out.has(name)) out.set(name, at === -1 ? "" : decode(pair.slice(at + 1)));
  }
  return out;
}

export function parseAuthCallback(url: string): AuthCallback {
  const hashAt = url.indexOf("#");
  const beforeHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : url.slice(hashAt + 1);
  const queryAt = beforeHash.indexOf("?");
  const query = queryAt === -1 ? "" : beforeHash.slice(queryAt + 1);

  const all = [params(query), params(hash)];
  if (all.some((p) => p.has("error") || p.has("error_code") || p.has("error_description"))) {
    return { kind: "error" };
  }
  for (const p of all) {
    const code = p.get("code");
    if (code) return { kind: "code", code };
  }
  return { kind: "none" };
}
