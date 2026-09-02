import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Dispatch } from "react";
import type { GameState, Transaction } from "../domain/pokerTypes";
import { validatePersistedState } from "../domain/validation";
import { gameReducer, type GameAction } from "../state/gameReducer";
import {
  loadGameState,
  migratePersistedState,
  saveGameState,
  trySaveGameState
} from "../state/persistence";
import {
  createCapability,
  createInviteUrl,
  guestRoomHash,
  parseInviteRoute,
  type InviteRoute
} from "./capabilities";
import { convexRoomTransport, roomErrorMessage } from "./convexRoomTransport";
import {
  clearGuestSession,
  clearHostRecovery,
  getHostControllerId,
  loadGuestSession,
  loadHostRecovery,
  loadRoomHistoryCredentials,
  saveGuestSession,
  saveHostRecovery,
  saveRoomHistoryCredential
} from "./sessionPersistence";
import type {
  GuestRoomProjection,
  GuestSession,
  HostRecovery,
  HostRoomProjection,
  RoomHistoryProjection,
  RoomTransport
} from "./types";
import type { Id } from "../../convex/_generated/dataModel";

type InviteState = {
  mode: "joining";
  route: Extract<InviteRoute, { kind: "invite" }>;
  preview: { status: "loading" | "active" | "invalid" | "ended" | "closed"; name?: string };
  error: string | null;
  joining: boolean;
};

type GuestState = {
  mode: "guest";
  credentials: GuestSession;
  room: GuestRoomProjection | null;
  connected: boolean;
  error: string | null;
};

type HostState = {
  mode: "hosting" | "creating_room" | "ending" | "recovery_required";
  recovery: HostRecovery | null;
  room: HostRoomProjection | null;
  connected: boolean;
  pending: boolean;
  error: string | null;
};

type LocalState = { mode: "local"; notice: string | null };
type InvalidState = { mode: "invalid_invite"; message: string };
type SessionState = LocalState | InviteState | GuestState | HostState | InvalidState;

function normalizeRoomState(value: unknown): GameState | null {
  if (
    !validatePersistedState(value) ||
    (value.schemaVersion !== 6 && value.schemaVersion !== 7)
  ) {
    return null;
  }

  return migratePersistedState(value);
}

function updateHostRecovery(recovery: HostRecovery, room: HostRoomProjection): HostRecovery {
  const next = {
    ...recovery,
    roomName: room.name,
    lastKnownVersion: room.version
  };
  saveHostRecovery(next);
  return next;
}

function initialSession(localGameId: string): SessionState {
  const route = parseInviteRoute();
  if (route.kind === "invite") {
    return {
      mode: "joining",
      route,
      preview: { status: "loading" },
      error: null,
      joining: false
    };
  }
  if (route.kind === "guest_room") {
    const credentials = loadGuestSession(route.publicId);
    return credentials
      ? { mode: "guest", credentials, room: null, connected: false, error: null }
      : {
          mode: "invalid_invite",
          message: "This guest session is not available in this browser tab. Open the original invite again."
        };
  }
  const recovery = loadHostRecovery();
  if (recovery?.localGameId === localGameId) {
    return {
      mode: "hosting",
      recovery,
      room: null,
      connected: false,
      pending: false,
      error: null
    };
  }
  return { mode: "local", notice: null };
}

