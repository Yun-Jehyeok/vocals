import { Redirect } from "expo-router";
import { TabPreviewScreen } from "../src/screens/TabPreviewScreen";

// 탭 미리보기(결정 1): 개발 모드에서만. 운영 번들에서는 주소로 들어와도 첫 화면으로 돌려보낸다.
export default function TabPreview() {
  if (!__DEV__) return <Redirect href="/" />;
  return <TabPreviewScreen />;
}
