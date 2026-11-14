// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import presenceTest from "@convex-dev/presence/test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import type { Transaction } from "../src/domain/pokerTypes";
import { MAX_ROOM_ACTIONS } from "../src/session/roomProtocol";
import { createDefaultGameState } from "../src/state/seedGame";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { commitRoomAction } from "./lib/roomActions";
import schema from "./schema";

const modules = import.meta.glob("./**/!(*.*.*)*.*s");
const hostSecret = "host_abcdefghijklmnopqrstuvwxyz0123456789AB";
const inviteSecret = "invite_abcdefghijklmnopqrstuvwxyz0123456789";
const guestSecret = "guest_abcdefghijklmnopqrstuvwxyz0123456789A";
const otherGuestSecret = "guest_zyxwvutsrqponmlkjihgfedcba9876543210Z";
const controllerId = "controller_abcdefghijklmnop";
const publicId = "room_abcdefghijklmnop";

type Test = ReturnType<typeof setup>;

function setup() {
  const test = convexTest(schema, modules);
  presenceTest.register(test);
  rateLimiterTest.register(test);
  return test;
}

async function createRoom() {
  const test = setup();
  const snapshot = createDefaultGameState();
  await test.mutation(api.rooms.create, {
    publicId,
    localGameId: snapshot.localGameId,
    snapshot,
    hostSecret,
    inviteSecret,
    controllerId
  });
  const [first, second, third] = snapshot.players.map((player) => player.id);
  return { test, snapshot, players: { first, second, third } };
}

async function join(test: Test, secret = guestSecret, displayName = "Maya") {
  await test.mutation(api.rooms.join, { publicId, inviteSecret, guestSecret: secret, displayName });
}

function buyIn(toPlayerId: string, amountCents = 2000, extra: Partial<Transaction> = {}) {
  return { type: "bank_buy_in" as const, amountCents, toPlayerId, ...extra };
}

async function roomDoc(test: Test) {
  return await test.run(async (ctx) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_public_id", (index) => index.eq("publicId", publicId))
      .unique();
    if (!room) throw new Error("room missing");
    return room;
  });
}

async function requestDoc(test: Test, requestId: Id<"roomGuestRequests">) {
  return await test.run(async (ctx) => await ctx.db.get("roomGuestRequests", requestId));
}

function hostAction(expectedVersion: number, clientActionId: string, action: unknown) {
  return { publicId, hostSecret, controllerId, expectedVersion, clientActionId, action };
}

function decide(
  requestId: Id<"roomGuestRequests">,
  decision: "approved" | "rejected",
  expectedVersion: number
) {
  return { publicId, hostSecret, controllerId, requestId, decision, expectedVersion };
}

/** A write the server makes on its own (later: an entry two players agreed on). */
async function serverAuthoredBuyIn(test: Test, toPlayerId: string, clientActionId: string) {
  await test.run(async (ctx) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_public_id", (index) => index.eq("publicId", publicId))
      .unique();
    if (!room) throw new Error("room missing");
    await commitRoomAction(
      ctx,
      room,
      { type: "add_transaction", transaction: buyIn(toPlayerId, 500) },
      { actorLabel: "Server", clientActionId, hostAuthored: false }
    );
  });
}

