import type { SeatRail, TableSeatPlacement, TableShape } from "./pokerTypes";

export type SeatPositionPercent = {
  leftPercent: number;
  topPercent: number;
};

export type TableSeatSlot = SeatPositionPercent & {
  seatIndex: number;
  rail: SeatRail;
  order: number;
};

export type TableLayoutMetrics = {
  minWidthPx: number;
  minHeightPx: number;
};

const RAILS: SeatRail[] = ["top", "right", "bottom", "left"];
const HORIZONTAL_SEAT_PITCH = 170;
const VERTICAL_SEAT_PITCH = 148;
const MIN_TABLE_WIDTH = 720;
const MIN_TABLE_HEIGHT = 520;

const RECT_LEFT = 12;
const RECT_RIGHT = 88;
const RECT_TOP = 14;
const RECT_BOTTOM = 86;
const OVAL_RADIUS_X = 39;
const OVAL_RADIUS_Y = 35;
const ROUND_RADIUS = 37;

function railSortValue(rail: SeatRail): number {
  return RAILS.indexOf(rail);
}

function groupByRail(placements: TableSeatPlacement[]): Map<SeatRail, TableSeatPlacement[]> {
  const byRail = new Map<SeatRail, TableSeatPlacement[]>(
    RAILS.map((rail) => [rail, []])
  );

  for (const placement of placements) {
    byRail.get(placement.rail)?.push(placement);
  }

  for (const railPlacements of byRail.values()) {
    railPlacements.sort((a, b) => a.order - b.order || a.seatIndex - b.seatIndex);
  }

  return byRail;
}

function reindexRail(
  rail: SeatRail,
  placements: TableSeatPlacement[]
): TableSeatPlacement[] {
  return placements
    .sort((a, b) => a.order - b.order || a.seatIndex - b.seatIndex)
    .map((placement, order) => ({ ...placement, rail, order }));
}

function sortPlacements(
  placements: TableSeatPlacement[]
): TableSeatPlacement[] {
  return [...placements].sort(
    (a, b) =>
      railSortValue(a.rail) - railSortValue(b.rail) ||
      a.order - b.order ||
      a.seatIndex - b.seatIndex
  );
}

export function createDefaultSeatPlacements(
  activePlayerCount: number,
  _shape: TableShape = "rectangle"
): TableSeatPlacement[] {
  const safeCount = Math.max(1, Math.floor(activePlayerCount));
  const topCount = Math.ceil(safeCount / 2);
  const bottomCount = safeCount - topCount;

  return Array.from({ length: safeCount }, (_, seatIndex) => {
    if (seatIndex < topCount) {
      return { seatIndex, rail: "top" as const, order: seatIndex };
    }

    return {
      seatIndex,
      rail: "bottom" as const,
      order: seatIndex - topCount
    };
  }).slice(0, topCount + bottomCount);
}

export function normalizeSeatPlacements(
  placements: TableSeatPlacement[],
  activeSeatIndexes: number[],
  shape: TableShape = "rectangle"
): TableSeatPlacement[] {
  const uniqueSeatIndexes = Array.from(
    new Set(
      activeSeatIndexes
        .filter((seatIndex) => Number.isInteger(seatIndex) && seatIndex >= 0)
        .sort((a, b) => a - b)
    )
  );

  if (uniqueSeatIndexes.length === 0) {
    return createDefaultSeatPlacements(1, shape);
  }

  const activeSeatIndexSet = new Set(uniqueSeatIndexes);
  const seenSeatIndexes = new Set<number>();
  const normalizedExisting: TableSeatPlacement[] = [];

  for (const placement of placements) {
    if (
      !activeSeatIndexSet.has(placement.seatIndex) ||
      seenSeatIndexes.has(placement.seatIndex) ||
      !RAILS.includes(placement.rail) ||
      !Number.isFinite(placement.order)
    ) {
      continue;
    }

    seenSeatIndexes.add(placement.seatIndex);
    normalizedExisting.push({
      seatIndex: placement.seatIndex,
      rail: placement.rail,
      order: placement.order
    });
  }

  const byRail = groupByRail(normalizedExisting);
  for (const rail of RAILS) {
    byRail.set(rail, reindexRail(rail, byRail.get(rail) ?? []));
  }

  const missingSeatIndexes = uniqueSeatIndexes.filter(
    (seatIndex) => !seenSeatIndexes.has(seatIndex)
  );

  if (normalizedExisting.length === 0 && missingSeatIndexes.length === uniqueSeatIndexes.length) {
    return createDefaultSeatPlacements(uniqueSeatIndexes.length, shape).map(
      (placement, index) => ({
        ...placement,
        seatIndex: uniqueSeatIndexes[index] ?? placement.seatIndex
      })
    );
  }

  for (const seatIndex of missingSeatIndexes) {
    const targetRail = RAILS.reduce((leastCrowdedRail, rail) => {
      const leastCount = byRail.get(leastCrowdedRail)?.length ?? 0;
      const railCount = byRail.get(rail)?.length ?? 0;
      return railCount < leastCount ? rail : leastCrowdedRail;
    }, "top" as SeatRail);
    const railPlacements = byRail.get(targetRail) ?? [];
    railPlacements.push({
      seatIndex,
      rail: targetRail,
      order: railPlacements.length
    });
    byRail.set(targetRail, railPlacements);
  }

  return sortPlacements(
    RAILS.flatMap((rail) => reindexRail(rail, byRail.get(rail) ?? []))
  );
}

