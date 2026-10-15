// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import presenceTest from "@convex-dev/presence/test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FRIEND_CODE_ALPHABET } from "../src/session/friendCode";
import {
  CREATION_LIMITED_CODE,
  PROFILE_CREATION_LIMITED_MESSAGE,
  ROOM_CREATION_LIMITED_MESSAGE
} from "../src/session/creationLimits";
import { MAX_ROOM_GUEST_RECORDS } from "../src/session/roomProtocol";
import { createDefaultGameState } from "../src/state/seedGame";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { MAX_ACTIVE_ROOMS } from "./lib/creationLimits";
import { MAX_ROOMS_PER_BATCH } from "./lib/roomLifecycle";
import schema from "./schema";

const modules = import.meta.glob("./**/!(*.*.*)*.*s");
const ownerSecret = "profile_abcdefghijklmnopqrstuvwxyz0123456789";
const inviteSecret = "invite_abcdefghijklmnopqrstuvwxyz0123456789";
const controllerId = "controller_abcdefghijklmnop";
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

type TestConvex = ReturnType<typeof setup>;

function setup() {
  const test = convexTest(schema, modules);
  presenceTest.register(test);
  rateLimiterTest.register(test);
  return test;
}

let sequence = 0;
function uniqueSuffix() {
  sequence += 1;
  return `${sequence}`.padStart(6, "0");
}

function friendCodeFor(index: number) {
  const alphabet = FRIEND_CODE_ALPHABET;
  let value = index;
  let suffix = "";
  for (let digit = 0; digit < 4; digit += 1) {
    suffix += alphabet[value % alphabet.length];
    value = Math.floor(value / alphabet.length);
  }
  return `ABCDEFGHJKMNPQRSTVWX${suffix}`;
}

async function createProfile(test: TestConvex, friendCode: string, displayName = "Host") {
  return await test.mutation(api.friendProfiles.create, { friendCode, displayName, ownerSecret });
}

async function createRoom(test: TestConvex, friendCode?: string) {
  const suffix = uniqueSuffix();
  const publicId = `room_limit_${suffix}_abcdef`;
  const hostSecret = `host_limit_${suffix}_abcdefghijklmnopqrstuvwxyz`;
  const snapshot = createDefaultGameState();
  await test.mutation(api.rooms.create, {
    publicId,
    localGameId: snapshot.localGameId,
    snapshot,
    hostSecret,
    inviteSecret,
    controllerId,
    ...(friendCode ? { friendCode, profileOwnerSecret: ownerSecret, visibleToFriends: true } : {})
  });
  return { publicId, hostSecret };
}

async function expectCreationLimited(promise: Promise<unknown>, message: string) {
  await expect(promise).rejects.toMatchObject({
    data: { code: CREATION_LIMITED_CODE, message }
  });
}

async function activeCounter(test: TestConvex) {
  return await test.run(async (ctx) => {
    const counter = await ctx.db
      .query("roomCounters")
      .withIndex("by_name", (index) => index.eq("name", "activeRooms"))
      .unique();
    return counter?.value ?? 0;
  });
}

async function setActiveCounter(test: TestConvex, value: number) {
  await test.run(async (ctx) => {
    const counter = await ctx.db
      .query("roomCounters")
      .withIndex("by_name", (index) => index.eq("name", "activeRooms"))
      .unique();
    if (counter) await ctx.db.patch(counter._id, { value });
    else await ctx.db.insert("roomCounters", { name: "activeRooms", value });
  });
}

