import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExportImportControls } from "../components/ExportImportControls";
import type { GameState } from "../domain/pokerTypes";
import { loadArchivedGames } from "../state/gameArchive";
import { createDefaultGameState } from "../state/seedGame";

function playedGame(name: string): GameState {
  const state = createDefaultGameState();
  state.settings.gameName = name;
  state.transactions.push({
    id: `buy-${name}`,
    type: "bank_buy_in",
    toPlayerId: state.players[0].id,
    amountCents: 2000,
    createdAt: "2026-10-01T00:00:00Z"
  });
  return state;
}

function chooseFile(contents: string) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  // jsdom's File has no text(), which the import reads with.
  const file = Object.assign(new File([contents], "game.json", { type: "application/json" }), {
    text: async () => contents
  });
  fireEvent.change(input, { target: { files: [file] } });
}

describe("importing a game file", () => {
  it("keeps the game in progress in Player History before replacing it", async () => {
    const dispatch = vi.fn();
    const current = playedGame("Friday");
    const incoming = playedGame("Saturday");
    render(<ExportImportControls dispatch={dispatch} state={current} />);

    chooseFile(JSON.stringify(incoming));

    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "replace_state_from_import" }))
    );
    const archived = await loadArchivedGames();
    expect(archived.map((game) => game.state.settings.gameName)).toEqual(["Friday"]);
  });

  it("re-importing the same game replaces it without archiving a copy", async () => {
    const dispatch = vi.fn();
    const current = playedGame("Friday");
    render(<ExportImportControls dispatch={dispatch} state={current} />);

    chooseFile(JSON.stringify(current));

    await waitFor(() => expect(dispatch).toHaveBeenCalled());
    expect(await loadArchivedGames()).toEqual([]);
  });

  it("says plainly when a file is not a game or backup", async () => {
    const dispatch = vi.fn();
    render(<ExportImportControls dispatch={dispatch} state={playedGame("Friday")} />);

    chooseFile(JSON.stringify({ hello: 1 }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That file is not a Poker Tracker game or backup.");

    chooseFile("not json");
    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not read that file/);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