describe("guest transaction requests", () => {
  it("lets the host approve a guest's request into the ledger", async () => {
    const { test, players } = await createRoom();
    await join(test);
    const requestId = await test.mutation(api.rooms.submitGuestTransaction, {
      publicId,
      guestSecret,
      transaction: buyIn(players.first)
    });

    const waiting = await test.query(api.rooms.hostView, { publicId, hostSecret, controllerId });
    expect(waiting.guestRequests).toEqual([
      expect.objectContaining({ id: requestId, displayName: "Maya", status: "pending" })
    ]);

    await test.mutation(api.rooms.decideGuestTransaction, decide(requestId, "approved", 0));

    const host = await test.query(api.rooms.hostView, { publicId, hostSecret, controllerId });
    expect(host.version).toBe(1);
    expect(host.guestRequests).toEqual([]);
    expect(host.state.transactions).toEqual([
      expect.objectContaining({ type: "bank_buy_in", amountCents: 2000, toPlayerId: players.first })
    ]);
    expect(host.activity.events[0]).toMatchObject({
      summary: "Player 1 bought in for $20.00",
      actorLabel: "Host-approved guest request"
    });
    expect((await requestDoc(test, requestId))?.status).toBe("approved");

    const room = await roomDoc(test);
    expect(room).toMatchObject({ version: 1, hostBaseVersion: 1, acceptedActionCount: 1 });
    const processed = await test.run(async (ctx) =>
      await ctx.db
        .query("processedActions")
        .withIndex("by_room_id_and_client_action_id", (index) =>
          index.eq("roomId", room._id).eq("clientActionId", `guest_request_${requestId}`)
        )
        .unique()
    );
    expect(processed?.resultingVersion).toBe(1);

    await expect(
      test.mutation(api.rooms.decideGuestTransaction, decide(requestId, "approved", 1))
    ).rejects.toThrow(/no longer pending/);
  });

  it("rejects a request without changing the room", async () => {
    const { test, players } = await createRoom();
    await join(test);
    const requestId = await test.mutation(api.rooms.submitGuestTransaction, {
      publicId,
      guestSecret,
      transaction: buyIn(players.first)
    });
    await test.mutation(api.rooms.decideGuestTransaction, decide(requestId, "rejected", 0));

    expect((await requestDoc(test, requestId))?.status).toBe("rejected");
    const host = await test.query(api.rooms.hostView, { publicId, hostSecret, controllerId });
    expect(host.version).toBe(0);
    expect(host.state.transactions).toEqual([]);
    expect(host.guestRequests).toEqual([]);
  });

  it("refuses invalid requests and caps how many one guest may leave waiting", async () => {
    const { test, players } = await createRoom();
    await join(test);
    await expect(
      test.mutation(api.rooms.submitGuestTransaction, {
        publicId,
        guestSecret,
        transaction: buyIn("player_missing")
      })
    ).rejects.toThrow();
    for (let index = 0; index < 10; index += 1) {
      await test.mutation(api.rooms.submitGuestTransaction, {
        publicId,
        guestSecret,
        transaction: buyIn(players.first, 100 + index)
      });
    }
    await expect(
      test.mutation(api.rooms.submitGuestTransaction, {
        publicId,
        guestSecret,
        transaction: buyIn(players.first)
      })
    ).rejects.toThrow(/Wait for the host/);
  });

  it("strips agreement details a guest tries to submit", async () => {
    const { test, players } = await createRoom();
    await join(test);
    const requestId = await test.mutation(api.rooms.submitGuestTransaction, {
      publicId,
      guestSecret,
      transaction: {
        type: "player_gave",
        amountCents: 2000,
        fromPlayerId: players.first,
        toPlayerId: players.second,
        category: "poker",
        proposedByPlayerId: players.first,
        confirmedByPlayerId: players.second,
        agreementId: "agreement_forged",
        confirmedVia: "peer"
      }
    });
    await test.mutation(api.rooms.decideGuestTransaction, decide(requestId, "approved", 0));
    const host = await test.query(api.rooms.hostView, { publicId, hostSecret, controllerId });
    const [recorded] = host.state.transactions;
    expect(recorded).toMatchObject({ type: "player_gave", fromPlayerId: players.first });
    for (const key of ["proposedByPlayerId", "confirmedByPlayerId", "agreementId", "confirmedVia"]) {
      expect(recorded).not.toHaveProperty(key);
    }
  });

  it("rejects a revoked guest's waiting requests and leaves other guests' alone", async () => {
    const { test, players } = await createRoom();
    await join(test);
    await join(test, otherGuestSecret, "Jon");
    const revokedRequest = await test.mutation(api.rooms.submitGuestTransaction, {
      publicId,
      guestSecret,
      transaction: buyIn(players.first)
    });
    const otherRequest = await test.mutation(api.rooms.submitGuestTransaction, {
      publicId,
      guestSecret: otherGuestSecret,
      transaction: buyIn(players.second)
    });
    const guestId = (await requestDoc(test, revokedRequest))!.guestId;

    await test.mutation(api.rooms.revokeGuest, { publicId, hostSecret, guestId });

    expect((await requestDoc(test, revokedRequest))?.status).toBe("rejected");
    expect((await requestDoc(test, otherRequest))?.status).toBe("pending");
    await expect(
      test.mutation(api.rooms.decideGuestTransaction, decide(revokedRequest, "approved", 0))
    ).rejects.toThrow(/no longer pending/);
    const host = await test.query(api.rooms.hostView, { publicId, hostSecret, controllerId });
    expect(host.guestRequests.map((request: { id: string }) => request.id)).toEqual([otherRequest]);
  });

  it("refuses to approve a request a revoked guest left waiting before revoking cleared it", async () => {
    const { test, players } = await createRoom();
    await join(test);
    const requestId = await test.mutation(api.rooms.submitGuestTransaction, {
      publicId,
      guestSecret,
      transaction: buyIn(players.first)
    });
    // A guest revoked before revocation rejected their requests.
    await test.run(async (ctx) => {
      const request = await ctx.db.get("roomGuestRequests", requestId);
      await ctx.db.patch(request!.guestId, { revokedAt: Date.now() });
    });

    await expect(
      test.mutation(api.rooms.decideGuestTransaction, decide(requestId, "approved", 0))
    ).rejects.toThrow(/no longer has access/);
    await test.mutation(api.rooms.decideGuestTransaction, decide(requestId, "rejected", 0));
    expect((await requestDoc(test, requestId))?.status).toBe("rejected");
    expect((await roomDoc(test)).version).toBe(0);
  });

  it("rejects waiting requests when the room ends", async () => {
    const { test, players } = await createRoom();
    await join(test);
    const requestId = await test.mutation(api.rooms.submitGuestTransaction, {
      publicId,
      guestSecret,
      transaction: buyIn(players.first)
    });
    await test.mutation(api.rooms.end, {
      publicId,
      hostSecret,
      controllerId,
      expectedVersion: 0,
      clientActionId: "action_end_with_requests"
    });

    expect((await requestDoc(test, requestId))?.status).toBe("rejected");
    await expect(
      test.mutation(api.rooms.decideGuestTransaction, decide(requestId, "approved", 0))
    ).rejects.toThrow(/no longer active/);
    await expect(
      test.mutation(api.rooms.submitGuestTransaction, {
        publicId,
        guestSecret,
        transaction: buyIn(players.first)
      })
    ).rejects.toThrow(/no longer active/);
  });

  it("counts approvals against the room's action limit", async () => {
    const { test, players } = await createRoom();
    await join(test);
    const requestId = await test.mutation(api.rooms.submitGuestTransaction, {
      publicId,
      guestSecret,
      transaction: buyIn(players.first)
    });
    const room = await roomDoc(test);
    await test.run(async (ctx) => {
      await ctx.db.patch(room._id, { acceptedActionCount: MAX_ROOM_ACTIONS });
    });
    await expect(
      test.mutation(api.rooms.decideGuestTransaction, decide(requestId, "approved", 0))
    ).rejects.toThrow(/action limit/);
    expect((await requestDoc(test, requestId))?.status).toBe("pending");
  });
});

