import { useCallback, useEffect } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { Transaction } from "../domain/pokerTypes";
import { createCapability, guestRoomHash } from "./capabilities";
import { roomErrorMessage, SHARING_UNAVAILABLE_MESSAGE } from "./convexRoomTransport";
import { clearGuestSession, saveGuestSession, saveRoomHistoryCredential } from "./sessionPersistence";
import { normalizeRoomState, type LocalEntryDestination, type SessionState } from "./sessionState";
import type { GuestSession, RoomTransport } from "./types";

/** Loads the invitation preview while a visitor is deciding whether to join. */
export function useInvitePreview(
  session: SessionState,
  transport: RoomTransport,
  setSession: Dispatch<SetStateAction<SessionState>>
) {
  useEffect(() => {
    if (session.mode !== "joining" || session.preview.status !== "loading") return;
    if (!transport.configured) {
      setSession((current) =>
        current.mode === "joining"
          ? {
              ...current,
              preview: { status: "invalid" },
              error: SHARING_UNAVAILABLE_MESSAGE
            }
          : current
      );
      return;
    }
    let cancelled = false;
    void transport
      .getInvitePreview(session.route.publicId, session.route.inviteSecret)
      .then((preview) => {
        if (cancelled) return;
        setSession((current) => {
          if (current.mode !== "joining") return current;
          const status =
            preview.status === "active"
              ? "active"
              : preview.status === "ended" || preview.status === "expired"
                ? "ended"
                : "invalid";
          return { ...current, preview: { status, name: preview.name }, error: null };
        });
      })
      .catch((error) => {
        if (!cancelled) {
          setSession((current) =>
            current.mode === "joining"
              ? { ...current, preview: { status: "invalid" }, error: roomErrorMessage(error) }
              : current
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session, transport]);
}

type GuestSessionOptions = {
  session: SessionState;
  transport: RoomTransport;
  deploymentUrl: string | null;
  sessionRef: RefObject<SessionState>;
  setSession: Dispatch<SetStateAction<SessionState>>;
  setLocalEntryDestination: Dispatch<SetStateAction<LocalEntryDestination>>;
  refreshRoomHistory: () => Promise<void>;
};

/** Guest room subscription, presence heartbeats, joining by invite, and guest requests. */
export function useGuestSession({
  session,
  transport,
  deploymentUrl,
  sessionRef,
  setSession,
  setLocalEntryDestination,
  refreshRoomHistory
}: GuestSessionOptions) {
  useEffect(() => {
    if (session.mode !== "guest") return;
    const { credentials } = session;
    if (!transport.configured) {
      setSession((current) =>
        current.mode === "guest"
          ? { ...current, error: SHARING_UNAVAILABLE_MESSAGE }
          : current
      );
      return;
    }
    const unsubscribe = transport.subscribeGuest(
      { publicId: credentials.publicId, guestSecret: credentials.guestSecret },
      (room) => {
        const normalizedState = normalizeRoomState(room.state);
        if (!normalizedState) {
          setSession((current) =>
            current.mode === "guest" ? { ...current, error: "Room data is invalid." } : current
          );
          return;
        }
        setSession((current) =>
          current.mode === "guest"
            ? { ...current, room: { ...room, state: normalizedState }, error: null }
            : current
        );
      },
      (error) => {
        setSession((current) =>
          current.mode === "guest" ? { ...current, error: roomErrorMessage(error) } : current
        );
      }
    );
    const heartbeat = () => {
      if (transport.connectionState()) {
        void transport
          .heartbeat(
            credentials.publicId,
            credentials.guestSecret,
            credentials.presenceSessionId
          )
          .catch(() => undefined);
      }
    };
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
  }, [session.mode, session.mode === "guest" ? session.credentials : null, transport]);

  const joinGame = useCallback(
    async (displayName: string) => {
      const current = sessionRef.current;
      if (current.mode !== "joining" || current.preview.status !== "active") return;
      setSession({ ...current, joining: true, error: null });
      try {
        const guestSecret = createCapability();
        const room = await transport.joinRoom({
          publicId: current.route.publicId,
          inviteSecret: current.route.inviteSecret,
          guestSecret,
          displayName
        });
        const normalizedState = normalizeRoomState(room.state);
        if (!normalizedState) {
          throw new Error("The room returned an invalid game snapshot.");
        }
        const normalizedRoom = { ...room, state: normalizedState };
        const credentials: GuestSession = {
          schemaVersion: 1,
          publicId: current.route.publicId,
          guestSecret,
          presenceSessionId: createCapability(18),
          displayName: normalizedRoom.displayName
        };
        saveGuestSession(credentials);
        saveRoomHistoryCredential({
          schemaVersion: 1,
          publicId: credentials.publicId,
          role: "guest",
          secret: credentials.guestSecret,
          roomName: normalizedRoom.name,
          joinedAt: Date.now(),
          displayName: credentials.displayName,
          ...(deploymentUrl ? { deploymentUrl } : {})
        });
        void refreshRoomHistory();
        window.history.replaceState(null, "", guestRoomHash(credentials.publicId));
        setSession({
          mode: "guest",
          credentials,
          room: normalizedRoom,
          connected: transport.connectionState(),
          error: null
        });
      } catch (error) {
        setSession((next) =>
          next.mode === "joining" ? { ...next, joining: false, error: roomErrorMessage(error) } : next
        );
      }
    },
    [refreshRoomHistory, transport]
  );

  const submitGuestTransaction = useCallback(async (transaction: Transaction) => {
    const current = sessionRef.current;
    if (current.mode !== "guest" || !current.room) return;
    try {
      await transport.submitGuestTransaction({
        publicId: current.credentials.publicId,
        guestSecret: current.credentials.guestSecret,
        transaction
      });
      setSession((next) =>
        next.mode === "guest"
          ? { ...next, error: "Request sent to the host for approval." }
          : next
      );
    } catch (error) {
      setSession((next) =>
        next.mode === "guest" ? { ...next, error: roomErrorMessage(error) } : next
      );
    }
  }, [transport]);

  const leaveGuest = useCallback(() => {
    clearGuestSession();
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    setLocalEntryDestination("play");
    setSession({ mode: "local", notice: null });
  }, []);

  const dismissInvite = useCallback(() => {
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    setLocalEntryDestination("play");
    setSession({ mode: "local", notice: null });
  }, []);

  return { joinGame, submitGuestTransaction, leaveGuest, dismissInvite };
}
