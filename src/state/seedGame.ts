import type { GameState, Player } from "../domain/pokerTypes";
import { createDefaultSeatPlacements } from "../domain/tableLayout";

export function createId(prefix: string): string {
  const webCrypto = typeof globalThis.crypto === "undefined"
    ? undefined
    : (globalThis.crypto as Crypto & { randomUUID?: () => string });
  if (typeof webCrypto?.randomUUID === "function") {
    return `${prefix}_${webCrypto.randomUUID()}`;
  }

  if (webCrypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    webCrypto.getRandomValues(bytes);
    return `${prefix}_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
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
  const players = createDefaultPlayers();

  return {
    schemaVersion: 7,
    localGameId: createId("game"),
    settings: {
      gameName: "Poker Night",
      currencyCode: "USD",
      defaultBuyInCents: 2000,
      tableShape: "rectangle",
      tableSeatPlacements: createDefaultSeatPlacements(players.length, "rectangle"),
      chipDenominations: [],
      createdAt: new Date().toISOString()
    },
    players,
    transactions: [],
    cashOutDrafts: []
  };
}
