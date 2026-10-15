import { useMemo } from "react";
import { getCashOutOverview } from "../../domain/chipCounts";
import {
  buildPlayerSummaries,
  calculateBankSummary,
  calculateLedgerImbalanceCents,
  getSummaryByPlayerId
} from "../../domain/ledger";
import type { GameState } from "../../domain/pokerTypes";
import { latestRepeatableTransaction } from "../../domain/quickEntry";
import { getLatestTransactionAction } from "../../domain/recentTransactionAction";
import { filterSettlementSummariesForDisplay } from "../../domain/settlement";

/** Ledger figures derived from the game state for every app mode. */
export function useLedgerOverview(state: GameState) {
  const activePlayers = useMemo(
    () =>
      state.players
        .filter((player) => player.isActive)
        .sort((a, b) => a.seatIndex - b.seatIndex),
    [state.players]
  );

  const playerSummaries = useMemo(
    () => buildPlayerSummaries(state.players, state.transactions),
    [state.players, state.transactions]
  );

  const summaryByPlayerId = useMemo(
    () => getSummaryByPlayerId(playerSummaries),
    [playerSummaries]
  );

  const bankSummary = useMemo(
    () => calculateBankSummary(state.transactions),
    [state.transactions]
  );

  const settlementSummaries = useMemo(
    () => filterSettlementSummariesForDisplay(state.players, playerSummaries),
    [playerSummaries, state.players]
  );

  const imbalanceCents = useMemo(
    () => calculateLedgerImbalanceCents(playerSummaries, bankSummary),
    [bankSummary, playerSummaries]
  );

  const cashOutOverview = useMemo(
    () =>
      getCashOutOverview(
        activePlayers,
        state.transactions,
        state.cashOutDrafts,
        state.settings.chipDenominations,
        bankSummary
      ),
    [activePlayers, bankSummary, state.cashOutDrafts, state.settings.chipDenominations, state.transactions]
  );

  const recentTransactionAction = useMemo(
    () => getLatestTransactionAction(state.transactions),
    [state.transactions]
  );
  const repeatableTransaction = useMemo(
    () => latestRepeatableTransaction(state.transactions),
    [state.transactions]
  );

  const settlementReady =
    cashOutOverview.cashOutsCompleteForSettlement &&
    bankSummary.balanceCents === 0 &&
    imbalanceCents === 0;

  return {
    activePlayers,
    playerSummaries,
    summaryByPlayerId,
    bankSummary,
    settlementSummaries,
    imbalanceCents,
    cashOutOverview,
    recentTransactionAction,
    repeatableTransaction,
    settlementReady
  };
}

export type LedgerOverview = ReturnType<typeof useLedgerOverview>;
