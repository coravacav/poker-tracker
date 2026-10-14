import { useMemo, useSyncExternalStore } from "react";
import type { PeopleDirectory } from "../domain/people";
import { buildPersonSuggestions, buildPlayerHistoryStats, type PersonSuggestion } from "../domain/sessionHistory";
import { PEOPLE_CHANGED_EVENT, loadPeopleDirectory } from "./peopleStore";
import { useArchivedGames } from "./useArchivedGames";

function subscribe(onChange: () => void): () => void {
  window.addEventListener(PEOPLE_CHANGED_EVENT, onChange);
  return () => window.removeEventListener(PEOPLE_CHANGED_EVENT, onChange);
}

/** This device's people directory, kept current with changes here and in other tabs. */
export function usePeopleDirectory(): PeopleDirectory {
  return useSyncExternalStore(subscribe, loadPeopleDirectory, loadPeopleDirectory);
}

/** People and earlier player names to offer while entering players, most recent first. */
export function usePersonSuggestions(): { directory: PeopleDirectory; suggestions: PersonSuggestion[] } {
  const directory = usePeopleDirectory();
  const games = useArchivedGames();
  const suggestions = useMemo(
    () => buildPersonSuggestions(buildPlayerHistoryStats(games ?? [], directory), directory),
    [directory, games]
  );
  return { directory, suggestions };
}
