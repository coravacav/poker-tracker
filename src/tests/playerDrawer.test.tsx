import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlayerDrawer } from "../components/PlayerDrawer";
import type { Player } from "../domain/pokerTypes";
import { loadPeopleDirectory, PEOPLE_KEY, resetPeopleStoreForTests } from "../state/peopleStore";

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
      name: "Alex",
      personId: null
    });
  });

  it("places add player after the roster and focuses the added row", () => {
    const dispatch = vi.fn();
    const { rerender } = renderDrawer({ dispatch });
    const playerInputs = screen.getAllByRole("textbox", { name: "Player name" });
    const addPlayer = screen.getByRole("button", { name: "Add player" });

    expect(
      playerInputs[playerInputs.length - 1]?.closest(".player-row")
        ?.nextElementSibling
    ).toBe(
      addPlayer
    );

    fireEvent.click(addPlayer);
    expect(dispatch).toHaveBeenCalledWith({ type: "add_player" });

    const addedPlayer: Player = {
      id: "p4",
      name: "Player 4",
      seatIndex: 3,
      isActive: true
    };
    rerender(
      <PlayerDrawer
        dispatch={dispatch}
        fastEntryDisabled={false}
        players={[...defaultPlayers, addedPlayer]}
        readOnly={false}
        transactions={[]}
      />
    );

    const updatedInputs = screen.getAllByRole("textbox", { name: "Player name" });
    expect(updatedInputs[updatedInputs.length - 1]).toHaveFocus();
    expect(updatedInputs[updatedInputs.length - 1]).toHaveValue("Player 4");
  });

  it("commits on Enter and advances to the next player", () => {
    const dispatch = vi.fn();
    renderDrawer({ dispatch });
    const [firstPlayer, secondPlayer] = screen.getAllByRole("textbox", {
      name: "Player name"
    });

    fireEvent.change(firstPlayer, { target: { value: "Alex" } });
    fireEvent.keyDown(firstPlayer, { key: "Enter" });

    expect(dispatch).toHaveBeenCalledWith({
      type: "rename_player",
      playerId: "p1",
      name: "Alex",
      personId: null
    });
    expect(secondPlayer).toHaveFocus();
  });

  it("adds another player when Enter is pressed on the last row", () => {
    const dispatch = vi.fn();
    renderDrawer({ dispatch });
    const playerInputs = screen.getAllByRole("textbox", { name: "Player name" });
    const lastPlayer = playerInputs[playerInputs.length - 1];

    fireEvent.keyDown(lastPlayer!, { key: "Enter" });

    expect(dispatch).toHaveBeenCalledWith({ type: "add_player" });
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
      names: ["Alex", "Blair", "Casey", "Dana"],
      personIds: [null, null, null, null]
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

  it("edits a player's Venmo username and remembers it for the linked person", () => {
    localStorage.setItem(
      PEOPLE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        people: [{ id: "person_alex", name: "Alex", aliases: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }]
      })
    );
    resetPeopleStoreForTests();
    const dispatch = vi.fn();
    renderDrawer({ dispatch, players: [{ ...defaultPlayers[0], name: "Alex", personId: "person_alex" }] });

    fireEvent.click(screen.getByRole("button", { name: "Venmo username for Alex" }));
    const input = screen.getByRole("textbox", { name: /Venmo username/ });
    fireEvent.change(input, { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/5–30 letters/);
    expect(dispatch).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "@alex-pays" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(dispatch).toHaveBeenCalledWith({ type: "set_player_venmo_handle", playerId: "p1", venmoHandle: "alex-pays" });
    expect(loadPeopleDirectory().people[0].venmoHandle).toBe("alex-pays");
    expect(screen.queryByRole("textbox", { name: /Venmo username/ })).not.toBeInTheDocument();
  });

  it("brings a linked person's Venmo username along when a name is committed", () => {
    localStorage.setItem(
      PEOPLE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        people: [
          { id: "person_alex", name: "Alex", aliases: [], venmoHandle: "alex-pays", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }
        ]
      })
    );
    resetPeopleStoreForTests();
    const dispatch = vi.fn();
    renderDrawer({ dispatch, players: [defaultPlayers[0]] });
    const input = screen.getByRole("textbox", { name: "Player name" });
    fireEvent.change(input, { target: { value: "alex" } });
    fireEvent.blur(input);
    expect(dispatch).toHaveBeenCalledWith({
      type: "rename_player",
      playerId: "p1",
      name: "alex",
      personId: "person_alex",
      venmoHandle: "alex-pays"
    });
  });
});
