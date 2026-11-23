// 로그인 상태(결정 2·6): 세션 확인 중 → loading(스플래시 유지), 설정 값 없음 → configMissing,
// 세션 없음 → signedOut(C-02), 세션 있음 → signedIn("가입 이어서 하기" 자리 표시).
// 세션·토큰·사용자 정보는 상태에 두지 않고 로그인 수단(provider)만 꺼낸다. 로그에도 남기지 않는다.
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";
import { readSupabaseConfig } from "../config";
import type { SignInResult } from "./kakao";
import { signInWithKakao } from "./kakao";
import { getSupabase } from "./supabase";

export type AuthState =
  | { status: "configMissing" }
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "signedIn"; provider: string | null };

interface AuthContextValue {
  state: AuthState;
  signInWithKakao: () => Promise<SignInResult>;
  /** 성공하면 true(상태는 signedOut으로 바뀐다) */
  signOut: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function stateOf(session: Session | null): AuthState {
  if (!session) return { status: "signedOut" };
  const provider = session.user.app_metadata.provider;
  return { status: "signedIn", provider: typeof provider === "string" ? provider : null };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useMemo<SupabaseClient | null>(() => {
    const config = readSupabaseConfig();
    return config ? getSupabase(config) : null;
  }, []);
  const [state, setState] = useState<AuthState>(
    client ? { status: "loading" } : { status: "configMissing" },
  );

  // 저장된 세션 확인(INITIAL_SESSION)과 로그인·로그아웃을 한곳에서 받는다
  useEffect(() => {
    if (!client) return;
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      setState(stateOf(session));
    });
    return () => data.subscription.unsubscribe();
  }, [client]);

  // 토큰 자동 갱신은 앱이 앞에 있을 때만(결정 6)
  useEffect(() => {
    if (!client) return;
    if (AppState.currentState === "active") void client.auth.startAutoRefresh();
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") void client.auth.startAutoRefresh();
      else void client.auth.stopAutoRefresh();
    });
    return () => {
      subscription.remove();
      void client.auth.stopAutoRefresh();
    };
  }, [client]);

  const signIn = useCallback(async (): Promise<SignInResult> => {
    if (!client) return "error";
    return signInWithKakao(client);
  }, [client]);

  const signOut = useCallback(async (): Promise<boolean> => {
    if (!client) return false;
    try {
      // 이 기기의 세션만 끝낸다(다른 기기의 로그인은 그대로)
      const { error } = await client.auth.signOut({ scope: "local" });
      return !error;
    } catch {
      return false;
    }
  }, [client]);

  const value = useMemo(
    () => ({ state, signInWithKakao: signIn, signOut }),
    [state, signIn, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider 안에서 써야 합니다");
  return value;
}