describe("creation rate limits", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("limits global room creation and recovers as the bucket refills", async () => {
    const test = setup();
    for (let index = 0; index < 30; index += 1) await createRoom(test);
    await expectCreationLimited(createRoom(test), ROOM_CREATION_LIMITED_MESSAGE);
    // A rejected creation leaves no room behind and holds no active slot.
    expect(await activeCounter(test)).toBe(30);

    vi.advanceTimersByTime(MINUTE + 1000);
    await createRoom(test);
    await expectCreationLimited(createRoom(test), ROOM_CREATION_LIMITED_MESSAGE);
  });

  it("keeps existing rooms fully usable while creation is limited", async () => {
    const test = setup();
    let first: Awaited<ReturnType<typeof createRoom>> | null = null;
    for (let index = 0; index < 30; index += 1) {
      const room = await createRoom(test);
      first ??= room;
    }
    await expectCreationLimited(createRoom(test), ROOM_CREATION_LIMITED_MESSAGE);

    const joined = await test.mutation(api.rooms.join, {
      publicId: first!.publicId,
      inviteSecret,
      guestSecret: "guest_limit_abcdefghijklmnopqrstuvwxyz0123",
      displayName: "Guest"
    });
    expect(joined.displayName).toBe("Guest");
    const applied = await test.mutation(api.rooms.applyAction, {
      publicId: first!.publicId,
      hostSecret: first!.hostSecret,
      controllerId,
      expectedVersion: 0,
      clientActionId: "action_limit_abcdefghijk",
      action: { type: "set_game_name", name: "Still works" }
    });
    expect(applied.name).toBe("Still works");
    const ended = await test.mutation(api.rooms.end, {
      publicId: first!.publicId,
      hostSecret: first!.hostSecret,
      controllerId,
      expectedVersion: 1,
      clientActionId: "end_limit_abcdefghijklmn"
    });
    expect(ended.status).toBe("ended");
  });

  it("applies a stricter per-profile limit to linked rooms", async () => {
    const test = setup();
    const hostCode = friendCodeFor(1);
    const otherCode = friendCodeFor(2);
    await createProfile(test, hostCode);
    await createProfile(test, otherCode);

    for (let index = 0; index < 5; index += 1) await createRoom(test, hostCode);
    await expectCreationLimited(createRoom(test, hostCode), ROOM_CREATION_LIMITED_MESSAGE);
    // Neither unlinked rooms nor other profiles share this profile's bucket.
    await createRoom(test);
    await createRoom(test, otherCode);
    expect(await activeCounter(test)).toBe(7);

    vi.advanceTimersByTime(10 * MINUTE + 1000);
    await createRoom(test, hostCode);
    await expectCreationLimited(createRoom(test, hostCode), ROOM_CREATION_LIMITED_MESSAGE);
  });

  it("limits new friend profiles without blocking owner refreshes", async () => {
    const test = setup();
    for (let index = 0; index < 20; index += 1) {
      await createProfile(test, friendCodeFor(100 + index));
    }
    await expectCreationLimited(
      createProfile(test, friendCodeFor(200)),
      PROFILE_CREATION_LIMITED_MESSAGE
    );
    // The idempotent owner refresh of an existing profile still works.
    await expect(createProfile(test, friendCodeFor(100), "Renamed")).resolves.toMatchObject({
      displayName: "Renamed"
    });
    expect(await test.query(api.friendProfiles.lookup, { friendCode: friendCodeFor(200) })).toBeNull();

    vi.advanceTimersByTime(2 * MINUTE + 1000);
    await createProfile(test, friendCodeFor(200));
    await expectCreationLimited(
      createProfile(test, friendCodeFor(201)),
      PROFILE_CREATION_LIMITED_MESSAGE
    );
  });

  it("caps active rooms and frees a slot when a room ends or expires", async () => {
    const test = setup();
    await setActiveCounter(test, MAX_ACTIVE_ROOMS - 2);
    const ending = await createRoom(test);
    await createRoom(test);
    expect(await activeCounter(test)).toBe(MAX_ACTIVE_ROOMS);
    await expectCreationLimited(createRoom(test), ROOM_CREATION_LIMITED_MESSAGE);

    await test.mutation(api.rooms.end, {
      publicId: ending.publicId,
      hostSecret: ending.hostSecret,
      controllerId,
      expectedVersion: 0,
      clientActionId: "end_cap_abcdefghijklmnop"
    });
    expect(await activeCounter(test)).toBe(MAX_ACTIVE_ROOMS - 1);
    const expiring = await createRoom(test);
    await expectCreationLimited(createRoom(test), ROOM_CREATION_LIMITED_MESSAGE);

    await test.run(async (ctx) => {
      const room = await ctx.db
        .query("rooms")
        .withIndex("by_public_id", (index) => index.eq("publicId", expiring.publicId))
        .unique();
      await ctx.db.patch(room!._id, { lastActivityAt: Date.now() - 8 * DAY });
    });
    await test.mutation(internal.rooms.runRoomLifecycle, {});
    await test.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await activeCounter(test)).toBe(MAX_ACTIVE_ROOMS - 1);
    await createRoom(test);
  });

  it("does not release a slot for rooms created before the counter existed", async () => {
    const test = setup();
    const legacy = await createRoom(test);
    await test.run(async (ctx) => {
      const room = await ctx.db
        .query("rooms")
        .withIndex("by_public_id", (index) => index.eq("publicId", legacy.publicId))
        .unique();
      await ctx.db.patch(room!._id, { countedActive: undefined });
    });
    await createRoom(test);
    expect(await activeCounter(test)).toBe(2);
    await test.mutation(api.rooms.end, {
      publicId: legacy.publicId,
      hostSecret: legacy.hostSecret,
      controllerId,
      expectedVersion: 0,
      clientActionId: "end_legacy_abcdefghijklm"
    });
    expect(await activeCounter(test)).toBe(2);
  });

  it("bounds guest records per room, including revoked ones", async () => {
    const test = setup();
    const room = await createRoom(test);
    await test.run(async (ctx) => {
      const roomDoc = await ctx.db
        .query("rooms")
        .withIndex("by_public_id", (index) => index.eq("publicId", room.publicId))
        .unique();
      for (let index = 0; index < MAX_ROOM_GUEST_RECORDS; index += 1) {
        await ctx.db.insert("roomGuests", {
          roomId: roomDoc!._id,
          displayName: `Revoked ${index}`,
          guestSecretHash: `hash_${index}`,
          joinedAt: Date.now(),
          revokedAt: Date.now()
        });
      }
    });
    await expect(
      test.mutation(api.rooms.join, {
        publicId: room.publicId,
        inviteSecret,
        guestSecret: "guest_bound_abcdefghijklmnopqrstuvwxyz0123",
        displayName: "One too many"
      })
    ).rejects.toMatchObject({ data: { code: "ROOM_LIMIT_REACHED" } });
  });
});

