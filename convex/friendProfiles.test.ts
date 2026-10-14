// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import presenceTest from "@convex-dev/presence/test";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultGameState } from "../src/state/seedGame";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/!(*.*.*)*.*s");
const friendCode = "ABCDEFGHJKMNPQRSTVWXY234";
const newFriendCode = "23456789ABCDEFGHJKMNPQRS";
const ownerSecret = "profile_abcdefghijklmnopqrstuvwxyz0123456789";
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

async function createProfile(test: ReturnType<typeof setup>) {
  return await test.mutation(api.friendProfiles.create, {
    friendCode: "abcd-efgh-jkmn-pqrs-tvwx-y234",
    displayName: "  Jamie   Host  ",
    ownerSecret
  });
}

type RoomOptions = {
  publicId: string;
  hostSecret?: string;
  friendCode?: string;
  profileOwnerSecret?: string;
  visibleToFriends?: boolean;
};

async function createRoomWith(test: ReturnType<typeof setup>, options: RoomOptions) {
  const snapshot = createDefaultGameState();
  const linked = options.friendCode !== undefined;
  await test.mutation(api.rooms.create, {
    publicId: options.publicId,
    localGameId: snapshot.localGameId,
    snapshot,
    hostSecret: options.hostSecret ?? hostSecret,
    inviteSecret,
    controllerId,
    ...(linked ? {
      friendCode: options.friendCode,
      profileOwnerSecret: options.profileOwnerSecret ?? ownerSecret,
      visibleToFriends: options.visibleToFriends ?? true
    } : {})
  });
}

async function roomDoc(test: ReturnType<typeof setup>, roomPublicId: string) {
  return await test.run(async (ctx) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_public_id", (index) => index.eq("publicId", roomPublicId))
      .unique();
    if (!room) throw new Error("room missing");
    return room;
  });
}

async function listedRooms(test: ReturnType<typeof setup>, code = friendCode) {
  const activity = await test.query(api.friendProfiles.listActivity, { friendCodes: [code] });
  return activity.flatMap((item) => item.rooms.map((room) => room.publicId)).sort();
}

async function createLinkedRoom(test: ReturnType<typeof setup>, visibleToFriends = true) {
  const snapshot = createDefaultGameState();
  await test.mutation(api.rooms.create, {
    publicId,
    localGameId: snapshot.localGameId,
    snapshot,
    hostSecret,
    inviteSecret,
    controllerId,
    friendCode,
    profileOwnerSecret: ownerSecret,
    visibleToFriends
  });
}

