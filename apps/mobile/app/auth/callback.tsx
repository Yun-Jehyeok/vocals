import { Redirect } from "expo-router";

// 로그인 뒤 돌아오는 주소(vocals://auth/callback, Expo Go는 exp://…/--/auth/callback).
// 코드 교환은 웹 인증 세션의 결과로 src/auth/kakao.ts가 한다. 딥링크로 이 경로가 열리면 첫 화면으로 돌려보낸다.
export default function AuthCallback() {
  return <Redirect href="/" />;
}
