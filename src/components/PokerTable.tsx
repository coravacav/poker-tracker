import { DndContext } from "@dnd-kit/core";
import { useMemo, useState } from "react";
import type { Dispatch } from "react";
import { centsToInputValue } from "../domain/money";
import type {
  Player,
  PlayerId,
  PlayerLedgerSummary,
  TableSeatPlacement,
  TableShape,
  Transaction
} from "../domain/pokerTypes";
import { getSeatSlots, getTableLayoutMetrics } from "../domain/tableLayout";
import type { GameAction } from "../state/gameReducer";
import { createId } from "../state/seedGame";
import { usePersonSuggestions } from "../state/usePeople";
import { buildInsertionTargets, LayoutInsertionTarget } from "./pokerTable/LayoutInsertionTarget";
import { PartialCashOutDialog, type PartialCashOutDraft } from "./pokerTable/PartialCashOutDialog";
import { RenamePlayerDialog, type RenameDraft } from "./pokerTable/RenamePlayerDialog";
import { SeatSlot } from "./pokerTable/SeatSlot";
import { TableToolbar, type PlayerArrangement } from "./pokerTable/TableToolbar";
import { TransferDialog, type TransferDraft } from "./pokerTable/TransferDialog";
import { useCompactView } from "./pokerTable/useCompactView";
import { usePlayerSeatAnimation } from "./pokerTable/usePlayerSeatAnimation";
import { pokerTableCollisionDetection, usePokerTableDrag } from "./pokerTable/usePokerTableDrag";

type PokerTableProps = {
  activePlayers: Player[];
  bankBalanceCents: number;
  defaultBuyInCents: number;
  dispatch: Dispatch<GameAction>;
  hideActions?: boolean;
  layoutEditing: boolean;
  onCompactViewChange?: (compactView: boolean) => void;
  onAddTransaction: (transaction: Transaction) => boolean;
  readOnly: boolean;
  tableSeatPlacements: TableSeatPlacement[];
  tableShape: TableShape;
  summaryByPlayerId: Map<PlayerId, PlayerLedgerSummary>;
};

