import { ArrowUpRight, ChevronRight, Clock, Landmark } from "lucide-react";
import { useMemo } from "react";
import { settleLaterBalances } from "../../domain/ledger";
import { describeSignedMoney } from "../../domain/money";
import type { GameState, Player } from "../../domain/pokerTypes";
import { playerNameById } from "../../domain/settlement";
import type { SharedAuditEvent } from "../../session/types";
import { BankSummaryPanel } from "../BankSummary";
import { ChipKey } from "../ChipKey";
import { useCurrencyCode, useFormatCurrency } from "../CurrencyContext";
import type { LedgerOverview } from "../gameApp/useLedgerOverview";
import { PokerTable } from "../PokerTable";
import { SpectatorFeed } from "../spectator/SpectatorFeed";
import { settleUpLine } from "./agreementText";

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

/** "You" at the top of Table: what you're in for and who owes whom at settle-up. */
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
  const currencyCode = useCurrencyCode();
  const formatCurrency = useFormatCurrency();
  const balances = useMemo(() => settleLaterBalances(me.id, state.transactions), [me.id, state.transactions]);
  const lines = [...balances].map(([otherId, cents]) => {
    const other = { id: otherId, name: playerNameById(state.players, otherId) };
    const self = { id: me.id, name: me.name };
    const amount = formatCurrency(Math.abs(cents), { trimWholeCents: true });
    return cents > 0 ? settleUpLine(other, self, amount, me.id) : settleUpLine(self, other, amount, me.id);
  });
  // Until the final count, a negative net is what the player is in for.
  const inForCents = !cashedOut && netCents < 0 ? -netCents : 0;
  const standing = inForCents > 0
    ? `in for ${formatCurrency(inForCents, { trimWholeCents: true })}`
    : describeSignedMoney(netCents, currencyCode, { trimWholeCents: true });

  return (
    <section className="panel guest-you-card" aria-label="You">
      <div className="guest-you-heading">
        <span className="guest-you-badge">You</span>
        <h2>{me.name}</h2>
        <strong>{standing.charAt(0).toUpperCase() + standing.slice(1)}</strong>
      </div>
      {lines.length > 0 ? (
        <ul className="guest-you-balances">
          {lines.map((line) => <li key={line}>{line}</li>)}
        </ul>
      ) : (
        <p className="muted">Nobody owes anybody for chips yet.</p>
      )}
      {settleAvailable ? (
        <button className="text-button guest-you-settle" type="button" onClick={onOpenSettle}>
          See who pays whom <ChevronRight size={16} aria-hidden="true" />
        </button>
      ) : null}
      <div className="guest-you-actions">
        <button className="text-button" type="button" onClick={() => onOpenChips("give")}>
          <ArrowUpRight size={16} aria-hidden="true" /> Give / buy chips
        </button>
        <button className="text-button" type="button" onClick={() => onOpenChips("bank")}>
          <Landmark size={16} aria-hidden="true" /> Buy from bank
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
