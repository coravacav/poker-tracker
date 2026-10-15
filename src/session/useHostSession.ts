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
  saveHostRecovery,
  saveRoomHistoryCredential
} from "./sessionPersistence";
import { normalizeRoomState, updateHostRecovery, type SessionState } from "./sessionState";
import type { HostRecovery, HostRoomProjection, RoomTransport } from "./types";

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
        const nextRecovery = updateHostRecovery(recovery, normalizedRoom, deploymentUrl);
        lastAcceptedHostStateRef.current = normalizedState;
        localDispatch({ type: "replace_state_from_import", state: normalizedState });
        const persisted = trySaveGameState(normalizedState);
        setSession((current) =>
          current.mode === "hosting" || current.mode === "ending" || current.mode === "recovery_required"
            ? {
                ...current,
                mode: "hosting",
                recovery: nextRecovery,
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
          const recovery = updateHostRecovery(current.recovery!, nextRoom, deploymentUrl);
          lastAcceptedHostStateRef.current = nextRoom.state;
          localDispatch({ type: "replace_state_from_import", state: nextRoom.state });
          const persisted = trySaveGameState(nextRoom.state);
          setSession({
            mode: "hosting",
            recovery,
            room: nextRoom,
            connected: transport.connectionState(),
            roomReady: true,
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
    [deploymentUrl, transport]
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
