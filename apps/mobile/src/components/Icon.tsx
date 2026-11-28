// 선 아이콘(docs/design.md 3장 "아이콘": 24px, 선 굵기 2의 둥근 선 아이콘). Feather 세트를 쓴다(lucide의 원형).
// 장식이라 스크린 리더에는 읽히지 않게 한다. 버튼 이름에 섞이지 않게 버튼 안에는 넣지 않는다.
import Feather from "@expo/vector-icons/Feather";
import type { ComponentProps } from "react";
import { sizes } from "../theme";

export type IconName = ComponentProps<typeof Feather>["name"];

export function Icon({
  name,
  color,
  size = sizes.icon,
}: {
  name: IconName;
  color: string;
  size?: number;
}) {
  return (
    <Feather
      name={name}
      size={size}
      color={color}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
