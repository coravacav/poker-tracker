import { Ban, ClipboardList, Repeat2, Search, SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";
import type { Dispatch, FormEvent } from "react";
import { formatCurrency } from "../domain/money";
import type {
  Player,
  Transaction,
  TransactionCategory,
  TransactionType
} from "../domain/pokerTypes";
import type { SharedAuditEvent } from "../session/types";
import type { GameAction } from "../state/gameReducer";
import { ChipBreakdown } from "./ChipBreakdown";

type TransactionTableProps = {
  dispatch: Dispatch<GameAction>;
  hideActions?: boolean;
  players: Player[];
  readOnly: boolean;
  sharedEvents?: SharedAuditEvent[];
  transactions: Transaction[];
  variant?: "table" | "compact";
};

type AuditStatusFilter = "all" | "active" | "voided";
type AuditCategoryFilter = "all" | TransactionCategory;
type CorrectionKind = "reverse" | "void";

const typeLabels: Record<TransactionType, string> = {
  bank_buy_in: "Buy-in",
  bank_cash_out: "Cash-out",
  player_gave: "Player gave",
  player_owes: "Player owes",
  player_transfer: "Player gave",
  debt_coverage: "Debt coverage",
  manual_bank_adjustment: "Chip adjustment"
};

const categoryLabels: Record<TransactionCategory, string> = {
  poker: "Poker",
  food: "Food"
};

const transactionTypeOptions: Array<{ value: TransactionType; label: string }> = [
  { value: "bank_buy_in", label: "Buy-in" },
  { value: "bank_cash_out", label: "Cash-out" },
  { value: "player_gave", label: "Player gave" },
  { value: "player_owes", label: "Player owes" },
  { value: "debt_coverage", label: "Debt coverage" },
  { value: "manual_bank_adjustment", label: "Chip adjustment" }
];

const sharedKindLabels: Record<SharedAuditEvent["kind"], string> = {
  transaction: "Transaction",
  cash_out: "Cash-out",
  correction: "Correction",
  game: "Game"
};

function playerIdsForTransaction(transaction: Transaction): string[] {
  return [
    transaction.fromPlayerId,
    transaction.toPlayerId,
    transaction.coveredByPlayerId,
    transaction.coveredPlayerId
  ].filter((playerId): playerId is string => typeof playerId === "string");
}

function typeLabel(transaction: Transaction): string {
  if (transaction.type === "bank_buy_in" && transaction.coveredByPlayerId) {
    return "Covered buy-in";
  }

  if (transaction.type === "bank_cash_out") {
    return transaction.cashOutKind === "partial"
      ? "Partial cash-out"
      : transaction.cashOutKind === "final"
        ? "Final cash-out"
        : "Cash-out";
  }

  return typeLabels[transaction.type];
}

function eventTime(createdAt: number): string {
  return new Date(createdAt).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function CorrectionDialog({
  kind,
  transaction,
  onCancel,
  onConfirm
}: {
  kind: CorrectionKind;
  transaction: Transaction;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState(kind === "void" ? "Correction" : "");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onConfirm(reason);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="modal table-action-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${kind === "reverse" ? "Reverse" : "Void"} transaction`}
      >
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Audit correction</p>
            <h2>{kind === "reverse" ? "Reverse transaction" : "Void transaction"}</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Close" title="Close" onClick={onCancel}>
            <X size={17} />
          </button>
        </div>

        <p className="correction-summary">
          {typeLabel(transaction)} · {formatCurrency(transaction.amountCents)}
        </p>
        <p className="muted">
          {kind === "reverse"
            ? "This keeps the original in the audit history and records an opposite transaction."
            : "This keeps the original in the audit history but removes it from active totals."}
        </p>

        {kind === "void" ? (
          <label>
            <span>Reason</span>
            <input autoFocus value={reason} onChange={(event) => setReason(event.currentTarget.value)} />
          </label>
        ) : null}

        <form className="modal-actions" onSubmit={submit}>
          <button type="button" onClick={onCancel}>Cancel</button>
          <button className={kind === "void" ? "danger-button" : "primary-button"} type="submit">
            {kind === "reverse" ? "Reverse transaction" : "Void transaction"}
          </button>
        </form>
      </section>
    </div>
  );
}

export function TransactionTable({
  dispatch,
  hideActions = false,
  players,
  readOnly,
  sharedEvents,
  transactions,
  variant = "table"
}: TransactionTableProps) {
  const [search, setSearch] = useState("");
  const [playerFilter, setPlayerFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<"all" | TransactionType>("all");
  const [statusFilter, setStatusFilter] = useState<AuditStatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<AuditCategoryFilter>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [correction, setCorrection] = useState<{
    kind: CorrectionKind;
    transaction: Transaction;
  } | null>(null);

  function playerName(playerId: string | undefined): string {
    if (!playerId) return "Chip Pool";
    return players.find((player) => player.id === playerId)?.name ?? "Unknown player";
  }

  function fromLabel(transaction: Transaction): string {
    if (transaction.type === "debt_coverage") return playerName(transaction.coveredByPlayerId);
    if (transaction.type === "bank_buy_in") return "Chip Pool";
    if (transaction.type === "bank_cash_out") return playerName(transaction.fromPlayerId);
    if (transaction.type === "manual_bank_adjustment") {
      return transaction.bankDirection === "outgoing" ? playerName(undefined) : "External";
    }
    return playerName(transaction.fromPlayerId);
  }

  function toLabel(transaction: Transaction): string {
    if (transaction.type === "debt_coverage") return playerName(transaction.coveredPlayerId);
    if (transaction.type === "bank_buy_in") return playerName(transaction.toPlayerId);
    if (transaction.type === "bank_cash_out") return "Chip Pool";
    if (transaction.type === "manual_bank_adjustment") {
      return transaction.bankDirection === "outgoing" ? "External" : playerName(undefined);
    }
    return playerName(transaction.toPlayerId);
  }

  function hasPlayerCategory(transaction: Transaction): boolean {
    return (
      transaction.type === "player_gave" ||
      transaction.type === "player_owes" ||
      transaction.type === "player_transfer"
    );
  }

  function playerCategory(transaction: Transaction): TransactionCategory {
    return transaction.category ?? (transaction.type === "player_owes" ? "food" : "poker");
  }

  function coverageLabel(transaction: Transaction): string | null {
    if (transaction.type === "bank_buy_in" && transaction.coveredByPlayerId) {
      return `Covered by ${playerName(transaction.coveredByPlayerId)}`;
    }
    if (
      transaction.type === "debt_coverage" &&
      transaction.coveredByPlayerId &&
      transaction.coveredPlayerId
    ) {
      return `${playerName(transaction.coveredByPlayerId)} covers ${playerName(transaction.coveredPlayerId)}`;
    }
    return null;
  }

  const sortedTransactions = [...transactions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredTransactions = sortedTransactions.filter((transaction) => {
    const category = hasPlayerCategory(transaction) ? playerCategory(transaction) : null;
    const searchableText = [
      typeLabel(transaction),
      fromLabel(transaction),
      toLabel(transaction),
      transaction.note,
      transaction.voidReason,
      coverageLabel(transaction),
      category ? categoryLabels[category] : null
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase();

    return (
      (!normalizedSearch || searchableText.includes(normalizedSearch)) &&
      (playerFilter === "all" || playerIdsForTransaction(transaction).includes(playerFilter)) &&
      (typeFilter === "all" || transaction.type === typeFilter) &&
      (statusFilter === "all" || (statusFilter === "voided" ? !!transaction.voidedAt : !transaction.voidedAt)) &&
      (categoryFilter === "all" || category === categoryFilter)
    );
  });
  const filteredSharedEvents = (sharedEvents ?? []).filter((event) => {
    const eventPlayers = event.playerIds
      .map((playerId) => playerName(playerId))
      .join(" ");
    const searchableText = `${event.summary} ${event.actionType} ${event.actorLabel} ${eventPlayers}`.toLocaleLowerCase();
    return (
      (!normalizedSearch || searchableText.includes(normalizedSearch)) &&
      (playerFilter === "all" || event.playerIds.includes(playerFilter))
    );
  });
  const hasFilters =
    !!normalizedSearch ||
    playerFilter !== "all" ||
    typeFilter !== "all" ||
    statusFilter !== "all" ||
    categoryFilter !== "all";

  function clearFilters() {
    setSearch("");
    setPlayerFilter("all");
    setTypeFilter("all");
    setStatusFilter("all");
    setCategoryFilter("all");
  }

  function openCorrection(kind: CorrectionKind, transaction: Transaction) {
    if (
      hideActions ||
      readOnly ||
      !!transaction.voidedAt ||
      (kind === "reverse" && transaction.type === "debt_coverage")
    ) {
      return;
    }
    setCorrection({ kind, transaction });
  }

  function confirmCorrection(reason: string) {
    if (!correction) return;
    if (correction.kind === "reverse") {
      dispatch({ type: "flip_transaction", transactionId: correction.transaction.id });
    } else {
      dispatch({
        type: "void_transaction",
        transactionId: correction.transaction.id,
        reason: reason.trim() || "No reason provided"
      });
    }
    setCorrection(null);
  }

  function renderFilters() {
    return (
      <div className="audit-filter-shell">
        <div className="audit-toolbar">
          <label className="audit-search-field">
            <span className="sr-only">Search audit history</span>
            <Search size={16} aria-hidden="true" />
            <input
              aria-label="Search audit history"
              placeholder="Search history"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
            />
          </label>
          <button
            className={`text-button ${filtersOpen ? "is-active" : ""}`}
            type="button"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((current) => !current)}
          >
            <SlidersHorizontal size={15} />
            {filtersOpen ? "Hide filters" : "Filters"}
          </button>
          {hasFilters ? <button className="text-button" type="button" onClick={clearFilters}>Clear</button> : null}
        </div>

        {filtersOpen ? (
          <div className="audit-filter-grid">
            <label>
              <span>Player</span>
              <select value={playerFilter} onChange={(event) => setPlayerFilter(event.currentTarget.value)}>
                <option value="all">All players</option>
                {[...players]
                  .sort((a, b) => a.seatIndex - b.seatIndex)
                  .map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}
              </select>
            </label>
            <label>
              <span>Type</span>
              <select value={typeFilter} onChange={(event) => setTypeFilter(event.currentTarget.value as "all" | TransactionType)}>
                <option value="all">All types</option>
                {transactionTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label>
              <span>Status</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.currentTarget.value as AuditStatusFilter)}>
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="voided">Voided</option>
              </select>
            </label>
            <label>
              <span>Category</span>
              <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.currentTarget.value as AuditCategoryFilter)}>
                <option value="all">All categories</option>
                <option value="poker">Poker</option>
                <option value="food">Food</option>
              </select>
            </label>
          </div>
        ) : null}

        <p className="audit-filter-summary">
          Showing {filteredTransactions.length} of {sortedTransactions.length} transactions
          {sharedEvents !== undefined ? ` · ${filteredSharedEvents.length} shared events` : ""}
        </p>
      </div>
    );
  }

  function renderSharedHistory() {
    if (sharedEvents === undefined) return null;

    return (
      <section className="shared-audit-history" aria-label="Shared audit history">
        <div className="audit-section-heading">
          <div>
            <p className="eyebrow">Synced across this room</p>
            <h3>Shared activity</h3>
          </div>
          <span className="muted">{filteredSharedEvents.length} events</span>
        </div>
        {filteredSharedEvents.length === 0 ? (
          <p className="muted">No shared events match these filters.</p>
        ) : (
          <div className="shared-audit-event-list">
            {filteredSharedEvents.map((event) => (
              <article className="shared-audit-event" key={event.id}>
                <div className="shared-audit-event-topline">
                  <span className={`audit-kind-pill audit-kind-${event.kind}`}>{sharedKindLabels[event.kind]}</span>
                  <time dateTime={new Date(event.createdAt).toISOString()}>v{event.version} · {eventTime(event.createdAt)}</time>
                </div>
                <strong>{event.summary}</strong>
                <span className="muted">{event.actorLabel}</span>
              </article>
            ))}
          </div>
        )}
      </section>
    );
  }

  function renderCorrectionDialog() {
    return correction ? (
      <CorrectionDialog
        kind={correction.kind}
        onCancel={() => setCorrection(null)}
        onConfirm={confirmCorrection}
        transaction={correction.transaction}
      />
    ) : null;
  }

  function renderActions(transaction: Transaction) {
    if (hideActions) return null;
    return (
      <div className="table-actions">
        <button
          className="text-button audit-action"
          type="button"
          aria-label="Reverse transaction"
          disabled={readOnly || !!transaction.voidedAt || transaction.type === "debt_coverage"}
          title="Record an opposite transaction while keeping this entry in history"
          onClick={() => openCorrection("reverse", transaction)}
        >
          <Repeat2 size={15} /> Reverse
        </button>
        <button
          className="text-button audit-action audit-action-danger"
          type="button"
          aria-label="Void transaction"
          disabled={readOnly || !!transaction.voidedAt}
          title="Remove this entry from active totals and keep it in history"
          onClick={() => openCorrection("void", transaction)}
        >
          <Ban size={15} /> Void
        </button>
      </div>
    );
  }

  if (variant === "compact") {
    return (
      <>
        <section className="audit-compact" aria-label="Transaction audit list">
          {renderFilters()}
          {renderSharedHistory()}
          {filteredTransactions.length === 0 ? (
            <p className="empty-cell">{sortedTransactions.length === 0 ? "No transactions yet." : "No transactions match these filters."}</p>
          ) : (
            filteredTransactions.map((transaction) => (
              <article
                key={transaction.id}
                className={`audit-card ${transaction.voidedAt ? "voided-row" : ""}`}
              >
                <div className="audit-card-main">
                  <div>
                    <p className="eyebrow">{new Date(transaction.createdAt).toLocaleTimeString()}</p>
                    <h3>{typeLabel(transaction)}</h3>
                  </div>
                  <strong>{formatCurrency(transaction.amountCents)}</strong>
                </div>
                <div className="audit-card-flow">
                  <span>{fromLabel(transaction)}</span>
                  <span>{transaction.type === "debt_coverage" ? "covers" : transaction.type === "player_owes" ? "owes" : "to"}</span>
                  <span>{toLabel(transaction)}</span>
                </div>
                <div className="audit-card-meta">
                  {hasPlayerCategory(transaction) ? <span className={`category-pill category-${playerCategory(transaction)}`}>{categoryLabels[playerCategory(transaction)]}</span> : null}
                  {coverageLabel(transaction) ? <span className="category-pill category-poker">{coverageLabel(transaction)}</span> : null}
                  <span>{transaction.voidedAt ? "Voided" : "Active"}</span>
                  {transaction.note || transaction.voidReason ? <span>{transaction.note || transaction.voidReason}</span> : null}
                  {transaction.correctsTransactionId ? <span>Corrects a previous cash-out</span> : null}
                </div>
                {transaction.chipCountBreakdown !== undefined ? <ChipBreakdown lines={transaction.chipCountBreakdown} disclosure /> : null}
                {renderActions(transaction)}
              </article>
            ))
          )}
        </section>
        {renderCorrectionDialog()}
      </>
    );
  }

  return (
    <>
      <section className="panel audit-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Immutable history</p>
            <h2>Transaction Audit</h2>
          </div>
          <ClipboardList size={20} />
        </div>

        {renderFilters()}
        {renderSharedHistory()}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Type</th>
                <th>From</th>
                <th>To</th>
                <th>Category</th>
                <th>Amount</th>
                <th>Note</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={9} className="empty-cell">
                    {sortedTransactions.length === 0 ? "No transactions yet." : "No transactions match these filters."}
                  </td>
                </tr>
              ) : (
                filteredTransactions.map((transaction) => (
                  <tr key={transaction.id} className={transaction.voidedAt ? "voided-row" : ""}>
                    <td>{new Date(transaction.createdAt).toLocaleTimeString()}</td>
                    <td>{typeLabel(transaction)}</td>
                    <td>{fromLabel(transaction)}</td>
                    <td>{toLabel(transaction)}</td>
                    <td>
                      {hasPlayerCategory(transaction) ? (
                        <span className={`category-pill category-${playerCategory(transaction)}`}>{categoryLabels[playerCategory(transaction)]}</span>
                      ) : coverageLabel(transaction) ? (
                        <span className="category-pill category-poker">{coverageLabel(transaction)}</span>
                      ) : ""}
                    </td>
                    <td>{formatCurrency(transaction.amountCents)}</td>
                    <td>
                      {transaction.note || transaction.voidReason || ""}
                      {transaction.correctsTransactionId ? <div>Corrects a previous cash-out</div> : null}
                      {transaction.chipCountBreakdown !== undefined ? <ChipBreakdown lines={transaction.chipCountBreakdown} disclosure /> : null}
                    </td>
                    <td>{transaction.voidedAt ? "Voided" : "Active"}</td>
                    <td>{renderActions(transaction)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
      {renderCorrectionDialog()}
    </>
  );
}
