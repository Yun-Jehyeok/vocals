// Supabase 클라이언트(docs/tech-stack.md 3.12, 결정 6). 공개 URL·publishable key만 쓴다(비밀 키 금지, 3.11).
// 이 이슈(#56)는 Supabase Auth만 쓴다. DB 테이블은 읽거나 쓰지 않는다.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseConfig } from "../config";
import { encryptedStorage } from "./encryptedStorage";

let client: SupabaseClient | null = null;

/** 앱에서 하나만 만든다 */
export function getSupabase(config: SupabaseConfig): SupabaseClient {
  client ??= createClient(config.url, config.publishableKey, {
    auth: {
      storage: encryptedStorage,
      persistSession: true,
      // 갱신 타이머는 앱이 앞에 있을 때만 돈다(AuthProvider가 AppState로 시작·멈춤)
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: "pkce",
    },
  });
  return client;
}
