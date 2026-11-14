// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import presenceTest from "@convex-dev/presence/test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { createDefaultGameState } from "../src/state/seedGame";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/!(*.*.*)*.*s");
const hostSecret = "host_abcdefghijklmnopqrstuvwxyz0123456789AB";
const inviteSecret = "invite_abcdefghijklmnopqrstuvwxyz0123456789";
const guestSecret = "guest_abcdefghijklmnopqrstuvwxyz0123456789A";
const spectatorSecret = "watch_abcdefghijklmnopqrstuvwxyz0123456789A";
const rotatedSpectatorSecret = "watch_zyxwvutsrqponmlkjihgfedcba9876543210Z";
const controllerId = "controller_abcdefghijklmnop";
const publicId = "room_abcdefghijklmnop";

type Test = Awaited<ReturnType<typeof createRoom>>["test"];

async function createRoom() {
  const test = convexTest(schema, modules);
  presenceTest.register(test);
  rateLimiterTest.register(test);
  const snapshot = createDefaultGameState();
  snapshot.players[0] = { ...snapshot.players[0]!, personId: "person_abcdefghijklmnop", venmoHandle: "maya-poker" };
  await test.mutation(api.rooms.create, {
    publicId,
    localGameId: snapshot.localGameId,
    snapshot,
    hostSecret,
    inviteSecret,
    controllerId
  });
  return { test, snapshot, firstPlayerId: snapshot.players[0]!.id };
}

async function turnOnWatchLink(test: Test, secret: string | null = spectatorSecret) {
  await test.mutation(api.rooms.rotateSpectatorLink, { publicId, hostSecret, spectatorSecret: secret });
}

function watch(test: Test, secret = spectatorSecret) {
  return test.query(api.rooms.spectatorView, { publicId, spectatorSecret: secret });
}

async function hostBuyIn(test: Test, toPlayerId: string, version: number) {
  await test.mutation(api.rooms.applyAction, {
    publicId,
    hostSecret,
    controllerId,
    expectedVersion: version,
    clientActionId: `action_buy_in_${version}_abcdef`,
    action: {
      type: "add_transaction",
      transaction: {
        id: `transaction_${version}_abcdef`,
        type: "bank_buy_in",
        createdAt: new Date(0).toISOString(),
        amountCents: 2000,
        toPlayerId
      }
    }
  });
}