describe("rebasing stale host actions", () => {
  it("applies an additive host action sent before a server-authored change", async () => {
    const { test, players } = await createRoom();
    await serverAuthoredBuyIn(test, players.second, "server_change_123456");
    expect(await roomDoc(test)).toMatchObject({ version: 1, hostBaseVersion: 0 });

    const result = await test.mutation(
      api.rooms.applyAction,
      hostAction(0, "action_stale_buy_in_1234", {
        type: "add_transaction",
        transaction: buyIn(players.first)
      })
    );
    expect(result.version).toBe(2);
    expect(result.resultingVersion).toBe(2);
    expect(result.state.transactions.map((transaction: Transaction) => transaction.toPlayerId))
      .toEqual([players.second, players.first]);
    expect(await roomDoc(test)).toMatchObject({ version: 2, hostBaseVersion: 2 });

    const host = await test.query(api.rooms.hostView, { publicId, hostSecret, controllerId });
    expect(host.activity.events.map((event: { actorLabel: string }) => event.actorLabel).slice(0, 2))
      .toEqual(["Host", "Server"]);
  });

  it("refuses a stale action that depends on the latest state", async () => {
    const { test, players } = await createRoom();
    const added = await test.mutation(
      api.rooms.applyAction,
      hostAction(0, "action_first_buy_in_1234", {
        type: "add_transaction",
        transaction: buyIn(players.first)
      })
    );
    const transaction = added.state.transactions[0];
    await serverAuthoredBuyIn(test, players.second, "server_change_123456");

    const undo = {
      type: "undo_recent_transaction",
      action: { kind: "create", transactionId: transaction.id, occurredAt: transaction.createdAt }
    };
    await expect(
      test.mutation(api.rooms.applyAction, hostAction(1, "action_stale_undo_12345", undo))
    ).rejects.toThrow(/Room changed/);
    await expect(
      test.mutation(
        api.rooms.applyAction,
        hostAction(1, "action_stale_count_1234", { type: "set_player_count", count: 4 })
      )
    ).rejects.toThrow(/Room changed/);
    expect((await roomDoc(test)).version).toBe(2);
  });

  it("refuses a stale action once the host has written since", async () => {
    const { test, players } = await createRoom();
    await test.mutation(
      api.rooms.applyAction,
      hostAction(0, "action_host_rename_1234", { type: "set_game_name", name: "Friday" })
    );
    await expect(
      test.mutation(
        api.rooms.applyAction,
        hostAction(0, "action_stale_after_host", {
          type: "add_transaction",
          transaction: buyIn(players.first)
        })
      )
    ).rejects.toThrow(/Room changed/);
    // A version the room has not reached yet is never accepted either.
    await expect(
      test.mutation(
        api.rooms.applyAction,
        hostAction(5, "action_future_version_12", { type: "set_game_name", name: "Later" })
      )
    ).rejects.toThrow(/Room changed/);
  });

  it("treats a room from before hostBaseVersion as based on its current version", async () => {
    const { test, players } = await createRoom();
    const room = await roomDoc(test);
    await test.run(async (ctx) => {
      await ctx.db.patch(room._id, { version: 3, hostBaseVersion: undefined });
    });
    await expect(
      test.mutation(
        api.rooms.applyAction,
        hostAction(2, "action_legacy_stale_123", {
          type: "add_transaction",
          transaction: buyIn(players.first)
        })
      )
    ).rejects.toThrow(/Room changed/);

    // A server-authored change keeps the legacy base, so the host's in-flight
    // additive action still lands.
    await serverAuthoredBuyIn(test, players.second, "server_legacy_change_12");
    expect(await roomDoc(test)).toMatchObject({ version: 4, hostBaseVersion: 3 });
    const result = await test.mutation(
      api.rooms.applyAction,
      hostAction(3, "action_legacy_rebase_123", {
        type: "add_transaction",
        transaction: buyIn(players.first)
      })
    );
    expect(result.version).toBe(5);
  });

  it("rebases approving a guest request and ending the room the same way", async () => {
    const { test, players } = await createRoom();
    await join(test);
    const requestId = await test.mutation(api.rooms.submitGuestTransaction, {
      publicId,
      guestSecret,
      transaction: buyIn(players.first)
    });
    await serverAuthoredBuyIn(test, players.second, "server_change_123456");
    await test.mutation(api.rooms.decideGuestTransaction, decide(requestId, "approved", 0));
    expect(await roomDoc(test)).toMatchObject({ version: 2, hostBaseVersion: 2 });

    const nextRequest = await test.mutation(api.rooms.submitGuestTransaction, {
      publicId,
      guestSecret,
      transaction: buyIn(players.first, 3000)
    });
    await expect(
      test.mutation(api.rooms.decideGuestTransaction, decide(nextRequest, "approved", 1))
    ).rejects.toThrow(/Room changed/);

    await serverAuthoredBuyIn(test, players.second, "server_change_654321");
    await expect(
      test.mutation(api.rooms.end, {
        publicId,
        hostSecret,
        controllerId,
        expectedVersion: 1,
        clientActionId: "action_end_too_stale_12"
      })
    ).rejects.toThrow(/Room changed/);
    const ended = await test.mutation(api.rooms.end, {
      publicId,
      hostSecret,
      controllerId,
      expectedVersion: 2,
      clientActionId: "action_end_rebased_1234"
    });
    expect(ended).toMatchObject({ status: "ended", version: 3 });
    expect(ended.state.transactions).toHaveLength(3);
  });

  it("keeps agreement details only on transactions the server built", async () => {
    const { test, players } = await createRoom();
    const metadata = {
      proposedByPlayerId: players.first,
      confirmedByPlayerId: players.second,
      agreementId: "agreement_123",
      confirmedVia: "peer" as const
    };
    const gift = {
      type: "player_gave" as const,
      amountCents: 2000,
      fromPlayerId: players.first,
      toPlayerId: players.second,
      category: "poker" as const,
      ...metadata
    };
    await test.run(async (ctx) => {
      const room = await ctx.db
        .query("rooms")
        .withIndex("by_public_id", (index) => index.eq("publicId", publicId))
        .unique();
      await commitRoomAction(
        ctx,
        room!,
        { type: "add_transaction", transaction: gift },
        {
          actorLabel: "Player 1 · confirmed by Player 2",
          clientActionId: "agreement_123",
          hostAuthored: false,
          trustAgreementMetadata: true
        }
      );
    });
    const forged = await test.mutation(
      api.rooms.applyAction,
      hostAction(0, "action_forged_agreement", { type: "add_transaction", transaction: gift })
    );
    const [agreed, hostEntered] = forged.state.transactions;
    expect(agreed).toMatchObject(metadata);
    for (const key of Object.keys(metadata)) expect(hostEntered).not.toHaveProperty(key);

    const host = await test.query(api.rooms.hostView, { publicId, hostSecret, controllerId });
    expect(host.activity.events[1]).toMatchObject({
      summary: "Player 1 gave Player 2 $20.00",
      actorLabel: "Player 1 · confirmed by Player 2"
    });
  });
});

