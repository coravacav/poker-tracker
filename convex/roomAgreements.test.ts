// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import presenceTest from "@convex-dev/presence/test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPlayerSummaries, getSummaryByPlayerId } from "../src/domain/ledger";
import type { GameState, Transaction } from "../src/domain/pokerTypes";
import { MAX_ROOM_ACTIONS } from "../src/session/roomProtocol";
import { createDefaultGameState } from "../src/state/seedGame";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { AGREEMENT_TTL_MS } from "./lib/roomAgreements";
import { ACTIVE_ROOM_IDLE_MS, ENDED_DETAIL_RETENTION_MS } from "./lib/roomLifecycle";
import schema from "./schema";

const modules = import.meta.glob("./**/!(*.*.*)*.*s");
const hostSecret = "host_abcdefghijklmnopqrstuvwxyz0123456789AB";
const inviteSecret = "invite_abcdefghijklmnopqrstuvwxyz0123456789";
const controllerId = "controller_abcdefghijklmnop";
const publicId = "room_abcdefghijklmnop";
const secrets = {
  maya: "guest_maya_abcdefghijklmnopqrstuvwxyz012345",
  jon: "guest_jon_abcdefghijklmnopqrstuvwxyz0123456",
  priya: "guest_priya_abcdefghijklmnopqrstuvwxyz01234",
  dev: "guest_dev_abcdefghijklmnopqrstuvwxyz0123456"
};

type Test = ReturnType<typeof setup>;
type Seats = Awaited<ReturnType<typeof createRoom>>["seats"];

function setup() {
  const test = convexTest(schema, modules);
  presenceTest.register(test);
  rateLimiterTest.register(test);
  return test;
}

afterEach(() => {
  vi.useRealTimers();
});

/** Alex, Maya, Jon, Priya, Dev, Sam; Maya and Jon join on their seats. */
async function createRoom(options: { peerConfirm?: boolean; seated?: (keyof typeof secrets)[] } = {}) {
  const test = setup();
  const snapshot = createDefaultGameState();
  snapshot.players = snapshot.players.map((player, index) => ({
    ...player,
    name: ["Alex", "Maya", "Jon", "Priya", "Dev", "Sam"][index] ?? player.name
  }));
  await test.mutation(api.rooms.create, {
    publicId,
    localGameId: snapshot.localGameId,
    snapshot,
    hostSecret,
    inviteSecret,
    controllerId,
    ...(options.peerConfirm === false ? {} : { peerConfirm: true })
  });
  const [alex, maya, jon, priya, dev, sam] = snapshot.players.map((player) => player.id);
  const seats = { alex, maya, jon, priya, dev, sam };
  for (const name of options.seated ?? ["maya", "jon"]) {
    await test.mutation(api.rooms.join, {
      publicId,
      inviteSecret,
      guestSecret: secrets[name],
      playerId: seats[name as keyof typeof seats]
    });
  }
  return { test, seats };
}

let requestCounter = 0;
function requestId() {
  requestCounter += 1;
  return `request_${String(requestCounter).padStart(12, "0")}`;
}

async function propose(
  test: Test,
  guest: keyof typeof secrets,
  proposal: {
    kind: "give" | "buy" | "bank";
    amountCents?: number;
    counterpartyPlayerId?: string;
    witnessPlayerId?: string;
    clientRequestId?: string;
    note?: string;
  }
) {
  return await test.mutation(api.rooms.proposeAgreement, {
    publicId,
    guestSecret: secrets[guest],
    amountCents: 2000,
    clientRequestId: requestId(),
    ...proposal
  });
}

async function confirm(test: Test, guest: keyof typeof secrets, agreementId: Id<"roomAgreements">) {
  return await test.mutation(api.rooms.confirmAgreement, {
    publicId,
    guestSecret: secrets[guest],
    agreementId
  });
}

async function bounce(test: Test, guest: keyof typeof secrets, agreementId: Id<"roomAgreements">, reason?: string) {
  return await test.mutation(api.rooms.bounceAgreement, {
    publicId,
    guestSecret: secrets[guest],
    agreementId,
    ...(reason !== undefined ? { reason } : {})
  });
}

async function hostAnswer(test: Test, agreementId: Id<"roomAgreements">, answer: "confirm" | "not_right" = "confirm") {
  return await test.mutation(api.rooms.hostConfirmAgreement, {
    publicId,
    hostSecret,
    controllerId,
    agreementId,
    answer
  });
}

async function hostResolve(test: Test, agreementId: Id<"roomAgreements">, decision: "dismiss" | "record") {
  return await test.mutation(api.rooms.hostResolveBounced, {
    publicId,
    hostSecret,
    controllerId,
    agreementId,
    decision
  });
}

async function hostView(test: Test) {
  return await test.query(api.rooms.hostView, { publicId, hostSecret, controllerId });
}

async function guestView(test: Test, guest: keyof typeof secrets) {
  return await test.query(api.rooms.guestView, { publicId, guestSecret: secrets[guest] });
}

async function hostAction(test: Test, expectedVersion: number, action: unknown) {
  return await test.mutation(api.rooms.applyAction, {
    publicId,
    hostSecret,
    controllerId,
    expectedVersion,
    clientActionId: requestId(),
    action
  });
}

async function agreementRow(test: Test, agreementId: Id<"roomAgreements">) {
  return await test.run(async (ctx) => await ctx.db.get("roomAgreements", agreementId));
}

