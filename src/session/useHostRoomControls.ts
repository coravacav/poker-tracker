import { useCallback } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { createCapability, createInviteUrl } from "./capabilities";
import { roomErrorMessage } from "./convexRoomTransport";
import { getHostControllerId, loadHostRecovery, saveHostRecovery } from "./sessionPersistence";
import type { HostState, SessionState } from "./sessionState";
import type { HostRecovery, RoomTransport } from "./types";

type HostingState = HostState & { mode: "hosting"; recovery: HostRecovery };

function isHostingRoom(session: SessionState, publicId: string): session is HostingState {
  return session.mode === "hosting" && session.recovery?.publicId === publicId;
}

/** Host-only room controls: controller takeover, guest requests, invitations, and guest access. */
export function useHostRoomControls(
  transport: RoomTransport,
  sessionRef: RefObject<SessionState>,
  setSession: Dispatch<SetStateAction<SessionState>>
) {
  /**
   * Room actions resolve after the room subscription may already have
   * delivered newer state (for example, a takeover marking this tab as the
   * controller), so results are merged into the latest session rather than
   * the snapshot taken before the request.
   */
  const patchHostedRoom = useCallback(
    (publicId: string, patch: (session: HostingState) => SessionState) => {
      setSession((next) => (isHostingRoom(next, publicId) ? patch(next) : next));
    },
    []
  );

  const runHostAction = useCallback(
    async (publicId: string, request: () => Promise<unknown>) => {
      try {
        await request();
        patchHostedRoom(publicId, (next) => ({ ...next, error: null }));
        return true;
      } catch (error) {
        patchHostedRoom(publicId, (next) => ({ ...next, error: roomErrorMessage(error) }));
        return false;
      }
    },
    [patchHostedRoom]
  );

  const claimHost = useCallback(async () => {
    const current = sessionRef.current;
    if (current.mode !== "hosting" || !current.recovery) return;
    const { publicId, hostSecret } = current.recovery;
    await runHostAction(publicId, () =>
      transport.claimHost(publicId, hostSecret, getHostControllerId(() => createCapability(18)))
    );
  }, [runHostAction, transport]);

  const decideGuestTransaction = useCallback(async (
    requestId: Id<"roomGuestRequests">,
    decision: "approved" | "rejected"
  ) => {
    const current = sessionRef.current;
    if (current.mode !== "hosting" || !current.recovery || !current.room) return;
    const { publicId, hostSecret } = current.recovery;
    const expectedVersion = current.room.version;
    await runHostAction(publicId, () =>
      transport.decideGuestTransaction({
        publicId,
        hostSecret,
        controllerId: getHostControllerId(() => createCapability(18)),
        requestId,
        decision,
        expectedVersion
      })
    );
  }, [runHostAction, transport]);

  const setJoiningOpen = useCallback(async (open: boolean) => {
    const current = sessionRef.current;
    if (current.mode !== "hosting" || !current.recovery) return;
    const { publicId, hostSecret } = current.recovery;
    await runHostAction(publicId, () => transport.setJoiningOpen({ publicId, hostSecret, open }));
  }, [runHostAction, transport]);

  const setFriendVisibility = useCallback(async (visible: boolean) => {
    const current = sessionRef.current;
    const setVisibility = transport.setFriendVisibility;
    if (current.mode !== "hosting" || !current.recovery || !setVisibility) return;
    const { publicId, hostSecret } = current.recovery;
    await runHostAction(publicId, () => setVisibility({ publicId, hostSecret, visible }));
  }, [runHostAction, transport]);

  const rotateInvite = useCallback(async () => {
    const current = sessionRef.current;
    if (current.mode !== "hosting" || !current.recovery) return;
    const { publicId, hostSecret } = current.recovery;
    const inviteSecret = createCapability();
    const invite = { inviteSecret, inviteUrl: createInviteUrl(publicId, inviteSecret) };
    const rotated = await runHostAction(publicId, () =>
      transport.rotateInvite({ publicId, hostSecret, inviteSecret })
    );
    if (!rotated) return;
    const stored = loadHostRecovery();
    saveHostRecovery({ ...(stored?.publicId === publicId ? stored : current.recovery), ...invite });
    patchHostedRoom(publicId, (next) => ({ ...next, recovery: { ...next.recovery, ...invite } }));
  }, [patchHostedRoom, runHostAction, transport]);

  const revokeGuest = useCallback(async (guestId: Id<"roomGuests">) => {
    const current = sessionRef.current;
    if (current.mode !== "hosting" || !current.recovery) return;
    const { publicId, hostSecret } = current.recovery;
    await runHostAction(publicId, () => transport.revokeGuest({ publicId, hostSecret, guestId }));
  }, [runHostAction, transport]);

  return {
    claimHost,
    decideGuestTransaction,
    setJoiningOpen,
    setFriendVisibility,
    rotateInvite,
    revokeGuest
  };
}
