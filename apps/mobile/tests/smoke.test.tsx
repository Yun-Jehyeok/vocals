// 앱 기본 틀 스모크 테스트(#56): 실제 app/ 라우트가 렌더되고 공용 패키지를 읽는다.
// 설정 값 없이 켜면 외부 연결 없이 설정 오류 화면에서 멈춘다. AsyncStorage는 jest에 네이티브 모듈이 없어 공식 대역을 쓴다.
import { USER_ROLES } from "@vocals/shared";
import { renderRouter, screen } from "expo-router/testing-library";

jest.mock("@react-native-async-storage/async-storage", () =>
  jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

describe("앱 기본 틀 스모크 (#56)", () => {
  it("app/ 라우트로 첫 화면이 렌더된다(설정 값이 없으면 설정 오류 화면)", async () => {
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    await renderRouter("./app", { initialUrl: "/" });
    expect(await screen.findByText("설정 값이 없어요")).toBeOnTheScreen();
    expect(screen).toHavePathname("/");
  });

  it("@vocals/shared를 가져다 쓴다", () => {
    expect(USER_ROLES).toEqual(["student", "trainer", "admin"]);
  });
});
