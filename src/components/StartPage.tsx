import { Copy, Home, Play, Plus, Radio, RefreshCw, Spade, UserPlus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { GameState } from "../domain/pokerTypes";
import type { FriendProfile, FollowedFriend } from "../session/friendProfiles";
import { formatFriendCode, friendCodeUrl, normalizeFriendCode } from "../session/friendProfiles";
import type { FriendActivity } from "../session/types";
import type { LocalEntryReason } from "../session/localEntry";
import { BackupReminder } from "./BackupReminder";
import { StorageRecoveryNotice } from "./StorageRecoveryNotice";

type StartPageProps = {
  entry: { reason: LocalEntryReason; savedGame: GameState | null; error?: string };
  friendFeatureAvailable?: boolean;
  friendProfile?: FriendProfile | null;
  followedFriends?: FollowedFriend[];
  friendActivity?: FriendActivity[];
  friendPending?: boolean;
  friendError?: string | null;
  initialFriendCode?: string | null;
  onContinue: () => void;
  onStartNew: () => void;
  onCreateFriendProfile?: (displayName: string) => void;
  onRenameFriendProfile?: (displayName: string) => void;
  onRotateFriendCode?: () => void;
  onAddFriend?: (friendCode: string) => void;
  onRemoveFriend?: (friendCode: string) => void;
  onJoinFriendRoom?: (activity: FriendActivity) => void;
};

function formatDate(value: string | undefined): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(timestamp);
}

function latestActivity(state: GameState): string | null {
  const timestamps = state.transactions
    .map((transaction) => Date.parse(transaction.createdAt))
    .filter((timestamp) => Number.isFinite(timestamp));
  const createdAt = Date.parse(state.settings.createdAt);
  if (Number.isFinite(createdAt)) timestamps.push(createdAt);
  return timestamps.length === 0 ? null : formatDate(new Date(Math.max(...timestamps)).toISOString());
}

