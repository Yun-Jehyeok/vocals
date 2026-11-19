export interface SessionAmountInput {
  /** 수강권 결제 금액(원). 파일럿 무료 수강권은 0. */
  pricePaid: number;
  /** 수강권 총 횟수. */
  totalSessions: number;
  /** 이번 차감이 그 수강권의 몇 번째 차감인지 (1부터 시작). */
  deductionNumber: number;
}

function assertNonNegativeInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name}는 0 이상의 정수여야 한다: ${value}`);
  }
}

/**
 * 차감된 회차 하나의 정산용 금액 (PRD STL-02).
 * 결제 금액 ÷ 총 횟수에서 1원 미만을 버리고, 남는 금액은 마지막 차감 회차에 더한다.
 * 그래서 한 수강권의 회차 금액을 모두 더하면 결제 금액과 같다.
 */
export function sessionAmount({
  pricePaid,
  totalSessions,
  deductionNumber,
}: SessionAmountInput): number {
  assertNonNegativeInteger("pricePaid", pricePaid);
  assertNonNegativeInteger("totalSessions", totalSessions);
  assertNonNegativeInteger("deductionNumber", deductionNumber);
  if (totalSessions < 1) {
    throw new RangeError("totalSessions는 1 이상이어야 한다");
  }
  if (deductionNumber < 1 || deductionNumber > totalSessions) {
    throw new RangeError(
      `deductionNumber는 1 이상 ${totalSessions} 이하여야 한다: ${deductionNumber}`,
    );
  }

  const base = Math.floor(pricePaid / totalSessions);
  const remainder = pricePaid - base * totalSessions;
  return deductionNumber === totalSessions ? base + remainder : base;
}
