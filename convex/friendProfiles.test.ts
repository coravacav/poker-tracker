// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import presenceTest from "@convex-dev/presence/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
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
        room: { publicId, name: "Poker Night", createdAt: expect.any(Number) }
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
      .resolves.toEqual([{ friendCode, displayName: "Jamie Host", room: null }]);
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
      .resolves.toEqual([{ friendCode, displayName: "Jamie Host", room: null }]);

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
      .resolves.toEqual([{ friendCode, displayName: "Jamie Host", room: null }]);
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
