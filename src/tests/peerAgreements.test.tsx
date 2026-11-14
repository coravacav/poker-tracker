import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { HostAgreementNeeds } from "../components/HostAgreementNeeds";
import { ChipsTab, chipsQuickAmounts } from "../components/guestPlay/ChipsTab";
import { InboxTab } from "../components/guestPlay/InboxTab";
import { settleLaterBalances } from "../domain/ledger";
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
  it("offers half, one, and two buy-ins, or fixed amounts without a default buy-in", () => {
    expect(chipsQuickAmounts(2000)).toEqual([1000, 2000, 4000]);
    expect(chipsQuickAmounts(0)).toEqual([500, 1000, 2000, 5000]);
  });

  it("lists the other players, not you, and sends a give for the other player to confirm", async () => {
    const onSend = renderChips();
    const picker = screen.getByRole("group", { name: "Player" });
    expect(within(picker).queryByRole("button", { name: /Maya/ })).not.toBeInTheDocument();
    expect(screen.getByText("Pick who and how much.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send to confirm" })).toBeDisabled();

    fireEvent.click(within(picker).getByRole("button", { name: /Jon/ }));
    fireEvent.click(screen.getByRole("button", { name: "$20" }));
    expect(screen.getByText("You give Jon $20 in chips. Jon will owe you $20 at settle-up.")).toBeInTheDocument();
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

  it("sends a buy, saying who owes whom, and the host confirms for a seat with no phone", async () => {
    const onSend = renderChips();
    fireEvent.click(screen.getByRole("button", { name: "Buy from" }));
    fireEvent.click(screen.getByRole("button", { name: /Dev/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Amount" }), { target: { value: "15" } });
    expect(screen.getByText("You get $15 in chips from Dev. You'll owe Dev $15 at settle-up.")).toBeInTheDocument();
    expect(screen.getByText(/Dev has no phone here, so nothing is recorded until the host confirms/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send to Dev to confirm" }));
    });
    expect(onSend.mock.calls[0]![0]).toMatchObject({ kind: "buy", amountCents: 1500, counterpartyPlayerId: dev.id });
  });

  it("sends a bank buy-in with or without a witness", async () => {
    const onSend = renderChips();
    fireEvent.click(screen.getByRole("button", { name: "From bank" }));
    fireEvent.click(screen.getByRole("button", { name: "$40" }));
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
    fireEvent.click(screen.getByRole("button", { name: /Jon/ }));
    fireEvent.click(screen.getByRole("button", { name: "$20" }));
    const send = screen.getByRole("button", { name: "Send to Jon to confirm" });
    await act(async () => {
      fireEvent.click(send);
    });
    await act(async () => {
      fireEvent.click(send);
    });
    fireEvent.click(screen.getByRole("button", { name: "$40" }));
    await act(async () => {
      fireEvent.click(send);
    });
    const ids = onSend.mock.calls.map(([proposal]) => proposal.clientRequestId);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
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
      />
    );
    expect(screen.getByRole("button", { name: "Buy from" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "Amount" })).toHaveValue("10");
    expect(screen.getByText("You get $10 in chips from Jon. You'll owe Jon $10 at settle-up.")).toBeInTheDocument();
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
    expect(within(card).getByText("From Jon · Buy")).toBeInTheDocument();
    expect(within(card).getByText(/Jon will owe you \$20 at settle-up\./)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(card).getByRole("button", { name: "Confirm" }));
    });
    expect(handlers.onAnswer).toHaveBeenCalledWith("agreement_1", "confirm");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
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
    expect(within(seatItem).getByText("for Dev (no phone)")).toBeInTheDocument();
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

describe("settle-later balances", () => {
  const tx = (overrides: Partial<Transaction>): Transaction => ({
    id: `t_${Math.random()}`,
    type: "player_gave",
    createdAt: "2026-05-10T00:00:00.000Z",
    amountCents: 2000,
    ...overrides
  });

  it("nets what each other player and you owe each other, leaving out voided entries and even pairs", () => {
    const balances = settleLaterBalances(maya.id, [
      tx({ fromPlayerId: jon.id, toPlayerId: maya.id }),
      tx({ fromPlayerId: maya.id, toPlayerId: dev.id, amountCents: 1500 }),
      tx({ fromPlayerId: maya.id, toPlayerId: priya.id }),
      tx({ fromPlayerId: priya.id, toPlayerId: maya.id }),
      tx({ fromPlayerId: dev.id, toPlayerId: maya.id, voidedAt: "2026-05-10T00:05:00.000Z" }),
      tx({ type: "player_owes", fromPlayerId: maya.id, toPlayerId: jon.id, amountCents: 500 })
    ]);
    expect(Object.fromEntries(balances)).toEqual({ [jon.id]: -2500, [dev.id]: 1500 });
  });
});
