import { useEffect } from "react";
import type { ReactNode } from "react";
import { GameApp, preloadGameApp, preloadPlayMode } from "./components/GameApp";
import type { GuestSeatControls } from "./components/gameApp/GuestSeatPrompt";
import type { PeerGuestControls } from "./components/guestPlay/types";
import { GuestJoinScreen } from "./components/GuestJoinScreen";
import { LazyBoundary, lazyWithPreload, whenIdle } from "./components/lazyComponent";
import { preloadQrCode } from "./components/QrCode";
import { StartPage } from "./components/StartPage";
import {
  GuestSessionControls,
  HostSharingControls,
  LocalShareButton
} from "./components/SharingControls";
import { loadArchivedGames } from "./state/gameArchive";
import { preloadConvexClient } from "./session/convexRoomTransport";
import { hasSavedLocalGame } from "./session/localEntry";
import { useGameSession } from "./session/useGameSession";
import { watchedRoomSave } from "./state/sharedGameArchive";
import { useStoragePersistenceRequest } from "./state/useStoragePersistence";
import type { RoomTransport, SharedActivity } from "./session/types";

// Only watch links open it, so it stays out of the main chunk.
const SpectatorScreen = lazyWithPreload(() =>
  import("./components/spectator/SpectatorScreen").then((module) => module.SpectatorScreen)
);

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
        hasLocalGame={hasSavedLocalGame()}
        joining={session.joining}
        onCancel={gameSession.dismissInvite}
        onJoin={(choice) => void gameSession.joinGame(choice)}
        roomName={session.preview.name}
        seats={session.preview.seats}
        status={session.preview.status}
      />
    );
  }

  if (session.mode === "pairing_phone") {
    return (
      <GuestJoinScreen
        error={session.error}
        hasLocalGame={hasSavedLocalGame()}
        joining={false}
        onCancel={gameSession.dismissInvite}
        onJoin={() => undefined}
        status={session.error ? "invalid" : "loading"}
        loadingTitle="Connecting your phone…"
        invalidTitle="Phone link unavailable"
      />
    );
  }

  if (session.mode === "spectating") {
    return (
      <LazyBoundary fallback={<p className="muted" role="status">Opening the game…</p>}>
        <SpectatorScreen
          room={session.room}
          connected={session.connected}
          error={session.error}
          onLeave={gameSession.leaveSpectating}
        />
      </LazyBoundary>
    );
  }

  if (session.mode === "invalid_invite") {
    return (
      <GuestJoinScreen
        error={session.message}
        hasLocalGame={hasSavedLocalGame()}
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
        hasLocalGame={hasSavedLocalGame()}
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
  let guestSeat: GuestSeatControls | undefined;
  let peerGuest: PeerGuestControls | undefined;
  if (session.mode === "local") {
    sessionControls = <LocalShareButton onShare={() => void gameSession.shareGame()} />;
    sessionNotice = session.notice;
  } else if (session.mode === "creating_room") {
    sessionControls = <span className="session-status">Creating room…</span>;
    sessionNotice = session.error;
  } else if (session.mode === "guest") {
    const seatPlayerId = session.room?.seatPlayerId ?? null;
    const seatName = seatPlayerId
      ? session.room?.state.players.find((player) => player.id === seatPlayerId)?.name
      : undefined;
    if (session.room?.status === "active" && session.room.seats) {
      guestSeat = {
        seatPlayerId,
        seatLost: session.room.seatLost ?? null,
        seats: session.room.seats,
        onClaimSeat: gameSession.claimSeat
      };
    }
    // Seated, in a room where players confirm each other: Table · Chips · Inbox.
    if (session.room?.peerConfirm === true && seatPlayerId !== null && session.room.agreements) {
      peerGuest = {
        seatPlayerId,
        agreements: session.room.agreements,
        seats: session.room.seats ?? [],
        ended: session.room.status !== "active",
        onPropose: gameSession.proposeAgreement,
        onAnswer: gameSession.answerAgreement,
        onCancel: gameSession.cancelAgreement,
        onDismiss: gameSession.dismissAgreement
      };
    }
    sessionControls = (
      <GuestSessionControls
        connected={session.connected}
        displayName={session.credentials.displayName}
        seatName={seatName}
        ended={session.room?.status !== "active"}
        hostProfile={session.room?.hostProfile}
        followingHost={Boolean(session.room?.hostProfile && gameSession.followedFriends.some(
          (friend) => friend.friendCode === session.room?.hostProfile?.friendCode
        ))}
        onFollowHost={() => {
          if (session.room?.hostProfile) void gameSession.addFriend(session.room.hostProfile.friendCode);
        }}
        onLeave={gameSession.leaveGuest}
        savableGame={
          session.room
            ? watchedRoomSave({ ...session.room, publicId: session.credentials.publicId }, gameSession.roomHistory)
            : null
        }
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
        onSetWatchLink={(on) => void gameSession.setWatchLink(on)}
        onRevokeGuest={(guestId) => void gameSession.revokeGuest(guestId)}
        onReleaseSeat={(guestId, playerId) => void gameSession.releaseSeat(guestId, playerId)}
        onAssignSeat={(guestId, playerId) => void gameSession.assignSeat(guestId, playerId)}
        onSetHostPlayer={(playerId) => void gameSession.setHostPlayer(playerId)}
        onCreatePhoneLink={gameSession.createHostPhoneLink}
        onCancelPhoneLink={() => void gameSession.cancelHostPhoneLink()}
        onSetPeerConfirm={(on) => void gameSession.setPeerConfirm(on)}
        onHostAnswerAgreement={gameSession.hostAnswerAgreement}
        onResolveBouncedAgreement={gameSession.resolveBouncedAgreement}
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
      guestSeat={guestSeat}
      peerGuest={peerGuest}
      ledgerLabel={
        gameSession.isGuest
          ? peerGuest
            // A seated player records chips with the others, so it isn't read-only to them.
            ? "Shared game"
            : "Shared read-only ledger"
          : session.mode === "local"
            ? "Local ledger"
            : "Shared host ledger"
      }
      // A shared room is titled by its game, so a guest (or a host with several rooms) can tell which one this is.
      title={session.mode === "local" ? undefined : gameSession.state.settings.gameName.trim() || undefined}
      sessionControls={sessionControls}
      sessionNotice={sessionNotice}
      sharedActivity={sharedActivity}
      onMarkNotificationsRead={gameSession.markNotificationsRead}
      onSubmitGuestTransaction={(transaction) =>
        void gameSession.submitGuestTransaction(transaction)
      }
      roomHistory={gameSession.roomHistory}
      onTurnOffWatchLink={gameSession.turnOffWatchLink}
      state={gameSession.state}
      initialMode={gameSession.localEntryDestination}
      onHome={session.mode === "local" ? gameSession.openHome : undefined}
    />
  );
}