type SeededRoom = {
  roomId: Id<"rooms">;
  publicId: string;
  goodGuestSecret: string;
};

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Inserts a room with guests and requests directly, bypassing creation limits. */
async function seedRoom(
  test: TestConvex,
  options: {
    status: "active" | "ended" | "expired";
    ageDays: number;
    revokedGuests?: number;
    requests?: number;
  }
): Promise<SeededRoom> {
  const suffix = uniqueSuffix();
  const publicId = `room_seed_${suffix}_abcdefg`;
  const goodGuestSecret = `guest_seed_${suffix}_abcdefghijklmnopqrstuvw`;
  const goodGuestHash = await sha256(goodGuestSecret);
  const roomId = await test.run(async (ctx) => {
    const snapshot = createDefaultGameState();
    const at = Date.now() - options.ageDays * DAY;
    const roomId = await ctx.db.insert("rooms", {
      publicId,
      status: options.status,
      name: "Seeded",
      localGameId: snapshot.localGameId,
      state: snapshot,
      version: 0,
      acceptedActionCount: 0,
      createdAt: at,
      lastActivityAt: at,
      ...(options.status === "active" ? {} : { endedAt: at }),
      hostSecretHash: await sha256(`host_${suffix}`),
      inviteSecretHash: await sha256(`invite_${suffix}`),
      hostControllerId: controllerId
    });
    const goodGuestId = await ctx.db.insert("roomGuests", {
      roomId,
      displayName: "Good guest",
      guestSecretHash: goodGuestHash,
      joinedAt: at
    });
    const revokedIds: Id<"roomGuests">[] = [];
    for (let index = 0; index < (options.revokedGuests ?? 1); index += 1) {
      revokedIds.push(await ctx.db.insert("roomGuests", {
        roomId,
        displayName: `Revoked ${index}`,
        guestSecretHash: `revoked_${suffix}_${index}`,
        joinedAt: at,
        revokedAt: at
      }));
    }
    const statuses = ["pending", "approved", "rejected"] as const;
    for (let index = 0; index < (options.requests ?? 3); index += 1) {
      const status = statuses[index % statuses.length]!;
      await ctx.db.insert("roomGuestRequests", {
        roomId,
        guestId: index % 2 === 0 ? goodGuestId : revokedIds[0] ?? goodGuestId,
        transaction: {},
        status,
        createdAt: at,
        ...(status === "pending" ? {} : { decidedAt: at })
      });
    }
    return roomId;
  });
  return { roomId, publicId, goodGuestSecret };
}

