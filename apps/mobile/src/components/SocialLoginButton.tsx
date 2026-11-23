// SocialLoginButton(docs/design.md 3장, C-02 아트보드): 높이 52 꽉 채움, 모서리 10, 글자 body-strong.
// 이번에는 카카오만(결정 3). 로딩은 누른 버튼 안에 스피너 + "로그인하는 중…"(C-02 로딩).
// 공식 로고 자리(20×20)는 로고 파일이 들어오면 채운다(design 5장 "로그인 버튼 로고").
import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";
import { colors, radii, sizes, spacing, typography } from "../theme";

const PROVIDERS = {
  kakao: { label: "카카오로 시작하기", background: colors.kakaoBg, ink: colors.kakaoInk },
} as const;

interface SocialLoginButtonProps {
  provider: keyof typeof PROVIDERS;
  onPress: () => void;
  loading?: boolean;
}

export function SocialLoginButton({ provider, onPress, loading = false }: SocialLoginButtonProps) {
  const { label, background, ink } = PROVIDERS[provider];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled: loading }}
      disabled={loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: background, borderColor: background },
        pressed && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator accessibilityLabel="불러오는 중" color={ink} size="small" />
      ) : null}
      <Text style={[styles.label, { color: ink }]}>{loading ? "로그인하는 중…" : label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.space2,
    minHeight: sizes.buttonLg,
    width: "100%",
    borderRadius: radii.radiusMd,
    borderWidth: 1,
    paddingHorizontal: spacing.space4,
    paddingVertical: spacing.space2,
  },
  label: { ...typography.bodyStrong, textAlign: "center" },
  pressed: { opacity: 0.85 },
});
