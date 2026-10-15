import { act, renderHook } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionState } from "../session/sessionState";
import { useRoomConnection } from "../session/useSharedRoom";

// The real client would open a WebSocket; this stand-in records what the transport asks of it.
const clients: FakeClient[] = [];
type FakeConnectionState = { isWebSocketConnected: boolean; inflightRequests?: number };
// Past this many requests the fake stops notifying, so a feedback loop fails the test instead of hanging it.
const MAX_NOTIFYING_REQUESTS = 50;

class FakeClient {
  readonly url: string;
  readonly subscriptions: Array<{ query: unknown; args: unknown; active: boolean }> = [];
  readonly query = vi.fn(async (_reference: unknown, _args: unknown) => "ok");
  connected = false;
  inflightRequests = 0;
  connectionListeners = new Set<(state: FakeConnectionState) => void>();
  readonly mutation = vi.fn(async (_reference: unknown, _args: unknown) => {
    // Like the real client, each request starting and finishing is a connection-state change.
    this.inflightRequests += 1;
    this.publishConnectionState();
    await Promise.resolve();
    this.inflightRequests -= 1;
    this.publishConnectionState();
    return "ok";
  });

  constructor(url: string) {
    this.url = url;
    clients.push(this);
  }

  connectionState(): FakeConnectionState {
    return { isWebSocketConnected: this.connected, inflightRequests: this.inflightRequests };
  }

  /** The real client publishes changes from a microtask. */
  publishConnectionState() {
    if (this.mutation.mock.calls.length > MAX_NOTIFYING_REQUESTS) return;
    void Promise.resolve().then(() => {
      const state = this.connectionState();
      this.connectionListeners.forEach((notify) => notify(state));
    });
  }

  subscribeToConnectionState(listener: (state: FakeConnectionState) => void) {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  onUpdate(query: unknown, args: unknown) {
    const subscription = { query, args, active: true };
    this.subscriptions.push(subscription);
    return () => {
      subscription.active = false;
    };
  }
}

vi.mock("../session/convexClient", () => ({
  ConvexClient: FakeClient,
  api: {
    rooms: {
      create: "rooms.create",
      heartbeat: "rooms.heartbeat",
      hostView: "rooms.hostView",
      guestView: "rooms.guestView"
    },
    friendProfiles: { listActivity: "friendProfiles.listActivity" }
  }
}));

async function loadTransport() {
  vi.resetModules();
  return await import("../session/convexRoomTransport");
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("convexRoomTransport with a lazily loaded client", () => {
  beforeEach(() => {
    clients.length = 0;
    vi.stubEnv("VITE_CONVEX_URL", "https://example.convex.cloud/");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates one client on first use and sends requests through it", async () => {
    const { convexRoomTransport } = await loadTransport();
    expect(convexRoomTransport.connectionState()).toBe(false);
    expect(clients).toHaveLength(0);

    const args = { name: "Friday" } as unknown as Parameters<typeof convexRoomTransport.createRoom>[0];
    await convexRoomTransport.createRoom(args);
    await convexRoomTransport.createRoom(args);

    expect(clients).toHaveLength(1);
    expect(clients[0].url).toBe("https://example.convex.cloud");
    expect(clients[0].mutation).toHaveBeenCalledTimes(2);
    expect(clients[0].mutation).toHaveBeenCalledWith("rooms.create", { name: "Friday" });
  });

  it("starts subscriptions once loaded and cancels ones dropped before that", async () => {
    const { convexRoomTransport } = await loadTransport();
    const onError = vi.fn();
    const args = { publicId: "room", guestSecret: "secret" } as unknown as Parameters<
      typeof convexRoomTransport.subscribeGuest
    >[0];

    const dropEarly = convexRoomTransport.subscribeGuest(args, () => undefined, onError);
    dropEarly();
    const keep = convexRoomTransport.subscribeGuest(args, () => undefined, onError);
    await flush();

    expect(clients[0].subscriptions).toEqual([{ query: "rooms.guestView", args, active: true }]);
    keep();
    expect(clients[0].subscriptions[0].active).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports the current connection once loaded and follows changes", async () => {
    const { convexRoomTransport } = await loadTransport();
    const listener = vi.fn();
    const unsubscribe = convexRoomTransport.subscribeToConnection(listener);
    await flush();

    expect(listener).toHaveBeenCalledWith(false);
    clients[0].connected = true;
    clients[0].connectionListeners.forEach((notify) => notify({ isWebSocketConnected: true }));
    expect(listener).toHaveBeenLastCalledWith(true);
    expect(convexRoomTransport.connectionState()).toBe(true);
    // Other state changes (requests in flight) are not reported as reconnects.
    clients[0].connectionListeners.forEach((notify) => notify({ isWebSocketConnected: true }));
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    expect(clients[0].connectionListeners.size).toBe(0);
  });

  it("sends one presence heartbeat when a guest connects instead of looping on its own request", async () => {
    const { convexRoomTransport } = await loadTransport();
    const guest = {
      mode: "guest",
      credentials: {
        schemaVersion: 1,
        publicId: "room",
        guestSecret: "guest-secret",
        presenceSessionId: "presence",
        displayName: "Casey"
      },
      room: null,
      connected: false,
      error: null
    } as SessionState;
    const { result, unmount } = renderHook(() => {
      const [session, setSession] = useState<SessionState>(guest);
      const sessionRef = useRef(session);
      sessionRef.current = session;
      useRoomConnection(session, convexRoomTransport, sessionRef, setSession);
      return session;
    });
    await act(flush);

    await act(async () => {
      clients[0].connected = true;
      clients[0].publishConnectionState();
      await flush();
    });

    expect(result.current).toMatchObject({ mode: "guest", connected: true });
    expect(clients[0].mutation).toHaveBeenCalledTimes(1);
    expect(clients[0].mutation).toHaveBeenCalledWith("rooms.heartbeat", {
      publicId: "room",
      guestSecret: "guest-secret",
      sessionId: "presence"
    });
    unmount();
  });

  it("stays unavailable without loading the client when no deployment is configured", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "");
    const { convexRoomTransport, SHARING_UNAVAILABLE_MESSAGE } = await loadTransport();

    expect(convexRoomTransport.configured).toBe(false);
    await expect(
      convexRoomTransport.createRoom({} as Parameters<typeof convexRoomTransport.createRoom>[0])
    ).rejects.toThrow(SHARING_UNAVAILABLE_MESSAGE);
    expect(convexRoomTransport.subscribeToConnection(() => undefined)).toBeTypeOf("function");
    await flush();
    expect(clients).toHaveLength(0);
  });
});
