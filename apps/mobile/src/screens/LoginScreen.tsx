// C-02 로그인(docs/design.md C-02 아트보드: 기본·로딩·오류). 카카오 버튼만(결정 3).
// 약관 두 낱말은 링크 모양, 누르면 "준비 중" 안내(결정 4). 카카오 창을 닫으면 오류 없이 기본 상태(결정 8).
import { useRef, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../auth/AuthProvider";
import { Icon } from "../components/Icon";
import { SocialLoginButton } from "../components/SocialLoginButton";
import { colors, fontFamilies, radii, spacing, typography } from "../theme";

type Phase = "idle" | "loading" | "error";

function showPreparing(document: string) {
  Alert.alert("준비 중이에요", `${document} 문서는 준비 중이에요.`);
}

export function LoginScreen() {
  const { signInWithKakao } = useAuth();
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>("idle");
  // 상태 반영 전에 다시 눌러도 두 번 부르지 않는다
  const busy = useRef(false);

  const onKakao = async () => {
    if (busy.current) return;
    busy.current = true;
    setPhase("loading");
    const result = await signInWithKakao();
    busy.current = false;
    // success면 로그인 상태가 바뀌어 이 화면이 내려간다
    setPhase(result === "error" ? "error" : "idle");
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 120, paddingBottom: insets.bottom + spacing.space6 },
      ]}
    >
      <View style={styles.block}>
        <Text accessibilityRole="header" style={styles.logo}>
          vocals
        </Text>
        <Text style={styles.intro}>{"숙제를 내고, 연습을 올리고,\n피드백을 받는 보컬 레슨"}</Text>
      </View>

      <View style={styles.block}>
        {phase === "error" ? (
          <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.alert}>
            <Icon name="alert-circle" color={colors.dangerInk} size={20} />
            <Text style={styles.alertText}>로그인하지 못했어요. 다시 시도해 주세요.</Text>
          </View>
        ) : null}
        <SocialLoginButton provider="kakao" loading={phase === "loading"} onPress={onKakao} />
        <Text style={styles.terms}>
          시작하면{" "}
          <Text
            accessibilityRole="link"
            style={styles.link}
            onPress={() => showPreparing("이용약관")}
          >
            이용약관
          </Text>
          과{" "}
          <Text
            accessibilityRole="link"
            style={styles.link}
            onPress={() => showPreparing("개인정보 처리방침")}
          >
            개인정보 처리방침
          </Text>
          에 동의하게 돼요.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { flexGrow: 1, justifyContent: "space-between", gap: spacing.space8 },
  block: { gap: spacing.space3, paddingHorizontal: spacing.screenX },
  // 글자 로고(로고 파일이 없어 글자로, C-02 아트보드 48/52 굵게)
  logo: {
    fontFamily: fontFamilies.bold,
    fontSize: 48,
    lineHeight: 52,
    fontWeight: "700",
    letterSpacing: -0.96,
    color: colors.ink,
  },
  intro: {
    fontFamily: fontFamilies.medium,
    fontSize: typography.title2.fontSize,
    lineHeight: typography.title2.lineHeight,
    fontWeight: "500",
    color: colors.inkMuted,
  },
  alert: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.space2,
    backgroundColor: colors.dangerSoft,
    borderRadius: radii.radiusMd,
    paddingVertical: spacing.space3,
    paddingHorizontal: spacing.space4,
  },
  alertText: { ...typography.body, color: colors.dangerInk, flex: 1 },
  terms: {
    ...typography.caption,
    color: colors.inkMuted,
    textAlign: "center",
    marginTop: spacing.space1,
  },
  link: { color: colors.ink, textDecorationLine: "underline" },
});
