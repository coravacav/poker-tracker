import { useCallback, useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { roomErrorCode, roomErrorMessage, SHARING_UNAVAILABLE_MESSAGE } from "./convexRoomTransport";
import { guestRoomHash } from "./capabilities";
import { loadGuestSession } from "./sessionPersistence";
import { normalizeRoomState, type SessionState } from "./sessionState";
import type { RoomTransport } from "./types";

type SpectatorSessionOptions = {
  session: SessionState;
  transport: RoomTransport;
  setSession: Dispatch<SetStateAction<SessionState>>;
  /** The session this device would open on its own (hosting, a guest session, or local). */
  resolveSession: () => SessionState;
  /** Opens Home when leaving leads nowhere else. */
  onLeave: () => void;
};

/** The watch link: a read-only room subscription plus watcher presence heartbeats. */
export function useSpectatorSession({
  session,
  transport,
  setSession,
  resolveSession,
  onLeave
}: SpectatorSessionOptions) {
  const route = session.mode === "spectating" ? session.route : null;
  const presenceSessionId = session.mode === "spectating" ? session.presenceSessionId : null;

  useEffect(() => {
    if (!route || !presenceSessionId) return;
    const subscribe = transport.subscribeSpectator;
    if (!transport.configured || !subscribe) {
      setSession((current) =>
        current.mode === "spectating" ? { ...current, error: SHARING_UNAVAILABLE_MESSAGE } : current
      );
      return;
    }
    const args = { publicId: route.publicId, spectatorSecret: route.spectatorSecret };
    const unsubscribe = subscribe(
      args,
      (room) => {
        const normalizedState = normalizeRoomState(room.state);
        setSession((current) =>
          current.mode !== "spectating"
            ? current
            : normalizedState
              ? { ...current, room: { ...room, state: normalizedState }, error: null }
              : { ...current, error: "Room data is invalid." }
        );
      },
      (error) => {
        // A turned-off, rotated, or pruned link shows nothing of the room any more.
        const gone = ["INVALID_CAPABILITY", "ROOM_NOT_FOUND", "ROOM_ENDED"].includes(
          roomErrorCode(error) ?? ""
        );
        setSession((current) =>
          current.mode === "spectating"
            ? { ...current, error: roomErrorMessage(error), ...(gone ? { room: null } : {}) }
            : current
        );
      }
    );
    const heartbeat = () => {
      if (!transport.connectionState() || document.visibilityState === "hidden") return;
      void transport
        .spectatorHeartbeat?.({ ...args, sessionId: presenceSessionId })
        .catch(() => undefined);
    };
    heartbeat();
    const interval = window.setInterval(heartbeat, 30_000);
    const heartbeatWhenVisible = () => {
      if (document.visibilityState === "visible") heartbeat();
    };
    document.addEventListener("visibilitychange", heartbeatWhenVisible);
    window.addEventListener("focus", heartbeat);
    window.addEventListener("online", heartbeat);
    return () => {
      unsubscribe();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", heartbeatWhenVisible);
      window.removeEventListener("focus", heartbeat);
      window.removeEventListener("online", heartbeat);
    };
  }, [route?.publicId, route?.spectatorSecret, presenceSessionId, transport]);

  /**
   * Leaving goes back to whatever this device was doing before the watch link
   * opened: the room it hosts, the guest session in this tab, or else Home.
   */
  const leaveSpectating = useCallback(() => {
    const guest = loadGuestSession();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}${guest ? guestRoomHash(guest.publicId) : ""}`
    );
    const next = resolveSession();
    setSession(next);
    if (next.mode === "local") onLeave();
  }, [onLeave, resolveSession]);

  return { leaveSpectating };
}
