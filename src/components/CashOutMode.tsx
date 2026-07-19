import { BadgeDollarSign, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import type { Dispatch } from "react";
import {
  activeCashOutsForPlayer,
  chipCountLineTotalCents,
  chipCountTotalCents,
  currentFinalCashOutForPlayer,
  getCashOutOverview,
  mergeChipCountLines,
  snapshotNonzeroChipCountLines
} from "../domain/chipCounts";
import { formatCurrency } from "../domain/money";
import type {
  BankSummary,
  CashOutDraft,
  ChipCountLine,
  ChipDenomination,
  Player,
  PlayerLedgerSummary,
  Transaction
} from "../domain/pokerTypes";
import { validateTransaction } from "../domain/validation";
import type { GameAction } from "../state/gameReducer";
import { createId } from "../state/seedGame";
import { ChipBreakdown } from "./ChipBreakdown";

type CashOutModeProps = {
  bankSummary: BankSummary;
  denominations: ChipDenomination[];
  dispatch: Dispatch<GameAction>;
  drafts: CashOutDraft[];
  players: Player[];
  readOnly: boolean;
  summaries: PlayerLedgerSummary[];
  transactions: Transaction[];
};

export function CashOutMode({
  bankSummary,
  denominations,
  dispatch,
  drafts,
  players,
  readOnly,
  summaries,
  transactions
}: CashOutModeProps) {
  const [rawInputs, setRawInputs] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const summaryByPlayer = useMemo(
    () => new Map(summaries.map((summary) => [summary.playerId, summary])),
    [summaries]
  );
  const draftByPlayer = useMemo(
    () => new Map(drafts.map((draft) => [draft.playerId, draft])),
    [drafts]
  );
  const overview = useMemo(
    () => getCashOutOverview(players, transactions, drafts, denominations, bankSummary),
    [bankSummary, denominations, drafts, players, transactions]
  );

  function visibleLinesFor(playerId: string): ChipCountLine[] {
    return mergeChipCountLines(denominations, draftByPlayer.get(playerId)?.lines ?? []);
  }

  function setPlayerError(playerId: string, message: string | null) {
    setErrors((current) => {
      const next = { ...current };
      if (message) next[playerId] = message;
      else delete next[playerId];
      return next;
    });
  }

  function validateRawPlayerInputs(
    playerId: string,
    inputs: Record<string, string>
  ): string | null {
    for (const line of visibleLinesFor(playerId)) {
      const rawValue = inputs[`${playerId}:${line.denominationId}`];
      const lineError = validateRawCount(line, rawValue);
      if (lineError) return lineError;
    }
    return null;
  }

  function validateRawCount(
    line: ChipCountLine,
    rawValue: string | undefined
  ): string | null {
    if (rawValue === undefined || rawValue === "") return null;
    if (!/^\d+$/.test(rawValue)) {
      return "Chip counts must be nonnegative whole numbers.";
    }
    const count = Number(rawValue);
    if (
      !Number.isSafeInteger(count) ||
      !Number.isSafeInteger(count * line.valueCents)
    ) {
      return "Chip count is too large.";
    }
    return null;
  }

  function updateCount(playerId: string, line: ChipCountLine, rawValue: string) {
    const inputKey = `${playerId}:${line.denominationId}`;
    const nextRawInputs = { ...rawInputs, [inputKey]: rawValue };
    setRawInputs(nextRawInputs);
    const currentLineError = validateRawCount(line, rawValue);
    if (currentLineError) {
      setPlayerError(playerId, currentLineError);
      return;
    }

    const count = rawValue === "" ? 0 : Number(rawValue);

    const currentDraft = draftByPlayer.get(playerId);
    const nextLines = snapshotNonzeroChipCountLines(
      visibleLinesFor(playerId).map((item) =>
        item.denominationId === line.denominationId ? { ...item, count } : item
      )
    );
    if (nextLines.length === 0 && !currentDraft?.correctingTransactionId) {
      dispatch({ type: "clear_cash_out_draft", playerId });
    } else {
      dispatch({
        type: "save_cash_out_draft",
        draft: {
          playerId,
          lines: nextLines,
          correctingTransactionId: currentDraft?.correctingTransactionId
        }
      });
    }
    setPlayerError(playerId, validateRawPlayerInputs(playerId, nextRawInputs));
  }

  function clearDraft(playerId: string) {
    if (!window.confirm("Clear this saved chip count draft?")) return;
    dispatch({ type: "clear_cash_out_draft", playerId });
    setRawInputs((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${playerId}:`)))
    );
    setPlayerError(playerId, null);
  }

  function recordPlayer(player: Player) {
    if (readOnly) return;
    const rawValidationError = validateRawPlayerInputs(player.id, rawInputs);
    if (errors[player.id] || rawValidationError) {
      setPlayerError(player.id, rawValidationError ?? errors[player.id]);
      return;
    }
    const draft = draftByPlayer.get(player.id);
    const lines = snapshotNonzeroChipCountLines(visibleLinesFor(player.id));
    const amountCents = chipCountTotalCents(lines);
    const transaction: Transaction = {
      id: createId("transaction"),
      type: "bank_cash_out",
      cashOutKind: "final",
      createdAt: new Date().toISOString(),
      amountCents,
      fromPlayerId: player.id,
      note: "End-of-night chip count",
      chipCountBreakdown: lines,
      correctsTransactionId: draft?.correctingTransactionId
    };
    const validationError = validateTransaction(transaction, players);
    if (validationError) {
      setPlayerError(player.id, validationError);
      return;
    }

    if (draft?.correctingTransactionId) {
      const original = transactions.find(
        (item) => item.id === draft.correctingTransactionId && !item.voidedAt
      );
      if (!original) {
        setPlayerError(player.id, "The original cash-out was voided. Discard this correction draft.");
        return;
      }
      dispatch({
        type: "replace_cash_out",
        originalTransactionId: draft.correctingTransactionId,
        replacement: transaction
      });
    } else {
      dispatch({ type: "record_cash_out", transaction });
    }
    setPlayerError(player.id, null);
  }

  return (
    <div className="cash-out-mode">
      <section className="panel cash-out-summary" aria-label="Cash out summary">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">End of night</p>
            <h2>Cash Out</h2>
          </div>
          <BadgeDollarSign size={21} />
        </div>
        <div className="cash-out-metrics">
          <div><span>Completed</span><strong>{overview.completedPlayerIds.size} / {players.length}</strong></div>
          <div><span>Recorded</span><strong>{formatCurrency(overview.recordedTotalCents)}</strong></div>
          <div><span>Projected</span><strong>{formatCurrency(overview.projectedTotalCents)}</strong></div>
          <div><span>Chips remaining</span><strong className={overview.projectedRemainingCents === 0 ? "positive" : "negative"}>{formatCurrency(overview.projectedRemainingCents)}</strong></div>
        </div>

        {overview.missingPlayers.length > 0 ? (
          <div className="notice notice-warning"><TriangleAlert size={16} />Missing cash-outs: {overview.missingPlayers.map((player) => player.name).join(", ")}</div>
        ) : null}
        {overview.projectedRemainingCents !== 0 ? (
          <div className="notice notice-warning"><TriangleAlert size={16} />Projected counts leave {formatCurrency(overview.projectedRemainingCents)} in the chip pool.</div>
        ) : null}
        {overview.manualFinalPlayerIds.size > 0 ? (
          <div className="notice notice-warning">Some final cash-outs do not include chip-color totals.</div>
        ) : null}

        <div className="chip-aggregate-grid">
          {overview.aggregates.length === 0 ? <p className="muted">No projected chip counts yet.</p> : overview.aggregates.map((item) => (
            <div className="chip-aggregate" key={`${item.id}:${item.valueCents}:${item.label}`}>
              <span className="chip-swatch" style={{ backgroundColor: item.colorHex }} aria-hidden="true" />
              <span>{item.label}</span>
              <strong>{item.count} chips</strong>
              <span>{formatCurrency(item.valueCents)} each</span>
              <strong>{formatCurrency(item.totalCents)}</strong>
            </div>
          ))}
        </div>
      </section>

      {denominations.length === 0 ? (
        <div className="notice notice-warning cash-out-empty-key">
          Configure the Chip Value Key in Setup before recording new chip counts.
        </div>
      ) : null}

      <section className="cash-out-player-grid" aria-label="Player chip counts">
        {players.map((player) => {
          const cashOuts = activeCashOutsForPlayer(transactions, player.id);
          const currentFinalCashOut = currentFinalCashOutForPlayer(transactions, player.id);
          const draft = draftByPlayer.get(player.id);
          const correctionOriginal = draft?.correctingTransactionId
            ? currentFinalCashOut?.id === draft.correctingTransactionId
              ? currentFinalCashOut
              : undefined
            : undefined;
          const orphanedCorrection = !!draft?.correctingTransactionId && !correctionOriginal;
          const isEditing = !currentFinalCashOut || !!draft?.correctingTransactionId;
          const lines = visibleLinesFor(player.id);
          const totalCents = chipCountTotalCents(lines);
          const summary = summaryByPlayer.get(player.id);
          const recordedTotal = cashOuts.reduce((total, transaction) => total + transaction.amountCents, 0);
          const earlierCashOuts = currentFinalCashOut
            ? cashOuts.filter((transaction) => transaction.id !== currentFinalCashOut.id)
            : cashOuts;
          const earlierTotal = earlierCashOuts.reduce(
            (total, transaction) => total + transaction.amountCents,
            0
          );

          return (
            <article className={`panel cash-out-card ${currentFinalCashOut && !isEditing ? "is-recorded" : ""}`} key={player.id}>
              <div className="cash-out-card-heading">
                <div><p className="eyebrow">Seat {player.seatIndex + 1}</p><h3>{player.name}</h3></div>
                {currentFinalCashOut ? (
                  <span className="status-pill">Recorded</span>
                ) : cashOuts.length > 0 ? (
                  <span className="status-pill">Partial</span>
                ) : null}
              </div>
              <div className="cash-out-ledger-summary">
                <span>Buy-ins <strong>{formatCurrency(summary?.bankBuyInsCents ?? 0)}</strong></span>
                <span>Transfers <strong>{formatCurrency((summary?.sentToPlayersCents ?? 0) - (summary?.receivedFromPlayersCents ?? 0))}</strong></span>
                {earlierTotal > 0 ? <span>Cashed out earlier <strong>{formatCurrency(earlierTotal)}</strong></span> : null}
              </div>

              {orphanedCorrection ? (
                <div className="notice notice-warning">
                  The original cash-out is no longer active. Discard this correction draft.
                  <button className="text-button" type="button" onClick={() => clearDraft(player.id)}>Discard draft</button>
                </div>
              ) : isEditing ? (
                <>
                  <div className="chip-count-lines">
                    {lines.map((line) => {
                      const inputKey = `${player.id}:${line.denominationId}`;
                      const isRemoved = !denominations.some((item) => item.id === line.denominationId);
                      return (
                        <label className="chip-count-line" key={line.denominationId}>
                          <span className="chip-swatch" style={{ backgroundColor: line.colorHex }} aria-hidden="true" />
                          <span className="chip-count-name">{line.label}{isRemoved ? <small>Removed from key</small> : null}</span>
                          <span className="chip-unit-value">{formatCurrency(line.valueCents)}</span>
                          <input
                            aria-label={`${player.name} ${line.label} chip count`}
                            disabled={readOnly}
                            inputMode="numeric"
                            value={rawInputs[inputKey] ?? (line.count > 0 ? String(line.count) : "")}
                            placeholder="0"
                            onChange={(event) => updateCount(player.id, line, event.currentTarget.value)}
                          />
                          <strong>{formatCurrency(chipCountLineTotalCents(line))}</strong>
                        </label>
                      );
                    })}
                  </div>
                  <div className="cash-out-card-total"><span>{draft?.correctingTransactionId ? "Corrected final total" : "Final cash-out total"}</span><strong>{formatCurrency(totalCents)}</strong></div>
                  {earlierTotal > 0 && !draft?.correctingTransactionId ? (
                    <p className="muted">Projected total payout {formatCurrency(earlierTotal + totalCents)}.</p>
                  ) : null}
                  {errors[player.id] ? <div className="notice notice-warning">{errors[player.id]}</div> : null}
                  <div className="cash-out-card-actions">
                    {draft ? <button className="text-button" type="button" disabled={readOnly} onClick={() => clearDraft(player.id)}><Trash2 size={15} />Clear draft</button> : null}
                    <button className="primary-button" type="button" disabled={readOnly || !!errors[player.id] || (denominations.length === 0 && lines.length === 0)} onClick={() => recordPlayer(player)}>
                      {totalCents === 0 ? "Confirm $0" : draft?.correctingTransactionId ? "Record correction" : "Record cash-out"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="cash-out-card-total"><span>Total cashed out</span><strong>{formatCurrency(recordedTotal)}</strong></div>
                  {earlierTotal > 0 ? <p className="muted">Earlier cash-outs {formatCurrency(earlierTotal)}.</p> : null}
                  {currentFinalCashOut?.chipCountBreakdown !== undefined ? (
                    <ChipBreakdown lines={currentFinalCashOut.chipCountBreakdown} />
                  ) : <p className="muted">Final cash-out recorded without a color breakdown.</p>}
                  {currentFinalCashOut ? (
                    <button className="text-button" type="button" disabled={readOnly || (denominations.length === 0 && currentFinalCashOut.chipCountBreakdown === undefined)} onClick={() => dispatch({ type: "start_cash_out_correction", playerId: player.id, transactionId: currentFinalCashOut.id })}>
                      <RotateCcw size={15} />{currentFinalCashOut.chipCountBreakdown === undefined ? "Recount by color" : "Correct count"}
                    </button>
                  ) : null}
                </>
              )}
            </article>
          );
        })}
      </section>
    </div>
  );
}