async function guestId(test: Test, displayName: string) {
  const guest = (await hostView(test)).guests.find((entry) => entry.displayName === displayName);
  if (!guest) throw new Error(`no guest ${displayName}`);
  return guest.id;
}

function agreedEntries(state: GameState): Transaction[] {
  return state.transactions.filter((transaction) => transaction.agreementId !== undefined);
}

function nets(state: GameState, seats: Seats) {
  const summaries = getSummaryByPlayerId(buildPlayerSummaries(state.players, state.transactions));
  return {
    maya: summaries.get(seats.maya)!.netCents,
    jon: summaries.get(seats.jon)!.netCents,
    mayaBankBuyIns: summaries.get(seats.maya)!.bankBuyInsCents
  };
}

describe("peer agreements: recording", () => {
  it("records a give when the other player confirms: the giver is owed at settle-up", async () => {
    const { test, seats } = await createRoom();
    const agreementId = await propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.jon, note: "rebuy" });

    const jonInbox = (await guestView(test, "jon")).agreements;
    expect(jonInbox.needsMe).toEqual([
      expect.objectContaining({
        id: agreementId,
        kind: "give",
        amountCents: 2000,
        proposerName: "Maya",
        counterpartyName: "Jon",
        note: "rebuy",
        status: "open"
      })
    ]);
    const mayaInbox = (await guestView(test, "maya")).agreements;
    expect(mayaInbox.mine.map((agreement) => agreement.id)).toEqual([agreementId]);
    expect(mayaInbox.needsMe).toEqual([]);
    expect(jonInbox.needsMe[0]!.expiresAt - jonInbox.needsMe[0]!.createdAt).toBe(AGREEMENT_TTL_MS);

    expect(await confirm(test, "jon", agreementId)).toEqual({ status: "recorded", reason: null });

    const host = await hostView(test);
    const [entry] = agreedEntries(host.state as GameState);
    expect(entry).toMatchObject({
      type: "player_gave",
      category: "poker",
      fromPlayerId: seats.maya,
      toPlayerId: seats.jon,
      amountCents: 2000,
      note: "rebuy",
      proposedByPlayerId: seats.maya,
      confirmedByPlayerId: seats.jon,
      agreementId: String(agreementId),
      confirmedVia: "peer"
    });
    expect(nets(host.state as GameState, seats)).toMatchObject({ maya: 2000, jon: -2000 });
    expect(host.activity.events[0]).toMatchObject({
      summary: "Maya gave Jon $20.00",
      actorLabel: "Maya · confirmed by Jon"
    });
    // A server-made write: only the version moves, not the host's base.
    expect(host.version).toBe(1);
    expect((await test.run(async (ctx) => await ctx.db.query("rooms").first()))?.hostBaseVersion).toBe(0);

    const after = (await guestView(test, "maya")).agreements;
    expect(after.mine).toEqual([]);
    expect(after.recentDone).toEqual([
      expect.objectContaining({
        id: agreementId,
        status: "recorded",
        confirmedByName: "Jon",
        confirmedVia: "peer",
        transactionId: entry!.id,
        voided: false
      })
    ]);
    expect((await guestView(test, "jon")).agreements.recentDone.map((agreement) => agreement.id)).toEqual([agreementId]);
  });

  it("records a buy as the other player giving to the proposer", async () => {
    const { test, seats } = await createRoom();
    const agreementId = await propose(test, "maya", { kind: "buy", counterpartyPlayerId: seats.jon });
    await confirm(test, "jon", agreementId);
    const state = (await hostView(test)).state as GameState;
    expect(agreedEntries(state)[0]).toMatchObject({
      type: "player_gave",
      fromPlayerId: seats.jon,
      toPlayerId: seats.maya,
      proposedByPlayerId: seats.maya,
      confirmedByPlayerId: seats.jon
    });
    expect(nets(state, seats)).toMatchObject({ maya: -2000, jon: 2000 });
  });

  it("records a bank buy-in when another seated player saw it", async () => {
    const { test, seats } = await createRoom({ seated: ["maya", "jon", "priya"] });
    const agreementId = await propose(test, "maya", { kind: "bank" });
    expect((await guestView(test, "jon")).agreements.needsMe.map((agreement) => agreement.id)).toEqual([agreementId]);
    expect((await guestView(test, "priya")).agreements.needsMe.map((agreement) => agreement.id)).toEqual([agreementId]);
    expect((await guestView(test, "maya")).agreements.needsMe).toEqual([]);

    await confirm(test, "priya", agreementId);
    const host = await hostView(test);
    const state = host.state as GameState;
    const [entry] = agreedEntries(state);
    expect(entry).toMatchObject({
      type: "bank_buy_in",
      toPlayerId: seats.maya,
      amountCents: 2000,
      proposedByPlayerId: seats.maya,
      confirmedByPlayerId: seats.priya,
      confirmedVia: "peer"
    });
    expect(entry!.category).toBeUndefined();
    expect(nets(state, seats)).toMatchObject({ maya: -2000, mayaBankBuyIns: 2000 });
    expect(host.activity.events[0]).toMatchObject({
      summary: "Maya bought in for $20.00",
      actorLabel: "Maya · seen by Priya"
    });
    // Jon's chance to witness is gone.
    expect((await guestView(test, "jon")).agreements.needsMe).toEqual([]);
  });

  it("applies a double confirm once", async () => {
    const { test, seats } = await createRoom();
    const agreementId = await propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.jon });
    const results = await Promise.all([confirm(test, "jon", agreementId), confirm(test, "jon", agreementId)]);
    expect(results).toEqual([
      { status: "recorded", reason: null },
      { status: "recorded", reason: null }
    ]);
    expect(await confirm(test, "jon", agreementId)).toEqual({ status: "recorded", reason: null });
    const host = await hostView(test);
    expect(agreedEntries(host.state as GameState)).toHaveLength(1);
    expect(host.version).toBe(1);
  });

  it("is idempotent on the proposer's request id", async () => {
    const { test, seats } = await createRoom();
    const clientRequestId = requestId();
    const first = await propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.jon, clientRequestId });
    const second = await propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.jon, clientRequestId });
    expect(second).toBe(first);
    expect((await guestView(test, "maya")).agreements.mine).toHaveLength(1);
  });

  it("checks the entry when it is proposed", async () => {
    const { test, seats } = await createRoom();
    for (const amountCents of [0, -100, 12.5, 1_000_001]) {
      await expect(
        propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.jon, amountCents })
      ).rejects.toThrow(/amount between/);
    }
    await expect(propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.maya })).rejects.toThrow(/another player/);
    await expect(propose(test, "maya", { kind: "give" })).rejects.toThrow(/no longer at the table/);
    await expect(propose(test, "maya", { kind: "give", counterpartyPlayerId: "player_missing" })).rejects.toThrow(/no longer at the table/);
    await expect(
      propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.jon, witnessPlayerId: seats.priya })
    ).rejects.toThrow(/Only bank/);
    await expect(propose(test, "maya", { kind: "bank", counterpartyPlayerId: seats.jon })).rejects.toThrow(/no other player/);
    // A phone with no seat can't propose.
    await test.mutation(api.rooms.join, { publicId, inviteSecret, guestSecret: secrets.dev, displayName: "Casey" });
    await expect(propose(test, "dev", { kind: "bank" })).rejects.toThrow(/Pick your seat/);
  });

  it("caps open proposals per guest", async () => {
    const { test, seats } = await createRoom();
    for (let index = 0; index < 10; index += 1) {
      await propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.jon });
    }
    await expect(propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.jon })).rejects.toThrow(/open entries/);
    // Another guest has their own allowance.
    await propose(test, "jon", { kind: "give", counterpartyPlayerId: seats.maya });
  });
});

