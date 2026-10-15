import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { GameState } from "../domain/pokerTypes";
import type { GameAction } from "../state/gameReducer";
import { trySaveGameState } from "../state/persistence";
import { createCapability, createInviteUrl } from "./capabilities";
import { roomErrorCode, roomErrorMessage, SHARING_UNAVAILABLE_MESSAGE } from "./convexRoomTransport";
import type { FriendProfile } from "./friendProfiles";
import {
  clearHostRecovery,
  getHostControllerId,
  loadHostRecovery,
  saveHostRecovery,
  saveRoomHistoryCredential
} from "./sessionPersistence";
import {
  normalizeRoomState,
  updateHostRecovery,
  withRoomMetadata,
  type HostState,
  type SessionState
} from "./sessionState";
import type { HostRecovery, HostRoomProjection, RoomTransport } from "./types";

const HOST_MODES: ReadonlySet<SessionState["mode"]> = new Set([
  "hosting",
  "ending",
  "recovery_required"
]);

/** True when `session` is an active, ending, or recovering host session for `publicId`. */
function isHostSessionFor(session: SessionState, publicId: string): session is HostState & {
  mode: "hosting" | "ending" | "recovery_required";
  recovery: HostRecovery;
} {
  return HOST_MODES.has(session.mode) && (session as HostState).recovery?.publicId === publicId;
}

type HostSessionOptions = {
  session: SessionState;
  transport: RoomTransport;
  deploymentUrl: string | null;
  friendProfile: FriendProfile | null;
  localDispatch: Dispatch<GameAction>;
  sessionRef: RefObject<SessionState>;
  localStateRef: RefObject<GameState>;
  setSession: Dispatch<SetStateAction<SessionState>>;
  refreshRoomHistory: () => Promise<void>;
};

/**
 * Hosted room lifecycle: subscription, sharing a local game, routing game
 * actions to the room, ending sharing, and recovering an unconfirmed end.
 */
