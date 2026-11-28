// 앱 설정 값(docs/tech-stack.md 3.12). 공개 값 두 개만 읽는다. 없으면 대체 값 없이 null(CLAUDE.md: mock 금지).
// Expo는 `process.env.EXPO_PUBLIC_…`를 점 표기로 직접 쓴 곳만 빌드 때 값으로 바꾸므로 구조 분해하지 않는다.

export interface SupabaseConfig {
  url: string;
  publishableKey: string;
}

/** 두 값이 모두 있으면 설정, 하나라도 없거나 빈 문자열이면 null */
export function readSupabaseConfig(): SupabaseConfig | null {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}

/** 앱 scheme과 로그인 뒤 돌아오는 경로(결정 5: vocals://auth/callback) */
export const APP_SCHEME = "vocals";
export const AUTH_CALLBACK_PATH = "auth/callback";
