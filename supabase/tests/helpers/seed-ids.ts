/** supabase/seed.sql의 더미 사용자 id */
export const SEED = {
  student1: "00000000-0000-4000-8000-000000000001",
  student2: "00000000-0000-4000-8000-000000000002",
  /** approved, listed, individual */
  trainerApproved: "00000000-0000-4000-8000-000000000011",
  /** approved, listed = false, sole_proprietor */
  trainerUnlisted: "00000000-0000-4000-8000-000000000012",
  /** approved, is_pilot = true */
  trainerPilot: "00000000-0000-4000-8000-000000000013",
  trainerPending: "00000000-0000-4000-8000-000000000014",
  /** rejected, corporation */
  trainerRejected: "00000000-0000-4000-8000-000000000015",
  trainerSuspended: "00000000-0000-4000-8000-000000000016",
  admin: "00000000-0000-4000-8000-000000000099",
} as const;

export const ALL_SEED_USER_IDS: readonly string[] = Object.values(SEED);

export const APPROVED_TRAINER_IDS: readonly string[] = [
  SEED.trainerApproved,
  SEED.trainerUnlisted,
  SEED.trainerPilot,
];

export const ALL_TRAINER_IDS: readonly string[] = [
  ...APPROVED_TRAINER_IDS,
  SEED.trainerPending,
  SEED.trainerRejected,
  SEED.trainerSuspended,
];

/** 테스트에서 새로 만드는 사용자 id (seed와 겹치지 않는다) */
export const NEW_USER_ID = "00000000-0000-4000-8000-0000000000a1";

/** 본인인증 결과가 있는 사용자 (운영자 제외, AUTH-03) */
export const VERIFIED_USER_IDS: readonly string[] = ALL_SEED_USER_IDS.filter(
  (id) => id !== SEED.admin,
);
