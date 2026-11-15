import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { HostAgreementNeeds } from "../components/HostAgreementNeeds";
import { ChipsTab, chipsQuickAmounts, createChipsRequestIds } from "../components/guestPlay/ChipsTab";
import { agreementSettleLine, closedNotice } from "../components/guestPlay/agreementText";
import { InboxTab } from "../components/guestPlay/InboxTab";
import { playerChipMoves } from "../domain/ledger";
import type { Player, PlayerLedgerSummary, Transaction } from "../domain/pokerTypes";
import type { AgreementResult, GuestAgreements, RoomAgreement, SeatOption } from "../session/types";

const players: Player[] = ["Maya", "Jon", "Priya", "Dev"].map((name, seatIndex) => ({
  id: `player_${name.toLowerCase()}`,
  name,
  seatIndex,
  isActive: true
}));
const [maya, jon, priya, dev] = players as [Player, Player, Player, Player];
const seats: SeatOption[] = [
  { playerId: maya.id, name: "Maya", claimed: true, isHost: false },
  { playerId: jon.id, name: "Jon", claimed: true, isHost: false },
  { playerId: priya.id, name: "Priya", claimed: false, isHost: true },
  { playerId: dev.id, name: "Dev", claimed: false, isHost: false }
];

type Send = ComponentProps<typeof ChipsTab>["onSend"];
const sendMock = (sent: boolean) => vi.fn<Send>(async () => sent);

function renderChips(onSend = sendMock(true), defaultBuyInCents = 2000) {
  render(
    <ChipsTab
      me={maya}
      players={players}
      summaryByPlayerId={new Map<string, PlayerLedgerSummary>()}
      seats={seats}
      defaultBuyInCents={defaultBuyInCents}
      ended={false}
      notice={null}
      onSend={onSend}
      onAskHost={vi.fn()}
      requestIds={createChipsRequestIds()}
    />
  );
  return onSend;
}

function agreement(overrides: Partial<RoomAgreement> = {}): RoomAgreement {
  return {
    id: "agreement_1" as Id<"roomAgreements">,
    kind: "give",
    amountCents: 2000,
    note: null,
    proposerPlayerId: jon.id,
    proposerName: "Jon",
    counterpartyPlayerId: maya.id,
    counterpartyName: "Maya",
    witnessPlayerId: null,
    witnessName: null,
    status: "open",
    closedReason: null,
    bounceReason: null,
    bouncedByHost: false,
    createdAt: Date.now() - 60_000,
    expiresAt: Date.now() + 29 * 60_000,
    decidedAt: null,
    confirmedByPlayerId: null,
    confirmedByName: null,
    confirmedVia: null,
    transactionId: null,
    voided: false,
    ...overrides
  };
}

const empty: GuestAgreements = { needsMe: [], mine: [], bounced: [], recentDone: [] };

function renderInbox(agreements: Partial<GuestAgreements>, result: AgreementResult | null = null) {
  const handlers = {
    onAnswer: vi.fn(async () => result),
    onCancel: vi.fn(async () => result),
    onDismiss: vi.fn(async () => result),
    onResend: vi.fn()
  };
  render(<InboxTab seatPlayerId={maya.id} agreements={{ ...empty, ...agreements }} notice={null} {...handlers} />);
  return handlers;
}

