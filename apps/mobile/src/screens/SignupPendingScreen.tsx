// 로그인 뒤 자리 표시 "가입 이어서 하기"(결정 1, AUTH-03 자리 표시까지만).
// 로그인 수단만 보여 주고 닉네임·이메일·사용자 id는 보여 주지 않는다. 탭 미리보기는 개발 모드에서만.
import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../auth/AuthProvider";
import { Button } from "../components/Button";
import { StateView } from "../components/StateView";
import { colors, radii, spacing, typography } from "../theme";

const PROVIDER_NAMES: Record<string, string> = {
  kakao: "카카오",
  apple: "Apple",
  google: "Google",
};

export function providerLabel(provider: string | null): string {
  const name = provider ? PROVIDER_NAMES[provider] : undefined;
  return name ? `${name}로 로그인됨` : "로그인됨";
}

export function SignupPendingScreen({ provider }: { provider: string | null }) {
  const { signOut } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [signingOut, setSigningOut] = useState(false);
  const [failed, setFailed] = useState(false);

  const onSignOut = async () => {
    setSigningOut(true);
    setFailed(false);
    const ok = await signOut();
    // 성공하면 로그인 상태가 바뀌어 C-02로 간다
    if (!ok) {
      setSigningOut(false);
      setFailed(true);
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{
        paddingTop: insets.top,
        paddingBottom: insets.bottom + spacing.space6,
      }}
    >
      <StateView
        icon="user-check"
        tone="primary"
        eyebrow={<Text style={styles.provider}>{providerLabel(provider)}</Text>}
        title="가입 이어서 하기"
        description="본인인증은 준비 중이에요. 준비되면 여기서 가입을 이어서 할 수 있어요."
      >
        {failed ? (
          <Text accessibilityRole="alert" style={styles.error}>
            로그아웃하지 못했어요. 다시 시도해 주세요.
          </Text>
        ) : null}
        <Button label="로그아웃" variant="secondary" disabled={signingOut} onPress={onSignOut} />
        {__DEV__ ? (
          <Button label="탭 미리보기" variant="text" onPress={() => router.push("/tab-preview")} />
        ) : null}
      </StateView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  provider: {
    ...typography.label,
    color: colors.primaryPressed,
    backgroundColor: colors.primarySoft,
    borderRadius: radii.radiusSm,
    overflow: "hidden",
    paddingHorizontal: spacing.space2,
    paddingVertical: spacing.space1,
  },
  error: { ...typography.body, color: colors.dangerInk, textAlign: "center" },
});
