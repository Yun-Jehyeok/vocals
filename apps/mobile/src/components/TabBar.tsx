// TabBar(docs/design.md 3장): 높이 64 + safe area. 아이콘 24 + 라벨 12(micro).
// 선택: primary + 굵게, 나머지 ink-muted. 라벨만 maxFontSizeMultiplier 1.5(1장 원칙 3). 위쪽 그림자 shadow-bottom-bar.
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { TabDef } from "../navigation/roleTabs";
import { colors, shadows, sizes, spacing, typography, withWeight } from "../theme";
import { Icon } from "./Icon";

interface TabBarProps {
  tabs: readonly TabDef[];
  selectedKey: string;
  onSelect: (key: string) => void;
}

export function TabBar({ tabs, selectedKey, onSelect }: TabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.bar,
        { minHeight: sizes.tabBar + insets.bottom, paddingBottom: insets.bottom },
      ]}
    >
      {tabs.map((tab) => {
        const selected = tab.key === selectedKey;
        const tint = selected ? colors.primary : colors.inkMuted;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={tab.label}
            onPress={() => onSelect(tab.key)}
            style={styles.item}
          >
            <Icon name={tab.icon} color={tint} />
            <Text
              maxFontSizeMultiplier={1.5}
              style={[selected ? styles.labelSelected : styles.label, { color: tint }]}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    ...shadows.shadowBottomBar,
  },
  item: {
    flex: 1,
    minHeight: sizes.tabBar,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingVertical: spacing.space1,
  },
  label: { ...typography.micro, textAlign: "center" },
  labelSelected: { ...withWeight(typography.micro, "700"), textAlign: "center" },
});