describe("Chips", () => {
  it("offers 1/4, 1/2, 1, and 2 buy-ins, or fixed amounts without a default buy-in", () => {
    expect(chipsQuickAmounts(2000)).toEqual([
      { cents: 500, label: "1/4 buy-in" },
      { cents: 1000, label: "1/2 buy-in" },
      { cents: 2000, label: "1 buy-in" },
      { cents: 4000, label: "2 buy-ins" }
    ]);
    expect(chipsQuickAmounts(0).map(({ cents }) => cents)).toEqual([500, 1000, 2000, 5000]);
    // Tiny buy-ins don't repeat an amount.
    expect(chipsQuickAmounts(2).map(({ cents }) => cents)).toEqual([1, 2, 4]);
  });

  it("starts on Buy in, first, with the amount before the witness", () => {
    renderChips();
    const kinds = within(screen.getByRole("group", { name: "Entry type" })).getAllByRole("button");
    expect(kinds.map((button) => button.textContent)).toEqual(["Buy in", "Give to", "Buy from"]);
    expect(kinds[0]).toHaveAttribute("aria-pressed", "true");
    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual(["How much?", "Who saw it?"]);
    expect(screen.getByRole("button", { name: "1/4 buy-in $5" })).toBeInTheDocument();
  });

  it("lists the other players, not you, and sends a give for the other player to confirm", async () => {
    const onSend = renderChips();
    fireEvent.click(screen.getByRole("button", { name: "Give to" }));
    const picker = screen.getByRole("group", { name: "Player" });
    expect(within(picker).queryByRole("button", { name: /Maya/ })).not.toBeInTheDocument();
    expect(screen.getByText("Pick who and how much.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send to confirm" })).toBeDisabled();

    fireEvent.click(within(picker).getByRole("button", { name: /Jon/ }));
    fireEvent.click(screen.getByRole("button", { name: "1 buy-in $20" }));
    expect(screen.getByText("You give Jon $20 in chips. You'll get that back at settle-up.")).toBeInTheDocument();
    expect(screen.getByText("Nothing is recorded until Jon confirms.")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send to Jon to confirm" }));
    });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0]![0]).toEqual({
      kind: "give",
      amountCents: 2000,
      counterpartyPlayerId: jon.id,
      clientRequestId: expect.stringMatching(/^chips_/)
    });
  });

  it("sends a buy, saying who pays for the chips, and the host confirms for a seat with no phone", async () => {
    const onSend = renderChips();
    fireEvent.click(screen.getByRole("button", { name: "Buy from" }));
    fireEvent.click(screen.getByRole("button", { name: /Dev/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Amount" }), { target: { value: "15" } });
    expect(screen.getByText("You get $15 in chips from Dev. You'll pay for them at settle-up.")).toBeInTheDocument();
    expect(screen.getByText(/Dev has no phone here, so nothing is recorded until the host confirms/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send to Dev to confirm" }));
    });
    expect(onSend.mock.calls[0]![0]).toMatchObject({ kind: "buy", amountCents: 1500, counterpartyPlayerId: dev.id });
  });

  it("sends a bank buy-in with or without a witness", async () => {
    const onSend = renderChips();
    fireEvent.click(screen.getByRole("button", { name: "2 buy-ins $40" }));
    expect(screen.getByText("You buy $40 in chips from the bank.")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Ask for a witness" }));
    });
    expect(onSend.mock.calls[0]![0]).toEqual({ kind: "bank", amountCents: 4000, clientRequestId: expect.any(String) });
    expect(onSend.mock.calls[0]![0]).not.toHaveProperty("witnessPlayerId");

    fireEvent.click(within(screen.getByRole("group", { name: "Witness" })).getByRole("button", { name: "Priya" }));
    expect(screen.getByText("Nothing is recorded until Priya says they saw it.")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Ask Priya to confirm" }));
    });
    expect(onSend.mock.calls[1]![0]).toMatchObject({ kind: "bank", amountCents: 4000, witnessPlayerId: priya.id });
  });

  it("retries a failed send with the same request id, and a changed entry with a new one", async () => {
    const onSend = renderChips(sendMock(false));
    fireEvent.click(screen.getByRole("button", { name: "Give to" }));
    fireEvent.click(screen.getByRole("button", { name: /Jon/ }));
    fireEvent.click(screen.getByRole("button", { name: "1 buy-in $20" }));
    const send = screen.getByRole("button", { name: "Send to Jon to confirm" });
    await act(async () => {
      fireEvent.click(send);
    });
    await act(async () => {
      fireEvent.click(send);
    });
    fireEvent.click(screen.getByRole("button", { name: "2 buy-ins $40" }));
    await act(async () => {
      fireEvent.click(send);
    });
    const ids = onSend.mock.calls.map(([proposal]) => proposal.clientRequestId);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
  });

  it("asks to pick again when the witness or player picked has left the table", async () => {
    const onSend = sendMock(true);
    const { rerender } = render(
      <ChipsTab
        me={maya}
        players={players.filter((player) => player.id !== priya.id)}
        summaryByPlayerId={new Map()}
        seats={seats}
        defaultBuyInCents={2000}
        ended={false}
        notice={null}
        initialDraft={{ kind: "bank", witnessPlayerId: priya.id, amountCents: 4000 }}
        onSend={onSend}
        onAskHost={vi.fn()}
        requestIds={createChipsRequestIds()}
      />
    );
    expect(screen.getByRole("status")).toHaveTextContent("isn’t at the table any more. Pick who saw it.");
    // Never quietly "anyone".
    expect(screen.getByRole("button", { name: "Anyone at the table" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Ask for a witness" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Anyone at the table" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Ask for a witness" }));
    });
    expect(onSend.mock.calls[0]![0]).not.toHaveProperty("witnessPlayerId");

    rerender(
      <ChipsTab
        key="give"
        me={maya}
        players={players.filter((player) => player.id !== jon.id)}
        summaryByPlayerId={new Map()}
        seats={seats}
        defaultBuyInCents={2000}
        ended={false}
        notice={null}
        initialDraft={{ kind: "give", counterpartyPlayerId: jon.id, amountCents: 2000 }}
        onSend={onSend}
        onAskHost={vi.fn()}
        requestIds={createChipsRequestIds()}
      />
    );
    expect(screen.getByRole("status")).toHaveTextContent("The player you picked isn’t at the table any more. Pick again.");
    expect(screen.getByRole("button", { name: "Send to confirm" })).toBeDisabled();
  });

  it("moves focus to the form when opened to resend an entry", () => {
    render(
      <ChipsTab
        me={maya}
        players={players}
        summaryByPlayerId={new Map()}
        seats={seats}
        defaultBuyInCents={2000}
        ended={false}
        notice={null}
        initialDraft={{ kind: "buy", counterpartyPlayerId: jon.id, amountCents: 1000, resendOf: "agreement_1" as never }}
        focusOnOpen
        onSend={sendMock(true)}
        onAskHost={vi.fn()}
        requestIds={createChipsRequestIds()}
      />
    );
    expect(screen.getByRole("heading", { name: "Buy from who?" })).toHaveFocus();
  });

  it("starts from a bounced entry being resent", () => {
    render(
      <ChipsTab
        me={maya}
        players={players}
        summaryByPlayerId={new Map()}
        seats={seats}
        defaultBuyInCents={2000}
        ended={false}
        notice={null}
        initialDraft={{ kind: "buy", counterpartyPlayerId: jon.id, amountCents: 1000 }}
        onSend={vi.fn(async () => true)}
        onAskHost={vi.fn()}
        requestIds={createChipsRequestIds()}
      />
    );
    expect(screen.getByRole("button", { name: "Buy from" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "Amount" })).toHaveValue("10");
    expect(screen.getByText("You get $10 in chips from Jon. You'll pay for them at settle-up.")).toBeInTheDocument();
  });
});

