import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlayerDrawer } from "../components/PlayerDrawer";
import type { Player } from "../domain/pokerTypes";

const defaultPlayers: Player[] = [
  { id: "p1", name: "Player 1", seatIndex: 0, isActive: true },
  { id: "p2", name: "Player 2", seatIndex: 1, isActive: true },
  { id: "p3", name: "Player 3", seatIndex: 2, isActive: true }
];

function renderDrawer(
  changes: Partial<React.ComponentProps<typeof PlayerDrawer>> = {}
) {
  const props: React.ComponentProps<typeof PlayerDrawer> = {
    dispatch: vi.fn(),
    fastEntryDisabled: false,
    players: defaultPlayers,
    readOnly: false,
    transactions: [],
    ...changes
  };

  return { ...render(<PlayerDrawer {...props} />), props };
}

describe("PlayerDrawer", () => {
  it("allows clearing a player name before committing a replacement", () => {
    const dispatch = vi.fn();

    renderDrawer({ dispatch, players: [defaultPlayers[0]] });

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

  it("opens fast entry empty for a default roster and cancels back to player rows", () => {
    renderDrawer();

    fireEvent.click(screen.getByRole("button", { name: "Fast entry" }));

    expect(screen.getByLabelText("Player names (one per line)")).toHaveValue("");
    expect(screen.queryByRole("textbox", { name: "Player name" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByLabelText("Player names (one per line)")).toBeNull();
    expect(screen.getAllByRole("textbox", { name: "Player name" })).toHaveLength(3);
  });

  it("prefills only customized names in seat order", () => {
    renderDrawer({
      players: [
        { id: "p3", name: "Player 3", seatIndex: 2, isActive: true },
        { id: "p2", name: "Blair", seatIndex: 1, isActive: true },
        { id: "p1", name: "Alex", seatIndex: 0, isActive: true }
      ]
    });

    fireEvent.click(screen.getByRole("button", { name: "Fast entry" }));

    expect(screen.getByLabelText("Player names (one per line)")).toHaveValue(
      "Alex\nBlair"
    );
  });

  it("parses every newline style, trims blanks, and applies atomically", () => {
    const dispatch = vi.fn();
    renderDrawer({ dispatch });
    fireEvent.click(screen.getByRole("button", { name: "Fast entry" }));

    fireEvent.change(screen.getByLabelText("Player names (one per line)"), {
      target: { value: " Alex \r\n\r\n Blair\n Casey \r Dana " }
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply players" }));

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: "replace_active_players",
      names: ["Alex", "Blair", "Casey", "Dana"]
    });
    expect(screen.queryByLabelText("Player names (one per line)")).toBeNull();
    expect(screen.getAllByRole("textbox", { name: "Player name" })).toHaveLength(3);
  });

  it("rejects an empty fast-entry list", () => {
    const dispatch = vi.fn();
    renderDrawer({ dispatch });
    fireEvent.click(screen.getByRole("button", { name: "Fast entry" }));
    fireEvent.change(screen.getByLabelText("Player names (one per line)"), {
      target: { value: " \n\r\n " }
    });

    fireEvent.click(screen.getByRole("button", { name: "Apply players" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter at least one player name."
    );
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("disables fast entry in read-only mode or after game activity", () => {
    const { rerender, props } = renderDrawer({ readOnly: true });
    const fastEntry = screen.getByRole("button", { name: "Fast entry" });

    expect(fastEntry).toBeDisabled();
    expect(fastEntry).toHaveAttribute(
      "title",
      "Turn off read-only mode to use fast entry"
    );

    rerender(<PlayerDrawer {...props} readOnly={false} fastEntryDisabled />);
    expect(screen.getByRole("button", { name: "Fast entry" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Fast entry" })).toHaveAttribute(
      "title",
      "Fast entry is unavailable after transactions or cash-out drafts exist"
    );
  });
});