export function PokerTable({
  activePlayers,
  bankBalanceCents,
  defaultBuyInCents,
  dispatch,
  layoutEditing,
  hideActions = false,
  onCompactViewChange,
  onAddTransaction,
  readOnly,
  tableSeatPlacements,
  tableShape,
  summaryByPlayerId
}: PokerTableProps) {
  const [transferDraft, setTransferDraft] = useState<TransferDraft | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [partialCashOutDraft, setPartialCashOutDraft] =
    useState<PartialCashOutDraft | null>(null);
  const [partialCashOutError, setPartialCashOutError] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState<RenameDraft | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const { directory: peopleDirectory, suggestions: personSuggestions } = usePersonSuggestions();

  const seatSlots = useMemo(
    () => getSeatSlots(tableShape, tableSeatPlacements),
    [tableSeatPlacements, tableShape]
  );
  const layoutMetrics = useMemo(
    () => getTableLayoutMetrics(tableSeatPlacements),
    [tableSeatPlacements]
  );
  const { compactView, panelRef } = useCompactView(layoutMetrics.minWidthPx, onCompactViewChange);
  const effectiveLayoutEditing = layoutEditing && !compactView;
  const insertionTargets = useMemo(
    () => buildInsertionTargets(tableShape, tableSeatPlacements),
    [tableSeatPlacements, tableShape]
  );
  const playerBySeatIndex = useMemo(
    () =>
      new Map(activePlayers.map((player) => [player.seatIndex, player] as const)),
    [activePlayers]
  );
  const { setPlayerSeatElement, snapshotPlayerSeatRects } = usePlayerSeatAnimation(activePlayers);

  function arrangePlayers(arrangement: PlayerArrangement) {
    const playersInTableOrder = seatSlots.map((slot) =>
      playerBySeatIndex.get(slot.seatIndex)
    );

    if (
      playersInTableOrder.length < 2 ||
      playersInTableOrder.some((player) => !player)
    ) {
      return;
    }

    const currentPlayers = playersInTableOrder.filter(
      (player): player is Player => player !== undefined
    );
    const arrangedPlayers =
      arrangement === "rotate_left"
        ? [...currentPlayers.slice(1), currentPlayers[0]]
        : arrangement === "rotate_right"
          ? [currentPlayers[currentPlayers.length - 1], ...currentPlayers.slice(0, -1)]
          : [...currentPlayers].reverse();
    const playerIdBySeatIndex = new Map(
      seatSlots.map((slot, index) => [slot.seatIndex, arrangedPlayers[index].id])
    );
    const orderedPlayerIds = [...activePlayers]
      .sort((left, right) => left.seatIndex - right.seatIndex)
      .map((player) => playerIdBySeatIndex.get(player.seatIndex))
      .filter((playerId): playerId is PlayerId => playerId !== undefined);

    if (orderedPlayerIds.length !== activePlayers.length) {
      return;
    }

    snapshotPlayerSeatRects();
    dispatch({ type: "reorder_players", orderedPlayerIds });
  }

  function playerName(playerId: PlayerId): string {
    return activePlayers.find((player) => player.id === playerId)?.name ?? "Unknown player";
  }

  function openTransfer(fromPlayerId: PlayerId, toPlayerId?: PlayerId) {
    const fallbackToPlayerId =
      toPlayerId ??
      activePlayers.find((player) => player.id !== fromPlayerId)?.id ??
      fromPlayerId;

    setTransferDraft({
      mode: "player_gave",
      fromPlayerId,
      toPlayerId: fallbackToPlayerId,
      amountInput: centsToInputValue(defaultBuyInCents),
      note: ""
    });
    setTransferError(null);
  }

  const { sensors, activeDragType, setActiveDragType, handleDragStart, handleDragEnd } =
    usePokerTableDrag({
      activePlayers,
      compactView,
      dispatch,
      layoutEditing,
      playerBySeatIndex,
      readOnly,
      openTransfer,
      snapshotPlayerSeatRects
    });

  function quickBuyIn(player: Player) {
    onAddTransaction({
      id: createId("transaction"),
      type: "bank_buy_in",
      createdAt: new Date().toISOString(),
      amountCents: defaultBuyInCents,
      toPlayerId: player.id,
      note: "Default buy-in"
    });
  }

  function openPartialCashOut(player: Player) {
    setPartialCashOutDraft({
      playerId: player.id,
      amountInput: centsToInputValue(defaultBuyInCents),
      note: ""
    });
    setPartialCashOutError(null);
  }

  function editPlayerName(player: Player) {
    setRenameDraft({
      playerId: player.id,
      nameInput: player.name,
      ...(player.personId ? { personId: player.personId } : {})
    });
    setRenameError(null);
  }

  const tableShapeClass =
    tableShape === "rectangle"
      ? "layout-rectangle"
      : tableShape === "round"
        ? "layout-round"
        : "layout-oval";
  const tableClassName = [
    "poker-table",
    tableShapeClass,
    compactView ? "is-player-list" : "",
    effectiveLayoutEditing ? "is-layout-editing" : "",
    activeDragType === "seat" ? "is-seat-dragging" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section
      ref={panelRef}
      className={`poker-table-panel ${compactView ? "is-player-list-view" : ""}`}
    >
      <TableToolbar
        compactView={compactView}
        layoutEditing={effectiveLayoutEditing}
        readOnly={readOnly}
        playerCount={activePlayers.length}
        tableShape={tableShape}
        defaultBuyInCents={defaultBuyInCents}
        dispatch={dispatch}
        onArrange={arrangePlayers}
      />

      <DndContext
        sensors={sensors}
        collisionDetection={pokerTableCollisionDetection}
        onDragStart={handleDragStart}
        onDragCancel={() => setActiveDragType(null)}
        onDragEnd={handleDragEnd}
      >
        <div
          className={tableClassName}
          aria-label={compactView ? "Players" : "Poker seating"}
          style={
            compactView
              ? undefined
              : {
                  minWidth: `${layoutMetrics.minWidthPx}px`,
                  minHeight: `${layoutMetrics.minHeightPx}px`
                }
          }
        >
          <div className="felt-center">
            <span>{activePlayers.length}</span>
            <small>players</small>
          </div>
          {effectiveLayoutEditing
            ? insertionTargets.map((target) => (
                <LayoutInsertionTarget key={target.id} target={target} />
              ))
            : null}
          {seatSlots.map((slot) => {
            const player = playerBySeatIndex.get(slot.seatIndex);

            return (
              <SeatSlot
                key={slot.seatIndex}
                compactView={compactView}
                layoutEditing={effectiveLayoutEditing}
                isSeatDragging={activeDragType === "seat"}
                player={player}
                hideActions={hideActions}
                readOnly={readOnly}
                slot={slot}
                summary={player ? summaryByPlayerId.get(player.id) : undefined}
                onBuyIn={quickBuyIn}
                onCashOut={openPartialCashOut}
                onEdit={editPlayerName}
                onSeatElementChange={setPlayerSeatElement}
                onStartTransfer={(fromPlayer) => openTransfer(fromPlayer.id)}
              />
            );
          })}
        </div>
      </DndContext>

      {partialCashOutDraft ? (
        <PartialCashOutDialog
          partialCashOutDraft={partialCashOutDraft}
          setPartialCashOutDraft={setPartialCashOutDraft}
          partialCashOutError={partialCashOutError}
          setPartialCashOutError={setPartialCashOutError}
          bankBalanceCents={bankBalanceCents}
          defaultBuyInCents={defaultBuyInCents}
          summaryByPlayerId={summaryByPlayerId}
          onAddTransaction={onAddTransaction}
          playerName={playerName}
        />
      ) : null}

      {transferDraft ? (
        <TransferDialog
          transferDraft={transferDraft}
          setTransferDraft={setTransferDraft}
          transferError={transferError}
          setTransferError={setTransferError}
          activePlayers={activePlayers}
          bankBalanceCents={bankBalanceCents}
          defaultBuyInCents={defaultBuyInCents}
          summaryByPlayerId={summaryByPlayerId}
          onAddTransaction={onAddTransaction}
          playerName={playerName}
        />
      ) : null}

      {renameDraft ? (
        <RenamePlayerDialog
          renameDraft={renameDraft}
          setRenameDraft={setRenameDraft}
          renameError={renameError}
          setRenameError={setRenameError}
          activePlayers={activePlayers}
          peopleDirectory={peopleDirectory}
          personSuggestions={personSuggestions}
          dispatch={dispatch}
          playerName={playerName}
        />
      ) : null}
    </section>
  );
}
