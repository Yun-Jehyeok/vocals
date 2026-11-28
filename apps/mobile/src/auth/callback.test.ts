import { parseAuthCallback } from "./callback";

describe("로그인 뒤 돌아온 주소 해석 (#56 결정 5)", () => {
  it.each([
    ["vocals://auth/callback?code=abc", "abc"],
    ["exp://192.168.0.2:8081/--/auth/callback?code=abc&state=x", "abc"],
    ["vocals://auth/callback?code=a%2Bb%20c", "a+b c"],
    ["vocals://auth/callback#code=frag", "frag"],
  ])("%s → 코드 %s", (url, code) => {
    expect(parseAuthCallback(url)).toEqual({ kind: "code", code });
  });

  it.each([
    "vocals://auth/callback?error=access_denied&error_description=User+denied",
    "vocals://auth/callback#error=server_error",
    "vocals://auth/callback?code=abc#error_description=bad",
    "vocals://auth/callback?error_code=otp_expired",
  ])("오류가 있으면 코드가 있어도 오류: %s", (url) => {
    expect(parseAuthCallback(url)).toEqual({ kind: "error" });
  });

  it.each(["vocals://auth/callback", "vocals://auth/callback?code=", "vocals://auth/callback?x=1"])(
    "코드도 오류도 없으면 none: %s",
    (url) => {
      expect(parseAuthCallback(url)).toEqual({ kind: "none" });
    },
  );

  it("깨진 퍼센트 인코딩도 예외 없이 처리한다", () => {
    expect(parseAuthCallback("vocals://auth/callback?code=%E0%A4%A")).toEqual({
      kind: "code",
      code: "%E0%A4%A",
    });
  });
});