describe("watch link", () => {
  it("is off until the host turns it on", async () => {
    const { test } = await createRoom();
    await expect(watch(test)).rejects.toThrow(/invalid or turned off/);
    const host = await test.query(api.rooms.hostView, { publicId, hostSecret, controllerId });
    expect(host).toMatchObject({ watchLinkOn: false, watcherCount: 0 });

    await turnOnWatchLink(test);
    expect(
      await test.query(api.rooms.hostView, { publicId, hostSecret, controllerId })
    ).toMatchObject({ watchLinkOn: true, watcherCount: 0 });
    expect(await watch(test)).toMatchObject({ publicId, status: "active", name: "Poker Night" });
  });

  it("shows a sanitized table and the recent feed, without guests or device links", async () => {
    const { test, firstPlayerId } = await createRoom();
    await test.mutation(api.rooms.join, { publicId, inviteSecret, guestSecret, displayName: "Maya" });
    await turnOnWatchLink(test);
    await hostBuyIn(test, firstPlayerId, 0);
    await test.mutation(api.rooms.applyAction, {
      publicId,
      hostSecret,
      controllerId,
      expectedVersion: 1,
      clientActionId: "action_draft_abcdefgh",
      action: {
        type: "save_cash_out_draft",
        draft: { playerId: firstPlayerId, lines: [] }
      }
    });
    const host = await test.query(api.rooms.hostView, { publicId, hostSecret, controllerId });
    expect(host.state.cashOutDrafts).toHaveLength(1);

    const view = await watch(test);
    expect(view.state.transactions).toEqual([
      expect.objectContaining({ type: "bank_buy_in", amountCents: 2000, toPlayerId: firstPlayerId })
    ]);
    expect(view.state.cashOutDrafts).toEqual([]);
    for (const player of view.state.players) {
      expect(player).not.toHaveProperty("personId");
      expect(player).not.toHaveProperty("venmoHandle");
    }
    expect(view.events[0]).toMatchObject({ summary: "Player 1 bought in for $20.00" });
    expect(view).not.toHaveProperty("guests");
    expect(view).not.toHaveProperty("guestRequests");
    expect(view).not.toHaveProperty("activity");
    expect(JSON.stringify(view)).not.toContain("Maya");
  });

  it("never lets the watch secret join, preview an invitation, or act as a guest", async () => {
    const { test, firstPlayerId } = await createRoom();
    await turnOnWatchLink(test);

    expect(
      await test.query(api.rooms.invitePreview, { publicId, inviteSecret: spectatorSecret })
    ).toEqual({ status: "invalid" });
    await expect(
      test.mutation(api.rooms.join, {
        publicId,
        inviteSecret: spectatorSecret,
        guestSecret,
        displayName: "Sneaky"
      })
    ).rejects.toThrow(/Invitation is invalid/);
    // Someone holding both links cannot turn the watch secret into a guest session.
    await expect(
      test.mutation(api.rooms.join, {
        publicId,
        inviteSecret,
        guestSecret: spectatorSecret,
        displayName: "Sneaky"
      })
    ).rejects.toThrow(/Guest capability is invalid/);
    await expect(
      test.mutation(api.rooms.submitGuestTransaction, {
        publicId,
        guestSecret: spectatorSecret,
        transaction: { type: "bank_buy_in", amountCents: 2000, toPlayerId: firstPlayerId }
      })
    ).rejects.toThrow(/invalid or revoked/);
    await expect(
      test.query(api.rooms.guestView, { publicId, guestSecret: spectatorSecret })
    ).rejects.toThrow(/invalid or revoked/);
    await expect(
      test.mutation(api.rooms.acknowledgeGuestNotifications, {
        publicId,
        guestSecret: spectatorSecret,
        throughVersion: 0
      })
    ).rejects.toThrow(/invalid or revoked/);
    await expect(
      test.query(api.rooms.hostView, { publicId, hostSecret: spectatorSecret, controllerId })
    ).rejects.toThrow(/Host capability is invalid/);
    await expect(
      test.query(api.rooms.historyView, { publicId, role: "guest", secret: spectatorSecret })
    ).rejects.toThrow(/invalid or revoked/);
  });

  it("refuses a watch secret that matches another capability, and vice versa", async () => {
    const { test } = await createRoom();
    await test.mutation(api.rooms.join, { publicId, inviteSecret, guestSecret, displayName: "Maya" });
    for (const secret of [hostSecret, inviteSecret, guestSecret]) {
      await expect(turnOnWatchLink(test, secret)).rejects.toThrow(/watch link capability is invalid/);
    }
    await expect(turnOnWatchLink(test, "short")).rejects.toThrow(/watch link capability is invalid/);
    await turnOnWatchLink(test);
    await expect(
      test.mutation(api.rooms.rotateInvite, { publicId, hostSecret, inviteSecret: spectatorSecret })
    ).rejects.toThrow(/invitation capability is invalid/);
  });

  it("stops the old link when rotated and every link when turned off", async () => {
    const { test } = await createRoom();
    await turnOnWatchLink(test);
    await turnOnWatchLink(test, rotatedSpectatorSecret);
    await expect(watch(test)).rejects.toThrow(/invalid or turned off/);
    await expect(
      test.mutation(api.rooms.spectatorHeartbeat, {
        publicId,
        spectatorSecret,
        sessionId: "watch_session_abcdefgh"
      })
    ).rejects.toThrow(/invalid or turned off/);
    expect(await watch(test, rotatedSpectatorSecret)).toMatchObject({ status: "active" });

    await turnOnWatchLink(test, null);
    await expect(watch(test, rotatedSpectatorSecret)).rejects.toThrow(/invalid or turned off/);
    expect(
      await test.query(api.rooms.hostView, { publicId, hostSecret, controllerId })
    ).toMatchObject({ watchLinkOn: false });
  });

  it("only lets the host change the link", async () => {
    const { test } = await createRoom();
    await expect(
      test.mutation(api.rooms.rotateSpectatorLink, {
        publicId,
        hostSecret: inviteSecret,
        spectatorSecret
      })
    ).rejects.toThrow(/Host capability is invalid/);
  });

  it("counts watchers apart from guests, and starts over on a new link", async () => {
    const { test } = await createRoom();
    await test.mutation(api.rooms.join, { publicId, inviteSecret, guestSecret, displayName: "Maya" });
    await test.mutation(api.rooms.heartbeat, { publicId, guestSecret, sessionId: "guest_session_abcdefgh" });
    await turnOnWatchLink(test);
    for (const sessionId of ["watch_session_aaaaaaaa", "watch_session_bbbbbbbb", "watch_session_aaaaaaaa"]) {
      await test.mutation(api.rooms.spectatorHeartbeat, { publicId, spectatorSecret, sessionId });
    }
    expect(
      await test.query(api.rooms.hostView, { publicId, hostSecret, controllerId })
    ).toMatchObject({ guestCount: 1, watcherCount: 2 });
    expect(await watch(test)).toMatchObject({ watcherCount: 2 });

    await turnOnWatchLink(test, rotatedSpectatorSecret);
    expect(
      await test.query(api.rooms.hostView, { publicId, hostSecret, controllerId })
    ).toMatchObject({ guestCount: 1, watcherCount: 0 });
  });

  it("keeps working after the room ends, until its details are pruned", async () => {
    const { test, firstPlayerId } = await createRoom();
    await turnOnWatchLink(test);
    await hostBuyIn(test, firstPlayerId, 0);
    await test.mutation(api.rooms.end, {
      publicId,
      hostSecret,
      controllerId,
      expectedVersion: 1,
      clientActionId: "action_end_abcdefgh"
    });

    const ended = await watch(test);
    expect(ended).toMatchObject({ status: "ended", watcherCount: 0 });
    expect(ended.endedAt).toEqual(expect.any(Number));
    expect(ended.state.transactions).toHaveLength(1);
    // The ended room can no longer change its link.
    await expect(turnOnWatchLink(test, rotatedSpectatorSecret)).rejects.toThrow(/no longer active/);

    await test.run(async (ctx) => {
      const room = await ctx.db
        .query("rooms")
        .withIndex("by_public_id", (index) => index.eq("publicId", publicId))
        .unique();
      await ctx.db.patch(room!._id, { detailsPrunedAt: Date.now() });
    });
    await expect(watch(test)).rejects.toThrow(/can no longer be watched/);
  });
});
