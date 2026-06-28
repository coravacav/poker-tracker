import { describe, expect, it } from "vitest";
import {
  getAutoSeatSlotCount,
  getSeatPositionPercent,
  getSeatSlots
} from "../domain/tableLayout";

describe("tableLayout", () => {
  it("calculates the next even auto seat count with one extra slot", () => {
    expect(Array.from({ length: 12 }, (_, index) => getAutoSeatSlotCount(index + 1)))
      .toEqual([2, 4, 4, 6, 6, 8, 8, 10, 10, 12, 12, 12]);
  });

  it("places six-slot top/bottom layout as two top, one right, two bottom, one left", () => {
    const positions = getSeatSlots("top_bottom", 5, {
      includeCornerSeats: true
    });

    expect(positions[0].topPercent).toBeLessThan(25);
    expect(positions[1].topPercent).toBeLessThan(25);
    expect(positions[2].leftPercent).toBeGreaterThan(85);
    expect(positions[2].topPercent).toBeCloseTo(50);
    expect(positions[3].topPercent).toBeGreaterThan(75);
    expect(positions[4].topPercent).toBeGreaterThan(75);
    expect(positions[5].leftPercent).toBeLessThan(15);
    expect(positions[5].topPercent).toBeCloseTo(50);
  });

  it("keeps the left/right layout as one top, two right, one bottom, two left", () => {
    const positions = getSeatSlots("left_right", 5, {
      includeCornerSeats: true
    });

    expect(positions[0].topPercent).toBeLessThan(15);
    expect(positions[1].leftPercent).toBeGreaterThan(80);
    expect(positions[2].leftPercent).toBeGreaterThan(80);
    expect(positions[3].topPercent).toBeGreaterThan(85);
    expect(positions[4].leftPercent).toBeLessThan(20);
    expect(positions[5].leftPercent).toBeLessThan(20);
  });

  it("generates rectangle corner slots when corners are enabled", () => {
    const positions = getSeatSlots("rectangle", 2, {
      includeCornerSeats: true
    });

    expect(positions).toEqual([
      expect.objectContaining({ leftPercent: 9, topPercent: 13 }),
      expect.objectContaining({ leftPercent: 91, topPercent: 13 }),
      expect.objectContaining({ leftPercent: 91, topPercent: 87 }),
      expect.objectContaining({ leftPercent: 9, topPercent: 87 })
    ]);
  });

  it("generates rectangle corners and side centers for eight slots", () => {
    const positions = getSeatSlots("rectangle", 7, {
      includeCornerSeats: true
    });

    expect(positions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ leftPercent: 9, topPercent: 13 }),
        expect.objectContaining({ leftPercent: 91, topPercent: 13 }),
        expect.objectContaining({ leftPercent: 91, topPercent: 87 }),
        expect.objectContaining({ leftPercent: 9, topPercent: 87 }),
        expect.objectContaining({ leftPercent: 91, topPercent: 50 }),
        expect.objectContaining({ leftPercent: 9, topPercent: 50 })
      ])
    );
  });

  it("keeps rectangle slots off corners when corners are disabled", () => {
    const positions = getSeatSlots("rectangle", 11, {
      includeCornerSeats: false
    });
    const corners = new Set(["9:13", "91:13", "91:87", "9:87"]);

    expect(
      positions.some((position) =>
        corners.has(`${position.leftPercent}:${position.topPercent}`)
      )
    ).toBe(false);
  });

  it("uses an equal x/y radius for round tables", () => {
    const position = getSeatPositionPercent(0, 6, "round");
    const radius = Math.hypot(position.leftPercent - 50, position.topPercent - 50);

    expect(radius).toBeCloseTo(38);
  });

  it("offsets even round tables away from exact top and bottom", () => {
    const positions = getSeatSlots("round", 1, {
      includeCornerSeats: true
    });

    expect(positions[0].topPercent).toBeGreaterThan(15);
    expect(positions[1].topPercent).toBeLessThan(85);
  });
});