export function moveSeatPlacement(
  placements: TableSeatPlacement[],
  seatIndex: number,
  targetRail: SeatRail,
  targetOrder: number
): TableSeatPlacement[] {
  const movingPlacement = placements.find(
    (placement) => placement.seatIndex === seatIndex
  );

  if (!movingPlacement || !RAILS.includes(targetRail)) {
    return placements;
  }

  const byRail = groupByRail(
    placements.filter((placement) => placement.seatIndex !== seatIndex)
  );
  const targetRailPlacements = reindexRail(targetRail, byRail.get(targetRail) ?? []);
  const adjustedTargetOrder =
    movingPlacement.rail === targetRail && targetOrder > movingPlacement.order
      ? targetOrder - 1
      : targetOrder;
  const safeOrder = Math.max(
    0,
    Math.min(adjustedTargetOrder, targetRailPlacements.length)
  );

  targetRailPlacements.splice(safeOrder, 0, {
    seatIndex,
    rail: targetRail,
    order: safeOrder
  });
  byRail.set(targetRail, targetRailPlacements);

  return sortPlacements(
    RAILS.flatMap((rail) => reindexRail(rail, byRail.get(rail) ?? []))
  );
}

function linePosition(
  rail: SeatRail,
  order: number,
  count: number
): SeatPositionPercent {
  const ratio = (order + 1) / (count + 1);

  if (rail === "top") {
    return {
      leftPercent: RECT_LEFT + (RECT_RIGHT - RECT_LEFT) * ratio,
      topPercent: RECT_TOP
    };
  }

  if (rail === "right") {
    return {
      leftPercent: RECT_RIGHT,
      topPercent: RECT_TOP + (RECT_BOTTOM - RECT_TOP) * ratio
    };
  }

  if (rail === "bottom") {
    return {
      leftPercent: RECT_RIGHT - (RECT_RIGHT - RECT_LEFT) * ratio,
      topPercent: RECT_BOTTOM
    };
  }

  return {
    leftPercent: RECT_LEFT,
    topPercent: RECT_BOTTOM - (RECT_BOTTOM - RECT_TOP) * ratio
  };
}

function arcAngle(rail: SeatRail, order: number, count: number): number {
  const ratio = (order + 1) / (count + 1);
  const ranges: Record<SeatRail, [number, number]> = {
    top: [225, 315],
    right: [315, 405],
    bottom: [45, 135],
    left: [135, 225]
  };
  const [start, end] = ranges[rail];
  return start + (end - start) * ratio;
}

function arcPosition(
  shape: TableShape,
  rail: SeatRail,
  order: number,
  count: number
): SeatPositionPercent {
  const angle = arcAngle(rail, order, count);
  const radians = (angle * Math.PI) / 180;
  const radiusX = shape === "round" ? ROUND_RADIUS : OVAL_RADIUS_X;
  const radiusY = shape === "round" ? ROUND_RADIUS : OVAL_RADIUS_Y;

  return {
    leftPercent: 50 + Math.cos(radians) * radiusX,
    topPercent: 50 + Math.sin(radians) * radiusY
  };
}

export function getSeatSlots(
  shape: TableShape,
  placements: TableSeatPlacement[]
): TableSeatSlot[] {
  const byRail = groupByRail(placements);

  return sortPlacements(placements).map((placement) => {
    const count = byRail.get(placement.rail)?.length ?? 1;
    const position =
      shape === "rectangle"
        ? linePosition(placement.rail, placement.order, count)
        : arcPosition(shape, placement.rail, placement.order, count);

    return {
      ...position,
      seatIndex: placement.seatIndex,
      rail: placement.rail,
      order: placement.order
    };
  });
}

export function getTableLayoutMetrics(
  placements: TableSeatPlacement[]
): TableLayoutMetrics {
  const byRail = groupByRail(placements);
  const topCount = byRail.get("top")?.length ?? 0;
  const bottomCount = byRail.get("bottom")?.length ?? 0;
  const rightCount = byRail.get("right")?.length ?? 0;
  const leftCount = byRail.get("left")?.length ?? 0;

  return {
    minWidthPx: Math.max(
      MIN_TABLE_WIDTH,
      (Math.max(topCount, bottomCount, 2) + 1) * HORIZONTAL_SEAT_PITCH
    ),
    minHeightPx: Math.max(
      MIN_TABLE_HEIGHT,
      (Math.max(rightCount, leftCount, 2) + 1) * VERTICAL_SEAT_PITCH
    )
  };
}

export function getSeatPositionPercent(
  index: number,
  count: number,
  shape: TableShape
): SeatPositionPercent {
  const placements = createDefaultSeatPlacements(count, shape);
  return getSeatSlots(shape, placements)[index] ?? { leftPercent: 50, topPercent: 50 };
}
