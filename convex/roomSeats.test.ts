// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import presenceTest from "@convex-dev/presence/test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { createDefaultGameState } from "../src/state/seedGame";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/!(*.*.*)*.*s");
const hostSecret = "host_abcdefghijklmnopqrstuvwxyz0123456789AB";
const inviteSecret = "invite_abcdefghijklmnopqrstuvwxyz0123456789";
const guestSecret = "guest_abcdefghijklmnopqrstuvwxyz0123456789A";
const otherGuestSecret = "guest_zyxwvutsrqponmlkjihgfedcba9876543210Z";
const wrongHostSecret = "host_ZYXWVUTSRQPONMLKJIHGFEDCBA9876543210ab";
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
  snapshot.players = snapshot.players.map((player, index) => ({
    ...player,
    name: ["Alex", "Maya", "Jon", "Priya"][index] ?? player.name
  }));
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

async function joinSeat(test: Test, playerId: string, secret = guestSecret) {
  return await test.mutation(api.rooms.join, { publicId, inviteSecret, guestSecret: secret, playerId });
}

async function joinNamed(test: Test, displayName: string, secret = guestSecret) {
  return await test.mutation(api.rooms.join, { publicId, inviteSecret, guestSecret: secret, displayName });
}

async function hostView(test: Test) {
  return await test.query(api.rooms.hostView, { publicId, hostSecret, controllerId });
}

async function guestView(test: Test, secret = guestSecret) {
  return await test.query(api.rooms.guestView, { publicId, guestSecret: secret });
}

async function preview(test: Test) {
  const result = await test.query(api.rooms.invitePreview, { publicId, inviteSecret });
  if (result.status === "invalid") throw new Error("invite invalid");
  return result.seats ?? [];
}

async function guestId(test: Test, displayName: string) {
  const guest = (await hostView(test)).guests.find((entry) => entry.displayName === displayName);
  if (!guest) throw new Error(`no guest ${displayName}`);
  return guest.id as Id<"roomGuests">;
}

async function hostAction(test: Test, expectedVersion: number, clientActionId: string, action: unknown) {
  return await test.mutation(api.rooms.applyAction, {
    publicId,
    hostSecret,
    controllerId,
    expectedVersion,
    clientActionId,
    action
  });
}

function holders(seats: { playerId: string; guest: { displayName: string } | null }[]) {
  return Object.fromEntries(seats.map((seat) => [seat.playerId, seat.guest?.displayName ?? null]));
}

