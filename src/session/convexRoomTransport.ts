import type { ConvexClient } from "convex/browser";
import type { api as generatedApi } from "../../convex/_generated/api";
import { CREATION_LIMITED_CODE, ROOM_CREATION_LIMITED_MESSAGE } from "./creationLimits";
import type { RoomTransport } from "./types";

type Api = typeof generatedApi;
type Loaded = { client: ConvexClient; api: Api };

let client: ConvexClient | null = null;
let loading: Promise<Loaded> | null = null;

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

/** Loads the Convex client chunk without connecting; a no-op when sharing is not configured. */
export function preloadConvexClient(): Promise<unknown> {
  if (!deploymentUrl()) return Promise.resolve();
  return import("./convexClient");
}

/**
 * The Convex client (and the generated API) is a separate chunk, loaded the
 * first time a shared-room or friend feature needs it. One client is created
 * and reused, as before.
 */
function loadClient(): Promise<Loaded> {
  const url = deploymentUrl();
  if (!url) return Promise.reject(new Error(SHARING_UNAVAILABLE_MESSAGE));
  loading ??= import("./convexClient").then(
    (module) => {
      client ??= new module.ConvexClient(url, { unsavedChangesWarning: false });
      return { client, api: module.api };
    },
    (error: unknown) => {
      loading = null;
      throw error;
    }
  );
  return loading;
}

/**
 * Starts a subscription once the client is loaded, keeping the synchronous
 * subscribe/unsubscribe contract. Unsubscribing before the client loads
 * cancels the subscription; a client that cannot load is reported through
 * onError when one is given.
 */