export function useGameSession(transport: RoomTransport = convexRoomTransport) {
  const [localState, localDispatch] = useReducer(gameReducer, undefined, loadGameState);
  const [session, setSession] = useState<SessionState>(() => initialSession(localState.localGameId));
  const [roomHistory, setRoomHistory] = useState<RoomHistoryProjection[]>([]);
  const sessionRef = useRef(session);
  const mutationPending = useRef(false);
  const historyCredentialSavedRef = useRef(new Set<string>());
  sessionRef.current = session;

  const refreshRoomHistory = useCallback(async () => {
    if (!transport.configured) {
      return;
    }
    const credentials = loadRoomHistoryCredentials();
    if (credentials.length === 0) return;
    const rooms = await transport.getRoomHistory(credentials);
    setRoomHistory(rooms.sort((left, right) => right.createdAt - left.createdAt));
  }, [transport]);

  useEffect(() => {
    void refreshRoomHistory();
  }, [refreshRoomHistory]);

  useEffect(() => {
    if (session.mode === "hosting" && session.recovery) {
      const key = `host:${session.recovery.publicId}`;
      if (historyCredentialSavedRef.current.has(key)) return;
      historyCredentialSavedRef.current.add(key);
      saveRoomHistoryCredential({
        schemaVersion: 1,
        publicId: session.recovery.publicId,
        role: "host",
        secret: session.recovery.hostSecret,
        roomName: session.recovery.roomName,
        joinedAt: Date.now()
      });
    } else if (session.mode === "guest") {
      const key = `guest:${session.credentials.publicId}`;
      if (historyCredentialSavedRef.current.has(key)) return;
      historyCredentialSavedRef.current.add(key);
      saveRoomHistoryCredential({
        schemaVersion: 1,
        publicId: session.credentials.publicId,
        role: "guest",
        secret: session.credentials.guestSecret,
        roomName: session.room?.name ?? "Shared poker game",
        joinedAt: Date.now(),
        displayName: session.credentials.displayName
      });
    }
  }, [session]);

  useEffect(() => {
    if (session.mode === "local") saveGameState(localState);
  }, [localState, session.mode]);

  useEffect(() => {
    if (session.mode === "local" || session.mode === "invalid_invite") return;
    return transport.subscribeToConnection((connected) => {
      setSession((current) =>
        current.mode === "guest" ||
        current.mode === "hosting" ||
        current.mode === "creating_room" ||
        current.mode === "ending" ||
        current.mode === "recovery_required"
          ? { ...current, connected }
          : current
      );
    });
  }, [session.mode, transport]);

  useEffect(() => {
    if (session.mode !== "joining" || session.preview.status !== "loading") return;
    if (!transport.configured) {
      setSession((current) =>
        current.mode === "joining"
          ? {
              ...current,
              preview: { status: "invalid" },
              error: "Realtime sharing is not configured on this installation."
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

  const finishHostSession = useCallback(
    (room: HostRoomProjection, recovery: HostRecovery) => {
      if (trySaveGameState(room.state)) {
        localDispatch({ type: "replace_state_from_import", state: room.state });
        clearHostRecovery();
        setSession({ mode: "local", notice: "Sharing ended. The final room state is saved locally." });
      } else {
        setSession({
          mode: "recovery_required",
          recovery: updateHostRecovery(recovery, room),
          room,
          connected: transport.connectionState(),
          pending: false,
          error: "The room ended, but its final state could not be saved locally. Retry recovery before continuing."
        });
      }
    },
    [transport]
  );

  useEffect(() => {
    if (
      (session.mode !== "hosting" && session.mode !== "ending" && session.mode !== "recovery_required") ||
      !session.recovery ||
      !transport.configured
    ) {
      return;
    }
    const recovery = session.recovery;
    const controllerId = getHostControllerId(() => createCapability(18));
    return transport.subscribeHost(
      { publicId: recovery.publicId, hostSecret: recovery.hostSecret, controllerId },
      (room) => {
        const normalizedState = normalizeRoomState(room.state);
        if (!normalizedState || normalizedState.localGameId !== recovery.localGameId) {
          setSession((current) =>
            current.mode === "hosting" || current.mode === "ending" || current.mode === "recovery_required"
              ? { ...current, error: "The hosted room returned an invalid game snapshot." }
              : current
          );
          return;
        }
        const normalizedRoom = { ...room, state: normalizedState };
        if (room.status === "ended" || room.status === "expired") {
          finishHostSession(normalizedRoom, recovery);
          return;
        }
        const nextRecovery = updateHostRecovery(recovery, normalizedRoom);
        const persisted = trySaveGameState(normalizedState);
        setSession((current) =>
          current.mode === "hosting" || current.mode === "ending" || current.mode === "recovery_required"
            ? {
                ...current,
                mode: "hosting",
                recovery: nextRecovery,
                room: normalizedRoom,
                error: persisted ? null : "Accepted room state could not be cached locally."
              }
            : current
        );
      },
      (error) => {
        setSession((current) =>
          current.mode === "hosting" || current.mode === "ending" || current.mode === "recovery_required"
            ? { ...current, error: roomErrorMessage(error) }
            : current
        );
      }
    );
  }, [
    finishHostSession,
    session.mode,
    "recovery" in session ? session.recovery?.publicId : null,
    "recovery" in session ? session.recovery?.hostSecret : null,
    "recovery" in session ? session.recovery?.localGameId : null,
    transport
  ]);

  useEffect(() => {
    if (session.mode !== "guest") return;
    const { credentials } = session;
    if (!transport.configured) {
      setSession((current) =>
        current.mode === "guest"
          ? { ...current, error: "Realtime sharing is not configured on this installation." }
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
    heartbeat();
    const interval = window.setInterval(heartbeat, 30_000);
    return () => {
      unsubscribe();
      window.clearInterval(interval);
    };
  }, [session.mode, session.mode === "guest" ? session.credentials : null, transport]);

  const shareGame = useCallback(async () => {
    if (sessionRef.current.mode !== "local") return;
    if (!transport.configured) {
      setSession({ mode: "local", notice: "Set VITE_CONVEX_URL before sharing a game." });
      return;
    }
    setSession({
      mode: "creating_room",
      recovery: null,
      room: null,
      connected: transport.connectionState(),
      pending: true,
      error: null
    });
    let provisionalRecovery: HostRecovery | null = null;
    try {
      const publicId = createCapability(18);
      const hostSecret = createCapability();
      const inviteSecret = createCapability();
      const controllerId = getHostControllerId(() => createCapability(18));
      const inviteUrl = createInviteUrl(publicId, inviteSecret);
      provisionalRecovery = {
        schemaVersion: 1,
        publicId,
        localGameId: localState.localGameId,
        hostSecret,
        inviteSecret,
        inviteUrl,
        roomName: localState.settings.gameName.trim() || "Poker Night",
        lastKnownVersion: 0
      };
      if (!saveHostRecovery(provisionalRecovery)) {
        throw new Error("The host recovery capability could not be saved locally.");
      }
      setSession((current) =>
        current.mode === "creating_room" ? { ...current, recovery: provisionalRecovery } : current
      );
      const room = await transport.createRoom({
        publicId,
        localGameId: localState.localGameId,
        snapshot: localState,
        hostSecret,
        inviteSecret,
        controllerId
      });
      const normalizedState = normalizeRoomState(room.state);
      if (!normalizedState) {
        throw new Error("The room returned an invalid game snapshot.");
      }
      const normalizedRoom = { ...room, state: normalizedState };
      const recovery: HostRecovery = {
        ...provisionalRecovery,
        roomName: normalizedRoom.name,
        lastKnownVersion: normalizedRoom.version
      };
      saveHostRecovery(recovery);
      saveRoomHistoryCredential({
        schemaVersion: 1,
        publicId: recovery.publicId,
        role: "host",
        secret: recovery.hostSecret,
        roomName: recovery.roomName,
        joinedAt: Date.now()
      });
      void refreshRoomHistory();
      setSession({
        mode: "hosting",
        recovery,
        room: {
          ...normalizedRoom,
          guestCount: 0,
          guestRequests: [],
          controllerStatus: "active"
        },
        connected: transport.connectionState(),
        pending: false,
        error: null
      });
    } catch (error) {
      if (provisionalRecovery) clearHostRecovery();
      setSession({ mode: "local", notice: roomErrorMessage(error) });
    }
  }, [localState, refreshRoomHistory, transport]);

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
          displayName: credentials.displayName
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

  const dispatch = useMemo<Dispatch<GameAction>>(
    () => (action) => {
      const current = sessionRef.current;
      if (current.mode === "local") {
        localDispatch(action);
        return;
      }
      if (current.mode !== "hosting" || !current.recovery || !current.room) return;
      if (!current.connected || current.room.controllerStatus !== "active" || mutationPending.current) {
        setSession({
          ...current,
          error: !current.connected
            ? "Reconnect before changing the shared game. Actions are not queued offline."
            : current.room.controllerStatus !== "active"
              ? "Another tab controls this hosted room."
              : "Wait for the current room change to be accepted."
        });
        return;
      }
      mutationPending.current = true;
      setSession({ ...current, pending: true, error: null });
      const controllerId = getHostControllerId(() => createCapability(18));
      void transport
        .applyAction({
          publicId: current.recovery.publicId,
          hostSecret: current.recovery.hostSecret,
          controllerId,
          expectedVersion: current.room.version,
          clientActionId: createCapability(18),
          action
        })
        .then((room) => {
          mutationPending.current = false;
          const nextRoom: HostRoomProjection = {
            ...current.room!,
            ...room,
            guestCount: current.room!.guestCount,
            controllerStatus: "active"
          };
          const recovery = updateHostRecovery(current.recovery!, nextRoom);
          const persisted = trySaveGameState(nextRoom.state);
          setSession({
            mode: "hosting",
            recovery,
            room: nextRoom,
            connected: transport.connectionState(),
            pending: false,
            error: persisted ? null : "Accepted room state could not be cached locally."
          });
        })
        .catch((error) => {
          mutationPending.current = false;
          setSession((next) =>
            next.mode === "hosting"
              ? { ...next, pending: false, error: roomErrorMessage(error) }
              : next
          );
        });
    },
    [transport]
  );

  const endSharing = useCallback(async () => {
    const current = sessionRef.current;
    if (
      (current.mode !== "hosting" && current.mode !== "recovery_required") ||
      !current.recovery ||
      !current.room
    ) return;
    if (!current.connected) {
      setSession({ ...current, error: "Reconnect before ending sharing." });
      return;
    }
    const endingActionId = current.recovery.endingActionId ?? createCapability(18);
    const recovery = { ...current.recovery, endingActionId };
    saveHostRecovery(recovery);
    setSession({ ...current, mode: "ending", recovery, pending: true, error: null });
    try {
      const room = await transport.endRoom({
        publicId: recovery.publicId,
        hostSecret: recovery.hostSecret,
        controllerId: getHostControllerId(() => createCapability(18)),
        expectedVersion: current.room.version,
        clientActionId: endingActionId
      });
      finishHostSession({ ...current.room, ...room }, recovery);
    } catch (error) {
      setSession({
        ...current,
        mode: "recovery_required",
        recovery,
        pending: false,
        error: `Final synchronization was not confirmed: ${roomErrorMessage(error)}`
      });
    }
  }, [finishHostSession, transport]);

  const retryRecovery = useCallback(() => {
    const current = sessionRef.current;
    if (current.mode !== "recovery_required" || !current.recovery || !current.room) return;
    if (current.room.status === "ended" || current.room.status === "expired") {
      finishHostSession(current.room, current.recovery);
    } else {
      void endSharing();
    }
  }, [endSharing, finishHostSession]);

  const claimHost = useCallback(async () => {
    const current = sessionRef.current;
    if (current.mode !== "hosting" || !current.recovery) return;
    try {
      await transport.claimHost(
        current.recovery.publicId,
        current.recovery.hostSecret,
        getHostControllerId(() => createCapability(18))
      );
      setSession({ ...current, error: null });
    } catch (error) {
      setSession({ ...current, error: roomErrorMessage(error) });
    }
  }, [transport]);

  const markNotificationsRead = useCallback(async () => {
    const current = sessionRef.current;
    try {
      const hostSession =
        current.mode === "hosting" ||
        current.mode === "ending" ||
        current.mode === "recovery_required";
      if (hostSession && current.recovery && current.room) {
        await transport.acknowledgeHostNotifications({
          publicId: current.recovery.publicId,
          hostSecret: current.recovery.hostSecret,
          throughVersion: current.room.version
        });
      } else if (current.mode === "guest" && current.room) {
        await transport.acknowledgeGuestNotifications({
          publicId: current.credentials.publicId,
          guestSecret: current.credentials.guestSecret,
          throughVersion: current.room.version
        });
      }
    } catch (error) {
      setSession((next) =>
        next.mode === "guest" ||
        next.mode === "hosting" ||
        next.mode === "ending" ||
        next.mode === "recovery_required"
          ? { ...next, error: roomErrorMessage(error) }
          : next
      );
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

  const decideGuestTransaction = useCallback(async (
    requestId: Id<"roomGuestRequests">,
    decision: "approved" | "rejected"
  ) => {
    const current = sessionRef.current;
    if (current.mode !== "hosting" || !current.recovery || !current.room) return;
    try {
      await transport.decideGuestTransaction({
        publicId: current.recovery.publicId,
        hostSecret: current.recovery.hostSecret,
        controllerId: getHostControllerId(() => createCapability(18)),
        requestId,
        decision,
        expectedVersion: current.room.version
      });
      setSession({ ...current, error: null });
    } catch (error) {
      setSession((next) =>
        next.mode === "hosting" ? { ...next, error: roomErrorMessage(error) } : next
      );
    }
  }, [transport]);

  const setJoiningOpen = useCallback(async (open: boolean) => {
    const current = sessionRef.current;
    if (current.mode !== "hosting" || !current.recovery) return;
    try {
      await transport.setJoiningOpen({
        publicId: current.recovery.publicId,
        hostSecret: current.recovery.hostSecret,
        open
      });
      setSession({ ...current, error: null });
    } catch (error) {
      setSession({ ...current, error: roomErrorMessage(error) });
    }
  }, [transport]);

  const rotateInvite = useCallback(async () => {
    const current = sessionRef.current;
    if (current.mode !== "hosting" || !current.recovery) return;
    const inviteSecret = createCapability();
    try {
      await transport.rotateInvite({
        publicId: current.recovery.publicId,
        hostSecret: current.recovery.hostSecret,
        inviteSecret
      });
      const recovery = {
        ...current.recovery,
        inviteSecret,
        inviteUrl: createInviteUrl(current.recovery.publicId, inviteSecret)
      };
      saveHostRecovery(recovery);
      setSession({ ...current, recovery, error: null });
    } catch (error) {
      setSession({ ...current, error: roomErrorMessage(error) });
    }
  }, [transport]);

  const revokeGuest = useCallback(async (guestId: Id<"roomGuests">) => {
    const current = sessionRef.current;
    if (current.mode !== "hosting" || !current.recovery) return;
    try {
      await transport.revokeGuest({
        publicId: current.recovery.publicId,
        hostSecret: current.recovery.hostSecret,
        guestId
      });
      setSession({ ...current, error: null });
    } catch (error) {
      setSession({ ...current, error: roomErrorMessage(error) });
    }
  }, [transport]);

  const leaveGuest = useCallback(() => {
    clearGuestSession();
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    setSession({ mode: "local", notice: null });
  }, []);

  const dismissInvite = useCallback(() => {
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    setSession({ mode: "local", notice: null });
  }, []);

  const state =
    session.mode === "guest" && session.room
      ? session.room.state
      : (session.mode === "hosting" || session.mode === "ending" || session.mode === "recovery_required") &&
          session.room
        ? session.room.state
        : localState;
  const isGuest = session.mode === "guest";
  const hostReadOnly =
    session.mode === "creating_room" ||
    session.mode === "ending" ||
    session.mode === "recovery_required" ||
    (session.mode === "hosting" &&
      (!session.connected || session.pending || session.room?.controllerStatus !== "active"));

  return {
    state,
    dispatch,
    session,
    isGuest,
    forcedReadOnly: isGuest || hostReadOnly,
    shareGame,
    joinGame,
    endSharing,
    retryRecovery,
    claimHost,
    markNotificationsRead,
    submitGuestTransaction,
    decideGuestTransaction,
    setJoiningOpen,
    rotateInvite,
    revokeGuest,
    leaveGuest,
    dismissInvite,
    roomHistory,
    refreshRoomHistory
  };
}
