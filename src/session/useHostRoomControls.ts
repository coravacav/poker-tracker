import { useCallback } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { createCapability, createInviteUrl } from "./capabilities";
import { roomErrorMessage } from "./convexRoomTransport";
import { getHostControllerId, saveHostRecovery } from "./sessionPersistence";
import type { SessionState } from "./sessionState";
import type { RoomTransport } from "./types";

/** Host-only room controls: controller takeover, guest requests, invitations, and guest access. */
export function useHostRoomControls(
  transport: RoomTransport,
  sessionRef: RefObject<SessionState>,
  setSession: Dispatch<SetStateAction<SessionState>>
) {
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

  const setFriendVisibility = useCallback(async (visible: boolean) => {
    const current = sessionRef.current;
    if (current.mode !== "hosting" || !current.recovery || !transport.setFriendVisibility) return;
    try {
      await transport.setFriendVisibility({
        publicId: current.recovery.publicId,
        hostSecret: current.recovery.hostSecret,
        visible
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

  return {
    claimHost,
    decideGuestTransaction,
    setJoiningOpen,
    setFriendVisibility,
    rotateInvite,
    revokeGuest
  };
}
