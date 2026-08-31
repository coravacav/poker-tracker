import { Ban, ClipboardList, Repeat2 } from "lucide-react";
import type { Dispatch } from "react";
import { formatCurrency } from "../domain/money";
import type {
  Player,
  Transaction,
  TransactionCategory,
  TransactionType
} from "../domain/pokerTypes";
import type { GameAction } from "../state/gameReducer";
import { ChipBreakdown } from "./ChipBreakdown";

type TransactionTableProps = {
  dispatch: Dispatch<GameAction>;
  hideActions?: boolean;
  players: Player[];
  readOnly: boolean;
  transactions: Transaction[];
  variant?: "table" | "compact";
};

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

export function TransactionTable({
  dispatch,
  hideActions = false,
  players,
  readOnly,
  transactions,
  variant = "table"
}: TransactionTableProps) {
  function playerName(playerId: string | undefined): string {
    if (!playerId) {
      return "Chip Pool";
    }

    return players.find((player) => player.id === playerId)?.name ?? "Unknown player";
  }

  function fromLabel(transaction: Transaction): string {
    if (transaction.type === "debt_coverage") {
      return playerName(transaction.coveredByPlayerId);
    }

    if (transaction.type === "bank_buy_in") {
      return "Chip Pool";
    }

    if (transaction.type === "bank_cash_out") {
      return playerName(transaction.fromPlayerId);
    }

    if (transaction.type === "manual_bank_adjustment") {
      return transaction.bankDirection === "outgoing" ? playerName(undefined) : "External";
    }

    return playerName(transaction.fromPlayerId);
  }

  function toLabel(transaction: Transaction): string {
    if (transaction.type === "debt_coverage") {
      return playerName(transaction.coveredPlayerId);
    }

    if (transaction.type === "bank_buy_in") {
      return playerName(transaction.toPlayerId);
    }

    if (transaction.type === "bank_cash_out") {
      return "Chip Pool";
    }

    if (transaction.type === "manual_bank_adjustment") {
      return transaction.bankDirection === "outgoing" ? "External" : playerName(undefined);
    }

    return playerName(transaction.toPlayerId);
  }

  function voidTransaction(transaction: Transaction) {
    const reason = window.prompt("Reason for voiding this transaction", "Correction");
    if (reason === null) {
      return;
    }

    dispatch({
      type: "void_transaction",
      transactionId: transaction.id,
      reason
    });
  }

  function flipTransaction(transaction: Transaction) {
    dispatch({
      type: "flip_transaction",
      transactionId: transaction.id
    });
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

  if (variant === "compact") {
    return (
      <section className="audit-compact" aria-label="Transaction audit list">
        {sortedTransactions.length === 0 ? (
          <p className="empty-cell">No transactions yet.</p>
        ) : (
          sortedTransactions.map((transaction) => (
            <article
              key={transaction.id}
              className={`audit-card ${transaction.voidedAt ? "voided-row" : ""}`}
            >
              <div className="audit-card-main">
                <div>
                  <p className="eyebrow">
                    {new Date(transaction.createdAt).toLocaleTimeString()}
                  </p>
                  <h3>{typeLabel(transaction)}</h3>
                </div>
                <strong>{formatCurrency(transaction.amountCents)}</strong>
              </div>
              <div className="audit-card-flow">
                <span>{fromLabel(transaction)}</span>
                <span>
                  {transaction.type === "debt_coverage"
                    ? "covers"
                    : transaction.type === "player_owes"
                      ? "owes"
                      : "to"}
                </span>
                <span>{toLabel(transaction)}</span>
              </div>
              <div className="audit-card-meta">
                {hasPlayerCategory(transaction) ? (
                  <span className={`category-pill category-${playerCategory(transaction)}`}>
                    {categoryLabels[playerCategory(transaction)]}
                  </span>
                ) : null}
                {coverageLabel(transaction) ? (
                  <span className="category-pill category-poker">
                    {coverageLabel(transaction)}
                  </span>
                ) : null}
                <span>{transaction.voidedAt ? "Voided" : "Active"}</span>
                {transaction.note || transaction.voidReason ? (
                  <span>{transaction.note || transaction.voidReason}</span>
                ) : null}
                {transaction.correctsTransactionId ? (
                  <span>Corrects transaction {transaction.correctsTransactionId}</span>
                ) : null}
              </div>
              {transaction.chipCountBreakdown !== undefined ? (
                <ChipBreakdown lines={transaction.chipCountBreakdown} disclosure />
              ) : null}
              {!hideActions ? <div className="table-actions">
                <button
                  className="icon-button"
                  type="button"
                  disabled={
                    readOnly ||
                    !!transaction.voidedAt ||
                    transaction.type === "debt_coverage"
                  }
                  title="Flip transaction"
                  onClick={() => flipTransaction(transaction)}
                >
                  <Repeat2 size={15} />
                </button>
                <button
                  className="icon-button"
                  type="button"
                  disabled={readOnly || !!transaction.voidedAt}
                  title="Void transaction"
                  onClick={() => voidTransaction(transaction)}
                >
                  <Ban size={15} />
                </button>
              </div> : null}
            </article>
          ))
        )}
      </section>
    );
  }

  return (
    <section className="panel audit-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Immutable history</p>
          <h2>Transaction Audit</h2>
        </div>
        <ClipboardList size={20} />
      </div>

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
            {sortedTransactions.length === 0 ? (
              <tr>
                <td colSpan={9} className="empty-cell">
                  No transactions yet.
                </td>
              </tr>
            ) : (
              sortedTransactions.map((transaction) => (
                <tr key={transaction.id} className={transaction.voidedAt ? "voided-row" : ""}>
                  <td>{new Date(transaction.createdAt).toLocaleTimeString()}</td>
                  <td>{typeLabel(transaction)}</td>
                  <td>{fromLabel(transaction)}</td>
                  <td>{toLabel(transaction)}</td>
                  <td>
                    {hasPlayerCategory(transaction) ? (
                      <span className={`category-pill category-${playerCategory(transaction)}`}>
                        {categoryLabels[playerCategory(transaction)]}
                      </span>
                    ) : coverageLabel(transaction) ? (
                      <span className="category-pill category-poker">
                        {coverageLabel(transaction)}
                      </span>
                    ) : ""}
                  </td>
                  <td>{formatCurrency(transaction.amountCents)}</td>
                  <td>
                    {transaction.note || transaction.voidReason || ""}
                    {transaction.correctsTransactionId ? (
                      <div>Corrects transaction {transaction.correctsTransactionId}</div>
                    ) : null}
                    {transaction.chipCountBreakdown !== undefined ? (
                      <ChipBreakdown lines={transaction.chipCountBreakdown} disclosure />
                    ) : null}
                  </td>
                  <td>{transaction.voidedAt ? "Voided" : "Active"}</td>
                  <td>
                    {!hideActions ? <div className="table-actions">
                      <button
                        className="icon-button"
                        type="button"
                          disabled={
                            readOnly ||
                            !!transaction.voidedAt ||
                            transaction.type === "debt_coverage"
                          }
                        title="Flip transaction"
                        onClick={() => flipTransaction(transaction)}
                      >
                        <Repeat2 size={15} />
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        disabled={readOnly || !!transaction.voidedAt}
                        title="Void transaction"
                        onClick={() => voidTransaction(transaction)}
                      >
                        <Ban size={15} />
                      </button>
                    </div> : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
