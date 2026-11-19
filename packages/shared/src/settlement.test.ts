import { describe, expect, it } from "vitest";
import { sessionAmount } from "./settlement";

function allAmounts(pricePaid: number, totalSessions: number): number[] {
  return Array.from({ length: totalSessions }, (_, i) =>
    sessionAmount({ pricePaid, totalSessions, deductionNumber: i + 1 }),
  );
}

describe("sessionAmount (PRD STL-02)", () => {
  it("나누어떨어지면 모든 회차 금액이 같다", () => {
    expect(allAmounts(200_000, 8)).toEqual(Array(8).fill(25_000));
  });

  it("1원 미만은 버리고 남는 금액은 마지막 차감 회차에 더한다 (6회권 100,000원)", () => {
    expect(allAmounts(100_000, 6)).toEqual([16_666, 16_666, 16_666, 16_666, 16_666, 16_670]);
  });

  it.each([
    [100_000, 6],
    [99_999, 7],
    [250_000, 12],
    [1, 3],
    [55_555, 1],
  ])("회차 금액을 모두 더하면 결제 금액과 같다 (%i원, %i회)", (pricePaid, totalSessions) => {
    const sum = allAmounts(pricePaid, totalSessions).reduce((a, b) => a + b, 0);
    expect(sum).toBe(pricePaid);
  });

  it("일회권은 결제 금액 전체가 한 회차 금액이다", () => {
    expect(sessionAmount({ pricePaid: 70_000, totalSessions: 1, deductionNumber: 1 })).toBe(70_000);
  });

  it("파일럿 무료 수강권(0원)은 회차 금액이 0이다", () => {
    expect(allAmounts(0, 4)).toEqual([0, 0, 0, 0]);
  });

  it.each([
    { pricePaid: -1, totalSessions: 4, deductionNumber: 1 },
    { pricePaid: 1000.5, totalSessions: 4, deductionNumber: 1 },
    { pricePaid: 1000, totalSessions: 0, deductionNumber: 1 },
    { pricePaid: 1000, totalSessions: 4, deductionNumber: 0 },
    { pricePaid: 1000, totalSessions: 4, deductionNumber: 5 },
  ])("잘못된 입력은 오류를 낸다: %o", (input) => {
    expect(() => sessionAmount(input)).toThrow(RangeError);
  });
});
