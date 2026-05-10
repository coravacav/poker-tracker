import { describe, expect, it } from "vitest";
import { getSeatPositionPercent } from "../domain/tableLayout";

describe("tableLayout", () => {
  it("places six-player top/bottom layout as two top, one right, two bottom, one left", () => {
    const positions = Array.from({ length: 6 }, (_, index) =>
      getSeatPositionPercent(index, 6, "top_bottom")
    );

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
    const positions = Array.from({ length: 6 }, (_, index) =>
      getSeatPositionPercent(index, 6, "left_right")
    );

    expect(positions[0].topPercent).toBeLessThan(15);
    expect(positions[1].leftPercent).toBeGreaterThan(80);
    expect(positions[2].leftPercent).toBeGreaterThan(80);
    expect(positions[3].topPercent).toBeGreaterThan(85);
    expect(positions[4].leftPercent).toBeLessThan(20);
    expect(positions[5].leftPercent).toBeLessThan(20);
  });
});