function subscribeWhenLoaded(
  start: (loaded: Loaded) => () => void,
  onError?: (error: Error) => void
): () => void {
  let unsubscribe: (() => void) | null = null;
  let cancelled = false;
  void loadClient().then(
    (loaded) => {
      if (!cancelled) unsubscribe = start(loaded);
    },
    (error: unknown) => {
      if (!cancelled) onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  );
  return () => {
    cancelled = true;
    unsubscribe?.();
  };
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
    return subscribeWhenLoaded(({ client: current }) => {
      let connected = current.connectionState().isWebSocketConnected;
      listener(connected);
      // The client reports every connection-state change, including each
      // request starting or finishing. Only connecting and disconnecting are
      // passed on: a guest's reconnect heartbeat is itself a request, so
      // forwarding the rest looped heartbeats forever and froze the page.
      return current.subscribeToConnectionState((state) => {
        if (state.isWebSocketConnected === connected) return;
        connected = state.isWebSocketConnected;
        listener(connected);
      });
    });
  },
  async createRoom(args) {
    const request = clean(args);
    const { client: convex, api } = await loadClient();
    return await convex.mutation(api.rooms.create, request);
  },
  async getInvitePreview(publicId, inviteSecret) {
    const { client: convex, api } = await loadClient();
    return await convex.query(api.rooms.invitePreview, { publicId, inviteSecret });
  },
  async joinRoom(args) {
    const { client: convex, api } = await loadClient();
    return await convex.mutation(api.rooms.join, args);
  },
  async joinFriendRoom(args) {
    const { client: convex, api } = await loadClient();
    return await convex.mutation(api.rooms.joinFriend, args);
  },
  async createFriendProfile(args) {
    const { client: convex, api } = await loadClient();
    return await convex.mutation(api.friendProfiles.create, args);
  },
  async lookupFriendProfile(friendCode) {
    const { client: convex, api } = await loadClient();
    return await convex.query(api.friendProfiles.lookup, { friendCode });
  },
  async updateFriendProfileName(args) {
    const { client: convex, api } = await loadClient();
    return await convex.mutation(api.friendProfiles.updateName, args);
  },
  async rotateFriendCode(args) {
    const { client: convex, api } = await loadClient();
    return await convex.mutation(api.friendProfiles.rotateCode, args);
  },
  subscribeFriendActivity(friendCodes, onUpdate, onError) {
    return subscribeWhenLoaded(
      ({ client: current, api }) =>
        current.onUpdate(api.friendProfiles.listActivity, { friendCodes }, onUpdate, onError),
      onError
    );
  },
  subscribeHost(args, onUpdate, onError) {
    return subscribeWhenLoaded(
      ({ client: current, api }) => current.onUpdate(api.rooms.hostView, args, onUpdate, onError),
      onError
    );
  },
  subscribeGuest(args, onUpdate, onError) {
    return subscribeWhenLoaded(
      ({ client: current, api }) => current.onUpdate(api.rooms.guestView, args, onUpdate, onError),
      onError
    );
  },
  async heartbeat(publicId, guestSecret, sessionId) {
    const { client: convex, api } = await loadClient();
    await convex.mutation(api.rooms.heartbeat, { publicId, guestSecret, sessionId });
  },
  async submitGuestTransaction(args) {
    const request = clean(args);
    const { client: convex, api } = await loadClient();
    return await convex.mutation(api.rooms.submitGuestTransaction, request);
  },
  async decideGuestTransaction(args) {
    const request = clean(args);
    const { client: convex, api } = await loadClient();
    await convex.mutation(api.rooms.decideGuestTransaction, request);
  },
  async setJoiningOpen(args) {
    const request = clean(args);
    const { client: convex, api } = await loadClient();
    await convex.mutation(api.rooms.setJoiningOpen, request);
  },
  async setFriendVisibility(args) {
    const { client: convex, api } = await loadClient();
    await convex.mutation(api.rooms.setFriendVisibility, args);
  },
  async rotateInvite(args) {
    const request = clean(args);
    const { client: convex, api } = await loadClient();
    await convex.mutation(api.rooms.rotateInvite, request);
  },
  async revokeGuest(args) {
    const request = clean(args);
    const { client: convex, api } = await loadClient();
    await convex.mutation(api.rooms.revokeGuest, request);
  },
  async getRoomHistory(credentials) {
    const { client: convex, api } = await loadClient();
    const settled = await Promise.allSettled(
      credentials.map((credential) =>
        convex.query(api.rooms.historyView, {
          publicId: credential.publicId,
          role: credential.role,
          secret: credential.secret
        })
      )
    );
    return settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  },
  async applyAction(args) {
    const request = clean(args);
    const { client: convex, api } = await loadClient();
    return await convex.mutation(api.rooms.applyAction, request);
  },
  async acknowledgeHostNotifications(args) {
    const request = clean(args);
    const { client: convex, api } = await loadClient();
    await convex.mutation(api.rooms.acknowledgeHostNotifications, request);
  },
  async acknowledgeGuestNotifications(args) {
    const request = clean(args);
    const { client: convex, api } = await loadClient();
    await convex.mutation(api.rooms.acknowledgeGuestNotifications, request);
  },
  async claimHost(publicId, hostSecret, controllerId) {
    const { client: convex, api } = await loadClient();
    await convex.mutation(api.rooms.claimHost, { publicId, hostSecret, controllerId });
  },
  async endRoom(args) {
    const { client: convex, api } = await loadClient();
    return await convex.mutation(api.rooms.end, args);
  }
};

export function roomErrorMessage(error: unknown): string {
  const data = convexErrorData(error);
  if (data?.code === CREATION_LIMITED_CODE) {
    return data.message ?? ROOM_CREATION_LIMITED_MESSAGE;
  }
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

/**
 * Message for friend-profile requests: server-provided messages (including
 * creation limits) are shown as-is, local errors keep their own text.
 */
export function friendProfileErrorMessage(error: unknown, fallback: string): string {
  const data = convexErrorData(error);
  if (data?.message) return data.message;
  if (data) return fallback;
  return error instanceof Error && error.message ? error.message : fallback;
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
