/**
 * Guests keeping a shared room's game in this device's Player History. Only
 * finished rooms (ended or expired) are offered, so what is saved is the
 * room's closing snapshot. The copy is the guest's view of the game (no host
 * people links), stored under an id derived from the host's own game id,
 * which every room sharing that game carries:
 *
 * - Saving again, or saving another room the same game was shared in, replaces
 *   the copy. Shared rooms offers the save only on the latest room of each
 *   game (latestRoomPerGame), so a later snapshot is not replaced by an
 *   earlier one; saves in one tab run one at a time.
 * - Rooms whose game this device's Player History already holds as the host's
 *   own copy are refused (and hidden from Player History if both end up here,
 *   say after restoring a backup), so no game counts twice.
 * - Replacing a copy keeps the people links made or corrected here.
 */
import type { GameState } from "../domain/pokerTypes";
import type { ArchivedGame } from "../domain/sessionHistory";
import { archiveGame, loadArchivedGames } from "./gameArchive";

const PREFIX = "shared_";
const MAX_GAME_ID_LENGTH = 160;

export type SaveSharedGameResult = "saved" | "stale" | "hosted" | "empty" | "failed";

/** When a room closed, for ordering copies of one game: its end, else its creation. */
export function roomClosedAt(room: { createdAt: number; endedAt: number | null }): number {
  return room.endedAt ?? room.createdAt;
}

/** Player History id of a game saved by a guest, from the host's id for the game. */
export function sharedGameArchiveId(hostGameId: string): string {
  return `${PREFIX}${hostGameId}`.slice(0, MAX_GAME_ID_LENGTH);
}

/**
 * The room to offer saving for in each game: among finished rooms, the one
 * that ended last (or was created last, for rooms without an end time).
 */
export function latestRoomPerGame<T extends { publicId: string; createdAt: number; endedAt: number | null; state: GameState }>(
  rooms: T[]
): Set<string> {
  const latest = new Map<string, T>();
  for (const room of rooms) {
    const current = latest.get(room.state.localGameId);
    if (!current || roomClosedAt(room) > roomClosedAt(current)) latest.set(room.state.localGameId, room);
  }
  return new Set([...latest.values()].map((room) => room.publicId));
}

/**
 * Player History without guest copies of games whose host copy is also here
 * (the host's copy is the complete one).
 */
export function withoutSharedDuplicates(games: ArchivedGame[]): ArchivedGame[] {
  const hostCopies = new Set(
    games
      .filter((game) => !game.state.localGameId.startsWith(PREFIX))
      .map((game) => sharedGameArchiveId(game.state.localGameId))
  );
  return hostCopies.size === 0 ? games : games.filter((game) => !hostCopies.has(game.state.localGameId));
}

/** Whether Player History holds the host's own copy of this game. */
export function hostCopyArchived(hostGameId: string, archivedGameIds: Iterable<string>): boolean {
  for (const id of archivedGameIds) if (id === hostGameId) return true;
  return false;
}

/**
 * What the guest bar offers to save for the room just watched, or null: the
 * room must be finished and, among the finished rooms this device joined for
 * the same game (room history, as far as it has loaded), the latest. The save
 * itself also refuses a room that closed before the kept copy's room, so a
 * stale or incomplete history cannot make an older room replace a newer copy.
 */
export function watchedRoomSave(
  room: { publicId: string; status: string; endedAt: number | null; state: GameState },
  joinedRooms: Array<{ publicId: string; role: string; status: string; createdAt: number; endedAt: number | null; state: GameState }>
): { state: GameState; closedAt: number } | null {
  if (room.status === "active") return null;
  const known = joinedRooms.find((joined) => joined.publicId === room.publicId);
  // Without an end time or a known creation time (room history not loaded), the room cannot be ordered
  // against other copies, so it is not offered; Shared rooms offers it once history has loaded.
  if (room.endedAt === null && !known) return null;
  const current = { ...room, createdAt: known?.createdAt ?? 0 };
  const finished = joinedRooms.filter(
    (joined) => joined.role === "guest" && joined.status !== "active" && joined.publicId !== room.publicId
  );
  return latestRoomPerGame([...finished, current]).has(room.publicId)
    ? { state: room.state, closedAt: roomClosedAt(current) }
    : null;
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Saves a finished room's game, as the guest saw it, to Player History (one
 * save at a time). `closedAt` (roomClosedAt) is kept with the copy, and a
 * room that closed before the kept copy's room is refused ("stale").
 */
export function saveSharedGame(state: GameState, closedAt: number): Promise<SaveSharedGameResult> {
  const result = queue.then(() => save(state, closedAt));
  queue = result.catch(() => undefined);
  return result;
}

async function save(state: GameState, closedAt: number): Promise<SaveSharedGameResult> {
  if (state.transactions.length === 0) return "empty";
  const games = await loadArchivedGames();
  if (hostCopyArchived(state.localGameId, games.map((game) => game.state.localGameId))) return "hosted";
  const id = sharedGameArchiveId(state.localGameId);
  const existing = games.find((game) => game.state.localGameId === id);
  if (existing?.roomClosedAt !== undefined && existing.roomClosedAt > closedAt) return "stale";
  const previous = new Map((existing?.state.players ?? []).map((player) => [player.id, player]));
  const players = state.players.map((player) => {
    const kept = previous.get(player.id);
    return {
      ...player,
      ...(kept?.personId ? { personId: kept.personId } : {}),
      ...(kept?.notPersonIds ? { notPersonIds: kept.notPersonIds } : {})
    };
  });
  return (await archiveGame({ ...state, localGameId: id, players }, closedAt)) ? "saved" : "failed";
}
