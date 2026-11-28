// 앱 기본 틀 스모크 테스트(#56): 실제 app/ 라우트가 렌더되고 공용 패키지를 읽는다.
// 설정 값 없이 켜면 외부 연결 없이 설정 오류 화면에서 멈춘다. AsyncStorage는 jest에 네이티브 모듈이 없어 공식 대역을 쓴다.
import { USER_ROLES } from "@vocals/shared";
import { renderRouter, screen } from "expo-router/testing-library";

jest.mock("@react-native-async-storage/async-storage", () =>
  jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// 첫 렌더는 expo-router·글꼴·라우트 모듈을 처음 읽어 CI에서 기본 5초를 넘을 수 있다(#56 QA 반려). 인수 테스트와 같은 30초.
jest.setTimeout(30_000);

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
