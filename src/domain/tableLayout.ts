import type { TableSeatLayout } from "./pokerTypes";

export type SeatPositionPercent = {
  leftPercent: number;
  topPercent: number;
};

export type TableSeatSlot = SeatPositionPercent & {
  seatIndex: number;
};

export type TableLayoutOptions = {
  includeCornerSeats: boolean;
};

const MAX_SEAT_SLOTS = 12;

const RECT_LEFT = 9;
const RECT_RIGHT = 91;
const RECT_TOP = 13;
const RECT_BOTTOM = 87;
const RECT_CENTER = 50;
const RECT_TOP_THIRD = 36;
const RECT_TOP_TWO_THIRD = 64;
const RECT_RIGHT_UPPER = 38;
const RECT_RIGHT_LOWER = 62;

export function getAutoSeatSlotCount(activePlayerCount: number): number {
  return Math.min(
    MAX_SEAT_SLOTS,
    Math.max(2, Math.ceil((activePlayerCount + 1) / 2) * 2)
  );
}

export function getSeatPositionPercent(
  index: number,
  count: number,
  layout: TableSeatLayout
): SeatPositionPercent {
  const safeCount = Math.max(count, 1);
  const step = 360 / safeCount;
  const shouldOffset =
    (layout === "top_bottom" || layout === "round") && safeCount % 2 === 0;
  const angle = -90 + step * index - (shouldOffset ? step / 2 : 0);
  const radians = (angle * Math.PI) / 180;
  const radiusX = layout === "round" ? 38 : 41;
  const radiusY = layout === "round" ? 38 : 37;

  return {
    leftPercent: 50 + Math.cos(radians) * radiusX,
    topPercent: 50 + Math.sin(radians) * radiusY
  };
}

function slot(leftPercent: number, topPercent: number): SeatPositionPercent {
  return { leftPercent, topPercent };
}

function topSlots(count: number): SeatPositionPercent[] {
  const step = (RECT_RIGHT - RECT_LEFT) / (count + 1);
  return Array.from({ length: count }, (_, index) =>
    slot(RECT_LEFT + step * (index + 1), RECT_TOP)
  );
}

function bottomSlots(count: number): SeatPositionPercent[] {
  const step = (RECT_RIGHT - RECT_LEFT) / (count + 1);
  return Array.from({ length: count }, (_, index) =>
    slot(RECT_RIGHT - step * (index + 1), RECT_BOTTOM)
  );
}

function sideSlots(
  side: "left" | "right",
  count: number
): SeatPositionPercent[] {
  const leftPercent = side === "left" ? RECT_LEFT : RECT_RIGHT;
  const step = (RECT_BOTTOM - RECT_TOP) / (count + 1);
  return Array.from({ length: count }, (_, index) =>
    slot(leftPercent, RECT_TOP + step * (index + 1))
  );
}

function rectangleSlotsWithCorners(count: number): SeatPositionPercent[] {
  switch (count) {
    case 2:
      return [slot(RECT_CENTER, RECT_TOP), slot(RECT_CENTER, RECT_BOTTOM)];
    case 4:
      return [
        slot(RECT_LEFT, RECT_TOP),
        slot(RECT_RIGHT, RECT_TOP),
        slot(RECT_RIGHT, RECT_BOTTOM),
        slot(RECT_LEFT, RECT_BOTTOM)
      ];
    case 6:
      return [
        slot(RECT_LEFT, RECT_TOP),
        slot(RECT_CENTER, RECT_TOP),
        slot(RECT_RIGHT, RECT_TOP),
        slot(RECT_RIGHT, RECT_BOTTOM),
        slot(RECT_CENTER, RECT_BOTTOM),
        slot(RECT_LEFT, RECT_BOTTOM)
      ];
    case 8:
      return [
        slot(RECT_LEFT, RECT_TOP),
        slot(RECT_CENTER, RECT_TOP),
        slot(RECT_RIGHT, RECT_TOP),
        slot(RECT_RIGHT, RECT_CENTER),
        slot(RECT_RIGHT, RECT_BOTTOM),
        slot(RECT_CENTER, RECT_BOTTOM),
        slot(RECT_LEFT, RECT_BOTTOM),
        slot(RECT_LEFT, RECT_CENTER)
      ];
    case 10:
      return [
        slot(RECT_LEFT, RECT_TOP),
        slot(RECT_TOP_THIRD, RECT_TOP),
        slot(RECT_TOP_TWO_THIRD, RECT_TOP),
        slot(RECT_RIGHT, RECT_TOP),
        slot(RECT_RIGHT, RECT_CENTER),
        slot(RECT_RIGHT, RECT_BOTTOM),
        slot(RECT_TOP_TWO_THIRD, RECT_BOTTOM),
        slot(RECT_TOP_THIRD, RECT_BOTTOM),
        slot(RECT_LEFT, RECT_BOTTOM),
        slot(RECT_LEFT, RECT_CENTER)
      ];
    case 12:
    default:
      return [
        slot(RECT_LEFT, RECT_TOP),
        slot(RECT_TOP_THIRD, RECT_TOP),
        slot(RECT_TOP_TWO_THIRD, RECT_TOP),
        slot(RECT_RIGHT, RECT_TOP),
        slot(RECT_RIGHT, RECT_RIGHT_UPPER),
        slot(RECT_RIGHT, RECT_RIGHT_LOWER),
        slot(RECT_RIGHT, RECT_BOTTOM),
        slot(RECT_TOP_TWO_THIRD, RECT_BOTTOM),
        slot(RECT_TOP_THIRD, RECT_BOTTOM),
        slot(RECT_LEFT, RECT_BOTTOM),
        slot(RECT_LEFT, RECT_RIGHT_LOWER),
        slot(RECT_LEFT, RECT_RIGHT_UPPER)
      ];
  }
}

function rectangleSlotsWithoutCorners(count: number): SeatPositionPercent[] {
  switch (count) {
    case 2:
      return [slot(RECT_CENTER, RECT_TOP), slot(RECT_CENTER, RECT_BOTTOM)];
    case 4:
      return [...topSlots(2), ...bottomSlots(2)];
    case 6:
      return [...topSlots(3), ...bottomSlots(3)];
    case 8:
      return [
        ...topSlots(3),
        ...sideSlots("right", 1),
        ...bottomSlots(3),
        ...sideSlots("left", 1)
      ];
    case 10:
      return [
        ...topSlots(4),
        ...sideSlots("right", 1),
        ...bottomSlots(4),
        ...sideSlots("left", 1)
      ];
    case 12:
    default:
      return [
        ...topSlots(4),
        ...sideSlots("right", 2),
        ...bottomSlots(4),
        ...sideSlots("left", 2).reverse()
      ];
  }
}

export function getSeatSlots(
  layout: TableSeatLayout,
  activePlayerCount: number,
  options: TableLayoutOptions
): TableSeatSlot[] {
  const slotCount = getAutoSeatSlotCount(activePlayerCount);
  const positions =
    layout === "rectangle"
      ? options.includeCornerSeats
        ? rectangleSlotsWithCorners(slotCount)
        : rectangleSlotsWithoutCorners(slotCount)
      : Array.from({ length: slotCount }, (_, index) =>
          getSeatPositionPercent(index, slotCount, layout)
        );

  return positions.map((position, seatIndex) => ({
    ...position,
    seatIndex
  }));
}
