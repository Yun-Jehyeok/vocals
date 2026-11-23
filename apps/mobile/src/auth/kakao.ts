// 카카오 로그인(결정 5·8, docs/tech-stack.md 3.12):
// signInWithOAuth(PKCE, 브라우저 자동 이동 끔) → 기기 웹 인증 세션 → 앱 scheme 주소로 돌아와 코드를 세션으로 바꾼다.
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeRedirectUri } from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { APP_SCHEME, AUTH_CALLBACK_PATH } from "../config";
import { parseAuthCallback } from "./callback";

/** success: 세션 저장됨 · cancel: 사용자가 창을 닫음(오류 아님, 결정 8) · error: 그 밖의 실패 */
export type SignInResult = "success" | "cancel" | "error";

export async function signInWithKakao(client: SupabaseClient): Promise<SignInResult> {
  try {
    const redirectTo = makeRedirectUri({ scheme: APP_SCHEME, path: AUTH_CALLBACK_PATH });
    const { data, error } = await client.auth.signInWithOAuth({
      provider: "kakao",
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error || !data.url) return "error";

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type === "cancel" || result.type === "dismiss") return "cancel";
    if (result.type !== "success") return "error";

    const callback = parseAuthCallback(result.url);
    if (callback.kind !== "code") return "error";
    const exchanged = await client.auth.exchangeCodeForSession(callback.code);
    return exchanged.error ? "error" : "success";
  } catch {
    return "error";
  }
}