describe("peer agreements: who may answer", () => {
  it("refuses the wrong confirmer and the proposer's own phone", async () => {
    const { test, seats } = await createRoom({ seated: ["maya", "jon", "priya"] });
    const agreementId = await propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.jon });
    await expect(confirm(test, "priya", agreementId)).rejects.toThrow(/Only Jon can confirm/);
    await expect(bounce(test, "priya", agreementId)).rejects.toThrow(/Only Jon can confirm/);
    await expect(confirm(test, "maya", agreementId)).rejects.toThrow(/your own entry/);
    expect((await agreementRow(test, agreementId))?.status).toBe("open");
    // The host can't answer for a seat a phone holds.
    await expect(hostAnswer(test, agreementId)).rejects.toThrow(/Jon's phone answers/);
  });

  it("never lets the beneficiary witness their own bank buy-in, and honors a named witness", async () => {
    const { test, seats } = await createRoom({ seated: ["maya", "jon", "priya"] });
    await expect(propose(test, "maya", { kind: "bank", witnessPlayerId: seats.maya })).rejects.toThrow(/someone else/);
    const open = await propose(test, "maya", { kind: "bank" });
    await expect(confirm(test, "maya", open)).rejects.toThrow(/your own entry/);

    const named = await propose(test, "maya", { kind: "bank", witnessPlayerId: seats.jon });
    expect((await guestView(test, "priya")).agreements.needsMe.map((agreement) => agreement.id)).toEqual([open]);
    expect(
      (await guestView(test, "jon")).agreements.needsMe.map((agreement) => agreement.id).sort()
    ).toEqual([open, named].sort());
    await expect(confirm(test, "priya", named)).rejects.toThrow(/asked Jon to see this/);
    expect(await confirm(test, "jon", named)).toMatchObject({ status: "recorded" });
    expect(agreedEntries((await hostView(test)).state as GameState)[0]).toMatchObject({
      confirmedByPlayerId: seats.jon
    });
  });

  it("refuses a revoked confirmer and cancels a revoked proposer's entries", async () => {
    const { test, seats } = await createRoom();
    const toJon = await propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.jon });
    const fromJon = await propose(test, "jon", { kind: "give", counterpartyPlayerId: seats.maya });
    const bounced = await propose(test, "jon", { kind: "give", counterpartyPlayerId: seats.maya });
    await bounce(test, "maya", bounced);

    await test.mutation(api.rooms.revokeGuest, { publicId, hostSecret, guestId: await guestId(test, "Jon") });
    await expect(confirm(test, "jon", toJon)).rejects.toThrow(/invalid or revoked/);
    // The revoked guest's proposals, bounced ones included, are closed.
    expect(await agreementRow(test, fromJon)).toMatchObject({ status: "cancelled", closedReason: "revoked" });
    expect(await agreementRow(test, bounced)).toMatchObject({ status: "cancelled", closedReason: "revoked" });
    expect(await confirm(test, "maya", fromJon)).toEqual({ status: "cancelled", reason: "revoked" });
    expect((await hostView(test)).needsHost.bounced).toEqual([]);
    expect(agreedEntries((await hostView(test)).state as GameState)).toEqual([]);
  });

  it("cancels an entry when its proposer loses the seat it was sent from", async () => {
    const { test, seats } = await createRoom({ seated: ["maya", "jon", "priya"] });
    const released = await propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.jon });
    await test.mutation(api.rooms.releaseSeat, {
      publicId,
      hostSecret,
      guestId: await guestId(test, "Maya"),
      playerId: seats.maya
    });
    expect(await agreementRow(test, released)).toMatchObject({ status: "cancelled", closedReason: "seat_lost" });
    expect(await confirm(test, "jon", released)).toEqual({ status: "cancelled", reason: "seat_lost" });
    expect((await guestView(test, "jon")).agreements.needsMe).toEqual([]);

    // Moving seats, and the host renaming the proposer's player, do the same.
    const moved = await propose(test, "jon", { kind: "give", counterpartyPlayerId: seats.priya });
    await test.mutation(api.rooms.claimSeat, { publicId, guestSecret: secrets.jon, playerId: seats.dev });
    expect(await agreementRow(test, moved)).toMatchObject({ status: "cancelled", closedReason: "seat_lost" });

    const renamed = await propose(test, "priya", { kind: "give", counterpartyPlayerId: seats.dev });
    await hostAction(test, (await hostView(test)).version, {
      type: "rename_player",
      playerId: seats.priya,
      name: "Priya B"
    });
    expect(await agreementRow(test, renamed)).toMatchObject({ status: "cancelled", closedReason: "seat_lost" });
    expect(agreedEntries((await hostView(test)).state as GameState)).toEqual([]);
  });

  it("closes every open entry when the room ends", async () => {
    const { test, seats } = await createRoom();
    const open = await propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.jon });
    const bounced = await propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.jon });
    await bounce(test, "jon", bounced);
    await test.mutation(api.rooms.end, {
      publicId,
      hostSecret,
      controllerId,
      expectedVersion: 0,
      clientActionId: requestId()
    });
    await expect(confirm(test, "jon", open)).rejects.toThrow(/no longer active/);
    await expect(propose(test, "maya", { kind: "bank" })).rejects.toThrow(/no longer active/);
    expect(await agreementRow(test, open)).toMatchObject({ status: "cancelled", closedReason: "ended" });
    expect(await agreementRow(test, bounced)).toMatchObject({ status: "cancelled", closedReason: "ended" });
  });

  it("prunes an old ended room's agreements with its other guest records", async () => {
    const { test, seats } = await createRoom();
    await confirm(test, "jon", await propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.jon }));
    await propose(test, "maya", { kind: "bank" });
    await test.mutation(api.rooms.end, {
      publicId,
      hostSecret,
      controllerId,
      expectedVersion: 1,
      clientActionId: requestId()
    });
    await test.run(async (ctx) => {
      const room = await ctx.db.query("rooms").first();
      await ctx.db.patch(room!._id, { lastActivityAt: Date.now() - ENDED_DETAIL_RETENTION_MS - 1000 });
    });
    await test.mutation(internal.rooms.runRoomLifecycle, {});
    expect(await test.run(async (ctx) => await ctx.db.query("roomAgreements").take(10))).toEqual([]);
  });

  it("expires an entry nobody answered within 30 minutes", async () => {
    vi.useFakeTimers();
    const { test, seats } = await createRoom();
    const late = await propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.jon });
    const unanswered = await propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.jon });
    vi.advanceTimersByTime(AGREEMENT_TTL_MS + 1000);
    // Answered after expiry (before the scheduled job ran): expired, not recorded.
    expect(await confirm(test, "jon", late)).toEqual({ status: "expired", reason: null });
    await test.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await agreementRow(test, unanswered))?.status).toBe("expired");
    expect((await guestView(test, "jon")).agreements.needsMe).toEqual([]);
    expect(agreedEntries((await hostView(test)).state as GameState)).toEqual([]);
  });

  it("only works while the host has players confirming each other", async () => {
    const { test, seats } = await createRoom({ peerConfirm: false });
    expect((await guestView(test, "maya")).peerConfirm).toBe(false);
    expect((await hostView(test)).peerConfirm).toBe(false);
    await expect(propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.jon })).rejects.toThrow(/Send the host a request/);

    await test.mutation(api.rooms.setPeerConfirm, { publicId, hostSecret, controllerId, on: true });
    expect((await guestView(test, "maya")).peerConfirm).toBe(true);
    const agreementId = await propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.jon });

    await test.mutation(api.rooms.setPeerConfirm, { publicId, hostSecret, controllerId, on: false });
    expect(await agreementRow(test, agreementId)).toMatchObject({ status: "cancelled", closedReason: "peer_confirm_off" });
    await expect(confirm(test, "jon", agreementId)).rejects.toThrow(/Send the host a request/);
    await expect(
      test.mutation(api.rooms.setPeerConfirm, { publicId, hostSecret: hostSecret.replace("host_a", "host_b"), controllerId, on: true })
    ).rejects.toThrow(/Host capability/);
  });
});

