import { useCallback, useEffect, useRef, useState } from "react";
import { loadRoomHistoryCredentials, saveRoomHistoryCredential } from "./sessionPersistence";
import type { SessionState } from "./sessionState";
import type { RoomHistoryProjection, RoomTransport } from "./types";

export function useRoomHistory(transport: RoomTransport) {
  const [roomHistory, setRoomHistory] = useState<RoomHistoryProjection[]>([]);

  const refreshRoomHistory = useCallback(async () => {
    if (!transport.configured) {
      return;
    }
    const credentials = loadRoomHistoryCredentials();
    if (credentials.length === 0) return;
    const rooms = await transport.getRoomHistory(credentials);
    setRoomHistory(rooms.sort((left, right) => right.createdAt - left.createdAt));
  }, [transport]);

  useEffect(() => {
    void refreshRoomHistory();
  }, [refreshRoomHistory]);

  return { roomHistory, refreshRoomHistory };
}

/** Remembers each hosted or joined room so it appears in room history. */
export function useRoomHistoryCredentials(session: SessionState, deploymentUrl: string | null) {
  const historyCredentialSavedRef = useRef(new Set<string>());

  useEffect(() => {
    if (session.mode === "hosting" && session.recovery) {
      const key = `host:${session.recovery.publicId}`;
      if (historyCredentialSavedRef.current.has(key)) return;
      historyCredentialSavedRef.current.add(key);
      saveRoomHistoryCredential({
        schemaVersion: 1,
        publicId: session.recovery.publicId,
        role: "host",
        secret: session.recovery.hostSecret,
        roomName: session.recovery.roomName,
        joinedAt: Date.now(),
        ...(deploymentUrl ? { deploymentUrl } : {})
      });
    } else if (session.mode === "guest") {
      const key = `guest:${session.credentials.publicId}`;
      if (historyCredentialSavedRef.current.has(key)) return;
      historyCredentialSavedRef.current.add(key);
      saveRoomHistoryCredential({
        schemaVersion: 1,
        publicId: session.credentials.publicId,
        role: "guest",
        secret: session.credentials.guestSecret,
        roomName: session.room?.name ?? "Shared poker game",
        joinedAt: Date.now(),
        displayName: session.credentials.displayName,
        ...(deploymentUrl ? { deploymentUrl } : {})
      });
    }
  }, [deploymentUrl, session]);
}
