import { StyleSheet, Text, View } from "react-native";

// 자리 표시 첫 화면(#56 개발 0단계). C-02 로그인 화면으로 바꾼다.
export default function Index() {
  return (
    <View style={styles.container}>
      <Text accessibilityRole="header">vocals</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center" },
});
