// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import presenceTest from "@convex-dev/presence/test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameState } from "../src/domain/pokerTypes";
import { createDefaultGameState } from "../src/state/seedGame";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { HOST_PHONE_LINK_TTL_MS } from "./lib/roomSeats";
import schema from "./schema";

const modules = import.meta.glob("./**/!(*.*.*)*.*s");
const hostSecret = "host_abcdefghijklmnopqrstuvwxyz0123456789AB";
const inviteSecret = "invite_abcdefghijklmnopqrstuvwxyz0123456789";
const controllerId = "controller_abcdefghijklmnop";
const publicId = "room_abcdefghijklmnop";
const linkSecret = "phonelink_abcdefghijklmnopqrstuvwxyz012345";
const secrets = {
  phone: "guest_phone_abcdefghijklmnopqrstuvwxyz01234",
  phone2: "guest_phone2_abcdefghijklmnopqrstuvwxyz0123",
  maya: "guest_maya_abcdefghijklmnopqrstuvwxyz012345",
  jon: "guest_jon_abcdefghijklmnopqrstuvwxyz0123456",
  dev: "guest_dev_abcdefghijklmnopqrstuvwxyz0123456"
};

type Test = ReturnType<typeof setup>;

function setup() {
  const test = convexTest(schema, modules);
  presenceTest.register(test);
  rateLimiterTest.register(test);
  return test;
}

afterEach(() => {
  vi.useRealTimers();
});

/** Alex (the host's seat), Maya, Jon, Priya; Maya and Jon join on their seats. */
async function createRoom(options: { hostSeat?: boolean } = {}) {
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
    controllerId,
    peerConfirm: true
  });
  const [alex, maya, jon, priya] = snapshot.players.map((player) => player.id);
  const seats = { alex, maya, jon, priya };
  if (options.hostSeat !== false) {
    await test.mutation(api.rooms.setHostPlayer, { publicId, hostSecret, playerId: alex });
  }
  for (const name of ["maya", "jon"] as const) {
    await test.mutation(api.rooms.join, { publicId, inviteSecret, guestSecret: secrets[name], playerId: seats[name] });
  }
  return { test, seats };
}

async function makeLink(test: Test, secret = linkSecret) {
  return await test.mutation(api.rooms.createHostPhoneLink, { publicId, hostSecret, linkSecret: secret });
}

async function pair(test: Test, guest: keyof typeof secrets = "phone", secret = linkSecret) {
  return await test.mutation(api.rooms.joinHostPhone, { publicId, linkSecret: secret, guestSecret: secrets[guest] });
}

async function hostView(test: Test) {
  return await test.query(api.rooms.hostView, { publicId, hostSecret, controllerId });
}

async function guestView(test: Test, guest: keyof typeof secrets) {
  return await test.query(api.rooms.guestView, { publicId, guestSecret: secrets[guest] });
}

let counter = 0;
async function propose(
  test: Test,
  guest: keyof typeof secrets,
  proposal: { kind: "give" | "buy" | "bank"; counterpartyPlayerId?: string; witnessPlayerId?: string }
) {
  counter += 1;
  return await test.mutation(api.rooms.proposeAgreement, {
    publicId,
    guestSecret: secrets[guest],
    amountCents: 2000,
    clientRequestId: `request_${String(counter).padStart(12, "0")}`,
    ...proposal
  });
}

async function confirm(test: Test, guest: keyof typeof secrets, agreementId: Id<"roomAgreements">) {
  return await test.mutation(api.rooms.confirmAgreement, { publicId, guestSecret: secrets[guest], agreementId });
}

function hostSeatRow(view: Awaited<ReturnType<typeof hostView>>) {
  return view.seats.find((seat) => seat.isHost);
}

