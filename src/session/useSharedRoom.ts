import { useCallback, useEffect } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { roomErrorMessage } from "./convexRoomTransport";
import type { SessionState } from "./sessionState";
import type { RoomTransport } from "./types";

/** Tracks the transport connection for every shared-room mode and pings guest presence on reconnect. */
export function useRoomConnection(
  session: SessionState,
  transport: RoomTransport,
  sessionRef: RefObject<SessionState>,
  setSession: Dispatch<SetStateAction<SessionState>>
) {
  useEffect(() => {
    if (session.mode === "local" || session.mode === "invalid_invite") return;
    return transport.subscribeToConnection((connected) => {
      setSession((current) =>
        current.mode === "guest" ||
        current.mode === "hosting" ||
        current.mode === "creating_room" ||
        current.mode === "ending" ||
        current.mode === "recovery_required" ||
        current.mode === "room_unavailable"
          ? { ...current, connected }
          : current
      );
      const current = sessionRef.current;
      if (connected && current.mode === "guest") {
        void transport
          .heartbeat(
            current.credentials.publicId,
            current.credentials.guestSecret,
            current.credentials.presenceSessionId
          )
          .catch(() => undefined);
      }
    });
  }, [session.mode, transport]);
}

export function useMarkNotificationsRead(
  transport: RoomTransport,
  sessionRef: RefObject<SessionState>,
  setSession: Dispatch<SetStateAction<SessionState>>
) {
  return useCallback(async () => {
    const current = sessionRef.current;
    try {
      const hostSession =
        current.mode === "hosting" ||
        current.mode === "ending" ||
        current.mode === "recovery_required";
      if (hostSession && current.recovery && current.room) {
        await transport.acknowledgeHostNotifications({
          publicId: current.recovery.publicId,
          hostSecret: current.recovery.hostSecret,
          throughVersion: current.room.version
        });
      } else if (current.mode === "guest" && current.room) {
        await transport.acknowledgeGuestNotifications({
          publicId: current.credentials.publicId,
          guestSecret: current.credentials.guestSecret,
          throughVersion: current.room.version
        });
      }
    } catch (error) {
      setSession((next) =>
        next.mode === "guest" ||
        next.mode === "hosting" ||
        next.mode === "ending" ||
        next.mode === "recovery_required"
          ? { ...next, error: roomErrorMessage(error) }
          : next
      );
    }
  }, [transport]);
}
