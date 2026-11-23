import { View } from "react-native";
import { useAuth } from "../src/auth/AuthProvider";
import { ConfigMissingScreen } from "../src/screens/ConfigMissingScreen";
import { LoginScreen } from "../src/screens/LoginScreen";
import { SignupPendingScreen } from "../src/screens/SignupPendingScreen";
import { colors } from "../src/theme";

// 첫 화면 분기(결정 2, screens 1장): 세션 확인 중 스플래시 → 로그인 안 됨 C-02 / 됨 "가입 이어서 하기"
export default function Index() {
  const { state } = useAuth();
  switch (state.status) {
    case "loading":
      return <View style={{ flex: 1, backgroundColor: colors.surface }} />;
    case "configMissing":
      return <ConfigMissingScreen />;
    case "signedOut":
      return <LoginScreen />;
    case "signedIn":
      return <SignupPendingScreen provider={state.provider} />;
  }
}
