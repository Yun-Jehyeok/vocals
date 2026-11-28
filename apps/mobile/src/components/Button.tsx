// Button(docs/design.md 3장): primary(화면당 하나) · secondary · text. 높이 52(lg)/48(md), 모서리 10, 글자 body-strong.
// 누르면 primary는 primary-pressed, 나머지는 투명도 0.85(5장 누름 피드백).
import { Pressable, StyleSheet, Text } from "react-native";
import { colors, radii, sizes, spacing, typography } from "../theme";

export type ButtonVariant = "primary" | "secondary" | "text";

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: "lg" | "md";
  disabled?: boolean;
}

export function Button({
  label,
  onPress,
  variant = "primary",
  size = "lg",
  disabled = false,
}: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        { minHeight: size === "lg" ? sizes.buttonLg : sizes.buttonMd },
        disabled ? styles.disabled : containerStyles[variant],
        pressed && !disabled && (variant === "primary" ? styles.primaryPressed : styles.pressed),
      ]}
    >
      <Text style={[styles.label, { color: disabled ? colors.inkDisabled : labelColors[variant] }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const labelColors: Record<ButtonVariant, string> = {
  primary: colors.onPrimary,
  secondary: colors.ink,
  text: colors.primary,
};

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.radiusMd,
    paddingHorizontal: spacing.space4,
    paddingVertical: spacing.space2,
  },
  label: { ...typography.bodyStrong, textAlign: "center" },
  disabled: { backgroundColor: colors.surfaceSunken, borderWidth: 1, borderColor: colors.line },
  primaryPressed: { backgroundColor: colors.primaryPressed },
  pressed: { opacity: 0.85 },
});

const containerStyles = StyleSheet.create({
  primary: { backgroundColor: colors.primary },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineControl },
  text: { backgroundColor: "transparent" },
});