describe("the host's own phone", () => {
  it("can't buy in from the phone when nobody else has a phone to see it", async () => {
    const test = setup();
    const snapshot = createDefaultGameState();
    await test.mutation(api.rooms.create, {
      publicId,
      localGameId: snapshot.localGameId,
      snapshot,
      hostSecret,
      inviteSecret,
      controllerId,
      peerConfirm: true
    });
    await test.mutation(api.rooms.setHostPlayer, { publicId, hostSecret, playerId: snapshot.players[0]!.id });
    await makeLink(test);
    await pair(test);
    await expect(propose(test, "phone", { kind: "bank" })).rejects.toThrow(/Nobody else has a phone/);
  });

  it("joins in the host's seat with the host's one-time link", async () => {
    const { test, seats } = await createRoom();
    await makeLink(test);
    const room = await pair(test);
    expect(room.seatPlayerId).toBe(seats.alex);
    expect(room.displayName).toBe("Alex");
    expect(hostSeatRow(await hostView(test))).toMatchObject({
      playerId: seats.alex,
      isHost: true,
      guest: expect.objectContaining({ displayName: "Alex" })
    });
    // Other phones still see the host's seat as taken.
    expect((await guestView(test, "maya")).seats.find((seat) => seat.playerId === seats.alex)).toMatchObject({
      isHost: true,
      claimed: true
    });
  });

  it("works once, only until it expires, and only after the host picks a seat", async () => {
    const { test } = await createRoom({ hostSeat: false });
    await expect(makeLink(test)).rejects.toThrow(/Pick which seat is yours/);
    await test.mutation(api.rooms.setHostPlayer, {
      publicId,
      hostSecret,
      playerId: (await hostView(test)).seats[0]!.playerId
    });
    await expect(
      test.mutation(api.rooms.createHostPhoneLink, { publicId, hostSecret: "host_ZYXWVUTSRQPONMLKJIHGFEDCBA9876543210ab", linkSecret })
    ).rejects.toThrow();

    await makeLink(test);
    await pair(test);
    await expect(pair(test, "phone2")).rejects.toThrow(/already used/);

    vi.useFakeTimers();
    const other = "phonelink_zyxwvutsrqponmlkjihgfedcba987654";
    await makeLink(test, other);
    vi.setSystemTime(Date.now() + HOST_PHONE_LINK_TTL_MS + 1);
    await expect(pair(test, "phone2", other)).rejects.toThrow(/expired/);
  });

  it("works while new guests are turned away, but the player link still can't take the host's seat", async () => {
    const { test, seats } = await createRoom();
    await test.mutation(api.rooms.setJoiningOpen, { publicId, hostSecret, open: false });
    await makeLink(test);
    expect((await pair(test)).seatPlayerId).toBe(seats.alex);
    await test.mutation(api.rooms.setJoiningOpen, { publicId, hostSecret, open: true });
    await expect(
      test.mutation(api.rooms.join, { publicId, inviteSecret, guestSecret: secrets.dev, playerId: seats.alex })
    ).rejects.toThrow(/host's seat/);
  });

  it("removes a phone it unpairs: replaced, disconnected, or after the host changes seat", async () => {
    const { test, seats } = await createRoom();
    await makeLink(test);
    await pair(test, "phone");
    await makeLink(test);
    await pair(test, "phone2");
    await expect(guestView(test, "phone")).rejects.toThrow(/revoked/);
    expect((await guestView(test, "phone2")).seatPlayerId).toBe(seats.alex);
    // The host's phone can't hop to another seat on its own, nor be moved there.
    await expect(
      test.mutation(api.rooms.claimSeat, { publicId, guestSecret: secrets.phone2, playerId: seats.priya })
    ).rejects.toThrow(/host's phone/);
    const phone = hostSeatRow(await hostView(test))!.guest!;
    await expect(
      test.mutation(api.rooms.assignSeat, { publicId, hostSecret, guestId: phone.id, playerId: seats.priya })
    ).rejects.toThrow(/stays in your seat/);

    // Disconnect: the phone leaves; the seat stays the host's, not marked released.
    await test.mutation(api.rooms.releaseSeat, { publicId, hostSecret, guestId: phone.id, playerId: seats.alex });
    await expect(guestView(test, "phone2")).rejects.toThrow(/revoked/);
    expect(hostSeatRow(await hostView(test))).toMatchObject({ playerId: seats.alex, guest: null });
    expect(hostSeatRow(await hostView(test))).not.toHaveProperty("releasedByHost");

    // Changing the host's seat removes the phone (never Alex's ordinary claim) and voids an unused link.
    const third = "phonelink_third_abcdefghijklmnopqrstuvwxyz0";
    await makeLink(test, third);
    await test.mutation(api.rooms.joinHostPhone, { publicId, linkSecret: third, guestSecret: secrets.dev });
    await makeLink(test);
    await test.mutation(api.rooms.setHostPlayer, { publicId, hostSecret, playerId: seats.priya });
    await expect(test.query(api.rooms.guestView, { publicId, guestSecret: secrets.dev })).rejects.toThrow(/revoked/);
    expect((await hostView(test)).seats.find((seat) => seat.playerId === seats.alex)).toMatchObject({
      isHost: false,
      guest: null
    });
    await expect(pair(test, "phone")).rejects.toThrow(/already used or replaced/);
  });

  it("stops working once the host closes it", async () => {
    const { test } = await createRoom();
    await makeLink(test);
    await test.mutation(api.rooms.cancelHostPhoneLink, { publicId, hostSecret });
    await expect(pair(test)).rejects.toThrow(/already used or replaced/);
  });

  it("answers entries sent to the host's seat, as does the host screen", async () => {
    const { test, seats } = await createRoom();
    await makeLink(test);
    await pair(test);

    // Sent to Alex: the phone sees it and can confirm it.
    const give = await propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.alex });
    expect((await guestView(test, "phone")).agreements.needsMe.map((entry) => entry.id)).toEqual([give]);
    expect((await hostView(test)).needsHost.answer.map((entry) => entry.id)).toContain(give);
    expect(await confirm(test, "phone", give)).toMatchObject({ status: "recorded" });
    const recorded = (await hostView(test)).state as GameState;
    expect(recorded.transactions.find((transaction) => transaction.agreementId === give)).toMatchObject({
      confirmedByPlayerId: seats.alex
    });

    // Or the host screen answers it, and it leaves the phone's Inbox.
    const buy = await propose(test, "jon", { kind: "buy", counterpartyPlayerId: seats.alex });
    await test.mutation(api.rooms.hostConfirmAgreement, { publicId, hostSecret, controllerId, agreementId: buy, answer: "confirm" });
    expect((await guestView(test, "phone")).agreements.needsMe).toEqual([]);

    // The phone witnesses other players' bank buy-ins.
    const bank = await propose(test, "maya", { kind: "bank" });
    expect(await confirm(test, "phone", bank)).toMatchObject({ status: "recorded" });
  });

  it("sends the host's own buy-in for another player to see, not the host screen", async () => {
    const { test, seats } = await createRoom();
    await makeLink(test);
    await pair(test);
    const bank = await propose(test, "phone", { kind: "bank" });
    expect((await hostView(test)).needsHost.answer.map((entry) => entry.id)).not.toContain(bank);
    await expect(
      test.mutation(api.rooms.hostConfirmAgreement, { publicId, hostSecret, controllerId, agreementId: bank, answer: "confirm" })
    ).rejects.toThrow(/own buy-in/);
    expect(await confirm(test, "maya", bank)).toMatchObject({ status: "recorded" });

    // Only someone with a phone can see it.
    await expect(propose(test, "phone", { kind: "bank", witnessPlayerId: seats.priya })).rejects.toThrow(/Priya has no phone/);

    // And a give from the phone goes to the other player like anyone's.
    const give = await propose(test, "phone", { kind: "give", counterpartyPlayerId: seats.jon });
    expect(await confirm(test, "jon", give)).toMatchObject({ status: "recorded" });
  });
});