describe("peer agreements: the host", () => {
  it("answers for a seat with no phone, and for the host's own seat", async () => {
    const { test, seats } = await createRoom();
    const toPriya = await propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.priya });
    await test.mutation(api.rooms.setHostPlayer, { publicId, hostSecret, playerId: seats.alex });
    const toAlex = await propose(test, "jon", { kind: "buy", counterpartyPlayerId: seats.alex });
    const toJon = await propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.jon });

    const needs = (await hostView(test)).needsHost;
    expect(needs.answer.map((agreement) => [agreement.id, agreement.answerAs])).toEqual([
      [toPriya, "seat"],
      [toAlex, "self"]
    ]);
    expect(needs.answer.some((agreement) => agreement.id === toJon)).toBe(false);
    await expect(confirm(test, "jon", toPriya)).rejects.toThrow(/Only Priya/);

    expect(await hostAnswer(test, toPriya)).toEqual({ status: "recorded", reason: null });
    expect(await hostAnswer(test, toAlex)).toEqual({ status: "recorded", reason: null });
    const host = await hostView(test);
    const [priyaEntry, alexEntry] = agreedEntries(host.state as GameState);
    expect(priyaEntry).toMatchObject({ toPlayerId: seats.priya, confirmedVia: "host" });
    expect(priyaEntry!.confirmedByPlayerId).toBeUndefined();
    expect(alexEntry).toMatchObject({
      fromPlayerId: seats.alex,
      toPlayerId: seats.jon,
      confirmedByPlayerId: seats.alex,
      confirmedVia: "peer"
    });
    expect(host.activity.events.slice(0, 2).map((event) => event.actorLabel)).toEqual([
      "Jon · confirmed by Alex",
      "Maya · confirmed by the host"
    ]);
    // A stale controller tab can't answer.
    const other = await propose(test, "maya", { kind: "bank" });
    await expect(
      test.mutation(api.rooms.hostConfirmAgreement, {
        publicId,
        hostSecret,
        controllerId: "controller_someoneelse00",
        agreementId: other,
        answer: "confirm"
      })
    ).rejects.toThrow(/Another tab/);
  });

  it("can always witness a bank buy-in", async () => {
    const { test, seats } = await createRoom();
    const agreementId = await propose(test, "maya", { kind: "bank", witnessPlayerId: seats.jon });
    expect((await hostView(test)).needsHost.answer).toEqual([
      expect.objectContaining({ id: agreementId, answerAs: "bank" })
    ]);
    await hostAnswer(test, agreementId);
    const host = await hostView(test);
    expect(agreedEntries(host.state as GameState)[0]).toMatchObject({
      type: "bank_buy_in",
      toPlayerId: seats.maya,
      confirmedVia: "host"
    });
    expect(host.activity.events[0]!.actorLabel).toBe("Maya · seen by the host");
  });

  it("settles a bounced entry: Dismiss leaves it with the proposer, Record anyway records it", async () => {
    const { test, seats } = await createRoom();
    const recordIt = await propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.jon });
    const dismissIt = await propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.jon, amountCents: 500 });
    expect(await bounce(test, "jon", recordIt, "It was $10")).toEqual({ status: "bounced", reason: null });
    await bounce(test, "jon", dismissIt);
    // Bouncing twice changes nothing.
    expect(await bounce(test, "jon", recordIt)).toEqual({ status: "bounced", reason: null });

    expect((await guestView(test, "maya")).agreements.bounced).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: recordIt, bounceReason: "It was $10", bouncedByHost: false })])
    );
    expect((await hostView(test)).needsHost.bounced.map((agreement) => agreement.id).sort()).toEqual(
      [recordIt, dismissIt].sort()
    );

    await hostResolve(test, dismissIt, "dismiss");
    expect((await hostView(test)).needsHost.bounced.map((agreement) => agreement.id)).toEqual([recordIt]);
    expect((await guestView(test, "maya")).agreements.bounced.map((agreement) => agreement.id)).toContain(dismissIt);
    expect(
      await test.mutation(api.rooms.dismissAgreement, { publicId, guestSecret: secrets.maya, agreementId: dismissIt })
    ).toEqual({ status: "dismissed", reason: null });

    expect(await hostResolve(test, recordIt, "record")).toEqual({ status: "recorded", reason: null });
    const host = await hostView(test);
    expect(agreedEntries(host.state as GameState)).toEqual([
      expect.objectContaining({
        fromPlayerId: seats.maya,
        toPlayerId: seats.jon,
        proposedByPlayerId: seats.maya,
        confirmedVia: "host"
      })
    ]);
    expect(host.activity.events[0]!.actorLabel).toBe("Maya · recorded by the host");
    expect(host.needsHost.bounced).toEqual([]);
    expect((await guestView(test, "maya")).agreements.bounced).toEqual([]);
  });

  it("sends a host's Not right back to the proposer only", async () => {
    const { test, seats } = await createRoom();
    const agreementId = await propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.priya });
    expect(await hostAnswer(test, agreementId, "not_right")).toEqual({ status: "bounced", reason: null });
    expect((await guestView(test, "maya")).agreements.bounced).toEqual([
      expect.objectContaining({ id: agreementId, bouncedByHost: true })
    ]);
    expect((await hostView(test)).needsHost).toEqual({ answer: [], bounced: [] });
  });

  it("cancels instead of failing when a bounced entry no longer fits the game", async () => {
    const { test, seats } = await createRoom();
    const agreementId = await propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.jon });
    await bounce(test, "jon", agreementId);
    // The room has since reached its action limit.
    await test.run(async (ctx) => {
      const room = await ctx.db.query("rooms").first();
      await ctx.db.patch(room!._id, { acceptedActionCount: MAX_ROOM_ACTIONS });
    });
    expect(await hostResolve(test, agreementId, "record")).toEqual({ status: "cancelled", reason: "invalid" });
    expect(agreedEntries((await hostView(test)).state as GameState)).toEqual([]);
  });

  it("lets the proposer cancel an open entry, and no one else", async () => {
    const { test, seats } = await createRoom();
    const agreementId = await propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.jon });
    await expect(
      test.mutation(api.rooms.cancelAgreement, { publicId, guestSecret: secrets.jon, agreementId })
    ).rejects.toThrow(/Only the player who sent this/);
    expect(
      await test.mutation(api.rooms.cancelAgreement, { publicId, guestSecret: secrets.maya, agreementId })
    ).toEqual({ status: "cancelled", reason: "proposer" });
    expect(await confirm(test, "jon", agreementId)).toEqual({ status: "cancelled", reason: "proposer" });
    expect((await guestView(test, "jon")).agreements.needsMe).toEqual([]);
    expect(agreedEntries((await hostView(test)).state as GameState)).toEqual([]);
  });

  it("still lands a host action sent before an agreed entry, and voids but never undoes the entry", async () => {
    const { test, seats } = await createRoom();
    const before = (await hostView(test)).version;
    const agreementId = await propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.jon });
    await confirm(test, "jon", agreementId);

    // The host's tab still thinks the room is at `before`.
    const rebased = await hostAction(test, before, {
      type: "add_transaction",
      transaction: {
        id: "transaction_local",
        type: "bank_buy_in",
        createdAt: new Date().toISOString(),
        amountCents: 2000,
        toPlayerId: seats.alex
      }
    });
    expect(rebased.version).toBe(before + 2);
    const state = rebased.state as GameState;
    expect(state.transactions).toHaveLength(2);
    expect(state.transactions.filter((transaction) => transaction.agreementId)).toHaveLength(1);

    const agreed = agreedEntries(state)[0]!;
    const undo = (version: number) =>
      hostAction(test, version, {
        type: "undo_recent_transaction",
        action: { kind: "create", transactionId: agreed.id, occurredAt: agreed.createdAt }
      });
    // Undo is never rebased, and never removes an agreed entry.
    await expect(undo(before)).rejects.toThrow(/Room changed/);
    // Make the agreed entry the latest one again.
    const second = await propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.jon });
    await confirm(test, "jon", second);
    const latest = agreedEntries((await hostView(test)).state as GameState)[1]!;
    await expect(
      hostAction(test, (await hostView(test)).version, {
        type: "undo_recent_transaction",
        action: { kind: "create", transactionId: latest.id, occurredAt: latest.createdAt }
      })
    ).rejects.toThrow(/did not apply/);

    const voided = await hostAction(test, (await hostView(test)).version, {
      type: "void_transaction",
      transactionId: latest.id,
      reason: "Wrong amount"
    });
    expect((voided.state as GameState).transactions.find((transaction) => transaction.id === latest.id)?.voidedAt).toBeDefined();
    expect(
      (await guestView(test, "jon")).agreements.recentDone.find((agreement) => agreement.id === second)
    ).toMatchObject({ voided: true });
  });
});

