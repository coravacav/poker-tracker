import {
  DndContext,
  PointerSensor,
  type DragEndEvent,
  type DragStartEvent,
  useDroppable,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import { X } from "lucide-react";
import { useMemo, useState } from "react";
import type { CSSProperties, Dispatch } from "react";
import { centsToInputValue, formatCurrency, parseMoneyToCents } from "../domain/money";
import type {
  Player,
  PlayerId,
  PlayerLedgerSummary,
  TableSeatLayout,
  TransactionCategory,
  Transaction
} from "../domain/pokerTypes";
import { getSeatSlots, type TableSeatSlot } from "../domain/tableLayout";
import type { GameAction } from "../state/gameReducer";
import { createId } from "../state/seedGame";
import { PlayerSeat } from "./PlayerSeat";
import { TransferPreview } from "./TransferPreview";

type PokerTableProps = {
  activePlayers: Player[];
  defaultBuyInCents: number;
  dispatch: Dispatch<GameAction>;
  onAddTransaction: (transaction: Transaction) => boolean;
  readOnly: boolean;
  seatLayout: TableSeatLayout;
  tableIncludeCornerSeats: boolean;
  summaryByPlayerId: Map<PlayerId, PlayerLedgerSummary>;
};

type TransferDraft = {
  fromPlayerId: PlayerId;
  toPlayerId: PlayerId;
  amountInput: string;
  category: TransactionCategory;
  note: string;
};

type CashOutDraft = {
  playerId: PlayerId;
  amountInput: string;
};

type RenameDraft = {
  playerId: PlayerId;
  nameInput: string;
};

function positionFor(slot: TableSeatSlot): CSSProperties {
  return {
    left: `${slot.leftPercent}%`,
    top: `${slot.topPercent}%`
  };
}

type SeatSlotProps = {
  isSeatDragging: boolean;
  player?: Player;
  readOnly: boolean;
  slot: TableSeatSlot;
  summary?: PlayerLedgerSummary;
  onBuyIn: (player: Player) => void;
  onCashOut: (player: Player) => void;
  onEdit: (player: Player) => void;
  onStartTransfer: (fromPlayer: Player) => void;
};

function SeatSlot({
  isSeatDragging,
  player,
  readOnly,
  slot,
  summary,
  onBuyIn,
  onCashOut,
  onEdit,
  onStartTransfer
}: SeatSlotProps) {
  const drop = useDroppable({
    id: `seat-slot:${slot.seatIndex}`,
    disabled: readOnly
  });

  return (
    <div
      ref={drop.setNodeRef}
      className={`seat-slot ${drop.isOver ? "is-over" : ""}`}
      style={positionFor(slot)}
    >
      {player ? (
        <PlayerSeat
          player={player}
          readOnly={readOnly}
          summary={summary}
          onBuyIn={onBuyIn}
          onCashOut={onCashOut}
          onEdit={onEdit}
          onStartTransfer={onStartTransfer}
        />
      ) : (
        <div
          className="empty-seat-target"
          aria-hidden={!isSeatDragging}
          title={`Seat ${slot.seatIndex + 1}`}
        >
          Seat {slot.seatIndex + 1}
        </div>
      )}
    </div>
  );
}

export function PokerTable({
  activePlayers,
  defaultBuyInCents,
  dispatch,
  onAddTransaction,
  readOnly,
  seatLayout,
  tableIncludeCornerSeats,
  summaryByPlayerId
}: PokerTableProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 }
    })
  );
  const [transferDraft, setTransferDraft] = useState<TransferDraft | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [cashOutDraft, setCashOutDraft] = useState<CashOutDraft | null>(null);
  const [cashOutError, setCashOutError] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState<RenameDraft | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [activeDragType, setActiveDragType] = useState<"seat" | "bucket" | null>(
    null
  );

  const seatSlots = useMemo(
    () =>
      getSeatSlots(seatLayout, activePlayers.length, {
        includeCornerSeats: tableIncludeCornerSeats
      }),
    [activePlayers.length, seatLayout, tableIncludeCornerSeats]
  );
  const playerBySeatIndex = useMemo(
    () =>
      new Map(activePlayers.map((player) => [player.seatIndex, player] as const)),
    [activePlayers]
  );

  function playerName(playerId: PlayerId): string {
    return activePlayers.find((player) => player.id === playerId)?.name ?? "Unknown player";
  }

  function openTransfer(fromPlayerId: PlayerId, toPlayerId?: PlayerId) {
    const fallbackToPlayerId =
      toPlayerId ??
      activePlayers.find((player) => player.id !== fromPlayerId)?.id ??
      fromPlayerId;

    setTransferDraft({
      fromPlayerId,
      toPlayerId: fallbackToPlayerId,
      amountInput: centsToInputValue(defaultBuyInCents),
      category: "poker",
      note: ""
    });
    setTransferError(null);
  }

  function handleDragStart(event: DragStartEvent) {
    const activeId = String(event.active.id);
    const [, dragType] = activeId.match(/^(seat|bucket):(.+)$/) ?? [];
    setActiveDragType(dragType === "seat" || dragType === "bucket" ? dragType : null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDragType(null);

    if (readOnly || !event.over) {
      return;
    }

    const activeId = String(event.active.id);
    const overId = String(event.over.id);
    if (!overId.startsWith("seat-slot:")) {
      return;
    }

    const [, dragType, draggedPlayerId] = activeId.match(/^(seat|bucket):(.+)$/) ?? [];
    const targetSeatIndex = Number.parseInt(overId.replace("seat-slot:", ""), 10);
    const targetPlayer = playerBySeatIndex.get(targetSeatIndex);

    if (!dragType || !draggedPlayerId || Number.isNaN(targetSeatIndex)) {
      return;
    }

    if (dragType === "seat") {
      dispatch({
        type: "move_player_to_seat",
        playerId: draggedPlayerId,
        seatIndex: targetSeatIndex
      });
    }

    if (dragType === "bucket" && targetPlayer && draggedPlayerId !== targetPlayer.id) {
      openTransfer(draggedPlayerId, targetPlayer.id);
    }
  }

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

  function quickCashOut(player: Player) {
    setCashOutDraft({
      playerId: player.id,
      amountInput: centsToInputValue(summaryByPlayerId.get(player.id)?.bankCashOutsCents ?? 0)
    });
    setCashOutError(null);
  }

  function editPlayerName(player: Player) {
    setRenameDraft({
      playerId: player.id,
      nameInput: player.name
    });
    setRenameError(null);
  }

  function confirmTransfer() {
    if (!transferDraft) {
      return;
    }

    const amountCents = parseMoneyToCents(transferDraft.amountInput);
    if (transferDraft.fromPlayerId === transferDraft.toPlayerId) {
      setTransferError("Choose two different players.");
      return;
    }

    if (!amountCents || amountCents <= 0) {
      setTransferError("Enter a positive transfer amount.");
      return;
    }

    const added = onAddTransaction({
      id: createId("transaction"),
      type: "player_transfer",
      createdAt: new Date().toISOString(),
      amountCents,
      fromPlayerId: transferDraft.fromPlayerId,
      toPlayerId: transferDraft.toPlayerId,
      category: transferDraft.category,
      note: transferDraft.note
    });

    if (added) {
      setTransferDraft(null);
      setTransferError(null);
    }
  }

  function confirmQuickCashOut() {
    if (!cashOutDraft) {
      return;
    }

    const amountCents = parseMoneyToCents(cashOutDraft.amountInput);
    if (amountCents === null) {
      setCashOutError("Enter a valid final chip value.");
      return;
    }

    const added = onAddTransaction({
      id: createId("transaction"),
      type: "bank_cash_out",
      createdAt: new Date().toISOString(),
      amountCents,
      fromPlayerId: cashOutDraft.playerId,
      note: "Quick chip count"
    });

    if (added) {
      setCashOutDraft(null);
      setCashOutError(null);
    }
  }

  function confirmRename() {
    if (!renameDraft) {
      return;
    }

    const name = renameDraft.nameInput.trim();
    if (!name) {
      setRenameError("Enter a player name.");
      return;
    }

    dispatch({ type: "rename_player", playerId: renameDraft.playerId, name });
    setRenameDraft(null);
    setRenameError(null);
  }

  const transferPreviewAmountCents = transferDraft
    ? parseMoneyToCents(transferDraft.amountInput)
    : null;
  const showTransferPreview =
    !!transferDraft &&
    !!transferPreviewAmountCents &&
    transferPreviewAmountCents > 0 &&
    transferDraft.fromPlayerId !== transferDraft.toPlayerId;
  const transferFromCurrentNet = transferDraft
    ? summaryByPlayerId.get(transferDraft.fromPlayerId)?.netCents ?? 0
    : 0;
  const transferToCurrentNet = transferDraft
    ? summaryByPlayerId.get(transferDraft.toPlayerId)?.netCents ?? 0
    : 0;
  const tableShapeClass =
    seatLayout === "rectangle"
      ? "layout-rectangle"
      : seatLayout === "round"
        ? "layout-round"
        : "layout-oval";
  const tableClassName = [
    "poker-table",
    tableShapeClass,
    activeDragType === "seat" ? "is-seat-dragging" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className="poker-table-panel">
      <div className="table-toolbar">
        <div>
          <p className="eyebrow">Drag seats to rearrange</p>
          <h2>Table Layout</h2>
        </div>
        <span className="default-buy-in">
          Default buy-in {formatCurrency(defaultBuyInCents)}
        </span>
      </div>

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragCancel={() => setActiveDragType(null)}
        onDragEnd={handleDragEnd}
      >
        <div className={tableClassName} aria-label="Poker seating">
          <div className="felt-center">
            <span>{activePlayers.length}</span>
            <small>players</small>
          </div>
          {seatSlots.map((slot) => {
            const player = playerBySeatIndex.get(slot.seatIndex);

            return (
              <SeatSlot
                key={slot.seatIndex}
                isSeatDragging={activeDragType === "seat"}
                player={player}
                readOnly={readOnly}
                slot={slot}
                summary={player ? summaryByPlayerId.get(player.id) : undefined}
                onBuyIn={quickBuyIn}
                onCashOut={quickCashOut}
                onEdit={editPlayerName}
                onStartTransfer={(fromPlayer) => openTransfer(fromPlayer.id)}
              />
            );
          })}
        </div>
      </DndContext>

      {transferDraft ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-label="Player transfer">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Rebuy transfer</p>
                <h2>
                  {playerName(transferDraft.toPlayerId)} receives from{" "}
                  {playerName(transferDraft.fromPlayerId)}
                </h2>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => setTransferDraft(null)}
                title="Close"
              >
                <X size={17} />
              </button>
            </div>

            <div className="form-grid two">
              <label>
                <span>From</span>
                <select
                  value={transferDraft.fromPlayerId}
                  onChange={(event) =>
                    setTransferDraft({
                      ...transferDraft,
                      fromPlayerId: event.currentTarget.value
                    })
                  }
                >
                  {activePlayers.map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>To</span>
                <select
                  value={transferDraft.toPlayerId}
                  onChange={(event) =>
                    setTransferDraft({
                      ...transferDraft,
                      toPlayerId: event.currentTarget.value
                    })
                  }
                >
                  {activePlayers.map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.name}
                    </option>
                  ))}
                </select>
              </label>
              {showTransferPreview && transferDraft ? (
                <TransferPreview
                  amountCents={transferPreviewAmountCents ?? 0}
                  fromCurrentNetCents={transferFromCurrentNet}
                  fromName={playerName(transferDraft.fromPlayerId)}
                  toCurrentNetCents={transferToCurrentNet}
                  toName={playerName(transferDraft.toPlayerId)}
                />
              ) : null}
            </div>

            <div className="form-grid transfer-detail-grid">
              <label>
                <span>Category</span>
                <select
                  value={transferDraft.category}
                  onChange={(event) => {
                    const nextCategory = event.currentTarget.value as TransactionCategory;
                    setTransferDraft({
                      ...transferDraft,
                      category: nextCategory
                    });
                  }}
                >
                  <option value="poker">Poker / rebuy</option>
                  <option value="food">Food</option>
                </select>
              </label>
              <label>
                <span>Amount</span>
                <input
                  inputMode="decimal"
                  value={transferDraft.amountInput}
                  onChange={(event) =>
                    setTransferDraft({
                      ...transferDraft,
                      amountInput: event.currentTarget.value
                    })
                  }
                />
              </label>
              <label>
                <span>Note</span>
                <input
                  value={transferDraft.note}
                  onChange={(event) =>
                    setTransferDraft({
                      ...transferDraft,
                      note: event.currentTarget.value
                    })
                  }
                />
              </label>
            </div>

            <div className="quick-amounts">
              <button
                type="button"
                onClick={() =>
                  setTransferDraft({
                    ...transferDraft,
                    amountInput: centsToInputValue(Math.round(defaultBuyInCents / 2))
                  })
                }
              >
                Half
              </button>
              <button
                type="button"
                onClick={() =>
                  setTransferDraft({
                    ...transferDraft,
                    amountInput: centsToInputValue(defaultBuyInCents)
                  })
                }
              >
                Buy-in
              </button>
              <button
                type="button"
                onClick={() =>
                  setTransferDraft({
                    ...transferDraft,
                    amountInput: centsToInputValue(defaultBuyInCents * 2)
                  })
                }
              >
                Double
              </button>
              <button
                type="button"
                onClick={() =>
                  setTransferDraft({
                    ...transferDraft,
                    category: "food"
                  })
                }
              >
                Food
              </button>
            </div>

            {transferError ? <div className="notice notice-warning">{transferError}</div> : null}
            <div className="modal-actions">
              <button type="button" onClick={() => setTransferDraft(null)}>
                Cancel
              </button>
              <button className="primary-button" type="button" onClick={confirmTransfer}>
                Record transfer
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {cashOutDraft ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal table-action-modal" role="dialog" aria-modal="true" aria-label="Final chips">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Seat action</p>
                <h2>Final chips for {playerName(cashOutDraft.playerId)}</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => setCashOutDraft(null)}
                title="Close"
              >
                <X size={17} />
              </button>
            </div>
            <label>
              <span>Final chips</span>
              <input
                inputMode="decimal"
                value={cashOutDraft.amountInput}
                onChange={(event) =>
                  setCashOutDraft({
                    ...cashOutDraft,
                    amountInput: event.currentTarget.value
                  })
                }
              />
            </label>
            {cashOutError ? <div className="notice notice-warning">{cashOutError}</div> : null}
            <div className="modal-actions">
              <button type="button" onClick={() => setCashOutDraft(null)}>
                Cancel
              </button>
              <button className="primary-button" type="button" onClick={confirmQuickCashOut}>
                Record final chips
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {renameDraft ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal table-action-modal" role="dialog" aria-modal="true" aria-label="Rename player">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Seat action</p>
                <h2>Rename {playerName(renameDraft.playerId)}</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => setRenameDraft(null)}
                title="Close"
              >
                <X size={17} />
              </button>
            </div>
            <label>
              <span>Player name</span>
              <input
                value={renameDraft.nameInput}
                onChange={(event) =>
                  setRenameDraft({
                    ...renameDraft,
                    nameInput: event.currentTarget.value
                  })
                }
              />
            </label>
            {renameError ? <div className="notice notice-warning">{renameError}</div> : null}
            <div className="modal-actions">
              <button type="button" onClick={() => setRenameDraft(null)}>
                Cancel
              </button>
              <button className="primary-button" type="button" onClick={confirmRename}>
                Save name
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
