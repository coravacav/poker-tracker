import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlayerDrawer } from "../components/PlayerDrawer";

describe("PlayerDrawer", () => {
  it("allows clearing a player name before committing a replacement", () => {
    const dispatch = vi.fn();

    render(
      <PlayerDrawer
        dispatch={dispatch}
        players={[{ id: "p1", name: "Player 1", seatIndex: 0, isActive: true }]}
        readOnly={false}
        transactions={[]}
      />
    );

    const input = screen.getByRole("textbox", { name: "Player name" });

    fireEvent.change(input, { target: { value: "" } });
    expect(input).toHaveValue("");
    expect(dispatch).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "Alex" } });
    fireEvent.blur(input);

    expect(dispatch).toHaveBeenCalledWith({
      type: "rename_player",
      playerId: "p1",
      name: "Alex"
    });
  });
});