describe("Inbox", () => {
  it("is calm when nothing is waiting", () => {
    renderInbox({});
    expect(screen.getByText("Nothing waiting on you.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Waiting on others" })).not.toBeInTheDocument();
  });

  it("confirms or turns back an entry waiting on you, saying what it means", async () => {
    const handlers = renderInbox({ needsMe: [agreement({ kind: "buy" })] }, { status: "recorded", reason: null });
    const card = screen.getByRole("article", { name: "Jon bought $20 in chips from you" });
    expect(within(card).getByText("From Jon · Buy from")).toBeInTheDocument();
    expect(within(card).getByText(/You'll get that back at settle-up\./)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(card).getByRole("button", { name: "Confirm" }));
    });
    expect(handlers.onAnswer).toHaveBeenCalledWith("agreement_1", "confirm");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("asks a witness about a bank buy-in, and says so when someone else answered first", async () => {
    const handlers = renderInbox(
      { needsMe: [agreement({ kind: "bank", proposerName: "Priya", proposerPlayerId: priya.id, counterpartyPlayerId: null, counterpartyName: null })] },
      { status: "recorded", reason: null }
    );
    const card = screen.getByRole("article", { name: "Priya bought $20 in chips from the bank" });
    expect(within(card).getByText(/Any player can confirm/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(card).getByRole("button", { name: "I didn't see it" }));
    });
    expect(handlers.onAnswer).toHaveBeenCalledWith("agreement_1", "not_right");
    expect(screen.getByRole("status")).toHaveTextContent("Someone already confirmed that one.");
  });

  it("greys out an expired entry, without actions or a count", () => {
    renderInbox({ needsMe: [agreement({ expiresAt: Date.now() - 1000 })], mine: [agreement({ id: "agreement_2" as never, expiresAt: Date.now() - 1000, proposerPlayerId: maya.id, proposerName: "Maya", counterpartyPlayerId: jon.id, counterpartyName: "Jon" })] });
    const card = screen.getByRole("article", { name: "Jon gave you $20 in chips" });
    expect(card).toHaveClass("is-expired");
    expect(within(card).getByText("Expired")).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("heading", { name: "Needs you" }).parentElement!).queryByText("1")).not.toBeInTheDocument();
  });

  it("says the host answers an entry for a seat that had no phone", () => {
    const mine = agreement({
      id: "agreement_mine" as never,
      proposerPlayerId: maya.id,
      proposerName: "Maya",
      counterpartyPlayerId: dev.id,
      counterpartyName: "Dev",
      hostAnswers: true
    });
    renderInbox({ mine: [mine] });
    expect(screen.getByText(/waiting on the host/)).toBeInTheDocument();
  });

  it("cancels your own open entry, and dismisses or resends a bounced one", async () => {
    const mine = agreement({ id: "agreement_mine" as never, proposerPlayerId: maya.id, proposerName: "Maya", counterpartyPlayerId: jon.id, counterpartyName: "Jon" });
    const bounced = agreement({
      id: "agreement_bounced" as never,
      kind: "buy",
      status: "bounced",
      proposerPlayerId: maya.id,
      proposerName: "Maya",
      counterpartyPlayerId: dev.id,
      counterpartyName: "Dev"
    });
    const handlers = renderInbox({ mine: [mine], bounced: [bounced] }, { status: "cancelled", reason: "proposer" });
    expect(screen.getByText("You gave Jon $20 in chips")).toBeInTheDocument();
    expect(screen.getByText(/waiting on Jon/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });
    expect(handlers.onCancel).toHaveBeenCalledWith("agreement_mine");

    expect(screen.getByText("Dev said not right")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit & resend" }));
    expect(handlers.onResend).toHaveBeenCalledWith(bounced);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    });
    expect(handlers.onDismiss).toHaveBeenCalledWith("agreement_bounced");
  });

  it("lists done entries with who confirmed them", () => {
    renderInbox({
      recentDone: [
        agreement({ status: "recorded", kind: "buy", confirmedByPlayerId: maya.id, confirmedByName: "Maya", confirmedVia: "peer" }),
        agreement({
          id: "agreement_2" as never,
          status: "recorded",
          kind: "bank",
          proposerPlayerId: maya.id,
          proposerName: "Maya",
          counterpartyPlayerId: null,
          counterpartyName: null,
          confirmedByPlayerId: priya.id,
          confirmedByName: "Priya",
          confirmedVia: "peer"
        })
      ]
    });
    expect(screen.getByText(/you confirmed ·/)).toBeInTheDocument();
    expect(screen.getByText("You bought $20 in chips from the bank")).toBeInTheDocument();
    expect(screen.getByText(/seen by Priya ·/)).toBeInTheDocument();
  });
});

