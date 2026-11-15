import { describe, expect, it } from "vitest";
import { shuffleSeatOrder } from "../domain/seatShuffle";

describe("shuffleSeatOrder", () => {
  it("keeps every item exactly once", () => {
    const items = ["a", "b", "c", "d", "e", "f"];
    for (let run = 0; run < 50; run += 1) {
      const shuffled = shuffleSeatOrder(items);
      expect([...shuffled].sort()).toEqual(items);
    }
  });

  it("always changes the order when there are at least two items", () => {
    for (let run = 0; run < 200; run += 1) {
      expect(shuffleSeatOrder(["a", "b"])).toEqual(["b", "a"]);
      expect(shuffleSeatOrder(["a", "b", "c"])).not.toEqual(["a", "b", "c"]);
    }
  });

  it("still changes the order when the random source keeps returning the identity", () => {
    // random() close to 1 always swaps an item with itself.
    expect(shuffleSeatOrder(["a", "b", "c"], () => 0.9999)).toEqual(["b", "c", "a"]);
  });

  it("uses the random source to pick the order", () => {
    expect(shuffleSeatOrder(["a", "b", "c"], () => 0)).toEqual(["b", "c", "a"]);
  });

  it("leaves empty and single-item lists alone", () => {
    expect(shuffleSeatOrder([])).toEqual([]);
    expect(shuffleSeatOrder(["a"])).toEqual(["a"]);
  });

  it("does not modify the input", () => {
    const items = ["a", "b", "c"];
    shuffleSeatOrder(items);
    expect(items).toEqual(["a", "b", "c"]);
  });
});