async function joinOn(test: Test, guest: keyof typeof secrets, playerId: string) {
  return await test.mutation(api.rooms.join, { publicId, inviteSecret, guestSecret: secrets[guest], playerId });
}

describe("peer agreements: who answers is fixed when it is sent", () => {
  it("keeps a seat that had no phone host-only, even after a phone claims it", async () => {
    const { test, seats } = await createRoom({ seated: ["maya"] });
    const agreementId = await propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.jon, amountCents: 50_000 });
    // Maya opens a second browser and takes absent Jon's seat.
    await joinOn(test, "dev", seats.jon);
    expect((await guestView(test, "dev")).agreements.needsMe).toEqual([]);
    await expect(confirm(test, "dev", agreementId)).rejects.toThrow(/host answers for it/);
    await expect(bounce(test, "dev", agreementId)).rejects.toThrow(/host answers for it/);
    expect((await hostView(test)).needsHost.answer).toEqual([
      expect.objectContaining({ id: agreementId, answerAs: "seat" })
    ]);
    expect(await hostAnswer(test, agreementId)).toEqual({ status: "recorded", reason: null });
  });

  it("does the same for a named bank witness", async () => {
    const { test, seats } = await createRoom({ seated: ["maya", "jon"] });
    const agreementId = await propose(test, "maya", { kind: "bank", witnessPlayerId: seats.priya });
    await joinOn(test, "dev", seats.priya);
    await expect(confirm(test, "dev", agreementId)).rejects.toThrow(/host answers for it/);
    await expect(confirm(test, "jon", agreementId)).rejects.toThrow(/asked Priya/);
    expect(await hostAnswer(test, agreementId)).toMatchObject({ status: "recorded" });
  });

  it("lets only phones seated before an unnamed bank buy-in witness it", async () => {
    vi.useFakeTimers();
    const { test, seats } = await createRoom({ seated: ["maya", "jon"] });
    const agreementId = await propose(test, "maya", { kind: "bank" });
    vi.advanceTimersByTime(1000);
    await joinOn(test, "dev", seats.priya);
    expect((await guestView(test, "dev")).agreements.needsMe).toEqual([]);
    await expect(confirm(test, "dev", agreementId)).rejects.toThrow(/took your seat after/);
    expect((await guestView(test, "jon")).agreements.needsMe.map((agreement) => agreement.id)).toEqual([agreementId]);
    expect(await confirm(test, "jon", agreementId)).toMatchObject({ status: "recorded" });
  });
});