describe("host Needs you", () => {
  it("answers for a seat with no phone, the host's seat, and a bank buy-in, and settles disputes", async () => {
    const onAnswer = vi.fn(async () => ({ status: "recorded" as const, reason: null }));
    const onResolve = vi.fn(async () => ({ status: "recorded" as const, reason: null }));
    render(
      <HostAgreementNeeds
        hostPlayerId={priya.id}
        needs={{
          answer: [
            { ...agreement({ counterpartyPlayerId: dev.id, counterpartyName: "Dev" }), answerAs: "seat" },
            { ...agreement({ id: "agreement_self" as never, counterpartyPlayerId: priya.id, counterpartyName: "Priya" }), answerAs: "self" },
            {
              ...agreement({ id: "agreement_bank" as never, kind: "bank", counterpartyPlayerId: null, counterpartyName: null }),
              answerAs: "bank"
            },
            { ...agreement({ id: "agreement_old" as never, expiresAt: Date.now() - 1 }), answerAs: "seat" }
          ],
          bounced: [
            agreement({
              id: "agreement_bounced" as never,
              kind: "buy",
              status: "bounced",
              proposerPlayerId: maya.id,
              proposerName: "Maya",
              counterpartyPlayerId: dev.id,
              counterpartyName: "Dev"
            })
          ]
        }}
        onAnswer={onAnswer}
        onResolve={onResolve}
      />
    );
    const section = screen.getByRole("region", { name: /Needs you/ });
    // The expired entry is left out of the list and the count.
    expect(within(section).getByText("4")).toBeInTheDocument();
    const seatItem = within(section).getByRole("article", { name: "Jon gave Dev $20 in chips" });
    expect(within(seatItem).getByText("for Dev (no phone when sent)")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(seatItem).getByRole("button", { name: "Confirm" }));
    });
    expect(onAnswer).toHaveBeenCalledWith("agreement_1", "confirm");

    const selfItem = within(section).getByRole("article", { name: "Jon gave you $20 in chips" });
    expect(within(selfItem).getByText("as you")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(selfItem).getByRole("button", { name: "Not right" }));
    });
    expect(onAnswer).toHaveBeenCalledWith("agreement_self", "not_right");
    expect(screen.getByRole("status")).toHaveTextContent("Someone already confirmed that one.");

    const bankItem = within(section).getByRole("article", { name: "Jon bought $20 in chips from the bank" });
    expect(within(bankItem).getByText("bank buy-in")).toBeInTheDocument();
    expect(within(bankItem).getByRole("button", { name: "I saw it" })).toBeInTheDocument();

    const bounced = within(section).getByRole("article", { name: "Dev said not right" });
    expect(bounced).toHaveTextContent("Maya bought $20 in chips from Dev");
    await act(async () => {
      fireEvent.click(within(bounced).getByRole("button", { name: "Record anyway" }));
    });
    expect(onResolve).toHaveBeenCalledWith("agreement_bounced", "record");
    await act(async () => {
      fireEvent.click(within(bounced).getByRole("button", { name: "Dismiss" }));
    });
    expect(onResolve).toHaveBeenCalledWith("agreement_bounced", "dismiss");
  });
});

