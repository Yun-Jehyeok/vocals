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

/** 유입 경로. DB enum `enrollments_source`, `fee_policies_source`가 같은 값을 쓴다. */
export const ENROLLMENT_SOURCES = ["trainer_link", "marketplace"] as const;
export type EnrollmentSource = (typeof ENROLLMENT_SOURCES)[number];

/** 결제 수단 (PAY-01) */
export const PAYMENT_METHODS = ["card", "kakaopay", "naverpay", "tosspay"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** 결제 상태 (PAY-03, PAY-11) */
export const PAYMENT_STATUSES = ["paid", "partially_refunded", "refunded"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** 환불 요청 상태 (PAY-10, PAY-11) */
export const REFUND_REQUEST_STATUSES = ["requested", "processed"] as const;
export type RefundRequestStatus = (typeof REFUND_REQUEST_STATUSES)[number];

/** 회차 종류: 정기(고정 일정에서 생김), 일회권, 보강 (SCH-01, SCH-02, SCH-08). DB enum `lesson_sessions_kind` */
export const LESSON_SESSION_KINDS = ["regular", "single", "makeup"] as const;
export type LessonSessionKind = (typeof LESSON_SESSION_KINDS)[number];

/** 수업 방식. 1단계는 offline만 쓴다(erd 9장, online은 2단계 대비). DB enum `lesson_sessions_mode` */
export const LESSON_SESSION_MODES = ["offline", "online"] as const;
export type LessonSessionMode = (typeof LESSON_SESSION_MODES)[number];

/** 회차 상태 (SCH-06). DB enum `lesson_sessions_status` */
export const LESSON_SESSION_STATUSES = ["scheduled", "canceled"] as const;
export type LessonSessionStatus = (typeof LESSON_SESSION_STATUSES)[number];

/** 출결 상태 (ATT-01). DB enum `session_attendees_attendance` */
export const ATTENDANCE_STATUSES = ["none", "present", "absent", "pre_canceled", "makeup"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/** 사전 취소한 사람 (SCH-05, SCH-06). DB enum `session_attendees_canceled_by` */
export const CANCELED_BY = ["student", "trainer"] as const;
export type CanceledBy = (typeof CANCELED_BY)[number];

export const BUSINESS_TYPES = ["individual", "sole_proprietor", "corporation"] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export const VIDEO_PURPOSES = ["profile", "example", "practice"] as const;
export type VideoPurpose = (typeof VIDEO_PURPOSES)[number];