describe("seat claims", () => {
  it("joins with a seat in one step and takes the seat's player name", async () => {
    const { test, players } = await createRoom();
    const joined = await joinSeat(test, players.second);
    expect(joined.displayName).toBe("Maya");
    expect(joined.seatPlayerId).toBe(players.second);
    expect(joined.seats.find((seat) => seat.playerId === players.second)).toMatchObject({ claimed: false });

    const guest = await guestView(test);
    expect(guest.seatPlayerId).toBe(players.second);
    const host = await hostView(test);
    expect(host.seats.find((seat) => seat.playerId === players.second)?.guest).toMatchObject({
      displayName: "Maya",
      connected: false
    });
  });

  it("gives a contested seat to the first phone only", async () => {
    const { test, players } = await createRoom();
    const results = await Promise.allSettled([
      joinSeat(test, players.second, guestSecret),
      joinSeat(test, players.second, otherGuestSecret)
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.data).toMatchObject({ code: "SEAT_TAKEN" });
    // The losing join rolled back entirely: no seatless guest row was left behind.
    expect((await hostView(test)).guests).toHaveLength(1);

    // The same race between two guests already in the room.
    await joinNamed(test, "Casey", otherGuestSecret);
    await expect(
      test.mutation(api.rooms.claimSeat, { publicId, guestSecret: otherGuestSecret, playerId: players.second })
    ).rejects.toThrow(/took that seat/);
    const seats = (await guestView(test, otherGuestSecret)).seats;
    expect(seats.find((seat) => seat.playerId === players.second)).toMatchObject({ claimed: true });
  });

  it("keeps the host's seat out of reach of guests", async () => {
    const { test, players } = await createRoom();
    await test.mutation(api.rooms.setHostPlayer, { publicId, hostSecret, playerId: players.first });
    expect((await preview(test)).find((seat) => seat.playerId === players.first)).toMatchObject({
      isHost: true
    });
    await expect(joinSeat(test, players.first)).rejects.toThrow(/host's seat/);
    await joinNamed(test, "Casey");
    await expect(
      test.mutation(api.rooms.claimSeat, { publicId, guestSecret, playerId: players.first })
    ).rejects.toThrow(/host's seat/);
    await expect(
      test.mutation(api.rooms.assignSeat, {
        publicId,
        hostSecret,
        guestId: await guestId(test, "Casey"),
        playerId: players.first
      })
    ).rejects.toThrow(/host's seat/);

    // The host can't take a seat a phone holds, and can clear their own.
    await test.mutation(api.rooms.claimSeat, { publicId, guestSecret, playerId: players.second });
    await expect(
      test.mutation(api.rooms.setHostPlayer, { publicId, hostSecret, playerId: players.second })
    ).rejects.toThrow(/Release it first/);
    await test.mutation(api.rooms.setHostPlayer, { publicId, hostSecret, playerId: null });
    expect((await hostView(test)).hostPlayerId).toBeNull();
  });

  it("moves a guest who claims a second seat", async () => {
    const { test, players } = await createRoom();
    await joinSeat(test, players.second);
    await test.mutation(api.rooms.claimSeat, { publicId, guestSecret, playerId: players.third });

    const guest = await guestView(test);
    expect(guest.seatPlayerId).toBe(players.third);
    expect(guest.displayName).toBe("Jon");
    const host = await hostView(test);
    expect(holders(host.seats)).toMatchObject({ [players.second]: null, [players.third]: "Jon" });
    // The old seat is open again.
    await joinSeat(test, players.second, otherGuestSecret);
  });

  it("frees a revoked guest's seat", async () => {
    const { test, players } = await createRoom();
    await joinSeat(test, players.second);
    await test.mutation(api.rooms.revokeGuest, {
      publicId,
      hostSecret,
      guestId: await guestId(test, "Maya")
    });
    expect((await preview(test)).find((seat) => seat.playerId === players.second)).toMatchObject({
      claimed: false
    });
    const joined = await joinSeat(test, players.second, otherGuestSecret);
    expect(joined.seatPlayerId).toBe(players.second);
  });

  it("treats a claim on an archived player as no claim", async () => {
    const { test, players } = await createRoom();
    await joinSeat(test, players.second);
    await test.mutation(api.rooms.setHostPlayer, { publicId, hostSecret, playerId: players.third });
    await hostAction(test, 0, "action_archive_second_seat", { type: "archive_player", playerId: players.second });
    await hostAction(test, 1, "action_archive_third_seat", { type: "archive_player", playerId: players.third });

    const guest = await guestView(test);
    expect(guest.seatPlayerId).toBeNull();
    expect(guest.seats.map((seat) => seat.playerId)).not.toContain(players.second);
    const host = await hostView(test);
    expect(host.hostPlayerId).toBeNull();
    expect(host.seats.map((seat) => seat.playerId)).not.toContain(players.second);
    // An archived seat can't be claimed.
    await expect(
      test.mutation(api.rooms.claimSeat, { publicId, guestSecret, playerId: players.second })
    ).rejects.toThrow(/no longer at the table/);
    // The guest can pick another seat.
    await test.mutation(api.rooms.claimSeat, { publicId, guestSecret, playerId: players.first });
    expect((await guestView(test)).seatPlayerId).toBe(players.first);
  });

  it("lets only the host release, move, or mark seats", async () => {
    const { test, players } = await createRoom();
    await joinSeat(test, players.second);
    const maya = await guestId(test, "Maya");

    for (const call of [
      () => test.mutation(api.rooms.releaseSeat, { publicId, hostSecret: wrongHostSecret, guestId: maya }),
      () =>
        test.mutation(api.rooms.assignSeat, {
          publicId,
          hostSecret: wrongHostSecret,
          guestId: maya,
          playerId: players.third
        }),
      () =>
        test.mutation(api.rooms.setHostPlayer, {
          publicId,
          hostSecret: wrongHostSecret,
          playerId: players.first
        }),
      // A guest's own secret is not a host secret.
      () => test.mutation(api.rooms.releaseSeat, { publicId, hostSecret: guestSecret, guestId: maya })
    ]) {
      await expect(call()).rejects.toThrow(/Host capability is invalid/);
    }

    await test.mutation(api.rooms.assignSeat, { publicId, hostSecret, guestId: maya, playerId: players.third });
    expect((await guestView(test)).seatPlayerId).toBe(players.third);
    await test.mutation(api.rooms.releaseSeat, { publicId, hostSecret, guestId: maya });
    expect((await guestView(test)).seatPlayerId).toBeNull();
    // A move only goes to an open seat.
    await joinSeat(test, players.second, otherGuestSecret);
    await expect(
      test.mutation(api.rooms.assignSeat, { publicId, hostSecret, guestId: maya, playerId: players.second })
    ).rejects.toThrow(/took that seat/);
  });

  it("never shows other guests' names or ids in the invitation or a guest's seat list", async () => {
    const { test, players } = await createRoom();
    await joinSeat(test, players.second);
    const mayaId = await guestId(test, "Maya");
    await joinNamed(test, "Casey", otherGuestSecret);
    await test.mutation(api.rooms.setHostPlayer, { publicId, hostSecret, playerId: players.first });

    const seats = await preview(test);
    expect(seats).toEqual([
      expect.objectContaining({ playerId: players.first, name: "Alex", claimed: false, isHost: true }),
      expect.objectContaining({ playerId: players.second, name: "Maya", claimed: true, isHost: false }),
      ...seats.slice(2)
    ]);
    for (const seat of seats) expect(Object.keys(seat).sort()).toEqual(["claimed", "isHost", "name", "playerId"]);
    const serialized = JSON.stringify(seats) + JSON.stringify((await guestView(test, otherGuestSecret)).seats);
    expect(serialized).not.toContain(String(mayaId));
    expect(serialized).not.toContain("Casey");

    // A guest sees their own seat as theirs, not as claimed.
    const own = (await guestView(test)).seats.find((seat) => seat.playerId === players.second);
    expect(own).toMatchObject({ claimed: false });
  });

  it("still lets old clients join with just a name", async () => {
    const { test } = await createRoom();
    const joined = await joinNamed(test, "Casey");
    expect(joined.displayName).toBe("Casey");
    expect(joined.seatPlayerId).toBeNull();
    await expect(
      test.mutation(api.rooms.join, { publicId, inviteSecret, guestSecret: otherGuestSecret })
    ).rejects.toThrow(/Display name/);
  });
});
