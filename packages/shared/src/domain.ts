/**
 * 도메인 enum 값. docs/erd.md의 영문 이름을 그대로 쓴다.
 * 이름을 바꾸려면 docs/erd.md를 먼저 고친다.
 */

export const USER_ROLES = ["student", "trainer", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ["active", "withdrawn"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/**
 * 로그인 수단. Supabase Auth의 provider 이름과 같다.
 * 로그인 수단은 Supabase Auth(auth.identities)가 저장하므로 DB enum은 없다.
 */
export const AUTH_PROVIDERS = ["kakao", "google", "apple"] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

export const TRAINER_APPROVAL_STATUSES = ["pending", "approved", "rejected", "suspended"] as const;
export type TrainerApprovalStatus = (typeof TRAINER_APPROVAL_STATUSES)[number];

export const LESSON_TYPES = ["private", "group"] as const;
export type LessonType = (typeof LESSON_TYPES)[number];

export const TICKET_TYPES = ["regular", "single"] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

export const TICKET_STATUSES = ["waiting_schedule", "active", "ended"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_END_REASONS = ["used_up", "expired", "refunded"] as const;
export type TicketEndReason = (typeof TICKET_END_REASONS)[number];

export const ENROLLMENT_SOURCES = ["trainer_link", "marketplace"] as const;
export type EnrollmentSource = (typeof ENROLLMENT_SOURCES)[number];

export const ATTENDANCE_STATUSES = ["none", "present", "absent", "pre_canceled", "makeup"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const BUSINESS_TYPES = ["individual", "sole_proprietor", "corporation"] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export const VIDEO_PURPOSES = ["profile", "example", "practice"] as const;
export type VideoPurpose = (typeof VIDEO_PURPOSES)[number];
