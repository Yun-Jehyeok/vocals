import {
  NotoSansKR_400Regular,
  NotoSansKR_500Medium,
  NotoSansKR_700Bold,
  useFonts,
} from "@expo-google-fonts/noto-sans-kr";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "../src/auth/AuthProvider";
import { colors, fontFamilies } from "../src/theme";

// 글꼴과 세션 확인이 끝날 때까지 스플래시를 유지한다(결정 2)
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

function HideSplashWhenReady() {
  const { state } = useAuth();
  const ready = state.status !== "loading";
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);
  return null;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    [fontFamilies.regular]: NotoSansKR_400Regular,
    [fontFamilies.medium]: NotoSansKR_500Medium,
    [fontFamilies.bold]: NotoSansKR_700Bold,
  });
  // 글꼴을 못 불러와도 앱은 연다(기본 글꼴로 보인다)
  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <HideSplashWhenReady />
        <StatusBar style="dark" />
        <Stack
          screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }}
        />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