describe("device friend profiles", () => {
  it("normalizes codes, upserts only for the owner, and rotates codes", async () => {
    const test = setup();
    await expect(createProfile(test)).resolves.toEqual({
      friendCode,
      displayName: "Jamie Host"
    });
    await expect(test.query(api.friendProfiles.lookup, {
      friendCode: "abcd efgh jkmn pqrs tvwx y234"
    })).resolves.toEqual({ friendCode, displayName: "Jamie Host" });

    await expect(test.mutation(api.friendProfiles.create, {
      friendCode,
      displayName: "Attacker",
      ownerSecret: "wrong_abcdefghijklmnopqrstuvwxyz0123456789A"
    })).rejects.toThrow(/already in use/);

    await expect(test.mutation(api.friendProfiles.updateName, {
      friendCode,
      ownerSecret,
      displayName: "Jamie Updated"
    })).resolves.toEqual({ friendCode, displayName: "Jamie Updated" });
    await expect(test.mutation(api.friendProfiles.rotateCode, {
      friendCode,
      ownerSecret,
      newFriendCode
    })).resolves.toEqual({ friendCode: newFriendCode, displayName: "Jamie Updated" });
    await expect(test.query(api.friendProfiles.lookup, { friendCode })).resolves.toBeNull();
    await expect(test.query(api.friendProfiles.lookup, { friendCode: newFriendCode }))
      .resolves.toEqual({ friendCode: newFriendCode, displayName: "Jamie Updated" });
  });

  it("discovers a linked active room, hides it on demand, and joins through the friend code", async () => {
    const test = setup();
    await createProfile(test);
    await createLinkedRoom(test);

    await expect(test.query(api.friendProfiles.listActivity, { friendCodes: [friendCode] }))
      .resolves.toEqual([{
        friendCode,
        displayName: "Jamie Host",
        room: { publicId, name: "Poker Night", createdAt: expect.any(Number) },
        rooms: [{ publicId, name: "Poker Night", createdAt: expect.any(Number) }]
      }]);
    await expect(test.query(api.rooms.hostView, { publicId, hostSecret, controllerId }))
      .resolves.toMatchObject({ friendProfileLinked: true, visibleToFriends: true });

    const joined = await test.mutation(api.rooms.joinFriend, {
      publicId,
      friendCode,
      guestSecret,
      displayName: "Guest"
    });
    expect(joined).toMatchObject({
      publicId,
      status: "active",
      displayName: "Guest",
      hostProfile: { friendCode, displayName: "Jamie Host" }
    });
    await expect(test.query(api.rooms.guestView, { publicId, guestSecret }))
      .resolves.toMatchObject({
        publicId,
        displayName: "Guest",
        hostProfile: { friendCode, displayName: "Jamie Host" }
      });

    await expect(test.mutation(api.rooms.setFriendVisibility, {
      publicId,
      hostSecret: guestSecret,
      visible: false
    })).rejects.toThrow(/Host capability is invalid/);
    await test.mutation(api.rooms.setFriendVisibility, {
      publicId,
      hostSecret,
      visible: false
    });
    await expect(test.query(api.friendProfiles.listActivity, { friendCodes: [friendCode] }))
      .resolves.toEqual([{ friendCode, displayName: "Jamie Host", room: null, rooms: [] }]);
    await expect(test.mutation(api.rooms.joinFriend, {
      publicId,
      friendCode,
      guestSecret: "guest_second_abcdefghijklmnopqrstuvwxyz012345",
      displayName: "Second Guest"
    })).rejects.toThrow(/not sharing that room/);
  });

  it("clears discovery when a linked room ends or expires", async () => {
    const endedTest = setup();
    await createProfile(endedTest);
    await createLinkedRoom(endedTest);
    await endedTest.mutation(api.rooms.end, {
      publicId,
      hostSecret,
      controllerId,
      expectedVersion: 0,
      clientActionId: "action_end_friend_room_1234"
    });
    await expect(endedTest.query(api.friendProfiles.listActivity, { friendCodes: [friendCode] }))
      .resolves.toEqual([{ friendCode, displayName: "Jamie Host", room: null, rooms: [] }]);

    const expiredTest = setup();
    await createProfile(expiredTest);
    await createLinkedRoom(expiredTest);
    await expiredTest.run(async (ctx) => {
      const room = await ctx.db
        .query("rooms")
        .withIndex("by_public_id", (index) => index.eq("publicId", publicId))
        .unique();
      if (!room) throw new Error("room missing");
      await ctx.db.patch(room._id, { lastActivityAt: Date.now() - 8 * 24 * 60 * 60 * 1000 });
    });
    await expiredTest.mutation(internal.rooms.runRoomLifecycle, {});
    await expect(expiredTest.query(api.friendProfiles.listActivity, { friendCodes: [friendCode] }))
      .resolves.toEqual([{ friendCode, displayName: "Jamie Host", room: null, rooms: [] }]);
  });

  it("bounds discovery requests and preserves ordinary invite joining", async () => {
    const test = setup();
    await createProfile(test);
    await createLinkedRoom(test, false);
    await expect(test.query(api.friendProfiles.listActivity, {
      friendCodes: Array.from({ length: 51 }, (_, index) => `${friendCode}${index}`)
    })).rejects.toThrow(/At most 50/);

    await expect(test.mutation(api.rooms.join, {
      publicId,
      inviteSecret,
      guestSecret,
      displayName: "Invited Guest"
    })).resolves.toMatchObject({
      publicId,
      displayName: "Invited Guest",
      hostProfile: { friendCode, displayName: "Jamie Host" }
    });
  });
});

