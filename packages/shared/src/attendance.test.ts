import { describe, expect, it } from "vitest";
import { isDeducted } from "./attendance";

describe("isDeducted (PRD ATT-02)", () => {
  it.each(["present", "absent", "makeup"] as const)("%s은 수강권을 차감한다", (status) => {
    expect(isDeducted(status)).toBe(true);
  });

  it.each(["pre_canceled", "none"] as const)("%s은 수강권을 차감하지 않는다", (status) => {
    expect(isDeducted(status)).toBe(false);
  });
});
