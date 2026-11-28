// 탭 미리보기(결정 1, 개발 모드 전용): 역할을 고르면 그 역할의 하단 탭 뼈대를 보여 준다.
// 역할 값은 본인인증·역할 선택 뒤에 생겨(erd 2장) 지금은 직접 고른다. 탭 안 내용은 빈 자리 표시.
import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { UserRole } from "@vocals/shared";
import { Button } from "../components/Button";
import { TabBar } from "../components/TabBar";
import { ROLE_LABELS, ROLE_TABS, ROLES } from "../navigation/roleTabs";
import { colors, spacing, typography } from "../theme";

function RoleTabs({ role }: { role: UserRole }) {
  const tabs = ROLE_TABS[role];
  const [selected, setSelected] = useState(tabs[0]?.key ?? "");
  const current = tabs.find((tab) => tab.key === selected) ?? tabs[0];
  return (
    <View style={styles.fill}>
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>
          {`${ROLE_LABELS[role]} · ${current?.label ?? ""} 탭 화면은 다음 이슈에서 만들어요.`}
        </Text>
      </View>
      <TabBar tabs={tabs} selectedKey={selected} onSelect={setSelected} />
    </View>
  );
}

export function TabPreviewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [role, setRole] = useState<UserRole | null>(null);

  return (
    <View style={[styles.fill, styles.screen]}>
      <ScrollView
        style={styles.header}
        contentContainerStyle={[styles.headerContent, { paddingTop: insets.top + spacing.space4 }]}
      >
        <Text accessibilityRole="header" style={styles.title}>
          탭 미리보기
        </Text>
        <Text style={styles.caption}>
          개발 모드에서만 보여요. 역할을 고르면 그 역할의 하단 탭이 보여요.
        </Text>
        <View style={styles.roles}>
          {ROLES.map((r) => (
            <View key={r} style={styles.role}>
              <Button
                label={ROLE_LABELS[r]}
                size="md"
                variant={r === role ? "primary" : "secondary"}
                onPress={() => setRole(r)}
              />
            </View>
          ))}
        </View>
        <Button label="닫기" variant="text" size="md" onPress={() => router.back()} />
      </ScrollView>
      {role ? <RoleTabs key={role} role={role} /> : <View style={styles.fill} />}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  screen: { backgroundColor: colors.surfaceSunken },
  header: { flexGrow: 0, backgroundColor: colors.surface },
  headerContent: {
    paddingHorizontal: spacing.screenX,
    paddingBottom: spacing.space3,
    gap: spacing.space2,
  },
  title: { ...typography.title2, color: colors.ink },
  caption: { ...typography.caption, color: colors.inkMuted },
  roles: { flexDirection: "row", gap: spacing.space2 },
  role: { flex: 1 },
  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.screenX,
  },
  placeholderText: { ...typography.body, color: colors.inkMuted, textAlign: "center" },
});
