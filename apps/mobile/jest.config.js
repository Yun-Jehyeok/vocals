// 앱 테스트 실행기(#56). 범위를 줄이면 테스트가 조용히 빠지므로 하네스 파일이다(scripts/check-harness-change.ts).
// 인수 테스트(tests/acceptance/, QA 담당)도 여기서 돈다.
module.exports = {
  preset: "jest-expo",
  testMatch: ["<rootDir>/{app,src,tests}/**/*.test.{ts,tsx}"],
};
