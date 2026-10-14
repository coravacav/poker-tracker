import { useEffect, useState } from "react";
import type { ArchivedGame } from "../domain/sessionHistory";
import { GAME_ARCHIVE_CHANGED_EVENT, loadArchivedGames, peekArchivedGames } from "./gameArchive";

/**
 * Player History games, newest first, kept up to date with archive changes in
 * this and other tabs. Null only until the first load finishes; later reloads
 * keep showing the previous games instead of flashing a loading state.
 */
export function useArchivedGames(): ArchivedGame[] | null {
  const [games, setGames] = useState<ArchivedGame[] | null>(() => peekArchivedGames() ?? null);
  useEffect(() => {
    let latest = 0;
    let active = true;
    const refresh = () => {
      const request = ++latest;
      void loadArchivedGames().then((next) => {
        if (active && request === latest) setGames(next);
      });
    };
    refresh();
    window.addEventListener(GAME_ARCHIVE_CHANGED_EVENT, refresh);
    return () => {
      active = false;
      window.removeEventListener(GAME_ARCHIVE_CHANGED_EVENT, refresh);
    };
  }, []);
  return games;
}
