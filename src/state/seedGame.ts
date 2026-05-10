import type { GameState, Player } from "../domain/pokerTypes";

export function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createDefaultPlayers(count = 6): Player[] {
  return Array.from({ length: count }, (_, index) => ({
    id: createId("player"),
    name: `Player ${index + 1}`,
    seatIndex: index,
    isActive: true
  }));
}

export function createDefaultGameState(): GameState {
  return {
    schemaVersion: 1,
    settings: {
      gameName: "Poker Night",
      currencyCode: "USD",
      defaultBuyInCents: 2000,
      tableSeatLayout: "top_bottom",
      createdAt: new Date().toISOString()
    },
    players: createDefaultPlayers(),
    transactions: []
  };
}
