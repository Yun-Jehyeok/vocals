import type { AttendanceStatus } from "./domain";

/**
 * 출결 상태가 수강권 1회를 차감하는지 (PRD ATT-02).
 * 출석·결석·보강은 차감하고, 사전 취소와 미체크는 차감하지 않는다.
 */
export function isDeducted(status: AttendanceStatus): boolean {
  switch (status) {
    case "present":
    case "absent":
    case "makeup":
      return true;
    case "pre_canceled":
    case "none":
      return false;
  }
}
