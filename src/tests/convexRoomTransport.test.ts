import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real client would open a WebSocket; this stand-in records what the transport asks of it.
const clients: FakeClient[] = [];
class FakeClient {
  readonly url: string;
  readonly subscriptions: Array<{ query: unknown; args: unknown; active: boolean }> = [];
  readonly mutation = vi.fn(async (_reference: unknown, _args: unknown) => "ok");
  readonly query = vi.fn(async (_reference: unknown, _args: unknown) => "ok");
  connected = false;
  connectionListeners = new Set<(state: { isWebSocketConnected: boolean }) => void>();

  constructor(url: string) {
    this.url = url;
    clients.push(this);
  }

  connectionState() {
    return { isWebSocketConnected: this.connected };
  }

  subscribeToConnectionState(listener: (state: { isWebSocketConnected: boolean }) => void) {
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
    rooms: { create: "rooms.create", hostView: "rooms.hostView", guestView: "rooms.guestView" },
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
