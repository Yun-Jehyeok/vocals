// 설정 값(Supabase 주소·publishable key)이 없을 때. 대체 값 없이 멈추고 로그인 버튼을 그리지 않는다(CLAUDE.md: mock 금지).
import { ScrollView, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StateView } from "../components/StateView";
import { colors } from "../theme";

export function ConfigMissingScreen() {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingTop: insets.top }}>
      <StateView
        icon="alert-circle"
        tone="danger"
        title="설정 값이 없어요"
        description="Supabase 프로젝트 주소와 publishable key가 없어 앱을 시작할 수 없어요. apps/mobile/README.md대로 .env를 만든 뒤 개발 서버를 다시 켜 주세요."
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
});
