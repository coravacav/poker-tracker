import { useCallback } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { createCapability, createInviteUrl } from "./capabilities";
import { roomErrorMessage } from "./convexRoomTransport";
import { getHostControllerId, loadHostRecovery, saveHostRecovery } from "./sessionPersistence";
import type { HostState, SessionState } from "./sessionState";
import type { AgreementResult, HostRecovery, RoomTransport } from "./types";

type HostingState = HostState & { mode: "hosting"; recovery: HostRecovery };

function isHostingRoom(session: SessionState, publicId: string): session is HostingState {
  return session.mode === "hosting" && session.recovery?.publicId === publicId;
}

/** Host-only room controls: controller takeover, guest requests, invitations, the watch link, guest access, and seats. */
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

  /** Turns the watch link on with a new secret (also how it is rotated), or off. */
  const setWatchLink = useCallback(async (on: boolean) => {
    const current = sessionRef.current;
    const rotate = transport.rotateSpectatorLink;
    if (current.mode !== "hosting" || !current.recovery || !rotate) return;
    const { publicId, hostSecret } = current.recovery;
    const spectatorSecret = on ? createCapability() : null;
    const updated = await runHostAction(publicId, () =>
      rotate({ publicId, hostSecret, spectatorSecret })
    );
    if (!updated) return;
    const withSecret = (recovery: HostRecovery): HostRecovery => {
      const { spectatorSecret: _previous, ...rest } = recovery;
      return spectatorSecret ? { ...rest, spectatorSecret } : rest;
    };
    const stored = loadHostRecovery();
    saveHostRecovery(withSecret(stored?.publicId === publicId ? stored : current.recovery));
    patchHostedRoom(publicId, (next) => ({ ...next, recovery: withSecret(next.recovery) }));
  }, [patchHostedRoom, runHostAction, transport]);

  const revokeGuest = useCallback(async (guestId: Id<"roomGuests">) => {
    const current = sessionRef.current;
    if (current.mode !== "hosting" || !current.recovery) return;
    const { publicId, hostSecret } = current.recovery;
    await runHostAction(publicId, () => transport.revokeGuest({ publicId, hostSecret, guestId }));
  }, [runHostAction, transport]);

  const releaseSeat = useCallback(async (guestId: Id<"roomGuests">, playerId: string) => {
    const current = sessionRef.current;
    const release = transport.releaseSeat;
    if (current.mode !== "hosting" || !current.recovery || !release) return;
    const { publicId, hostSecret } = current.recovery;
    await runHostAction(publicId, () => release({ publicId, hostSecret, guestId, playerId }));
  }, [runHostAction, transport]);

  const assignSeat = useCallback(async (guestId: Id<"roomGuests">, playerId: string) => {
    const current = sessionRef.current;
    const assign = transport.assignSeat;
    if (current.mode !== "hosting" || !current.recovery || !assign) return;
    const { publicId, hostSecret } = current.recovery;
    await runHostAction(publicId, () => assign({ publicId, hostSecret, guestId, playerId }));
  }, [runHostAction, transport]);

  /** Marks the host's own seat ("This is me"), or clears it with null. */
  const setHostPlayer = useCallback(async (playerId: string | null) => {
    const current = sessionRef.current;
    const setSeat = transport.setHostPlayer;
    if (current.mode !== "hosting" || !current.recovery || !setSeat) return;
    const { publicId, hostSecret } = current.recovery;
    await runHostAction(publicId, () => setSeat({ publicId, hostSecret, playerId }));
  }, [runHostAction, transport]);

  /** Turns "Players confirm each other" on or off (off cancels open proposals). */
  const setPeerConfirm = useCallback(async (on: boolean) => {
    const current = sessionRef.current;
    const send = transport.setPeerConfirm;
    if (current.mode !== "hosting" || !current.recovery || !send) return;
    const { publicId, hostSecret } = current.recovery;
    const controllerId = getHostControllerId(() => createCapability(18));
    await runHostAction(publicId, () => send({ publicId, hostSecret, controllerId, on }));
  }, [runHostAction, transport]);

  /**
   * Runs one agreement request as the controlling host tab; resolves to its
   * result, or null after showing why it failed.
   */
  const runAgreementRequest = useCallback(async (
    request: (host: { publicId: string; hostSecret: string; controllerId: string }) => Promise<AgreementResult>
  ): Promise<AgreementResult | null> => {
    const current = sessionRef.current;
    if (current.mode !== "hosting" || !current.recovery) return null;
    const { publicId, hostSecret } = current.recovery;
    let value: AgreementResult | null = null;
    await runHostAction(publicId, async () => {
      value = await request({
        publicId,
        hostSecret,
        controllerId: getHostControllerId(() => createCapability(18))
      });
    });
    return value;
  }, [runHostAction]);

  /** Answers for the host's seat, a seat with no phone, or a bank buy-in. */
  const answerAgreement = useCallback(async (
    agreementId: Id<"roomAgreements">,
    answer: "confirm" | "not_right"
  ) => {
    const send = transport.hostAnswerAgreement;
    if (!send) return null;
    return await runAgreementRequest((host) => send({ ...host, agreementId, answer }));
  }, [runAgreementRequest, transport]);

  /** Dismiss a bounced entry, or Record anyway. */
  const resolveBouncedAgreement = useCallback(async (
    agreementId: Id<"roomAgreements">,
    decision: "dismiss" | "record"
  ) => {
    const send = transport.hostResolveBounced;
    if (!send) return null;
    return await runAgreementRequest((host) => send({ ...host, agreementId, decision }));
  }, [runAgreementRequest, transport]);

  return {
    claimHost,
    setPeerConfirm,
    answerAgreement,
    resolveBouncedAgreement,
    releaseSeat,
    assignSeat,
    setHostPlayer,
    decideGuestTransaction,
    setJoiningOpen,
    setFriendVisibility,
    rotateInvite,
    setWatchLink,
    revokeGuest
  };
}
