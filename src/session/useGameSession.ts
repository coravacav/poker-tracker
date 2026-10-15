import { useReducer, useRef, useState } from "react";
import { gameReducer } from "../state/gameReducer";
import { loadGameState } from "../state/persistence";
import { configuredDeploymentUrl, convexRoomTransport } from "./convexRoomTransport";
import { loadInitialLocalEntry, type LocalEntry } from "./localEntry";
import {
  initialSession,
  type LocalEntryDestination,
  type SessionState
} from "./sessionState";
import type { RoomTransport } from "./types";
import { useFriendDiscovery } from "./useFriendDiscovery";
import { useGuestSession, useInvitePreview } from "./useGuestSession";
import { useHostRoomControls } from "./useHostRoomControls";
import { useHostSession } from "./useHostSession";
import { useLocalEntryActions, useLocalEntryTracking } from "./useLocalEntry";
import { useRoomHistory, useRoomHistoryCredentials } from "./useRoomHistory";
import { useMarkNotificationsRead, useRoomConnection } from "./useSharedRoom";

export type { LocalEntryDestination } from "./sessionState";

/**
 * Composes the local game, hosted and guest shared-room sessions, friend
 * discovery, and Home-screen state into the single API the app renders from.
 * Sub-hooks are called in a fixed order so their effects run in the same
 * sequence on every commit.
 */
export function useGameSession(transport: RoomTransport = convexRoomTransport) {
  const [localState, localDispatch] = useReducer(gameReducer, undefined, loadGameState);
  const deploymentUrl = transport === convexRoomTransport ? configuredDeploymentUrl() : null;
  const [session, setSession] = useState<SessionState>(() =>
    initialSession(localState.localGameId, deploymentUrl)
  );
  const [localEntry, setLocalEntry] = useState<LocalEntry | null>(() => {
    const initial = initialSession(localState.localGameId, deploymentUrl);
    return initial.mode === "local" ? loadInitialLocalEntry() : null;
  });
  const [localEntryDestination, setLocalEntryDestination] =
    useState<LocalEntryDestination>("play");
  const sessionRef = useRef(session);
  const localStateRef = useRef(localState);
  const localEntryRef = useRef(localEntry);
  sessionRef.current = session;
  localStateRef.current = localState;
  localEntryRef.current = localEntry;

  const { roomHistory, refreshRoomHistory } = useRoomHistory(transport);
  const friends = useFriendDiscovery({
    transport,
    sessionRef,
    setSession,
    setLocalEntry,
    refreshRoomHistory
  });
  useRoomHistoryCredentials(session, deploymentUrl);
  useLocalEntryTracking({
    localState,
    localEntry,
    sessionMode: session.mode,
    sessionRef,
    localStateRef,
    localEntryRef,
    setLocalEntry,
    setLocalEntryDestination
  });
  useRoomConnection(session, transport, sessionRef, setSession);
  useInvitePreview(session, transport, setSession);
  const host = useHostSession({
    session,
    transport,
    deploymentUrl,
    friendProfile: friends.friendProfile,
    localDispatch,
    sessionRef,
    localStateRef,
    setSession,
    refreshRoomHistory
  });
  const guest = useGuestSession({
    session,
    transport,
    deploymentUrl,
    sessionRef,
    setSession,
    setLocalEntryDestination,
    refreshRoomHistory
  });
  const hostControls = useHostRoomControls(transport, sessionRef, setSession);
  const markNotificationsRead = useMarkNotificationsRead(transport, sessionRef, setSession);
  const localEntryActions = useLocalEntryActions({
    localDispatch,
    sessionRef,
    localStateRef,
    localEntryRef,
    setLocalEntry,
    setLocalEntryDestination
  });

  const state =
    session.mode === "guest" && session.room
      ? session.room.state
      : (session.mode === "hosting" ||
          session.mode === "ending" ||
          session.mode === "recovery_required" ||
          session.mode === "room_unavailable") &&
          session.room
        ? session.room.state
        : localState;
  const isGuest = session.mode === "guest";
  const hostReadOnly =
    session.mode === "creating_room" ||
    session.mode === "ending" ||
    session.mode === "recovery_required" ||
    session.mode === "room_unavailable" ||
    (session.mode === "hosting" &&
      (!session.connected ||
        !session.roomReady ||
        session.pending ||
        session.room?.controllerStatus !== "active"));


  return {
    state,
    dispatch: host.dispatch,
    session,
    isGuest,
    forcedReadOnly: isGuest || hostReadOnly,
    shareGame: host.shareGame,
    joinGame: guest.joinGame,
    endSharing: host.endSharing,
    retryRecovery: host.retryRecovery,
    retryUnavailableRoom: host.retryUnavailableRoom,
    continueLocally: host.continueLocally,
    claimHost: hostControls.claimHost,
    markNotificationsRead,
    submitGuestTransaction: guest.submitGuestTransaction,
    decideGuestTransaction: hostControls.decideGuestTransaction,
    setJoiningOpen: hostControls.setJoiningOpen,
    setFriendVisibility: hostControls.setFriendVisibility,
    rotateInvite: hostControls.rotateInvite,
    revokeGuest: hostControls.revokeGuest,
    leaveGuest: guest.leaveGuest,
    dismissInvite: guest.dismissInvite,
    localEntry,
    localEntryDestination,
    openHome: localEntryActions.openHome,
    continueLocalGame: localEntryActions.continueLocalGame,
    startNewLocalGame: localEntryActions.startNewLocalGame,
    friendFeatureAvailable: friends.friendFeatureAvailable,
    friendProfile: friends.friendProfile,
    followedFriends: friends.followedFriends,
    friendActivity: friends.friendActivity,
    friendPending: friends.friendPending,
    friendError: friends.friendError,
    initialFriendCode: friends.initialFriendCode,
    createFriendProfile: friends.createFriendProfile,
    renameFriendProfile: friends.renameFriendProfile,
    rotateFriendCode: friends.rotateFriendCode,
    addFriend: friends.addFriend,
    removeFriend: friends.removeFriend,
    joinFriendRoom: friends.joinFriendRoom,
    roomHistory,
    refreshRoomHistory
  };
}
