import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { GameState } from "../domain/pokerTypes";
import { archiveGame } from "../state/gameArchive";
import type { GameAction } from "../state/gameReducer";
import { saveGameState } from "../state/persistence";
import {
  readLastVisitAt,
  shouldShowLocalEntry,
  writeLastVisitAt,
  type LocalEntry
} from "./localEntry";
import type { LocalEntryDestination, SessionState } from "./sessionState";

type LocalEntryTrackingOptions = {
  localState: GameState;
  localEntry: LocalEntry | null;
  sessionMode: SessionState["mode"];
  sessionRef: RefObject<SessionState>;
  localStateRef: RefObject<GameState>;
  localEntryRef: RefObject<LocalEntry | null>;
  setLocalEntry: Dispatch<SetStateAction<LocalEntry | null>>;
  setLocalEntryDestination: Dispatch<SetStateAction<LocalEntryDestination>>;
};

/** Persists the local game and decides when returning visitors see the Home screen. */
export function useLocalEntryTracking({
  localState,
  localEntry,
  sessionMode,
  sessionRef,
  localStateRef,
  localEntryRef,
  setLocalEntry,
  setLocalEntryDestination
}: LocalEntryTrackingOptions) {
  useEffect(() => {
    if (sessionMode === "local" && !localEntry) saveGameState(localState);
  }, [localEntry, localState, sessionMode]);

  useEffect(() => {
    const recordActiveVisit = () => {
      const current = sessionRef.current;
      if (current.mode === "local") {
        if (!localEntryRef.current) writeLastVisitAt();
        return;
      }

      if (
        current.mode === "guest" ||
        current.mode === "hosting" ||
        current.mode === "creating_room" ||
        current.mode === "ending" ||
        current.mode === "recovery_required" ||
        current.mode === "room_unavailable"
      ) {
        writeLastVisitAt();
      }
    };

    const evaluateReturn = () => {
      const current = sessionRef.current;
      if (current.mode === "local") {
        if (localEntryRef.current) return;

        const now = Date.now();
        const lastVisitAt = readLastVisitAt();
        if (shouldShowLocalEntry(lastVisitAt, now)) {
          setLocalEntry({
            reason: lastVisitAt === null ? "first_visit" : "stale_return",
            savedGame: localStateRef.current
          });
          setLocalEntryDestination("play");
          return;
        }

        writeLastVisitAt(now);
        return;
      }

      if (
        current.mode === "guest" ||
        current.mode === "hosting" ||
        current.mode === "creating_room" ||
        current.mode === "ending" ||
        current.mode === "recovery_required" ||
        current.mode === "room_unavailable"
      ) {
        writeLastVisitAt();
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        evaluateReturn();
      } else {
        recordActiveVisit();
      }
    };

    const onFocus = () => evaluateReturn();
    const onBlur = () => recordActiveVisit();
    const onPageHide = () => recordActiveVisit();

    evaluateReturn();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    window.addEventListener("pagehide", onPageHide);
    const activeVisitInterval = window.setInterval(recordActiveVisit, 60_000);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pagehide", onPageHide);
      window.clearInterval(activeVisitInterval);
    };
  }, [sessionMode]);
}

type LocalEntryActionOptions = {
  localDispatch: Dispatch<GameAction>;
  sessionRef: RefObject<SessionState>;
  localStateRef: RefObject<GameState>;
  localEntryRef: RefObject<LocalEntry | null>;
  setLocalEntry: Dispatch<SetStateAction<LocalEntry | null>>;
  setLocalEntryDestination: Dispatch<SetStateAction<LocalEntryDestination>>;
};

export function useLocalEntryActions({
  localDispatch,
  sessionRef,
  localStateRef,
  localEntryRef,
  setLocalEntry,
  setLocalEntryDestination
}: LocalEntryActionOptions) {
  const startingNewGameRef = useRef(false);

  const continueLocalGame = useCallback(() => {
    if (sessionRef.current.mode !== "local" || !localEntryRef.current) return;
    writeLastVisitAt();
    setLocalEntryDestination("play");
    setLocalEntry(null);
  }, []);

  const openHome = useCallback(() => {
    if (sessionRef.current.mode !== "local") return;
    setLocalEntry({ reason: "stale_return", savedGame: localStateRef.current });
    setLocalEntryDestination("play");
  }, []);

  const startNewLocalGame = useCallback(async () => {
    if (sessionRef.current.mode !== "local" || !localEntryRef.current || startingNewGameRef.current) return;

    const currentState = localStateRef.current;
    startingNewGameRef.current = true;
    let archived: boolean;
    try {
      archived = currentState.transactions.length === 0 || (await archiveGame(currentState));
    } finally {
      startingNewGameRef.current = false;
    }
    // The user may have left Home or changed the game while Player History was saving.
    if (
      sessionRef.current.mode !== "local" ||
      !localEntryRef.current ||
      localStateRef.current !== currentState
    ) {
      return;
    }
    if (!archived) {
      setLocalEntry((current) =>
        current
          ? {
              ...current,
              error: "Could not save the current game to Player History. Your game is still intact."
            }
          : current
      );
      return;
    }

    localDispatch({ type: "reset_game" });
    writeLastVisitAt();
    setLocalEntryDestination("setup");
    setLocalEntry(null);
  }, []);

  return { openHome, continueLocalGame, startNewLocalGame };
}
