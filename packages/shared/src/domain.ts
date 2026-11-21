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

/** 영상 용도 (HW-04, HW-06, TRN-07). DB enum `videos_purpose` */
export const VIDEO_PURPOSES = ["profile", "example", "practice"] as const;
export type VideoPurpose = (typeof VIDEO_PURPOSES)[number];

/** 영상 업로드 상태 (HW-09). DB enum `videos_upload_status`. 서버(업로드 완료 처리)가 바꾼다 */
export const VIDEO_UPLOAD_STATUSES = ["uploading", "ready", "failed"] as const;
export type VideoUploadStatus = (typeof VIDEO_UPLOAD_STATUSES)[number];

/** 영상 공개 범위 (HW-12). DB enum `videos_visibility`. 1단계는 private만(erd 9장) */
export const VIDEO_VISIBILITIES = ["private"] as const;
export type VideoVisibility = (typeof VIDEO_VISIBILITIES)[number];

/** 영상 최대 길이(초) (HW-08, TRN-07: 5분). DB 제약 `videos_duration_sec_check`와 같다 */
export const MAX_VIDEO_DURATION_SEC = 300;

/** 채팅방 종류: 단체 채팅방(트레이너당 하나), 1:1 대화 (CHAT-01, DM-01). DB enum `chat_rooms_type` */
export const CHAT_ROOM_TYPES = ["group", "direct"] as const;
export type ChatRoomType = (typeof CHAT_ROOM_TYPES)[number];

/** 채팅방 참여 역할. 단체 채팅방의 트레이너만 admin (CHAT-06). DB enum `chat_members_member_role` */
export const CHAT_MEMBER_ROLES = ["admin", "member"] as const;
export type ChatMemberRole = (typeof CHAT_MEMBER_ROLES)[number];

/** 채팅방을 나간 이유: 스스로, 내보내짐, 수강권 종료 (CHAT-03, CHAT-06). DB enum `chat_members_left_reason` */
export const CHAT_MEMBER_LEFT_REASONS = ["self", "kicked", "ticket_ended"] as const;
export type ChatMemberLeftReason = (typeof CHAT_MEMBER_LEFT_REASONS)[number];

/** 메시지 종류: 텍스트·사진만 (CHAT-05, DM-04). DB enum `messages_kind` */
export const MESSAGE_KINDS = ["text", "image"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/** 신고 대상 (CHAT-07, DM-05, REV-05). DB enum `reports_target_type` */
export const REPORT_TARGET_TYPES = ["message", "review", "user"] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

/** 신고 처리 상태 (ADM-04). DB enum `reports_status` */
export const REPORT_STATUSES = ["open", "resolved"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** 푸시 기기 플랫폼 (NOTI-01). DB enum `push_tokens_platform` */
export const PUSH_TOKEN_PLATFORMS = ["ios", "android"] as const;
export type PushTokenPlatform = (typeof PUSH_TOKEN_PLATFORMS)[number];
