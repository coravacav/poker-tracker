import { useCallback, useEffect } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { Transaction } from "../domain/pokerTypes";
import { createCapability, guestRoomHash } from "./capabilities";
import { roomErrorMessage, SHARING_UNAVAILABLE_MESSAGE } from "./convexRoomTransport";
import { clearGuestSession, saveGuestSession, saveRoomHistoryCredential } from "./sessionPersistence";
import { normalizeRoomState, type LocalEntryDestination, type SessionState } from "./sessionState";
import type { GuestSession, InvitePreview, RoomTransport } from "./types";

/** Folds an invitation preview into the joining session; a join error stays until the next try. */
function withInvitePreview(current: SessionState, preview: InvitePreview): SessionState {
  if (current.mode !== "joining") return current;
  const status =
    preview.status === "active"
      ? "active"
      : preview.status === "ended" || preview.status === "expired"
        ? "ended"
        : "invalid";
  return {
    ...current,
    preview: { status, name: preview.name, seats: preview.seats },
    error: current.preview.status === "loading" ? null : current.error
  };
}

/**
 * Loads the invitation preview while a visitor is deciding whether to join,
 * and keeps it live where the transport can, so seats taken by other phones
 * and players the host adds show up without a reload.
 */
export function useInvitePreview(
  session: SessionState,
  transport: RoomTransport,
  setSession: Dispatch<SetStateAction<SessionState>>
) {
  const route = session.mode === "joining" ? session.route : null;
  const loading = session.mode === "joining" && session.preview.status === "loading";
  useEffect(() => {
    if (!route) return;
    if (!transport.configured) {
      if (!loading) return;
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
    const fail = (error: unknown) =>
      setSession((current) =>
        current.mode === "joining" && current.preview.status === "loading"
          ? { ...current, preview: { status: "invalid" }, error: roomErrorMessage(error) }
          : current
      );
    if (transport.subscribeInvitePreview) {
      return transport.subscribeInvitePreview(
        { publicId: route.publicId, inviteSecret: route.inviteSecret },
        (preview) => setSession((current) => withInvitePreview(current, preview)),
        fail
      );
    }
    if (!loading) return;
    let cancelled = false;
    void transport
      .getInvitePreview(route.publicId, route.inviteSecret)
      .then((preview) => {
        if (!cancelled) setSession((current) => withInvitePreview(current, preview));
      })
      .catch((error) => {
        if (!cancelled) fail(error);
      });
    return () => {
      cancelled = true;
    };
  }, [route?.publicId, route?.inviteSecret, loading && !transport.subscribeInvitePreview, transport]);
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

  /** Joins on a seat (taking its player's name), or under a typed name when no seat is free. */
  const joinGame = useCallback(
    async (choice: { playerId: string } | { displayName: string }) => {
      const current = sessionRef.current;
      if (current.mode !== "joining" || current.preview.status !== "active") return;
      setSession({ ...current, joining: true, error: null });
      try {
        const guestSecret = createCapability();
        const room = await transport.joinRoom({
          publicId: current.route.publicId,
          inviteSecret: current.route.inviteSecret,
          guestSecret,
          ...choice
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
        // The seats may have changed (taken, removed, or joining closed):
        // refresh them, unless the preview is already live.
        if (!transport.subscribeInvitePreview) {
          const { publicId, inviteSecret } = current.route;
          void transport.getInvitePreview(publicId, inviteSecret).then((preview) => {
            setSession((next) =>
              next.mode === "joining" && next.route.publicId === publicId
                ? withInvitePreview(next, preview)
                : next
            );
          }).catch(() => undefined);
        }
      }
    },
    [refreshRoomHistory, transport]
  );

  /** Takes an open seat for a guest already in the room; resolves to whether it worked. */
  const claimSeat = useCallback(async (playerId: string) => {
    const current = sessionRef.current;
    const claim = transport.claimSeat;
    if (current.mode !== "guest" || !current.room || !claim) return false;
    try {
      await claim({
        publicId: current.credentials.publicId,
        guestSecret: current.credentials.guestSecret,
        playerId
      });
      setSession((next) => (next.mode === "guest" ? { ...next, error: null } : next));
      return true;
    } catch (error) {
      setSession((next) =>
        next.mode === "guest" ? { ...next, error: roomErrorMessage(error) } : next
      );
      return false;
    }
  }, [transport]);

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

  return { joinGame, claimSeat, submitGuestTransaction, leaveGuest, dismissInvite };
}
