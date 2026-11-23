// 디자인 토큰(docs/design.md 2장). 표의 토큰 이름을 camelCase로 옮겼다(예: primary-pressed → primaryPressed).
// 값을 바꾸려면 docs/design.md를 먼저 고친다(디자인 담당).

/** 2.1 색(라이트 테마) */
export const colors = {
  primary: "#5B3FD0",
  primaryPressed: "#4A31B0",
  primarySoft: "#EFEBFC",
  onPrimary: "#FFFFFF",
  ink: "#18161D",
  inkMuted: "#5C5866",
  inkDisabled: "#A19CA8",
  surface: "#FFFFFF",
  surfaceSunken: "#F6F5F8",
  line: "#E6E3EA",
  lineControl: "#8C8794",
  successSoft: "#E3F5EB",
  successInk: "#1B6B43",
  warningSoft: "#FFF1DB",
  warningInk: "#8A4B00",
  danger: "#C9302C",
  dangerSoft: "#FDECEA",
  dangerInk: "#A3221F",
  neutralSoft: "#EEECF1",
  videoBg: "#1E1B24",
  scrim: "rgba(24,22,29,0.64)",
  skeleton: "#ECEAF0",
  sheetScrim: "rgba(24,22,29,0.48)",
  kakaoBg: "#FEE500",
  kakaoInk: "#191919",
  appleBg: "#000000",
  googleLine: "#747775",
  googleInk: "#1F1F1F",
} as const;

/**
 * 2.2 글꼴: Noto Sans KR 400·500·700. 굵기마다 글꼴 파일이 달라 fontFamily를 굵기별로 둔다
 * (app/_layout.tsx에서 같은 이름으로 불러온다).
 */
export const fontFamilies = {
  regular: "NotoSansKR_400Regular",
  medium: "NotoSansKR_500Medium",
  bold: "NotoSansKR_700Bold",
} as const;

type Weight = "400" | "500" | "700";
const FAMILY_BY_WEIGHT: Record<Weight, string> = {
  "400": fontFamilies.regular,
  "500": fontFamilies.medium,
  "700": fontFamilies.bold,
};

function textStyle(fontSize: number, lineHeight: number, fontWeight: Weight) {
  return { fontFamily: FAMILY_BY_WEIGHT[fontWeight], fontSize, lineHeight, fontWeight } as const;
}

/** 2.2 글자 스타일 */
export const typography = {
  display: textStyle(26, 34, "700"),
  title1: textStyle(22, 30, "700"),
  title2: textStyle(18, 26, "700"),
  body: textStyle(16, 24, "400"),
  bodyStrong: textStyle(16, 24, "700"),
  label: textStyle(14, 20, "500"),
  caption: textStyle(13, 18, "400"),
  micro: textStyle(12, 16, "500"),
} as const;

/** 같은 크기에서 굵기만 바꿀 때(예: 선택된 탭 라벨) */
export function withWeight<T extends { fontSize: number }>(style: T, fontWeight: Weight) {
  return { ...style, fontWeight, fontFamily: FAMILY_BY_WEIGHT[fontWeight] };
}

/** 2.3 간격 */
export const spacing = {
  space1: 4,
  space2: 8,
  space3: 12,
  space4: 16,
  screenX: 20,
  space6: 24,
  space8: 32,
  space10: 40,
} as const;

/** 2.4 크기 */
export const sizes = {
  touchMin: 48,
  buttonLg: 52,
  buttonMd: 48,
  appBar: 56,
  tabBar: 64,
  listItemMin: 64,
  avatarSm: 40,
  avatarLg: 80,
  icon: 24,
  playButton: 56,
} as const;

/** 2.5 모서리 */
export const radii = {
  radiusSm: 6,
  radiusMd: 10,
  radiusLg: 16,
  radiusFull: 999,
} as const;

/** 2.6 그림자(CSS 값을 iOS shadow*·Android elevation으로 옮김) */
export const shadows = {
  shadowBottomBar: {
    shadowColor: "#18161D",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 8,
  },
  shadowPlay: {
    shadowColor: "#18161D",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.24,
    shadowRadius: 8,
    elevation: 4,
  },
} as const;