describe("agreement metadata from clients", () => {
  it("drops confirmed-by claims from a shared snapshot and from stored guest requests", async () => {
    const test = setup();
    const base = createDefaultGameState();
    const [first, second] = base.players.map((player) => player.id);
    const snapshot = {
      ...base,
      transactions: [
        {
          id: "transaction_forged",
          type: "player_gave" as const,
          createdAt: new Date().toISOString(),
          amountCents: 2000,
          fromPlayerId: second,
          toPlayerId: first,
          category: "poker" as const,
          proposedByPlayerId: first,
          confirmedByPlayerId: second,
          agreementId: "agreement_forged",
          confirmedVia: "peer" as const
        }
      ]
    };
    await test.mutation(api.rooms.create, {
      publicId,
      localGameId: snapshot.localGameId,
      snapshot,
      hostSecret,
      inviteSecret,
      controllerId
    });
    const room = await roomDoc(test);
    const stored = (room.state as typeof snapshot).transactions[0] as Record<string, unknown>;
    expect(stored.amountCents).toBe(2000);
    expect(stored.confirmedByPlayerId).toBeUndefined();
    expect(stored.proposedByPlayerId).toBeUndefined();
    expect(stored.agreementId).toBeUndefined();
    expect(stored.confirmedVia).toBeUndefined();

    await join(test);
    const requestId = await test.mutation(api.rooms.submitGuestTransaction, {
      publicId,
      guestSecret,
      transaction: buyIn(first, 2000, { confirmedByPlayerId: second, confirmedVia: "peer" })
    });
    const request = await requestDoc(test, requestId);
    expect(request?.transaction.confirmedByPlayerId).toBeUndefined();
    expect(request?.transaction.confirmedVia).toBeUndefined();
  });
});
