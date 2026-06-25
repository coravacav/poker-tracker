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

type TransactionTableProps = {
  dispatch: Dispatch<GameAction>;
  players: Player[];
  readOnly: boolean;
  transactions: Transaction[];
};

const typeLabels: Record<TransactionType, string> = {
  bank_buy_in: "Buy-in",
  bank_cash_out: "Chip count",
  player_transfer: "Transfer",
  manual_bank_adjustment: "Chip adjustment"
};

const categoryLabels: Record<TransactionCategory, string> = {
  poker: "Poker",
  food: "Food"
};

export function TransactionTable({
  dispatch,
  players,
  readOnly,
  transactions
}: TransactionTableProps) {
  function playerName(playerId: string | undefined): string {
    if (!playerId) {
      return "Chip Pool";
    }

    return players.find((player) => player.id === playerId)?.name ?? "Unknown player";
  }

  function fromLabel(transaction: Transaction): string {
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

  const sortedTransactions = [...transactions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

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
                  <td>{typeLabels[transaction.type]}</td>
                  <td>{fromLabel(transaction)}</td>
                  <td>{toLabel(transaction)}</td>
                  <td>
                    {transaction.type === "player_transfer" ? (
                      <span className={`category-pill category-${transaction.category ?? "poker"}`}>
                        {categoryLabels[transaction.category ?? "poker"]}
                      </span>
                    ) : (
                      ""
                    )}
                  </td>
                  <td>{formatCurrency(transaction.amountCents)}</td>
                  <td>{transaction.note || transaction.voidReason || ""}</td>
                  <td>{transaction.voidedAt ? "Voided" : "Active"}</td>
                  <td>
                    <div className="table-actions">
                      <button
                        className="icon-button"
                        type="button"
                        disabled={readOnly || !!transaction.voidedAt}
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
                    </div>
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
