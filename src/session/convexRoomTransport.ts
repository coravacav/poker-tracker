import { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { RoomTransport } from "./types";

const roomApi = api.rooms;
let client: ConvexClient | null = null;

function deploymentUrl(): string | null {
  const value = import.meta.env.VITE_CONVEX_URL?.trim();
  return value || null;
}

function getClient(): ConvexClient {
  const url = deploymentUrl();
  if (!url) throw new Error("Realtime sharing is not configured on this installation.");
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
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === "object" && "message" in data) {
      const message = (data as { message?: unknown }).message;
      if (typeof message === "string") return message;
    }
  }
  return error instanceof Error ? error.message : "Realtime room request failed.";
}
