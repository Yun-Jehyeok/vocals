// 앱 기본 틀 스모크 테스트(#56 개발 0단계): 실제 app/ 라우트로 첫 화면이 렌더되고 공용 패키지를 읽는다.
import { USER_ROLES } from "@vocals/shared";
import { renderRouter, screen } from "expo-router/testing-library";

describe("앱 기본 틀 스모크 (#56)", () => {
  it("app/ 라우트로 첫 화면이 렌더된다", async () => {
    await renderRouter("./app", { initialUrl: "/" });
    expect(await screen.findByText("vocals")).toBeOnTheScreen();
    expect(screen).toHavePathname("/");
  });

  it("@vocals/shared를 가져다 쓴다", () => {
    expect(USER_ROLES).toEqual(["student", "trainer", "admin"]);
  });
});
