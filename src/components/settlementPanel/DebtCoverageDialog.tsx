import { X } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { formatCurrency } from "../../domain/money";
import type { Player, PlayerLedgerSummary, Transaction } from "../../domain/pokerTypes";
import { playerNameById } from "../../domain/settlement";
import { createId } from "../../state/seedGame";

type DebtCoverageDialogProps = {
  coveredPlayerId: string;
  setCoveredPlayerId: Dispatch<SetStateAction<string | null>>;
  coverageSummary: PlayerLedgerSummary;
  coveredByPlayerId: string;
  setCoveredByPlayerId: Dispatch<SetStateAction<string>>;
  coverageNote: string;
  setCoverageNote: Dispatch<SetStateAction<string>>;
  coverageError: string | null;
  setCoverageError: Dispatch<SetStateAction<string | null>>;
  currencyCode: string;
  players: Player[];
  summaries: PlayerLedgerSummary[];
  sortedSummaries: PlayerLedgerSummary[];
  onAddTransaction: (transaction: Transaction) => boolean;
};

/** Records another player covering a player's full settlement debt. */
export function DebtCoverageDialog({
  coveredPlayerId,
  setCoveredPlayerId,
  coverageSummary,
  coveredByPlayerId,
  setCoveredByPlayerId,
  coverageNote,
  setCoverageNote,
  coverageError,
  setCoverageError,
  currencyCode,
  players,
  summaries,
  sortedSummaries,
  onAddTransaction
}: DebtCoverageDialogProps) {
  function recordDebtCoverage() {
    if (!coveredPlayerId || !coveredByPlayerId) {
      setCoverageError("Choose a player to cover this debt.");
      return;
    }

    const currentSummary = summaries.find(
      (summary) => summary.playerId === coveredPlayerId
    );
    if (!currentSummary || currentSummary.netCents >= 0) {
      setCoverageError("This player no longer has a debt to cover.");
      return;
    }

    const added = onAddTransaction({
      id: createId("transaction"),
      type: "debt_coverage",
      createdAt: new Date().toISOString(),
      amountCents: Math.abs(currentSummary.netCents),
      coveredPlayerId,
      coveredByPlayerId,
      note: coverageNote.trim() || undefined
    });

    if (added) {
      setCoveredPlayerId(null);
      setCoverageError(null);
    } else {
      setCoverageError("Balances changed. Review the refreshed amount and try again.");
    }
  }

  const covererSummary = coveredByPlayerId
    ? summaries.find((summary) => summary.playerId === coveredByPlayerId)
    : undefined;
  const coverageAmountCents = coverageSummary && coverageSummary.netCents < 0
    ? Math.abs(coverageSummary.netCents)
    : 0;

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="modal table-action-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Cover full debt"
      >
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Settlement adjustment</p>
            <h2>Cover {playerNameById(players, coveredPlayerId)}'s full debt</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            title="Close"
            onClick={() => setCoveredPlayerId(null)}
          >
            <X size={17} />
          </button>
        </div>

        <div className="form-grid two">
          <label>
            <span>Covered player</span>
            <input
              readOnly
              value={playerNameById(players, coveredPlayerId)}
            />
          </label>
          <label>
            <span>Covered by</span>
            <select
              value={coveredByPlayerId}
              onChange={(event) => {
                setCoveredByPlayerId(event.currentTarget.value);
                setCoverageError(null);
              }}
            >
              {sortedSummaries
                .filter((summary) => summary.playerId !== coveredPlayerId)
                .map((summary) => (
                  <option key={summary.playerId} value={summary.playerId}>
                    {playerNameById(players, summary.playerId)}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span>Full debt amount</span>
            <input readOnly value={formatCurrency(coverageAmountCents, currencyCode)} />
          </label>
          <label>
            <span>Note</span>
            <input
              value={coverageNote}
              placeholder="Optional"
              onChange={(event) => setCoverageNote(event.currentTarget.value)}
            />
          </label>
        </div>

        {covererSummary ? (
          <div className="debt-coverage-preview" aria-label="Debt coverage preview">
            <article className="preview-card">
              <div className="preview-card-heading">
                <span>{playerNameById(players, coveredPlayerId)}</span>
                <small>Covered player</small>
              </div>
              <strong>{formatCurrency(coverageSummary.netCents, currencyCode)} → {formatCurrency(0, currencyCode)}</strong>
            </article>
            <article className="preview-card">
              <div className="preview-card-heading">
                <span>{playerNameById(players, coveredByPlayerId)}</span>
                <small>Coverer</small>
              </div>
              <strong>
                {formatCurrency(covererSummary.netCents, currencyCode)} → {formatCurrency(covererSummary.netCents - coverageAmountCents, currencyCode)}
              </strong>
            </article>
          </div>
        ) : null}

        {coverageError ? (
          <div className="notice notice-warning">{coverageError}</div>
        ) : null}

        <div className="modal-actions">
          <button type="button" onClick={() => setCoveredPlayerId(null)}>
            Cancel
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={!coveredByPlayerId || coverageAmountCents <= 0}
            onClick={recordDebtCoverage}
          >
            Record debt coverage
          </button>
        </div>
      </section>
    </div>
  );
}
