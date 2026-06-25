import { PlusCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { centsToInputValue, parseMoneyToCents } from "../domain/money";
import type {
  BankDirection,
  Player,
  PlayerId,
  PlayerLedgerSummary,
  Transaction,
  TransactionCategory,
  TransactionType
} from "../domain/pokerTypes";
import { validateTransaction } from "../domain/validation";
import { createId } from "../state/seedGame";
import { TransferPreview } from "./TransferPreview";

type TransactionFormProps = {
  defaultBuyInCents: number;
  onAddTransaction: (transaction: Transaction) => boolean;
  players: Player[];
  readOnly: boolean;
  summaryByPlayerId?: Map<PlayerId, PlayerLedgerSummary>;
};

const transactionLabels: Record<TransactionType, string> = {
  bank_buy_in: "Chip buy-in",
  bank_cash_out: "Chip cash-out",
  player_transfer: "Player transfer",
  manual_bank_adjustment: "Chip adjustment"
};

export function TransactionForm({
  defaultBuyInCents,
  onAddTransaction,
  players,
  readOnly,
  summaryByPlayerId
}: TransactionFormProps) {
  const [type, setType] = useState<TransactionType>("bank_buy_in");
  const [fromPlayerId, setFromPlayerId] = useState(players[0]?.id ?? "");
  const [toPlayerId, setToPlayerId] = useState(players[0]?.id ?? "");
  const [amountInput, setAmountInput] = useState(centsToInputValue(defaultBuyInCents));
  const [note, setNote] = useState("");
  const [bankDirection, setBankDirection] = useState<BankDirection>("incoming");
  const [category, setCategory] = useState<TransactionCategory>("poker");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (players.length === 0) {
      return;
    }

    if (!players.some((player) => player.id === fromPlayerId)) {
      setFromPlayerId(players[0].id);
    }

    if (!players.some((player) => player.id === toPlayerId)) {
      setToPlayerId(players[0].id);
    }
  }, [fromPlayerId, players, toPlayerId]);

  function applyQuickAmount(cents: number) {
    setAmountInput(centsToInputValue(cents));
  }

  function chooseCategory(nextCategory: TransactionCategory) {
    setCategory(nextCategory);
  }

  const previewAmountCents = parseMoneyToCents(amountInput);
  const showTransferPreview =
    type === "player_transfer" &&
    !!previewAmountCents &&
    previewAmountCents > 0 &&
    fromPlayerId !== toPlayerId;
  const fromPlayer = players.find((player) => player.id === fromPlayerId);
  const toPlayer = players.find((player) => player.id === toPlayerId);
  const fromCurrentNet = summaryByPlayerId?.get(fromPlayerId)?.netCents ?? 0;
  const toCurrentNet = summaryByPlayerId?.get(toPlayerId)?.netCents ?? 0;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountCents = parseMoneyToCents(amountInput);

    if (amountCents === null) {
      setError("Enter a valid dollar amount.");
      return;
    }

    const transaction: Transaction = {
      id: createId("transaction"),
      type,
      createdAt: new Date().toISOString(),
      amountCents,
      note: note.trim() || undefined
    };

    if (type === "bank_buy_in") {
      transaction.toPlayerId = toPlayerId;
    }

    if (type === "bank_cash_out") {
      transaction.fromPlayerId = fromPlayerId;
    }

    if (type === "player_transfer") {
      transaction.fromPlayerId = fromPlayerId;
      transaction.toPlayerId = toPlayerId;
      transaction.category = category;
    }

    if (type === "manual_bank_adjustment") {
      transaction.bankDirection = bankDirection;
    }

    const validationError = validateTransaction(transaction, players);
    if (validationError) {
      setError(validationError);
      return;
    }

    if (onAddTransaction(transaction)) {
      setError(null);
      setNote("");
      setAmountInput(centsToInputValue(defaultBuyInCents));
    }
  }

  return (
    <section className="panel transaction-form-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Ledger entry</p>
          <h2>Add Transaction</h2>
        </div>
        <PlusCircle size={20} />
      </div>

      <form onSubmit={submit}>
        <div className="form-grid">
          <label>
            <span>Type</span>
            <select
              disabled={readOnly}
              value={type}
              onChange={(event) => setType(event.currentTarget.value as TransactionType)}
            >
              {Object.entries(transactionLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          {(type === "bank_cash_out" || type === "player_transfer") && (
            <label>
              <span>From</span>
              <select
                disabled={readOnly}
                value={fromPlayerId}
                onChange={(event) => setFromPlayerId(event.currentTarget.value)}
              >
                {players.map((player) => (
                  <option key={player.id} value={player.id}>
                    {player.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {(type === "bank_buy_in" || type === "player_transfer") && (
            <label>
              <span>To</span>
              <select
                disabled={readOnly}
                value={toPlayerId}
                onChange={(event) => setToPlayerId(event.currentTarget.value)}
              >
                {players.map((player) => (
                  <option key={player.id} value={player.id}>
                    {player.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {type === "manual_bank_adjustment" && (
            <label>
              <span>Chip direction</span>
              <select
                disabled={readOnly}
                value={bankDirection}
                onChange={(event) => setBankDirection(event.currentTarget.value as BankDirection)}
              >
                <option value="incoming">Issued</option>
                <option value="outgoing">Returned</option>
              </select>
            </label>
          )}

          {type === "player_transfer" && (
            <label>
              <span>Category</span>
              <select
                disabled={readOnly}
                value={category}
                onChange={(event) =>
                  chooseCategory(event.currentTarget.value as TransactionCategory)
                }
              >
                <option value="poker">Poker / rebuy</option>
                <option value="food">Food</option>
              </select>
            </label>
          )}

          <label>
            <span>Amount</span>
            <input
              disabled={readOnly}
              inputMode="decimal"
              value={amountInput}
              onChange={(event) => setAmountInput(event.currentTarget.value)}
            />
          </label>

          <label className="note-field">
            <span>Note</span>
            <input
              disabled={readOnly}
              value={note}
              onChange={(event) => setNote(event.currentTarget.value)}
              placeholder="Optional"
            />
          </label>
        </div>

        <div className="quick-amounts">
          <button
            type="button"
            disabled={readOnly}
            onClick={() => applyQuickAmount(Math.round(defaultBuyInCents / 2))}
          >
            Half
          </button>
          <button type="button" disabled={readOnly} onClick={() => applyQuickAmount(defaultBuyInCents)}>
            Buy-in
          </button>
          <button
            type="button"
            disabled={readOnly}
            onClick={() => applyQuickAmount(defaultBuyInCents * 2)}
          >
            Double
          </button>
          <button
            type="button"
            disabled={readOnly}
            onClick={() => {
              setType("player_transfer");
              chooseCategory("food");
            }}
          >
            Food transfer
          </button>
          <button className="primary-button" type="submit" disabled={readOnly}>
            Add transaction
          </button>
        </div>

        {showTransferPreview ? (
          <TransferPreview
            amountCents={previewAmountCents ?? 0}
            fromCurrentNetCents={fromCurrentNet}
            fromName={fromPlayer?.name ?? "From player"}
            toCurrentNetCents={toCurrentNet}
            toName={toPlayer?.name ?? "To player"}
          />
        ) : null}

        {error ? <div className="notice notice-warning">{error}</div> : null}
      </form>
    </section>
  );
}
