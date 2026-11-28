// StateView(docs/design.md 3장): 아이콘 원 64 + 제목(title-2) + 설명(body, ink-muted) + 버튼.
// 빈 화면 inbox, 오류 alert(danger-soft), 권한 없음 lock. 위쪽 여백 space-10(2.3).
import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, radii, spacing, typography } from "../theme";
import type { IconName } from "./Icon";
import { Icon } from "./Icon";

const TONES = {
  neutral: { background: colors.neutralSoft, ink: colors.inkMuted },
  primary: { background: colors.primarySoft, ink: colors.primaryPressed },
  danger: { background: colors.dangerSoft, ink: colors.dangerInk },
} as const;

interface StateViewProps {
  icon: IconName;
  tone?: keyof typeof TONES;
  title: string;
  description?: string;
  /** 제목 위 짧은 안내(예: 로그인 수단) */
  eyebrow?: ReactNode;
  /** 버튼들 */
  children?: ReactNode;
}

export function StateView({
  icon,
  tone = "neutral",
  title,
  description,
  eyebrow,
  children,
}: StateViewProps) {
  const { background, ink } = TONES[tone];
  return (
    <View style={styles.container}>
      <View style={[styles.iconCircle, { backgroundColor: background }]}>
        <Icon name={icon} color={ink} />
      </View>
      {eyebrow}
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
      {children ? <View style={styles.actions}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    gap: spacing.space3,
    paddingTop: spacing.space10,
    paddingHorizontal: spacing.screenX,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: radii.radiusFull,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { ...typography.title2, color: colors.ink, textAlign: "center" },
  description: { ...typography.body, color: colors.inkMuted, textAlign: "center" },
  actions: { alignSelf: "stretch", gap: spacing.space3, marginTop: spacing.space3 },
});