describe("peer agreements: released seats", () => {
  it("keeps a released seat closed to every phone until the host moves one there", async () => {
    const { test, seats } = await createRoom();
    const jonId = await guestId(test, "Jon");
    await test.mutation(api.rooms.releaseSeat, { publicId, hostSecret, guestId: jonId, playerId: seats.jon });
    // The released phone, rejoining with a fresh secret, can't take it back.
    await expect(joinOn(test, "dev", seats.jon)).rejects.toThrow(/host released that seat/);
    await expect(
      test.mutation(api.rooms.claimSeat, { publicId, guestSecret: secrets.jon, playerId: seats.jon })
    ).rejects.toThrow(/host released that seat/);
    const preview = await test.query(api.rooms.invitePreview, { publicId, inviteSecret });
    expect("seats" in preview && preview.seats?.find((seat) => seat.playerId === seats.jon)).toMatchObject({
      releasedByHost: true
    });

    await test.mutation(api.rooms.assignSeat, { publicId, hostSecret, guestId: jonId, playerId: seats.jon });
    expect((await guestView(test, "jon")).seatPlayerId).toBe(seats.jon);
    const after = await test.query(api.rooms.invitePreview, { publicId, inviteSecret });
    expect("seats" in after && after.seats?.find((seat) => seat.playerId === seats.jon)?.releasedByHost).toBeUndefined();
  });
});

