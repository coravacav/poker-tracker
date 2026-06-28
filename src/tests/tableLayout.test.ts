import { describe, expect, it } from "vitest";
import type { TableSeatPlacement } from "../domain/pokerTypes";
import {
  createDefaultSeatPlacements,
  getSeatSlots,
  moveSeatPlacement,
  normalizeSeatPlacements
} from "../domain/tableLayout";

describe("tableLayout", () => {
  it("defaults six rectangle seats to a top/bottom-heavy arrangement", () => {
    const placements = createDefaultSeatPlacements(6, "rectangle");

    expect(placements).toEqual([
      { seatIndex: 0, rail: "top", order: 0 },
      { seatIndex: 1, rail: "top", order: 1 },
      { seatIndex: 2, rail: "top", order: 2 },
      { seatIndex: 3, rail: "bottom", order: 0 },
      { seatIndex: 4, rail: "bottom", order: 1 },
      { seatIndex: 5, rail: "bottom", order: 2 }
    ]);
  });

  it("generates layouts beyond twelve seats", () => {
    expect(createDefaultSeatPlacements(20, "rectangle")).toHaveLength(20);
  });

  it("orders rectangle rails in their physical directions", () => {
    const placements = createDefaultSeatPlacements(6, "rectangle");
    const slots = getSeatSlots("rectangle", placements);
    const topSlots = slots.filter((slot) => slot.rail === "top");
    const bottomSlots = slots.filter((slot) => slot.rail === "bottom");

    expect(topSlots[0].leftPercent).toBeLessThan(topSlots[1].leftPercent);
    expect(topSlots[1].leftPercent).toBeLessThan(topSlots[2].leftPercent);
    expect(bottomSlots[0].leftPercent).toBeGreaterThan(bottomSlots[1].leftPercent);
    expect(bottomSlots[1].leftPercent).toBeGreaterThan(bottomSlots[2].leftPercent);
  });

  it("places oval rails as arcs around the felt", () => {
    const placements: TableSeatPlacement[] = [
      { seatIndex: 0, rail: "top", order: 0 },
      { seatIndex: 1, rail: "right", order: 0 },
      { seatIndex: 2, rail: "bottom", order: 0 },
      { seatIndex: 3, rail: "left", order: 0 }
    ];
    const slots = getSeatSlots("oval", placements);

    expect(slots[0].topPercent).toBeLessThan(20);
    expect(slots[1].leftPercent).toBeGreaterThan(85);
    expect(slots[2].topPercent).toBeGreaterThan(80);
    expect(slots[3].leftPercent).toBeLessThan(15);
  });

  it("uses an equal x/y radius for round arcs", () => {
    const [slot] = getSeatSlots("round", [{ seatIndex: 0, rail: "right", order: 0 }]);
    const radius = Math.hypot(slot.leftPercent - 50, slot.topPercent - 50);

    expect(radius).toBeCloseTo(37);
  });

  it("moves a physical seat between rails while preserving its seat index", () => {
    const placements = createDefaultSeatPlacements(4, "rectangle");
    const moved = moveSeatPlacement(placements, 1, "right", 0);

    expect(moved).toContainEqual({ seatIndex: 1, rail: "right", order: 0 });
    expect(moved.find((placement) => placement.seatIndex === 1)?.seatIndex).toBe(1);
  });

  it("moves a physical seat rightward within the same line", () => {
    const placements = createDefaultSeatPlacements(6, "rectangle");
    const moved = moveSeatPlacement(placements, 0, "top", 2);
    const topSeats = moved
      .filter((placement) => placement.rail === "top")
      .sort((a, b) => a.order - b.order)
      .map((placement) => placement.seatIndex);

    expect(topSeats).toEqual([1, 0, 2]);
  });

  it("normalizes duplicate and missing placements", () => {
    const normalized = normalizeSeatPlacements(
      [
        { seatIndex: 0, rail: "top", order: 0 },
        { seatIndex: 0, rail: "bottom", order: 0 },
        { seatIndex: 8, rail: "left", order: 0 }
      ],
      [0, 1, 2],
      "rectangle"
    );

    expect(normalized.map((placement) => placement.seatIndex).sort((a, b) => a - b))
      .toEqual([0, 1, 2]);
    expect(new Set(normalized.map((placement) => placement.seatIndex)).size).toBe(3);
  });
});