describe("friend discovery authorization", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const secondRoom = "room_second_abcdefghij";
  const secondHostSecret = "host2_abcdefghijklmnopqrstuvwxyz0123456789A";

  it("keeps every visible room discoverable when a host shares more than one", async () => {
    const test = setup();
    await createProfile(test);
    await createLinkedRoom(test);
    await createRoomWith(test, { publicId: secondRoom, hostSecret: secondHostSecret, friendCode });

    expect(await listedRooms(test)).toEqual([publicId, secondRoom].sort());
    const [activity] = await test.query(api.friendProfiles.listActivity, { friendCodes: [friendCode] });
    expect(activity.room?.publicId).toBe(activity.rooms[0].publicId);

    // Hiding or ending one room leaves the other discoverable and joinable.
    await test.mutation(api.rooms.setFriendVisibility, { publicId, hostSecret, visible: false });
    expect(await listedRooms(test)).toEqual([secondRoom]);
    await expect(test.mutation(api.rooms.joinFriend, {
      publicId, friendCode, guestSecret, displayName: "Guest"
    })).rejects.toThrow(/not sharing that room/);
    await expect(test.mutation(api.rooms.joinFriend, {
      publicId: secondRoom, friendCode, guestSecret, displayName: "Guest"
    })).resolves.toMatchObject({ publicId: secondRoom });

    await test.mutation(api.rooms.end, {
      publicId: secondRoom,
      hostSecret: secondHostSecret,
      controllerId,
      expectedVersion: 0,
      clientActionId: "action_end_second_room_1234"
    });
    expect(await listedRooms(test)).toEqual([]);

    // Re-showing the first room lists it again.
    await test.mutation(api.rooms.setFriendVisibility, { publicId, hostSecret, visible: true });
    expect(await listedRooms(test)).toEqual([publicId]);
  });

  it("refuses to link or manage a profile with the wrong owner capability", async () => {
    const test = setup();
    await createProfile(test);
    const wrongSecret = "wrong_abcdefghijklmnopqrstuvwxyz0123456789A";
    await expect(createRoomWith(test, { publicId, friendCode, profileOwnerSecret: wrongSecret }))
      .rejects.toThrow(/Friend profile capability is invalid/);
    await expect(createRoomWith(test, {
      publicId,
      friendCode: "23456789ABCDEFGHJKMNPQRS",
      profileOwnerSecret: ownerSecret
    })).rejects.toThrow(/Friend profile capability is invalid/);
    expect(await listedRooms(test)).toEqual([]);

    await expect(test.mutation(api.friendProfiles.updateName, {
      friendCode, ownerSecret: wrongSecret, displayName: "Hijacked"
    })).rejects.toThrow(/Profile owner capability is invalid/);
    await expect(test.mutation(api.friendProfiles.rotateCode, {
      friendCode, ownerSecret: wrongSecret, newFriendCode
    })).rejects.toThrow(/Profile owner capability is invalid/);
    await expect(test.query(api.friendProfiles.lookup, { friendCode }))
      .resolves.toEqual({ friendCode, displayName: "Jamie Host" });
  });

  it("refuses another host's friend code, closed joining, and ended rooms", async () => {
    const test = setup();
    await createProfile(test);
    const otherCode = "QRSTVWXY23456789ABCDEFGH";
    await test.mutation(api.friendProfiles.create, {
      friendCode: otherCode,
      displayName: "Other Host",
      ownerSecret: "other_abcdefghijklmnopqrstuvwxyz0123456789A"
    });
    await createLinkedRoom(test);

    await expect(test.mutation(api.rooms.joinFriend, {
      publicId, friendCode: otherCode, guestSecret, displayName: "Guest"
    })).rejects.toThrow(/not sharing that room/);
    expect(await listedRooms(test, otherCode)).toEqual([]);

    await test.mutation(api.rooms.setJoiningOpen, { publicId, hostSecret, open: false });
    await expect(test.mutation(api.rooms.joinFriend, {
      publicId, friendCode, guestSecret, displayName: "Guest"
    })).rejects.toThrow(/not accepting new guests/);

    await test.mutation(api.rooms.setJoiningOpen, { publicId, hostSecret, open: true });
    await test.mutation(api.rooms.end, {
      publicId,
      hostSecret,
      controllerId,
      expectedVersion: 0,
      clientActionId: "action_end_friend_room_1234"
    });
    expect(await listedRooms(test)).toEqual([]);
    await expect(test.mutation(api.rooms.joinFriend, {
      publicId, friendCode, guestSecret, displayName: "Guest"
    })).rejects.toThrow(/not sharing that room/);
  });

  it("does not revive a revoked guest capability through a friend join", async () => {
    const test = setup();
    await createProfile(test);
    await createLinkedRoom(test);
    const joined = await test.mutation(api.rooms.joinFriend, {
      publicId, friendCode, guestSecret, displayName: "Guest"
    });
    expect(joined.publicId).toBe(publicId);
    const host = await test.query(api.rooms.hostView, { publicId, hostSecret, controllerId });
    await test.mutation(api.rooms.revokeGuest, { publicId, hostSecret, guestId: host.guests[0].id });

    await expect(test.mutation(api.rooms.joinFriend, {
      publicId, friendCode, guestSecret, displayName: "Guest Again"
    })).rejects.toThrow(/invalid or revoked/);
    await expect(test.query(api.rooms.guestView, { publicId, guestSecret }))
      .rejects.toThrow(/invalid or revoked/);
  });

  it("revokes discovery through a rotated code and hides the new code from older guests", async () => {
    const test = setup();
    await createProfile(test);
    await createLinkedRoom(test);
    await test.mutation(api.rooms.join, { publicId, inviteSecret, guestSecret, displayName: "Guest" });
    await expect(test.query(api.rooms.guestView, { publicId, guestSecret }))
      .resolves.toMatchObject({ hostProfile: { friendCode } });

    await test.mutation(api.friendProfiles.rotateCode, { friendCode, ownerSecret, newFriendCode });

    await expect(test.query(api.friendProfiles.listActivity, { friendCodes: [friendCode] }))
      .resolves.toEqual([]);
    await expect(test.mutation(api.rooms.joinFriend, {
      publicId,
      friendCode,
      guestSecret: "guest_second_abcdefghijklmnopqrstuvwxyz012345",
      displayName: "Old Code Guest"
    })).rejects.toThrow(/Friend code is invalid/);
    expect(await listedRooms(test, newFriendCode)).toEqual([publicId]);

    // A guest of a pre-rotation room must not learn the replacement code.
    await expect(test.query(api.rooms.guestView, { publicId, guestSecret }))
      .resolves.toMatchObject({ hostProfile: null });

    // Rooms created after the rotation share the current code again.
    await test.run(async (ctx) => {
      const profile = await ctx.db
        .query("friendProfiles")
        .withIndex("by_friend_code", (index) => index.eq("friendCode", newFriendCode))
        .unique();
      if (!profile) throw new Error("profile missing");
      await ctx.db.patch(profile._id, { friendCodeRotatedAt: Date.now() - 60_000 });
    });
    const laterGuest = "guest_later_abcdefghijklmnopqrstuvwxyz0123456";
    await createRoomWith(test, {
      publicId: secondRoom,
      hostSecret: secondHostSecret,
      friendCode: newFriendCode
    });
    await expect(test.mutation(api.rooms.joinFriend, {
      publicId: secondRoom, friendCode: newFriendCode, guestSecret: laterGuest, displayName: "Later"
    })).resolves.toMatchObject({ hostProfile: { friendCode: newFriendCode } });
  });

  it("keeps listing names in sync and never lists hidden or unlinked rooms", async () => {
    const test = setup();
    await createProfile(test);
    await createLinkedRoom(test, false);
    await createRoomWith(test, { publicId: secondRoom, hostSecret: secondHostSecret });
    expect(await listedRooms(test)).toEqual([]);
    await expect(test.mutation(api.rooms.setFriendVisibility, {
      publicId: secondRoom, hostSecret: secondHostSecret, visible: true
    })).rejects.toThrow(/not linked to a friend profile/);

    await test.mutation(api.rooms.setFriendVisibility, { publicId, hostSecret, visible: true });
    await test.mutation(api.rooms.applyAction, {
      publicId,
      hostSecret,
      controllerId,
      expectedVersion: 0,
      clientActionId: "action_rename_friend_room_1",
      action: { type: "set_game_name", name: "Late Game" }
    });
    const [activity] = await test.query(api.friendProfiles.listActivity, { friendCodes: [friendCode] });
    expect(activity.rooms).toEqual([{ publicId, name: "Late Game", createdAt: expect.any(Number) }]);
  });

  it("still discovers rooms linked through the legacy single-room pointer", async () => {
    const test = setup();
    await createProfile(test);
    await createLinkedRoom(test);
    // Simulate a room created before listings existed.
    await test.run(async (ctx) => {
      const room = await ctx.db
        .query("rooms")
        .withIndex("by_public_id", (index) => index.eq("publicId", publicId))
        .unique();
      const listing = room && await ctx.db
        .query("friendRoomListings")
        .withIndex("by_room_id", (index) => index.eq("roomId", room._id))
        .unique();
      if (!room || !room.hostProfileId || !listing) throw new Error("setup failed");
      await ctx.db.delete(listing._id);
      await ctx.db.patch(room.hostProfileId, { activeRoomId: room._id });
    });
    expect(await listedRooms(test)).toEqual([publicId]);

    await createRoomWith(test, { publicId: secondRoom, hostSecret: secondHostSecret, friendCode });
    expect(await listedRooms(test)).toEqual([publicId, secondRoom].sort());

    await test.mutation(api.rooms.setFriendVisibility, { publicId, hostSecret, visible: false });
    expect(await listedRooms(test)).toEqual([secondRoom]);
    await test.mutation(api.rooms.setFriendVisibility, { publicId, hostSecret, visible: true });
    await test.mutation(api.rooms.end, {
      publicId,
      hostSecret,
      controllerId,
      expectedVersion: 0,
      clientActionId: "action_end_legacy_room_1234"
    });
    expect(await listedRooms(test)).toEqual([secondRoom]);
    const room = await roomDoc(test, publicId);
    const profile = await test.run(async (ctx) => await ctx.db.get("friendProfiles", room.hostProfileId!));
    expect(profile?.activeRoomId).toBeUndefined();
  });

  it("ignores oversized friend codes", async () => {
    const test = setup();
    await createProfile(test);
    const oversized = `${friendCode}${" ".repeat(100)}`;
    await expect(test.query(api.friendProfiles.lookup, { friendCode: oversized })).resolves.toBeNull();
    await expect(test.query(api.friendProfiles.listActivity, { friendCodes: [oversized] }))
      .resolves.toEqual([]);
  });

  it("expires every stale room even when the backlog exceeds one batch", async () => {
    vi.useFakeTimers();
    const test = setup();
    await createProfile(test);
    const roomIds = Array.from({ length: 11 }, (_, index) => `room_stale_${index}_abcdefghij`);
    for (const [index, roomId] of roomIds.entries()) {
      await createRoomWith(test, {
        publicId: roomId,
        hostSecret: `host_stale_${index}_abcdefghijklmnopqrstuvwxyz0123`,
        friendCode
      });
    }
    expect(await listedRooms(test)).toHaveLength(5);
    await test.run(async (ctx) => {
      for (const roomId of roomIds) {
        const room = await ctx.db
          .query("rooms")
          .withIndex("by_public_id", (index) => index.eq("publicId", roomId))
          .unique();
        await ctx.db.patch(room!._id, { lastActivityAt: Date.now() - 8 * 24 * 60 * 60 * 1000 });
      }
    });
    await test.mutation(internal.rooms.runRoomLifecycle, {});
    await test.finishAllScheduledFunctions(vi.runAllTimers);
    for (const roomId of roomIds) {
      expect((await roomDoc(test, roomId)).status).toBe("expired");
    }
    expect(await listedRooms(test)).toEqual([]);
  });

  it("makes pruning progress past rooms whose details are already pruned", async () => {
    vi.useFakeTimers();
    const test = setup();
    const roomIds = Array.from({ length: 12 }, (_, index) => `room_old_${index}_abcdefghijk`);
    for (const [index, roomId] of roomIds.entries()) {
      await createRoomWith(test, {
        publicId: roomId,
        hostSecret: `host_old_${index}_abcdefghijklmnopqrstuvwxyz01234`
      });
    }
    await test.run(async (ctx) => {
      for (const roomId of roomIds) {
        const room = await ctx.db
          .query("rooms")
          .withIndex("by_public_id", (index) => index.eq("publicId", roomId))
          .unique();
        await ctx.db.patch(room!._id, {
          status: "ended",
          endedAt: Date.now() - 31 * 24 * 60 * 60 * 1000,
          lastActivityAt: Date.now() - 31 * 24 * 60 * 60 * 1000
        });
      }
    });
    await test.mutation(internal.rooms.runRoomLifecycle, {});
    await test.finishAllScheduledFunctions(vi.runAllTimers);
    const remainingDetails = await test.run(async (ctx) => {
      const counts = [];
      for (const roomId of roomIds) {
        const room = await ctx.db
          .query("rooms")
          .withIndex("by_public_id", (index) => index.eq("publicId", roomId))
          .unique();
        expect(room?.detailsPrunedAt).toEqual(expect.any(Number));
        const events = await ctx.db
          .query("roomAuditEvents")
          .withIndex("by_room_id_and_created_at", (index) => index.eq("roomId", room!._id))
          .take(1);
        counts.push(events.length);
      }
      return counts;
    });
    expect(remainingDetails.every((count) => count === 0)).toBe(true);
  });
});
