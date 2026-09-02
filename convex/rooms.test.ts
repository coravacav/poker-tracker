// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import presenceTest from "@convex-dev/presence/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import type { GameState } from "../src/domain/pokerTypes";
import { createDefaultGameState } from "../src/state/seedGame";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/!(*.*.*)*.*s");
const hostSecret = "host_abcdefghijklmnopqrstuvwxyz0123456789AB";
const inviteSecret = "invite_abcdefghijklmnopqrstuvwxyz0123456789";
const guestSecret = "guest_abcdefghijklmnopqrstuvwxyz0123456789A";
const controllerId = "controller_abcdefghijklmnop";
const publicId = "room_abcdefghijklmnop";

function setup() {
  const test = convexTest(schema, modules);
  presenceTest.register(test);
  return test;
}

async function createRoom(configure?: (snapshot: ReturnType<typeof createDefaultGameState>) => void) {
  const test = setup();
  const snapshot = createDefaultGameState();
  configure?.(snapshot);
  await test.mutation(api.rooms.create, {
    publicId,
    localGameId: snapshot.localGameId,
    snapshot,
    hostSecret,
    inviteSecret,
    controllerId
  });
  return { test, snapshot };
}

describe("shared room authority", () => {
  it("promotes a local snapshot and exposes only a sanitized guest projection", async () => {
    const { test } = await createRoom((snapshot) => {
      snapshot.cashOutDrafts = [{ playerId: snapshot.players[0].id, lines: [] }];
      (snapshot as GameState & { accidentalSecret?: string }).accidentalSecret = "must-not-leak";
    });

    const preview = await test.query(api.rooms.invitePreview, { publicId, inviteSecret });
    expect(preview).toEqual({ status: "active", name: "Poker Night" });

    await test.mutation(api.rooms.join, {
      publicId,
      inviteSecret,
      guestSecret,
      displayName: "Observer"
    });
    const guestView = await test.query(api.rooms.guestView, { publicId, guestSecret });
    expect(guestView.displayName).toBe("Observer");
    expect(guestView.state.cashOutDrafts).toEqual([]);
    expect(guestView.state).not.toHaveProperty("accidentalSecret");
  });

  it("enforces host capability, controller ownership, and room versions", async () => {
    const { test } = await createRoom();
    await expect(
      test.mutation(api.rooms.applyAction, {
        publicId,
        hostSecret: guestSecret,
        controllerId,
        expectedVersion: 0,
        clientActionId: "action_unauthorized_1234",
        action: { type: "set_game_name", name: "Nope" }
      })
    ).rejects.toThrow(/Host capability is invalid/);

    await expect(
      test.mutation(api.rooms.applyAction, {
        publicId,
        hostSecret,
        controllerId: "controller_other_12345",
        expectedVersion: 0,
        clientActionId: "action_duplicate_tab_123",
        action: { type: "set_game_name", name: "Nope" }
      })
    ).rejects.toThrow(/Another tab controls/);

    await expect(
      test.mutation(api.rooms.applyAction, {
        publicId,
        hostSecret,
        controllerId,
        expectedVersion: 9,
        clientActionId: "action_stale_version_123",
        action: { type: "set_game_name", name: "Nope" }
      })
    ).rejects.toThrow(/Room changed/);
  });

  it("applies host actions once, assigns server metadata, and reconnects at the latest version", async () => {
    const { test, snapshot } = await createRoom();
    const actionArgs = {
      publicId,
      hostSecret,
      controllerId,
      expectedVersion: 0,
      clientActionId: "action_idempotent_12345",
      action: {
        type: "add_transaction" as const,
        transaction: {
          id: "client-id",
          type: "bank_buy_in" as const,
          createdAt: "2000-01-01T00:00:00.000Z",
          amountCents: 2000,
          toPlayerId: snapshot.players[0].id
        }
      }
    };

    const first = await test.mutation(api.rooms.applyAction, actionArgs);
    expect(first.version).toBe(1);
    expect(first.duplicate).toBe(false);
    expect(first.state.transactions).toHaveLength(1);
    expect(first.state.transactions[0].id).not.toBe("client-id");
    expect(first.state.transactions[0].createdAt).not.toBe("2000-01-01T00:00:00.000Z");

    const duplicate = await test.mutation(api.rooms.applyAction, actionArgs);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.version).toBe(1);
    expect(duplicate.state.transactions).toHaveLength(1);

    const latest = await test.query(api.rooms.hostView, {
      publicId,
      hostSecret,
      controllerId
    });
    expect(latest.version).toBe(1);
    expect(latest.state.transactions).toHaveLength(1);
  });

  it("shares audit events and gives each room participant an unread notification", async () => {
    const { test, snapshot } = await createRoom();
    await test.mutation(api.rooms.join, {
      publicId,
      inviteSecret,
      guestSecret,
      displayName: "Observer"
    });

    await test.mutation(api.rooms.applyAction, {
      publicId,
      hostSecret,
      controllerId,
      expectedVersion: 0,
      clientActionId: "action_shared_audit_12345",
      action: {
        type: "add_transaction" as const,
        transaction: {
          id: "client-transaction-id",
          type: "player_gave" as const,
          createdAt: "2000-01-01T00:00:00.000Z",
          amountCents: 2000,
          fromPlayerId: snapshot.players[0].id,
          toPlayerId: snapshot.players[1].id,
          category: "poker" as const
        }
      }
    });

    const hostView = await test.query(api.rooms.hostView, {
      publicId,
      hostSecret,
      controllerId
    });
    const guestView = await test.query(api.rooms.guestView, { publicId, guestSecret });

    expect(hostView.activity.unreadNotificationCount).toBe(1);
    expect(guestView.activity.unreadNotificationCount).toBe(1);
    expect(hostView.activity.events[0].summary).toContain("gave");
    expect(guestView.activity.notifications[0].summary).toContain("gave");

    await test.mutation(api.rooms.acknowledgeGuestNotifications, {
      publicId,
      guestSecret,
      throughVersion: guestView.version
    });
    await test.mutation(api.rooms.acknowledgeHostNotifications, {
      publicId,
      hostSecret,
      throughVersion: hostView.version
    });

    const readGuestView = await test.query(api.rooms.guestView, { publicId, guestSecret });
    const readHostView = await test.query(api.rooms.hostView, {
      publicId,
      hostSecret,
      controllerId
    });
    expect(readGuestView.activity.unreadNotificationCount).toBe(0);
    expect(readHostView.activity.unreadNotificationCount).toBe(0);
  });

  it("ends a room at its authoritative state and rejects further mutations", async () => {
    const { test } = await createRoom();
    const ended = await test.mutation(api.rooms.end, {
      publicId,
      hostSecret,
      controllerId,
      expectedVersion: 0,
      clientActionId: "action_end_room_123456"
    });
    expect(ended.status).toBe("ended");

    const guestPreview = await test.query(api.rooms.invitePreview, { publicId, inviteSecret });
    expect(guestPreview.status).toBe("ended");
    await expect(
      test.mutation(api.rooms.applyAction, {
        publicId,
        hostSecret,
        controllerId,
        expectedVersion: 0,
        clientActionId: "action_after_end_12345",
        action: { type: "set_game_name", name: "Too late" }
      })
    ).rejects.toThrow(/no longer active/);
  });

  it("keeps ended rooms visible to participating hosts and guests", async () => {
    const { test } = await createRoom();
    await test.mutation(api.rooms.join, {
      publicId,
      inviteSecret,
      guestSecret,
      displayName: "Observer"
    });
    await test.mutation(api.rooms.end, {
      publicId,
      hostSecret,
      controllerId,
      expectedVersion: 0,
      clientActionId: "action_history_end_1234"
    });
    const hostHistory = await test.query(api.rooms.historyView, {
      publicId,
      role: "host",
      secret: hostSecret
    });
    const guestHistory = await test.query(api.rooms.historyView, {
      publicId,
      role: "guest",
      secret: guestSecret
    });
    expect(hostHistory.status).toBe("ended");
    expect(guestHistory).toMatchObject({ status: "ended", displayName: "Observer" });
  });

  it("expires abandoned rooms without deleting their historical snapshot", async () => {
    const { test } = await createRoom();
    await test.run(async (ctx) => {
      const room = await ctx.db
        .query("rooms")
        .withIndex("by_public_id", (index) => index.eq("publicId", publicId))
        .unique();
      if (!room) throw new Error("room missing");
      await ctx.db.patch(room._id, { lastActivityAt: Date.now() - 8 * 24 * 60 * 60 * 1000 });
    });
    const result = await test.mutation(internal.rooms.runRoomLifecycle, {});
    expect(result.expiredRooms).toBe(1);
    const history = await test.query(api.rooms.historyView, {
      publicId,
      role: "host",
      secret: hostSecret
    });
    expect(history.status).toBe("expired");
    expect(history.state.settings.gameName).toBe("Poker Night");
  });
});
