import { ArrowUpRight, ChevronRight, Clock, Landmark } from "lucide-react";
import { useMemo } from "react";
import { playerChipMoves } from "../../domain/ledger";
import type { GameState, Player } from "../../domain/pokerTypes";
import { playerNameById } from "../../domain/settlement";
import type { SharedAuditEvent } from "../../session/types";
import { BankSummaryPanel } from "../BankSummary";
import { ChipKey } from "../ChipKey";
import { useFormatCurrency } from "../CurrencyContext";
import type { LedgerOverview } from "../gameApp/useLedgerOverview";
import { PokerTable } from "../PokerTable";
import { SpectatorFeed } from "../spectator/SpectatorFeed";

type GuestTableTabProps = {
  state: GameState;
  me: Player;
  notice: string | null;
  activePlayers: LedgerOverview["activePlayers"];
  bankSummary: LedgerOverview["bankSummary"];
  cashedOutPlayerIds: LedgerOverview["cashOutOverview"]["completedPlayerIds"];
  imbalanceCents: number;
  summaryByPlayerId: LedgerOverview["summaryByPlayerId"];
  settleAvailable: boolean;
  waitingOnMe: number;
  events: SharedAuditEvent[];
  live: boolean;
  onOpenChips: (kind: "give" | "bank") => void;
  onOpenInbox: () => void;
  onOpenSettle: () => void;
  onOpenAudit: () => void;
};

// The guest's table is read-only: its controls are hidden and inert.
const ignoreAction = () => undefined;
const refuseTransaction = () => false;

/** "You" at the top of Table: your chip moves as facts, and your standing once it means something. */
function YouCard({
  state,
  me,
  netCents,
  cashedOut,
  settleAvailable,
  onOpenChips,
  onOpenSettle
}: Pick<GuestTableTabProps, "state" | "me" | "settleAvailable" | "onOpenChips" | "onOpenSettle"> & {
  netCents: number;
  cashedOut: boolean;
}) {
  const formatCurrency = useFormatCurrency();
  const format = (cents: number) => formatCurrency(cents, { trimWholeCents: true });
  const moves = useMemo(() => playerChipMoves(me.id, state.transactions), [me.id, state.transactions]);
  const name = (playerId: string | undefined) => (playerId ? playerNameById(state.players, playerId) : "another player");
  const lines = moves.map((move) =>
    move.kind === "bank"
      ? `${format(move.amountCents)} from the bank`
      : move.kind === "covered"
        ? `${format(move.amountCents)} from the bank, paid by ${name(move.otherPlayerId)}`
        : move.kind === "got"
          ? `Bought ${format(move.amountCents)} from ${name(move.otherPlayerId)}`
          : `Gave ${format(move.amountCents)} to ${name(move.otherPlayerId)}`
  );
  // Before the final count the net leaves out the chips you hold, so it is what
  // you're in for; once counted it is your result.
  const standing = cashedOut
    ? netCents > 0
      ? `Up ${format(netCents)}`
      : netCents < 0
        ? `Down ${format(-netCents)}`
        : "Even"
    : netCents < 0
      ? `In for ${format(-netCents)}`
      : null;

  return (
    <section className="panel guest-you-card" aria-label="You">
      <div className="guest-you-heading">
        <span className="guest-you-badge">You</span>
        <h2>{me.name}</h2>
        {standing ? <strong>{standing}</strong> : null}
      </div>
      {lines.length > 0 ? (
        <ul className="guest-you-balances" aria-label="Your chips">
          {lines.map((line) => <li key={line}>{line}</li>)}
        </ul>
      ) : (
        <p className="muted">No chips in or out yet.</p>
      )}
      {settleAvailable ? (
        <button className="text-button guest-you-settle" type="button" onClick={onOpenSettle}>
          See who pays whom <ChevronRight size={16} aria-hidden="true" />
        </button>
      ) : null}
      <div className="guest-you-actions">
        <button className="text-button" type="button" onClick={() => onOpenChips("bank")}>
          <Landmark size={16} aria-hidden="true" /> Buy in
        </button>
        <button className="text-button" type="button" onClick={() => onOpenChips("give")}>
          <ArrowUpRight size={16} aria-hidden="true" /> Give / buy chips
        </button>
      </div>
    </section>
  );
}

/** Table: you, what's waiting on you, the read-only table, the chip key, and the latest entries. */
export function GuestTableTab({
  state,
  me,
  notice,
  activePlayers,
  bankSummary,
  cashedOutPlayerIds,
  imbalanceCents,
  summaryByPlayerId,
  settleAvailable,
  waitingOnMe,
  events,
  live,
  onOpenChips,
  onOpenInbox,
  onOpenSettle,
  onOpenAudit
}: GuestTableTabProps) {
  return (
    <div className="play-mode guest-table-tab">
      <section className="play-table-area" aria-label="Poker table">
        <div className="guest-table-top">
          {notice ? <div className="notice notice-warning">{notice}</div> : null}
          <YouCard
            state={state}
            me={me}
            netCents={summaryByPlayerId.get(me.id)?.netCents ?? 0}
            cashedOut={cashedOutPlayerIds.has(me.id)}
            settleAvailable={settleAvailable}
            onOpenChips={onOpenChips}
            onOpenSettle={onOpenSettle}
          />
          {waitingOnMe > 0 ? (
            <button className="guest-waiting-strip" type="button" onClick={onOpenInbox}>
              <Clock size={18} aria-hidden="true" />
              <span>{waitingOnMe} waiting on you</span>
              <span className="guest-waiting-open">Open Inbox</span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <PokerTable
          activePlayers={activePlayers}
          bankBalanceCents={bankSummary.balanceCents}
          cashedOutPlayerIds={cashedOutPlayerIds}
          defaultBuyInCents={state.settings.defaultBuyInCents}
          dispatch={ignoreAction}
          hideActions
          layoutEditing={false}
          onAddTransaction={refuseTransaction}
          readOnly
          tableSeatPlacements={state.settings.tableSeatPlacements}
          tableShape={state.settings.tableShape}
          summaryByPlayerId={summaryByPlayerId}
          youPlayerId={me.id}
        />
      </section>
      <aside className="play-rail guest-table-rail" aria-label="Game details">
        <BankSummaryPanel bankSummary={bankSummary} imbalanceCents={imbalanceCents} variant="compact" />
        {state.settings.chipDenominations.length > 0 ? (
          <ChipKey denominations={state.settings.chipDenominations} />
        ) : null}
        <SpectatorFeed events={events} live={live} label="Recent activity" />
        <button className="text-button rail-action" type="button" onClick={onOpenAudit}>
          Transaction Audit
        </button>
      </aside>
    </div>
  );
}