async function guestRecords(test: TestConvex, roomId: Id<"rooms">) {
  return await test.run(async (ctx) => {
    const guests = await ctx.db
      .query("roomGuests")
      .withIndex("by_room_id", (index) => index.eq("roomId", roomId))
      .collect();
    const requests = await ctx.db
      .query("roomGuestRequests")
      .withIndex("by_room_id_and_status", (index) => index.eq("roomId", roomId))
      .collect();
    const room = await ctx.db.get("rooms", roomId);
    return {
      goodGuests: guests.filter((guest) => guest.revokedAt === undefined).length,
      revokedGuests: guests.filter((guest) => guest.revokedAt !== undefined).length,
      requests: requests.length,
      prunedAt: room?.guestRecordsPrunedAt
    };
  });
}

describe("old guest record cleanup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("removes only revoked sessions and requests of rooms ended over 30 days ago", async () => {
    const test = setup();
    const oldEnded = await seedRoom(test, { status: "ended", ageDays: 31 });
    const oldExpired = await seedRoom(test, { status: "expired", ageDays: 45 });
    const recentEnded = await seedRoom(test, { status: "ended", ageDays: 10 });
    const active = await seedRoom(test, { status: "active", ageDays: 1 });

    await test.mutation(internal.rooms.runRoomLifecycle, {});
    await test.finishAllScheduledFunctions(vi.runAllTimers);

    for (const room of [oldEnded, oldExpired]) {
      expect(await guestRecords(test, room.roomId)).toEqual({
        goodGuests: 1,
        revokedGuests: 0,
        requests: 0,
        prunedAt: expect.any(Number)
      });
      // The good-standing guest can still review the ended room.
      const history = await test.query(api.rooms.historyView, {
        publicId: room.publicId,
        role: "guest",
        secret: room.goodGuestSecret
      });
      expect(history.displayName).toBe("Good guest");
    }
    for (const room of [recentEnded, active]) {
      expect(await guestRecords(test, room.roomId)).toEqual({
        goodGuests: 1,
        revokedGuests: 1,
        requests: 3,
        prunedAt: undefined
      });
    }
  });

  it("drains a backlog across bounded runs", async () => {
    const test = setup();
    const rooms: SeededRoom[] = [];
    for (let index = 0; index < 7; index += 1) {
      rooms.push(await seedRoom(test, { status: "ended", ageDays: 40 }));
      rooms.push(await seedRoom(test, { status: "expired", ageDays: 40 }));
    }
    const heavy = await seedRoom(test, {
      status: "ended",
      ageDays: 60,
      revokedGuests: 60,
      requests: 70
    });

    const first = await test.mutation(internal.rooms.runRoomLifecycle, {});
    // One batch visits a bounded number of rooms, oldest first, then hands off
    // to a continuation.
    expect(first.roomsVisited).toBeLessThanOrEqual(MAX_ROOMS_PER_BATCH);
    expect(first.continues).toBe(true);
    expect(await guestRecords(test, heavy.roomId)).toEqual({
      goodGuests: 1,
      revokedGuests: 0,
      requests: 0,
      prunedAt: expect.any(Number)
    });
    expect((await guestRecords(test, rooms[rooms.length - 1]!.roomId)).prunedAt).toBeUndefined();

    await test.finishAllScheduledFunctions(vi.runAllTimers);
    for (const room of [...rooms, heavy]) {
      expect(await guestRecords(test, room.roomId)).toEqual({
        goodGuests: 1,
        revokedGuests: 0,
        requests: 0,
        prunedAt: expect.any(Number)
      });
    }

    // Fully cleaned rooms are skipped, so a later run finds nothing to do.
    const idle = await test.mutation(internal.rooms.runRoomLifecycle, {});
    expect(idle).toMatchObject({
      outcome: "ran",
      continues: false,
      roomsVisited: 0,
      deletedGuests: 0,
      deletedRequests: 0
    });
    // The deprecated entry point still resolves and runs the same job.
    const legacy = await test.mutation(internal.rooms.pruneOldGuestRecords, {});
    expect(legacy).toMatchObject({ outcome: "ran", continues: false, deletedGuests: 0 });
  });
});