export function useHostSession({
  session,
  transport,
  deploymentUrl,
  friendProfile,
  localDispatch,
  sessionRef,
  localStateRef,
  setSession,
  refreshRoomHistory
}: HostSessionOptions) {
  const lastAcceptedHostStateRef = useRef(localStateRef.current);
  const mutationPending = useRef(false);

  const finishHostSession = useCallback(
    (room: HostRoomProjection, recovery: HostRecovery) => {
      if (trySaveGameState(room.state)) {
        localDispatch({ type: "replace_state_from_import", state: room.state });
        clearHostRecovery();
        setSession({ mode: "local", notice: "Sharing ended. The final room state is saved locally." });
      } else {
        setSession({
          mode: "recovery_required",
          recovery: updateHostRecovery(recovery, room, deploymentUrl),
          room,
          connected: transport.connectionState(),
          roomReady: true,
          pending: false,
          error: "The room ended, but its final state could not be saved locally. Retry recovery before continuing."
        });
      }
    },
    [deploymentUrl, transport]
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
              ? {
                  ...current,
                  roomReady: false,
                  error: "The hosted room returned an invalid game snapshot."
                }
              : current
          );
          return;
        }
        const normalizedRoom = { ...room, state: normalizedState };
        if (room.status === "ended" || room.status === "expired") {
          finishHostSession(normalizedRoom, recovery);
          return;
        }
        // Build on the latest stored recovery record: a rotated invite or a
        // pending ending action id may have been saved since this subscription
        // began, possibly before React has rendered that session update.
        const stored = loadHostRecovery();
        updateHostRecovery(
          stored?.publicId === recovery.publicId ? stored : recovery,
          normalizedRoom,
          deploymentUrl
        );
        lastAcceptedHostStateRef.current = normalizedState;
        localDispatch({ type: "replace_state_from_import", state: normalizedState });
        const persisted = trySaveGameState(normalizedState);
        setSession((current) =>
          current.mode === "hosting" || current.mode === "ending" || current.mode === "recovery_required"
            ? {
                ...current,
                mode: "hosting",
                recovery: withRoomMetadata(current.recovery ?? recovery, normalizedRoom, deploymentUrl),
                room: normalizedRoom,
                roomReady: true,
                error: persisted ? null : "Accepted room state could not be cached locally."
              }
            : current
        );
      },
      (error) => {
        setSession((current) => {
          if (
            current.mode !== "hosting" &&
            current.mode !== "ending" &&
            current.mode !== "recovery_required"
          ) {
            return current;
          }
          if (roomErrorCode(error) === "ROOM_NOT_FOUND") {
            return {
              ...current,
              mode: "room_unavailable",
              room: null,
              roomReady: false,
              pending: false,
              error: roomErrorMessage(error)
            };
          }
          return { ...current, roomReady: false, error: roomErrorMessage(error) };
        });
      }
    );
  }, [
    finishHostSession,
    session.mode,
    "recovery" in session ? session.recovery?.publicId : null,
    "recovery" in session ? session.recovery?.hostSecret : null,
    "recovery" in session ? session.recovery?.localGameId : null,
    deploymentUrl,
    transport
  ]);

  const shareGame = useCallback(async () => {
    const current = sessionRef.current;
    if (current.mode !== "local" && current.mode !== "room_unavailable") return;
    if (!transport.configured) {
      setSession({ mode: "local", notice: SHARING_UNAVAILABLE_MESSAGE });
      return;
    }
    const sourceState =
      current.mode === "room_unavailable"
        ? lastAcceptedHostStateRef.current
        : localStateRef.current;
    setSession({
      mode: "creating_room",
      recovery: null,
      room: null,
      connected: transport.connectionState(),
      roomReady: false,
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
        localGameId: sourceState.localGameId,
        hostSecret,
        inviteSecret,
        inviteUrl,
        roomName: sourceState.settings.gameName.trim() || "Poker Night",
        lastKnownVersion: 0,
        ...(deploymentUrl ? { deploymentUrl } : {})
      };
      if (!saveHostRecovery(provisionalRecovery)) {
        throw new Error("The host recovery capability could not be saved locally.");
      }
      setSession((current) =>
        current.mode === "creating_room" ? { ...current, recovery: provisionalRecovery } : current
      );
      const room = await transport.createRoom({
        publicId,
        localGameId: sourceState.localGameId,
        snapshot: sourceState,
        hostSecret,
        inviteSecret,
        controllerId,
        ...(friendProfile
          ? {
              friendCode: friendProfile.friendCode,
              profileOwnerSecret: friendProfile.ownerSecret,
              visibleToFriends: true
            }
          : {})
      });
      const normalizedState = normalizeRoomState(room.state);
      if (!normalizedState) {
        throw new Error("The room returned an invalid game snapshot.");
      }
      const normalizedRoom = { ...room, state: normalizedState };
      lastAcceptedHostStateRef.current = normalizedState;
      localDispatch({ type: "replace_state_from_import", state: normalizedState });
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
        roomReady: true,
        pending: false,
        error: null
      });
    } catch (error) {
      if (provisionalRecovery) clearHostRecovery();
      setSession({ mode: "local", notice: roomErrorMessage(error) });
    }
  }, [deploymentUrl, friendProfile, refreshRoomHistory, transport]);

  const dispatch = useMemo<Dispatch<GameAction>>(
    () => (action) => {
      const current = sessionRef.current;
      if (current.mode === "local") {
        localDispatch(action);
        return;
      }
      if (current.mode !== "hosting" || !current.recovery || !current.room) return;
      const { publicId, hostSecret } = current.recovery;
      if (!current.connected || current.room.controllerStatus !== "active" || mutationPending.current) {
        const error = !current.connected
          ? "Reconnect before changing the shared game. Actions are not queued offline."
          : current.room.controllerStatus !== "active"
            ? "Another tab controls this hosted room."
            : "Wait for the current room change to be accepted.";
        setSession((next) => (isHostSessionFor(next, publicId) ? { ...next, error } : next));
        return;
      }
      mutationPending.current = true;
      setSession((next) =>
        isHostSessionFor(next, publicId) ? { ...next, pending: true, error: null } : next
      );
      const controllerId = getHostControllerId(() => createCapability(18));
      void transport
        .applyAction({
          publicId,
          hostSecret,
          controllerId,
          expectedVersion: current.room.version,
          clientActionId: createCapability(18),
          action
        })
        .then((room) => {
          mutationPending.current = false;
          if (!isHostSessionFor(sessionRef.current, publicId)) return;
          // The subscription may already have delivered this version or a newer
          // one (guest approvals, takeover); never roll the room back.
          const stored = loadHostRecovery();
          const base = stored?.publicId === publicId ? stored : current.recovery!;
          const alreadyCurrent = base.lastKnownVersion >= room.version;
          let persisted = true;
          if (!alreadyCurrent) {
            updateHostRecovery(base, room, deploymentUrl);
            lastAcceptedHostStateRef.current = room.state;
            localDispatch({ type: "replace_state_from_import", state: room.state });
            persisted = trySaveGameState(room.state);
          }
          setSession((next) => {
            if (next.mode !== "hosting" || next.recovery?.publicId !== publicId) return next;
            const error = persisted ? null : "Accepted room state could not be cached locally.";
            if (!next.room || next.room.version >= room.version) {
              return { ...next, pending: false, error };
            }
            const nextRoom: HostRoomProjection = {
              ...next.room,
              ...room,
              controllerStatus: "active"
            };
            return {
              ...next,
              recovery: withRoomMetadata(next.recovery, nextRoom, deploymentUrl),
              room: nextRoom,
              connected: transport.connectionState(),
              roomReady: true,
              pending: false,
              error
            };
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
    [deploymentUrl, transport]
  );

  const endSharing = useCallback(async () => {
    const current = sessionRef.current;
    if (
      (current.mode !== "hosting" && current.mode !== "recovery_required") ||
      !current.recovery ||
      !current.room
    ) return;
    const { publicId } = current.recovery;
    if (!current.connected) {
      setSession((next) =>
        isHostSessionFor(next, publicId) ? { ...next, error: "Reconnect before ending sharing." } : next
      );
      return;
    }
    const endingActionId = current.recovery.endingActionId ?? createCapability(18);
    const recovery = { ...current.recovery, endingActionId };
    saveHostRecovery(recovery);
    setSession((next) =>
      isHostSessionFor(next, publicId)
        ? {
            ...next,
            mode: "ending",
            recovery: { ...next.recovery, endingActionId },
            pending: true,
            error: null
          }
        : next
    );
    try {
      const room = await transport.endRoom({
        publicId: recovery.publicId,
        hostSecret: recovery.hostSecret,
        controllerId: getHostControllerId(() => createCapability(18)),
        expectedVersion: current.room.version,
        clientActionId: endingActionId
      });
      const latest = sessionRef.current;
      const latestRoom = isHostSessionFor(latest, publicId) && latest.room ? latest.room : current.room;
      const stored = loadHostRecovery();
      finishHostSession({ ...latestRoom, ...room }, stored?.publicId === publicId ? stored : recovery);
    } catch (error) {
      // A room update can land while ending (and finishHostSession may have
      // already left the host session), so only mark recovery on the latest
      // host state for this room.
      setSession((next) =>
        isHostSessionFor(next, publicId)
          ? {
              ...next,
              mode: "recovery_required",
              recovery: { ...next.recovery, endingActionId },
              pending: false,
              error: `Final synchronization was not confirmed: ${roomErrorMessage(error)}`
            }
          : next
      );
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

  const retryUnavailableRoom = useCallback(() => {
    const current = sessionRef.current;
    if (current.mode !== "room_unavailable" || !current.recovery) return;
    setSession({
      ...current,
      mode: "hosting",
      room: null,
      roomReady: false,
      connected: transport.connectionState(),
      pending: false,
      error: null
    });
  }, [transport]);

  const continueLocally = useCallback(() => {
    const current = sessionRef.current;
    if (current.mode !== "room_unavailable") return;
    const stateToKeep = lastAcceptedHostStateRef.current;
    if (!trySaveGameState(stateToKeep)) {
      setSession({
        ...current,
        error: "Could not save the local copy. Keep this recovery record and try again."
      });
      return;
    }
    localDispatch({ type: "replace_state_from_import", state: stateToKeep });
    clearHostRecovery();
    setSession({
      mode: "local",
      notice: "The shared room is unavailable. Your latest accepted game is safe locally."
    });
  }, []);

  return {
    dispatch,
    shareGame,
    endSharing,
    retryRecovery,
    retryUnavailableRoom,
    continueLocally
  };
}
