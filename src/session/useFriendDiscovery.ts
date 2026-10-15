import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { createCapability, guestRoomHash } from "./capabilities";
import { friendProfileErrorMessage } from "./convexRoomTransport";
import {
  createFriendCode,
  friendCodeFromHash,
  loadFollowedFriends,
  loadFriendProfile,
  normalizeFriendCode,
  saveFollowedFriends,
  saveFriendProfile,
  validFriendCode,
  type FollowedFriend,
  type FriendProfile
} from "./friendProfiles";
import type { LocalEntry } from "./localEntry";
import { saveGuestSession, saveRoomHistoryCredential } from "./sessionPersistence";
import { normalizeRoomState, type SessionState } from "./sessionState";
import type { FriendActivity, FriendRoom, GuestSession, RoomTransport } from "./types";

type FriendDiscoveryOptions = {
  transport: RoomTransport;
  sessionRef: RefObject<SessionState>;
  setSession: Dispatch<SetStateAction<SessionState>>;
  setLocalEntry: Dispatch<SetStateAction<LocalEntry | null>>;
  refreshRoomHistory: () => Promise<void>;
};

/** Friend profile, followed hosts, their live rooms, and joining a friend's room. */
export function useFriendDiscovery({
  transport,
  sessionRef,
  setSession,
  setLocalEntry,
  refreshRoomHistory
}: FriendDiscoveryOptions) {
  const [friendProfile, setFriendProfile] = useState<FriendProfile | null>(loadFriendProfile);
  const [followedFriends, setFollowedFriends] = useState<FollowedFriend[]>(loadFollowedFriends);
  const [friendActivity, setFriendActivity] = useState<FriendActivity[]>([]);
  const [friendPending, setFriendPending] = useState(false);
  const [friendError, setFriendError] = useState<string | null>(null);
  const [initialFriendCode, setInitialFriendCode] = useState<string | null>(friendCodeFromHash);
  const followedFriendsRef = useRef(followedFriends);
  followedFriendsRef.current = followedFriends;

  useEffect(() => {
    if (!transport.configured || !transport.subscribeFriendActivity || followedFriends.length === 0) {
      setFriendActivity([]);
      return;
    }
    return transport.subscribeFriendActivity(
      followedFriends.map((friend) => friend.friendCode),
      (activity) => {
        setFriendActivity(activity);
        setFollowedFriends((current) => {
          const names = new Map(activity.map((item) => [item.friendCode, item.displayName]));
          const next = current.map((friend) => ({
            ...friend,
            displayName: names.get(friend.friendCode) ?? friend.displayName
          }));
          if (JSON.stringify(next) !== JSON.stringify(current)) saveFollowedFriends(next);
          return next;
        });
        setFriendError(null);
      },
      () => setFriendError("Friend rooms could not be refreshed. Please try again.")
    );
  }, [followedFriends.map((friend) => friend.friendCode).join("|"), transport]);

  const createFriendProfileForDevice = useCallback(async (displayName: string) => {
    const name = displayName.trim();
    if (!name || name.length > 40 || !transport.createFriendProfile) return;
    setFriendPending(true);
    setFriendError(null);
    try {
      const profile: FriendProfile = {
        schemaVersion: 1,
        friendCode: createFriendCode(),
        displayName: name,
        ownerSecret: createCapability()
      };
      // Only the fields the backend accepts: its validator rejects extra ones
      // such as the local schemaVersion.
      const created = await transport.createFriendProfile({
        friendCode: profile.friendCode,
        displayName: profile.displayName,
        ownerSecret: profile.ownerSecret
      });
      const saved = { ...profile, ...created };
      if (!saveFriendProfile(saved)) throw new Error("Your friend profile could not be saved on this device.");
      setFriendProfile(saved);
    } catch (error) {
      setFriendError(friendProfileErrorMessage(error, "Friend profile creation failed."));
    } finally {
      setFriendPending(false);
    }
  }, [transport]);

  const renameFriendProfile = useCallback(async (displayName: string) => {
    if (!friendProfile || !transport.updateFriendProfileName) return;
    const name = displayName.trim();
    if (!name || name.length > 40) return;
    setFriendPending(true);
    setFriendError(null);
    try {
      const updated = await transport.updateFriendProfileName({
        friendCode: friendProfile.friendCode,
        ownerSecret: friendProfile.ownerSecret,
        displayName: name
      });
      const saved = { ...friendProfile, ...updated };
      if (!saveFriendProfile(saved)) throw new Error("Your updated profile could not be saved on this device.");
      setFriendProfile(saved);
    } catch (error) {
      setFriendError(friendProfileErrorMessage(error, "The display name could not be updated."));
    } finally {
      setFriendPending(false);
    }
  }, [friendProfile, transport]);

  const rotateFriendCode = useCallback(async () => {
    if (!friendProfile || !transport.rotateFriendCode) return;
    setFriendPending(true);
    setFriendError(null);
    try {
      const updated = await transport.rotateFriendCode({
        friendCode: friendProfile.friendCode,
        ownerSecret: friendProfile.ownerSecret,
        newFriendCode: createFriendCode()
      });
      const saved = { ...friendProfile, ...updated };
      if (!saveFriendProfile(saved)) throw new Error("The new friend code could not be saved on this device.");
      setFriendProfile(saved);
    } catch (error) {
      setFriendError(friendProfileErrorMessage(error, "The friend code could not be regenerated."));
    } finally {
      setFriendPending(false);
    }
  }, [friendProfile, transport]);

  const addFriend = useCallback(async (value: string) => {
    const friendCode = normalizeFriendCode(value);
    if (!validFriendCode(friendCode)) {
      setFriendError("Enter a complete friend code in the format ABCD-EFGH-JKLM-NPQR-STUV.");
      return;
    }
    if (friendProfile?.friendCode === friendCode) {
      setFriendError("That is your own friend code.");
      return;
    }
    if (followedFriends.some((friend) => friend.friendCode === friendCode)) {
      setFriendError("You already follow that friend.");
      return;
    }
    if (!transport.lookupFriendProfile) return;
    setFriendPending(true);
    setFriendError(null);
    try {
      const found = await transport.lookupFriendProfile(friendCode);
      if (!found) {
        setFriendError("No friend profile was found for that code.");
        return;
      }
      // Read the latest list: names may have refreshed while the lookup ran.
      const latest = followedFriendsRef.current;
      if (latest.some((friend) => friend.friendCode === found.friendCode)) {
        setFriendError("You already follow that friend.");
        return;
      }
      const next = [
        ...latest,
        { schemaVersion: 1 as const, friendCode: found.friendCode, displayName: found.displayName }
      ].slice(0, 50);
      if (!saveFollowedFriends(next)) throw new Error("That friend could not be saved on this device.");
      setFollowedFriends(next);
      setInitialFriendCode(null);
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    } catch (error) {
      setFriendError(friendProfileErrorMessage(error, "That friend could not be added."));
    } finally {
      setFriendPending(false);
    }
  }, [followedFriends, friendProfile?.friendCode, transport]);

  const removeFriend = useCallback((friendCode: string) => {
    const next = followedFriends.filter((friend) => friend.friendCode !== friendCode);
    if (saveFollowedFriends(next)) {
      setFollowedFriends(next);
      setFriendError(null);
    } else {
      setFriendError("That friend could not be removed from this device.");
    }
  }, [followedFriends]);

  const joinFriendRoom = useCallback(async (
    activity: FriendActivity,
    selectedRoom: FriendRoom | null = activity.room
  ) => {
    if (
      sessionRef.current.mode !== "local" ||
      !selectedRoom ||
      !friendProfile ||
      !transport.joinFriendRoom
    ) return;
    setFriendPending(true);
    setFriendError(null);
    try {
      const guestSecret = createCapability();
      const room = await transport.joinFriendRoom({
        publicId: selectedRoom.publicId,
        friendCode: activity.friendCode,
        guestSecret,
        displayName: friendProfile.displayName
      });
      const normalizedState = normalizeRoomState(room.state);
      if (!normalizedState) throw new Error("The room returned an invalid game snapshot.");
      const normalizedRoom = { ...room, state: normalizedState };
      const credentials: GuestSession = {
        schemaVersion: 1,
        publicId: selectedRoom.publicId,
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
      window.history.replaceState(null, "", guestRoomHash(credentials.publicId));
      setSession({ mode: "guest", credentials, room: normalizedRoom, connected: transport.connectionState(), error: null });
      setLocalEntry(null);
      void refreshRoomHistory();
    } catch (error) {
      setFriendError(friendProfileErrorMessage(error, "The friend's room could not be joined."));
    } finally {
      setFriendPending(false);
    }
  }, [friendProfile, refreshRoomHistory, transport]);

  return {
    friendFeatureAvailable:
      transport.configured &&
      Boolean(transport.createFriendProfile && transport.lookupFriendProfile && transport.subscribeFriendActivity),
    friendProfile,
    followedFriends,
    friendActivity,
    friendPending,
    friendError,
    initialFriendCode,
    createFriendProfile: createFriendProfileForDevice,
    renameFriendProfile,
    rotateFriendCode,
    addFriend,
    removeFriend,
    joinFriendRoom
  };
}
