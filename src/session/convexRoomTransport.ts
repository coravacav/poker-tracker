import { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { RoomTransport } from "./types";

const roomApi = api.rooms;
let client: ConvexClient | null = null;

export const SHARING_UNAVAILABLE_MESSAGE =
  "Game sharing is unavailable right now. Please try again later.";

const SHARING_REQUEST_FAILED_MESSAGE =
  "Something went wrong with game sharing. Please try again.";

function deploymentUrl(): string | null {
  const value = import.meta.env.VITE_CONVEX_URL?.trim();
  return value ? value.replace(/\/+$/, "") : null;
}

export function configuredDeploymentUrl(): string | null {
  return deploymentUrl();
}

function getClient(): ConvexClient {
  const url = deploymentUrl();
  if (!url) throw new Error(SHARING_UNAVAILABLE_MESSAGE);
  client ??= new ConvexClient(url, { unsavedChangesWarning: false });
  return client;
}

function clean<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const convexRoomTransport: RoomTransport = {
  get configured() {
    return deploymentUrl() !== null;
  },
  connectionState: () => (client ? client.connectionState().isWebSocketConnected : false),
  subscribeToConnection(listener) {
    if (!deploymentUrl()) return () => undefined;
    const current = getClient();
    listener(current.connectionState().isWebSocketConnected);
    return current.subscribeToConnectionState((state) => listener(state.isWebSocketConnected));
  },
  async createRoom(args) {
    return await getClient().mutation(roomApi.create, clean(args));
  },
  async getInvitePreview(publicId, inviteSecret) {
    return await getClient().query(roomApi.invitePreview, { publicId, inviteSecret });
  },
  async joinRoom(args) {
    return await getClient().mutation(roomApi.join, args);
  },
  subscribeHost(args, onUpdate, onError) {
    return getClient().onUpdate(roomApi.hostView, args, onUpdate, onError);
  },
  subscribeGuest(args, onUpdate, onError) {
    return getClient().onUpdate(roomApi.guestView, args, onUpdate, onError);
  },
  async heartbeat(publicId, guestSecret, sessionId) {
    await getClient().mutation(roomApi.heartbeat, { publicId, guestSecret, sessionId });
  },
  async submitGuestTransaction(args) {
    return await getClient().mutation(roomApi.submitGuestTransaction, clean(args));
  },
  async decideGuestTransaction(args) {
    await getClient().mutation(roomApi.decideGuestTransaction, clean(args));
  },
  async setJoiningOpen(args) {
    await getClient().mutation(roomApi.setJoiningOpen, clean(args));
  },
  async rotateInvite(args) {
    await getClient().mutation(roomApi.rotateInvite, clean(args));
  },
  async revokeGuest(args) {
    await getClient().mutation(roomApi.revokeGuest, clean(args));
  },
  async getRoomHistory(credentials) {
    const settled = await Promise.allSettled(
      credentials.map((credential) =>
        getClient().query(roomApi.historyView, {
          publicId: credential.publicId,
          role: credential.role,
          secret: credential.secret
        })
      )
    );
    return settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  },
  async applyAction(args) {
    return await getClient().mutation(roomApi.applyAction, clean(args));
  },
  async acknowledgeHostNotifications(args) {
    await getClient().mutation(roomApi.acknowledgeHostNotifications, clean(args));
  },
  async acknowledgeGuestNotifications(args) {
    await getClient().mutation(roomApi.acknowledgeGuestNotifications, clean(args));
  },
  async claimHost(publicId, hostSecret, controllerId) {
    await getClient().mutation(roomApi.claimHost, { publicId, hostSecret, controllerId });
  },
  async endRoom(args) {
    return await getClient().mutation(roomApi.end, args);
  }
};

export function roomErrorMessage(error: unknown): string {
  const data = convexErrorData(error);
  if (data?.message) {
    return data.message;
  }
  if (error instanceof Error && error.message === "Shared room was not found.") {
    return error.message;
  }
  return error instanceof Error && error.message === SHARING_UNAVAILABLE_MESSAGE
    ? SHARING_UNAVAILABLE_MESSAGE
    : SHARING_REQUEST_FAILED_MESSAGE;
}

export function roomErrorCode(error: unknown): string | null {
  const data = convexErrorData(error);
  if (data?.code) return data.code;
  const message = data?.message ?? (error instanceof Error ? error.message : null);
  if (message === "Shared room was not found.") return "ROOM_NOT_FOUND";
  return null;
}

function convexErrorData(error: unknown): { code?: string; message?: string } | null {
  if (!error || typeof error !== "object" || !("data" in error)) return null;
  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const candidate = data as { code?: unknown; message?: unknown };
  return {
    code: typeof candidate.code === "string" ? candidate.code : undefined,
    message: typeof candidate.message === "string" ? candidate.message : undefined
  };
}
