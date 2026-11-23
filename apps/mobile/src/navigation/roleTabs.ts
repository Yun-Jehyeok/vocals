// 역할별 하단 탭(docs/screens.md 1장). 이름·순서·아이콘만 정한다. 탭 안의 화면은 다음 이슈에서 만든다.
// 아이콘: 학생·트레이너 탭은 design.md 3장 아이콘 목록(home, search, music, chat, user, users, calendar)을 따른다.
// 운영자 탭(트레이너·신고·정산)은 목록에 없어 개발이 골랐다(mic, flag, credit-card) — 디자인 확인 대상.
import type { UserRole } from "@vocals/shared";
import { USER_ROLES } from "@vocals/shared";
import type { IconName } from "../components/Icon";

export interface TabDef {
  key: string;
  label: string;
  icon: IconName;
}

export const ROLE_TABS: Record<UserRole, readonly TabDef[]> = {
  student: [
    { key: "home", label: "홈", icon: "home" },
    { key: "find", label: "찾기", icon: "search" },
    { key: "lessons", label: "레슨", icon: "music" },
    { key: "chat", label: "채팅", icon: "message-circle" },
    { key: "me", label: "내 정보", icon: "user" },
  ],
  trainer: [
    { key: "home", label: "홈", icon: "home" },
    { key: "students", label: "학생", icon: "users" },
    { key: "schedule", label: "일정", icon: "calendar" },
    { key: "chat", label: "채팅", icon: "message-circle" },
    { key: "me", label: "내 정보", icon: "user" },
  ],
  admin: [
    { key: "trainers", label: "트레이너", icon: "mic" },
    { key: "reports", label: "신고", icon: "flag" },
    { key: "settlements", label: "정산", icon: "credit-card" },
    { key: "me", label: "내 정보", icon: "user" },
  ],
};

/** 화면에 쓰는 역할 이름 */
export const ROLE_LABELS: Record<UserRole, string> = {
  student: "학생",
  trainer: "트레이너",
  admin: "운영자",
};

/** 역할 순서(USER_ROLES) 그대로 */
export const ROLES: readonly UserRole[] = USER_ROLES;