export function StartPage({
  entry,
  friendFeatureAvailable = false,
  friendProfile = null,
  followedFriends = [],
  friendActivity = [],
  friendPending = false,
  friendError = null,
  initialFriendCode = null,
  onContinue,
  onStartNew,
  onCreateFriendProfile,
  onRenameFriendProfile,
  onRotateFriendCode,
  onAddFriend,
  onRemoveFriend,
  onJoinFriendRoom
}: StartPageProps) {
  const savedGame = entry.savedGame;
  const gameName = savedGame?.settings.gameName.trim() || "Poker Night";
  const activePlayerCount = savedGame?.players.filter((player) => player.isActive).length ?? 0;
  const activity = savedGame ? latestActivity(savedGame) : null;
  const [profileName, setProfileName] = useState(friendProfile?.displayName ?? "");
  const [friendCode, setFriendCode] = useState(initialFriendCode ?? "");
  const [copied, setCopied] = useState(false);

  useEffect(() => setProfileName(friendProfile?.displayName ?? ""), [friendProfile?.displayName]);
  useEffect(() => {
    if (initialFriendCode) setFriendCode(initialFriendCode);
  }, [initialFriendCode]);

  const activityByCode = new Map(friendActivity.map((item) => [item.friendCode, item]));

  async function copyFriendCode() {
    if (!friendProfile) return;
    try {
      await navigator.clipboard.writeText(friendProfile.friendCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <main className="start-page">
      <div className="home-layout">
        <section className="panel start-card" aria-labelledby="start-page-title">
          <Spade size={34} aria-hidden="true" />
          <p className="eyebrow">Poker Tracker</p>
          <h1 id="start-page-title">{savedGame ? "Welcome back" : "Ready for poker night?"}</h1>
          <p className="start-intro">
            {savedGame
              ? "Your game and your friends' live rooms are ready from one place."
              : "Start a local ledger or join a poker night hosted by a friend."}
          </p>

          {savedGame ? (
            <div className="start-game-summary" aria-label="Saved game summary">
              <div className="start-game-summary-heading">
                <div><p className="eyebrow">Your saved game</p><h2>{gameName}</h2></div>
                <Play size={22} aria-hidden="true" />
              </div>
              <dl className="start-game-metrics">
                <div><dt>Players</dt><dd>{activePlayerCount}</dd></div>
                <div><dt>Entries</dt><dd>{savedGame.transactions.length}</dd></div>
                <div><dt>Last activity</dt><dd>{activity ?? "Not available"}</dd></div>
              </dl>
            </div>
          ) : null}

          {entry.error ? <div className="notice notice-warning">{entry.error}</div> : null}
          <div className="start-actions">
            {savedGame ? (
              <button className="primary-button" type="button" onClick={onContinue}>
                <Play size={18} aria-hidden="true" /> Continue {gameName}
              </button>
            ) : null}
            <button className={savedGame ? "start-new-button" : "primary-button"} type="button" onClick={onStartNew}>
              <Plus size={18} aria-hidden="true" /> Start new game
            </button>
          </div>
          <StorageRecoveryNotice />
          <BackupReminder currentGame={savedGame} />
        </section>

        {friendFeatureAvailable ? (
          <section className="panel friend-home-card" aria-labelledby="friend-home-title">
            <div className="friend-home-heading">
              <div><p className="eyebrow">Friends</p><h2 id="friend-home-title">Live poker nights</h2></div>
              <Home size={22} aria-hidden="true" />
            </div>

            {!friendProfile ? (
              <form className="friend-profile-setup" onSubmit={(event) => {
                event.preventDefault();
                onCreateFriendProfile?.(profileName);
              }}>
                <p>Create a device profile to follow hosts and join their rooms from Home.</p>
                <label>
                  <span>Your display name</span>
                  <input aria-label="Your display name" maxLength={40} value={profileName}
                    onChange={(event) => setProfileName(event.currentTarget.value)} placeholder="Alex" />
                </label>
                <button className="primary-button" type="submit" disabled={friendPending || !profileName.trim()}>
                  <UserPlus size={16} /> Create friend code
                </button>
              </form>
            ) : (
              <>
                <div className="friend-profile-card">
                  <QRCodeSVG aria-label="Personal friend code QR" value={friendCodeUrl(friendProfile.friendCode)}
                    size={126} level="M" marginSize={1} />
                  <div>
                    <p className="eyebrow">Your friend code</p>
                    <strong className="friend-code">{formatFriendCode(friendProfile.friendCode)}</strong>
                    <button className="text-button" type="button" onClick={() => void copyFriendCode()}>
                      <Copy size={15} /> {copied ? "Copied" : "Copy code"}
                    </button>
                  </div>
                </div>

                <form className="friend-profile-name" onSubmit={(event) => {
                  event.preventDefault();
                  onRenameFriendProfile?.(profileName);
                }}>
                  <label><span>Your display name</span>
                    <input aria-label="Your display name" maxLength={40} value={profileName}
                      onChange={(event) => setProfileName(event.currentTarget.value)} />
                  </label>
                  <button className="text-button" type="submit"
                    disabled={friendPending || profileName.trim() === friendProfile.displayName}>Save name</button>
                </form>

                <form className="friend-add-form" onSubmit={(event) => {
                  event.preventDefault();
                  onAddFriend?.(friendCode);
                }}>
                  <label><span>Add a friend</span>
                    <input aria-label="Friend code" autoCapitalize="characters" value={formatFriendCode(friendCode)}
                      onChange={(event) => setFriendCode(normalizeFriendCode(event.currentTarget.value))}
                      placeholder="ABCD-EFGH-JKLM-NPQR-STUV" />
                  </label>
                  <button className="primary-button" type="submit" disabled={friendPending || !friendCode.trim()}>
                    <UserPlus size={16} /> Follow
                  </button>
                </form>

                <div className="friend-list" aria-label="Followed friends">
                  {followedFriends.length === 0 ? (
                    <p className="muted">Scan a personal friend QR or enter a code to see hosted rooms here.</p>
                  ) : followedFriends.map((friend) => {
                    const live = activityByCode.get(friend.friendCode);
                    return (
                      <article className="friend-list-item" key={friend.friendCode}>
                        <div><strong>{live?.displayName ?? friend.displayName}</strong>
                          <span>{live?.room ? `${live.room.name} is live` : "Not hosting right now"}</span></div>
                        <div className="friend-list-actions">
                          {live?.room ? (
                            <button className="primary-button" type="button" onClick={() => onJoinFriendRoom?.(live)}>
                              <Radio size={15} /> Join
                            </button>
                          ) : null}
                          <button className="icon-button" type="button"
                            aria-label={`Remove ${live?.displayName ?? friend.displayName}`} title="Stop following"
                            onClick={() => onRemoveFriend?.(friend.friendCode)}><X size={15} /></button>
                        </div>
                      </article>
                    );
                  })}
                </div>

                <button className="text-button friend-code-rotate" type="button" onClick={onRotateFriendCode} disabled={friendPending}>
                  <RefreshCw size={15} /> Regenerate my friend code
                </button>
              </>
            )}
            {friendPending ? <p className="muted">Updating friends…</p> : null}
            {friendError ? <div className="notice notice-warning">{friendError}</div> : null}
          </section>
        ) : null}
      </div>
      <p className="start-footnote">Games stay local until you choose to share. No account required.</p>
    </main>
  );
}