describe("peer agreements: released seats, older rooms and new players", () => {
  it("honours a per-phone release from before releases covered the whole room", async () => {
    const { test, seats } = await createRoom();
    const jonId = await guestId(test, "Jon");
    // An older room: the release was stored on Jon's phone, not the room.
    await test.mutation(api.rooms.claimSeat, { publicId, guestSecret: secrets.jon, playerId: seats.dev });
    await test.run(async (ctx) => {
      await ctx.db.patch(jonId, { hostReleasedPlayerIds: [seats.jon] });
    });
    expect((await guestView(test, "jon")).seats.find((seat) => seat.playerId === seats.jon)).toMatchObject({
      releasedByHost: true
    });
    await expect(
      test.mutation(api.rooms.claimSeat, { publicId, guestSecret: secrets.jon, playerId: seats.jon })
    ).rejects.toThrow(/host released that seat/);
    // Other phones were never blocked by it.
    expect((await guestView(test, "maya")).seats.find((seat) => seat.playerId === seats.jon)?.releasedByHost).toBeUndefined();

    await test.mutation(api.rooms.assignSeat, { publicId, hostSecret, guestId: jonId, playerId: seats.jon });
    await test.mutation(api.rooms.claimSeat, { publicId, guestSecret: secrets.jon, playerId: seats.dev });
    await test.mutation(api.rooms.claimSeat, { publicId, guestSecret: secrets.jon, playerId: seats.jon });
    expect((await guestView(test, "jon")).seatPlayerId).toBe(seats.jon);
  });

  it("lifts a release when its player is renamed, as it is someone new", async () => {
    const { test, seats } = await createRoom();
    await test.mutation(api.rooms.releaseSeat, {
      publicId,
      hostSecret,
      guestId: await guestId(test, "Jon"),
      playerId: seats.jon
    });
    await hostAction(test, (await hostView(test)).version, { type: "rename_player", playerId: seats.jon, name: "Jonah" });
    expect((await hostView(test)).seats.find((seat) => seat.playerId === seats.jon)?.releasedByHost).toBeUndefined();
    await joinOn(test, "dev", seats.jon);
    expect((await guestView(test, "dev")).seatPlayerId).toBe(seats.jon);
  });
});

describe("peer agreements: entries aimed at a seat that changed", () => {
  it("keeps an entry the host answers when a phone that claimed the seat later is revoked", async () => {
    const { test, seats } = await createRoom();
    // Priya's seat has no phone, so the host answers this one.
    const hostOnly = await propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.priya });
    await joinOn(test, "priya", seats.priya);
    const toPriyasPhone = await propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.priya });

    await test.mutation(api.rooms.revokeGuest, { publicId, hostSecret, guestId: await guestId(test, "Priya") });
    expect(await agreementRow(test, toPriyasPhone)).toMatchObject({
      status: "cancelled",
      closedReason: "counterparty_seat_lost"
    });
    expect(await agreementRow(test, hostOnly)).toMatchObject({ status: "open" });
    expect((await hostView(test)).needsHost.answer.map((agreement) => agreement.id)).toEqual([hostOnly]);
    expect(await hostAnswer(test, hostOnly)).toMatchObject({ status: "recorded" });
  });


  it("cancels them when the seat is released, revoked, or its player renamed", async () => {
    const { test, seats } = await createRoom({ seated: ["maya", "jon", "priya"] });
    const toJon = await propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.jon });
    const seenByJon = await propose(test, "maya", { kind: "bank", witnessPlayerId: seats.jon });
    const toPriya = await propose(test, "maya", { kind: "buy", counterpartyPlayerId: seats.priya });
    const toDev = await propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.dev });
    const unrelated = await propose(test, "jon", { kind: "give", counterpartyPlayerId: seats.maya });

    await test.mutation(api.rooms.releaseSeat, {
      publicId,
      hostSecret,
      guestId: await guestId(test, "Jon"),
      playerId: seats.jon
    });
    await test.mutation(api.rooms.revokeGuest, { publicId, hostSecret, guestId: await guestId(test, "Priya") });
    // Dev's seat had no phone; renaming the player still changes who it is.
    await hostAction(test, (await hostView(test)).version, { type: "rename_player", playerId: seats.dev, name: "Devon" });

    for (const agreementId of [toJon, seenByJon, toPriya, toDev]) {
      expect(await agreementRow(test, agreementId)).toMatchObject({
        status: "cancelled",
        closedReason: "counterparty_seat_lost"
      });
    }
    // Jon's own proposal was cancelled for losing his seat.
    expect(await agreementRow(test, unrelated)).toMatchObject({ status: "cancelled", closedReason: "seat_lost" });
  });
});

