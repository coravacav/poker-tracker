import { describe, expect, it } from "vitest";
import type { TableSeatPlacement } from "../domain/pokerTypes";
import {
  createDefaultSeatPlacements,
  getLayoutInsertionSlots,
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

  it("creates one more insertion target than seats on every rail", () => {
    const placements = createDefaultSeatPlacements(6, "rectangle");
    const targets = getLayoutInsertionSlots("rectangle", placements);

    expect(targets.filter((target) => target.rail === "top")).toHaveLength(4);
    expect(targets.filter((target) => target.rail === "bottom")).toHaveLength(4);
    expect(targets.filter((target) => target.rail === "right")).toEqual([
      { rail: "right", order: 0, leftPercent: 88, topPercent: 50 }
    ]);
    expect(targets.filter((target) => target.rail === "left")).toEqual([
      { rail: "left", order: 0, leftPercent: 12, topPercent: 50 }
    ]);
  });

  it("places rectangle insertion targets in the true gaps between seats", () => {
    const placements = createDefaultSeatPlacements(6, "rectangle");
    const topSeats = getSeatSlots("rectangle", placements)
      .filter((slot) => slot.rail === "top");
    const topTargets = getLayoutInsertionSlots("rectangle", placements)
      .filter((target) => target.rail === "top");

    expect(topTargets[1].leftPercent).toBeCloseTo(
      (topSeats[0].leftPercent + topSeats[1].leftPercent) / 2
    );
    expect(topTargets[2].leftPercent).toBeCloseTo(
      (topSeats[1].leftPercent + topSeats[2].leftPercent) / 2
    );
    expect(topSeats[0].leftPercent - topTargets[0].leftPercent).toBeCloseTo(
      topTargets[1].leftPercent - topSeats[0].leftPercent
    );
    expect(topTargets[3].leftPercent - topSeats[2].leftPercent).toBeCloseTo(
      topSeats[2].leftPercent - topTargets[2].leftPercent
    );
  });

  it("places oval and round insertion targets along their rail arcs", () => {
    const placements: TableSeatPlacement[] = [
      { seatIndex: 0, rail: "top", order: 0 },
      { seatIndex: 1, rail: "right", order: 0 },
      { seatIndex: 2, rail: "bottom", order: 0 },
      { seatIndex: 3, rail: "left", order: 0 }
    ];
    const ovalTargets = getLayoutInsertionSlots("oval", placements);
    const roundTargets = getLayoutInsertionSlots("round", placements);

    expect(ovalTargets
      .filter((target) => target.rail === "top")
      .every((target) => target.topPercent < 20)).toBe(true);
    expect(ovalTargets
      .filter((target) => target.rail === "right")
      .every((target) => target.leftPercent > 85)).toBe(true);
    expect(ovalTargets
      .filter((target) => target.rail === "bottom")
      .every((target) => target.topPercent > 80)).toBe(true);
    expect(ovalTargets
      .filter((target) => target.rail === "left")
      .every((target) => target.leftPercent < 15)).toBe(true);
    for (const target of roundTargets) {
      expect(Math.hypot(target.leftPercent - 50, target.topPercent - 50))
        .toBeCloseTo(37);
    }
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

  it("moves a physical seat leftward by one position within the same line", () => {
    const placements = createDefaultSeatPlacements(6, "rectangle");
    const moved = moveSeatPlacement(placements, 1, "top", 0);
    const topSeats = moved
      .filter((placement) => placement.rail === "top")
      .sort((a, b) => a.order - b.order)
      .map((placement) => placement.seatIndex);

    expect(topSeats).toEqual([1, 0, 2]);
  });

  it("preserves logical order for adjacent moves on the reversed bottom rail", () => {
    const placements = createDefaultSeatPlacements(6, "rectangle");
    const moved = moveSeatPlacement(placements, 3, "bottom", 2);
    const bottomPlacements = moved
      .filter((placement) => placement.rail === "bottom")
      .sort((a, b) => a.order - b.order);
    const bottomSlots = getSeatSlots("rectangle", bottomPlacements);

    expect(bottomPlacements.map((placement) => placement.seatIndex))
      .toEqual([4, 3, 5]);
    expect(bottomSlots[0].leftPercent).toBeGreaterThan(bottomSlots[1].leftPercent);
    expect(bottomSlots[1].leftPercent).toBeGreaterThan(bottomSlots[2].leftPercent);
  });

  it("moves a physical seat to the end of its rail", () => {
    const placements = createDefaultSeatPlacements(6, "rectangle");
    const moved = moveSeatPlacement(placements, 0, "top", 3);
    const topSeats = moved
      .filter((placement) => placement.rail === "top")
      .sort((a, b) => a.order - b.order)
      .map((placement) => placement.seatIndex);

    expect(topSeats).toEqual([1, 2, 0]);
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
