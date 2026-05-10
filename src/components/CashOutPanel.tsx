import { BadgeDollarSign, TriangleAlert } from "lucide-react";
import { useState } from "react";
import {
  centsToInputValue,
  describeSignedMoney,
  formatCurrency,
  parseMoneyToCents
} from "../domain/money";
import type { Player, PlayerLedgerSummary, Transaction } from "../domain/pokerTypes";
import { createId } from "../state/seedGame";

type CashOutPanelProps = {
  onAddTransaction: (transaction: Transaction) => boolean;
  players: Player[];
  readOnly: boolean;
  summaries: PlayerLedgerSummary[];
  transactions: Transaction[];
};

export function CashOutPanel({
  onAddTransaction,
  players,
  readOnly,
  summaries,
  transactions
}: CashOutPanelProps) {
  const [cashOutInputs, setCashOutInputs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const summaryByPlayerId = new Map(summaries.map((summary) => [summary.playerId, summary]));
  const cashedOutPlayerIds = new Set(
    transactions
      .filter((transaction) => transaction.type === "bank_cash_out" && !transaction.voidedAt)
      .map((transaction) => transaction.fromPlayerId)
      .filter(Boolean)
  );
  const playersWithActivity = players.filter((player) => {
    const summary = summaryByPlayerId.get(player.id);
    return (
      summary &&
      (summary.bankBuyInsCents > 0 ||
        summary.sentToPlayersCents > 0 ||
        summary.receivedFromPlayersCents > 0)
    );
  });
  const missingCashOuts = playersWithActivity.filter(
    (player) => !cashedOutPlayerIds.has(player.id)
  );

  function setCashOutInput(playerId: string, value: string) {
    setCashOutInputs((current) => ({
      ...current,
      [playerId]: value
    }));
  }

  function recordCashOut(player: Player) {
    const rawAmount = cashOutInputs[player.id] ?? "0.00";
    const amountCents = parseMoneyToCents(rawAmount);

    if (amountCents === null) {
      setError(`Enter a valid cash-out amount for ${player.name}.`);
      return;
    }

    if (
      onAddTransaction({
        id: createId("transaction"),
        type: "bank_cash_out",
        createdAt: new Date().toISOString(),
        amountCents,
        fromPlayerId: player.id,
        note: "End-of-night cash-out"
      })
    ) {
      setCashOutInputs((current) => ({
        ...current,
        [player.id]: centsToInputValue(amountCents)
      }));
      setError(null);
    }
  }

  return (
    <section className="panel cashout-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">End of night</p>
          <h2>Cash Out</h2>
        </div>
        <BadgeDollarSign size={20} />
      </div>

      {missingCashOuts.length > 0 ? (
        <div className="notice notice-warning">
          <TriangleAlert size={16} />
          Missing cash-outs: {missingCashOuts.map((player) => player.name).join(", ")}
        </div>
      ) : (
        <div className="notice notice-ok">No active player cash-outs are missing.</div>
      )}

      <div className="cashout-grid">
        {players.map((player) => {
          const summary = summaryByPlayerId.get(player.id);
          const currentInput = cashOutInputs[player.id] ?? "0.00";

          return (
            <article className="cashout-row" key={player.id}>
              <div>
                <h3>{player.name}</h3>
                <p>Seat {player.seatIndex + 1}</p>
              </div>
              <dl>
                <div>
                  <dt>Buy-ins</dt>
                  <dd>{formatCurrency(summary?.bankBuyInsCents ?? 0)}</dd>
                </div>
                <div>
                  <dt>Transfers</dt>
                  <dd>
                    {formatCurrency(
                      (summary?.sentToPlayersCents ?? 0) -
                        (summary?.receivedFromPlayersCents ?? 0)
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Net</dt>
                  <dd>{describeSignedMoney(summary?.netCents ?? 0)}</dd>
                </div>
              </dl>
              <label>
                <span>Cash-out</span>
                <input
                  disabled={readOnly}
                  inputMode="decimal"
                  value={currentInput}
                  onBlur={() => {
                    if (!currentInput.trim()) {
                      setCashOutInput(player.id, "0.00");
                    }
                  }}
                  onChange={(event) => {
                    const nextAmount = event.currentTarget.value;

                    setCashOutInput(player.id, nextAmount);
                  }}
                  onFocus={() => {
                    if (currentInput === "0.00") {
                      setCashOutInput(player.id, "");
                    }
                  }}
                />
              </label>
              <button
                className="primary-button"
                type="button"
                disabled={readOnly}
                onClick={() => recordCashOut(player)}
              >
                Record
              </button>
            </article>
          );
        })}
      </div>

      {error ? <div className="notice notice-warning">{error}</div> : null}
    </section>
  );
}