describe("peer agreements: bounded lists and rates", () => {
  it("lists bounced entries newest first, and dismissed ones leave the host's list", async () => {
    vi.useFakeTimers();
    const { test, seats } = await createRoom();
    const ids = [];
    for (let index = 0; index < 3; index += 1) {
      const agreementId = await propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.jon });
      vi.advanceTimersByTime(1000);
      await bounce(test, "jon", agreementId);
      ids.push(agreementId);
    }
    expect((await hostView(test)).needsHost.bounced.map((agreement) => agreement.id)).toEqual([...ids].reverse());
    expect(await hostResolve(test, ids[1]!, "dismiss")).toEqual({ status: "bounced", reason: null });
    expect((await hostView(test)).needsHost.bounced.map((agreement) => agreement.id)).toEqual([ids[2], ids[0]]);
    // Record anyway is only for entries still waiting on the host.
    expect(await hostResolve(test, ids[1]!, "record")).toEqual({ status: "bounced", reason: null });
    expect(agreedEntries((await hostView(test)).state as GameState)).toEqual([]);
    const mine = (await guestView(test, "maya")).agreements.bounced;
    expect(mine.map((agreement) => agreement.id).sort()).toEqual([...ids].sort());
    expect(mine.every((agreement) => agreement.status === "bounced")).toBe(true);
    // Bounced (and host-dismissed) entries count toward the proposer's cap.
    for (let index = 0; index < 7; index += 1) {
      await bounce(test, "jon", await propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.jon }));
    }
    await expect(propose(test, "maya", { kind: "bank" })).rejects.toThrow(/Clear your bounced/);
  });

  it("rate-limits proposals per guest, but not retries", async () => {
    const { test, seats } = await createRoom();
    let last: Id<"roomAgreements"> | null = null;
    const clientRequestId = requestId();
    for (let index = 0; index < 10; index += 1) {
      last = await propose(test, "maya", {
        kind: "give",
        counterpartyPlayerId: seats.jon,
        ...(index === 9 ? { clientRequestId } : {})
      });
      await test.mutation(api.rooms.cancelAgreement, { publicId, guestSecret: secrets.maya, agreementId: last });
    }
    await expect(propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.jon })).rejects.toThrow(/sending entries quickly/);
    expect(await propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.jon, clientRequestId })).toBe(last);
    await propose(test, "jon", { kind: "give", counterpartyPlayerId: seats.maya });
  });
});

describe("peer agreements: host controls", () => {
  it("closes an idle room's agreements when the lifecycle job expires it", async () => {
    vi.useFakeTimers();
    const { test, seats } = await createRoom();
    const open = await propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.jon });
    const bounced = await propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.jon });
    await bounce(test, "jon", bounced);
    await test.run(async (ctx) => {
      const room = await ctx.db.query("rooms").first();
      await ctx.db.patch(room!._id, { lastActivityAt: Date.now() - ACTIVE_ROOM_IDLE_MS - 1000 });
    });
    await test.mutation(internal.rooms.runRoomLifecycle, {});
    await test.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await hostView(test)).status).toBe("expired");
    expect(await agreementRow(test, open)).toMatchObject({ status: "cancelled", closedReason: "ended" });
    expect(await agreementRow(test, bounced)).toMatchObject({ status: "cancelled", closedReason: "ended" });
  });

  it("needs the controlling tab to toggle, and keeps Record anyway after the mode is off", async () => {
    const { test, seats } = await createRoom();
    await expect(
      test.mutation(api.rooms.setPeerConfirm, {
        publicId,
        hostSecret,
        controllerId: "controller_someoneelse00",
        on: false
      })
    ).rejects.toThrow(/Another tab/);
    const agreementId = await propose(test, "maya", { kind: "give", counterpartyPlayerId: seats.jon });
    await bounce(test, "jon", agreementId);
    await test.mutation(api.rooms.setPeerConfirm, { publicId, hostSecret, controllerId, on: false });
    expect((await hostView(test)).needsHost.bounced.map((agreement) => agreement.id)).toEqual([agreementId]);
    expect(await hostResolve(test, agreementId, "record")).toEqual({ status: "recorded", reason: null });
  });
});
