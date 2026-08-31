import { describe, expect, it } from "vitest";
import { applyHostedAction, normalizeGameState, roomStateError } from "../session/roomProtocol";
import { createDefaultGameState } from "../state/seedGame";

describe("room transaction compatibility", () => {
  it("normalizes legacy player transfers into explicit v7 transaction types", () => {
    const current = createDefaultGameState();
    const legacy = {
      ...current,
      schemaVersion: 6 as const,
      transactions: [
        {
          id: "chips",
          type: "player_transfer" as const,
          createdAt: "2026-01-01",
          amountCents: 500,
          fromPlayerId: current.players[0].id,
          toPlayerId: current.players[1].id,
          category: "poker" as const
        },
        {
          id: "food",
          type: "player_transfer" as const,
          createdAt: "2026-01-02",
          amountCents: 300,
          fromPlayerId: current.players[0].id,
          toPlayerId: current.players[1].id,
          category: "food" as const
        }
      ]
    };

    expect(roomStateError(legacy)).toBeNull();
    expect(normalizeGameState(legacy as never)).toEqual(
      expect.objectContaining({
        schemaVersion: 7,
        transactions: [
          expect.objectContaining({ id: "chips", type: "player_gave" }),
          expect.objectContaining({
            id: "food",
            type: "player_owes",
            fromPlayerId: current.players[1].id,
            toPlayerId: current.players[0].id
          })
        ]
      })
    );
  });

  it("accepts player owes actions in a shared room", () => {
    const state = createDefaultGameState();
    const [owingPlayer, owedPlayer] = state.players;
    const result = applyHostedAction(
      state,
      {
        type: "add_transaction",
        transaction: {
          id: "client-id",
          type: "player_owes",
          createdAt: "2000-01-01T00:00:00.000Z",
          amountCents: 750,
          fromPlayerId: owingPlayer.id,
          toPlayerId: owedPlayer.id,
          category: "food"
        }
      },
      "2026-01-01T00:00:00.000Z",
      () => "server-transaction"
    );

    expect(result).toEqual(
      expect.objectContaining({
        state: expect.objectContaining({
          schemaVersion: 7,
          transactions: [expect.objectContaining({ type: "player_owes", id: "server-transaction" })]
        })
      })
    );
  });
});
