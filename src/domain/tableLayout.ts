import type { TableSeatLayout } from "./pokerTypes";

export type SeatPositionPercent = {
  leftPercent: number;
  topPercent: number;
};

export function getSeatPositionPercent(
  index: number,
  count: number,
  layout: TableSeatLayout
): SeatPositionPercent {
  const safeCount = Math.max(count, 1);
  const step = 360 / safeCount;
  const shouldOffset = layout === "top_bottom" && safeCount % 2 === 0;
  const angle = -90 + step * index - (shouldOffset ? step / 2 : 0);
  const radians = (angle * Math.PI) / 180;

  return {
    leftPercent: 50 + Math.cos(radians) * 41,
    topPercent: 50 + Math.sin(radians) * 37
  };
}
