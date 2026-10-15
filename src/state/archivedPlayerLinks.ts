/**
 * Corrects which person players of already archived games count for in Player
 * History. Each change is written to those games' archive records only (see
 * updateArchivedGames), so caches, other tabs, the localStorage fallback, and
 * later backups all see it, and no other game changes.
 */
import { createPerson, indexPeople, relinkGamePlayer, type PlayerLinkChange } from "../domain/people";
import { updateArchivedGames } from "./gameArchive";
import { loadPeopleDirectory, updatePeopleDirectory } from "./peopleStore";
import { createId } from "./seedGame";

/** One player in one archived game. */
export type ArchivedPlayerRef = { gameId: string; playerId: string };

export type RelinkTarget =
  /** Not this person (the row's person); the player keeps only its name. */
  | { kind: "unlink"; personId: string }
  /** An existing person. `fromPersonId` is the row's person it is moved away from. */
  | { kind: "person"; personId: string; fromPersonId?: string }
  /** A new person with this name. */
  | { kind: "new"; name: string; fromPersonId?: string };

export type RelinkResult = { ok: true; personId?: string } | { error: string };

const SAVE_FAILED = "Could not save the change on this device.";

/** Applies one link change to the players in their archived games. */
export async function relinkArchivedPlayers(
  players: ArchivedPlayerRef[],
  target: RelinkTarget,
  now = new Date()
): Promise<RelinkResult> {
  if (players.length === 0) return { error: "Choose a game to change." };
  let change: PlayerLinkChange;
  if (target.kind === "new") {
    // The person is saved first: a failed archive write then leaves an unused
    // person to link to, rather than games pointing at a person that is not saved.
    const id = createId("person");
    let failure: string | null = null;
    const saved = updatePeopleDirectory((directory) => {
      const created = createPerson(directory, target.name, now.toISOString(), id);
      if ("error" in created) {
        failure = created.error;
        return null;
      }
      return created.directory;
    });
    if (!saved) return { error: failure ?? SAVE_FAILED };
    change = { kind: "link", personId: id, ...(target.fromPersonId ? { fromPersonId: target.fromPersonId } : {}) };
  } else if (target.kind === "person") {
    const root = indexPeople(loadPeopleDirectory()).rootId(target.personId);
    if (!root) return { error: "That person no longer exists." };
    change = { kind: "link", personId: root, ...(target.fromPersonId ? { fromPersonId: target.fromPersonId } : {}) };
  } else {
    change = target;
  }

  const directory = loadPeopleDirectory();
  const byGame = new Map<string, string[]>();
  for (const { gameId, playerId } of players) byGame.set(gameId, [...(byGame.get(gameId) ?? []), playerId]);
  const changed = await updateArchivedGames(
    [...byGame.keys()],
    (game) => {
      let state = game.state;
      for (const playerId of byGame.get(game.state.localGameId) ?? []) {
        state = relinkGamePlayer(state, playerId, change, directory) ?? state;
      }
      return state === game.state ? null : { ...game, state };
    },
    now
  );
  if (changed === null) return { error: SAVE_FAILED };
  // Nothing to change: another tab already did, or the game is gone.
  if (changed === 0) return { error: "That game already changed. Check Player History again." };
  return { ok: true, ...(change.kind === "link" ? { personId: change.personId } : {}) };
}
