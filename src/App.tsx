import { useEffect } from "react";
import type { ReactNode } from "react";
import { GameApp, preloadGameApp, preloadPlayMode } from "./components/GameApp";
import { GuestJoinScreen } from "./components/GuestJoinScreen";
import { whenIdle } from "./components/lazyComponent";
import { preloadQrCode } from "./components/QrCode";
import { StartPage } from "./components/StartPage";
import {
  GuestSessionControls,
  HostSharingControls,
  LocalShareButton
} from "./components/SharingControls";
import { loadArchivedGames } from "./state/gameArchive";
import { preloadConvexClient } from "./session/convexRoomTransport";
import { useGameSession } from "./session/useGameSession";
import { useStoragePersistenceRequest } from "./state/useStoragePersistence";
import type { RoomTransport, SharedActivity } from "./session/types";

export function App({ roomTransport }: { roomTransport?: RoomTransport } = {}) {
  const gameSession = useGameSession(roomTransport);
  const { session } = gameSession;
  // Warm the Player History cache (and move it to IndexedDB if needed) so Home and Setup render it without waiting.
  useEffect(() => {
    void loadArchivedGames();
  }, []);
  // Load the split-off chunks once the first screen is up, so later screens open without waiting.
  useEffect(
    () =>
      whenIdle(() => {
        const ignore = () => undefined;
        void preloadGameApp().catch(ignore);
        void preloadQrCode().catch(ignore);
        if (!roomTransport) void preloadConvexClient().catch(ignore);
      }),
    [roomTransport]
  );
  useStoragePersistenceRequest(
    (!gameSession.isGuest && gameSession.state.transactions.length > 0) ||
      gameSession.friendProfile !== null ||
      gameSession.followedFriends.length > 0
  );

  // Every screen below except Home leads to (or is) a game, where Play is needed soon.
  if (!(session.mode === "local" && gameSession.localEntry)) void preloadPlayMode().catch(() => undefined);

  if (session.mode === "joining") {
    return (
      <GuestJoinScreen
        error={session.error}
        joining={session.joining}
        onCancel={gameSession.dismissInvite}
        onJoin={(displayName) => void gameSession.joinGame(displayName)}
        roomName={session.preview.name}
        status={session.preview.status}
      />
    );
  }

  if (session.mode === "invalid_invite") {
    return (
      <GuestJoinScreen
        error={session.message}
        joining={false}
        onCancel={gameSession.dismissInvite}
        onJoin={() => undefined}
        status="invalid"
      />
    );
  }

  if (session.mode === "guest" && !session.room) {
    return (
      <GuestJoinScreen
        error={session.error}
        joining={false}
        onCancel={gameSession.leaveGuest}
        onJoin={() => undefined}
        status={session.error ? (session.connected ? "invalid" : "reconnecting") : "loading"}
      />
    );
  }

  if (session.mode === "local" && gameSession.localEntry) {
    return (
      <StartPage
        entry={gameSession.localEntry}
        friendFeatureAvailable={gameSession.friendFeatureAvailable}
        friendProfile={gameSession.friendProfile}
        followedFriends={gameSession.followedFriends}
        friendActivity={gameSession.friendActivity}
        friendPending={gameSession.friendPending}
        friendError={gameSession.friendError}
        initialFriendCode={gameSession.initialFriendCode}
        onContinue={gameSession.continueLocalGame}
        onStartNew={gameSession.startNewLocalGame}
        onCreateFriendProfile={(displayName) => void gameSession.createFriendProfile(displayName)}
        onRenameFriendProfile={(displayName) => void gameSession.renameFriendProfile(displayName)}
        onRotateFriendCode={() => void gameSession.rotateFriendCode()}
        onAddFriend={(friendCode) => void gameSession.addFriend(friendCode)}
        onRemoveFriend={gameSession.removeFriend}
        onJoinFriendRoom={(activity, room) => void gameSession.joinFriendRoom(activity, room)}
      />
    );
  }

  let sessionControls: ReactNode;
  let sessionNotice: string | null = null;
  if (session.mode === "local") {
    sessionControls = <LocalShareButton onShare={() => void gameSession.shareGame()} />;
    sessionNotice = session.notice;
  } else if (session.mode === "creating_room") {
    sessionControls = <span className="session-status">Creating room…</span>;
    sessionNotice = session.error;
  } else if (session.mode === "guest") {
    sessionControls = (
      <GuestSessionControls
        connected={session.connected}
        displayName={session.credentials.displayName}
        ended={session.room?.status !== "active"}
        hostProfile={session.room?.hostProfile}
        followingHost={Boolean(session.room?.hostProfile && gameSession.followedFriends.some(
          (friend) => friend.friendCode === session.room?.hostProfile?.friendCode
        ))}
        onFollowHost={() => {
          if (session.room?.hostProfile) void gameSession.addFriend(session.room.hostProfile.friendCode);
        }}
        onLeave={gameSession.leaveGuest}
      />
    );
    sessionNotice = session.room?.status === "ended" ? "The host ended this shared session." : session.error;
  } else if (session.recovery) {
    sessionControls = (
      <HostSharingControls
        connected={session.connected}
        error={session.error}
        onClaimHost={() => void gameSession.claimHost()}
        onEnd={() => void gameSession.endSharing()}
        onRetryRecovery={gameSession.retryRecovery}
        onRetryRoom={gameSession.retryUnavailableRoom}
        onContinueLocally={gameSession.continueLocally}
        onCreateNewShare={() => void gameSession.shareGame()}
        onDecideGuestTransaction={(requestId, decision) =>
          void gameSession.decideGuestTransaction(requestId, decision)
        }
        onSetJoiningOpen={(open) => void gameSession.setJoiningOpen(open)}
        onSetFriendVisibility={(visible) => void gameSession.setFriendVisibility(visible)}
        onRotateInvite={() => void gameSession.rotateInvite()}
        onRevokeGuest={(guestId) => void gameSession.revokeGuest(guestId)}
        pending={session.pending}
        recovery={session.recovery}
        recoveryRequired={session.mode === "recovery_required"}
        roomReady={session.roomReady}
        roomUnavailable={session.mode === "room_unavailable"}
        room={session.room}
      />
    );
    sessionNotice = session.error;
  }

  const sharedActivity: SharedActivity | undefined =
    (session.mode === "guest" ||
      session.mode === "hosting" ||
      session.mode === "ending" ||
      session.mode === "recovery_required")
      ? session.room?.activity
      : undefined;

  return (
    <GameApp
      dispatch={gameSession.dispatch}
      forcedReadOnly={gameSession.forcedReadOnly}
      guest={gameSession.isGuest}
      ledgerLabel={
        gameSession.isGuest
          ? "Shared read-only ledger"
          : session.mode === "local"
            ? "Local ledger"
            : "Shared host ledger"
      }
      sessionControls={sessionControls}
      sessionNotice={sessionNotice}
      sharedActivity={sharedActivity}
      onMarkNotificationsRead={gameSession.markNotificationsRead}
      onSubmitGuestTransaction={(transaction) =>
        void gameSession.submitGuestTransaction(transaction)
      }
      roomHistory={gameSession.roomHistory}
      state={gameSession.state}
      initialMode={gameSession.localEntryDestination}
      onHome={session.mode === "local" ? gameSession.openHome : undefined}
    />
  );
}