describe("a player's chip moves", () => {
  const tx = (overrides: Partial<Transaction>): Transaction => ({
    id: `t_${Math.random()}`,
    type: "player_gave",
    createdAt: "2026-05-10T00:00:00.000Z",
    amountCents: 2000,
    ...overrides
  });

  it("lists bank buy-ins, covered buy-ins, and chips to and from players as facts, leaving out debts and voids", () => {
    const moves = playerChipMoves(maya.id, [
      tx({ type: "bank_buy_in", toPlayerId: maya.id }),
      tx({ type: "bank_buy_in", toPlayerId: maya.id, amountCents: 2000 }),
      tx({ type: "bank_buy_in", toPlayerId: maya.id, coveredByPlayerId: priya.id, amountCents: 1000 }),
      tx({ fromPlayerId: jon.id, toPlayerId: maya.id }),
      tx({ fromPlayerId: maya.id, toPlayerId: dev.id, amountCents: 1500 }),
      tx({ fromPlayerId: dev.id, toPlayerId: maya.id, voidedAt: "2026-05-10T00:05:00.000Z" }),
      tx({ type: "player_owes", fromPlayerId: maya.id, toPlayerId: jon.id, amountCents: 500 }),
      tx({ type: "debt_coverage", coveredPlayerId: maya.id, coveredByPlayerId: jon.id, amountCents: 700 }),
      // Someone else's buy-in Maya paid for isn't a chip move of hers.
      tx({ type: "bank_buy_in", toPlayerId: jon.id, coveredByPlayerId: maya.id })
    ]);
    expect(moves).toEqual([
      { kind: "bank", amountCents: 4000 },
      { kind: "covered", amountCents: 1000, otherPlayerId: priya.id },
      { kind: "got", amountCents: 2000, otherPlayerId: jon.id },
      { kind: "gave", amountCents: 1500, otherPlayerId: dev.id }
    ]);
  });
});

describe("settle-up wording", () => {
  it("never says who pays whom, only that taken chips are paid for and given ones come back", () => {
    renderInbox({
      needsMe: [agreement({ kind: "give" }), agreement({ id: "agreement_buy" as never, kind: "buy" })]
    });
    // Jon gave Maya chips: she pays for them. Jon bought from Maya: she gets them back.
    expect(within(screen.getByRole("article", { name: "Jon gave you $20 in chips" })).getByText(/You'll pay for them at settle-up\./)).toBeInTheDocument();
    expect(within(screen.getByRole("article", { name: "Jon bought $20 in chips from you" })).getByText(/You'll get that back at settle-up\./)).toBeInTheDocument();
    expect(screen.queryByText(/owe/)).not.toBeInTheDocument();
    // Someone else (the host) reads who pays for the chips, not whom they pay.
    expect(agreementSettleLine(agreement({ kind: "give" }), null)).toBe("Maya pays for them at settle-up.");
    expect(agreementSettleLine(agreement({ kind: "buy" }), null)).toBe("Jon pays for them at settle-up.");
  });

  it("tells the host a Record anyway found the entry already dismissed", () => {
    expect(closedNotice({ status: "bounced", reason: null }, "recorded", "resolve")).toBe(
      "That entry was already dismissed and sent back to the player."
    );
    expect(closedNotice({ status: "bounced", reason: null }, "recorded", "answer")).toBe(
      "Someone already said that one wasn't right."
    );
  });
});
